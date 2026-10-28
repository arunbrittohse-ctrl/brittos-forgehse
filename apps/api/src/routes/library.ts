/**
 * Document & evidence library.
 *
 *   GET    /api/library/meta                         types, confidentiality, retention, limits
 *   POST   /api/library/uploads?filename=            stage file bytes (raw body; optional x-content-sha256)
 *   GET    /api/library                              list with filters (project, site, type, status, expiry, record, text)
 *   POST   /api/library                              new file from a staged upload (version 1, draft)
 *   GET    /api/library/:id                          file, versions, links, permissions
 *   PATCH  /api/library/:id                          metadata (optimistic version)
 *   POST   /api/library/:id/versions                 new version from a staged upload
 *   POST   /api/library/:id/versions/:vid/transition submit | withdraw | approve | reject
 *   POST   /api/library/:id/obsolete                 mark the file obsolete (reason required)
 *   POST   /api/library/:id/links                    link to an HSE record
 *   DELETE /api/library/:id/links/:linkId            remove a link
 *   GET    /api/library/versions/:vid/content        download / preview (signed-in)
 *   POST   /api/library/versions/:vid/share-link     10-minute download link
 *   GET    /api/library/dl/:token                    download through a link (no session)
 *
 * Visibility = project/site scope + confidentiality. People with only library.view see files that
 * have an approved version, and only approved/superseded versions. Versions are immutable (DB trigger).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  libraryMetaSchema, checkTransition, libraryVersionLifecycle, expiryState, scopesFor, roleHas,
  LIBRARY_DOC_TYPES, LIBRARY_DOC_TYPE_LABELS, CONFIDENTIALITY, CONFIDENTIALITY_LABELS, RETENTION, RETENTION_LABELS,
  VERSION_STATUSES, VERSION_STATUS_LABELS, LIBRARY_FILE_TYPES, LIBRARY_RECORD_TYPES,
  type LibraryMeta, type Permission, type Role, type VersionStatus, type LibraryRecordType,
} from '@forgehse/shared';
import type { Deps } from '../app';
import type { Router } from '../http/core';
import { badRequest, conflict, forbidden, notFound, HttpError } from '../http/core';
import { requireAuth, hasAnywhere, projectReach, type AuthContext } from '../auth/session';
import { nextNumber } from '../services/org';
import { audit, diff } from '../services/audit';
import { detectLibraryFile, INLINE_TYPES } from '../services/file-type';
import type { Queryable } from '../db/db';

interface FileRow {
  id: string; organization_id: string; project_id: string | null; site_id: string | null; ref_no: string; title: string; doc_number: string; doc_type: string;
  category: string; tags: string[]; description: string; confidentiality: 'internal' | 'confidential' | 'restricted'; retention: string; owner_id: string | null;
  issue_date: string | null; expiry_date: string | null; latest_version: number; current_version_id: string | null; status: 'active' | 'obsolete'; obsolete_reason: string | null;
  created_by: string; updated_by: string; version: number; created_at: string; updated_at: string;
  project_code: string | null; site_name: string | null; owner_name: string | null; creator_name: string;
}
interface VersionRow {
  id: string; file_id: string; version_no: number; filename: string; content_type: string; size_bytes: number; sha256: string; storage_key: string; change_note: string;
  status: VersionStatus; uploaded_by: string; uploaded_at: string; submitted_by: string | null; submitted_at: string | null; decided_by: string | null; decided_at: string | null;
  decision_note: string | null; uploader_name: string; decider_name: string | null;
}

const SELECT = `SELECT f.*, f.issue_date::text AS issue_date, f.expiry_date::text AS expiry_date, p.code AS project_code, s.name AS site_name,
    ou.full_name AS owner_name, cu.full_name AS creator_name
  FROM library_files f LEFT JOIN projects p ON p.id = f.project_id LEFT JOIN sites s ON s.id = f.site_id
  LEFT JOIN users ou ON ou.id = f.owner_id JOIN users cu ON cu.id = f.created_by`;

const today = () => new Date().toISOString().slice(0, 10);
const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => '\\' + m)}%`;

/** SQL: does the user hold `perm` for the file row aliased `f`? */
function reachSql(auth: AuthContext, perm: Permission, p: unknown[]): string {
  const s = scopesFor(auth.assignments, perm, auth.organizationId);
  if (s.orgWide) return 'TRUE';
  const ors: string[] = [];
  const projects = [...new Set([...s.projects, ...s.sites.map((x) => x.projectId)])];
  if (projects.length || s.sites.length) ors.push('f.project_id IS NULL'); // organisation-wide files
  if (s.projects.length) { p.push(s.projects); ors.push(`f.project_id = ANY($${p.length}::uuid[])`); }
  if (s.sites.length) {
    p.push(s.sites.map((x) => x.siteId)); ors.push(`f.site_id = ANY($${p.length}::uuid[])`);
    p.push(s.sites.map((x) => x.projectId)); ors.push(`(f.site_id IS NULL AND f.project_id = ANY($${p.length}::uuid[]))`);
  }
  return ors.length ? `(${ors.join(' OR ')})` : 'FALSE';
}

function visibilitySql(auth: AuthContext, p: unknown[]): string {
  p.push(auth.organizationId);
  const org = `f.organization_id = $${p.length}`;
  p.push(auth.userId);
  const me = `$${p.length}::uuid`;
  const mine = `(f.created_by = ${me} OR f.owner_id = ${me})`;
  const approve = reachSql(auth, 'library.approve', p);
  const upload = reachSql(auth, 'library.upload', p);
  const view = reachSql(auth, 'library.view', p);
  const prepare = reachSql(auth, 'document.create', p);
  return `${org} AND (${mine} OR ${approve} OR (
      (f.confidentiality = 'internal' AND (${upload} OR (${view} AND f.current_version_id IS NOT NULL)))
   OR (f.confidentiality = 'confidential' AND ${prepare} AND (${upload} OR f.current_version_id IS NOT NULL))))`;
}

/** In-memory reach for one file (same rules as reachSql). */
function reaches(auth: AuthContext, perm: Permission, f: { project_id: string | null; site_id: string | null }): boolean {
  const s = scopesFor(auth.assignments, perm, auth.organizationId);
  if (s.orgWide) return true;
  if (!f.project_id) return s.projects.length > 0 || s.sites.length > 0;
  if (s.projects.includes(f.project_id)) return true;
  return s.sites.some((x) => x.siteId === f.site_id || (!f.site_id && x.projectId === f.project_id));
}

/** Uploaders and approvers see every version; readers see approved and superseded ones only. */
function seesAllVersions(auth: AuthContext, f: FileRow) {
  return f.created_by === auth.userId || f.owner_id === auth.userId || reaches(auth, 'library.upload', f) || reaches(auth, 'library.approve', f);
}

function canCreateIn(auth: AuthContext, projectId: string | null, siteId: string | null, perm: Permission = 'library.upload') {
  const s = scopesFor(auth.assignments, perm, auth.organizationId);
  if (s.orgWide) return true;
  if (!projectId) return false; // organisation-wide files need an organisation-wide role
  if (s.projects.includes(projectId)) return true;
  return !!siteId && s.sites.some((x) => x.siteId === siteId);
}

function filePermissions(auth: AuthContext, f: FileRow, latest: VersionRow | undefined) {
  const upload = reaches(auth, 'library.upload', f) && canCreateIn(auth, f.project_id, f.site_id);
  const approver = reaches(auth, 'library.approve', f) && (f.project_id ? true : scopesFor(auth.assignments, 'library.approve', auth.organizationId).orgWide);
  const active = f.status === 'active';
  const openVersion = latest && (latest.status === 'draft' || latest.status === 'under_review');
  return {
    edit: active && (f.created_by === auth.userId || f.owner_id === auth.userId || approver),
    newVersion: active && upload && !openVersion,
    submit: active && !!latest && latest.status === 'draft' && (latest.uploaded_by === auth.userId || f.created_by === auth.userId) && upload,
    withdraw: active && !!latest && latest.status === 'under_review' && latest.submitted_by === auth.userId,
    decide: active && !!latest && latest.status === 'under_review' && approver && latest.uploaded_by !== auth.userId && latest.submitted_by !== auth.userId,
    obsolete: active && (approver || (f.created_by === auth.userId && !f.current_version_id)),
    link: active && upload,
  };
}

const versionView = (v: VersionRow) => ({
  id: v.id, versionNo: v.version_no, filename: v.filename, contentType: v.content_type, sizeBytes: v.size_bytes, sha256: v.sha256, changeNote: v.change_note,
  status: v.status, statusLabel: VERSION_STATUS_LABELS[v.status], uploadedBy: { id: v.uploaded_by, name: v.uploader_name }, uploadedAt: v.uploaded_at,
  submittedAt: v.submitted_at, decidedBy: v.decided_by ? { id: v.decided_by, name: v.decider_name } : null, decidedAt: v.decided_at, decisionNote: v.decision_note,
  previewable: INLINE_TYPES.has(v.content_type),
});

function fileView(f: FileRow) {
  return {
    id: f.id, ref: f.ref_no, title: f.title, docNumber: f.doc_number, docType: f.doc_type, docTypeLabel: LIBRARY_DOC_TYPE_LABELS[f.doc_type as keyof typeof LIBRARY_DOC_TYPE_LABELS] ?? f.doc_type,
    category: f.category, tags: f.tags, description: f.description, confidentiality: f.confidentiality, retention: f.retention,
    project: f.project_id ? { id: f.project_id, code: f.project_code } : null, site: f.site_id ? { id: f.site_id, name: f.site_name } : null,
    owner: f.owner_id ? { id: f.owner_id, name: f.owner_name } : null, issueDate: f.issue_date, expiryDate: f.expiry_date, expiry: expiryState(f.expiry_date, today()),
    latestVersion: f.latest_version, currentVersionId: f.current_version_id, status: f.status, obsoleteReason: f.obsolete_reason,
    createdBy: { id: f.created_by, name: f.creator_name }, version: f.version, createdAt: f.created_at, updatedAt: f.updated_at,
  };
}

const VSELECT = `SELECT v.*, uu.full_name AS uploader_name, du.full_name AS decider_name FROM library_versions v JOIN users uu ON uu.id = v.uploaded_by LEFT JOIN users du ON du.id = v.decided_by`;

export function registerLibraryRoutes(r: Router, { db, storage, config }: Deps) {
  const maxBytes = config.LIBRARY_MAX_UPLOAD_MB * 1024 * 1024;

  async function load(auth: AuthContext, id: string | undefined, q: Queryable = db): Promise<FileRow> {
    if (!z.string().uuid().safeParse(id).success) throw notFound('File');
    const p: unknown[] = [];
    const W = visibilitySql(auth, p);
    p.push(id);
    const f = (await q.query<FileRow>(`${SELECT} WHERE ${W} AND f.id = $${p.length}`, p)).rows[0];
    if (!f) throw notFound('File');
    return f;
  }

  async function versions(f: FileRow, auth: AuthContext) {
    const all = (await db.query<VersionRow>(`${VSELECT} WHERE v.file_id = $1 AND v.organization_id = $2 ORDER BY v.version_no DESC`, [f.id, f.organization_id])).rows;
    return seesAllVersions(auth, f) ? all : all.filter((v) => v.status === 'approved' || v.status === 'superseded');
  }

  async function validateMeta(auth: AuthContext, m: LibraryMeta) {
    if (m.projectId && !(await db.query('SELECT 1 FROM projects WHERE id = $1 AND organization_id = $2', [m.projectId, auth.organizationId])).rowCount) throw badRequest('Unknown project');
    if (m.siteId && !(await db.query('SELECT 1 FROM sites WHERE id = $1 AND project_id = $2 AND organization_id = $3', [m.siteId, m.projectId, auth.organizationId])).rowCount) throw badRequest('Unknown site for this project');
    if (m.ownerId && !(await db.query('SELECT 1 FROM role_assignments WHERE user_id = $1 AND organization_id = $2', [m.ownerId, auth.organizationId])).rowCount) throw badRequest('The owner must be a member of this organisation');
  }

  /** Takes a staged upload owned by this user; the bytes stay where they are and become the version. */
  async function claimUpload(tx: Queryable, auth: AuthContext, uploadId: string) {
    const u = (await tx.query<{ id: string; filename: string; content_type: string; size_bytes: number; sha256: string; storage_key: string }>(
      `DELETE FROM library_uploads WHERE id = $1 AND organization_id = $2 AND uploaded_by = $3 AND expires_at > now() RETURNING *`, [uploadId, auth.organizationId, auth.userId])).rows[0];
    if (!u) throw badRequest('The upload was not found or has expired. Upload the file again.');
    return u;
  }

  async function insertVersion(tx: Queryable, auth: AuthContext, fileId: string, versionNo: number, u: Awaited<ReturnType<typeof claimUpload>>, note: string) {
    return (await tx.query<{ id: string }>(
      `INSERT INTO library_versions (organization_id, file_id, version_no, filename, content_type, size_bytes, sha256, storage_key, change_note, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [auth.organizationId, fileId, versionNo, u.filename, u.content_type, u.size_bytes, u.sha256, u.storage_key, note, auth.userId])).rows[0]!.id;
  }

  async function detail(auth: AuthContext, f: FileRow) {
    const vs = await versions(f, auth);
    const allLatest = (await db.query<VersionRow>(`${VSELECT} WHERE v.file_id = $1 ORDER BY v.version_no DESC LIMIT 1`, [f.id])).rows[0];
    const links = await db.query<{ id: string; record_type: LibraryRecordType; record_id: string; ref: string | null; label: string | null }>(
      `SELECT l.id, l.record_type, l.record_id, COALESCE(o.ref_no, h.ref_no, d.doc_number, pt.ref_no) AS ref, COALESCE(left(o.description, 120), h.activity, d.title, left(pt.work_description, 120)) AS label
         FROM library_links l
         LEFT JOIN observations o ON l.record_type = 'observation' AND o.id = l.record_id AND o.organization_id = l.organization_id
         LEFT JOIN hazard_register h ON l.record_type = 'hazard' AND h.id = l.record_id AND h.organization_id = l.organization_id
         LEFT JOIN hse_documents d ON l.record_type = 'document' AND d.id = l.record_id AND d.organization_id = l.organization_id
         LEFT JOIN permits pt ON l.record_type = 'permit' AND pt.id = l.record_id AND pt.organization_id = l.organization_id
        WHERE l.file_id = $1 AND l.organization_id = $2 ORDER BY l.created_at`, [f.id, auth.organizationId]);
    return { ...fileView(f), versions: vs.map(versionView), links: links.rows.map((l) => ({ id: l.id, recordType: l.record_type, recordId: l.record_id, ref: l.ref, label: l.label })), permissions: filePermissions(auth, f, allLatest) };
  }

  /** Optimistic file update + audit in one transaction. */
  async function touch(tx: Queryable, auth: AuthContext, f: FileRow, expectVersion: number, set: Record<string, unknown>) {
    const k = Object.keys(set);
    const u = await tx.query(`UPDATE library_files SET ${k.map((c, i) => `${c} = $${i + 1}`).join(', ')}${k.length ? ', ' : ''}updated_by = $${k.length + 1}, version = version + 1, updated_at = now()
       WHERE id = $${k.length + 2} AND version = $${k.length + 3}`, [...Object.values(set), auth.userId, f.id, expectVersion]);
    if (!u.rowCount) throw conflict('This file was changed by someone else. Reload it and try again.');
  }

  async function versionFor(auth: AuthContext, vid: string | undefined) {
    if (!z.string().uuid().safeParse(vid).success) throw notFound('Version');
    const v = (await db.query<VersionRow>(`${VSELECT} WHERE v.id = $1 AND v.organization_id = $2`, [vid, auth.organizationId])).rows[0];
    if (!v) throw notFound('Version');
    const f = await load(auth, v.file_id);
    if (!seesAllVersions(auth, f) && v.status !== 'approved' && v.status !== 'superseded') throw notFound('Version');
    return { f, v };
  }

  async function send(v: VersionRow, download: boolean) {
    const inline = !download && INLINE_TYPES.has(v.content_type);
    return {
      body: await storage.get(v.storage_key), contentType: v.content_type,
      headers: {
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${v.filename.replace(/["\\\r\n]/g, '')}"`,
        // PDFs open in the browser's own viewer inside the app's preview frame; everything else is sandboxed.
        'Content-Security-Policy': v.content_type === 'application/pdf' && inline ? "default-src 'none'; frame-ancestors 'self'" : "default-src 'none'; frame-ancestors 'self'; sandbox",
        'X-Frame-Options': 'SAMEORIGIN',
        'Cache-Control': 'private, no-store', 'X-Content-SHA256': v.sha256,
      },
    };
  }

  // ---------------------------------------------------------------- routes

  r.get('/api/library/meta', async (ctx) => {
    const auth = requireAuth(ctx);
    if (!hasAnywhere(auth, 'library.view')) throw forbidden();
    return { json: {
      docTypes: LIBRARY_DOC_TYPES.map((v) => ({ value: v, label: LIBRARY_DOC_TYPE_LABELS[v] })),
      confidentiality: CONFIDENTIALITY.map((v) => ({ value: v, ...CONFIDENTIALITY_LABELS[v] })),
      retention: RETENTION.map((v) => ({ value: v, label: RETENTION_LABELS[v] })),
      statuses: VERSION_STATUSES.map((v) => ({ value: v, label: VERSION_STATUS_LABELS[v] })),
      fileTypes: LIBRARY_FILE_TYPES, maxUploadMb: config.LIBRARY_MAX_UPLOAD_MB,
      canUpload: hasAnywhere(auth, 'library.upload'), canApprove: hasAnywhere(auth, 'library.approve'),
      canCreateOrgWide: scopesFor(auth.assignments, 'library.upload', auth.organizationId).orgWide,
      malwareScanning: false,
    } };
  });

  /** People who can be named as a file owner in a project (members with library access). */
  r.get('/api/library/people', async (ctx) => {
    const auth = requireAuth(ctx);
    if (!hasAnywhere(auth, 'library.upload')) throw forbidden();
    const projectId = z.string().uuid().nullable().catch(null).parse(ctx.query.projectId || null);
    const rows = (await db.query<{ id: string; full_name: string; job_title: string; role: Role }>(
      `SELECT u.id, u.full_name, u.job_title, ra.role FROM users u JOIN role_assignments ra ON ra.user_id = u.id
        WHERE ra.organization_id = $1 AND u.active AND (ra.project_id IS NULL OR ra.project_id = $2) ORDER BY u.full_name`, [auth.organizationId, projectId])).rows;
    const seen = new Map<string, { id: string; fullName: string; jobTitle: string }>();
    for (const u of rows) if (roleHas(u.role, 'library.view') && !seen.has(u.id)) seen.set(u.id, { id: u.id, fullName: u.full_name, jobTitle: u.job_title });
    return { json: { items: [...seen.values()] } };
  });

  r.post('/api/library/uploads', async (ctx) => {
    const auth = requireAuth(ctx);
    if (!hasAnywhere(auth, 'library.upload')) throw forbidden();
    const q = z.object({ filename: z.string().trim().min(1).max(200).regex(/^[^/\\\0]+$/, 'Invalid file name') }).parse(ctx.query);
    const data = await ctx.raw(maxBytes);
    const det = detectLibraryFile(data, q.filename);
    if (!det.ok) throw new HttpError(415, 'unsupported_file', det.reason);
    const sha256 = createHash('sha256').update(data).digest('hex');
    const declared = String(ctx.req.headers['x-content-sha256'] ?? '').toLowerCase();
    if (declared && declared !== sha256) throw new HttpError(422, 'integrity_failed', 'The file was changed or damaged in transit (checksum mismatch). Upload it again.');
    // Clear this organisation's expired staged uploads before adding another.
    const expired = await db.query<{ storage_key: string }>('DELETE FROM library_uploads WHERE organization_id = $1 AND expires_at < now() RETURNING storage_key', [auth.organizationId]);
    for (const e of expired.rows) await storage.delete(e.storage_key).catch(() => {});
    const key = `library/${auth.organizationId}/${randomUUID()}`;
    await storage.put(key, data, det.type);
    try {
      const u = (await db.query<{ id: string; expires_at: string }>(
        `INSERT INTO library_uploads (organization_id, uploaded_by, filename, content_type, size_bytes, sha256, storage_key) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, expires_at`,
        [auth.organizationId, auth.userId, q.filename, det.type, data.length, sha256, key])).rows[0]!;
      return { status: 201, json: { uploadId: u.id, filename: q.filename, contentType: det.type, sizeBytes: data.length, sha256, expiresAt: u.expires_at } };
    } catch (e) { await storage.delete(key).catch(() => {}); throw e; }
  });

  r.get('/api/library', async (ctx) => {
    const auth = requireAuth(ctx);
    if (!hasAnywhere(auth, 'library.view')) throw forbidden();
    const q = z.object({
      projectId: z.string().uuid().optional(), siteId: z.string().uuid().optional(), orgWide: z.enum(['1']).optional(),
      docType: z.enum(LIBRARY_DOC_TYPES).optional(), status: z.enum(['active', 'obsolete', 'all']).default('active'),
      versionStatus: z.enum(VERSION_STATUSES).optional(), expiry: z.enum(['expired', 'due_30']).optional(),
      confidentiality: z.enum(CONFIDENTIALITY).optional(), tag: z.string().max(30).optional(), q: z.string().trim().max(100).optional(),
      recordType: z.enum(LIBRARY_RECORD_TYPES).optional(), recordId: z.string().uuid().optional(), awaitingMe: z.enum(['1']).optional(),
      page: z.coerce.number().int().min(1).max(1000).default(1),
    }).parse(ctx.query);
    const p: unknown[] = [];
    const where = [visibilitySql(auth, p)];
    const add = (sql: string, v: unknown) => { p.push(v); where.push(sql.replaceAll('?', `$${p.length}`)); };
    if (q.projectId) add('f.project_id = ?', q.projectId);
    if (q.orgWide) where.push('f.project_id IS NULL');
    if (q.siteId) add('f.site_id = ?', q.siteId);
    if (q.docType) add('f.doc_type = ?', q.docType);
    if (q.status !== 'all') add('f.status = ?', q.status);
    if (q.confidentiality) add('f.confidentiality = ?', q.confidentiality);
    if (q.tag) add('? = ANY(f.tags)', q.tag);
    if (q.expiry === 'expired') where.push('f.expiry_date < current_date');
    if (q.expiry === 'due_30') where.push('f.expiry_date BETWEEN current_date AND current_date + 30');
    if (q.versionStatus) add('lv.status = ?', q.versionStatus);
    if (q.awaitingMe) {
      where.push(`lv.status = 'under_review'`);
      add('lv.uploaded_by <> ? AND COALESCE(lv.submitted_by, lv.uploaded_by) <> ?', auth.userId);
      where.push(reachSql(auth, 'library.approve', p));
    }
    if (q.recordType && q.recordId) { p.push(q.recordType, q.recordId); where.push(`EXISTS (SELECT 1 FROM library_links l WHERE l.file_id = f.id AND l.record_type = $${p.length - 1} AND l.record_id = $${p.length})`); }
    if (q.q) add(`(f.title ILIKE ? OR f.ref_no ILIKE ? OR f.doc_number ILIKE ? OR f.category ILIKE ? OR f.description ILIKE ? OR array_to_string(f.tags, ' ') ILIKE ? OR lv.filename ILIKE ?)`, like(q.q));
    const W = where.join(' AND ');
    const cp: unknown[] = [];
    const CW = `${visibilitySql(auth, cp)} AND f.status = 'active'` + (q.projectId ? ` AND f.project_id = $${cp.push(q.projectId)}` : '');
    const FROM = `FROM library_files f LEFT JOIN projects p ON p.id = f.project_id LEFT JOIN sites s ON s.id = f.site_id
      LEFT JOIN users ou ON ou.id = f.owner_id JOIN users cu ON cu.id = f.created_by
      LEFT JOIN library_versions lv ON lv.file_id = f.id AND lv.version_no = f.latest_version`;
    const [rows, total, counts] = await Promise.all([
      db.query<FileRow & { lv_status: VersionStatus; lv_filename: string; lv_type: string; lv_size: number; lv_id: string }>(
        `SELECT f.*, f.issue_date::text AS issue_date, f.expiry_date::text AS expiry_date, p.code AS project_code, s.name AS site_name, ou.full_name AS owner_name, cu.full_name AS creator_name,
                lv.status AS lv_status, lv.filename AS lv_filename, lv.content_type AS lv_type, lv.size_bytes AS lv_size, lv.id AS lv_id
           ${FROM} WHERE ${W} ORDER BY f.updated_at DESC LIMIT 25 OFFSET ${(q.page - 1) * 25}`, p),
      db.query<{ n: number }>(`SELECT count(*)::int AS n ${FROM} WHERE ${W}`, p),
      db.query<{ expired: number; due: number; review: number }>(
        `SELECT count(*) FILTER (WHERE f.expiry_date < current_date)::int AS expired, count(*) FILTER (WHERE f.expiry_date BETWEEN current_date AND current_date + 30)::int AS due,
                count(*) FILTER (WHERE lv.status = 'under_review')::int AS review ${FROM} WHERE ${CW}`, cp),
    ]);
    return { json: {
      items: rows.rows.map((f) => {
        const showLatest = seesAllVersions(auth, f);
        return { ...fileView(f), latest: showLatest && f.lv_id ? { id: f.lv_id, status: f.lv_status, statusLabel: VERSION_STATUS_LABELS[f.lv_status], filename: f.lv_filename, contentType: f.lv_type, sizeBytes: f.lv_size } : null };
      }),
      total: total.rows[0]!.n, page: q.page, pageSize: 25, counts: counts.rows[0],
    } };
  });

  r.post('/api/library', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = z.object({ uploadId: z.string().uuid(), meta: libraryMetaSchema, changeNote: z.string().trim().max(500).default(''), link: z.object({ recordType: z.enum(LIBRARY_RECORD_TYPES), recordId: z.string().uuid() }).optional() }).parse(await ctx.json(z.unknown()));
    const m = body.meta;
    if (!canCreateIn(auth, m.projectId, m.siteId)) throw forbidden(m.projectId ? undefined : 'Only organisation-wide roles can add organisation-wide files. Choose a project.');
    await validateMeta(auth, m);
    const id = await db.transaction(async (tx) => {
      const u = await claimUpload(tx, auth, body.uploadId);
      const year = new Date().getFullYear();
      const ref = `LIB-${year}-${String(await nextNumber(tx, auth.organizationId, 'library', year)).padStart(5, '0')}`;
      const f = (await tx.query<{ id: string }>(
        `INSERT INTO library_files (organization_id, project_id, site_id, ref_no, title, doc_number, doc_type, category, tags, description, confidentiality, retention, owner_id, issue_date, expiry_date, latest_version, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,1,$16,$16) RETURNING id`,
        [auth.organizationId, m.projectId, m.siteId, ref, m.title, m.docNumber, m.docType, m.category, m.tags, m.description, m.confidentiality, m.retention, m.ownerId, m.issueDate, m.expiryDate, auth.userId])).rows[0]!;
      await insertVersion(tx, auth, f.id, 1, u, body.changeNote || 'First upload');
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'library.upload', entityType: 'library_file', entityId: f.id, projectId: m.projectId,
        summary: `${ref} v1: ${m.title}`.slice(0, 500), changes: { filename: u.filename, sha256: u.sha256, sizeBytes: u.size_bytes, confidentiality: m.confidentiality }, ip: ctx.ip });
      return f.id;
    });
    if (body.link) await linkRecord(auth, await load(auth, id), body.link.recordType, body.link.recordId, ctx.ip);
    return { status: 201, json: await detail(auth, await load(auth, id)) };
  });

  r.get('/api/library/:id', async (ctx) => {
    const auth = requireAuth(ctx);
    return { json: await detail(auth, await load(auth, ctx.params.id)) };
  });

  r.patch('/api/library/:id', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = z.object({ version: z.number().int().min(1), meta: libraryMetaSchema }).parse(await ctx.json(z.unknown()));
    const f = await load(auth, ctx.params.id);
    const latest = (await db.query<VersionRow>(`${VSELECT} WHERE v.file_id = $1 ORDER BY v.version_no DESC LIMIT 1`, [f.id])).rows[0];
    if (!filePermissions(auth, f, latest).edit) throw f.status === 'obsolete' ? conflict('An obsolete file cannot be edited.') : forbidden();
    const m = body.meta;
    if ((m.projectId ?? null) !== f.project_id || (m.siteId ?? null) !== f.site_id) {
      if ((await db.query('SELECT 1 FROM library_links WHERE file_id = $1', [f.id])).rowCount) throw conflict('Remove the record links before moving this file to another project or site.');
      if (!canCreateIn(auth, m.projectId, m.siteId)) throw forbidden();
    }
    await validateMeta(auth, m);
    const set = { project_id: m.projectId, site_id: m.siteId, title: m.title, doc_number: m.docNumber, doc_type: m.docType, category: m.category, tags: m.tags, description: m.description,
      confidentiality: m.confidentiality, retention: m.retention, owner_id: m.ownerId, issue_date: m.issueDate, expiry_date: m.expiryDate };
    const before = { project_id: f.project_id, site_id: f.site_id, title: f.title, doc_number: f.doc_number, doc_type: f.doc_type, category: f.category, tags: f.tags, description: f.description,
      confidentiality: f.confidentiality, retention: f.retention, owner_id: f.owner_id, issue_date: f.issue_date, expiry_date: f.expiry_date };
    await db.transaction(async (tx) => {
      await touch(tx, auth, f, body.version, set);
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'library.update', entityType: 'library_file', entityId: f.id, projectId: m.projectId, summary: `${f.ref_no}: details updated`, changes: diff(before, set), ip: ctx.ip });
    });
    return { json: await detail(auth, await load(auth, f.id)) };
  });

  r.post('/api/library/:id/versions', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = z.object({ uploadId: z.string().uuid(), version: z.number().int().min(1), changeNote: z.string().trim().min(3, 'Say what changed in this version').max(500) }).parse(await ctx.json(z.unknown()));
    const f = await load(auth, ctx.params.id);
    const latest = (await db.query<VersionRow>(`${VSELECT} WHERE v.file_id = $1 ORDER BY v.version_no DESC LIMIT 1`, [f.id])).rows[0];
    const perm = filePermissions(auth, f, latest);
    if (!perm.newVersion) throw latest && (latest.status === 'draft' || latest.status === 'under_review') && f.status === 'active' && reaches(auth, 'library.upload', f)
      ? conflict(`Version ${latest.version_no} is still ${VERSION_STATUS_LABELS[latest.status].toLowerCase()}. Finish or withdraw it before uploading another.`)
      : f.status === 'obsolete' ? conflict('An obsolete file cannot take new versions.') : forbidden();
    await db.transaction(async (tx) => {
      const u = await claimUpload(tx, auth, body.uploadId);
      const n = f.latest_version + 1;
      await touch(tx, auth, f, body.version, { latest_version: n });
      await insertVersion(tx, auth, f.id, n, u, body.changeNote);
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'library.new_version', entityType: 'library_file', entityId: f.id, projectId: f.project_id,
        summary: `${f.ref_no} v${n}: ${body.changeNote}`.slice(0, 500), changes: { filename: u.filename, sha256: u.sha256, sizeBytes: u.size_bytes }, ip: ctx.ip });
    });
    return { status: 201, json: await detail(auth, await load(auth, f.id)) };
  });

  r.post('/api/library/:id/versions/:vid/transition', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = z.object({ action: z.enum(['submit', 'withdraw', 'approve', 'reject']), note: z.string().trim().max(1000).default(''), version: z.number().int().min(1) }).parse(await ctx.json(z.unknown()));
    const f = await load(auth, ctx.params.id);
    const v = (await db.query<VersionRow>(`${VSELECT} WHERE v.id = $1 AND v.file_id = $2`, [ctx.params.vid, f.id])).rows[0];
    if (!v) throw notFound('Version');
    const latest = (await db.query<VersionRow>(`${VSELECT} WHERE v.file_id = $1 ORDER BY v.version_no DESC LIMIT 1`, [f.id])).rows[0]!;
    if (latest.id !== v.id) throw conflict('Only the latest version can move through review.');
    const perm = filePermissions(auth, f, latest);
    const chk = checkTransition(libraryVersionLifecycle, body.action, v.status, { comment: body.note, actorId: auth.userId, submittedBy: v.submitted_by ?? v.uploaded_by });
    if (!chk.ok) {
      if (chk.reason?.startsWith('Not allowed')) throw conflict(`This version is ${VERSION_STATUS_LABELS[v.status].toLowerCase()}.`);
      if (chk.reason?.includes('submitted the work')) throw forbidden('You uploaded or submitted this version, so someone else must review it.');
      throw badRequest(chk.reason!);
    }
    if ((body.action === 'approve' || body.action === 'reject') && (v.uploaded_by === auth.userId || v.submitted_by === auth.userId)) throw forbidden('You uploaded or submitted this version, so someone else must review it.');
    const allowed = { submit: perm.submit, withdraw: perm.withdraw, approve: perm.decide, reject: perm.decide }[body.action];
    if (!allowed) throw forbidden();
    await db.transaction(async (tx) => {
      const to = libraryVersionLifecycle.transitions[body.action].to;
      if (body.action === 'submit') await tx.query(`UPDATE library_versions SET status = $1, submitted_by = $2, submitted_at = now() WHERE id = $3 AND status = 'draft'`, [to, auth.userId, v.id]);
      if (body.action === 'withdraw') await tx.query(`UPDATE library_versions SET status = $1, submitted_by = NULL, submitted_at = NULL WHERE id = $2 AND status = 'under_review'`, [to, v.id]);
      if (body.action === 'approve' || body.action === 'reject') {
        const u = await tx.query(`UPDATE library_versions SET status = $1, decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $4 AND status = 'under_review'`, [to, auth.userId, body.note || null, v.id]);
        if (!u.rowCount) throw conflict('This version was changed by someone else. Reload and try again.');
      }
      if (body.action === 'approve') {
        if (f.current_version_id) await tx.query(`UPDATE library_versions SET status = 'superseded' WHERE id = $1 AND status = 'approved'`, [f.current_version_id]);
        await touch(tx, auth, f, body.version, { current_version_id: v.id });
      } else await touch(tx, auth, f, body.version, {});
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: `library.${body.action}`, entityType: 'library_file', entityId: f.id, projectId: f.project_id,
        summary: `${f.ref_no} v${v.version_no}: ${libraryVersionLifecycle.transitions[body.action].label}${body.note ? ` — ${body.note}` : ''}`.slice(0, 500), ip: ctx.ip });
    });
    return { json: await detail(auth, await load(auth, f.id)) };
  });

  r.post('/api/library/:id/obsolete', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = z.object({ version: z.number().int().min(1), note: z.string().trim().min(3, 'Give the reason').max(500) }).parse(await ctx.json(z.unknown()));
    const f = await load(auth, ctx.params.id);
    if (!filePermissions(auth, f, undefined).obsolete) throw f.status === 'obsolete' ? conflict('Already obsolete.') : forbidden();
    await db.transaction(async (tx) => {
      await touch(tx, auth, f, body.version, { status: 'obsolete', obsolete_reason: body.note });
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'library.obsolete', entityType: 'library_file', entityId: f.id, projectId: f.project_id, summary: `${f.ref_no}: obsolete — ${body.note}`.slice(0, 500), ip: ctx.ip });
    });
    return { json: await detail(auth, await load(auth, f.id)) };
  });

  async function linkRecord(auth: AuthContext, f: FileRow, type: LibraryRecordType, recordId: string, ip: string) {
    const latest = (await db.query<VersionRow>(`${VSELECT} WHERE v.file_id = $1 ORDER BY v.version_no DESC LIMIT 1`, [f.id])).rows[0];
    if (!filePermissions(auth, f, latest).link) throw forbidden();
    const table = { observation: 'observations', hazard: 'hazard_register', document: 'hse_documents', permit: 'permits' }[type];
    const perm: Permission = { observation: 'observation.view', hazard: 'risk.view', document: 'document.view', permit: 'permit.view' }[type] as Permission;
    const rec = (await db.query<{ project_id: string | null; ref: string }>(`SELECT project_id, ${type === 'document' ? 'doc_number' : 'ref_no'} AS ref FROM ${table} WHERE id = $1 AND organization_id = $2`, [recordId, auth.organizationId])).rows[0];
    if (!rec) throw notFound('Record');
    const reachView = projectReach(auth, perm);
    const reachAlt = type === 'hazard' ? projectReach(auth, 'risk.manage') : { orgWide: false, projectIds: [] as string[] };
    if (rec.project_id && !(reachView.orgWide || reachView.projectIds.includes(rec.project_id) || reachAlt.orgWide || reachAlt.projectIds.includes(rec.project_id))) throw notFound('Record');
    if (f.project_id && rec.project_id !== f.project_id) throw badRequest('The file and the record belong to different projects.');
    await db.transaction(async (tx) => {
      const ins = await tx.query(`INSERT INTO library_links (organization_id, file_id, record_type, record_id, created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [auth.organizationId, f.id, type, recordId, auth.userId]);
      if (ins.rowCount) await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'library.link', entityType: 'library_file', entityId: f.id, projectId: f.project_id, summary: `${f.ref_no} linked to ${type} ${rec.ref}`, ip });
    });
  }

  r.post('/api/library/:id/links', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = z.object({ recordType: z.enum(LIBRARY_RECORD_TYPES), recordId: z.string().uuid() }).parse(await ctx.json(z.unknown()));
    const f = await load(auth, ctx.params.id);
    await linkRecord(auth, f, body.recordType, body.recordId, ctx.ip);
    return { status: 201, json: await detail(auth, await load(auth, f.id)) };
  });

  r.delete('/api/library/:id/links/:linkId', async (ctx) => {
    const auth = requireAuth(ctx);
    const f = await load(auth, ctx.params.id);
    if (!filePermissions(auth, f, undefined).link) throw forbidden();
    if (!z.string().uuid().safeParse(ctx.params.linkId).success) throw notFound('Link');
    await db.transaction(async (tx) => {
      const d = await tx.query<{ record_type: string }>('DELETE FROM library_links WHERE id = $1 AND file_id = $2 RETURNING record_type', [ctx.params.linkId, f.id]);
      if (!d.rowCount) throw notFound('Link');
      await audit(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'library.unlink', entityType: 'library_file', entityId: f.id, projectId: f.project_id, summary: `${f.ref_no} unlinked from a ${d.rows[0]!.record_type}`, ip: ctx.ip });
    });
    return { json: await detail(auth, await load(auth, f.id)) };
  });

  r.get('/api/library/versions/:vid/content', async (ctx) => {
    const auth = requireAuth(ctx);
    const { f, v } = await versionFor(auth, ctx.params.vid);
    const download = ctx.query.download === '1';
    await audit(db, { organizationId: auth.organizationId, actorUserId: auth.userId, action: download ? 'library.download' : 'library.view_file', entityType: 'library_file', entityId: f.id, projectId: f.project_id, summary: `${f.ref_no} v${v.version_no} (${f.confidentiality})`, ip: ctx.ip });
    return send(v, download);
  });

  r.post('/api/library/versions/:vid/share-link', async (ctx) => {
    const auth = requireAuth(ctx);
    const { f, v } = await versionFor(auth, ctx.params.vid);
    if (f.status !== 'active') throw conflict('Obsolete files cannot be shared.');
    const token = randomBytes(32).toString('base64url');
    const minutes = 10;
    const row = (await db.query<{ expires_at: string }>(
      `INSERT INTO library_download_links (token_hash, organization_id, version_id, created_by, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(mins => $5)) RETURNING expires_at`,
      [createHash('sha256').update(token).digest(), auth.organizationId, v.id, auth.userId, minutes])).rows[0]!;
    await db.query('DELETE FROM library_download_links WHERE expires_at < now()');
    await audit(db, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'library.share_link', entityType: 'library_file', entityId: f.id, projectId: f.project_id, summary: `${f.ref_no} v${v.version_no}: ${minutes}-minute download link`, ip: ctx.ip });
    return { status: 201, json: { path: `/api/library/dl/${token}`, expiresAt: row.expires_at } };
  });

  r.get('/api/library/dl/:token', async (ctx) => {
    const t = ctx.params.token ?? '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(t)) throw notFound('Link');
    const row = (await db.query<VersionRow & { link_org: string; link_by: string; file_status: string; ref_no: string; project_id: string | null }>(
      `SELECT v.*, l.organization_id AS link_org, l.created_by AS link_by, f.status AS file_status, f.ref_no, f.project_id, '' AS uploader_name, NULL AS decider_name
         FROM library_download_links l JOIN library_versions v ON v.id = l.version_id JOIN library_files f ON f.id = v.file_id
        WHERE l.token_hash = $1 AND l.expires_at > now()`, [createHash('sha256').update(t).digest()])).rows[0];
    if (!row || row.file_status !== 'active') throw new HttpError(410, 'link_expired', 'This download link has expired. Ask for a new one.');
    await audit(db, { organizationId: row.link_org, actorUserId: null, action: 'library.link_download', entityType: 'library_file', entityId: row.file_id, projectId: row.project_id, summary: `${row.ref_no} v${row.version_no} downloaded through a link`, ip: ctx.ip });
    return send(row, true);
  });
}
