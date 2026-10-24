import { randomUUID, createHash } from 'node:crypto';
import {
  calculateRisk, can, roleHas, TRANSITION_RULES, allowedTransitions, RiskInputError,
  type ObservationCreate, type ObservationUpdate, type ObservationTransitionInput, type ObservationListQuery, type Transition, type ObservationStatus, type Role,
} from '@forgehse/shared';
import type { Db, Queryable } from '../db/db';
import type { AuthContext } from '../auth/session';
import { scopeFilter } from '../auth/session';
import { HttpError, notFound, forbidden, conflict, badRequest } from '../http/core';
import { audit, diff } from './audit';
import { orgSettings, nextNumber } from './org';
import { sniffContentType, type ObjectStorage } from './storage';

export const OBS_COLUMNS = `
  o.id, o.organization_id AS "organizationId", o.project_id AS "projectId", o.site_id AS "siteId", o.ref_no AS "refNo",
  o.client_ref AS "clientRef", o.type, o.hazard_category AS "hazardCategory", o.location, o.activity, o.description,
  o.immediate_action AS "immediateAction", o.likelihood, o.severity, o.risk_score AS "riskScore", o.risk_band AS "riskBand",
  o.observed_at AS "observedAt", o.reported_by AS "reportedBy", rb.full_name AS "reportedByName",
  o.status, o.assignee_id AS "assigneeId", asg.full_name AS "assigneeName", o.due_date AS "dueDate",
  o.corrective_action AS "correctiveAction", o.action_taken AS "actionTaken", o.preventive_action AS "preventiveAction",
  o.action_submitted_by AS "actionSubmittedBy", o.action_submitted_at AS "actionSubmittedAt",
  o.closed_by AS "closedBy", cb.full_name AS "closedByName", o.closed_at AS "closedAt",
  o.version, o.created_at AS "createdAt", o.updated_at AS "updatedAt",
  p.code AS "projectCode", p.name AS "projectName", s.code AS "siteCode", s.name AS "siteName"`;

export const OBS_FROM = `
  FROM observations o
  JOIN projects p ON p.id = o.project_id
  JOIN sites s ON s.id = o.site_id
  JOIN users rb ON rb.id = o.reported_by
  LEFT JOIN users asg ON asg.id = o.assignee_id
  LEFT JOIN users cb ON cb.id = o.closed_by`;

export interface ObservationRow {
  id: string; organizationId: string; projectId: string; siteId: string; refNo: string; clientRef: string | null;
  type: string; hazardCategory: string; location: string; activity: string; description: string; immediateAction: string;
  likelihood: number; severity: number; riskScore: number; riskBand: string; observedAt: string; reportedBy: string; reportedByName: string;
  status: ObservationStatus; assigneeId: string | null; assigneeName: string | null; dueDate: string | null;
  correctiveAction: string; actionTaken: string; preventiveAction: string; actionSubmittedBy: string | null; actionSubmittedAt: string | null;
  closedBy: string | null; closedByName: string | null; closedAt: string | null; version: number; createdAt: string; updatedAt: string;
  projectCode: string; projectName: string; siteCode: string; siteName: string;
}

function scopeOf(o: { projectId: string; siteId: string }) { return { projectId: o.projectId, siteId: o.siteId }; }

/** Today's date in the organisation's time zone (for due-date / overdue logic). */
async function todayFor(q: Queryable, auth: AuthContext): Promise<string> {
  const tz = (await orgSettings(q, auth.organizationId)).timezone;
  return (await q.query<{ d: string }>("SELECT (now() AT TIME ZONE $1)::date::text AS d", [tz])).rows[0]!.d;
}

/** Load one observation the user may view. Out-of-scope records return 404 (no existence leak). */
export async function getObservation(q: Queryable, auth: AuthContext, id: string, forUpdate = false): Promise<ObservationRow> {
  const r = await q.query<ObservationRow>(
    `SELECT ${OBS_COLUMNS} ${OBS_FROM} WHERE o.id = $1 AND o.organization_id = $2 ${forUpdate ? 'FOR UPDATE OF o' : ''}`,
    [id, auth.organizationId]);
  const o = r.rows[0];
  if (!o || !can(auth.assignments, 'observation.view', { organizationId: auth.organizationId, ...scopeOf(o) })) throw notFound('Observation');
  return o;
}

export async function listObservations(db: Db, auth: AuthContext, f: ObservationListQuery) {
  const params: unknown[] = [];
  const where = [scopeFilter(auth, 'observation.view', params, { org: 'o.organization_id', project: 'o.project_id', site: 'o.site_id' })];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.projectId) add('o.project_id = ?', f.projectId);
  if (f.siteId) add('o.site_id = ?', f.siteId);
  if (f.type) add('o.type = ?', f.type);
  if (f.assignedToMe) add('o.assignee_id = ?', auth.userId);
  if (f.likelihood) add('o.likelihood = ?', f.likelihood);
  if (f.severity) add('o.severity = ?', f.severity);
  if (f.from) add('o.observed_at >= ?::date', f.from);
  if (f.to) add("o.observed_at < (?::date + interval '1 day')", f.to);
  if (f.q) add("(o.ref_no ILIKE ? OR o.description ILIKE $X OR o.location ILIKE $X)".replace(/\$X/g, `$${params.length + 1}`), `%${f.q.replace(/[%_\\]/g, '\\$&')}%`);
  const today = await todayFor(db, auth);
  if (f.status === 'overdue') add("o.status = 'assigned' AND o.due_date < ?::date", today);
  else if (f.status === 'active') where.push("o.status IN ('open','assigned','action_submitted')");
  else if (f.status) add('o.status = ?', f.status);

  const whereSql = where.join(' AND ');
  const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM observations o WHERE ${whereSql}`, params)).rows[0]!.n;
  params.push(f.pageSize, (f.page - 1) * f.pageSize);
  const items = (await db.query<ObservationRow>(
    `SELECT ${OBS_COLUMNS} ${OBS_FROM} WHERE ${whereSql} ORDER BY o.observed_at DESC, o.ref_no DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
  return { items: items.map((o) => ({ ...o, overdue: o.status === 'assigned' && !!o.dueDate && o.dueDate < today })), total, page: f.page, pageSize: f.pageSize };
}

function riskFor(settings: Awaited<ReturnType<typeof orgSettings>>, likelihood: number, severity: number) {
  try { return calculateRisk(likelihood, severity, settings.riskMatrix); }
  catch (e) { if (e instanceof RiskInputError) throw badRequest(e.message); throw e; }
}

export async function createObservation(db: Db, auth: AuthContext, input: ObservationCreate, ip: string): Promise<{ observation: ObservationRow; duplicate: boolean }> {
  if (!can(auth.assignments, 'observation.create', { organizationId: auth.organizationId, projectId: input.projectId, siteId: input.siteId })) throw forbidden();
  const settings = await orgSettings(db, auth.organizationId);

  // Idempotent retry from an offline client: return the record created by the first attempt.
  if (input.clientRef) {
    const existing = (await db.query<{ id: string; reported_by: string }>('SELECT id, reported_by FROM observations WHERE organization_id = $1 AND client_ref = $2', [auth.organizationId, input.clientRef])).rows[0];
    if (existing) {
      if (existing.reported_by !== auth.userId) throw conflict('This submission key has already been used');
      return { observation: await getObservation(db, auth, existing.id), duplicate: true };
    }
  }
  const risk = riskFor(settings, input.likelihood, input.severity);
  if (new Date(input.observedAt).getTime() > Date.now() + 10 * 60_000) throw badRequest('Observation time cannot be in the future');
  if (!settings.hazardCategories.includes(input.hazardCategory)) throw badRequest('Unknown hazard category');

  try {
    const id = await db.transaction(async (tx) => {
      const site = (await tx.query<{ code: string; active: boolean; project_code: string; status: string }>(
        `SELECT s.code, s.active, p.code AS project_code, p.status FROM sites s JOIN projects p ON p.id = s.project_id
          WHERE s.id = $1 AND s.project_id = $2 AND s.organization_id = $3`, [input.siteId, input.projectId, auth.organizationId])).rows[0];
      if (!site) throw badRequest('Site does not belong to this project');
      if (!site.active || site.status === 'closed') throw badRequest('This site or project is not accepting new records');
      const year = new Date(input.observedAt).getUTCFullYear();
      const seq = await nextNumber(tx, auth.organizationId, `OBS:${input.projectId}`, year);
      const refNo = `OBS-${site.project_code}-${year}-${String(seq).padStart(5, '0')}`;
      const row = (await tx.query<{ id: string }>(
        `INSERT INTO observations (organization_id, project_id, site_id, ref_no, client_ref, type, hazard_category, location, activity, description,
                                   immediate_action, likelihood, severity, risk_score, risk_band, observed_at, reported_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
        [auth.organizationId, input.projectId, input.siteId, refNo, input.clientRef ?? null, input.type, input.hazardCategory, input.location,
          input.activity, input.description, input.immediateAction, input.likelihood, input.severity, risk.score, risk.band, input.observedAt, auth.userId])).rows[0]!;
      await tx.query(`INSERT INTO observation_events (organization_id, observation_id, actor_user_id, event, to_status) VALUES ($1,$2,$3,'created','open')`, [auth.organizationId, row.id, auth.userId]);
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'observation.create', entityType: 'observation', entityId: row.id, projectId: input.projectId, summary: `${refNo} (${risk.band})`, ip });
      return row.id;
    });
    return { observation: await getObservation(db, auth, id), duplicate: false };
  } catch (e) {
    // Two concurrent retries with the same clientRef: the loser gets the winner's record.
    if (input.clientRef && (e as { code?: string }).code === '23505') return createObservation(db, auth, input, ip);
    throw e;
  }
}

export async function updateObservation(db: Db, auth: AuthContext, id: string, input: ObservationUpdate, ip: string): Promise<ObservationRow> {
  const settings = await orgSettings(db, auth.organizationId);
  await db.transaction(async (tx) => {
    const o = await getObservation(tx, auth, id, true);
    const scope = { organizationId: auth.organizationId, ...scopeOf(o) };
    const isReporter = o.reportedBy === auth.userId;
    if (!(isReporter && can(auth.assignments, 'observation.create', scope)) && !can(auth.assignments, 'observation.edit', scope)) throw forbidden();
    if (!['open', 'assigned'].includes(o.status)) throw conflict('Only open or assigned observations can be edited');
    if (o.version !== input.version) throw conflict('This observation was changed by someone else. Reload and try again.', { currentVersion: o.version });
    if (input.hazardCategory && !settings.hazardCategories.includes(input.hazardCategory)) throw badRequest('Unknown hazard category');
    const next = {
      type: input.type ?? o.type, hazardCategory: input.hazardCategory ?? o.hazardCategory, location: input.location ?? o.location,
      activity: input.activity ?? o.activity, description: input.description ?? o.description, immediateAction: input.immediateAction ?? o.immediateAction,
      likelihood: input.likelihood ?? o.likelihood, severity: input.severity ?? o.severity, observedAt: input.observedAt ? new Date(input.observedAt).toISOString() : o.observedAt,
    };
    const risk = riskFor(settings, next.likelihood, next.severity);
    const changes = diff(o as unknown as Record<string, unknown>, { ...next, riskScore: risk.score, riskBand: risk.band });
    if (Object.keys(changes).length === 0) return;
    await tx.query(
      `UPDATE observations SET type=$2, hazard_category=$3, location=$4, activity=$5, description=$6, immediate_action=$7,
              likelihood=$8, severity=$9, risk_score=$10, risk_band=$11, observed_at=$12, version = version + 1, updated_at = now() WHERE id = $1`,
      [id, next.type, next.hazardCategory, next.location, next.activity, next.description, next.immediateAction, next.likelihood, next.severity, risk.score, risk.band, next.observedAt]);
    await tx.query(`INSERT INTO observation_events (organization_id, observation_id, actor_user_id, event, data) VALUES ($1,$2,$3,'edited',$4)`, [auth.organizationId, id, auth.userId, changes]);
    await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'observation.update', entityType: 'observation', entityId: id, projectId: o.projectId, summary: o.refNo, changes, ip });
  });
  return getObservation(db, auth, id);
}

/** Which transitions this user may perform right now — used by clients to show buttons. */
export function permittedTransitions(auth: AuthContext, o: ObservationRow, segregate: boolean): Transition[] {
  const scope = { organizationId: auth.organizationId, ...scopeOf(o) };
  return allowedTransitions(o.status).filter((t) => {
    const rule = TRANSITION_RULES[t];
    if (t === 'submit_action') return o.assigneeId === auth.userId || can(auth.assignments, 'observation.assign', scope);
    if (!can(auth.assignments, rule.permission, scope)) return false;
    if (t === 'verify_close' && o.status === 'action_submitted' && segregate && o.actionSubmittedBy === auth.userId) return false;
    if (t === 'verify_close' && o.status === 'open' && !o.immediateAction.trim()) return false;
    return true;
  });
}

async function assertAssignable(tx: Queryable, auth: AuthContext, o: ObservationRow, assigneeId: string) {
  const rows = (await tx.query<{ role: Role }>(
    `SELECT ra.role FROM role_assignments ra JOIN users u ON u.id = ra.user_id
      WHERE ra.user_id = $1 AND ra.organization_id = $2 AND u.active
        AND (ra.project_id IS NULL OR (ra.project_id = $3 AND (ra.site_id IS NULL OR ra.site_id = $4)))`,
    [assigneeId, auth.organizationId, o.projectId, o.siteId])).rows;
  if (!rows.some((r) => roleHas(r.role, 'observation.action'))) throw badRequest('The selected person cannot be assigned actions on this project/site');
}

export async function transitionObservation(db: Db, auth: AuthContext, id: string, input: ObservationTransitionInput, ip: string): Promise<ObservationRow> {
  const settings = await orgSettings(db, auth.organizationId);
  const today = await todayFor(db, auth);
  await db.transaction(async (tx) => {
    const o = await getObservation(tx, auth, id, true);
    const rule = TRANSITION_RULES[input.transition];
    if (!rule.from.includes(o.status)) throw conflict(`Cannot ${input.transition.replace('_', ' ')} an observation that is ${o.status.replace('_', ' ')}`);
    if (o.version !== input.version) throw conflict('This observation was changed by someone else. Reload and try again.', { currentVersion: o.version });
    if (!permittedTransitions(auth, o, settings.segregateVerification).includes(input.transition)) {
      if (input.transition === 'verify_close' && o.actionSubmittedBy === auth.userId) throw forbidden('The person who submitted the corrective action cannot verify it');
      if (input.transition === 'verify_close' && o.status === 'open') throw badRequest('Record the immediate action taken before closing on the spot');
      throw forbidden();
    }

    const sets: string[] = ['status = $2', 'version = version + 1', 'updated_at = now()'];
    const vals: unknown[] = [id, rule.to];
    const set = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    const data: Record<string, unknown> = {};

    switch (input.transition) {
      case 'assign':
        if (input.dueDate < today) throw badRequest('Due date cannot be in the past');
        await assertAssignable(tx, auth, o, input.assigneeId);
        set('assignee_id', input.assigneeId); set('due_date', input.dueDate);
        if (input.correctiveAction !== undefined) set('corrective_action', input.correctiveAction);
        Object.assign(data, { assigneeId: input.assigneeId, dueDate: input.dueDate, correctiveAction: input.correctiveAction });
        break;
      case 'submit_action':
        set('action_taken', input.actionTaken); set('preventive_action', input.preventiveAction ?? '');
        set('action_submitted_by', auth.userId); sets.push('action_submitted_at = now()');
        Object.assign(data, { actionTaken: input.actionTaken, preventiveAction: input.preventiveAction });
        break;
      case 'verify_close':
        set('closed_by', auth.userId); sets.push('closed_at = now()');
        break;
      case 'reopen':
        sets.push('closed_by = NULL', 'closed_at = NULL', 'action_submitted_by = NULL', 'action_submitted_at = NULL');
        break;
      case 'reject_action':
      case 'cancel':
        break;
    }
    await tx.query(`UPDATE observations SET ${sets.join(', ')} WHERE id = $1`, vals);
    await tx.query(
      `INSERT INTO observation_events (organization_id, observation_id, actor_user_id, event, from_status, to_status, comment, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [auth.organizationId, id, auth.userId, input.transition, o.status, rule.to, input.comment ?? '', Object.keys(data).length ? data : null]);
    await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: `observation.${input.transition}`, entityType: 'observation', entityId: id, projectId: o.projectId, summary: `${o.refNo}: ${o.status} → ${rule.to}`, changes: { comment: input.comment, ...data }, ip });
  });
  return getObservation(db, auth, id);
}

export async function observationDetail(db: Db, auth: AuthContext, id: string) {
  const o = await getObservation(db, auth, id);
  const settings = await orgSettings(db, auth.organizationId);
  const today = await todayFor(db, auth);
  const [events, attachments] = await Promise.all([
    db.query(`SELECT e.id, e.event, e.from_status AS "fromStatus", e.to_status AS "toStatus", e.comment, e.data, e.created_at AS "createdAt",
                     u.full_name AS "actorName" FROM observation_events e JOIN users u ON u.id = e.actor_user_id
               WHERE e.observation_id = $1 ORDER BY e.id`, [id]),
    db.query(`SELECT a.id, a.filename, a.content_type AS "contentType", a.size_bytes AS "sizeBytes", a.purpose, a.created_at AS "createdAt", u.full_name AS "uploadedByName"
                FROM attachments a JOIN users u ON u.id = a.uploaded_by WHERE a.entity_type = 'observation' AND a.entity_id = $1 AND a.deleted_at IS NULL ORDER BY a.created_at`, [id]),
  ]);
  const scope = { organizationId: auth.organizationId, ...scopeOf(o) };
  return {
    observation: { ...o, overdue: o.status === 'assigned' && !!o.dueDate && o.dueDate < today },
    events: events.rows,
    attachments: attachments.rows,
    can: {
      transitions: permittedTransitions(auth, o, settings.segregateVerification),
      edit: ['open', 'assigned'].includes(o.status) && (can(auth.assignments, 'observation.edit', scope) || (o.reportedBy === auth.userId && can(auth.assignments, 'observation.create', scope))),
      attach: !['closed', 'cancelled'].includes(o.status) && (can(auth.assignments, 'observation.create', scope) || o.assigneeId === auth.userId),
    },
  };
}

export async function addAttachment(db: Db, storage: ObjectStorage, auth: AuthContext, id: string, data: Buffer, filename: string, purpose: 'evidence' | 'closure', ip: string) {
  const o = await getObservation(db, auth, id);
  const scope = { organizationId: auth.organizationId, ...scopeOf(o) };
  if (!(can(auth.assignments, 'observation.create', scope) || o.assigneeId === auth.userId)) throw forbidden();
  if (['closed', 'cancelled'].includes(o.status)) throw conflict('Attachments cannot be added to a closed or cancelled observation');
  const sniffed = sniffContentType(data);
  if (!sniffed) throw new HttpError(415, 'unsupported_media_type', 'Only JPEG, PNG, WebP, HEIC images and PDF documents are accepted');
  const count = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM attachments WHERE entity_id = $1 AND deleted_at IS NULL`, [id])).rows[0]!.n;
  if (count >= 20) throw conflict('An observation can have at most 20 attachments');

  const attId = randomUUID();
  const key = `${auth.organizationId}/observations/${id}/${attId}`;
  const safeName = (filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || `file.${sniffed.ext}`);
  await storage.put(key, data, sniffed.type);
  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO attachments (id, organization_id, project_id, entity_type, entity_id, purpose, filename, content_type, size_bytes, sha256, storage_key, uploaded_by)
         VALUES ($1,$2,$3,'observation',$4,$5,$6,$7,$8,$9,$10,$11)`,
        [attId, auth.organizationId, o.projectId, id, purpose, safeName, sniffed.type, data.length, createHash('sha256').update(data).digest('hex'), key, auth.userId]);
      await tx.query(`INSERT INTO observation_events (organization_id, observation_id, actor_user_id, event, data) VALUES ($1,$2,$3,'attachment_added',$4)`,
        [auth.organizationId, id, auth.userId, { attachmentId: attId, filename: safeName }]);
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'attachment.upload', entityType: 'observation', entityId: id, projectId: o.projectId, summary: `${o.refNo}: ${safeName}`, ip });
    });
  } catch (e) {
    await storage.delete(key);
    throw e;
  }
  return { id: attId, filename: safeName, contentType: sniffed.type, sizeBytes: data.length };
}

export async function getAttachment(db: Db, storage: ObjectStorage, auth: AuthContext, attachmentId: string) {
  const a = (await db.query<{ entity_id: string; filename: string; content_type: string; storage_key: string }>(
    `SELECT entity_id, filename, content_type, storage_key FROM attachments WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [attachmentId, auth.organizationId])).rows[0];
  if (!a) throw notFound('Attachment');
  await getObservation(db, auth, a.entity_id); // enforces project/site scope
  return { filename: a.filename, contentType: a.content_type, data: await storage.get(a.storage_key) };
}
