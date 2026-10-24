import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * Model pricing used ONLY to estimate costs on the admin AI-usage dashboard.
 * Estimates are never presented as billing data.
 *
 * IMPORTANT: The defaults below could not be verified against Anthropic's official pricing
 * page from the build environment (the docs domain was blocked). They were taken from
 * secondary sources on 2026-10-23 and are flagged `verified: false`. Before relying on cost
 * figures, copy config/ai-pricing.example.json, confirm every number against
 * https://platform.claude.com/docs/en/about-claude/pricing, set "verified": true, and point
 * AI_PRICING_FILE at it.
 */
const tierSchema = z.object({
  inputPerMTok: z.number().nonnegative(),
  outputPerMTok: z.number().nonnegative(),
  cacheWrite5mPerMTok: z.number().nonnegative(),
  cacheWrite1hPerMTok: z.number().nonnegative(),
  cacheReadPerMTok: z.number().nonnegative(),
});
const modelSchema = tierSchema.extend({
  /** Minimum prompt-prefix length the model will cache. Below this, cache_control is skipped. */
  minCacheableTokens: z.number().int().positive(),
  /** Optional higher-priced tier when a request's total input exceeds a threshold. */
  longContext: tierSchema.extend({ thresholdTokens: z.number().int().positive() }).optional(),
});
export const pricingSchema = z.object({
  version: z.string(),
  verified: z.boolean(),
  source: z.string(),
  currency: z.literal('USD'),
  models: z.record(modelSchema),
});
export type Pricing = z.infer<typeof pricingSchema>;
export type ModelPricing = z.infer<typeof modelSchema>;

export const DEFAULT_PRICING: Pricing = {
  version: '2026-10-23-unverified',
  verified: false,
  source: 'Secondary sources (not the official pricing page). Verify before use.',
  currency: 'USD',
  models: {
    'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10, cacheWrite5mPerMTok: 2.5, cacheWrite1hPerMTok: 4, cacheReadPerMTok: 0.1, minCacheableTokens: 1024 },
    'claude-opus-5-5': { inputPerMTok: 4, outputPerMTok: 20, cacheWrite5mPerMTok: 5, cacheWrite1hPerMTok: 8, cacheReadPerMTok: 0.4, minCacheableTokens: 1024 },
    'claude-haiku-5-5': {
      inputPerMTok: 0.1, outputPerMTok: 0.5, cacheWrite5mPerMTok: 0.125, cacheWrite1hPerMTok: 0.2, cacheReadPerMTok: 0.01, minCacheableTokens: 1024,
      longContext: { thresholdTokens: 100_000, inputPerMTok: 0.5, outputPerMTok: 2.5, cacheWrite5mPerMTok: 0.625, cacheWrite1hPerMTok: 1, cacheReadPerMTok: 0.05 },
    },
  },
};

export function loadPricing(file?: string): Pricing {
  if (!file) return DEFAULT_PRICING;
  return pricingSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null;
}

export interface CostBreakdown {
  estimatedUsd: number | null;
  uncachedUsd: number | null;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

/**
 * cost = input×in + write5m×w5 + write1h×w1 + read×r + output×out (per million tokens)
 * uncached = (input + all cache writes + reads)×in + output×out — the same request with no caching.
 * When the API does not split cache writes by TTL, all writes are charged at the configured TTL's rate.
 */
export function estimateCost(pricing: Pricing, model: string, u: Usage, ttl: '5m' | '1h'): CostBreakdown {
  const created = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  let w5 = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  let w1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  if (w5 + w1 === 0 && created > 0) { if (ttl === '1h') w1 = created; else w5 = created; }
  const m = pricing.models[model];
  if (!m) return { estimatedUsd: null, uncachedUsd: null, cacheWrite5m: w5, cacheWrite1h: w1 };
  const totalIn = u.input_tokens + created + read;
  const p = m.longContext && totalIn > m.longContext.thresholdTokens ? m.longContext : m;
  const per = (tokens: number, rate: number) => (tokens * rate) / 1_000_000;
  const est = per(u.input_tokens, p.inputPerMTok) + per(w5, p.cacheWrite5mPerMTok) + per(w1, p.cacheWrite1hPerMTok) + per(read, p.cacheReadPerMTok) + per(u.output_tokens, p.outputPerMTok);
  const unc = per(totalIn, p.inputPerMTok) + per(u.output_tokens, p.outputPerMTok);
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return { estimatedUsd: round(est), uncachedUsd: round(unc), cacheWrite5m: w5, cacheWrite1h: w1 };
}
