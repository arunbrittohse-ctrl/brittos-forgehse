/**
 * Hazard register, risk engine and risk insights (Phase 4).
 *
 *   GET  /api/hazards/meta                       categories, matrix, control types
 *   GET  /api/hazards                            register with filters + summary counts
 *   POST /api/hazards                            new draft entry
 *   POST /api/hazards/import-document            draft entries from a Document Studio risk register
 *   GET  /api/hazards/insights                   explainable rule-based alerts + trends
 *   GET  /api/hazards/:id                        entry + engine evaluation + permissions + links + lessons
 *   PATCH /api/hazards/:id                       save (draft or rejected)
 *   POST /api/hazards/:id/transition             submit | review | approve | reject | revise | archive
 *   GET  /api/hazards/:id/revisions[/:rid]       append-only history
 *
 * The approval route depends on the engine: low/medium entries need one independent reviewer;
 * high/critical entries need a review AND a separate approval by a risk.approve holder; a critical
 * residual risk can never be approved.
 */
import { z } from 'zod';
import {
  hazardInputSchema, evaluateHazard, registerCategories, reviewState, checkTransition, hazardLifecycle, buildInsights, verifiedLessons,
  CONTROL_TYPES, CONTROL_TYPE_LABELS, EFFECTIVENESS, EFFECTIVENESS_LABELS, ADDITIONAL_STATUSES, HAZARD_STATUSES, HAZARD_STATUS_LABELS,
  INSIGHT_DISCLAIMER, UNAVAILABLE_SOURCES, revisionLabel, rateOnMatrix,
  type HazardInput, type HazardStatus, type RiskMatrixConfig, type RiskBand, type ObsRow, type HazardRow, type DocContent,
} from '@forgehse/shared';
import type { Deps } from '../app';
import type { Router } from '../http/core';
import { badRequest, conflict, forbidden, notFound, HttpError } from '../http/core';
import { requireAuth, hasAnywhere, projectReach, requireProjectReach, type AuthContext } from '../auth/session';
import { orgSettings, nextNumber } from '../services/org';
import { audit } from '../services/audit';
import { compactParams, type Queryable } from '../db/db';

interface HazRow {
  id: string; organization_id: string; project_id: string; site_id: string | null; ref_no: string; category: string; activity: string; work_package: string;
  description: string; consequences: string; persons_exposed: string; existing_controls: HazardInput['existingControls']; initial_likelihood: number | null; initial_severity: number | null;
  additional_controls: HazardInput['additionalControls']; residual_likelihood: number | null; residual_severity: number | null; residual_justification: string;
  initial_score: number | null; initial_band: RiskBand | null; residual_score: number | null; residual_band: RiskBand | null; risk_matrix: RiskMatrixConfig;
  review_date: string | null; revision: number; status: HazardStatus; source_document_id: string | null;
  created_by: string; updated_by: string; submitted_by: string | null; submitted_at: string | null; reviewed_by: string | null; reviewed_at: string | null;
  approved_by: string | null; approved_at: string | null; decision_note: string | null; archived_reason: string | null; version: number; created_at: string; updated_at: string;
  creator_name: string; updater_name: string; submitter_name: string | null; reviewer_name: string | null; approver_name: string | null;
  project_code: string; project_name: string; site_name: string | null;
}

const SELECT = `SELECT h.*, h.review_date::text AS review_date, cu.full_name AS creator_name, uu.full_name AS updater_name, su.full_name AS submitter_name,
    ru.full_name AS reviewer_name, au.full_name AS approver_name, p.code AS project_code, p.name AS project_name, s.name AS site_name
  FROM hazard_register h JOIN users cu ON cu.id = h.created_by JOIN users uu ON uu.id = h.updated_by
  LEFT JOIN users su ON su.id = h.submitted_by LEFT JOIN users ru ON ru.id = h.reviewed_by LEFT JOIN users au ON au.id = h.approved_by
  JOIN projects p ON p.id = h.project_id LEFT JOIN sites s ON s.id = h.site_id`;

/** Assessors (risk.manage) see every entry in their projects; everyone else with risk.view sees approved entries only. */
function visibility(auth: AuthContext, params: unknown[]) {
  params.push(auth.organizationId);
  const ors: string[] = [];
  const manage = projectReach(auth, 'risk.manage');
  if (manage.orgWide) ors.push('TRUE');
  else if (manage.projectIds.length) { params.push(manage.projectIds); ors.push(`h.project_id = ANY($${params.length}::uuid[])`); }
  const view = projectReach(auth, 'risk.view');
  if (view.orgWide) ors.push(`h.status = 'approved'`);
  else if (view.projectIds.length) { params.push(view.projectIds); ors.push(`(h.status = 'approved' AND h.project_id = ANY($${params.length}::uuid[]))`); }
  return `h.organization_id = $1 AND (${ors.length ? ors.join(' OR ') : 'FALSE'})`;
}

const reach = (auth: AuthContext, perm: 'risk.manage' | 'risk.approve', projectId: string) => { const r = projectReach(auth, perm); return r.orgWide || r.projectIds.includes(projectId); };
const today = () => new Date().toISOString().slice(0, 10);

function inputOf(h: HazRow): HazardInput {
  return {
    projectId: h.project_id, siteId: h.site_id, category: h.category, activity: h.activity, workPackage: h.work_package, description: h.description,
    consequences: h.consequences, personsExposed: h.persons_exposed, existingControls: h.existing_controls, initialLikelihood: h.initial_likelihood,
    initialSeverity: h.initial_severity, additionalControls: h.additional_controls, residualLikelihood: h.residual_likelihood, residualSeverity: h.residual_severity,
    residualJustification: h.residual_justification, reviewDate: h.review_date, links: [],
  };
}

function permissionsFor(auth: AuthContext, h: HazRow) {
  const ev = evaluateHazard(inputOf(h), h.risk_matrix, today());
  const manage = reach(auth, 'risk.manage', h.project_id);
  const approver = reach(auth, 'risk.approve', h.project_id);
  const independent = h.submitted_by !== auth.userId;
  const blocking = ev.issues.some((i) => i.blocking);
  const canApprove = !blocking && !ev.intolerable && independent && (
    ev.requiresAuthorisedApproval
      ? h.status === 'reviewed' && approver && h.reviewed_by !== auth.userId
      : (h.status === 'submitted' || h.status === 'reviewed') && manage
  );
  return {
    edit: (h.status === 'draft' || h.status === 'rejected') && manage,
    submit: h.status === 'draft' && manage && !blocking,
    review: h.status === 'submitted' && manage && independent && ev.requiresAuthorisedApproval,
    approve: canApprove,
    reject: (h.status === 'submitted' || h.status === 'reviewed') && manage && independent,
    revise: h.status === 'approved' && manage,
    archive: ['draft', 'approved', 'rejected'].includes(h.status) && (approver || (h.status === 'draft' && h.created_by === auth.userId)),
  };
}

function view(auth: AuthContext, h: HazRow, cats: ReturnType<typeof registerCategories>) {
  const ev = evaluateHazard(inputOf(h), h.risk_matrix, today());
  return {
    id: h.id, ref: h.ref_no, ...inputOf(h), categoryLabel: cats.find((c) => c.key === h.category)?.label ?? h.category,
    project: { id: h.project_id, code: h.project_code, name: h.project_name }, site: h.site_id ? { id: h.site_id, name: h.site_name } : null,
    matrix: h.risk_matrix, evaluation: ev, reviewState: reviewState(h.review_date, today()),
    status: h.status, statusLabel: HAZARD_STATUS_LABELS[h.status], revision: h.revision, revisionLabel: revisionLabel(h.revision),
    sourceDocumentId: h.source_document_id,
    createdBy: { id: h.created_by, name: h.creator_name }, updatedBy: h.updater_name,
    submittedBy: h.submitted_by ? { id: h.submitted_by, name: h.submitter_name } : null, submittedAt: h.submitted_at,
    reviewedBy: h.reviewed_by ? { id: h.reviewed_by, name: h.reviewer_name } : null, reviewedAt: h.reviewed_at,
    approvedBy: h.approved_by ? { id: h.approved_by, name: h.approver_name } : null, approvedAt: h.approved_at,
    decisionNote: h.decision_note, archivedReason: h.archived_reason, version: h.version, createdAt: h.created_at, updatedAt: h.updated_at,
    permissions: permissionsFor(auth, h),
  };
}

function scoreCols(i: HazardInput, m: RiskMatrixConfig) {
  const a = rateOnMatrix(i.initialLikelihood, i.initialSeverity, m), b = rateOnMatrix(i.residualLikelihood, i.residualSeverity, m);
  return { initial_score: a?.score ?? null, initial_band: a?.band ?? null, residual_score: b?.score ?? null, residual_band: b?.band ?? null };
}

function cols(i: HazardInput, m: RiskMatrixConfig): Record<string, unknown> {
  return {
    site_id: i.siteId, category: i.category, activity: i.activity, work_package: i.workPackage, description: i.description, consequences: i.consequences,
    persons_exposed: i.personsExposed, existing_controls: i.existingControls, initial_likelihood: i.initialLikelihood, initial_severity: i.initialSeverity,
    additional_controls: i.additionalControls, residual_likelihood: i.residualLikelihood, residual_severity: i.residualSeverity,
    residual_justification: i.residualJustification, review_date: i.reviewDate, ...scoreCols(i, m),
  };
}

async function snapshot(tx: Queryable, h: HazRow | Record<string, unknown>, event: string, actor: string, note: string) {
  const r = h as HazRow;
  const { creator_name: _a, updater_name: _b, submitter_name: _c, reviewer_name: _d, approver_name: _e, project_code: _f, project_name: _g, site_name: _h, ...snap } = r;
  await tx.query(`INSERT INTO hazard_register_revisions (organization_id, hazard_id, event, revision, version, status, snapshot, note, actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [r.organization_id, r.id, event, r.revision, r.version, r.status, JSON.stringify(snap), note, actor]);
}

const versionNote = z.object({ version: z.number().int().min(1), note: z.string().trim().max(1000).default('') });

export function registerHazardRoutes(r: Router, { db }: Deps) {
  async function categories(orgId: string) {
    const s = (await db.query<{ settings: unknown }>('SELECT settings FROM organizations WHERE id = $1', [orgId])).rows[0]?.settings;
    return registerCategories(s);
  }

  async function load(auth: AuthContext, id: string | undefined): Promise<HazRow> {
    if (!z.string().uuid().safeParse(id).success) throw notFound('Hazard');
    const p: unknown[] = [];
    const W = visibility(auth, p);
    p.push(id);
    const row = (await db.query<HazRow>(...compactParams(`${SELECT} WHERE ${W} AND h.id = $${p.length}`, p))).rows[0];
    if (!row) throw notFound('Hazard');
    return row;
  }

  async function validateInput(auth: AuthContext, i: HazardInput) {
    const cats = await categories(auth.organizationId);
    if (!cats.some((c) => c.key === i.category)) throw badRequest('Unknown hazard category', [{ path: 'category', message: 'Choose a configured category' }]);
    if (i.siteId && !(await db.query('SELECT 1 FROM sites WHERE id = $1 AND project_id = $2 AND organization_id = $3', [i.siteId, i.projectId, auth.organizationId])).rowCount) throw badRequest('Unknown site for this project');
    for (const l of i.links) {
      const table = l.type === 'document' ? 'hse_documents' : 'observations';
      if (!(await db.query(`SELECT 1 FROM ${table} WHERE id = $1 AND organization_id = $2 AND project_id = $3`, [l.id, auth.organizationId, i.projectId])).rowCount) throw badRequest(`Linked ${l.type} not found in this project`);
    }
  }

  async function replaceLinks(tx: Queryable, auth: AuthContext, hazardId: string, links: HazardInput['links']) {
    await tx.query('DELETE FROM hazard_links WHERE hazard_id = $1', [hazardId]);
    for (const l of links) await tx.query('INSERT INTO hazard_links (organization_id, hazard_id, link_type, target_id, created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [auth.organizationId, hazardId, l.type, l.id, auth.userId]);
  }

  async function links(auth: AuthContext, hazardId: string) {
    const rows = await db.query<{ type: 'document' | 'observation'; id: string; ref: string; label: string; status: string }>(
      `SELECT l.link_type AS type, l.target_id AS id, COALESCE(d.doc_number, o.ref_no) AS ref, COALESCE(d.title, left(o.description, 120)) AS label, COALESCE(d.status, o.status) AS status
         FROM hazard_links l LEFT JOIN hse_documents d ON l.link_type = 'document' AND d.id = l.target_id AND d.organization_id = l.organization_id
         LEFT JOIN observations o ON l.link_type = 'observation' AND o.id = l.target_id AND o.organization_id = l.organization_id
        WHERE l.hazard_id = $1 AND l.organization_id = $2 ORDER BY l.created_at`, [hazardId, auth.organizationId]);
    return rows.rows;
  }

  async function observationRows(auth: AuthContext, projectId?: string): Promise<ObsRow[]> {
    const reachObs = projectReach(auth, 'observation.view');
    const p: unknown[] = [auth.organizationId];
    let w = 'o.organization_id = $1';
    if (!reachObs.orgWide) { p.push(reachObs.projectIds); w += ` AND o.project_id = ANY($${p.length}::uuid[])`; }
    if (projectId) { p.push(projectId); w += ` AND o.project_id = $${p.length}`; }
    const rows = await db.query<{ id: string; ref: string; site_id: string; site_name: string; category: string; type: string; band: RiskBand; status: string; due_date: string | null; observed_at: string; description: string; closed_at: string | null; verification: string | null }>(
      `SELECT o.id, o.ref_no AS ref, o.site_id, s.name AS site_name, o.hazard_category AS category, o.type, o.risk_band AS band, o.status, o.due_date::text AS due_date,
              o.observed_at, o.description, o.closed_at,
              NULLIF(trim(concat_ws(' — ', NULLIF(o.action_taken, ''), (SELECT e.comment FROM observation_events e WHERE e.observation_id = o.id AND e.event = 'verify_close' AND e.comment <> '' ORDER BY e.id DESC LIMIT 1))), '') AS verification
         FROM observations o JOIN sites s ON s.id = o.site_id WHERE ${w} AND o.observed_at > now() - interval '400 days' ORDER BY o.observed_at DESC LIMIT 2000`, p);
    return rows.rows.map((x) => ({ id: x.id, ref: x.ref, siteId: x.site_id, siteName: x.site_name, category: x.category, type: x.type, band: x.band, status: x.status, dueDate: x.due_date, observedAt: new Date(x.observed_at).toISOString(), description: x.description, closedAt: x.closed_at, verification: x.verification }));
  }

  /** Applies an optimistic-version update and writes the snapshot + audit row. */
  async function mutate(auth: AuthContext, h: HazRow, version: number, set: Record<string, unknown>, event: string, note: string, ip: string, action: string, after?: (tx: Queryable) => Promise<void>) {
    if (h.version !== version) throw conflict('This hazard was changed by someone else. Reload it and try again.');
    const k = Object.keys(set);
    const v = Object.values(set).map((x) => (x !== null && typeof x === 'object' && !(x instanceof Date) ? JSON.stringify(x) : x));
    const ok = await db.transaction(async (tx) => {
      const u = await tx.query<HazRow>(`UPDATE hazard_register SET ${k.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_by = $${k.length + 1}, version = version + 1, updated_at = now()
         WHERE id = $${k.length + 2} AND version = $${k.length + 3} RETURNING *, review_date::text AS review_date`, [...v, auth.userId, h.id, version]);
      const n = u.rows[0];
      if (!n) return false;
      if (after) await after(tx);
      await snapshot(tx, n, event, auth.userId, note);
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action, entityType: 'hazard', entityId: h.id, projectId: h.project_id, summary: `${h.ref_no} ${revisionLabel(n.revision)}: ${note || event}`.slice(0, 500), ip });
      return true;
    });
    if (!ok) throw conflict('This hazard was changed by someone else. Reload it and try again.');
    return view(auth, await load(auth, h.id), await categories(auth.organizationId));
  }

  async function create(tx: Queryable, auth: AuthContext, i: HazardInput, matrix: RiskMatrixConfig, sourceDocumentId: string | null, event: 'created' | 'imported', ip: string) {
    const n = await nextNumber(tx, auth.organizationId, 'hazard', new Date().getFullYear());
    const ref = `HAZ-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`;
    const c = { organization_id: auth.organizationId, project_id: i.projectId, ref_no: ref, ...cols(i, matrix), risk_matrix: matrix, source_document_id: sourceDocumentId, created_by: auth.userId, updated_by: auth.userId };
    const k = Object.keys(c);
    const row = (await tx.query<HazRow>(`INSERT INTO hazard_register (${k.join(',')}) VALUES (${k.map((_, x) => `$${x + 1}`).join(',')}) RETURNING *, review_date::text AS review_date`,
      Object.values(c).map((x) => (x !== null && typeof x === 'object' ? JSON.stringify(x) : x)))).rows[0]!;
    await replaceLinks(tx, auth, row.id, i.links);
    await snapshot(tx, row, event, auth.userId, event === 'imported' ? 'Imported from a Document Studio risk register' : 'Created');
    await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: `hazard.${event === 'imported' ? 'import' : 'create'}`, entityType: 'hazard', entityId: row.id, projectId: i.projectId, summary: `${ref}: ${i.activity.slice(0, 120)}`, ip });
    return row.id;
  }

  r.get('/api/hazards/meta', async (ctx) => {
    const auth = requireAuth(ctx);
    if (!hasAnywhere(auth, 'risk.view') && !hasAnywhere(auth, 'risk.manage')) throw forbidden();
    const s = await orgSettings(db, auth.organizationId);
    return { json: {
      categories: await categories(auth.organizationId), matrix: s.riskMatrix,
      controlTypes: CONTROL_TYPES.map((v) => ({ value: v, label: CONTROL_TYPE_LABELS[v] })), effectiveness: EFFECTIVENESS.map((v) => ({ value: v, label: EFFECTIVENESS_LABELS[v] })),
      additionalStatuses: ADDITIONAL_STATUSES, statuses: HAZARD_STATUSES.map((v) => ({ value: v, label: HAZARD_STATUS_LABELS[v] })),
    } };
  });

  r.get('/api/hazards', async (ctx) => {
    const auth = requireAuth(ctx);
    if (!hasAnywhere(auth, 'risk.view') && !hasAnywhere(auth, 'risk.manage')) throw forbidden();
    const q = z.object({
      projectId: z.string().uuid().optional(), siteId: z.string().uuid().optional(), category: z.string().max(60).optional(),
      status: z.enum(HAZARD_STATUSES).optional(), band: z.enum(['low', 'medium', 'high', 'critical', 'unrated']).optional(),
      review: z.enum(['overdue', 'due_soon']).optional(), q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).max(1000).default(1),
    }).parse(ctx.query);
    const p: unknown[] = [];
    const where = [visibility(auth, p)];
    const add = (sql: string, v: unknown) => { p.push(v); where.push(sql.replace('?', `$${p.length}`)); };
    if (q.projectId) add('h.project_id = ?', q.projectId);
    if (q.siteId) add('h.site_id = ?', q.siteId);
    if (q.category) add('h.category = ?', q.category);
    if (q.status) add('h.status = ?', q.status); else where.push(`h.status <> 'archived'`);
    if (q.band === 'unrated') where.push('h.residual_band IS NULL'); else if (q.band) add('h.residual_band = ?', q.band);
    if (q.review === 'overdue') where.push(`h.status = 'approved' AND h.review_date < current_date`);
    if (q.review === 'due_soon') where.push(`h.status = 'approved' AND h.review_date BETWEEN current_date AND current_date + 14`);
    if (q.q) add(`(h.ref_no ILIKE ? OR h.activity ILIKE $${p.length + 1} OR h.description ILIKE $${p.length + 1})`, `%${q.q.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
    const W = where.join(' AND ');
    const cats = await categories(auth.organizationId);
    const [rows, total, sum] = await Promise.all([
      db.query<HazRow>(...compactParams(`${SELECT} WHERE ${W} ORDER BY COALESCE(h.residual_score, h.initial_score, 0) DESC, h.updated_at DESC LIMIT 25 OFFSET ${(q.page - 1) * 25}`, p)),
      db.query<{ n: number }>(...compactParams(`SELECT count(*)::int AS n FROM hazard_register h WHERE ${W}`, p)),
      db.query<{ band: string | null; category: string; status: string; overdue: boolean; n: number }>(...compactParams(
        `SELECT h.residual_band AS band, h.category, h.status, (h.status = 'approved' AND h.review_date < current_date) AS overdue, count(*)::int AS n FROM hazard_register h WHERE ${W} GROUP BY 1,2,3,4`, p)),
    ]);
    const tally = (f: (x: (typeof sum.rows)[number]) => string) => sum.rows.reduce<Record<string, number>>((a, x) => { const k = f(x); a[k] = (a[k] ?? 0) + x.n; return a; }, {});
    return { json: {
      items: rows.rows.map((h) => { const v = view(auth, h, cats); return { id: v.id, ref: v.ref, categoryLabel: v.categoryLabel, activity: v.activity, project: v.project.code, site: v.site?.name ?? null, initial: v.evaluation.initial, residual: v.evaluation.residual, status: v.status, statusLabel: v.statusLabel, revisionLabel: v.revisionLabel, reviewDate: v.reviewDate, reviewState: v.reviewState, updatedAt: v.updatedAt }; }),
      total: total.rows[0]!.n, page: q.page, pageSize: 25,
      summary: { byBand: tally((x) => x.band ?? 'unrated'), byCategory: tally((x) => cats.find((c) => c.key === x.category)?.label ?? x.category), byStatus: tally((x) => x.status), reviewOverdue: sum.rows.filter((x) => x.overdue).reduce((n, x) => n + x.n, 0) },
    } };
  });

  r.post('/api/hazards', async (ctx) => {
    const auth = requireAuth(ctx);
    const i = hazardInputSchema.parse(await ctx.json(z.unknown()));
    requireProjectReach(auth, 'risk.manage', i.projectId);
    await validateInput(auth, i);
    const s = await orgSettings(db, auth.organizationId);
    const id = await db.transaction((tx) => create(tx, auth, i, s.riskMatrix, null, 'created', ctx.ip));
    return { status: 201, json: view(auth, await load(auth, id), await categories(auth.organizationId)) };
  });

  r.post('/api/hazards/import-document', async (ctx) => {
    const auth = requireAuth(ctx);
    const { documentId, category } = z.object({ documentId: z.string().uuid(), category: z.string().max(60) }).parse(await ctx.json(z.unknown()));
    const doc = (await db.query<{ id: string; project_id: string | null; site_id: string | null; content: DocContent; risk_matrix: RiskMatrixConfig; title: string; doc_number: string; created_by: string; status: string }>(
      'SELECT id, project_id, site_id, content, risk_matrix, title, doc_number, created_by, status FROM hse_documents WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL', [documentId, auth.organizationId])).rows[0];
    if (!doc || !doc.project_id) throw notFound('Document');
    requireProjectReach(auth, 'risk.manage', doc.project_id);
    const cats = await categories(auth.organizationId);
    if (!cats.some((c) => c.key === category)) throw badRequest('Unknown hazard category');
    const rows = doc.content.riskRows.filter((x) => x.hazard.trim() && x.origin !== 'model' && x.initialLikelihood && x.initialSeverity);
    if (!rows.length) throw new HttpError(422, 'nothing_to_import', 'No assessed risk rows to import. Rate the initial risk of at least one row (model suggestions must be accepted first).');
    const ids = await db.transaction(async (tx) => {
      const out: string[] = [];
      for (const x of rows) {
        // Controls come across as "not assessed": the register asks for effectiveness evidence before any reduction is accepted.
        const i: HazardInput = {
          projectId: doc.project_id!, siteId: doc.site_id, category, activity: x.step || doc.title, workPackage: '', description: x.hazard, consequences: x.consequence || 'Not stated',
          personsExposed: x.exposed || 'Not stated', existingControls: x.existingControls.map((t) => ({ text: t, type: /^engineering/i.test(t) ? 'engineering' as const : /^elimination/i.test(t) ? 'elimination' as const : /^substitution/i.test(t) ? 'substitution' as const : /^ppe/i.test(t) ? 'ppe' as const : 'administrative' as const, effectiveness: 'not_assessed' as const, basis: '' })),
          initialLikelihood: x.initialLikelihood, initialSeverity: x.initialSeverity, additionalControls: x.additionalControls.map((t) => ({ text: t, type: 'administrative' as const, effectiveness: 'not_assessed' as const, basis: '', owner: x.controlOwner, dueDate: null, status: 'planned' as const })),
          residualLikelihood: x.residualLikelihood, residualSeverity: x.residualSeverity, residualJustification: '', reviewDate: null, links: [{ type: 'document', id: doc.id }],
        };
        out.push(await create(tx, auth, i, doc.risk_matrix, doc.id, 'imported', ctx.ip));
      }
      return out;
    });
    return { status: 201, json: { imported: ids.length, ids, skipped: doc.content.riskRows.length - rows.length } };
  });

  r.get('/api/hazards/insights', async (ctx) => {
    const auth = requireAuth(ctx);
    if (!hasAnywhere(auth, 'risk.view') && !hasAnywhere(auth, 'risk.manage')) throw forbidden();
    const q = z.object({ projectId: z.string().uuid().optional() }).parse(ctx.query);
    const cats = await categories(auth.organizationId);
    const p: unknown[] = [];
    const W = visibility(auth, p) + (q.projectId ? ` AND h.project_id = $${p.push(q.projectId)}` : '') + ` AND h.status <> 'archived'`;
    const hz = await db.query<HazRow>(...compactParams(`${SELECT} WHERE ${W}`, p));
    const t = today();
    const hazards: HazardRow[] = hz.rows.map((h) => ({
      id: h.id, ref: h.ref_no, category: h.category, categoryLabel: cats.find((c) => c.key === h.category)?.label ?? h.category, status: h.status, residualBand: h.residual_band,
      reviewDate: h.review_date, activity: h.activity, overdueControls: h.additional_controls.filter((c) => c.status === 'planned' && c.dueDate && c.dueDate < t).map((c) => ({ text: c.text, dueDate: c.dueDate! })),
    }));
    const observations = hasAnywhere(auth, 'observation.view') ? await observationRows(auth, q.projectId) : [];
    const months = [...Array(6)].map((_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - (5 - i)); return d.toISOString().slice(0, 7); });
    const trendCats = [...new Set(observations.map((o) => o.category))];
    const trend = trendCats.map((c) => ({ category: c, counts: months.map((m) => observations.filter((o) => o.category === c && o.observedAt.startsWith(m) && o.status !== 'cancelled').length) }))
      .filter((x) => x.counts.some(Boolean)).sort((a, b) => b.counts.reduce((x, y) => x + y) - a.counts.reduce((x, y) => x + y)).slice(0, 6);
    return { json: {
      insights: buildInsights({ today: t, observations, hazards, categories: cats }), disclaimer: INSIGHT_DISCLAIMER, unavailable: UNAVAILABLE_SOURCES,
      trend: { months, series: trend, source: 'Observations recorded in FORGEHSE (excluding cancelled)' },
      counts: { hazards: hazards.length, observations: observations.length },
    } };
  });

  r.get('/api/hazards/:id', async (ctx) => {
    const auth = requireAuth(ctx);
    const h = await load(auth, ctx.params.id);
    const cats = await categories(auth.organizationId);
    const lessons = hasAnywhere(auth, 'observation.view') ? verifiedLessons(cats.find((c) => c.key === h.category), await observationRows(auth, h.project_id)) : [];
    return { json: { ...view(auth, h, cats), links: await links(auth, h.id), lessons } };
  });

  r.patch('/api/hazards/:id', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = hazardInputSchema.omit({ projectId: true }).extend({ version: z.number().int().min(1), changeNote: z.string().trim().max(500).default('') }).parse(await ctx.json(z.unknown()));
    const h = await load(auth, ctx.params.id);
    if (!permissionsFor(auth, h).edit) throw h.status === 'draft' || h.status === 'rejected' ? forbidden() : conflict(`A ${HAZARD_STATUS_LABELS[h.status].toLowerCase()} entry cannot be edited${h.status === 'approved' ? '; reassess it to start a new revision' : ''}.`);
    const i: HazardInput = { ...body, projectId: h.project_id };
    await validateInput(auth, i);
    const set = { ...cols(i, h.risk_matrix), ...(h.status === 'rejected' ? { status: 'draft', submitted_by: null, submitted_at: null, reviewed_by: null, reviewed_at: null } : {}) };
    return { json: await mutate(auth, h, body.version, set, h.status === 'rejected' ? 'rework' : 'saved', body.changeNote || 'Saved', ctx.ip, 'hazard.save', (tx) => replaceLinks(tx, auth, h.id, i.links)) };
  });

  r.post('/api/hazards/:id/transition', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = versionNote.extend({ action: z.enum(['submit', 'review', 'approve', 'reject', 'revise', 'archive']) }).parse(await ctx.json(z.unknown()));
    const h = await load(auth, ctx.params.id);
    const perm = permissionsFor(auth, h);
    const ev = evaluateHazard(inputOf(h), h.risk_matrix, today());
    const chk = checkTransition(hazardLifecycle, body.action, h.status, { comment: body.note, actorId: auth.userId, submittedBy: h.submitted_by });
    if (!chk.ok) throw (chk.reason?.startsWith('Not allowed') ? conflict(chk.reason) : chk.reason?.includes('submitted the work') ? forbidden('You submitted this assessment, so someone else must review or approve it.') : badRequest(chk.reason!));
    const now = new Date();
    switch (body.action) {
      case 'submit': {
        if (!reach(auth, 'risk.manage', h.project_id)) throw forbidden();
        const blocking = ev.issues.filter((x) => x.blocking);
        if (blocking.length) throw new HttpError(422, 'not_ready', 'The assessment is not complete', blocking);
        const esc = ev.requiresAuthorisedApproval ? ` — ${ev.approvalBand!.toUpperCase()} risk: needs review and authorised approval${ev.intolerable ? '; residual is intolerable and must be reduced before approval (escalated)' : ''}` : '';
        return { json: await mutate(auth, h, body.version, { status: 'submitted', submitted_by: auth.userId, submitted_at: now }, 'submitted', (body.note || 'Submitted') + esc, ctx.ip, ev.intolerable ? 'hazard.escalate' : 'hazard.submit') };
      }
      case 'review':
        if (!perm.review) throw h.submitted_by === auth.userId ? forbidden('You submitted this assessment, so someone else must review it.') : forbidden();
        return { json: await mutate(auth, h, body.version, { status: 'reviewed', reviewed_by: auth.userId, reviewed_at: now }, 'reviewed', body.note || 'Reviewed', ctx.ip, 'hazard.review') };
      case 'approve': {
        if (ev.intolerable) throw new HttpError(422, 'intolerable_risk', 'A CRITICAL residual risk cannot be approved. Reduce the risk further or stop the activity, and escalate to the project HSE manager.');
        if (ev.issues.some((x) => x.blocking)) throw new HttpError(422, 'not_ready', 'The assessment no longer passes the risk engine checks', ev.issues.filter((x) => x.blocking));
        if (h.submitted_by === auth.userId) throw forbidden('You submitted this assessment, so someone else must approve it.');
        if (ev.requiresAuthorisedApproval && h.status !== 'reviewed') throw conflict(`${ev.approvalBand!.toUpperCase()} risk must be reviewed by an independent assessor before approval.`);
        if (ev.requiresAuthorisedApproval && h.reviewed_by === auth.userId) throw forbidden('High-risk assessments need a different approver from the reviewer.');
        if (!perm.approve) throw forbidden(ev.requiresAuthorisedApproval ? 'High and critical risk assessments must be approved by an authorised approver (risk.approve).' : undefined);
        return { json: await mutate(auth, h, body.version, { status: 'approved', approved_by: auth.userId, approved_at: now, decision_note: body.note || null }, 'approved', body.note || 'Approved', ctx.ip, 'hazard.approve') };
      }
      case 'reject':
        if (!perm.reject) throw forbidden();
        return { json: await mutate(auth, h, body.version, { status: 'rejected', decision_note: body.note }, 'rejected', body.note, ctx.ip, 'hazard.reject') };
      case 'revise':
        if (!perm.revise) throw forbidden();
        return { json: await mutate(auth, h, body.version, { status: 'draft', revision: h.revision + 1, submitted_by: null, submitted_at: null, reviewed_by: null, reviewed_at: null, approved_by: null, approved_at: null, decision_note: null }, 'revised', `${revisionLabel(h.revision + 1)} started: ${body.note}`, ctx.ip, 'hazard.revise') };
      case 'archive':
        if (!perm.archive) throw forbidden();
        return { json: await mutate(auth, h, body.version, { status: 'archived', archived_reason: body.note }, 'archived', body.note, ctx.ip, 'hazard.archive') };
    }
  });

  r.get('/api/hazards/:id/revisions', async (ctx) => {
    const auth = requireAuth(ctx);
    const h = await load(auth, ctx.params.id);
    const rows = await db.query<{ id: string; event: string; revision: number; status: string; note: string; actor: string; created_at: string; residual_band: string | null; initial_band: string | null }>(
      `SELECT r.id::text, r.event, r.revision, r.status, r.note, u.full_name AS actor, r.created_at, r.snapshot->>'residual_band' AS residual_band, r.snapshot->>'initial_band' AS initial_band
         FROM hazard_register_revisions r JOIN users u ON u.id = r.actor_id WHERE r.hazard_id = $1 AND r.organization_id = $2 ORDER BY r.id DESC`, [h.id, auth.organizationId]);
    return { json: { items: rows.rows.map((x) => ({ id: Number(x.id), event: x.event, revisionLabel: revisionLabel(x.revision), status: x.status, note: x.note, actor: x.actor, at: x.created_at, initialBand: x.initial_band, residualBand: x.residual_band })) } };
  });

  r.get('/api/hazards/:id/revisions/:rid', async (ctx) => {
    const auth = requireAuth(ctx);
    const h = await load(auth, ctx.params.id);
    const rid = z.coerce.number().int().min(1).safeParse(ctx.params.rid);
    if (!rid.success) throw notFound('Revision');
    const s = (await db.query<{ event: string; revision: number; status: string; snapshot: unknown; note: string; created_at: string }>(
      'SELECT event, revision, status, snapshot, note, created_at FROM hazard_register_revisions WHERE id = $1 AND hazard_id = $2 AND organization_id = $3', [rid.data, h.id, auth.organizationId])).rows[0];
    if (!s) throw notFound('Revision');
    return { json: { ...s, revisionLabel: revisionLabel(s.revision) } };
  });
}
