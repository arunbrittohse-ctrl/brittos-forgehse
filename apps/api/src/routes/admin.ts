import { z } from 'zod';
import {
  projectCreateSchema, projectUpdateSchema, siteCreateSchema, siteUpdateSchema,
  userCreateSchema, userUpdateSchema, ROLE_LABELS, roleHas, type Role,
} from '@forgehse/shared';
import type { Deps } from '../app';
import type { Router } from '../http/core';
import { notFound, forbidden, conflict, badRequest } from '../http/core';
import { requireAuth, requirePermission, type AuthContext } from '../auth/session';
import { hashPassword } from '../auth/passwords';
import { audit, diff } from '../services/audit';
import type { Queryable } from '../db/db';

const idParam = z.object({ id: z.string().uuid() });

function assertGrantable(auth: AuthContext, roles: Role[]) {
  const isSuper = auth.assignments.some((a) => a.role === 'super_admin');
  if (!isSuper && roles.includes('super_admin')) throw forbidden('Only a Super Administrator can grant the Super Administrator role');
}

async function replaceAssignments(tx: Queryable, auth: AuthContext, userId: string, list: { role: Role; projectId: string | null; siteId: string | null }[]) {
  await tx.query('DELETE FROM role_assignments WHERE user_id = $1 AND organization_id = $2', [userId, auth.organizationId]);
  for (const a of list) {
    await tx.query(
      `INSERT INTO role_assignments (user_id, organization_id, role, project_id, site_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT DO NOTHING`,
      [userId, auth.organizationId, a.role, a.projectId, a.siteId, auth.userId]);
  }
}

export function registerAdminRoutes(r: Router, { db }: Deps) {
  /* ------------------------------------------------------------ projects */
  r.get('/api/admin/projects', async (ctx) => {
    const auth = requireAuth(ctx);
    requirePermission(auth, 'project.manage');
    const rows = await db.query(
      `SELECT p.id, p.code, p.name, p.client, p.location, p.start_date AS "startDate", p.status, p.created_at AS "createdAt",
              (SELECT coalesce(json_agg(json_build_object('id', s.id, 'code', s.code, 'name', s.name, 'active', s.active) ORDER BY s.code), '[]'::json)
                 FROM sites s WHERE s.project_id = p.id) AS sites
         FROM projects p WHERE p.organization_id = $1 ORDER BY p.code`, [auth.organizationId]);
    return { json: { items: rows.rows } };
  });

  r.post('/api/admin/projects', async (ctx) => {
    const auth = requireAuth(ctx);
    requirePermission(auth, 'project.manage');
    const b = await ctx.json(projectCreateSchema);
    const created = await db.transaction(async (tx) => {
      const row = (await tx.query<{ id: string }>(
        `INSERT INTO projects (organization_id, code, name, client, location, start_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [auth.organizationId, b.code, b.name, b.client, b.location, b.startDate ?? null])).rows[0]!;
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'project.create', entityType: 'project', entityId: row.id, projectId: row.id, summary: `${b.code} — ${b.name}`, ip: ctx.ip });
      return row;
    });
    return { status: 201, json: created };
  });

  r.patch('/api/admin/projects/:id', async (ctx) => {
    const auth = requireAuth(ctx);
    requirePermission(auth, 'project.manage');
    const { id } = idParam.parse(ctx.params);
    const b = await ctx.json(projectUpdateSchema);
    await db.transaction(async (tx) => {
      const before = (await tx.query<Record<string, unknown>>(
        'SELECT code, name, client, location, start_date AS "startDate", status FROM projects WHERE id = $1 AND organization_id = $2 FOR UPDATE', [id, auth.organizationId])).rows[0];
      if (!before) throw notFound('Project');
      const next = { ...before, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) } as Record<string, unknown>;
      await tx.query(
        `UPDATE projects SET code=$3, name=$4, client=$5, location=$6, start_date=$7, status=$8, updated_at=now() WHERE id=$1 AND organization_id=$2`,
        [id, auth.organizationId, next.code, next.name, next.client, next.location, next.startDate ?? null, next.status]);
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'project.update', entityType: 'project', entityId: id, projectId: id, changes: diff(before, next), ip: ctx.ip });
    });
    return { status: 204 };
  });

  /* ------------------------------------------------------------ sites */
  r.post('/api/admin/sites', async (ctx) => {
    const auth = requireAuth(ctx);
    requirePermission(auth, 'project.manage');
    const b = await ctx.json(siteCreateSchema);
    const created = await db.transaction(async (tx) => {
      const p = (await tx.query('SELECT 1 FROM projects WHERE id = $1 AND organization_id = $2', [b.projectId, auth.organizationId])).rows[0];
      if (!p) throw notFound('Project');
      const row = (await tx.query<{ id: string }>(
        'INSERT INTO sites (organization_id, project_id, code, name) VALUES ($1,$2,$3,$4) RETURNING id', [auth.organizationId, b.projectId, b.code, b.name])).rows[0]!;
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'site.create', entityType: 'site', entityId: row.id, projectId: b.projectId, summary: `${b.code} — ${b.name}`, ip: ctx.ip });
      return row;
    });
    return { status: 201, json: created };
  });

  r.patch('/api/admin/sites/:id', async (ctx) => {
    const auth = requireAuth(ctx);
    requirePermission(auth, 'project.manage');
    const { id } = idParam.parse(ctx.params);
    const b = await ctx.json(siteUpdateSchema);
    await db.transaction(async (tx) => {
      const before = (await tx.query<{ name: string; active: boolean; project_id: string }>('SELECT name, active, project_id FROM sites WHERE id = $1 AND organization_id = $2 FOR UPDATE', [id, auth.organizationId])).rows[0];
      if (!before) throw notFound('Site');
      const next = { name: b.name ?? before.name, active: b.active ?? before.active };
      await tx.query('UPDATE sites SET name = $3, active = $4, updated_at = now() WHERE id = $1 AND organization_id = $2', [id, auth.organizationId, next.name, next.active]);
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'site.update', entityType: 'site', entityId: id, projectId: before.project_id, changes: diff(before, next), ip: ctx.ip });
    });
    return { status: 204 };
  });

  /* ------------------------------------------------------------ users */
  r.get('/api/admin/users', async (ctx) => {
    const auth = requireAuth(ctx);
    requirePermission(auth, 'user.manage');
    const rows = await db.query(
      `SELECT u.id, u.email, u.full_name AS "fullName", u.job_title AS "jobTitle", u.active, u.last_login_at AS "lastLoginAt",
              (u.locked_until IS NOT NULL AND u.locked_until > now()) AS locked,
              json_agg(json_build_object('role', ra.role, 'projectId', ra.project_id, 'siteId', ra.site_id)) AS assignments
         FROM users u JOIN role_assignments ra ON ra.user_id = u.id AND ra.organization_id = $1
        GROUP BY u.id ORDER BY u.full_name`, [auth.organizationId]);
    return { json: { items: rows.rows, roles: ROLE_LABELS } };
  });

  r.post('/api/admin/users', async (ctx) => {
    const auth = requireAuth(ctx);
    requirePermission(auth, 'user.manage');
    const b = await ctx.json(userCreateSchema);
    assertGrantable(auth, b.assignments.map((a) => a.role));
    const exists = (await db.query('SELECT 1 FROM users WHERE email = $1', [b.email])).rows[0];
    if (exists) throw conflict('A user with this email already exists. Ask a platform administrator to link the account to your organisation.');
    const passwordHash = await hashPassword(b.initialPassword);
    const created = await db.transaction(async (tx) => {
      const row = (await tx.query<{ id: string }>(
        `INSERT INTO users (email, full_name, job_title, password_hash, must_change_password) VALUES ($1,$2,$3,$4,true) RETURNING id`,
        [b.email, b.fullName, b.jobTitle, passwordHash])).rows[0]!;
      await replaceAssignments(tx, auth, row.id, b.assignments);
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'user.create', entityType: 'user', entityId: row.id, summary: b.email, changes: { assignments: b.assignments }, ip: ctx.ip });
      return row;
    });
    return { status: 201, json: created };
  });

  r.patch('/api/admin/users/:id', async (ctx) => {
    const auth = requireAuth(ctx);
    requirePermission(auth, 'user.manage');
    const { id } = idParam.parse(ctx.params);
    const b = await ctx.json(userUpdateSchema);
    if (id === auth.userId && (b.active === false || b.assignments)) throw badRequest('You cannot deactivate yourself or change your own roles');
    if (b.assignments) assertGrantable(auth, b.assignments.map((a) => a.role));
    await db.transaction(async (tx) => {
      const before = (await tx.query<{ full_name: string; job_title: string; active: boolean }>(
        `SELECT u.full_name, u.job_title, u.active FROM users u
          WHERE u.id = $1 AND EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = u.id AND ra.organization_id = $2) FOR UPDATE`,
        [id, auth.organizationId])).rows[0];
      if (!before) throw notFound('User');
      const currentRoles = (await tx.query<{ role: Role }>('SELECT role FROM role_assignments WHERE user_id = $1 AND organization_id = $2', [id, auth.organizationId])).rows.map((x) => x.role);
      assertGrantable(auth, currentRoles); // an org admin cannot modify a super admin
      const next = { full_name: b.fullName ?? before.full_name, job_title: b.jobTitle ?? before.job_title, active: b.active ?? before.active };
      await tx.query('UPDATE users SET full_name = $2, job_title = $3, active = $4, updated_at = now() WHERE id = $1', [id, next.full_name, next.job_title, next.active]);
      if (next.active === false) await tx.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
      const changes: Record<string, unknown> = diff(before, next);
      if (b.assignments) { await replaceAssignments(tx, auth, id, b.assignments); changes.assignments = { to: b.assignments }; }
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: b.assignments ? 'user.permissions_changed' : 'user.update', entityType: 'user', entityId: id, changes, ip: ctx.ip });
    });
    return { status: 204 };
  });

  /* ------------------------------------------------------------ lookups for HSE users */
  r.get('/api/projects', async (ctx) => {
    const auth = requireAuth(ctx);
    const { accessibleProjects } = await import('../services/access');
    return { json: { items: await accessibleProjects(db, auth) } };
  });

  /** People who can be assigned corrective actions for a given project/site. */
  r.get('/api/projects/:id/assignees', async (ctx) => {
    const auth = requireAuth(ctx);
    const { id } = idParam.parse(ctx.params);
    const siteId = z.string().uuid().optional().parse(ctx.query.siteId);
    requirePermission(auth, 'observation.assign', { projectId: id, siteId: siteId ?? null });
    const rows = (await db.query<{ id: string; full_name: string; job_title: string; role: Role; project_id: string | null; site_id: string | null }>(
      `SELECT u.id, u.full_name, u.job_title, ra.role, ra.project_id, ra.site_id
         FROM users u JOIN role_assignments ra ON ra.user_id = u.id
        WHERE ra.organization_id = $1 AND u.active
          AND (ra.project_id IS NULL OR (ra.project_id = $2 AND (ra.site_id IS NULL OR $3::uuid IS NULL OR ra.site_id = $3)))
        ORDER BY u.full_name`, [auth.organizationId, id, siteId ?? null])).rows;
    const seen = new Map<string, { id: string; fullName: string; jobTitle: string }>();
    for (const u of rows) if (roleHas(u.role, 'observation.action') && !seen.has(u.id)) seen.set(u.id, { id: u.id, fullName: u.full_name, jobTitle: u.job_title });
    return { json: { items: [...seen.values()] } };
  });
}
