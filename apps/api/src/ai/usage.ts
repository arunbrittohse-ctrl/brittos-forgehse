import type { Db } from '../db/db';
import type { Logger } from '../http/core';
import type { AuthContext } from '../auth/session';
import type { ClaudeService, ClaudeCallResult, AiError } from './claude';

/** Telemetry: token counts and metadata only — never prompt or response text. */
export async function recordUsage(db: Db, log: Logger, ai: ClaudeService, auth: AuthContext, feature: string, result: ClaudeCallResult | null, err?: AiError) {
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
