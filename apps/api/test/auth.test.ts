import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, startApp, seedWorld, Client, email, PASSWORD, type TestApp, type World } from './helpers';

describe('authentication & sessions', () => {
  let app: TestApp; let w: World;
  before(async () => { const db = await freshDb(); w = await seedWorld(db); app = await startApp(db); });
  after(async () => { await app.close(); await app.db.end(); });

  it('logs in with a cookie session (HttpOnly, SameSite=Strict) and returns profile', async () => {
    const c = new Client(app.base);
    const r = await c.login(email('engA1'));
    assert.equal(r.status, 200);
    const sc = r.headers.get('set-cookie')!;
    assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
    assert.equal(r.data.token, undefined, 'web login must not expose the token in the body');
    const me = await c.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.data.user.email, email('engA1'));
    assert.ok(me.data.permissions.includes('observation.verify'));
    assert.deepEqual(me.data.projects.map((p: { code: string }) => p.code), ['A1']);
  });

  it('rejects wrong passwords and unknown emails with the same message', async () => {
    const a = await new Client(app.base).post('/api/auth/login', { email: email('engA1'), password: 'wrong-password-1' });
    const b = await new Client(app.base).post('/api/auth/login', { email: 'nobody@test.local', password: 'wrong-password-1' });
    assert.equal(a.status, 401); assert.equal(b.status, 401);
    assert.equal(a.data.error.message, b.data.error.message);
  });

  it('locks the account after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) await new Client(app.base).post('/api/auth/login', { email: email('viewerA1'), password: 'wrong-password-1' });
    const r = await new Client(app.base).login(email('viewerA1'));
    assert.equal(r.status, 423);
    await app.db.query('UPDATE users SET locked_until = NULL, failed_logins = 0 WHERE email = $1', [email('viewerA1')]);
    assert.equal((await new Client(app.base).login(email('viewerA1'))).status, 200);
  });

  it('requires authentication for protected endpoints', async () => {
    const r = await new Client(app.base).get('/api/observations');
    assert.equal(r.status, 401);
  });

  it('blocks cookie-authenticated writes without the anti-CSRF header', async () => {
    const c = new Client(app.base);
    await c.login(email('engA1'));
    c.csrf = false;
    const r = await c.post('/api/observations', {});
    assert.equal(r.status, 403);
    assert.equal(r.data.error.code, 'csrf');
  });

  it('issues bearer tokens to mobile clients; bearer requests need no CSRF header', async () => {
    const m = new Client(app.base, 'mobile');
    const r = await m.login(email('supA1x'));
    assert.equal(r.status, 200);
    assert.ok(r.data.token && r.data.token.length >= 40);
    assert.equal(r.headers.get('set-cookie'), null);
    assert.equal((await m.get('/api/auth/me')).status, 200);
  });

  it('stores only a hash of session tokens', async () => {
    const m = new Client(app.base, 'mobile');
    await m.login(email('offA1'));
    const rows = await app.db.query<{ n: number }>('SELECT count(*)::int AS n FROM sessions WHERE encode(token_hash, $1) = $2', ['escape', m.token]);
    assert.equal(rows.rows[0]!.n, 0);
  });

  it('logout revokes the session server-side', async () => {
    const m = new Client(app.base, 'mobile');
    await m.login(email('offA1'));
    assert.equal((await m.post('/api/auth/logout')).status, 204);
    assert.equal((await m.get('/api/auth/me')).status, 401);
  });

  it('forces a password change before other actions, then revokes other sessions', async () => {
    await app.db.query('UPDATE users SET must_change_password = true WHERE email = $1', [email('engA2')]);
    const other = new Client(app.base, 'mobile'); await other.login(email('engA2'));
    const c = new Client(app.base); await c.login(email('engA2'));
    assert.equal((await c.get('/api/observations')).status, 403);
    assert.equal((await c.post('/api/auth/password', { currentPassword: PASSWORD, newPassword: 'short' })).status, 400);
    assert.equal((await c.post('/api/auth/password', { currentPassword: PASSWORD, newPassword: 'BrandNewPassword9' })).status, 204);
    assert.equal((await c.get('/api/observations')).status, 200);
    assert.equal((await other.get('/api/auth/me')).status, 401, 'other sessions are revoked');
    await app.db.query("UPDATE users SET password_hash = (SELECT password_hash FROM users WHERE email = $1) WHERE email = $2", [email('engA1'), email('engA2')]);
  });

  it('deactivated users cannot sign in and their sessions stop working', async () => {
    const admin = new Client(app.base); await admin.login(email('adminA'));
    const victim = new Client(app.base, 'mobile'); await victim.login(email('viewerA1'));
    assert.equal((await admin.patch(`/api/admin/users/${w.users.viewerA1}`, { active: false })).status, 204);
    assert.equal((await victim.get('/api/auth/me')).status, 401);
    assert.equal((await new Client(app.base).login(email('viewerA1'))).status, 401);
    await admin.patch(`/api/admin/users/${w.users.viewerA1}`, { active: true });
  });

  it('applies security headers and a strict CORS allow-list', async () => {
    const ok = await fetch(app.base + '/api/health', { headers: { origin: 'http://allowed.test' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'http://allowed.test');
    assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(ok.headers.get('x-frame-options'), 'DENY');
    const bad = await fetch(app.base + '/api/health', { headers: { origin: 'http://evil.test' } });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
  });

  it('rejects oversized and malformed JSON bodies safely', async () => {
    const c = new Client(app.base); await c.login(email('engA1'));
    const big = await c.req('POST', '/api/observations', Buffer.alloc(2 * 1024 * 1024, 97), { 'content-type': 'application/json' });
    assert.equal(big.status, 413);
    const bad = await c.req('POST', '/api/observations', Buffer.from('{not json'), { 'content-type': 'application/json' });
    assert.equal(bad.status, 400);
  });

  it('records logins and failures in the append-only audit log', async () => {
    const r = await app.db.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE action IN ('auth.login','auth.login_failed')");
    assert.ok(r.rows[0]!.n > 5);
    await assert.rejects(app.db.query('DELETE FROM audit_log'), /append-only/);
    await assert.rejects(app.db.query("UPDATE audit_log SET summary = 'x'"), /append-only/);
  });
});
