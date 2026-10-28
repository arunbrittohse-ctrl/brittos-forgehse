/**
 * Entry point on Prisma Compute. Reads the port and the database URL from the Composer service,
 * applies the embedded migrations, creates the first administrator on an empty database, and
 * serves the API and the embedded web app from one process bound to 0.0.0.0.
 */
import service from './service.ts';
import { loadConfig } from '../../apps/api/src/config';
import { createDb } from '../../apps/api/src/db/db';
import { buildApp, buildDeps } from '../../apps/api/src/app';
import { applyEmbeddedMigrations, bootstrapFirstAdmin } from '../../apps/api/src/boot/embedded';
import { createMemoryStaticHandler } from '../../apps/api/src/http/memory-static';
import { MIGRATIONS } from '../../netlify/functions/_migrations.generated';
import { WEB_FILES } from './_web.generated';

const { db: dbDep } = service.load();
const port = service.port();

// Only non-secret settings live here. The database URL comes from the service, never from a file.
const config = loadConfig({
  NODE_ENV: 'production',
  PORT: String(port),
  HOST: '0.0.0.0',
  DATABASE_URL: dbDep.url,
  DB_POOL_MAX: '4',
  COOKIE_SECURE: 'true',
  CORS_ORIGINS: 'https://forgehse.invalid', // the web app is same-origin; no cross-origin callers are allowed
  STORAGE_DRIVER: 'postgres',
  AI_PROVIDER: 'local',
  LOG_LEVEL: 'info',
} as NodeJS.ProcessEnv);

const log = (msg: string) => console.log(JSON.stringify({ msg }));

async function main() {
  const db = createDb(config.DATABASE_URL, { max: config.DB_POOL_MAX });
  await applyEmbeddedMigrations(db, MIGRATIONS, log);
  const admin = await bootstrapFirstAdmin(db, { email: 'arunbrittohse@gmail.com', name: 'Arun Britto' });
  if (admin?.temporaryPassword) {
    // Shown once, only in this project's deploy logs. It must be changed at first sign-in.
    console.log(JSON.stringify({ msg: 'first_admin_created', email: admin.email, temporaryPassword: admin.temporaryPassword, note: 'Change this password at first sign-in.' }));
  }
  const deps = buildDeps(config, db);
  const server = buildApp(deps, { fallback: createMemoryStaticHandler(WEB_FILES) });
  server.keepAliveTimeout = 65_000;
  server.requestTimeout = 120_000;
  server.listen(port, '0.0.0.0', () => log(`listening on ${port}`));
  const stop = () => server.close(() => db.end().finally(() => process.exit(0)));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => { console.error(JSON.stringify({ msg: 'startup_failed', err: (e as Error).message })); process.exit(1); });
