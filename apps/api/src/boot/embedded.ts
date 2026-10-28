/**
 * Start-up steps for hosts that run the bundled server without a shell (Prisma Compute, Netlify):
 * apply embedded SQL migrations and create the first administrator on an empty database.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/db';
import { hashPassword } from '../auth/passwords';

export interface EmbeddedMigration { version: string; sql: string }

/** Same checksum rules as db/migrate.ts: an applied migration that was edited stops start-up. */
export async function applyEmbeddedMigrations(db: Db, migrations: EmbeddedMigration[], log: (m: string) => void = () => {}) {
  await db.simple('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = new Map((await db.query<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations')).rows.map((r) => [r.version, r.checksum]));
  for (const m of migrations) {
    const checksum = createHash('sha256').update(m.sql).digest('hex');
    const prev = applied.get(m.version);
    if (prev) {
      if (prev !== checksum) throw new Error(`Migration ${m.version} changed after it was applied`);
      continue;
    }
    await db.simple(`${m.sql}\n;INSERT INTO schema_migrations (version, checksum) VALUES ('${m.version.replace(/'/g, "''")}', '${checksum}')`);
    log(`migration_applied ${m.version}`);
  }
}

export interface BootstrapOptions {
  email: string;
  /** When omitted, a random temporary password is generated and returned once. */
  password?: string;
  name?: string;
  orgName?: string;
  orgSlug?: string;
}

/**
 * Creates the first organisation and Super Administrator when there are no users.
 * The administrator must change the password at first sign-in. Returns the generated
 * temporary password (only when one was generated), or null when nothing was created.
 */
export async function bootstrapFirstAdmin(db: Db, o: BootstrapOptions): Promise<{ email: string; temporaryPassword: string | null } | null> {
  const n = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM users')).rows[0]!.n;
  if (n > 0) return null;
  const email = o.email.trim().toLowerCase();
  if (!email.includes('@')) throw new Error('Bootstrap administrator email is not valid');
  const generated = !o.password;
  const password = o.password ?? randomBytes(12).toString('base64url');
  if (password.length < 12) throw new Error('Bootstrap administrator password must have at least 12 characters');
  await db.transaction(async (tx) => {
    const org = (await tx.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, settings) VALUES ($1,$2,$3) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [o.orgName ?? "BRITTO'S AI FORGE", o.orgSlug ?? 'brittos-ai-forge', { timezone: 'Asia/Dubai' }])).rows[0]!;
    const user = (await tx.query<{ id: string }>(
      `INSERT INTO users (email, full_name, job_title, password_hash, must_change_password) VALUES ($1,$2,'Administrator',$3,true)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
      [email, o.name ?? 'Platform Administrator', await hashPassword(password)])).rows[0]!;
    await tx.query(`INSERT INTO role_assignments (user_id, organization_id, role) VALUES ($1,$2,'super_admin') ON CONFLICT DO NOTHING`, [user.id, org.id]);
  });
  return { email, temporaryPassword: generated ? password : null };
}
