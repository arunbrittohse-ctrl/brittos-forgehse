import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, startApp, seedWorld, loggedIn, Client, type TestApp, type World } from './helpers';

describe('administration: projects, sites, users, privilege boundaries', () => {
  let app: TestApp; let w: World; let admin: Client; let eng: Client; let adminB: Client;

  before(async () => {
    const db = await freshDb(); w = await seedWorld(db); app = await startApp(db);
    admin = await loggedIn(app.base, 'adminA');
    eng = await loggedIn(app.base, 'engA1');
    // An org admin for org B, to prove cross-tenant admin isolation.
    await db.query(`INSERT INTO role_assignments (user_id, organization_id, role) VALUES ($1,$2,'org_admin')`, [w.users.engB, w.orgB]);
    adminB = await loggedIn(app.base, 'engB');
  });
  after(async () => { await app.close(); await app.db.end(); });

  it('lets org admins create projects and sites; HSE engineers cannot', async () => {
    const p = await admin.post('/api/admin/projects', { code: 'NEW-1', name: 'New Project' });
    assert.equal(p.status, 201);
    const s = await admin.post('/api/admin/sites', { projectId: p.data.id, code: 'S1', name: 'Site one' });
    assert.equal(s.status, 201);
    assert.equal((await admin.post('/api/admin/projects', { code: 'NEW-1', name: 'Duplicate' })).status, 409);
    assert.equal((await eng.post('/api/admin/projects', { code: 'NOPE', name: 'Nope' })).status, 403);
  });

  it('cannot attach sites to, or edit, another organisation\'s project', async () => {
    assert.equal((await adminB.post('/api/admin/sites', { projectId: w.projA1, code: 'HACK', name: 'Hack' })).status, 404);
    assert.equal((await adminB.patch(`/api/admin/projects/${w.projA1}`, { name: 'Hijacked' })).status, 404);
    const list = await adminB.get('/api/admin/projects');
    assert.ok(list.data.items.every((p: { code: string }) => p.code === 'B1'));
  });

  it('creates users with scoped roles and forces a password change on first login', async () => {
    const r = await admin.post('/api/admin/users', {
      email: 'new.officer@test.local', fullName: 'New Officer', initialPassword: 'InitialPass2026',
      assignments: [{ role: 'hse_officer', projectId: w.projA1 }],
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const c = new Client(app.base);
    const login = await c.login('new.officer@test.local', 'InitialPass2026');
    assert.equal(login.data.mustChangePassword, true);
    assert.equal((await c.get('/api/observations')).status, 403);
  });

  it('rejects weak initial passwords and role scopes from other organisations', async () => {
    assert.equal((await admin.post('/api/admin/users', { email: 'weak@test.local', fullName: 'Weak', initialPassword: 'password', assignments: [{ role: 'viewer' }] })).status, 400);
    const foreign = await admin.post('/api/admin/users', { email: 'foreign@test.local', fullName: 'Foreign', initialPassword: 'InitialPass2026', assignments: [{ role: 'viewer', projectId: w.projB1 }] });
    assert.equal(foreign.status, 400, 'composite FK blocks cross-tenant project scope');
  });

  it('prevents privilege escalation and self-lockout', async () => {
    const esc = await admin.post('/api/admin/users', { email: 'sneaky@test.local', fullName: 'Sneaky', initialPassword: 'InitialPass2026', assignments: [{ role: 'super_admin' }] });
    assert.equal(esc.status, 403);
    assert.equal((await admin.patch(`/api/admin/users/${w.users.adminA}`, { active: false })).status, 400);
    assert.equal((await admin.patch(`/api/admin/users/${w.users.adminA}`, { assignments: [{ role: 'super_admin' }] })).status, 400);
    assert.equal((await adminB.patch(`/api/admin/users/${w.users.engA1}`, { active: false })).status, 404, 'cannot manage users of another organisation');
  });

  it('records permission changes in the audit log', async () => {
    const r = await admin.patch(`/api/admin/users/${w.users.offA1}`, { assignments: [{ role: 'hse_engineer', projectId: w.projA1 }] });
    assert.equal(r.status, 204);
    const a = await app.db.query<{ changes: { assignments: unknown } }>("SELECT changes FROM audit_log WHERE action = 'user.permissions_changed' AND entity_id = $1", [w.users.offA1]);
    assert.equal(a.rows.length, 1);
    assert.ok(a.rows[0]!.changes.assignments);
  });

  it('lists assignable people for a project/site, limited to roles that can act', async () => {
    const r = await eng.get(`/api/projects/${w.projA1}/assignees?siteId=${w.siteA1x}`);
    assert.equal(r.status, 200);
    const names = r.data.items.map((u: { fullName: string }) => u.fullName);
    assert.ok(names.includes('supA1x'));
    assert.ok(!names.includes('supA1y'), 'supervisor scoped to a different site');
    assert.ok(!names.includes('viewerA1'), 'viewers cannot be assigned actions');
    assert.ok(!names.includes('engB'));
  });
});
