import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { createDb, type Db } from '../src/db/db';
import { migrateUp } from '../src/db/migrate';
import { loadConfig } from '../src/config';
import { buildApp, buildDeps, type Deps } from '../src/app';
import { MemoryStorage } from '../src/services/storage';
import { ClaudeService } from '../src/ai/claude';
import { DEFAULT_PRICING, type Pricing } from '../src/ai/pricing';
import { hashPassword } from '../src/auth/passwords';
import { RateLimiter } from '../src/http/core';
import { clearOrgSettingsCache } from '../src/services/org';

/** Synthetic test data only. Uses a dedicated database that is wiped before each suite. */
export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://forgehse:devpass@127.0.0.1:5432/forgehse_test';
export const PASSWORD = 'TestPassword123';

export async function freshDb(): Promise<Db> {
  const db = createDb(TEST_DB_URL, { max: 5 });
  await db.simple('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await migrateUp(db);
  clearOrgSettingsCache();
  return db;
}

export type FakeFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface TestApp {
  db: Db;
  deps: Deps;
  base: string;
  server: http.Server;
  close(): Promise<void>;
}

export async function startApp(db: Db, opts: { apiKey?: string; fetchImpl?: FakeFetch; model?: string; pricing?: Pricing; ttl?: '5m' | '1h'; timeoutMs?: number } = {}): Promise<TestApp> {
  const config = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: TEST_DB_URL, CORS_ORIGINS: 'http://allowed.test', LOG_LEVEL: 'error',
    CLAUDE_MODEL: opts.model ?? 'claude-sonnet-5-5', CLAUDE_CACHE_TTL: opts.ttl ?? '5m',
  } as NodeJS.ProcessEnv);
  const ai = new ClaudeService({
    apiKey: opts.apiKey, baseUrl: 'https://api.anthropic.test', model: config.CLAUDE_MODEL, maxTokens: 1000,
    timeoutMs: opts.timeoutMs ?? 5000, cacheTtl: config.CLAUDE_CACHE_TTL, pricing: opts.pricing ?? DEFAULT_PRICING,
    fetchImpl: opts.fetchImpl as typeof fetch | undefined, maxRetries: 1,
  });
  const deps = buildDeps(config, db, {
    storage: new MemoryStorage(),
    ai,
    limiters: { loginIp: new RateLimiter(1000, 60_000), loginEmail: new RateLimiter(1000, 60_000), general: new RateLimiter(100_000, 60_000), ai: new RateLimiter(1000, 60_000) },
  });
  const server = buildApp(deps);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { db, deps, base, server, close: () => new Promise((r) => server.close(() => r())) };
}

/** Minimal API client. Cookie mode mimics the web app (incl. anti-CSRF header); bearer mimics mobile. */
export class Client {
  cookie = '';
  token = '';
  constructor(private base: string, public mode: 'web' | 'mobile' = 'web', public csrf = true) {}

  async req(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { ...extra };
    if (body !== undefined && !(body instanceof Buffer)) headers['content-type'] = 'application/json';
    if (this.cookie) headers.cookie = this.cookie;
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.csrf && this.mode === 'web') headers['x-requested-with'] = 'forgehse';
    const res = await fetch(this.base + path, {
      method, headers,
      body: body === undefined ? undefined : body instanceof Buffer ? new Uint8Array(body) : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0]!;
    const ct = res.headers.get('content-type') ?? '';
    const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data: data as any, headers: res.headers };
  }
  get(p: string) { return this.req('GET', p); }
  post(p: string, b?: unknown, h?: Record<string, string>) { return this.req('POST', p, b ?? {}, h); }
  patch(p: string, b: unknown) { return this.req('PATCH', p, b); }

  async login(email: string, password = PASSWORD) {
    const r = await this.post('/api/auth/login', { email, password, client: this.mode });
    if (this.mode === 'mobile' && r.data.token) this.token = r.data.token;
    return r;
  }
}

export interface World {
  orgA: string; orgB: string;
  projA1: string; projA2: string; projB1: string;
  siteA1x: string; siteA1y: string; siteA2: string; siteB1: string;
  users: Record<string, string>;
}

/**
 * Two organisations. Org A has two projects (A1 with sites x/y, A2), org B one project.
 * Users (email = <key>@test.local):
 *   adminA (org_admin A), corpA (corporate_hse_manager A), engA1 (hse_engineer A1), offA1 (hse_officer A1),
 *   supA1x (supervisor A1/x), supA1y (supervisor A1/y), viewerA1 (viewer A1), engA2 (hse_engineer A2), engB (hse_engineer B1)
 */
export async function seedWorld(db: Db): Promise<World> {
  const hash = await hashPassword(PASSWORD);
  const one = async <T = { id: string }>(sql: string, p: unknown[]) => (await db.query<T>(sql, p)).rows[0]!;
  const org = async (slug: string) => (await one(`INSERT INTO organizations (name, slug, settings) VALUES ($1,$1,'{"timezone":"Asia/Dubai"}') RETURNING id`, [slug])).id;
  const orgA = await org('org-a');
  const orgB = await org('org-b');
  const proj = async (o: string, code: string) => (await one('INSERT INTO projects (organization_id, code, name) VALUES ($1,$2,$2) RETURNING id', [o, code])).id;
  const site = async (o: string, p: string, code: string) => (await one('INSERT INTO sites (organization_id, project_id, code, name) VALUES ($1,$2,$3,$3) RETURNING id', [o, p, code])).id;
  const projA1 = await proj(orgA, 'A1'), projA2 = await proj(orgA, 'A2'), projB1 = await proj(orgB, 'B1');
  const siteA1x = await site(orgA, projA1, 'X'), siteA1y = await site(orgA, projA1, 'Y'), siteA2 = await site(orgA, projA2, 'Z'), siteB1 = await site(orgB, projB1, 'Q');
  const users: Record<string, string> = {};
  const mk = async (key: string, o: string, role: string, p: string | null = null, s: string | null = null) => {
    const id = (await one('INSERT INTO users (email, full_name, password_hash) VALUES ($1,$2,$3) RETURNING id', [`${key.toLowerCase()}@test.local`, key, hash])).id;
    await db.query('INSERT INTO role_assignments (user_id, organization_id, role, project_id, site_id) VALUES ($1,$2,$3,$4,$5)', [id, o, role, p, s]);
    users[key] = id;
  };
  await mk('adminA', orgA, 'org_admin');
  await mk('corpA', orgA, 'corporate_hse_manager');
  await mk('engA1', orgA, 'hse_engineer', projA1);
  await mk('offA1', orgA, 'hse_officer', projA1);
  await mk('supA1x', orgA, 'supervisor', projA1, siteA1x);
  await mk('supA1y', orgA, 'supervisor', projA1, siteA1y);
  await mk('viewerA1', orgA, 'viewer', projA1);
  await mk('engA2', orgA, 'hse_engineer', projA2);
  await mk('engB', orgB, 'hse_engineer', projB1);
  return { orgA, orgB, projA1, projA2, projB1, siteA1x, siteA1y, siteA2, siteB1, users };
}

export const email = (key: string) => `${key.toLowerCase()}@test.local`;

export function observationInput(w: World, over: Record<string, unknown> = {}) {
  return {
    projectId: w.projA1, siteId: w.siteA1x, type: 'unsafe_condition', hazardCategory: 'Work at height',
    location: 'Level 3 slab edge', activity: 'Formwork', description: 'Missing edge protection along east edge',
    immediateAction: '', likelihood: 3, severity: 4, observedAt: new Date(Date.now() - 3600_000).toISOString(), ...over,
  };
}

export async function loggedIn(base: string, key: string, mode: 'web' | 'mobile' = 'web') {
  const c = new Client(base, mode);
  const r = await c.login(email(key));
  if (r.status !== 200) throw new Error(`login failed for ${key}: ${r.status} ${JSON.stringify(r.data)}`);
  return c;
}

export function today(offsetDays = 0) {
  const d = new Date(Date.now() + 4 * 3600_000 + offsetDays * 86_400_000); // Asia/Dubai is UTC+4
  return d.toISOString().slice(0, 10);
}
