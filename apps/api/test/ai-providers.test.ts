import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DOCUMENT_TYPES, parseStudioContent } from '@forgehse/shared';
import { freshDb, startApp, seedWorld, loggedIn, observationInput, type TestApp, type World } from './helpers';
import { LocalRulesBackend } from '../src/ai/providers/local/backend';
import { localChecklist, localDocument, localPoster, localFlowchart, localReview, localDraftObservation } from '../src/ai/providers/local/engine';
import { TOPICS } from '../src/ai/providers/local/knowledge';
import { OpenAiCompatibleBackend, toChatCompletions } from '../src/ai/providers/openai-compatible';
import { loadConfig } from '../src/config';
import { selectBackend } from '../src/app';
import type { MessagesRequest } from '../src/ai/claude';

describe('AI provider selection (no paid service required)', () => {
  const base = { NODE_ENV: 'test', DATABASE_URL: 'postgres://u:p@h/d' };
  it('defaults to the free local rules engine when no API key is set', () => {
    assert.equal(selectBackend(loadConfig({ ...base } as NodeJS.ProcessEnv))?.id, 'local');
    assert.equal(selectBackend(loadConfig({ ...base, ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv)), undefined, 'auto + key → Anthropic');
    assert.equal(selectBackend(loadConfig({ ...base, AI_PROVIDER: 'off' } as NodeJS.ProcessEnv)), null);
    assert.equal(selectBackend(loadConfig({ ...base, AI_PROVIDER: 'openai_compatible', LOCAL_AI_BASE_URL: 'http://127.0.0.1:11434/v1', LOCAL_AI_MODEL: 'llama3.1' } as NodeJS.ProcessEnv))?.id, 'openai_compatible');
  });
  it('refuses incomplete provider configuration', () => {
    assert.throws(() => loadConfig({ ...base, AI_PROVIDER: 'openai_compatible' } as NodeJS.ProcessEnv), /LOCAL_AI_BASE_URL/);
    assert.throws(() => loadConfig({ ...base, AI_PROVIDER: 'anthropic' } as NodeJS.ProcessEnv), /ANTHROPIC_API_KEY/);
  });
});

describe('local rules engine: every generated draft passes the same schema validation as model output', () => {
  it('checklists, posters and flowcharts for every topic', () => {
    for (const t of TOPICS) {
      const b = `${t.label} for level 3`;
      for (const [kind, v] of [['checklist', localChecklist(b, t)], ['poster', localPoster(b, t)], ['flowchart', localFlowchart(b, t)]] as const) {
        const r = parseStudioContent(kind, v);
        assert.ok(r.success, `${t.id} ${kind}: ${JSON.stringify(r.error?.issues?.slice(0, 2))}`);
      }
    }
  });
  it('all ten document types, with risk tables on the organisation matrix size', () => {
    for (const dt of DOCUMENT_TYPES) for (const size of [4, 5]) {
      const d = localDocument('Excavation for drainage line near Gate 3', dt, size);
      const r = parseStudioContent('document', d);
      assert.ok(r.success, `${dt}: ${JSON.stringify(r.error?.issues?.slice(0, 2))}`);
      for (const row of d.riskTable) assert.ok(row.severity <= size && row.likelihood <= size);
    }
    assert.ok(localDocument('excavation', 'risk_assessment', 5).riskTable.length > 0);
    assert.equal(localDocument('excavation', 'toolbox_talk', 5).riskTable.length, 0);
  });
  it('is deterministic and never invents incident facts', () => {
    assert.deepEqual(localDocument('Hot work in basement', 'incident_report', 5), localDocument('Hot work in basement', 'incident_report', 5));
    assert.ok(JSON.stringify(localDocument('Hot work in basement', 'incident_report', 5)).includes('[to be completed by the author]'));
  });
  it('reviews a document for missing elements', () => {
    const r = localReview('Method statement. Scope: excavation. Sequence of work: dig, shore, backfill. Hazards and controls listed.', 'MS.docx');
    assert.ok(parseStudioContent('review', r).success);
    assert.equal(r.overallRating, 'inadequate', 'no emergency arrangements → critical gap');
    assert.ok(r.findings.some((f) => f.section.startsWith('Emergency')));
  });
  it('drafts an observation from field notes', () => {
    const d = localDraftObservation('Worker on level 5 not wearing harness near open edge, stopped and instructed by supervisor', 5, ['Work at height', 'PPE', 'Other']);
    assert.equal(d.type, 'unsafe_act'); assert.equal(d.hazardCategory, 'Work at height');
    assert.equal(d.severity, 5); assert.match(d.immediateAction, /stopped/);
    assert.ok(d.missingInformation.includes('Photo evidence'));
  });
});

describe('local rules engine through the real API', () => {
  let app: TestApp; let world: World;
  before(async () => { const db = await freshDb(); world = await seedWorld(db); app = await startApp(db, { backend: new LocalRulesBackend() }); });
  after(async () => { await app.close(); await app.db.end(); });

  it('reports itself honestly as rules-based', async () => {
    const c = await loggedIn(app.base, 'engA1');
    const s = (await c.get('/api/ai/status')).data;
    assert.equal(s.configured, true); assert.equal(s.provider.id, 'local'); assert.equal(s.provider.deterministic, true); assert.equal(s.provider.costed, false);
  });

  it('assist: observation draft, CAPA suggestions and Q&A', async () => {
    const c = await loggedIn(app.base, 'engA1');
    const d = await c.post('/api/ai/assist', { task: 'draft_observation', input: 'Scaffold on block B missing toe boards and the tag is expired' });
    assert.equal(d.status, 200, JSON.stringify(d.data));
    assert.equal(d.data.draft.hazardCategory, 'Scaffolding'); assert.equal(d.data.provider, 'local'); assert.match(d.data.disclaimer, /no AI model/);
    const q = await c.post('/api/ai/assist', { task: 'ask', input: 'key controls for hot work' });
    assert.match(q.data.text, /Hot work: key controls/); assert.match(q.data.text, /no AI model/);
  });

  it('chat: searches records under the caller’s scope and cites them', async () => {
    const w = world;
    const sup = await loggedIn(app.base, 'supA1x');
    const made = await sup.post('/api/observations', observationInput(w, { likelihood: 4, severity: 5 }));
    assert.equal(made.status, 201);
    const c = await loggedIn(app.base, 'engA1');
    const r = await c.post('/api/ai/chat?stream=0', { message: 'Show open high risk work at height items' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.match(r.data.text, /matching record/);
    assert.ok(r.data.citations.some((x: { refNo: string }) => x.refNo === made.data.refNo), 'cites the record it found');
    const other = await loggedIn(app.base, 'engB');
    const r2 = await other.post('/api/ai/chat?stream=0', { message: 'Show open high risk work at height items' });
    assert.ok(!r2.data.citations.some((x: { refNo: string }) => x.refNo === made.data.refNo), 'another organisation never sees it');
  });

  it('studio: generates a valid draft that still needs human review', async () => {
    const c = await loggedIn(app.base, 'engA1');
    const g = await c.post('/api/studio/generate', { kind: 'document', documentType: 'method_statement', brief: 'Tower crane lifting of rebar cages at podium' });
    assert.equal(g.status, 201, JSON.stringify(g.data));
    assert.equal(g.data.item.status, 'draft');
    assert.ok(g.data.item.content.riskTable.length > 0);
    assert.match(g.data.meta.disclaimer, /no AI model/);
  });

  it('studio review: reads text documents, refuses PDFs it cannot read', async () => {
    const c = await loggedIn(app.base, 'engA1');
    const up = await c.req('POST', '/api/studio/sources?filename=ra.txt', Buffer.from('Risk assessment for hot work. Hazards: fire. Controls: permit, fire watch. Emergency: extinguisher and assembly point. Responsibilities: supervisor.'), { 'content-type': 'application/octet-stream' });
    assert.equal(up.status, 201);
    const rv = await c.post('/api/studio/generate', { kind: 'review', sourceId: up.data.id, brief: 'Review this' });
    assert.equal(rv.status, 201, JSON.stringify(rv.data));
    const pdf = await c.req('POST', '/api/studio/sources?filename=x.pdf', Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n'), { 'content-type': 'application/octet-stream' });
    const rp = await c.post('/api/studio/generate', { kind: 'review', sourceId: pdf.data.id, brief: 'Review this' });
    assert.equal(rp.status, 422); assert.equal(rp.data.error.code, 'ai_local_unsupported');
  });
});

describe('OpenAI-compatible adapter (self-hosted models such as Ollama)', () => {
  const body: MessagesRequest = {
    model: 'x', max_tokens: 500, system: [{ type: 'text', text: 'SYS' }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'How many open items?' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 't1', name: 'hse_statistics', input: { days: 30 } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"openNow":3}' }] },
    ],
    tools: [{ name: 'hse_statistics', description: 'd', input_schema: { type: 'object', properties: {} } }],
    tool_choice: { type: 'tool', name: 'hse_statistics' },
  };

  it('translates messages, tool calls, tool results and forced tool choice', () => {
    const out = toChatCompletions(body, 'llama3.1') as any;
    assert.equal(out.messages[0].role, 'system');
    assert.equal(out.messages[2].tool_calls[0].function.name, 'hse_statistics');
    assert.deepEqual(out.messages[3], { role: 'tool', tool_call_id: 't1', content: '{"openNow":3}' });
    assert.deepEqual(out.tool_choice, { type: 'function', function: { name: 'hse_statistics' } });
    assert.equal(toChatCompletions({ ...body, tool_choice: { type: 'none' } }, 'm').tools, undefined);
  });

  it('parses plain replies and tool calls, and never forwards upstream error bodies', async () => {
    let seen: any;
    const ok = new OpenAiCompatibleBackend({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.1', timeoutMs: 5000, fetchImpl: (async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ model: 'llama3.1', choices: [{ message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'emit_poster', arguments: '{"headline":"Hi"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    }) as typeof fetch });
    const r = await ok.send(body);
    assert.equal(seen.url, 'http://127.0.0.1:11434/v1/chat/completions');
    assert.equal(r.stopReason, 'tool_use');
    assert.deepEqual(r.content[0], { type: 'tool_use', id: 'c1', name: 'emit_poster', input: { headline: 'Hi' } });
    const bad = new OpenAiCompatibleBackend({ baseUrl: 'http://x/v1', model: 'm', timeoutMs: 5000, maxRetries: 0, fetchImpl: (async () => new Response('secret upstream detail', { status: 404 })) as unknown as typeof fetch });
    await assert.rejects(bad.send(body), (e: Error & { code?: string }) => e.code === 'ai_model_missing' && !e.message.includes('secret'));
  });

  it('streams text deltas and assembles streamed tool calls', async () => {
    const sse = [
      { choices: [{ delta: { content: 'Open ' } }] }, { choices: [{ delta: { content: 'items: 3' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c9', function: { name: 'search_observations', arguments: '{"query":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"edge"}' } }] }, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 20, completion_tokens: 8 } },
    ].map((d) => `data: ${JSON.stringify(d)}\n\n`).join('') + 'data: [DONE]\n\n';
    const b = new OpenAiCompatibleBackend({ baseUrl: 'http://x/v1', model: 'm', timeoutMs: 5000, fetchImpl: (async () => new Response(sse, { status: 200 })) as unknown as typeof fetch });
    let streamed = '';
    const r = await b.stream(body, (t) => { streamed += t; });
    assert.equal(streamed, 'Open items: 3');
    assert.deepEqual(r.content[1], { type: 'tool_use', id: 'c9', name: 'search_observations', input: { query: 'edge' } });
    assert.equal(r.usage.input_tokens, 20);
  });
});
