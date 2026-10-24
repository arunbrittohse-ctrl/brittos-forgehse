/**
 * Minimal, dependency-free HTTP layer on node:http: routing, JSON bodies with size
 * limits, security headers, CORS allow-list, request ids, structured logging and
 * consistent error responses. Kept small and explicit so it is easy to audit.
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { ZodError, type ZodTypeAny, type output } from 'zod';
import { PgError } from '../db/db';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Authentication required') => new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = 'You do not have permission to do this') => new HttpError(403, 'forbidden', msg);
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, 'conflict', msg, details);

export interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  ip: string;
  requestId: string;
  /** Lazily-read JSON body (max 1 MB). */
  json<S extends ZodTypeAny>(schema: S): Promise<output<S>>;
  /** Raw body bytes up to `maxBytes`. */
  raw(maxBytes: number): Promise<Buffer>;
  parseQuery<S extends ZodTypeAny>(schema: S): output<S>;
  state: Record<string, unknown>;
}

export type Reply =
  | { status?: number; json: unknown; headers?: Record<string, string> }
  | { status?: number; body: Buffer | string; contentType: string; headers?: Record<string, string> }
  | { status: 204; headers?: Record<string, string> }
  /** Server-Sent Events. The handler streams events; errors thrown inside become an `error` event. */
  | { status?: 200; sse: (send: SseSend, signal: AbortSignal) => Promise<void>; headers?: Record<string, string> };

export type SseSend = (event: string, data: unknown) => void;

export type Handler = (ctx: Ctx) => Promise<Reply>;
type Middleware = (ctx: Ctx) => Promise<void>;

interface Route { method: string; parts: string[]; handler: Handler }

export class Router {
  private routes: Route[] = [];
  private before: Middleware[] = [];
  use(mw: Middleware) { this.before.push(mw); }
  add(method: string, pattern: string, handler: Handler) {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
  }
  get(p: string, h: Handler) { this.add('GET', p, h); }
  post(p: string, h: Handler) { this.add('POST', p, h); }
  patch(p: string, h: Handler) { this.add('PATCH', p, h); }
  delete(p: string, h: Handler) { this.add('DELETE', p, h); }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | 'method' | null {
    const segs = path.split('/').filter(Boolean);
    let pathMatched = false;
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const p = r.parts[i]!;
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]!);
        else if (p !== segs[i]) { ok = false; break; }
      }
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method || (method === 'HEAD' && r.method === 'GET')) return { handler: r.handler, params };
    }
    return pathMatched ? 'method' : null;
  }
  get middlewares() { return this.before; }
}

export interface ServerOptions {
  corsOrigins: string[];
  secureCookies: boolean;
  log: Logger;
  /** Fallback for non-/api paths (static web app). */
  fallback?: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean>;
  trustProxy?: boolean;
}

export interface Logger {
  info(obj: Record<string, unknown>): void;
  warn(obj: Record<string, unknown>): void;
  error(obj: Record<string, unknown>): void;
}

export function createLogger(level: string): Logger {
  const order = { debug: 0, info: 1, warn: 2, error: 3 } as Record<string, number>;
  const min = order[level] ?? 1;
  const write = (lvl: string) => (obj: Record<string, unknown>) => {
    if ((order[lvl] ?? 1) < min || process.env.NODE_ENV === 'test') return;
    process.stdout.write(JSON.stringify({ t: new Date().toISOString(), level: lvl, ...obj }) + '\n');
  };
  return { info: write('info'), warn: write('warn'), error: write('error') };
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-site',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > maxBytes) return reject(new HttpError(413, 'payload_too_large', `Request body exceeds ${Math.round(maxBytes / 1024)} KB`));
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) { reject(new HttpError(413, 'payload_too_large', `Request body exceeds ${Math.round(maxBytes / 1024)} KB`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function toErrorReply(e: unknown, log: Logger, requestId: string): { status: number; body: Record<string, unknown> } {
  if (e instanceof HttpError) return { status: e.status, body: { error: { code: e.code, message: e.message, details: e.details } } };
  // Duck-typed so errors from both zod v3 and the zod/v4 schemas (Studio) map to 400.
  if (e instanceof ZodError || (e instanceof Error && e.name === 'ZodError' && Array.isArray((e as { issues?: unknown }).issues))) {
    const issues = (e as unknown as { issues: { path: PropertyKey[]; message: string }[] }).issues;
    return { status: 400, body: { error: { code: 'validation_failed', message: 'Some fields are invalid', details: issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) } } };
  }
  if (e instanceof PgError) {
    if (e.code === '23505') return { status: 409, body: { error: { code: 'duplicate', message: 'A record with these details already exists' } } };
    if (e.code === '23503') return { status: 400, body: { error: { code: 'invalid_reference', message: 'A referenced record does not exist or is not accessible' } } };
    if (e.code === '23514') return { status: 400, body: { error: { code: 'constraint_failed', message: 'The data violates a business rule' } } };
    if (e.code === '57014') return { status: 503, body: { error: { code: 'timeout', message: 'The request took too long. Please retry.' } } };
  }
  log.error({ msg: 'unhandled_error', requestId, err: (e as Error)?.message, stack: (e as Error)?.stack?.split('\n').slice(0, 6).join(' | ') });
  return { status: 500, body: { error: { code: 'internal_error', message: 'Something went wrong. Reference: ' + requestId } } };
}

export function createServer(router: Router, opts: ServerOptions): http.Server {
  const allowed = new Set(opts.corsOrigins.map((o) => o.trim()).filter(Boolean));

  return http.createServer(async (req, res) => {
    const started = Date.now();
    const requestId = randomUUID();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = (req.method ?? 'GET').toUpperCase();
    const origin = req.headers.origin;
    const ip = (opts.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim() : '') || req.socket.remoteAddress || 'unknown';

    res.setHeader('X-Request-Id', requestId);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    if (opts.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    if (!url.pathname.startsWith('/api/')) {
      if (opts.fallback && (await opts.fallback(req, res).catch(() => false))) return;
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    if (method === 'OPTIONS') {
      if (origin && allowed.has(origin)) {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Idempotency-Key');
        res.setHeader('Access-Control-Max-Age', '600');
      }
      res.statusCode = 204;
      res.end();
      return;
    }

    let bodyCache: Promise<Buffer> | null = null;
    const ctx: Ctx = {
      req, res, method, path: url.pathname, params: {}, ip, requestId, state: {},
      query: Object.fromEntries(url.searchParams.entries()),
      raw: (max) => (bodyCache ??= readBody(req, max)),
      async json(schema) {
        const buf = await (bodyCache ??= readBody(req, 1024 * 1024));
        const ct = String(req.headers['content-type'] ?? '');
        if (buf.length && !ct.includes('application/json')) throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json');
        let data: unknown = {};
        if (buf.length) {
          try { data = JSON.parse(buf.toString('utf8')); } catch { throw badRequest('Malformed JSON body'); }
        }
        return schema.parse(data);
      },
      parseQuery(schema) { return schema.parse(this.query); },
    };

    let status = 500;
    try {
      const m = router.match(method, url.pathname);
      if (m === null) throw notFound('Endpoint');
      if (m === 'method') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
      ctx.params = m.params;
      for (const mw of router.middlewares) await mw(ctx);
      const reply = await m.handler(ctx);
      status = reply.status ?? 200;
      if (reply.headers) for (const [k, v] of Object.entries(reply.headers)) res.setHeader(k, v);
      res.statusCode = status;
      if ('sse' in reply) {
        await runSse(ctx, reply.sse, opts.log, requestId);
        return;
      }
      if ('json' in reply) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(method === 'HEAD' ? undefined : JSON.stringify(reply.json));
      } else if ('body' in reply) {
        res.setHeader('Content-Type', reply.contentType);
        res.end(method === 'HEAD' ? undefined : reply.body);
      } else res.end();
    } catch (e) {
      const { status: s, body } = toErrorReply(e, opts.log, requestId);
      status = s;
      if (!res.headersSent) {
        res.statusCode = s;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (s === 429 && e instanceof HttpError && typeof e.details === 'object' && e.details && 'retryAfterSec' in e.details) {
          res.setHeader('Retry-After', String((e.details as { retryAfterSec: number }).retryAfterSec));
        }
        res.end(JSON.stringify(body));
      } else res.end();
    } finally {
      opts.log.info({ msg: 'request', requestId, method, path: url.pathname, status, ms: Date.now() - started, ip });
    }
  });
}

/* ---------------------------------------------------------------- server-sent events */

async function runSse(ctx: Ctx, fn: (send: SseSend, signal: AbortSignal) => Promise<void>, log: Logger, requestId: string) {
  const { req, res } = ctx;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering (nginx)
  res.flushHeaders();
  const ac = new AbortController();
  const onClose = () => { if (!res.writableEnded) ac.abort(); };
  req.on('close', onClose);
  res.on('close', onClose);
  const send: SseSend = (event, data) => {
    if (res.writableEnded || ac.signal.aborted) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const beat = setInterval(() => { if (!res.writableEnded) res.write(': keep-alive\n\n'); }, 15_000);
  try {
    await fn(send, ac.signal);
  } catch (e) {
    if (!ac.signal.aborted) {
      const { status, body } = toErrorReply(e, log, requestId);
      send('error', { status, ...(body.error as Record<string, unknown>) });
    }
  } finally {
    clearInterval(beat);
    req.off('close', onClose);
    if (!res.writableEnded) res.end();
  }
}

/* ---------------------------------------------------------------- rate limiting */

/** Fixed-window in-memory limiter. For multi-instance deployments swap for a shared store (Redis). */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private limit: number, private windowMs: number) {}
  check(key: string): void {
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || e.resetAt <= now) {
      e = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, e);
      if (this.hits.size > 50_000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    }
    e.count++;
    if (e.count > this.limit) {
      throw new HttpError(429, 'rate_limited', 'Too many requests. Please wait and try again.', { retryAfterSec: Math.ceil((e.resetAt - now) / 1000) });
    }
  }
  reset(key: string) { this.hits.delete(key); }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
