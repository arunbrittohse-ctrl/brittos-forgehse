import { createHash, randomBytes } from 'node:crypto';
import type { RoleAssignment, Permission, ScopeTarget, Role } from '@forgehse/shared';
import { can, scopesFor } from '@forgehse/shared';
import type { Queryable } from '../db/db';
import { type Ctx, forbidden, unauthorized, parseCookies, HttpError } from '../http/core';

export const SESSION_COOKIE = 'fhse_session';

export interface AuthContext {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  organizationId: string;
  assignments: RoleAssignment[];
  via: 'cookie' | 'bearer';
  mustChangePassword: boolean;
}

export function newToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function sessionCookie(token: string, maxAgeSec: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}
export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

export async function loadAssignments(q: Queryable, userId: string, organizationId: string): Promise<RoleAssignment[]> {
  const r = await q.query<{ role: Role; project_id: string | null; site_id: string | null }>(
    'SELECT role, project_id, site_id FROM role_assignments WHERE user_id = $1 AND organization_id = $2',
    [userId, organizationId],
  );
  return r.rows.map((a) => ({ organizationId, role: a.role, projectId: a.project_id, siteId: a.site_id }));
}

/** Resolve the caller from the session cookie or `Authorization: Bearer`. Returns null if anonymous. */
export async function resolveAuth(q: Queryable, ctx: Ctx): Promise<AuthContext | null> {
  const authz = ctx.req.headers.authorization;
  let token: string | undefined;
  let via: AuthContext['via'] = 'cookie';
  if (authz?.startsWith('Bearer ')) { token = authz.slice(7).trim(); via = 'bearer'; }
  else token = parseCookies(ctx.req.headers.cookie)[SESSION_COOKIE];
  if (!token || token.length > 200) return null;

  const r = await q.query<{ id: string; user_id: string; organization_id: string; email: string; full_name: string; active: boolean; must_change_password: boolean; last_seen_at: string }>(
    `SELECT s.id, s.user_id, s.organization_id, u.email, u.full_name, u.active, u.must_change_password, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const s = r.rows[0];
  if (!s || !s.active) return null;

  // Cookie sessions must carry the custom header on state-changing requests (CSRF defence in depth,
  // on top of SameSite=Strict). Browsers cannot add it cross-origin without a CORS preflight we reject.
  if (via === 'cookie' && !['GET', 'HEAD'].includes(ctx.method) && ctx.req.headers['x-requested-with'] !== 'forgehse') {
    throw new HttpError(403, 'csrf', 'Missing anti-forgery header');
  }

  if (Date.now() - new Date(s.last_seen_at).getTime() > 5 * 60_000) {
    await q.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [s.id]);
  }
  return {
    sessionId: s.id, userId: s.user_id, email: s.email, fullName: s.full_name, organizationId: s.organization_id,
    assignments: await loadAssignments(q, s.user_id, s.organization_id), via, mustChangePassword: s.must_change_password,
  };
}

export function requireAuth(ctx: Ctx): AuthContext {
  const a = ctx.state.auth as AuthContext | undefined;
  if (!a) throw unauthorized();
  if (a.mustChangePassword && !['/api/auth/me', '/api/auth/password', '/api/auth/logout'].includes(ctx.path)) {
    throw new HttpError(403, 'password_change_required', 'You must change your password before continuing');
  }
  return a;
}

export function requirePermission(auth: AuthContext, permission: Permission, target: Omit<ScopeTarget, 'organizationId'> = {}): void {
  if (!can(auth.assignments, permission, { organizationId: auth.organizationId, ...target })) throw forbidden();
}

/** True when the user holds `permission` somewhere in their organisation (any scope). */
export function hasAnywhere(auth: AuthContext, permission: Permission): boolean {
  const s = scopesFor(auth.assignments, permission, auth.organizationId);
  return s.orgWide || s.projects.length > 0 || s.sites.length > 0;
}

/**
 * SQL fragment restricting rows to the projects/sites where the user holds `permission`.
 * Always includes the organisation filter. Returns a fragment that matches nothing if no scope.
 */
export function scopeFilter(
  auth: AuthContext, permission: Permission, params: unknown[],
  cols = { org: 'organization_id', project: 'project_id', site: 'site_id' },
): string {
  const s = scopesFor(auth.assignments, permission, auth.organizationId);
  params.push(auth.organizationId);
  const org = `${cols.org} = $${params.length}`;
  if (s.orgWide) return `(${org})`;
  const ors: string[] = [];
  if (s.projects.length) { params.push(s.projects); ors.push(`${cols.project} = ANY($${params.length}::uuid[])`); }
  if (s.sites.length) {
    params.push(s.sites.map((x) => x.siteId));
    ors.push(`${cols.site} = ANY($${params.length}::uuid[])`);
  }
  return ors.length ? `(${org} AND (${ors.join(' OR ')}))` : 'FALSE';
}

/**
 * Project-level reach of a permission: org-wide, or the set of projects where the user holds it
 * at project or site level. Used for project-tagged records that have no site (Studio items, chats).
 */
export function projectReach(auth: AuthContext, permission: Permission): { orgWide: boolean; projectIds: string[] } {
  const s = scopesFor(auth.assignments, permission, auth.organizationId);
  return { orgWide: s.orgWide, projectIds: [...new Set([...s.projects, ...s.sites.map((x) => x.projectId)])] };
}

export function requireProjectReach(auth: AuthContext, permission: Permission, projectId: string): void {
  const r = projectReach(auth, permission);
  if (!r.orgWide && !r.projectIds.includes(projectId)) throw forbidden();
}
