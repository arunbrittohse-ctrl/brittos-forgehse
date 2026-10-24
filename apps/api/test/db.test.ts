import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, compactParams, parseDatabaseUrl } from '../src/db/db';
import { serializeParam } from '../src/db/pgwire';
import { migrateDown, migrateUp } from '../src/db/migrate';
import { TEST_DB_URL, freshDb } from './helpers';

describe('database layer', () => {
  const db = createDb(TEST_DB_URL, { max: 3 });
  after(() => db.end());

  it('binds parameters safely (no SQL injection through values)', async () => {
    const evil = "x'); DROP TABLE users; --";
    const r = await db.query<{ v: string }>('SELECT $1::text AS v', [evil]);
    assert.equal(r.rows[0]!.v, evil);
  });

  it('round-trips types', async () => {
    const r = await db.query<Record<string, unknown>>(
      "SELECT 1::int AS i, 2::bigint AS b, true AS t, '{\"a\":1}'::jsonb AS j, ARRAY['a','b']::text[] AS arr, '2026-01-02'::date AS d, NULL AS n, 1.5::numeric AS num");
    assert.deepEqual(r.rows[0], { i: 1, b: 2, t: true, j: { a: 1 }, arr: ['a', 'b'], d: '2026-01-02', n: null, num: 1.5 });
  });

  it('serialises arrays and objects distinctly', () => {
    assert.equal(serializeParam(['a', 'b"c', null]), '{"a","b\\"c",NULL}');
    assert.equal(serializeParam({ a: 1 }), '{"a":1}');
    assert.equal(serializeParam(null), null);
    assert.equal(serializeParam(false), 'f');
  });

  it('rolls back failed transactions', async () => {
    await db.query('CREATE TABLE IF NOT EXISTS tx_probe (v int)');
    await assert.rejects(db.transaction(async (tx) => { await tx.query('INSERT INTO tx_probe VALUES (1)'); throw new Error('fail'); }));
    assert.equal((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM tx_probe')).rows[0]!.n, 0);
    await db.query('DROP TABLE tx_probe');
  });

  it('survives errors and serves concurrent queries through the pool', async () => {
    await assert.rejects(db.query('SELECT * FROM no_such_table'), (e: { code?: string }) => e.code === '42P01');
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => db.query<{ v: number }>('SELECT $1::int AS v', [i])));
    assert.equal(results.reduce((a, r) => a + r.rows[0]!.v, 0), 300);
  });

  it('compacts unused positional parameters', () => {
    assert.deepEqual(compactParams('SELECT $3, $1, $3', ['a', 'b', 'c']), ['SELECT $1, $2, $1', ['c', 'a']]);
  });

  it('parses DATABASE_URL including TLS modes', () => {
    const c = parseDatabaseUrl('postgres://u:p%40ss@db.example:6543/forge?sslmode=verify-full');
    assert.equal(c.password, 'p@ss'); assert.equal(c.port, 6543);
    assert.deepEqual(c.ssl, { rejectUnauthorized: true });
    assert.equal(parseDatabaseUrl('postgres://u@h/d').ssl, false);
  });

  it('migrations roll back and re-apply cleanly, and detect edited migrations', async () => {
    const fresh = await freshDb();
    try {
      assert.equal(await migrateDown(fresh), '0005_object_store');
      assert.equal(await migrateDown(fresh), '0004_studio_chat');
      assert.deepEqual(await migrateUp(fresh), ['0004_studio_chat', '0005_object_store']);
    await fresh.query("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '0001_core'");
      await assert.rejects(migrateUp(fresh), /modified after it was applied/);
    } finally {
      await fresh.end();
    }
  });
});
