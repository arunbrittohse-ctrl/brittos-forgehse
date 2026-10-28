import type { Config } from './config';
import type { Db } from './db/db';
import { Router, RateLimiter, createServer, createLogger, type Logger } from './http/core';
import { resolveAuth } from './auth/session';
import { LocalDiskStorage, PgStorage, type ObjectStorage } from './services/storage';
import { ClaudeService } from './ai/claude';
import { LocalRulesBackend } from './ai/providers/local/backend';
import { OpenAiCompatibleBackend } from './ai/providers/openai-compatible';
import type { AiBackend } from './ai/providers/types';
import { loadPricing } from './ai/pricing';
import { registerAuthRoutes } from './routes/auth';
import { registerAdminRoutes } from './routes/admin';
import { registerObservationRoutes } from './routes/observations';
import { registerDashboardRoutes } from './routes/dashboard';
import { registerAuditRoutes } from './routes/audit';
import { registerAiRoutes } from './routes/ai';
import { registerChatRoutes } from './routes/chat';
import { registerStudioRoutes } from './routes/studio';
import { registerDocumentRoutes } from './routes/documents';
import { registerHealthRoutes } from './routes/health';
import { createStaticHandler } from './http/static';

export interface Deps {
  db: Db;
  config: Config;
  log: Logger;
  storage: ObjectStorage;
  ai: ClaudeService;
  limiters: {
    loginIp: RateLimiter;
    loginEmail: RateLimiter;
    general: RateLimiter;
    ai: RateLimiter;
  };
}

/** undefined = Anthropic, null = AI off, otherwise the free local or self-hosted backend. */
export function selectBackend(config: Config): AiBackend | null | undefined {
  const p = config.AI_PROVIDER === 'auto' ? (config.ANTHROPIC_API_KEY ? 'anthropic' : 'local') : config.AI_PROVIDER;
  if (p === 'anthropic') return undefined;
  if (p === 'off') return null;
  if (p === 'local') return new LocalRulesBackend();
  return new OpenAiCompatibleBackend({ baseUrl: config.LOCAL_AI_BASE_URL!, model: config.LOCAL_AI_MODEL!, apiKey: config.LOCAL_AI_API_KEY, timeoutMs: config.LOCAL_AI_TIMEOUT_MS });
}

export function buildDeps(config: Config, db: Db, overrides: Partial<Deps> = {}): Deps {
  const log = overrides.log ?? createLogger(config.LOG_LEVEL);
  return {
    db,
    config,
    log,
    storage: overrides.storage ?? (config.STORAGE_DRIVER === 'postgres' ? new PgStorage(db) : new LocalDiskStorage(config.STORAGE_DIR)),
    ai: overrides.ai ?? new ClaudeService({
      apiKey: config.ANTHROPIC_API_KEY,
      baseUrl: config.ANTHROPIC_BASE_URL,
      model: config.CLAUDE_MODEL,
      maxTokens: config.CLAUDE_MAX_TOKENS,
      timeoutMs: config.CLAUDE_TIMEOUT_MS,
      cacheTtl: config.CLAUDE_CACHE_TTL,
      pricing: loadPricing(config.AI_PRICING_FILE),
      backend: selectBackend(config),
    }),
    limiters: overrides.limiters ?? {
      loginIp: new RateLimiter(30, 15 * 60_000),
      loginEmail: new RateLimiter(10, 15 * 60_000),
      general: new RateLimiter(1200, 60_000),
      ai: new RateLimiter(config.AI_RATE_LIMIT_PER_HOUR, 60 * 60_000),
    },
  };
}

export function buildApp(deps: Deps) {
  const router = new Router();

  router.use(async (ctx) => {
    deps.limiters.general.check(`ip:${ctx.ip}`);
    ctx.state.auth = await resolveAuth(deps.db, ctx);
  });

  registerHealthRoutes(router, deps);
  registerAuthRoutes(router, deps);
  registerAdminRoutes(router, deps);
  registerObservationRoutes(router, deps);
  registerDashboardRoutes(router, deps);
  registerAuditRoutes(router, deps);
  registerAiRoutes(router, deps);
  registerChatRoutes(router, deps);
  registerStudioRoutes(router, deps);
  registerDocumentRoutes(router, deps);

  return createServer(router, {
    corsOrigins: deps.config.CORS_ORIGINS.split(','),
    secureCookies: deps.config.COOKIE_SECURE,
    log: deps.log,
    trustProxy: deps.config.NODE_ENV === 'production',
    fallback: deps.config.WEB_DIST_DIR ? createStaticHandler(deps.config.WEB_DIST_DIR) : undefined,
  });
}
