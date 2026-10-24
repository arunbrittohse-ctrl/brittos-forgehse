import type { Deps } from '../app';
import type { Router } from '../http/core';

export function registerHealthRoutes(r: Router, { db, ai }: Deps) {
  /** Liveness: the process is up. */
  r.get('/api/health', async () => ({ json: { status: 'ok' } }));

  /** Readiness: database reachable and migrations applied. No secrets or versions disclosed. */
  r.get('/api/ready', async () => {
    try {
      const m = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM schema_migrations');
      return { json: { status: 'ready', database: 'ok', migrations: m.rows[0]!.n, ai: ai.configured ? 'configured' : 'not_configured' } };
    } catch {
      return { status: 503, json: { status: 'not_ready', database: 'unreachable' } };
    }
  });
}
