import { auditQuerySchema } from '@forgehse/shared';
import type { Deps } from '../app';
import type { Router } from '../http/core';
import { requireAuth, requirePermission } from '../auth/session';

export function registerAuditRoutes(r: Router, { db }: Deps) {
  /** Organisation-wide audit trail — restricted to org-wide audit.view holders. */
  r.get('/api/audit', async (ctx) => {
    const auth = requireAuth(ctx);
    requirePermission(auth, 'audit.view');
    const q = ctx.parseQuery(auditQuerySchema);
    const params: unknown[] = [auth.organizationId];
    const where = ['a.organization_id = $1'];
    if (q.entityType) { params.push(q.entityType); where.push(`a.entity_type = $${params.length}`); }
    if (q.entityId) { params.push(q.entityId); where.push(`a.entity_id = $${params.length}`); }
    const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log a WHERE ${where.join(' AND ')}`, params)).rows[0]!.n;
    params.push(q.pageSize, (q.page - 1) * q.pageSize);
    const rows = await db.query(
      `SELECT a.id, a.action, a.entity_type AS "entityType", a.entity_id AS "entityId", a.summary, a.changes, a.ip, a.created_at AS "createdAt",
              u.full_name AS "actorName", u.email AS "actorEmail"
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { json: { items: rows.rows, total, page: q.page, pageSize: q.pageSize } };
  });
}
