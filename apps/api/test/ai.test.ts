import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, startApp, seedWorld, loggedIn, observationInput, type TestApp, type World, type Client } from './helpers';
import { ClaudeService, type ClaudeRequestBody } from '../src/ai/claude';
import { STABLE_SYSTEM_PROMPT, estimateTokens, buildUserMessage } from '../src/ai/prompts';
import { DEFAULT_PRICING, estimateCost, pricingSchema } from '../src/ai/pricing';

interface Captured { url: string; headers: Record<string, string>; body: ClaudeRequestBody }

function fakeAnthropic(responder: (body: ClaudeRequestBody, n: number) => { status?: number; json?: unknown; headers?: Record<string, string>; delayMs?: number }) {
  const calls: Captured[] = [];
  const impl = async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as ClaudeRequestBody;
    calls.push({ url, headers: init.headers as Record<string, string>, body });
    const r = responder(body, calls.length);
    if (r.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, r.delayMs);
        init.signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
      });
    }
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } });
  };
  return { calls, impl };
}

const reply = (text: string, usage: Record<string, number>) => ({
  json: { id: 'msg_test', model: 'claude-sonnet-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { output_tokens: 120, ...usage } },
});

const DRAFT = JSON.stringify({
  type: 'unsafe_condition', hazardCategory: 'Work at height', location: 'L3 east edge', activity: 'Formwork',
  description: 'Edge protection missing along 6 m of slab edge.', immediateAction: '', likelihood: 4, severity: 9,
  ratingRationale: 'Open edge with workers nearby', suggestedCorrectiveAction: 'Install guardrail', missingInformation: ['Time observed'],
});

describe('Claude service: prompt structure and caching (unit)', () => {
  it('stable prefix is long enough to cache and carries a single cache breakpoint on the system block', () => {
    const svc = new ClaudeService({ apiKey: 'k', baseUrl: 'x', model: 'claude-sonnet-5-5', maxTokens: 100, timeoutMs: 1000, cacheTtl: '5m', pricing: DEFAULT_PRICING });
    const { body, cacheRequested, stablePrefixTokensEst } = svc.buildRequest('TASK: ask\nhello');
    assert.ok(stablePrefixTokensEst >= 1024, `stable prefix only ~${stablePrefixTokensEst} tokens`);
    assert.equal(cacheRequested, true);
    assert.deepEqual(body.system[0]!.cache_control, { type: 'ephemeral' });
    assert.equal(body.system.length, 1);
    assert.equal(JSON.stringify(body.messages).includes('cache_control'), false, 'dynamic suffix is never cached');
  });

  it('uses the 1-hour TTL only when configured', () => {
    const svc = new ClaudeService({ apiKey: 'k', baseUrl: 'x', model: 'claude-sonnet-5-5', maxTokens: 100, timeoutMs: 1000, cacheTtl: '1h', pricing: DEFAULT_PRICING });
    assert.deepEqual(svc.buildRequest('x').body.system[0]!.cache_control, { type: 'ephemeral', ttl: '1h' });
  });

  it('skips cache_control when the prefix is below the model minimum (and for unknown models uses a conservative floor)', () => {
    const pricing = pricingSchema.parse({ ...DEFAULT_PRICING, models: { 'tiny-model': { ...DEFAULT_PRICING.models['claude-sonnet-5-5']!, minCacheableTokens: 100_000 } } });
    const small = new ClaudeService({ apiKey: 'k', baseUrl: 'x', model: 'tiny-model', maxTokens: 100, timeoutMs: 1000, cacheTtl: '5m', pricing });
    const r = small.buildRequest('x');
    assert.equal(r.cacheRequested, false);
    assert.equal(r.body.system[0]!.cache_control, undefined);
    const unknown = new ClaudeService({ apiKey: 'k', baseUrl: 'x', model: 'claude-future-9', maxTokens: 100, timeoutMs: 1000, cacheTtl: '5m', pricing: DEFAULT_PRICING });
    assert.equal(unknown.buildRequest('x').cacheRequested, estimateTokens(STABLE_SYSTEM_PROMPT) >= 4096);
  });

  it('keeps tenant data out of the shared stable prefix', () => {
    const msg = buildUserMessage('ask', 'question', { organizationName: 'Secret Org LLC', timezone: 'Asia/Dubai', hazardCategories: ['A'], riskMatrix: { size: 5, bands: [{ band: 'low', minScore: 1 }] }, records: { x: 'CONFIDENTIAL-RECORD' } });
    assert.ok(msg.includes('Secret Org LLC') && msg.includes('CONFIDENTIAL-RECORD'));
    assert.ok(!STABLE_SYSTEM_PROMPT.includes('Secret Org'));
    assert.ok(!/\$\{|organizationName|projectLabel/.test(STABLE_SYSTEM_PROMPT), 'no template interpolation in stable prefix');
  });

  it('estimates cost from actual usage fields, accounting for writes, reads and long-context tiers', () => {
    const write = estimateCost(DEFAULT_PRICING, 'claude-sonnet-5-5', { input_tokens: 500, cache_creation_input_tokens: 2000, cache_read_input_tokens: 0, output_tokens: 100 }, '5m');
    // 500×2 + 2000×2.5 + 100×10 = 7000 per 1M → 0.007
    assert.equal(write.estimatedUsd, 0.007);
    assert.equal(write.cacheWrite5m, 2000);
    const hit = estimateCost(DEFAULT_PRICING, 'claude-sonnet-5-5', { input_tokens: 500, cache_read_input_tokens: 2000, output_tokens: 100 }, '5m');
    // 500×2 + 2000×0.1 + 100×10 = 2200 → 0.0022 ; uncached = 2500×2 + 1000 = 6000 → 0.006
    assert.equal(hit.estimatedUsd, 0.0022);
    assert.equal(hit.uncachedUsd, 0.006);
    const split = estimateCost(DEFAULT_PRICING, 'claude-sonnet-5-5', { input_tokens: 0, cache_creation_input_tokens: 2000, cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 1000 }, output_tokens: 0 }, '5m');
    assert.equal(split.estimatedUsd, (1000 * 2.5 + 1000 * 4) / 1e6);
    const long = estimateCost(DEFAULT_PRICING, 'claude-haiku-5-5', { input_tokens: 150_000, output_tokens: 1000 }, '5m');
    assert.equal(long.estimatedUsd, (150_000 * 0.5 + 1000 * 2.5) / 1e6);
    assert.equal(estimateCost(DEFAULT_PRICING, 'unpriced', { input_tokens: 1, output_tokens: 1 }, '5m').estimatedUsd, null);
  });
});

describe('AI assistant API (integration, upstream faked)', () => {
  let w: World; let app: TestApp; let eng: Client; let engB: Client; let viewer: Client; let corp: Client;
  let fake: ReturnType<typeof fakeAnthropic>;
  let mode: 'write' | 'hit' | 'error429' | 'badjson' | 'slow' = 'write';

  before(async () => {
    const db = await freshDb(); w = await seedWorld(db);
    fake = fakeAnthropic(() => {
      if (mode === 'error429') return { status: 429, json: { error: { message: 'rate limited, internal detail' } }, headers: { 'retry-after': '0' } };
      if (mode === 'badjson') return reply('Sorry, I cannot help with that.', { input_tokens: 400 });
      if (mode === 'slow') return { ...reply(DRAFT, { input_tokens: 1 }), delayMs: 3000 };
      return mode === 'hit'
        ? reply(DRAFT, { input_tokens: 420, cache_read_input_tokens: 2500, cache_creation_input_tokens: 0 })
        : reply(DRAFT, { input_tokens: 420, cache_creation_input_tokens: 2500, cache_read_input_tokens: 0 });
    });
    app = await startApp(db, { apiKey: 'sk-test-not-real', fetchImpl: fake.impl, timeoutMs: 1000 });
    [eng, engB, viewer, corp] = await Promise.all(['engA1', 'engB', 'viewerA1', 'corpA'].map((k) => loggedIn(app.base, k))) as Record<number, Client> as Client[] & [Client, Client, Client, Client, Client, Client, Client, Client, Client];
    await eng.post('/api/observations', observationInput(w, { description: 'ORG-A-SECRET scaffold collapse risk' }));
    await engB.post('/api/observations', observationInput(w, { projectId: w.projB1, siteId: w.siteB1, description: 'ORG-B-SECRET trench issue' }));
  });
  after(async () => { await app.close(); await app.db.end(); });
  beforeEach(() => { mode = 'write'; fake.calls.length = 0; });

  it('returns a validated observation draft and never saves it', async () => {
    const before = await app.db.query<{ n: number }>('SELECT count(*)::int AS n FROM observations');
    const r = await eng.post('/api/ai/assist', { task: 'draft_observation', projectId: w.projA1, input: 'no edge protection L3 east, lads working nearby' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.kind, 'observation_draft');
    assert.equal(r.data.draft.severity, 5, 'clamped to matrix size');
    assert.match(r.data.disclaimer, /not been saved/);
    const afterCount = await app.db.query<{ n: number }>('SELECT count(*)::int AS n FROM observations');
    assert.equal(afterCount.rows[0]!.n, before.rows[0]!.n);
  });

  it('sends the key only from the server, with cache control on the stable prefix and tenant context in the user turn', async () => {
    await eng.post('/api/ai/assist', { task: 'ask', input: 'What should a hot work permit cover?' });
    const call = fake.calls[0]!;
    assert.equal(call.headers['x-api-key'], 'sk-test-not-real');
    assert.ok(call.url.endsWith('/v1/messages'));
    assert.deepEqual(call.body.system[0]!.cache_control, { type: 'ephemeral' });
    assert.equal(call.body.system[0]!.text, STABLE_SYSTEM_PROMPT);
    assert.ok((call.body.messages[0]!.content[0]! as { text: string }).text.includes('Organisation: org-a'));
  });

  it('records token usage and cache status from the API response, never prompt text', async () => {
    await eng.post('/api/ai/assist', { task: 'ask', input: 'first call writes the cache' });
    mode = 'hit';
    await eng.post('/api/ai/assist', { task: 'ask', input: 'second call reads it' });
    const rows = (await app.db.query<Record<string, unknown>>("SELECT cache_status, input_tokens, cache_read_input_tokens, cache_creation_input_tokens, estimated_cost_usd::float AS c, uncached_cost_usd::float AS u FROM ai_usage ORDER BY id DESC LIMIT 2")).rows;
    assert.equal(rows[0]!.cache_status, 'hit');
    assert.equal(rows[0]!.cache_read_input_tokens, 2500);
    assert.equal(rows[1]!.cache_status, 'write');
    assert.equal(rows[1]!.cache_creation_input_tokens, 2500);
    assert.ok((rows[0]!.c as number) < (rows[0]!.u as number), 'a cache hit is cheaper than the uncached estimate');
    const cols = (await app.db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_usage'")).rows.map((c) => c.column_name);
    assert.ok(!cols.some((c) => /prompt|text|content|message/.test(c)), 'no prompt/response content columns');
  });

  it('only sends records the caller is authorised to see (tenant isolation in summaries)', async () => {
    await eng.post('/api/ai/assist', { task: 'summarize_observations', input: 'Summarise' });
    const sent = (fake.calls[0]!.body.messages[0]!.content[0]! as { text: string }).text;
    assert.ok(sent.includes('ORG-A-SECRET'));
    assert.ok(!sent.includes('ORG-B-SECRET'));
    fake.calls.length = 0;
    await engB.post('/api/ai/assist', { task: 'summarize_observations', input: 'Summarise' });
    const sentB = (fake.calls[0]!.body.messages[0]!.content[0]! as { text: string }).text;
    assert.ok(sentB.includes('ORG-B-SECRET') && !sentB.includes('ORG-A-SECRET'));
  });

  it('refuses CAPA suggestions for observations outside the caller\'s scope', async () => {
    const theirs = (await app.db.query<{ id: string }>("SELECT id FROM observations WHERE organization_id = $1 LIMIT 1", [w.orgB])).rows[0]!.id;
    const r = await eng.post('/api/ai/assist', { task: 'suggest_capa', observationId: theirs, input: 'Suggest actions' });
    assert.equal(r.status, 404);
    assert.equal(fake.calls.length, 0, 'nothing was sent to the model');
  });

  it('denies AI use to roles without ai.use', async () => {
    assert.equal((await viewer.post('/api/ai/assist', { task: 'ask', input: 'hello there' })).status, 403);
  });

  it('maps upstream failures to safe errors without leaking upstream bodies', async () => {
    mode = 'error429';
    const r = await eng.post('/api/ai/assist', { task: 'ask', input: 'busy?' });
    assert.equal(r.status, 429);
    assert.ok(!JSON.stringify(r.data).includes('internal detail'));
    assert.equal(fake.calls.length, 2, 'retried once before giving up');
    mode = 'badjson';
    assert.equal((await eng.post('/api/ai/assist', { task: 'draft_observation', input: 'notes here' })).status, 502);
    mode = 'slow';
    assert.equal((await eng.post('/api/ai/assist', { task: 'ask', input: 'slow one' })).status, 504);
    // 429 and timeout are recorded as errors; the malformed reply still consumed tokens, so it is recorded as a completed call.
    const errs = await app.db.query<{ error_code: string }>("SELECT error_code FROM ai_usage WHERE cache_status = 'error' ORDER BY id");
    assert.deepEqual(errs.rows.map((r) => r.error_code), ['ai_rate_limited', 'ai_timeout']);
  });

  it('reports usage, cache hit rate and estimated (not billed) cost to admins only', async () => {
    assert.equal((await eng.get('/api/ai/usage')).status, 403);
    const r = await corp.get('/api/ai/usage?days=7');
    assert.equal(r.status, 200);
    assert.ok(r.data.totals.requests > 0);
    assert.ok(r.data.totals.cacheHitRate > 0);
    assert.equal(r.data.pricing.verified, false);
    assert.match(r.data.note, /not billing data/);
  });
});

describe('AI assistant when no API key is configured', () => {
  it('fails gracefully with 503', async () => {
    const db = await freshDb(); await seedWorld(db);
    const app = await startApp(db);
    const c = await loggedIn(app.base, 'engA1');
    const r = await c.post('/api/ai/assist', { task: 'ask', input: 'hello there' });
    assert.equal(r.status, 503);
    assert.equal(r.data.error.code, 'ai_not_configured');
    assert.equal((await c.get('/api/ai/status')).data.configured, false);
    await app.close(); await db.end();
  });
});
