/**
 * AI Studio chat: a streaming HSE co-pilot grounded in the caller's own records.
 *
 *   POST /api/ai/chat            → text/event-stream (meta, delta, tool, action, done | error)
 *   POST /api/ai/chat?stream=0   → JSON (mobile clients without streaming fetch)
 *   GET  /api/ai/conversations   → the caller's conversations
 *   GET  /api/ai/conversations/:id, DELETE /api/ai/conversations/:id
 *
 * The model can search records and compute statistics through tools that run with the
 * caller's permissions, and can *propose* Studio drafts or observation reports — the user
 * always reviews and submits those themselves.
 */
import { z } from 'zod';
import type { Deps } from '../app';
import type { Router, SseSend } from '../http/core';
import { forbidden, notFound, badRequest } from '../http/core';
import { requireAuth, requireProjectReach, hasAnywhere, type AuthContext } from '../auth/session';
import { orgSettings } from '../services/org';
import { buildContextBlock } from '../ai/prompts';
import { AiError, NOT_CONFIGURED, type ClaudeCallResult, type ContentBlock, type MessageParam, type ToolResultBlock } from '../ai/claude';
import { CHAT_TOOLS, searchObservations, hseStatistics, studioDraftInput, observationDraftInput, type Citation } from '../ai/tools';
import { recordUsage } from '../ai/usage';

const chatSchema = z.object({
  conversationId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(8000),
});

const MAX_TOOL_ROUNDS = 4;
const HISTORY_MESSAGES = 16;

type ChatAction =
  | { type: 'generate'; kind: 'checklist' | 'document' | 'poster' | 'flowchart'; brief: string; documentType?: string }
  | { type: 'draft_observation'; notes: string };

export function registerChatRoutes(r: Router, { db, ai, limiters, log }: Deps) {
  async function context(auth: AuthContext, projectId: string | null) {
    const settings = await orgSettings(db, auth.organizationId);
    const org = (await db.query<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [auth.organizationId])).rows[0]!;
    let projectLabel: string | undefined;
    if (projectId) {
      const p = (await db.query<{ code: string; name: string }>('SELECT code, name FROM projects WHERE id = $1 AND organization_id = $2', [projectId, auth.organizationId])).rows[0];
      if (!p) throw badRequest('Unknown project');
      projectLabel = `${p.code} — ${p.name}`;
    }
    const today = (await db.query<{ d: string }>('SELECT (now() AT TIME ZONE $1)::date::text AS d', [settings.timezone])).rows[0]!.d;
    return buildContextBlock({
      organizationName: org.name, projectLabel, timezone: settings.timezone, hazardCategories: settings.hazardCategories,
      riskMatrix: settings.riskMatrix, userName: auth.fullName, today,
    });
  }

  r.post('/api/ai/chat', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = await ctx.json(chatSchema);
    if (!hasAnywhere(auth, 'ai.use')) throw forbidden();
    if (!ai.configured) throw new AiError(503, 'ai_not_configured', NOT_CONFIGURED);
    limiters.ai.check(`ai:${auth.userId}`);
    const streaming = ctx.query.stream !== '0';

    // Conversation: the caller's own only.
    let conv: { id: string; project_id: string | null };
    if (body.conversationId) {
      const c = (await db.query<{ id: string; project_id: string | null }>('SELECT id, project_id FROM ai_conversations WHERE id = $1 AND organization_id = $2 AND user_id = $3', [body.conversationId, auth.organizationId, auth.userId])).rows[0];
      if (!c) throw notFound('Conversation');
      conv = c;
    } else {
      const projectId = body.projectId ?? null;
      if (projectId) requireProjectReach(auth, 'ai.use', projectId);
      conv = (await db.query<{ id: string; project_id: string | null }>(
        'INSERT INTO ai_conversations (organization_id, user_id, project_id, title) VALUES ($1,$2,$3,$4) RETURNING id, project_id',
        [auth.organizationId, auth.userId, projectId, body.message.replace(/\s+/g, ' ').slice(0, 80)])).rows[0]!;
    }
    const dynamicSystem = await context(auth, conv.project_id);
    const history = (await db.query<{ role: 'user' | 'assistant'; content: string }>(
      `SELECT role, content FROM (SELECT id, role, content FROM ai_messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2) t ORDER BY id`,
      [conv.id, HISTORY_MESSAGES])).rows;
    await db.query('INSERT INTO ai_messages (conversation_id, role, content) VALUES ($1, $2, $3)', [conv.id, 'user', body.message]);

    const messages: MessageParam[] = history.map((m) => ({ role: m.role, content: [{ type: 'text', text: m.content }] }));
    // Incremental conversation caching: a breakpoint on the last earlier turn lets the next request reuse the whole history.
    const lastHist = messages[messages.length - 1]?.content[0];
    if (lastHist && lastHist.type === 'text' && messages.length >= 2) lastHist.cache_control = ai.cacheControl();
    messages.push({ role: 'user', content: [{ type: 'text', text: body.message }] });

    const run = async (send: SseSend, signal: AbortSignal) => {
      send('meta', { conversationId: conv.id });
      const citations = new Map<string, Citation>();
      const actions: ChatAction[] = [];
      let text = '';
      let last: ClaudeCallResult | null = null;
      const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const lastRound = round === MAX_TOOL_ROUNDS;
        // On the last round tools stay defined (history contains tool blocks) but may not be called: forces a textual answer.
        const prep = ai.prepare({ messages, dynamicSystem, tools: CHAT_TOOLS, toolChoice: lastRound ? { type: 'none' } : undefined });
        if (text && !text.endsWith('\n')) { text += '\n\n'; send('delta', { text: '\n\n' }); }
        let result: ClaudeCallResult;
        try {
          result = streaming
            ? await ai.stream(prep, (t) => { text += t; send('delta', { text: t }); }, signal)
            : await ai.send(prep, signal);
        } catch (e) {
          if (e instanceof AiError && e.code !== 'ai_cancelled') await recordUsage(db, log, ai, auth, 'chat', null, e);
          throw e;
        }
        if (!streaming) text += result.text;
        last = result;
        totals.input += result.usage.input_tokens; totals.output += result.usage.output_tokens;
        totals.cacheRead += result.usage.cache_read_input_tokens ?? 0; totals.cacheWrite += result.usage.cache_creation_input_tokens ?? 0;
        await recordUsage(db, log, ai, auth, 'chat', result);
        const uses = result.content.filter((c): c is Extract<ContentBlock, { type: 'tool_use' }> => c.type === 'tool_use');
        if (result.stopReason !== 'tool_use' || uses.length === 0) break;
        messages.push({ role: 'assistant', content: result.content });
        const results: ToolResultBlock[] = [];
        for (const u of uses) {
          send('tool', { id: u.id, name: u.name, status: 'running' });
          let out: unknown; let isError = false; let summary = '';
          try {
            if (u.name === 'search_observations') {
              const r2 = await searchObservations(db, auth, u.input, conv.project_id);
              r2.citations.forEach((c) => citations.set(c.refNo, c));
              out = r2.result; summary = `${r2.result.matched} record${r2.result.matched === 1 ? '' : 's'} found`;
            } else if (u.name === 'hse_statistics') {
              const r2 = await hseStatistics(db, auth, u.input, conv.project_id);
              out = r2.result; summary = `Statistics for ${r2.result.periodDays} days`;
            } else if (u.name === 'create_studio_draft') {
              const a = studioDraftInput.parse(u.input);
              const action: ChatAction = { type: 'generate', kind: a.kind, brief: a.brief, documentType: a.documentType };
              actions.push(action); send('action', action);
              out = { status: 'started', note: 'The Studio generator has started in the user’s interface. The draft must be reviewed before use. Briefly tell the user what is being prepared.' };
              summary = `Preparing ${a.kind}`;
            } else if (u.name === 'prepare_observation') {
              const a = observationDraftInput.parse(u.input);
              const action: ChatAction = { type: 'draft_observation', notes: a.notes };
              actions.push(action); send('action', action);
              out = { status: 'form_opened', note: 'A pre-filled report is ready for the user to review and submit. It has NOT been submitted.' };
              summary = 'Observation draft ready';
            } else { isError = true; out = { error: `Unknown tool ${u.name}` }; }
          } catch (e) {
            isError = true; out = { error: e instanceof z.ZodError ? 'Invalid tool input' : 'The tool failed' };
            log.warn({ msg: 'chat_tool_failed', tool: u.name, err: (e as Error).message });
          }
          send('tool', { id: u.id, name: u.name, status: isError ? 'error' : 'done', summary });
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out), is_error: isError || undefined });
        }
        messages.push({ role: 'user', content: results });
      }
      text = text.trim();
      if (!text) text = actions.length ? 'Your draft is being prepared below — review it before use.' : 'I could not produce an answer. Please rephrase and try again.';
      const cited = [...citations.values()].map((c) => ({ ...c, cited: text.includes(`[${c.refNo}]`) || text.includes(c.refNo) }));
      const msg = (await db.query<{ id: string }>('INSERT INTO ai_messages (conversation_id, role, content, citations, actions) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [conv.id, 'assistant', text, JSON.stringify(cited), JSON.stringify(actions)])).rows[0]!;
      await db.query('UPDATE ai_conversations SET updated_at = now() WHERE id = $1', [conv.id]);
      send('done', {
        messageId: msg.id, citations: cited, truncated: last?.stopReason === 'max_tokens', cacheStatus: last?.cacheStatus, model: last?.model, provider: ai.provider.id, providerLabel: ai.provider.label,
        usage: totals, disclaimer: ai.provider.deterministic ? 'Rules-based reply from the FORGEHSE local library (no AI model). Figures come from your records; nothing has been saved, approved or submitted on your behalf.' : 'AI-generated. Verify before relying on it; nothing has been saved, approved or submitted on your behalf.',
      });
      return { text, citations: cited, actions };
    };

    if (streaming) return { sse: async (send, signal) => { await run(send, signal); } };
    const events: { event: string; data: unknown }[] = [];
    const ac = new AbortController();
    const out = await run((event, data) => { if (event !== 'delta') events.push({ event, data }); }, ac.signal);
    const done = events.find((e) => e.event === 'done')?.data as Record<string, unknown>;
    return { json: { conversationId: conv.id, ...out, ...done } };
  });

  r.get('/api/ai/conversations', async (ctx) => {
    const auth = requireAuth(ctx);
    if (!hasAnywhere(auth, 'ai.use')) throw forbidden();
    const rows = await db.query(`SELECT c.id, c.title, c.project_id AS "projectId", c.updated_at AS "updatedAt",
                                        (SELECT count(*)::int FROM ai_messages m WHERE m.conversation_id = c.id) AS messages
                                   FROM ai_conversations c WHERE c.organization_id = $1 AND c.user_id = $2 ORDER BY c.updated_at DESC LIMIT 50`, [auth.organizationId, auth.userId]);
    return { json: { items: rows.rows } };
  });

  r.get('/api/ai/conversations/:id', async (ctx) => {
    const auth = requireAuth(ctx);
    const c = (await db.query('SELECT id, title, project_id AS "projectId", updated_at AS "updatedAt" FROM ai_conversations WHERE id = $1 AND organization_id = $2 AND user_id = $3', [ctx.params.id, auth.organizationId, auth.userId])).rows[0];
    if (!c) throw notFound('Conversation');
    const m = await db.query('SELECT id, role, content, citations, actions, created_at AS "createdAt" FROM ai_messages WHERE conversation_id = $1 ORDER BY id', [ctx.params.id]);
    return { json: { conversation: c, messages: m.rows } };
  });

  r.delete('/api/ai/conversations/:id', async (ctx) => {
    const auth = requireAuth(ctx);
    const d = await db.query('DELETE FROM ai_conversations WHERE id = $1 AND organization_id = $2 AND user_id = $3', [ctx.params.id, auth.organizationId, auth.userId]);
    if (!d.rowCount) throw notFound('Conversation');
    return { status: 204 };
  });
}
