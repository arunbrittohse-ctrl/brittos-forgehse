/**
 * Netlify Function hosting the FORGEHSE API (all /api/* requests).
 *
 * The API is a plain node:http server. On a cold start this function:
 *   1. applies pending SQL migrations (same checksum rules as apps/api/src/db/migrate.ts),
 *   2. creates the first organisation + Super Administrator when the database is empty (SEED_* env vars),
 *   3. starts the API on a loopback port and forwards each request to it, streaming the response back.
 */
import http from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../../apps/api/src/config';
import { createDb, type Db } from '../../apps/api/src/db/db';
import { buildApp, buildDeps } from '../../apps/api/src/app';
import { hashPassword } from '../../apps/api/src/auth/passwords';
import { MIGRATIONS } from './_migrations.generated';

async function migrate(db: Db) {
  await db.simple(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Map((await db.query<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations')).rows.map((r) => [r.version, r.checksum]));
  for (const m of MIGRATIONS) {
    const checksum = createHash('sha256').update(m.sql).digest('hex');
    const prev = applied.get(m.version);
    if (prev) {
      if (prev !== checksum) throw new Error(`Migration ${m.version} changed after it was applied`);
      continue;
    }
    await db.simple(`${m.sql}\n;INSERT INTO schema_migrations (version, checksum) VALUES ('${m.version.replace(/'/g, "''")}', '${checksum}')`);
    console.log(JSON.stringify({ msg: 'migration_applied', version: m.version }));
  }
}

async function bootstrap(db: Db) {
  const n = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM users')).rows[0]!.n;
  if (n > 0) return;
  const env = process.env;
  const email = (env.SEED_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = env.SEED_ADMIN_PASSWORD ?? '';
  if (!email || password.length < 12) { console.error('Database is empty but SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD are not set'); return; }
  await db.transaction(async (tx) => {
    const org = (await tx.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, settings) VALUES ($1,$2,$3) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [env.SEED_ORG_NAME ?? "BRITTO'S AI FORGE", env.SEED_ORG_SLUG ?? 'brittos-ai-forge', { timezone: 'Asia/Dubai' }])).rows[0]!;
    const user = (await tx.query<{ id: string }>(
      `INSERT INTO users (email, full_name, job_title, password_hash, must_change_password) VALUES ($1,$2,'Administrator',$3,true)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
      [email, env.SEED_ADMIN_NAME ?? 'Platform Administrator', await hashPassword(password)])).rows[0]!;
    await tx.query(`INSERT INTO role_assignments (user_id, organization_id, role) VALUES ($1,$2,'super_admin') ON CONFLICT DO NOTHING`, [user.id, org.id]);
  });
  console.log(JSON.stringify({ msg: 'bootstrap_admin_created' }));
}

let ready: Promise<string> | null = null;
async function start(): Promise<string> {
  const config = loadConfig(process.env);
  const db = createDb(config.DATABASE_URL, { max: 3 });
  await migrate(db);
  await bootstrap(db);
  const server = buildApp(buildDeps(config, db));
  server.keepAliveTimeout = 60_000;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const DROP_REQ = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive']);
const DROP_RES = new Set(['connection', 'transfer-encoding', 'keep-alive', 'content-length']);

export default async (req: Request): Promise<Response> => {
  let base: string;
  try {
    base = await (ready ??= start());
  } catch (e) {
    ready = null; // retry the cold start on the next request
    console.error(JSON.stringify({ msg: 'startup_failed', err: (e as Error).message }));
    return new Response(JSON.stringify({ error: { code: 'starting', message: 'The server is starting up. Please try again in a moment.' } }), { status: 503, headers: { 'content-type': 'application/json' } });
  }
  const url = new URL(req.url);
  const headers = new Headers();
  req.headers.forEach((v, k) => { if (!DROP_REQ.has(k)) headers.set(k, v); });
  const ip = req.headers.get('x-nf-client-connection-ip');
  if (ip) headers.set('x-forwarded-for', ip);
  const method = req.method.toUpperCase();
  const res = await fetch(base + url.pathname + url.search, {
    method, headers, redirect: 'manual',
    body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(await req.arrayBuffer()),
  });
  const out = new Headers();
  res.headers.forEach((v, k) => { if (!DROP_RES.has(k) && k !== 'set-cookie') out.set(k, v); });
  for (const c of res.headers.getSetCookie?.() ?? []) out.append('set-cookie', c);
  return new Response(res.body, { status: res.status, headers: out });
};

export const config = { path: '/api/*' };
