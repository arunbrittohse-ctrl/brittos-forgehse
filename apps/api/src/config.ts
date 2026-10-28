import { z } from 'zod';

/**
 * All runtime configuration comes from environment variables (12-factor).
 * Secrets (DATABASE_URL password, ANTHROPIC_API_KEY) are never logged or returned by the API.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** Comma-separated list of browser origins allowed to call the API with credentials. */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /** Set true when served over HTTPS (production) so cookies get the Secure flag. */
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SESSION_TTL_HOURS_WEB: z.coerce.number().int().min(1).max(24 * 30).default(12),
  SESSION_TTL_HOURS_MOBILE: z.coerce.number().int().min(1).max(24 * 90).default(24 * 14),
  STORAGE_DIR: z.string().default('./storage'),
  /** 'disk' (STORAGE_DIR) or 'postgres' (object_store table, for serverless hosts). */
  STORAGE_DRIVER: z.enum(['disk', 'postgres']).default('disk'),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(50).default(15),
  /** Largest file accepted by the document & evidence library. */
  LIBRARY_MAX_UPLOAD_MB: z.coerce.number().min(1).max(50).default(25),
  /** Serve the built web app from this directory (optional, single-container deploys). */
  WEB_DIST_DIR: z.string().optional(),
  /**
   * Which AI backend answers. 'auto' (default): Claude when ANTHROPIC_API_KEY is set, otherwise the
   * free local rules engine. 'local': rules engine only (no model, no cost). 'openai_compatible':
   * a self-hosted open model such as Ollama (LOCAL_AI_BASE_URL + LOCAL_AI_MODEL). 'off': AI disabled.
   */
  AI_PROVIDER: z.enum(['auto', 'anthropic', 'local', 'openai_compatible', 'off']).default('auto'),
  LOCAL_AI_BASE_URL: z.string().url().optional(),
  LOCAL_AI_MODEL: z.string().optional(),
  LOCAL_AI_API_KEY: z.string().optional(),
  LOCAL_AI_TIMEOUT_MS: z.coerce.number().int().min(5000).max(600000).default(180000),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),
  CLAUDE_MODEL: z.string().default('claude-sonnet-5-5'),
  CLAUDE_MAX_TOKENS: z.coerce.number().int().min(256).max(16000).default(2000),
  CLAUDE_TIMEOUT_MS: z.coerce.number().int().min(5000).max(300000).default(60000),
  /** '5m' (default ephemeral) or '1h'. Only switch to 1h when measured reuse justifies the higher write cost. */
  CLAUDE_CACHE_TTL: z.enum(['5m', '1h']).default('5m'),
  AI_PRICING_FILE: z.string().optional(),
  AI_RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).default(60),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in production (serve the app over HTTPS).');
  }
  if (parsed.data.NODE_ENV === 'production' && /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(parsed.data.ANTHROPIC_BASE_URL)) {
    throw new Error('ANTHROPIC_BASE_URL points at a local address in production. The local mock AI server is for development and tests only.');
  }
  if (parsed.data.AI_PROVIDER === 'openai_compatible' && (!parsed.data.LOCAL_AI_BASE_URL || !parsed.data.LOCAL_AI_MODEL)) {
    throw new Error('AI_PROVIDER=openai_compatible needs LOCAL_AI_BASE_URL (e.g. http://127.0.0.1:11434/v1 for Ollama) and LOCAL_AI_MODEL.');
  }
  if (parsed.data.AI_PROVIDER === 'anthropic' && !parsed.data.ANTHROPIC_API_KEY) {
    throw new Error('AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY. Use AI_PROVIDER=local for the free rules engine.');
  }
  return parsed.data;
}
