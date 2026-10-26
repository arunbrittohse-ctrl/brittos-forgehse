import pg from 'pg';
import { parseValue, serializeParam, PgError, type PgConfig, type QueryResult } from './types';

export { PgError };
export type { QueryResult };

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

/** node-postgres's type hook: route every text-format value through our parser. */
const TYPES = { getTypeParser: ((oid: number, format?: string) => (format === 'binary' ? (v: unknown) => v : (v: string) => parseValue(oid, v))) as unknown as typeof pg.types.getTypeParser };

/** Driver errors become PgError so error handling (codes, constraints) stays driver-independent. */
function toPgError(e: unknown): unknown {
  if (e instanceof pg.DatabaseError) {
    return new PgError({ C: e.code ?? 'XX000', M: e.message, ...(e.detail ? { D: e.detail } : {}), ...(e.constraint ? { n: e.constraint } : {}), ...(e.severity ? { S: e.severity } : {}) });
  }
  return e;
}

async function run<T>(c: pg.Pool | pg.PoolClient, sql: string, params?: readonly unknown[]): Promise<QueryResult<T>> {
  try {
    const r = await c.query({ text: sql, values: params ? params.map(serializeParam) : undefined, types: TYPES });
    return { rows: r.rows as T[], rowCount: r.rowCount ?? 0, command: r.command };
  } catch (e) {
    throw toPgError(e);
  }
}

/** PostgreSQL access via node-postgres (pg), the standard open-source driver. */
export function createDb(url: string, opts: { max?: number; statementTimeoutMs?: number } = {}): Db {
  const c: PgConfig = parseDatabaseUrl(url);
  const pool = new pg.Pool({
    host: c.host, port: c.port, user: c.user, password: c.password, database: c.database,
    ssl: c.ssl === false ? false : c.ssl,
    max: opts.max ?? 10,
    statement_timeout: opts.statementTimeoutMs ?? 15_000,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    application_name: 'forgehse-api',
  });
  // An idle client losing its connection must not crash the process; the pool replaces it.
  pool.on('error', () => undefined);
  return {
    query: (sql, params) => run(pool, sql, params),
    async transaction(fn) {
      const client = await pool.connect();
      let broken = false;
      try {
        await run(client, 'BEGIN');
        const result = await fn({ query: (sql, params) => run(client, sql, params) });
        await run(client, 'COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => { broken = true; });
        throw e;
      } finally {
        client.release(broken);
      }
    },
    async simple(sql) {
      // No parameters → simple query protocol, so multi-statement migration files run as one batch.
      const client = await pool.connect();
      try { await client.query(sql); } catch (e) { throw toPgError(e); } finally { client.release(); }
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
