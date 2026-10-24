import { z } from 'zod';
import { loginSchema, changePasswordSchema, PERMISSIONS, ROLE_LABELS, scopesFor, type Permission } from '@forgehse/shared';
import type { Deps } from '../app';
import type { Router } from '../http/core';
import { HttpError, unauthorized, badRequest, forbidden } from '../http/core';
import { hashPassword, verifyPassword, needsRehash, dummyHash } from '../auth/passwords';
import { newToken, sessionCookie, clearSessionCookie, requireAuth, loadAssignments, type AuthContext } from '../auth/session';
import { audit } from '../services/audit';
import { accessibleProjects } from '../services/access';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export function registerAuthRoutes(r: Router, { db, config, limiters }: Deps) {
  r.post('/api/auth/login', async (ctx) => {
    const body = await ctx.json(loginSchema.extend({
      organizationId: z.string().uuid().optional(),
      /** Applies only to browser sessions; omitted/false retains the existing 12-hour default. */
      rememberDevice: z.boolean().optional().default(false),
    }));
    limiters.loginIp.check(`login-ip:${ctx.ip}`);
    limiters.loginEmail.check(`login-email:${body.email}`);

    const u = (await db.query<{ id: string; password_hash: string; active: boolean; locked_until: string | null; failed_logins: number; full_name: string; must_change_password: boolean }>(
      'SELECT id, password_hash, active, locked_until, failed_logins, full_name, must_change_password FROM users WHERE email = $1', [body.email])).rows[0];

    const invalid = new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');
    if (!u) {
      await verifyPassword(body.password, await dummyHash()); // equalise response timing
      await audit(db, { organizationId: null, actorUserId: null, action: 'auth.login_failed', entityType: 'user', summary: 'Unknown email', ip: ctx.ip });
      throw invalid;
    }
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      throw new HttpError(423, 'account_locked', `Too many failed attempts. Try again after ${LOCK_MINUTES} minutes or contact your administrator.`);
    }
    const ok = await verifyPassword(body.password, u.password_hash);
    if (!ok || !u.active) {
      const failed = u.failed_logins + 1;
      await db.query(
        `UPDATE users SET failed_logins = $2, locked_until = CASE WHEN $2 >= ${MAX_FAILED} THEN now() + interval '${LOCK_MINUTES} minutes' ELSE locked_until END WHERE id = $1`,
        [u.id, failed]);
      await audit(db, { organizationId: null, actorUserId: u.id, action: 'auth.login_failed', entityType: 'user', entityId: u.id, summary: u.active ? `Failed attempt ${failed}` : 'Inactive account', ip: ctx.ip });
      throw invalid;
    }

    const orgs = (await db.query<{ organization_id: string }>('SELECT DISTINCT organization_id FROM role_assignments WHERE user_id = $1', [u.id])).rows.map((x) => x.organization_id);
    if (orgs.length === 0) throw forbidden('Your account has no role in any organisation. Contact your administrator.');
    const orgId = body.organizationId && orgs.includes(body.organizationId) ? body.organizationId : orgs[0]!;

    const ttlHours = body.client === 'mobile'
      ? config.SESSION_TTL_HOURS_MOBILE
      : body.rememberDevice ? config.SESSION_TTL_HOURS_WEB_REMEMBERED : config.SESSION_TTL_HOURS_WEB;
    const { token, hash } = newToken();
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO sessions (token_hash, user_id, organization_id, client, ip, user_agent, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(hours => $7))`,
        [hash, u.id, orgId, body.client, ctx.ip, String(ctx.req.headers['user-agent'] ?? '').slice(0, 300), ttlHours]);
      await tx.query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
      if (needsRehash(u.password_hash)) await tx.query('UPDATE users SET password_hash = $2 WHERE id = $1', [u.id, await hashPassword(body.password)]);
      await audit(tx, { organizationId: orgId, actorUserId: u.id, action: 'auth.login', entityType: 'user', entityId: u.id, summary: `Signed in (${body.client})`, ip: ctx.ip });
    });
    limiters.loginEmail.reset(`login-email:${body.email}`);

    const result = { mustChangePassword: u.must_change_password, ...(body.client === 'mobile' ? { token, expiresInHours: ttlHours } : {}) };
    return body.client === 'web'
      ? { json: result, headers: { 'Set-Cookie': sessionCookie(token, ttlHours * 3600, config.COOKIE_SECURE) } }
      : { json: result };
  });

  r.post('/api/auth/logout', async (ctx) => {
    const auth = ctx.state.auth as AuthContext | undefined;
    if (auth) {
      await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [auth.sessionId]);
      await audit(db, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'auth.logout', entityType: 'user', entityId: auth.userId, ip: ctx.ip });
    }
    return { status: 204, headers: { 'Set-Cookie': clearSessionCookie(config.COOKIE_SECURE) } };
  });

  r.get('/api/auth/me', async (ctx) => {
    const auth = requireAuth(ctx);
    const [org, orgs, user, projects] = await Promise.all([
      db.query<{ id: string; name: string; slug: string; settings: Record<string, unknown> }>('SELECT id, name, slug, settings FROM organizations WHERE id = $1', [auth.organizationId]),
      db.query<{ id: string; name: string }>(
        'SELECT DISTINCT o.id, o.name FROM organizations o JOIN role_assignments ra ON ra.organization_id = o.id WHERE ra.user_id = $1 ORDER BY o.name', [auth.userId]),
      db.query<{ job_title: string }>('SELECT job_title FROM users WHERE id = $1', [auth.userId]),
      accessibleProjects(db, auth),
    ]);
    // Effective permissions anywhere in the org — UI hints only; the server re-checks every action.
    const permissions = PERMISSIONS.filter((p: Permission) => {
      const s = scopesFor(auth.assignments, p, auth.organizationId);
      return s.orgWide || s.projects.length > 0 || s.sites.length > 0;
    });
    return {
      json: {
        user: { id: auth.userId, email: auth.email, fullName: auth.fullName, jobTitle: user.rows[0]?.job_title ?? '', mustChangePassword: auth.mustChangePassword },
        organization: org.rows[0],
        organizations: orgs.rows,
        assignments: auth.assignments.map((a) => ({ ...a, roleLabel: ROLE_LABELS[a.role] })),
        permissions,
        projects,
      },
    };
  });

  r.post('/api/auth/password', async (ctx) => {
    const auth = ctx.state.auth as AuthContext | undefined;
    if (!auth) throw unauthorized();
    const body = await ctx.json(changePasswordSchema);
    const row = (await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [auth.userId])).rows[0];
    if (!row || !(await verifyPassword(body.currentPassword, row.password_hash))) throw badRequest('Current password is incorrect');
    if (body.currentPassword === body.newPassword) throw badRequest('New password must be different');
    await db.transaction(async (tx) => {
      await tx.query('UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1', [auth.userId, await hashPassword(body.newPassword)]);
      // Sign out every other session for this user.
      await tx.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL', [auth.userId, auth.sessionId]);
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'auth.password_changed', entityType: 'user', entityId: auth.userId, ip: ctx.ip });
    });
    return { status: 204 };
  });

  r.post('/api/auth/switch-organization', async (ctx) => {
    const auth = requireAuth(ctx);
    const { organizationId } = await ctx.json(z.object({ organizationId: z.string().uuid() }));
    const assignments = await loadAssignments(db, auth.userId, organizationId);
    if (assignments.length === 0) throw forbidden('You have no role in that organisation');
    await db.query('UPDATE sessions SET organization_id = $2 WHERE id = $1', [auth.sessionId, organizationId]);
    await audit(db, { organizationId, actorUserId: auth.userId, action: 'auth.switch_organization', entityType: 'organization', entityId: organizationId, ip: ctx.ip });
    return { status: 204 };
  });
}
