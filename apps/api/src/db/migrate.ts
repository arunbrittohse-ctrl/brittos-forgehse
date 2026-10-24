import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db';

export const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

interface MigrationFile { version: string; upPath: string; downPath: string }

async function listMigrations(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const files = await readdir(dir);
  return files
    .filter((f) => f.endsWith('.up.sql'))
    .sort()
    .map((f) => {
      const version = f.replace('.up.sql', '');
      return { version, upPath: path.join(dir, f), downPath: path.join(dir, `${version}.down.sql`) };
    });
}

async function ensureTable(db: Db) {
  await db.simple(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
}

/**
 * Each migration file runs atomically: PostgreSQL executes a multi-statement simple-protocol
 * query as one implicit transaction, so a failure rolls the whole file (and its bookkeeping row) back.
 * Migration files must therefore not contain their own BEGIN/COMMIT.
 */
async function runInTx(db: Db, sql: string) {
  if (/^\s*(BEGIN|COMMIT)\s*;/im.test(sql)) throw new Error('Migration files must not contain BEGIN/COMMIT');
  await db.simple(sql);
}

export async function migrateUp(db: Db, log: (m: string) => void = () => {}): Promise<string[]> {
  await ensureTable(db);
  const applied = new Map((await db.query<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations')).rows.map((r) => [r.version, r.checksum]));
  const done: string[] = [];
  for (const m of await listMigrations()) {
    const sql = await readFile(m.upPath, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const prev = applied.get(m.version);
    if (prev) {
      if (prev !== checksum) throw new Error(`Migration ${m.version} was modified after it was applied. Create a new migration instead.`);
      continue;
    }
    log(`applying ${m.version}`);
    const escaped = checksum.replace(/'/g, "''");
    await runInTx(db, `${sql}\n;INSERT INTO schema_migrations (version, checksum) VALUES ('${m.version.replace(/'/g, "''")}', '${escaped}')`);
    done.push(m.version);
  }
  return done;
}

export async function migrateDown(db: Db, log: (m: string) => void = () => {}): Promise<string | null> {
  await ensureTable(db);
  const last = (await db.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')).rows[0];
  if (!last) return null;
  const file = (await listMigrations()).find((m) => m.version === last.version);
  if (!file) throw new Error(`No migration file found for applied version ${last.version}`);
  const sql = await readFile(file.downPath, 'utf8');
  log(`reverting ${last.version}`);
  await runInTx(db, `${sql}\n;DELETE FROM schema_migrations WHERE version = '${last.version.replace(/'/g, "''")}'`);
  return last.version;
}
