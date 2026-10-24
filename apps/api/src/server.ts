import { loadConfig } from './config';
import { createDb } from './db/db';
import { buildApp, buildDeps } from './app';

const config = loadConfig();
const db = createDb(config.DATABASE_URL, { max: config.DB_POOL_MAX });
const deps = buildDeps(config, db);
const server = buildApp(deps);

server.requestTimeout = 120_000;
server.headersTimeout = 30_000;
server.listen(config.PORT, config.HOST, () => {
  deps.log.info({ msg: 'listening', port: config.PORT, env: config.NODE_ENV, ai: deps.ai.configured ? 'configured' : 'not_configured', model: config.CLAUDE_MODEL });
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  deps.log.info({ msg: 'shutting_down', signal });
  server.close(async () => {
    await db.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
