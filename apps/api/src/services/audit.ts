import type { Queryable } from '../db/db';

export interface AuditEntry {
  organizationId: string | null;
  actorUserId: string | null;
  action: string; // e.g. observation.create, observation.verify_close, user.update, auth.login_failed
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
  summary?: string;
  changes?: Record<string, unknown> | null;
  ip?: string | null;
}

/** Writes an append-only audit row. Call inside the same transaction as the change it records. */
export async function audit(q: Queryable, e: AuditEntry): Promise<void> {
  await q.query(
    `INSERT INTO audit_log (organization_id, actor_user_id, action, entity_type, entity_id, project_id, summary, changes, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [e.organizationId, e.actorUserId, e.action, e.entityType, e.entityId ?? null, e.projectId ?? null, e.summary ?? '', e.changes ?? null, e.ip ?? null],
  );
}

/** Field-level diff for audit `changes`. Only includes keys whose values changed. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    if (after[k] === undefined) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[k] = { from: before[k], to: after[k] };
  }
  return out;
}
