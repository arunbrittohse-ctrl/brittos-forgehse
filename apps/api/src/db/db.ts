import { PgPool, type PgConfig, type QueryResult, PgError } from './pgwire';

export { PgError };

/** The only database surface the rest of the API uses. */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  simple(sql: string): Promise<void>;
  end(): Promise<void>;
}

export function parseDatabaseUrl(url: string): PgConfig {
  const u = new URL(url);
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new Error('DATABASE_URL must start with postgres://');
  const sslmode = u.searchParams.get('sslmode') ?? 'disable';
  return {
    host: u.hostname || 'localhost',
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    ssl: sslmode === 'disable' ? false : { rejectUnauthorized: sslmode === 'verify-full' || sslmode === 'verify-ca' },
  };
}

export function createDb(url: string, opts: { max?: number; statementTimeoutMs?: number } = {}): Db {
  const pool = new PgPool({ ...parseDatabaseUrl(url), statementTimeoutMs: opts.statementTimeoutMs ?? 15_000 }, opts.max ?? 10);
  return {
    query: (sql, params) => pool.query(sql, params),
    async transaction(fn) {
      const conn = await pool.acquire();
      try {
        await conn.query('BEGIN');
        const result = await fn({ query: (sql, params) => conn.query(sql, params) });
        await conn.query('COMMIT');
        return result;
      } catch (e) {
        if (!conn.broken) await conn.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        pool.release(conn);
      }
    },
    async simple(sql) {
      const conn = await pool.acquire();
      try { await conn.simple(sql); } finally { pool.release(conn); }
    },
    end: () => pool.end(),
  };
}

/**
 * Keep only the positional parameters a statement actually references, renumbering $n
 * accordingly. Lets several queries share one parameter list built by helpers such as
 * scopeFilter(). PostgreSQL rejects bind messages carrying unreferenced parameters.
 */
export function compactParams(sql: string, params: readonly unknown[]): [string, unknown[]] {
  const map = new Map<number, number>();
  const out: unknown[] = [];
  const text = sql.replace(/\$(\d+)/g, (_, d: string) => {
    const n = Number(d);
    if (!map.has(n)) { out.push(params[n - 1]); map.set(n, out.length); }
    return `$${map.get(n)}`;
  });
  return [text, out];
}
