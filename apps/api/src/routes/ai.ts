import { z } from 'zod';
import { aiRequestSchema, can, OBSERVATION_TYPES, type AiTask } from '@forgehse/shared';
import type { Deps } from '../app';
import type { Router } from '../http/core';
import { forbidden, badRequest } from '../http/core';
import { requireAuth, requirePermission, hasAnywhere, scopeFilter, type AuthContext } from '../auth/session';
import { buildUserMessage } from '../ai/prompts';
import { extractJson, AiError, type ClaudeCallResult } from '../ai/claude';
import { getObservation } from '../services/observations';
import { orgSettings } from '../services/org';

const draftSchema = z.object({
  type: z.enum(OBSERVATION_TYPES),
  hazardCategory: z.string(),
  location: z.string().default(''),
  activity: z.string().default(''),
  description: z.string(),
  immediateAction: z.string().default(''),
  likelihood: z.number().int(),
  severity: z.number().int(),
  ratingRationale: z.string().default(''),
  suggestedCorrectiveAction: z.string().default(''),
  missingInformation: z.array(z.string()).default([]),
});
const actionItem = z.object({ action: z.string(), controlLevel: z.string(), responsibleRole: z.string().default(''), verificationEvidence: z.string().default('') });
const capaSchema = z.object({
  correctiveActions: z.array(actionItem).default([]),
  preventiveActions: z.array(actionItem).default([]),
  likelyRootCauses: z.array(z.string()).default([]),
  cautions: z.array(z.string()).default([]),
});

export function registerAiRoutes(r: Router, { db, ai, limiters, log }: Deps) {
  async function record(auth: AuthContext, feature: AiTask, result: ClaudeCallResult | null, err?: AiError) {
    // Telemetry: token counts and metadata only — never prompt or response text.
    try {
      await db.query(
        `INSERT INTO ai_usage (organization_id, user_id, feature, model, input_tokens, cache_creation_input_tokens, cache_creation_5m_tokens, cache_creation_1h_tokens,
                               cache_read_input_tokens, output_tokens, cache_status, stable_prefix_tokens_est, latency_ms, estimated_cost_usd, uncached_cost_usd,
                               pricing_version, stop_reason, error_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [auth.organizationId, auth.userId, feature, result?.model ?? ai.model, result?.usage.input_tokens ?? 0, result?.usage.cache_creation_input_tokens ?? 0,
          result?.cost.cacheWrite5m ?? 0, result?.cost.cacheWrite1h ?? 0, result?.usage.cache_read_input_tokens ?? 0, result?.usage.output_tokens ?? 0,
          result?.cacheStatus ?? 'error', result?.stablePrefixTokensEst ?? 0, result?.latencyMs ?? 0, result?.cost.estimatedUsd ?? null, result?.cost.uncachedUsd ?? null,
          ai.pricing.version, result?.stopReason ?? null, err?.code ?? null]);
    } catch (e) {
      log.error({ msg: 'ai_usage_record_failed', err: (e as Error).message });
    }
  }

  r.get('/api/ai/status', async (ctx) => {
    requireAuth(ctx);
    return { json: { configured: ai.configured, model: ai.model, provider: ai.provider } };
  });

  r.post('/api/ai/assist', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = await ctx.json(aiRequestSchema);
    if (!hasAnywhere(auth, 'ai.use')) throw forbidden();
    limiters.ai.check(`ai:${auth.userId}`);

    const settings = await orgSettings(db, auth.organizationId);
    const org = (await db.query<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [auth.organizationId])).rows[0]!;
    let projectLabel: string | undefined;
    let records: unknown;

    // Authorise every record before it is placed in the model request.
    if (body.projectId) {
      requirePermission(auth, 'ai.use', { projectId: body.projectId });
      const p = (await db.query<{ code: string; name: string }>('SELECT code, name FROM projects WHERE id = $1 AND organization_id = $2', [body.projectId, auth.organizationId])).rows[0];
      if (!p) throw badRequest('Unknown project');
      projectLabel = `${p.code} — ${p.name}`;
    }

    if (body.task === 'suggest_capa') {
      if (!body.observationId) throw badRequest('observationId is required for suggest_capa');
      const o = await getObservation(db, auth, body.observationId);
      if (!can(auth.assignments, 'ai.use', { organizationId: auth.organizationId, projectId: o.projectId, siteId: o.siteId })) throw forbidden();
      projectLabel = `${o.projectCode} — ${o.projectName}`;
      records = {
        observation: {
          refNo: o.refNo, type: o.type, hazardCategory: o.hazardCategory, location: o.location, activity: o.activity,
          description: o.description, immediateAction: o.immediateAction, riskScore: o.riskScore, riskBand: o.riskBand,
          status: o.status, correctiveActionRequired: o.correctiveAction, actionTaken: o.actionTaken,
        },
      };
    }

    if (body.task === 'summarize_observations') {
      const params: unknown[] = [];
      const where = [scopeFilter(auth, 'observation.view', params, { org: 'o.organization_id', project: 'o.project_id', site: 'o.site_id' })];
      if (body.projectId) { params.push(body.projectId); where.push(`o.project_id = $${params.length}`); }
      where.push("o.observed_at >= now() - interval '30 days'", "o.status <> 'cancelled'");
      const W = where.join(' AND ');
      const [stats, sample] = await Promise.all([
        db.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE o.type='unsafe_act')::int AS "unsafeActs",
                         count(*) FILTER (WHERE o.type='unsafe_condition')::int AS "unsafeConditions",
                         count(*) FILTER (WHERE o.status IN ('open','assigned','action_submitted'))::int AS "stillOpen",
                         count(*) FILTER (WHERE o.status='assigned' AND o.due_date < current_date)::int AS overdue,
                         count(*) FILTER (WHERE o.risk_band IN ('high','critical'))::int AS "highOrCritical" 
                    FROM observations o WHERE ${W}`, params),
        db.query(`SELECT o.ref_no AS "refNo", o.type, o.hazard_category AS "hazardCategory", o.risk_band AS "riskBand", o.status,
                         left(o.description, 300) AS description, o.due_date AS "dueDate"
                    FROM observations o WHERE ${W} ORDER BY o.risk_score DESC, o.observed_at DESC LIMIT 40`, params),
      ]);
      const byCat = await db.query(`SELECT o.hazard_category AS category, count(*)::int AS n FROM observations o WHERE ${W} GROUP BY 1 ORDER BY 2 DESC`, params);
      records = { period: 'last 30 days', statistics: stats.rows[0], byHazardCategory: byCat.rows, highestRiskRecords: sample.rows };
    }

    const message = buildUserMessage(body.task, body.input, {
      organizationName: org.name, projectLabel, timezone: settings.timezone,
      hazardCategories: settings.hazardCategories, riskMatrix: settings.riskMatrix, records,
    });

    let result: ClaudeCallResult;
    try {
      result = await ai.complete(message);
    } catch (e) {
      if (e instanceof AiError) {
        if (e.code !== 'ai_not_configured') await record(auth, body.task, null, e);
        log.warn({ msg: 'ai_call_failed', code: e.code, upstreamStatus: e.upstreamStatus });
      }
      throw e;
    }
    await record(auth, body.task, result);

    const meta = { model: result.model, provider: ai.provider.id, providerLabel: ai.provider.label, cacheStatus: result.cacheStatus, disclaimer: ai.provider.deterministic ? 'Rules-based draft from the FORGEHSE local library (no AI model). Review and verify before use; it has not been saved or approved.' : 'AI-generated draft. Review and verify before use; it has not been saved or approved.' };
    if (body.task === 'draft_observation') {
      const parsed = draftSchema.safeParse(extractJson(result.text));
      if (!parsed.success) throw new AiError(502, 'ai_bad_output', 'The AI reply was incomplete. Please try again.');
      const d = parsed.data;
      const clamp = (n: number) => Math.min(settings.riskMatrix.size, Math.max(1, n));
      const draft = {
        ...d,
        hazardCategory: settings.hazardCategories.includes(d.hazardCategory) ? d.hazardCategory : 'Other',
        likelihood: clamp(d.likelihood), severity: clamp(d.severity),
      };
      return { json: { kind: 'observation_draft', draft, ...meta } };
    }
    if (body.task === 'suggest_capa') {
      const parsed = capaSchema.safeParse(extractJson(result.text));
      if (!parsed.success) throw new AiError(502, 'ai_bad_output', 'The AI reply was incomplete. Please try again.');
      return { json: { kind: 'capa_suggestions', suggestions: parsed.data, ...meta } };
    }
    return { json: { kind: 'markdown', text: result.text, truncated: result.stopReason === 'max_tokens', ...meta } };
  });

  r.get('/api/ai/usage', async (ctx) => {
    const auth = requireAuth(ctx);
    requirePermission(auth, 'ai.usage.view');
    const days = z.coerce.number().int().min(1).max(365).default(30).parse(ctx.query.days);
    const P = [auth.organizationId, days];
    const W = "organization_id = $1 AND created_at >= now() - make_interval(days => $2)";
    const [totals, byFeature, byDay, recent] = await Promise.all([
      db.query<Record<string, number | null>>(`SELECT count(*)::int AS requests,
          count(*) FILTER (WHERE cache_status = 'error')::int AS errors,
          count(*) FILTER (WHERE cache_status = 'hit')::int AS "cacheHits",
          count(*) FILTER (WHERE cache_status = 'write')::int AS "cacheWrites",
          count(*) FILTER (WHERE cache_status = 'miss')::int AS "cacheMisses",
          count(*) FILTER (WHERE cache_status = 'not_requested')::int AS "cacheNotRequested",
          coalesce(sum(input_tokens),0)::bigint AS "inputTokens", coalesce(sum(output_tokens),0)::bigint AS "outputTokens",
          coalesce(sum(cache_read_input_tokens),0)::bigint AS "cacheReadTokens", coalesce(sum(cache_creation_input_tokens),0)::bigint AS "cacheCreationTokens",
          round(avg(latency_ms) FILTER (WHERE cache_status <> 'error'))::int AS "avgLatencyMs",
          round(avg(latency_ms) FILTER (WHERE cache_status = 'hit'))::int AS "avgLatencyHitMs",
          round(avg(latency_ms) FILTER (WHERE cache_status IN ('write','miss','not_requested')))::int AS "avgLatencyNoHitMs",
          sum(estimated_cost_usd)::float AS "estimatedCostUsd", sum(uncached_cost_usd)::float AS "uncachedCostUsd",
          count(*) FILTER (WHERE estimated_cost_usd IS NULL AND cache_status <> 'error')::int AS "unpricedRequests"
        FROM ai_usage WHERE ${W}`, P),
      db.query(`SELECT feature, count(*)::int AS requests, coalesce(sum(input_tokens + cache_read_input_tokens + cache_creation_input_tokens),0)::bigint AS "totalInputTokens",
                       coalesce(sum(output_tokens),0)::bigint AS "outputTokens", sum(estimated_cost_usd)::float AS "estimatedCostUsd"
                  FROM ai_usage WHERE ${W} GROUP BY feature ORDER BY 2 DESC`, P),
      db.query(`SELECT created_at::date::text AS day, count(*)::int AS requests, count(*) FILTER (WHERE cache_status='hit')::int AS hits,
                       coalesce(sum(cache_read_input_tokens),0)::bigint AS "cacheReadTokens", sum(estimated_cost_usd)::float AS "estimatedCostUsd"
                  FROM ai_usage WHERE ${W} GROUP BY 1 ORDER BY 1`, P),
      db.query(`SELECT a.created_at AS "createdAt", a.feature, a.model, a.cache_status AS "cacheStatus", a.input_tokens AS "inputTokens",
                       a.cache_read_input_tokens AS "cacheReadTokens", a.cache_creation_input_tokens AS "cacheCreationTokens",
                       a.output_tokens AS "outputTokens", a.latency_ms AS "latencyMs", a.estimated_cost_usd::float AS "estimatedCostUsd", a.error_code AS "errorCode"
                  FROM ai_usage a WHERE ${W.replace(/organization_id|created_at/g, (m) => 'a.' + m)} ORDER BY a.id DESC LIMIT 25`, P),
    ]);
    const t = totals.rows[0]!;
    const cacheEligible = Number(t.cacheHits) + Number(t.cacheWrites) + Number(t.cacheMisses);
    const allInput = Number(t.inputTokens) + Number(t.cacheReadTokens) + Number(t.cacheCreationTokens);
    return {
      json: {
        days,
        model: ai.model,
        cacheTtl: ai.cacheTtl,
        totals: {
          ...t,
          cacheHitRate: cacheEligible ? Math.round((Number(t.cacheHits) / cacheEligible) * 1000) / 10 : null,
          cachedInputShare: allInput ? Math.round((Number(t.cacheReadTokens) / allInput) * 1000) / 10 : null,
          estimatedSavingsUsd: t.uncachedCostUsd != null && t.estimatedCostUsd != null ? Math.round((Number(t.uncachedCostUsd) - Number(t.estimatedCostUsd)) * 1e6) / 1e6 : null,
        },
        byFeature: byFeature.rows,
        byDay: byDay.rows,
        recent: recent.rows,
        pricing: { version: ai.pricing.version, verified: ai.pricing.verified, source: ai.pricing.source },
        note: 'Costs are estimates calculated from recorded token counts and the configured price table — not billing data. Check the Anthropic Console for invoiced amounts.',
      },
    };
  });
}
