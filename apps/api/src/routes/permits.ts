/**
 * Permit to Work (Phase 5).
 *
 *   GET  /api/permits/meta                 types, checklists, details, statuses, validity limit
 *   GET  /api/permits                      register with filters and live counts
 *   POST /api/permits                      new draft (applicant = the signed-in user)
 *   GET  /api/permits/:id                  permit, readiness, permissions, history, nearby live permits
 *   PATCH /api/permits/:id                 edit a draft
 *   POST /api/permits/:id/checks           confirm checklist items (applicant on a draft, issuer in safety review)
 *   POST /api/permits/:id/gas-tests        record a gas test
 *   POST /api/permits/:id/transition       submit | start_safety_review | reject | authorise | activate | suspend | revalidate | complete | close | cancel
 *   POST /api/permits/:id/copy             new draft from this permit (an expired permit is never extended)
 *
 * Rules: the applicant never reviews, authorises, revalidates or closes their own permit; closing also
 * needs someone other than the person who handed the work back. Authorisation needs every critical
 * check confirmed, the type's details, isolations with lock numbers and, where required, a passing gas
 * test taken after submission. Permits expire automatically when their validity ends.
 */
import { z } from 'zod';
import {
  permitInputSchema, gasTestSchema, applicationIssues, authorisationIssues, revalidationIssues, gasTestNeeded, overlaps, checkTransition, permitLifecycle, can,
  PTW_TYPES, PTW_TYPE_DEFS, PERMIT_STATUS_LABELS, LIVE_PERMIT_STATUSES, PERMIT_TYPE_LABEL,
  type PermitInput, type PermitStatus, type PtwType, type GasTest, type PermitCheck, type Isolation, type PermitFacts, type Permission,
} from '@forgehse/shared';
import type { Deps } from '../app';
import type { Router } from '../http/core';
import { badRequest, conflict, forbidden, notFound, HttpError } from '../http/core';
import { requireAuth, hasAnywhere, scopeFilter, type AuthContext } from '../auth/session';
import { nextNumber, orgSettings } from '../services/org';
import { audit } from '../services/audit';
import type { Queryable } from '../db/db';

interface PermitRow {
  id: string; organization_id: string; project_id: string; site_id: string; ref_no: string; permit_type: PtwType | 'other'; work_description: string; location: string;
  contractor_name: string; crew: string[]; equipment: string; emergency_arrangements: string; valid_from: string; valid_to: string; gas_test_required: boolean;
  details: Record<string, unknown>; isolations: Isolation[]; checks: PermitCheck[]; gas_tests: GasTest[]; hazard_ids: string[]; status: PermitStatus;
  applicant_id: string; created_by: string | null; submitted_at: string | null; reviewed_by: string | null; reviewed_at: string | null; authorised_by: string | null; authorised_at: string | null;
  accepted_by: string | null; accepted_at: string | null; suspended_at: string | null; completed_by: string | null; completed_at: string | null; completion_note: string | null;
  closed_by: string | null; closed_at: string | null; closure_note: string | null; decision_note: string | null; version: number; created_at: string; updated_at: string;
  project_code: string; project_name: string; site_name: string; applicant_name: string; reviewer_name: string | null; authoriser_name: string | null; acceptor_name: string | null; completer_name: string | null; closer_name: string | null;
}

const SELECT = `SELECT pt.*, p.code AS project_code, p.name AS project_name, s.name AS site_name, au.full_name AS applicant_name, ru.full_name AS reviewer_name,
    zu.full_name AS authoriser_name, cu.full_name AS acceptor_name, mu.full_name AS completer_name, xu.full_name AS closer_name
  FROM permits pt JOIN projects p ON p.id = pt.project_id JOIN sites s ON s.id = pt.site_id JOIN users au ON au.id = pt.applicant_id
  LEFT JOIN users ru ON ru.id = pt.reviewed_by LEFT JOIN users zu ON zu.id = pt.authorised_by LEFT JOIN users cu ON cu.id = pt.accepted_by
  LEFT JOIN users mu ON mu.id = pt.completed_by LEFT JOIN users xu ON xu.id = pt.closed_by`;

const at = (auth: AuthContext, perm: Permission, p: { project_id: string; site_id: string }) => can(auth.assignments, perm, { organizationId: auth.organizationId, projectId: p.project_id, siteId: p.site_id });

function facts(p: PermitRow): PermitFacts {
  return {
    permitType: (p.permit_type === 'other' ? 'general' : p.permit_type), validFrom: new Date(p.valid_from).toISOString(), validTo: new Date(p.valid_to).toISOString(),
    gasTestRequired: p.gas_test_required, details: p.details, isolations: p.isolations, checks: p.checks, gasTests: p.gas_tests,
    submittedAt: p.submitted_at ? new Date(p.submitted_at).toISOString() : null, suspendedAt: p.suspended_at ? new Date(p.suspended_at).toISOString() : null,
  };
}

function permissionsFor(auth: AuthContext, p: PermitRow) {
  const apply = at(auth, 'permit.apply', p), issue = at(auth, 'permit.issue', p);
  const mine = p.applicant_id === auth.userId || p.created_by === auth.userId;
  const independent = p.applicant_id !== auth.userId;
  const now = Date.now();
  return {
    edit: p.status === 'draft' && mine && apply,
    submit: p.status === 'draft' && mine && apply,
    startReview: p.status === 'submitted' && issue && independent,
    confirmChecks: (p.status === 'draft' && mine && apply) || (p.status === 'safety_review' && issue && independent),
    gasTest: ['safety_review', 'active', 'suspended'].includes(p.status) && (issue || apply),
    authorise: p.status === 'safety_review' && issue && independent,
    reject: (p.status === 'submitted' || p.status === 'safety_review') && issue && independent,
    activate: p.status === 'authorised' && mine && apply && now >= new Date(p.valid_from).getTime() && now < new Date(p.valid_to).getTime(),
    suspend: p.status === 'active' && (issue || apply),
    revalidate: p.status === 'suspended' && issue && independent,
    complete: p.status === 'active' && (mine || p.accepted_by === auth.userId) && apply,
    close: p.status === 'completed' && issue && independent && p.completed_by !== auth.userId,
    cancel: ['draft', 'submitted', 'authorised'].includes(p.status) && ((mine && apply) || issue),
    copy: apply,
  };
}

export function registerPermitRoutes(r: Router, { db }: Deps) {
  /** Permits whose validity has ended become expired (recorded as an automatic event). */
  async function expireDue(orgId: string) {
    const rows = await db.query<{ id: string; status: string; ref_no: string; project_id: string; valid_to: string }>(
      `WITH old AS (SELECT id, status FROM permits WHERE organization_id = $1 AND status IN ('authorised','active','suspended') AND valid_to <= now() FOR UPDATE SKIP LOCKED)
       UPDATE permits pt SET status = 'expired', version = pt.version + 1, updated_at = now() FROM old WHERE pt.id = old.id
       RETURNING pt.id, old.status, pt.ref_no, pt.project_id, pt.valid_to`, [orgId]);
    for (const x of rows.rows) {
      await db.query(`INSERT INTO permit_events (organization_id, permit_id, event, from_status, to_status, actor_id, note) VALUES ($1,$2,'expire',$3,'expired',NULL,$4)`,
        [orgId, x.id, x.status, `Validity ended ${new Date(x.valid_to).toISOString()}`]);
      await audit(db, { organizationId: orgId, actorUserId: null, action: 'permit.expire', entityType: 'permit', entityId: x.id, projectId: x.project_id, summary: `${x.ref_no}: expired automatically (was ${x.status})` });
    }
  }

  function visibility(auth: AuthContext, p: unknown[]) {
    const scope = scopeFilter(auth, 'permit.view', p, { org: 'pt.organization_id', project: 'pt.project_id', site: 'pt.site_id' });
    p.push(auth.userId);
    return `${scope} AND (pt.status <> 'draft' OR pt.applicant_id = $${p.length} OR pt.created_by = $${p.length})`;
  }

  async function load(auth: AuthContext, id: string | undefined, q: Queryable = db): Promise<PermitRow> {
    if (!z.string().uuid().safeParse(id).success) throw notFound('Permit');
    const p: unknown[] = [];
    const W = visibility(auth, p);
    p.push(id);
    const row = (await q.query<PermitRow>(`${SELECT} WHERE ${W} AND pt.id = $${p.length}`, p)).rows[0];
    if (!row) throw notFound('Permit');
    return row;
  }

  function view(auth: AuthContext, p: PermitRow, maxHours: number) {
    const f = facts(p);
    const def = PTW_TYPE_DEFS[f.permitType];
    const now = new Date();
    return {
      id: p.id, ref: p.ref_no, permitType: f.permitType, typeLabel: PERMIT_TYPE_LABEL(p.permit_type), workDescription: p.work_description, location: p.location,
      contractorName: p.contractor_name, crew: p.crew, equipment: p.equipment, emergencyArrangements: p.emergency_arrangements,
      validFrom: f.validFrom, validTo: f.validTo, gasTestRequired: p.gas_test_required, gasTestNeeded: gasTestNeeded(f), details: p.details, isolations: p.isolations,
      checks: def.checks.map((c) => ({ ...c, ...(p.checks.find((x) => x.id === c.id) ?? { confirmed: false, byName: null, at: null, note: '' }) })),
      gasTests: [...p.gas_tests].sort((a, b) => b.takenAt.localeCompare(a.takenAt)), hazardIds: p.hazard_ids,
      project: { id: p.project_id, code: p.project_code, name: p.project_name }, site: { id: p.site_id, name: p.site_name },
      status: p.status, statusLabel: PERMIT_STATUS_LABELS[p.status],
      applicant: { id: p.applicant_id, name: p.applicant_name }, submittedAt: p.submitted_at,
      reviewedBy: p.reviewed_by ? { id: p.reviewed_by, name: p.reviewer_name } : null, reviewedAt: p.reviewed_at,
      authorisedBy: p.authorised_by ? { id: p.authorised_by, name: p.authoriser_name } : null, authorisedAt: p.authorised_at,
      acceptedBy: p.accepted_by ? { id: p.accepted_by, name: p.acceptor_name } : null, acceptedAt: p.accepted_at, suspendedAt: p.suspended_at,
      completedBy: p.completed_by ? { id: p.completed_by, name: p.completer_name } : null, completedAt: p.completed_at, completionNote: p.completion_note,
      closedBy: p.closed_by ? { id: p.closed_by, name: p.closer_name } : null, closedAt: p.closed_at, closureNote: p.closure_note, decisionNote: p.decision_note,
      version: p.version, createdAt: p.created_at, updatedAt: p.updated_at,
      issues: {
        application: applicationIssues(f, maxHours),
        authorisation: p.status === 'safety_review' || p.status === 'submitted' || p.status === 'draft' ? authorisationIssues(f, now, maxHours) : [],
        revalidation: p.status === 'suspended' ? revalidationIssues(f, now) : [],
      },
      liveNow: p.status === 'active' && now >= new Date(f.validFrom) && now < new Date(f.validTo),
      permissions: permissionsFor(auth, p),
    };
  }

  async function validate(auth: AuthContext, i: PermitInput) {
    if (!(await db.query('SELECT 1 FROM sites WHERE id = $1 AND project_id = $2 AND organization_id = $3', [i.siteId, i.projectId, auth.organizationId])).rowCount) throw badRequest('Unknown site for this project', [{ path: 'siteId', message: 'Choose a site of this project' }]);
    if (i.hazardIds.length) {
      const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM hazard_register WHERE id = ANY($1::uuid[]) AND organization_id = $2 AND project_id = $3`, [i.hazardIds, auth.organizationId, i.projectId])).rows[0]!.n;
      if (n !== new Set(i.hazardIds).size) throw badRequest('A linked hazard is not in this project');
    }
    const allowed = new Set(PTW_TYPE_DEFS[i.permitType].details.map((d) => d.key));
    for (const k of Object.keys(i.details)) if (!allowed.has(k)) throw badRequest(`Unknown detail "${k}" for this permit type`);
  }

  const cols = (i: PermitInput) => ({
    site_id: i.siteId, permit_type: i.permitType, work_description: i.workDescription, location: i.location, contractor_name: i.contractorName,
    crew: JSON.stringify(i.crew), equipment: i.equipment, emergency_arrangements: i.emergencyArrangements, valid_from: i.validFrom, valid_to: i.validTo,
    gas_test_required: i.gasTestRequired || PTW_TYPE_DEFS[i.permitType].gasTest === 'always', details: JSON.stringify(i.details),
    isolations: JSON.stringify(i.isolations), hazard_ids: i.hazardIds,
  });

  async function event(tx: Queryable, p: PermitRow, ev: string, from: string | null, to: string, actor: string | null, note: string, data?: unknown) {
    await tx.query(`INSERT INTO permit_events (organization_id, permit_id, event, from_status, to_status, actor_id, note, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [p.organization_id, p.id, ev, from, to, actor, note, data === undefined ? null : JSON.stringify(data)]);
  }

  /** Optimistic update + event + audit in one transaction. */
  async function mutate(auth: AuthContext, p: PermitRow, version: number, set: Record<string, unknown>, ev: string, note: string, ip: string, data?: unknown) {
    if (p.version !== version) throw conflict('This permit was changed by someone else. Reload it and try again.');
    const k = Object.keys(set);
    await db.transaction(async (tx) => {
      const u = await tx.query<{ status: string }>(`UPDATE permits SET ${k.map((c, i) => `${c} = $${i + 1}`).join(', ')}${k.length ? ', ' : ''}updated_by = $${k.length + 1}, version = version + 1, updated_at = now()
         WHERE id = $${k.length + 2} AND version = $${k.length + 3} RETURNING status`, [...Object.values(set), auth.userId, p.id, version]);
      if (!u.rowCount) throw conflict('This permit was changed by someone else. Reload it and try again.');
      await event(tx, p, ev, p.status, u.rows[0]!.status, auth.userId, note, data);
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: `permit.${ev}`, entityType: 'permit', entityId: p.id, projectId: p.project_id, summary: `${p.ref_no}: ${note || ev}`.slice(0, 500), ip });
    });
  }

  async function detail(auth: AuthContext, id: string) {
    await expireDue(auth.organizationId);
    const p = await load(auth, id);
    const { permitMaxHours } = await orgSettings(db, auth.organizationId);
    const [events, nearby, hazards] = await Promise.all([
      db.query<{ id: string; event: string; from_status: string | null; to_status: string; note: string; actor: string | null; created_at: string; data: unknown }>(
        `SELECT e.id::text, e.event, e.from_status, e.to_status, e.note, u.full_name AS actor, e.created_at, e.data FROM permit_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.permit_id = $1 ORDER BY e.id DESC`, [p.id]),
      db.query<{ id: string; ref_no: string; permit_type: string; location: string; status: PermitStatus; valid_from: string; valid_to: string }>(
        `SELECT id, ref_no, permit_type, location, status, valid_from, valid_to FROM permits WHERE organization_id = $1 AND site_id = $2 AND id <> $3 AND status = ANY($4::text[])`,
        [auth.organizationId, p.site_id, p.id, LIVE_PERMIT_STATUSES.concat(['submitted', 'safety_review'])]),
      p.hazard_ids.length ? db.query<{ id: string; ref_no: string; activity: string; residual_band: string | null; status: string }>(`SELECT id, ref_no, activity, residual_band, status FROM hazard_register WHERE id = ANY($1::uuid[]) AND organization_id = $2`, [p.hazard_ids, auth.organizationId]) : Promise.resolve({ rows: [] }),
    ]);
    const win = { from: new Date(p.valid_from).toISOString(), to: new Date(p.valid_to).toISOString() };
    return {
      ...view(auth, p, permitMaxHours),
      history: events.rows.map((e) => ({ id: Number(e.id), event: e.event, from: e.from_status, to: e.to_status, toLabel: PERMIT_STATUS_LABELS[e.to_status as PermitStatus] ?? e.to_status, note: e.note, actor: e.actor ?? 'System', at: e.created_at, data: e.data })),
      simops: nearby.rows.filter((x) => overlaps(win, { from: new Date(x.valid_from).toISOString(), to: new Date(x.valid_to).toISOString() }))
        .map((x) => ({ id: x.id, ref: x.ref_no, typeLabel: PERMIT_TYPE_LABEL(x.permit_type), location: x.location, status: x.status, statusLabel: PERMIT_STATUS_LABELS[x.status], validFrom: x.valid_from, validTo: x.valid_to })),
      hazards: hazards.rows.map((h) => ({ id: h.id, ref: h.ref_no, activity: h.activity, residualBand: h.residual_band, status: h.status })),
      maxHours: permitMaxHours,
    };
  }

  r.get('/api/permits/meta', async (ctx) => {
    const auth = requireAuth(ctx);
    if (!hasAnywhere(auth, 'permit.view')) throw forbidden();
    const s = await orgSettings(db, auth.organizationId);
    return { json: {
      types: PTW_TYPES.map((t) => ({ value: t, ...PTW_TYPE_DEFS[t] })), statuses: Object.entries(PERMIT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
      maxHours: s.permitMaxHours, canApply: hasAnywhere(auth, 'permit.apply'), canIssue: hasAnywhere(auth, 'permit.issue'),
      notice: 'Checklists are generic prompts. Confirm them against your site PTW procedure and client requirements. Gas test limits are the site\'s; the tester confirms readings are within them.',
    } };
  });

  r.get('/api/permits', async (ctx) => {
    const auth = requireAuth(ctx);
    if (!hasAnywhere(auth, 'permit.view')) throw forbidden();
    await expireDue(auth.organizationId);
    const q = z.object({
      projectId: z.string().uuid().optional(), siteId: z.string().uuid().optional(), permitType: z.enum(PTW_TYPES).optional(),
      status: z.string().max(20).optional(), view: z.enum(['live', 'awaiting', 'mine', 'closed', 'all']).default('all'), q: z.string().trim().max(100).optional(),
      page: z.coerce.number().int().min(1).max(1000).default(1),
    }).parse(ctx.query);
    const p: unknown[] = [];
    const where = [visibility(auth, p)];
    const add = (sql: string, v: unknown) => { p.push(v); where.push(sql.replaceAll('?', `$${p.length}`)); };
    if (q.projectId) add('pt.project_id = ?', q.projectId);
    if (q.siteId) add('pt.site_id = ?', q.siteId);
    if (q.permitType) add('pt.permit_type = ?', q.permitType);
    if (q.status && q.status in PERMIT_STATUS_LABELS) add('pt.status = ?', q.status);
    if (q.view === 'live') where.push(`pt.status IN ('authorised','active','suspended')`);
    if (q.view === 'awaiting') where.push(`pt.status IN ('submitted','safety_review')`);
    if (q.view === 'closed') where.push(`pt.status IN ('closed','expired','cancelled','rejected')`);
    if (q.view === 'mine') add('pt.applicant_id = ?', auth.userId);
    if (q.q) add(`(pt.ref_no ILIKE ? OR pt.work_description ILIKE ? OR pt.location ILIKE ? OR pt.contractor_name ILIKE ?)`, `%${q.q.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
    const W = where.join(' AND ');
    const cp: unknown[] = [];
    const CW = visibility(auth, cp) + (q.projectId ? ` AND pt.project_id = $${cp.push(q.projectId)}` : '');
    const [rows, total, counts] = await Promise.all([
      db.query<PermitRow>(`${SELECT} WHERE ${W} ORDER BY CASE pt.status WHEN 'active' THEN 0 WHEN 'suspended' THEN 1 WHEN 'authorised' THEN 2 WHEN 'safety_review' THEN 3 WHEN 'submitted' THEN 4 ELSE 5 END, pt.valid_from DESC LIMIT 25 OFFSET ${(q.page - 1) * 25}`, p),
      db.query<{ n: number }>(`SELECT count(*)::int AS n FROM permits pt WHERE ${W}`, p),
      db.query<{ active: number; suspended: number; awaiting: number; ending: number }>(
        `SELECT count(*) FILTER (WHERE pt.status = 'active')::int AS active, count(*) FILTER (WHERE pt.status = 'suspended')::int AS suspended,
                count(*) FILTER (WHERE pt.status IN ('submitted','safety_review'))::int AS awaiting,
                count(*) FILTER (WHERE pt.status IN ('authorised','active','suspended') AND pt.valid_to <= now() + interval '2 hours')::int AS ending
           FROM permits pt WHERE ${CW}`, cp),
    ]);
    const { permitMaxHours } = await orgSettings(db, auth.organizationId);
    return { json: {
      items: rows.rows.map((x) => { const v = view(auth, x, permitMaxHours); return { id: v.id, ref: v.ref, typeLabel: v.typeLabel, permitType: v.permitType, workDescription: v.workDescription, location: v.location, project: v.project.code, site: v.site.name, validFrom: v.validFrom, validTo: v.validTo, status: v.status, statusLabel: v.statusLabel, applicant: v.applicant.name, contractorName: v.contractorName }; }),
      total: total.rows[0]!.n, page: q.page, pageSize: 25, counts: counts.rows[0],
    } };
  });

  r.post('/api/permits', async (ctx) => {
    const auth = requireAuth(ctx);
    const i = permitInputSchema.parse(await ctx.json(z.unknown()));
    if (!can(auth.assignments, 'permit.apply', { organizationId: auth.organizationId, projectId: i.projectId, siteId: i.siteId })) throw forbidden();
    await validate(auth, i);
    const id = await db.transaction(async (tx) => {
      const year = new Date().getFullYear();
      const code = (await tx.query<{ code: string }>('SELECT code FROM projects WHERE id = $1', [i.projectId])).rows[0]!.code;
      const ref = `PTW-${code}-${year}-${String(await nextNumber(tx, auth.organizationId, `permit:${i.projectId}`, year)).padStart(5, '0')}`;
      const c = { organization_id: auth.organizationId, project_id: i.projectId, ref_no: ref, ...cols(i), applicant_id: auth.userId, created_by: auth.userId, updated_by: auth.userId };
      const k = Object.keys(c);
      const row = (await tx.query<PermitRow>(`INSERT INTO permits (${k.join(',')}) VALUES (${k.map((_, x) => `$${x + 1}`).join(',')}) RETURNING *`, Object.values(c))).rows[0]!;
      await event(tx, row, 'create', null, 'draft', auth.userId, 'Draft created');
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'permit.create', entityType: 'permit', entityId: row.id, projectId: i.projectId, summary: `${ref}: ${PERMIT_TYPE_LABEL(i.permitType)} — ${i.location}`, ip: ctx.ip });
      return row.id;
    });
    return { status: 201, json: await detail(auth, id) };
  });

  r.get('/api/permits/:id', async (ctx) => {
    const auth = requireAuth(ctx);
    return { json: await detail(auth, ctx.params.id!) };
  });

  r.patch('/api/permits/:id', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = z.object({ version: z.number().int().min(1), permit: permitInputSchema }).parse(await ctx.json(z.unknown()));
    const p = await load(auth, ctx.params.id);
    if (!permissionsFor(auth, p).edit) throw p.status === 'draft' ? forbidden() : conflict('Only a draft can be edited. Cancel it and raise a new permit, or use “Copy as new draft”.');
    if (body.permit.projectId !== p.project_id) throw badRequest('A permit cannot move to another project');
    await validate(auth, body.permit);
    if (!can(auth.assignments, 'permit.apply', { organizationId: auth.organizationId, projectId: p.project_id, siteId: body.permit.siteId })) throw forbidden();
    await mutate(auth, p, body.version, cols(body.permit), 'edit', 'Draft saved', ctx.ip);
    return { json: await detail(auth, p.id) };
  });

  r.post('/api/permits/:id/checks', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = z.object({ version: z.number().int().min(1), checks: z.array(z.object({ id: z.string().max(40), confirmed: z.boolean(), note: z.string().trim().max(300).default('') })).max(40) }).parse(await ctx.json(z.unknown()));
    const p = await load(auth, ctx.params.id);
    if (!permissionsFor(auth, p).confirmChecks) throw ['draft', 'safety_review'].includes(p.status) ? forbidden(p.status === 'safety_review' && p.applicant_id === auth.userId ? 'The applicant cannot confirm checks during the safety review.' : undefined) : conflict('Checks can only change on a draft or during the safety review.');
    const valid = new Set(PTW_TYPE_DEFS[facts(p).permitType].checks.map((c) => c.id));
    const prev = new Map(p.checks.map((c) => [c.id, c]));
    const stamp = new Date().toISOString();
    const next: PermitCheck[] = body.checks.filter((c) => valid.has(c.id)).map((c) => {
      const old = prev.get(c.id);
      const same = old && old.confirmed === c.confirmed && old.note === c.note;
      return same ? old! : { id: c.id, confirmed: c.confirmed, note: c.note, byName: c.confirmed ? auth.fullName : null, at: c.confirmed ? stamp : null };
    });
    const changed = next.filter((c) => prev.get(c.id)?.confirmed !== c.confirmed).length;
    await mutate(auth, p, body.version, { checks: JSON.stringify(next) }, 'checks', `${changed} check${changed === 1 ? '' : 's'} updated`, ctx.ip, { confirmed: next.filter((c) => c.confirmed).map((c) => c.id) });
    return { json: await detail(auth, p.id) };
  });

  r.post('/api/permits/:id/gas-tests', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = z.object({ version: z.number().int().min(1), test: gasTestSchema }).parse(await ctx.json(z.unknown()));
    const p = await load(auth, ctx.params.id);
    if (!permissionsFor(auth, p).gasTest) throw ['safety_review', 'active', 'suspended'].includes(p.status) ? forbidden() : conflict('Gas tests are recorded during the safety review or while the permit is live.');
    if (new Date(body.test.takenAt).getTime() > Date.now() + 5 * 60_000) throw badRequest('The test time is in the future', [{ path: 'test.takenAt', message: 'Use the time the reading was taken' }]);
    const t: GasTest = { ...body.test, id: crypto.randomUUID(), byId: auth.userId, byName: auth.fullName, recordedAt: new Date().toISOString() };
    await mutate(auth, p, body.version, { gas_tests: JSON.stringify([...p.gas_tests, t]) }, 'gas_test', `Gas test ${t.withinLimits ? 'within site limits' : 'NOT within site limits'} (${t.instrument})`, ctx.ip, t);
    return { status: 201, json: await detail(auth, p.id) };
  });

  r.post('/api/permits/:id/transition', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = z.object({
      action: z.enum(['submit', 'start_safety_review', 'reject', 'authorise', 'activate', 'suspend', 'revalidate', 'complete', 'close', 'cancel']),
      version: z.number().int().min(1), note: z.string().trim().max(1000).default(''), isolationsRemoved: z.boolean().optional(),
    }).parse(await ctx.json(z.unknown()));
    await expireDue(auth.organizationId);
    const p = await load(auth, ctx.params.id);
    const perm = permissionsFor(auth, p);
    const { permitMaxHours } = await orgSettings(db, auth.organizationId);
    const f = facts(p); const now = new Date();
    const chk = checkTransition(permitLifecycle, body.action, p.status, { comment: body.note, actorId: auth.userId, submittedBy: p.applicant_id });
    if (!chk.ok) {
      if (chk.reason?.startsWith('Not allowed')) throw conflict(`This permit is ${PERMIT_STATUS_LABELS[p.status].toLowerCase()}.`);
      if (chk.reason?.includes('submitted the work')) throw forbidden('You applied for this permit, so someone else must do this.');
      throw badRequest(chk.reason!);
    }
    const independent = () => { if (p.applicant_id === auth.userId) throw forbidden('You applied for this permit, so someone else must do this.'); };
    const notReady = (issues: { code: string; message: string }[]) => { if (issues.length) throw new HttpError(422, 'not_ready', issues.map((i) => i.message).join(' '), issues); };
    const T = permitLifecycle.transitions[body.action].label;
    switch (body.action) {
      case 'submit':
        if (!perm.submit) throw forbidden();
        notReady(applicationIssues(f, permitMaxHours));
        if (new Date(f.validTo) <= now) throw badRequest('The validity period has already ended');
        await mutate(auth, p, body.version, { status: 'submitted', submitted_at: now }, 'submit', body.note || T, ctx.ip); break;
      case 'start_safety_review':
        independent(); if (!perm.startReview) throw forbidden();
        await mutate(auth, p, body.version, { status: 'safety_review', reviewed_by: auth.userId, reviewed_at: now }, 'start_safety_review', body.note || T, ctx.ip); break;
      case 'reject':
        independent(); if (!perm.reject) throw forbidden();
        await mutate(auth, p, body.version, { status: 'rejected', decision_note: body.note }, 'reject', body.note, ctx.ip); break;
      case 'authorise':
        independent(); if (!perm.authorise) throw forbidden('Only a permit issuer for this site can authorise.');
        notReady(authorisationIssues(f, now, permitMaxHours));
        await mutate(auth, p, body.version, { status: 'authorised', authorised_by: auth.userId, authorised_at: now, decision_note: body.note || null }, 'authorise', body.note || T, ctx.ip); break;
      case 'activate':
        if (!perm.activate) {
          if (p.applicant_id !== auth.userId && p.created_by !== auth.userId) throw forbidden('The applicant (performing authority) accepts the permit and starts the work.');
          if (now < new Date(f.validFrom)) throw conflict(`Work cannot start before ${f.validFrom}.`);
          throw forbidden();
        }
        await mutate(auth, p, body.version, { status: 'active', accepted_by: auth.userId, accepted_at: now }, 'activate', body.note || T, ctx.ip); break;
      case 'suspend':
        if (!perm.suspend) throw forbidden();
        await mutate(auth, p, body.version, { status: 'suspended', suspended_at: now }, 'suspend', body.note, ctx.ip); break;
      case 'revalidate':
        independent(); if (!perm.revalidate) throw forbidden();
        notReady(revalidationIssues(f, now));
        await mutate(auth, p, body.version, { status: 'active' }, 'revalidate', body.note, ctx.ip); break;
      case 'complete':
        if (!perm.complete) throw forbidden();
        if (body.note.length < 5) throw badRequest('Describe the state the work area was left in', [{ path: 'note', message: 'Required' }]);
        if (p.isolations.length && body.isolationsRemoved !== true) throw badRequest('Confirm that every isolation has been removed or handed over', [{ path: 'isolationsRemoved', message: 'Required' }]);
        await mutate(auth, p, body.version, { status: 'completed', completed_by: auth.userId, completed_at: now, completion_note: body.note }, 'complete', body.note, ctx.ip, { isolationsRemoved: body.isolationsRemoved ?? null }); break;
      case 'close':
        independent();
        if (p.completed_by === auth.userId) throw forbidden('You handed the work back, so someone else must close the permit.');
        if (!perm.close) throw forbidden();
        if (body.note.length < 5) throw badRequest('Record the close-out inspection', [{ path: 'note', message: 'Required' }]);
        await mutate(auth, p, body.version, { status: 'closed', closed_by: auth.userId, closed_at: now, closure_note: body.note }, 'close', body.note, ctx.ip); break;
      case 'cancel':
        if (!perm.cancel) throw forbidden();
        await mutate(auth, p, body.version, { status: 'cancelled', decision_note: body.note }, 'cancel', body.note, ctx.ip); break;
    }
    return { json: await detail(auth, p.id) };
  });

  r.post('/api/permits/:id/copy', async (ctx) => {
    const auth = requireAuth(ctx);
    const p = await load(auth, ctx.params.id);
    if (!permissionsFor(auth, p).copy) throw forbidden();
    const dur = new Date(p.valid_to).getTime() - new Date(p.valid_from).getTime();
    const start = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000);
    const type = facts(p).permitType;
    const i: PermitInput = permitInputSchema.parse({
      projectId: p.project_id, siteId: p.site_id, permitType: type, workDescription: p.work_description, location: p.location, contractorName: p.contractor_name, crew: p.crew,
      equipment: p.equipment, emergencyArrangements: p.emergency_arrangements, validFrom: start.toISOString(), validTo: new Date(start.getTime() + dur).toISOString(),
      gasTestRequired: p.gas_test_required, details: p.details, isolations: p.isolations.map((x) => ({ ...x, isolatedBy: '', verifiedBy: '' })), hazardIds: p.hazard_ids,
    });
    const id = await db.transaction(async (tx) => {
      const year = new Date().getFullYear();
      const ref = `PTW-${p.project_code}-${year}-${String(await nextNumber(tx, auth.organizationId, `permit:${p.project_id}`, year)).padStart(5, '0')}`;
      const c = { organization_id: auth.organizationId, project_id: p.project_id, ref_no: ref, ...cols(i), applicant_id: auth.userId, created_by: auth.userId, updated_by: auth.userId };
      const k = Object.keys(c);
      const row = (await tx.query<PermitRow>(`INSERT INTO permits (${k.join(',')}) VALUES (${k.map((_, x) => `$${x + 1}`).join(',')}) RETURNING *`, Object.values(c))).rows[0]!;
      await event(tx, row, 'create', null, 'draft', auth.userId, `Copied from ${p.ref_no}; checks and gas tests start again`);
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'permit.copy', entityType: 'permit', entityId: row.id, projectId: p.project_id, summary: `${ref} copied from ${p.ref_no}`, ip: ctx.ip });
      return row.id;
    });
    return { status: 201, json: await detail(auth, id) };
  });
}
