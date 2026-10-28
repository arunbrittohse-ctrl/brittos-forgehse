/**
 * HSE Document Studio — controlled documents.
 *
 *   GET  /api/documents/meta                      matrix in force, generator availability
 *   POST /api/documents                           generate a draft (template; optional model suggestions)
 *   GET  /api/documents                           register (filters: type, status, projectId, q, page)
 *   GET  /api/documents/:id                       document + readiness + permissions
 *   PATCH /api/documents/:id                      save draft (title / inputs / content), optimistic version
 *   POST /api/documents/:id/regenerate            rebuild content from the saved inputs (draft only)
 *   POST /api/documents/:id/submit                draft → in review (only when ready)
 *   POST /api/documents/:id/decision              approve (independent approver) or return with comments
 *   POST /api/documents/:id/new-revision          approved → new draft revision (approved revision preserved)
 *   POST /api/documents/:id/withdraw              draft / in review → withdrawn (reason required)
 *   POST /api/documents/:id/restore               copy a stored snapshot into the current draft
 *   GET  /api/documents/:id/revisions[/:rid]      append-only history and snapshots
 *   GET  /api/documents/:id/export?format=docx|pdf[&revisionId=]
 *
 * Every state change writes an immutable revision snapshot and an audit-log row in the same transaction.
 */
import { z } from 'zod';
import {
  DOC_TYPE_KEYS, DOCUMENT_STUDIO_STATUSES, docType, docContentSchema, docGenerateRequestSchema, docSaveRequestSchema,
  docDecisionRequestSchema, documentReadiness, missingRequired, asReferences, asText, checkTransition, documentStudioLifecycle,
  revisionLabel, DOCUMENT_STATUS_LABELS, validateRiskMatrix,
  type DocContent, type DocGenerator, type DocInputs, type DocTypeKey, type DocumentStudioStatus, type RiskMatrixConfig,
} from '@forgehse/shared';
import type { Deps } from '../app';
import type { Router } from '../http/core';
import { badRequest, conflict, forbidden, notFound, HttpError } from '../http/core';
import { requireAuth, hasAnywhere, projectReach, requireProjectReach, type AuthContext } from '../auth/session';
import { orgSettings, nextNumber } from '../services/org';
import { audit } from '../services/audit';
import { compactParams, type Queryable } from '../db/db';
import { DocumentGenerationService } from '../services/document-generator';
import { documentDocx, documentPdf, type DocExportMeta } from '../services/document-export';

interface DocRow {
  id: string; organization_id: string; project_id: string | null; site_id: string | null; doc_number: string; doc_type: DocTypeKey;
  title: string; revision: number; status: DocumentStudioStatus; inputs: DocInputs; content: DocContent; risk_matrix: RiskMatrixConfig;
  generator: DocGenerator; created_by: string; updated_by: string; submitted_by: string | null; submitted_at: string | null;
  approved_by: string | null; approved_at: string | null; decision_note: string | null; withdrawn_reason: string | null;
  version: number; created_at: string; updated_at: string;
  creator_name: string; updater_name: string; submitter_name: string | null; approver_name: string | null;
  project_code: string | null; project_name: string | null; site_name: string | null;
}

const SELECT = `SELECT d.*, cu.full_name AS creator_name, uu.full_name AS updater_name, su.full_name AS submitter_name, au.full_name AS approver_name,
    p.code AS project_code, p.name AS project_name, s.name AS site_name
  FROM hse_documents d
  JOIN users cu ON cu.id = d.created_by JOIN users uu ON uu.id = d.updated_by
  LEFT JOIN users su ON su.id = d.submitted_by LEFT JOIN users au ON au.id = d.approved_by
  LEFT JOIN projects p ON p.id = d.project_id LEFT JOIN sites s ON s.id = d.site_id`;

/**
 * Who sees what: people who prepare documents (document.create) see drafts in their projects and
 * organisation-level documents; everyone else with document.view sees approved documents only.
 */
function visibility(auth: AuthContext, params: unknown[]) {
  params.push(auth.organizationId);
  const org = `d.organization_id = $${params.length}`;
  params.push(auth.userId);
  const ors = [`d.created_by = $${params.length}`];
  const create = projectReach(auth, 'document.create');
  if (create.orgWide) ors.push('TRUE');
  else if (create.projectIds.length) { params.push(create.projectIds); ors.push(`d.project_id = ANY($${params.length}::uuid[])`, 'd.project_id IS NULL'); }
  const view = projectReach(auth, 'document.view');
  if (view.orgWide) ors.push(`d.status = 'approved'`);
  else if (view.projectIds.length) { params.push(view.projectIds); ors.push(`(d.status = 'approved' AND (d.project_id = ANY($${params.length}::uuid[]) OR d.project_id IS NULL))`); }
  return `${org} AND d.deleted_at IS NULL AND (${ors.join(' OR ')})`;
}

function reachFor(auth: AuthContext, perm: 'document.create' | 'document.approve', projectId: string | null) {
  const r = projectReach(auth, perm);
  return r.orgWide || (projectId ? r.projectIds.includes(projectId) : perm === 'document.create' ? r.projectIds.length > 0 : false);
}

function permissionsFor(auth: AuthContext, d: DocRow) {
  const author = d.created_by === auth.userId || reachFor(auth, 'document.create', d.project_id);
  const independent = d.submitted_by !== auth.userId && d.created_by !== auth.userId;
  return {
    edit: d.status === 'draft' && author,
    submit: d.status === 'draft' && author,
    approve: d.status === 'in_review' && reachFor(auth, 'document.approve', d.project_id) && independent,
    newRevision: d.status === 'approved' && author,
    withdraw: (d.status === 'draft' || d.status === 'in_review') && (author || reachFor(auth, 'document.approve', d.project_id)),
    export: true,
  };
}

function view(auth: AuthContext, d: DocRow) {
  const t = docType(d.doc_type);
  return {
    id: d.id, docNumber: d.doc_number, docType: d.doc_type, typeLabel: t.label, title: d.title,
    revision: d.revision, revisionLabel: revisionLabel(d.revision), status: d.status, statusLabel: DOCUMENT_STATUS_LABELS[d.status],
    inputs: d.inputs, content: d.content, matrix: d.risk_matrix, generator: d.generator,
    project: d.project_id ? { id: d.project_id, code: d.project_code, name: d.project_name } : null,
    site: d.site_id ? { id: d.site_id, name: d.site_name } : null,
    createdBy: { id: d.created_by, name: d.creator_name }, updatedBy: { id: d.updated_by, name: d.updater_name },
    submittedBy: d.submitted_by ? { id: d.submitted_by, name: d.submitter_name } : null, submittedAt: d.submitted_at,
    approvedBy: d.approved_by ? { id: d.approved_by, name: d.approver_name } : null, approvedAt: d.approved_at,
    decisionNote: d.decision_note, withdrawnReason: d.withdrawn_reason,
    version: d.version, createdAt: d.created_at, updatedAt: d.updated_at,
    readiness: documentReadiness(d.doc_type, d.inputs, d.content, d.risk_matrix),
    permissions: permissionsFor(auth, d),
  };
}

/** System-maintained parts of the content: missing inputs and the supplied reference list. */
function syncContent(t: DocTypeKey, inputs: DocInputs, content: DocContent): DocContent {
  return { ...content, references: asReferences(inputs.references), missingInputs: missingRequired(t, inputs, 'submit').map((f) => `Missing input: ${f.label}`) };
}

async function snapshot(tx: Queryable, d: { id: string; organization_id: string; revision: number; version: number; status: string; title: string; inputs: unknown; content: unknown }, event: string, actor: string, note: string) {
  await tx.query(
    `INSERT INTO hse_document_revisions (organization_id, document_id, event, revision, version, status, title, inputs, content, note, actor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [d.organization_id, d.id, event, d.revision, d.version, d.status, d.title, JSON.stringify(d.inputs), JSON.stringify(d.content), note, actor]);
}

const idSchema = z.string().uuid();
const versionNote = z.object({ version: z.number().int().min(1), note: z.string().trim().max(1000).default('') });

export function registerDocumentRoutes(r: Router, { db, ai, limiters }: Deps) {
  const generation = () => DocumentGenerationService.fromAi(ai);

  async function load(auth: AuthContext, id: string | undefined): Promise<DocRow> {
    if (!idSchema.safeParse(id).success) throw notFound('Document');
    const params: unknown[] = [];
    const W = visibility(auth, params);
    params.push(id);
    const row = (await db.query<DocRow>(...compactParams(`${SELECT} WHERE ${W} AND d.id = $${params.length}`, params))).rows[0];
    if (!row) throw notFound('Document');
    return row;
  }

  /** Applies an update guarded by the optimistic version, writes the snapshot and audit row. */
  async function mutate(auth: AuthContext, row: DocRow, expectedVersion: number, set: Record<string, unknown>, event: string, note: string, ip: string, action: string) {
    if (row.version !== expectedVersion) throw conflict('This document was changed by someone else. Reload it and try again.');
    const cols = Object.keys(set);
    const vals = Object.values(set).map((v) => (v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v));
    const ok = await db.transaction(async (tx) => {
      const u = await tx.query<DocRow>(
        `UPDATE hse_documents SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_by = $${cols.length + 1}, version = version + 1, updated_at = now()
          WHERE id = $${cols.length + 2} AND version = $${cols.length + 3} AND deleted_at IS NULL RETURNING *`,
        [...vals, auth.userId, row.id, expectedVersion]);
      const n = u.rows[0];
      if (!n) return false;
      await snapshot(tx, n, event, auth.userId, note);
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action, entityType: 'hse_document', entityId: row.id, projectId: row.project_id, summary: `${row.doc_number} ${revisionLabel(n.revision)}: ${note || event}`.slice(0, 500), ip });
      return true;
    });
    if (!ok) throw conflict('This document was changed by someone else. Reload it and try again.');
    return view(auth, await load(auth, row.id));
  }

  r.get('/api/documents/meta', async (ctx) => {
    const auth = requireAuth(ctx);
    if (!hasAnywhere(auth, 'document.view')) throw forbidden();
    const settings = await orgSettings(db, auth.organizationId);
    return { json: { matrix: settings.riskMatrix, model: generation().availability(), statuses: DOCUMENT_STUDIO_STATUSES.map((s) => ({ value: s, label: DOCUMENT_STATUS_LABELS[s] })) } };
  });

  r.post('/api/documents', async (ctx) => {
    const auth = requireAuth(ctx);
    if (!hasAnywhere(auth, 'document.create')) throw forbidden();
    const body = docGenerateRequestSchema.parse(await ctx.json(z.unknown()));
    const t = docType(body.docType);
    const projectId = body.projectId ?? null;
    const siteId = body.siteId ?? null;
    if (projectId) requireProjectReach(auth, 'document.create', projectId);
    else if (!projectReach(auth, 'document.create').orgWide && t.family !== 'policy') throw badRequest('Choose the project this document belongs to');
    if (siteId && !projectId) throw badRequest('A site needs its project');
    const missing = missingRequired(body.docType, body.inputs, 'generate');
    if (missing.length) throw badRequest('Complete the required fields before generating', missing.map((f) => ({ path: `inputs.${f.key}`, message: `${f.label} is required` })));
    if (body.useModel) limiters.ai.check(`ai:${auth.userId}`);

    const settings = await orgSettings(db, auth.organizationId);
    validateRiskMatrix(settings.riskMatrix);
    const org = (await db.query<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [auth.organizationId])).rows[0]!;
    let projectCode: string | null = null;
    if (projectId) {
      const p = (await db.query<{ code: string }>('SELECT code FROM projects WHERE id = $1 AND organization_id = $2', [projectId, auth.organizationId])).rows[0];
      if (!p) throw badRequest('Unknown project');
      projectCode = p.code;
      if (siteId && !(await db.query('SELECT 1 FROM sites WHERE id = $1 AND project_id = $2 AND organization_id = $3', [siteId, projectId, auth.organizationId])).rowCount) throw badRequest('Unknown site for this project');
    }
    const { content, generator } = await generation().generate(body.docType, body.inputs, { matrix: settings.riskMatrix, organizationName: org.name, useModel: body.useModel });
    const title = asText(body.inputs.title).slice(0, 160);
    const year = new Date().getFullYear();
    const id = await db.transaction(async (tx) => {
      const n = await nextNumber(tx, auth.organizationId, `doc:${t.code}`, year);
      const number = `${projectCode ? `${projectCode}-` : ''}${t.code}-${year}-${String(n).padStart(4, '0')}`;
      const row = (await tx.query<DocRow>(
        `INSERT INTO hse_documents (organization_id, project_id, site_id, doc_number, doc_type, title, inputs, content, risk_matrix, generator, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING *`,
        [auth.organizationId, projectId, siteId, number, body.docType, title, JSON.stringify(body.inputs), JSON.stringify(syncContent(body.docType, body.inputs, content)), JSON.stringify(settings.riskMatrix), JSON.stringify(generator), auth.userId])).rows[0]!;
      await snapshot(tx, row, 'generated', auth.userId, generator.note);
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'document.generate', entityType: 'hse_document', entityId: row.id, projectId, summary: `${number} ${t.label}: ${title} (${generator.mode})`, ip: ctx.ip });
      return row.id;
    });
    return { status: 201, json: view(auth, await load(auth, id)) };
  });

  r.get('/api/documents', async (ctx) => {
    const auth = requireAuth(ctx);
    if (!hasAnywhere(auth, 'document.view') && !hasAnywhere(auth, 'document.create')) throw forbidden();
    const q = z.object({
      type: z.enum(DOC_TYPE_KEYS).optional(), status: z.enum(DOCUMENT_STUDIO_STATUSES).optional(), projectId: z.string().uuid().optional(),
      q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).max(1000).default(1),
    }).parse(ctx.query);
    const params: unknown[] = [];
    const where = [visibility(auth, params)];
    if (q.type) { params.push(q.type); where.push(`d.doc_type = $${params.length}`); }
    if (q.status) { params.push(q.status); where.push(`d.status = $${params.length}`); }
    if (q.projectId) { params.push(q.projectId); where.push(`d.project_id = $${params.length}`); }
    if (q.q) { params.push(`%${q.q.replace(/[\\%_]/g, (m) => '\\' + m)}%`); where.push(`(d.title ILIKE $${params.length} OR d.doc_number ILIKE $${params.length})`); }
    const W = where.join(' AND ');
    const [rows, total] = await Promise.all([
      db.query<DocRow>(...compactParams(`${SELECT} WHERE ${W} ORDER BY d.updated_at DESC LIMIT 25 OFFSET ${(q.page - 1) * 25}`, params)),
      db.query<{ n: number }>(...compactParams(`SELECT count(*)::int AS n FROM hse_documents d WHERE ${W}`, params)),
    ]);
    const items = rows.rows.map((d) => {
      const v = view(auth, d);
      return { id: v.id, docNumber: v.docNumber, docType: v.docType, typeLabel: v.typeLabel, title: v.title, revisionLabel: v.revisionLabel, status: v.status, statusLabel: v.statusLabel,
        project: v.project, updatedAt: v.updatedAt, updatedBy: v.updatedBy.name, ready: v.readiness.ready, generatorMode: v.generator.mode };
    });
    return { json: { items, total: total.rows[0]!.n, page: q.page, pageSize: 25 } };
  });

  r.get('/api/documents/:id', async (ctx) => {
    const auth = requireAuth(ctx);
    return { json: view(auth, await load(auth, ctx.params.id)) };
  });

  r.patch('/api/documents/:id', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = docSaveRequestSchema.parse(await ctx.json(z.unknown()));
    const row = await load(auth, ctx.params.id);
    if (!permissionsFor(auth, row).edit) throw row.status !== 'draft' ? conflict(`A document that is ${DOCUMENT_STATUS_LABELS[row.status].toLowerCase()} cannot be edited${row.status === 'approved' ? '; start a new revision' : ''}.`) : forbidden();
    const inputs = body.inputs ?? row.inputs;
    const title = body.title ?? (body.inputs ? asText(body.inputs.title) || row.title : row.title);
    if (title.length < 3) throw badRequest('The title must have at least 3 characters');
    const content = syncContent(row.doc_type, { ...inputs, title }, body.content ?? row.content);
    docContentSchema.parse(content);
    return { json: await mutate(auth, row, body.version, { title, inputs: { ...inputs, title }, content }, 'saved', body.changeNote || 'Saved draft', ctx.ip, 'document.save') };
  });

  r.post('/api/documents/:id/regenerate', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = z.object({ version: z.number().int().min(1), useModel: z.boolean().default(false) }).parse(await ctx.json(z.unknown()));
    const row = await load(auth, ctx.params.id);
    if (!permissionsFor(auth, row).edit) throw row.status !== 'draft' ? conflict('Only drafts can be regenerated') : forbidden();
    const missing = missingRequired(row.doc_type, row.inputs, 'generate');
    if (missing.length) throw badRequest('Complete the required fields before generating', missing.map((f) => ({ path: `inputs.${f.key}`, message: `${f.label} is required` })));
    if (body.useModel) limiters.ai.check(`ai:${auth.userId}`);
    const org = (await db.query<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [auth.organizationId])).rows[0]!;
    const { content, generator } = await generation().generate(row.doc_type, row.inputs, { matrix: row.risk_matrix, organizationName: org.name, useModel: body.useModel });
    return { json: await mutate(auth, row, body.version, { content: syncContent(row.doc_type, row.inputs, content), generator }, 'regenerated', `Regenerated from saved inputs. ${generator.note}`, ctx.ip, 'document.regenerate') };
  });

  r.post('/api/documents/:id/submit', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = versionNote.parse(await ctx.json(z.unknown()));
    const row = await load(auth, ctx.params.id);
    if (!permissionsFor(auth, row).submit) throw row.status !== 'draft' ? conflict('Only drafts can be submitted') : forbidden();
    const chk = checkTransition(documentStudioLifecycle, 'submit', row.status);
    if (!chk.ok) throw conflict(chk.reason!);
    const ready = documentReadiness(row.doc_type, row.inputs, row.content, row.risk_matrix);
    if (!ready.ready) throw new HttpError(422, 'not_ready', 'The document is not ready for review', ready.issues);
    return { json: await mutate(auth, row, body.version, { status: 'in_review', submitted_by: auth.userId, submitted_at: new Date() }, 'submitted', body.note || 'Submitted for review', ctx.ip, 'document.submit') };
  });

  r.post('/api/documents/:id/decision', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = docDecisionRequestSchema.parse(await ctx.json(z.unknown()));
    const row = await load(auth, ctx.params.id);
    if (row.status !== 'in_review') throw conflict('Only documents in review can be approved or returned');
    if (!reachFor(auth, 'document.approve', row.project_id)) throw forbidden();
    if (row.submitted_by === auth.userId || row.created_by === auth.userId) throw forbidden('You prepared or submitted this document, so you cannot approve or return it. Another authorised person must review it.');
    const chk = checkTransition(documentStudioLifecycle, body.decision, row.status, { comment: body.note, actorId: auth.userId, submittedBy: row.submitted_by });
    if (!chk.ok) throw badRequest(chk.reason!);
    if (body.decision === 'approve') {
      const ready = documentReadiness(row.doc_type, row.inputs, row.content, row.risk_matrix);
      if (!ready.ready) throw new HttpError(422, 'not_ready', 'The document no longer meets the readiness checks', ready.issues);
      return { json: await mutate(auth, row, body.version, { status: 'approved', approved_by: auth.userId, approved_at: new Date(), decision_note: body.note || null }, 'approved', body.note || 'Approved', ctx.ip, 'document.approve') };
    }
    return { json: await mutate(auth, row, body.version, { status: 'draft', submitted_by: null, submitted_at: null, decision_note: body.note }, 'returned', body.note, ctx.ip, 'document.return') };
  });

  r.post('/api/documents/:id/new-revision', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = versionNote.parse(await ctx.json(z.unknown()));
    const row = await load(auth, ctx.params.id);
    if (!permissionsFor(auth, row).newRevision) throw row.status !== 'approved' ? conflict('Only an approved document can be revised') : forbidden();
    const chk = checkTransition(documentStudioLifecycle, 'new_revision', row.status, { comment: body.note });
    if (!chk.ok) throw badRequest(chk.reason!);
    return { json: await mutate(auth, row, body.version, {
      status: 'draft', revision: row.revision + 1, submitted_by: null, submitted_at: null, approved_by: null, approved_at: null, decision_note: null,
    }, 'new_revision', `${revisionLabel(row.revision + 1)} started: ${body.note}`, ctx.ip, 'document.new_revision') };
  });

  r.post('/api/documents/:id/withdraw', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = versionNote.parse(await ctx.json(z.unknown()));
    const row = await load(auth, ctx.params.id);
    if (!permissionsFor(auth, row).withdraw) throw row.status === 'approved' || row.status === 'withdrawn' ? conflict(`A document that is ${row.status} cannot be withdrawn here`) : forbidden();
    const chk = checkTransition(documentStudioLifecycle, 'withdraw', row.status, { comment: body.note });
    if (!chk.ok) throw badRequest(chk.reason!);
    return { json: await mutate(auth, row, body.version, { status: 'withdrawn', withdrawn_reason: body.note }, 'withdrawn', body.note, ctx.ip, 'document.withdraw') };
  });

  r.post('/api/documents/:id/restore', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = z.object({ version: z.number().int().min(1), revisionId: z.coerce.number().int().min(1) }).parse(await ctx.json(z.unknown()));
    const row = await load(auth, ctx.params.id);
    if (!permissionsFor(auth, row).edit) throw row.status !== 'draft' ? conflict('Restore into a draft only; start a new revision first') : forbidden();
    const snap = (await db.query<{ title: string; inputs: DocInputs; content: DocContent; revision: number; event: string; created_at: string }>(
      'SELECT title, inputs, content, revision, event, created_at FROM hse_document_revisions WHERE id = $1 AND document_id = $2 AND organization_id = $3', [body.revisionId, row.id, auth.organizationId])).rows[0];
    if (!snap) throw notFound('Revision');
    const content = syncContent(row.doc_type, snap.inputs, docContentSchema.parse(snap.content));
    return { json: await mutate(auth, row, body.version, { title: snap.title, inputs: snap.inputs, content }, 'restored', `Restored content from ${revisionLabel(snap.revision)} (${snap.event}, ${new Date(snap.created_at).toISOString().slice(0, 10)})`, ctx.ip, 'document.restore') };
  });

  r.get('/api/documents/:id/revisions', async (ctx) => {
    const auth = requireAuth(ctx);
    const row = await load(auth, ctx.params.id);
    const rows = await db.query<{ id: string; event: string; revision: number; version: number; status: string; title: string; note: string; actor: string; created_at: string }>(
      `SELECT r.id::text, r.event, r.revision, r.version, r.status, r.title, r.note, u.full_name AS actor, r.created_at
         FROM hse_document_revisions r JOIN users u ON u.id = r.actor_id WHERE r.document_id = $1 AND r.organization_id = $2 ORDER BY r.id DESC`, [row.id, auth.organizationId]);
    return { json: { items: rows.rows.map((x) => ({ id: Number(x.id), event: x.event, revision: x.revision, revisionLabel: revisionLabel(x.revision), version: x.version, status: x.status, title: x.title, note: x.note, actor: x.actor, at: x.created_at })) } };
  });

  r.get('/api/documents/:id/revisions/:rid', async (ctx) => {
    const auth = requireAuth(ctx);
    const row = await load(auth, ctx.params.id);
    const rid = z.coerce.number().int().min(1).safeParse(ctx.params.rid);
    if (!rid.success) throw notFound('Revision');
    const s = (await db.query<{ id: string; event: string; revision: number; version: number; status: string; title: string; inputs: unknown; content: unknown; note: string; actor: string; created_at: string }>(
      `SELECT r.id::text, r.event, r.revision, r.version, r.status, r.title, r.inputs, r.content, r.note, u.full_name AS actor, r.created_at
         FROM hse_document_revisions r JOIN users u ON u.id = r.actor_id WHERE r.id = $1 AND r.document_id = $2 AND r.organization_id = $3`, [rid.data, row.id, auth.organizationId])).rows[0];
    if (!s) throw notFound('Revision');
    return { json: { ...s, id: Number(s.id), revisionLabel: revisionLabel(s.revision), at: s.created_at } };
  });

  r.get('/api/documents/:id/export', async (ctx) => {
    const auth = requireAuth(ctx);
    const q = z.object({ format: z.enum(['docx', 'pdf']), revisionId: z.coerce.number().int().min(1).optional() }).parse(ctx.query);
    const row = await load(auth, ctx.params.id);
    const settings = await orgSettings(db, auth.organizationId);
    const org = (await db.query<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [auth.organizationId])).rows[0]!;
    const hist = await db.query<{ revision: number; event: string; actor: string; created_at: string; note: string }>(
      `SELECT r.revision, r.event, u.full_name AS actor, r.created_at, r.note FROM hse_document_revisions r JOIN users u ON u.id = r.actor_id
        WHERE r.document_id = $1 AND r.organization_id = $2 AND r.event IN ('generated','submitted','approved','returned','new_revision','withdrawn','restored')${q.revisionId ? ' AND r.id <= $3' : ''} ORDER BY r.id`,
      q.revisionId ? [row.id, auth.organizationId, q.revisionId] : [row.id, auth.organizationId]);
    let content = row.content, title = row.title, status = row.status, revision = row.revision, snap: DocExportMeta['snapshot'] = null, snapApprover: string | null = null;
    if (q.revisionId) {
      const s = (await db.query<{ content: DocContent; title: string; status: DocumentStudioStatus; revision: number; event: string; created_at: string; actor: string }>(
        `SELECT r.content, r.title, r.status, r.revision, r.event, r.created_at, u.full_name AS actor
           FROM hse_document_revisions r JOIN users u ON u.id = r.actor_id WHERE r.id = $1 AND r.document_id = $2 AND r.organization_id = $3`, [q.revisionId, row.id, auth.organizationId])).rows[0];
      if (!s) throw notFound('Revision');
      ({ content, title, status, revision } = s);
      snap = { event: s.event, at: new Date(s.created_at) };
      snapApprover = s.status === 'approved' ? s.actor : null;
    }
    const approvedSnapshot = snap && status === 'approved';
    const meta: DocExportMeta = {
      docType: row.doc_type, docNumber: row.doc_number, title, revision, status,
      organization: org.name, project: row.project_code ? `${row.project_code} — ${row.project_name}` : null, site: row.site_name,
      preparedBy: row.creator_name, createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at),
      submittedBy: snap ? null : row.submitter_name, submittedAt: snap ? null : row.submitted_at ? new Date(row.submitted_at) : null,
      approvedBy: snap ? snapApprover : row.approver_name,
      approvedAt: snap ? (approvedSnapshot ? snap.at : null) : row.approved_at ? new Date(row.approved_at) : null,
      generator: row.generator, matrix: row.risk_matrix, timezone: settings.timezone, snapshot: snap,
      history: hist.rows.map((h) => ({ revision: h.revision, event: h.event, actor: h.actor, at: new Date(h.created_at), note: h.note })),
    };
    await audit(db, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'document.export', entityType: 'hse_document', entityId: row.id, projectId: row.project_id, summary: `${row.doc_number} ${q.format}${q.revisionId ? ` snapshot ${q.revisionId}` : ''}`, ip: ctx.ip });
    const base = `${row.doc_number}-${revisionLabel(revision).replace(' ', '')}${status === 'approved' && !snap ? '' : '-DRAFT'}`.replace(/[^\w\-]+/g, '_');
    const disp = (ext: string) => ({ 'Content-Disposition': `attachment; filename="${base}.${ext}"`, 'Cache-Control': 'no-store' });
    if (q.format === 'docx') return { body: await documentDocx(content, meta), contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', headers: disp('docx') };
    return { body: await documentPdf(content, meta), contentType: 'application/pdf', headers: disp('pdf') };
  });
}
