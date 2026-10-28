import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createDb } from '../src/db/db';
import { applyEmbeddedMigrations, bootstrapFirstAdmin } from '../src/boot/embedded';
import { verifyPassword } from '../src/auth/passwords';
import { createMemoryStaticHandler } from '../src/http/memory-static';
import { TEST_DB_URL } from './helpers';

describe('hosted start-up (Prisma Compute)', () => {
  const admin = createDb(TEST_DB_URL, { max: 1 });
  after(() => admin.end());

  it('applies embedded migrations once, refuses edited ones, and creates the first admin only once', async () => {
    const name = `forgehse_boot_${Date.now()}`;
    await admin.simple(`CREATE DATABASE ${name}`);
    const db = createDb(TEST_DB_URL.replace(/\/[^/]+$/, `/${name}`), { max: 2 });
    try {
      const { readdirSync, readFileSync } = await import('node:fs');
      const { MIGRATIONS_DIR } = await import('../src/db/migrate');
      const migrations = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.up.sql')).sort().map((f) => ({ version: f.replace('.up.sql', ''), sql: readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8') }));
      const applied: string[] = [];
      await applyEmbeddedMigrations(db, migrations, (m) => applied.push(m));
      assert.equal(applied.length, migrations.length);
      applied.length = 0;
      await applyEmbeddedMigrations(db, migrations, (m) => applied.push(m));
      assert.equal(applied.length, 0, 'second start applies nothing');
      await assert.rejects(applyEmbeddedMigrations(db, [{ ...migrations[0]!, sql: migrations[0]!.sql + '\n-- edited' }]), /changed after it was applied/);

      const first = await bootstrapFirstAdmin(db, { email: 'Owner@Example.com' });
      assert.ok(first?.temporaryPassword && first.temporaryPassword.length >= 12);
      const u = (await db.query<{ password_hash: string; must_change_password: boolean; email: string }>('SELECT password_hash, must_change_password, email FROM users')).rows;
      assert.equal(u.length, 1); assert.equal(u[0]!.email, 'owner@example.com'); assert.equal(u[0]!.must_change_password, true);
      assert.ok(await verifyPassword(first.temporaryPassword, u[0]!.password_hash));
      const roles = (await db.query<{ role: string }>('SELECT role FROM role_assignments')).rows.map((r) => r.role);
      assert.deepEqual(roles, ['super_admin']);
      assert.equal(await bootstrapFirstAdmin(db, { email: 'other@example.com' }), null, 'never runs again once users exist');
    } finally {
      await db.end();
      await admin.simple(`DROP DATABASE IF EXISTS ${name}`);
    }
  });

  it('serves embedded web files with security headers, SPA fallback and no path traversal', async () => {
    const h = createMemoryStaticHandler({ '/index.html': Buffer.from('<html>app</html>').toString('base64'), '/assets/a.js': Buffer.from('x()').toString('base64') });
    const server = http.createServer(async (req, res) => { if (!(await h(req, res))) { res.statusCode = 404; res.end('nf'); } });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const spa = await fetch(`${base}/app/hazards/123`);
      assert.equal(spa.status, 200); assert.equal(await spa.text(), '<html>app</html>');
      assert.match(spa.headers.get('content-security-policy')!, /script-src 'self'/);
      const js = await fetch(`${base}/assets/a.js`);
      assert.equal(js.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404, 'missing asset is a 404, not index.html');
      const trav = await fetch(`${base}/..%2f..%2fetc%2fpasswd`);
      const body = trav.status === 200 ? await trav.text() : '';
      assert.ok(!body.includes('root:'), 'only embedded files can ever be served');
    } finally { server.close(); }
  });
});
