/**
 * Document & evidence library: register, upload (drag and drop or camera), file detail with
 * versions, review, preview, download links and record links. Every number comes from the API.
 */
import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  LIBRARY_DOC_TYPES, LIBRARY_DOC_TYPE_LABELS, CONFIDENTIALITY, CONFIDENTIALITY_LABELS, RETENTION, RETENTION_LABELS, formatBytes,
  type Confidentiality, type VersionStatus, type LibraryRecordType, type LibraryDocType, type Retention,
} from '@forgehse/shared';
import { api, ApiError, fieldErrors } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Link, navigate, useLocation } from '../lib/router';
import { fmtDate, fmtDateTime } from '../lib/format';
import { PageHead } from '../components/AppShell';
import { Dialog, Empty, ErrorNotice, Field, Icon, Loading, Pagination, useToast } from '../components/ui';

type Expiry = 'expired' | 'due_30' | 'valid' | 'none';
interface FileBase {
  id: string; ref: string; title: string; docNumber: string; docType: LibraryDocType; docTypeLabel: string; category: string; tags: string[]; description: string;
  confidentiality: Confidentiality; retention: Retention; project: { id: string; code: string } | null; site: { id: string; name: string } | null;
  owner: { id: string; name: string } | null; issueDate: string | null; expiryDate: string | null; expiry: Expiry; latestVersion: number; currentVersionId: string | null;
  status: 'active' | 'obsolete'; obsoleteReason: string | null; createdBy: { id: string; name: string }; version: number; createdAt: string; updatedAt: string;
}
interface ListItem extends FileBase { latest: { id: string; status: VersionStatus; statusLabel: string; filename: string; contentType: string; sizeBytes: number } | null }
interface ListResp { items: ListItem[]; total: number; page: number; pageSize: number; counts: { expired: number; due: number; review: number } }
interface Version {
  id: string; versionNo: number; filename: string; contentType: string; sizeBytes: number; sha256: string; changeNote: string; status: VersionStatus; statusLabel: string;
  uploadedBy: { id: string; name: string }; uploadedAt: string; submittedAt: string | null; decidedBy: { name: string } | null; decidedAt: string | null; decisionNote: string | null; previewable: boolean;
}
interface FileDetail extends FileBase {
  versions: Version[]; links: { id: string; recordType: LibraryRecordType; recordId: string; ref: string | null; label: string | null }[];
  permissions: { edit: boolean; newVersion: boolean; submit: boolean; withdraw: boolean; decide: boolean; obsolete: boolean; link: boolean };
}
interface Meta { maxUploadMb: number; canUpload: boolean; canApprove: boolean; canCreateOrgWide: boolean; fileTypes: { ext: string; label: string }[]; malwareScanning: boolean }

const RECORD_PATH: Record<LibraryRecordType, string> = { observation: '/app/observations/', hazard: '/app/hazards/', document: '/app/documents/', permit: '/app/permits/' };
const RECORD_LABEL: Record<LibraryRecordType, string> = { observation: 'Observation', hazard: 'Hazard', document: 'HSE document', permit: 'Permit to work' };
const ACCEPT = '.pdf,.docx,.xlsx,.pptx,.csv,.jpg,.jpeg,.png,.webp,.heic,.mp4,.mov,.m4a';

export function VersionChip({ s, label }: { s: VersionStatus; label: string }) {
  const c = s === 'approved' ? 'risk-low' : s === 'rejected' ? 'risk-critical' : s === 'superseded' ? 'chip-neutral' : s === 'draft' ? 'risk-high' : 'risk-medium';
  return <span className={`risk ${c}`}>{label}</span>;
}
function ExpiryNote({ f }: { f: Pick<FileBase, 'expiry' | 'expiryDate'> }) {
  if (f.expiry === 'none') return <span className="muted">—</span>;
  return <span className={f.expiry === 'expired' ? 'text-critical' : f.expiry === 'due_30' ? 'text-warn' : ''}>{fmtDate(f.expiryDate)}{f.expiry === 'expired' ? ' · expired' : f.expiry === 'due_30' ? ' · due soon' : ''}</span>;
}
const ConfChip = ({ c }: { c: Confidentiality }) => c === 'internal' ? null : <span className="chip-neutral risk" title={CONFIDENTIALITY_LABELS[c].help}><Icon name="shield" size={12} />{CONFIDENTIALITY_LABELS[c].label}</span>;

async function sha256Hex(file: Blob): Promise<string | undefined> {
  try {
    const d = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return undefined; }
}

async function stageUpload(file: File) {
  const sum = await sha256Hex(file);
  return api<{ uploadId: string; contentType: string; sizeBytes: number; sha256: string }>('/library/uploads', { method: 'POST', file, query: { filename: file.name }, headers: sum ? { 'X-Content-SHA256': sum } : {} });
}

/* ================================================================ drop zone */

function DropZone({ file, onFile, maxMb, id }: { file: File | null; onFile: (f: File | null) => void; maxMb: number; id: string }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const pick = (f: File | undefined) => { if (f) onFile(f); };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); };
  return (
    <div className={`dropzone ${over ? 'over' : ''} ${file ? 'has-file' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
      <input ref={input} id={id} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => pick(e.target.files?.[0])} />
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => pick(e.target.files?.[0])} />
      {file ? (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <Icon name={file.type.startsWith('image/') ? 'image' : 'doc'} />
          <div><strong>{file.name}</strong><div className="small muted">{formatBytes(file.size)}{file.size > maxMb * 1024 * 1024 ? ` — larger than the ${maxMb} MB limit` : ''}</div></div>
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={() => onFile(null)}>Choose another file</button>
        </div>
      ) : (
        <div className="stack" style={{ alignItems: 'center', gap: 8, textAlign: 'center' }}>
          <Icon name="upload" size={24} />
          <span>Drag a file here, or</span>
          <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={() => input.current?.click()}>Choose a file</button>
            <button type="button" className="btn show-mobile-inline" onClick={() => camera.current?.click()}><Icon name="camera" />Take a photo</button>
          </div>
          <span className="small muted">PDF, Word, Excel, PowerPoint, CSV, images (JPG, PNG, WebP, HEIC), MP4/MOV video or M4A audio · up to {maxMb} MB</span>
        </div>
      )}
    </div>
  );
}

/* ================================================================ register */

export function LibraryList() {
  const { me, can } = useAuth();
  const { search } = useLocation();
  const [projectId, setProjectId] = useState(search.get('projectId') ?? '');
  const [docType, setDocType] = useState(''); const [expiry, setExpiry] = useState(search.get('expiry') ?? ''); const [status, setStatus] = useState('active');
  const [awaitingMe, setAwaitingMe] = useState(search.get('awaiting') === '1'); const [q, setQ] = useState(''); const [query, setQuery] = useState(''); const [page, setPage] = useState(1);
  const meta = useAsync(() => api<Meta>('/library/meta'), []);
  const { data, error, loading, reload } = useAsync(() => api<ListResp>('/library', {
    query: { projectId: projectId === 'org' ? undefined : projectId, orgWide: projectId === 'org' ? '1' : undefined, docType, expiry, status, awaitingMe: awaitingMe ? '1' : undefined, q: query, page },
  }), [projectId, docType, expiry, status, awaitingMe, query, page]);
  const reset = (f: () => void) => { f(); setPage(1); };
  return (
    <>
      <PageHead title="Document & evidence library" sub="Every HSE file in one place, with its revisions, approvals and the records it supports. Approved versions are never overwritten."
        actions={can('library.upload') ? <Link className="btn btn-primary" to={`/app/library/new${projectId && projectId !== 'org' ? `?projectId=${projectId}` : ''}`}><Icon name="upload" />Upload</Link> : undefined} />
      <section className="kpi-strip panel-eng" aria-label="Library status" style={{ marginBottom: 16 }}>
        <button className={`kpi kpi-btn ${data?.counts.expired ? 'alert' : ''}`} aria-pressed={expiry === 'expired'} onClick={() => reset(() => setExpiry(expiry === 'expired' ? '' : 'expired'))}><div className="value">{data?.counts.expired ?? '–'}</div><span className="label">Expired</span></button>
        <button className="kpi kpi-btn" aria-pressed={expiry === 'due_30'} onClick={() => reset(() => setExpiry(expiry === 'due_30' ? '' : 'due_30'))}><div className="value">{data?.counts.due ?? '–'}</div><span className="label">Expire within 30 days</span></button>
        <button className="kpi kpi-btn" aria-pressed={awaitingMe} onClick={() => reset(() => setAwaitingMe(!awaitingMe))} disabled={!meta.data?.canApprove} title={meta.data?.canApprove ? undefined : 'Only library approvers review files'}>
          <div className="value">{data?.counts.review ?? '–'}</div><span className="label">Under review</span><div className="sub">{meta.data?.canApprove ? (awaitingMe ? 'Showing the ones you can decide' : 'Select to see the ones you can decide') : 'Reviewed by library approvers'}</div>
        </button>
        <div className="kpi"><div className="value">{data?.total ?? '–'}</div><span className="label">Files in this view</span></div>
      </section>
      <div className="row filter-bar" style={{ marginBottom: 12 }}>
        <select className="select" aria-label="Project" value={projectId} onChange={(e) => reset(() => setProjectId(e.target.value))}>
          <option value="">All my projects</option><option value="org">Organisation-wide files</option>
          {me?.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
        </select>
        <select className="select" aria-label="Document type" value={docType} onChange={(e) => reset(() => setDocType(e.target.value))}><option value="">All types</option>{LIBRARY_DOC_TYPES.map((t) => <option key={t} value={t}>{LIBRARY_DOC_TYPE_LABELS[t]}</option>)}</select>
        <select className="select" aria-label="Expiry" value={expiry} onChange={(e) => reset(() => setExpiry(e.target.value))}><option value="">Any expiry</option><option value="expired">Expired</option><option value="due_30">Expires within 30 days</option></select>
        <select className="select" aria-label="Status" value={status} onChange={(e) => reset(() => setStatus(e.target.value))}><option value="active">Active files</option><option value="obsolete">Obsolete files</option><option value="all">All files</option></select>
        <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); reset(() => setQuery(q)); }}><input className="input" placeholder="Search title, number, tag, file name" aria-label="Search the library" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn" type="submit" aria-label="Search the library"><Icon name="search" /></button></form>
      </div>
      {error && <ErrorNotice error={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data && !data.items.length && <div className="panel"><Empty title="No files match" action={can('library.upload') ? <Link className="btn btn-primary" to="/app/library/new">Upload the first file</Link> : undefined}>Readers only see files with an approved version. Clear the filters or upload a file.</Empty></div>}
      {data && data.items.length > 0 && (
        <div className="panel">
          <div className="table-wrap hide-mobile"><table className="data">
            <thead><tr><th>Ref</th><th>Title</th><th>Type</th><th>Version</th><th>Expiry</th><th>Updated</th></tr></thead>
            <tbody>{data.items.map((f) => (
              <tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/app/library/${f.id}`)}>
                <td><Link to={`/app/library/${f.id}`}>{f.ref}</Link>{f.docNumber && <div className="small muted">{f.docNumber}</div>}</td>
                <td>{f.title} <ConfChip c={f.confidentiality} />{f.status === 'obsolete' && <span className="risk risk-critical">Obsolete</span>}<div className="small muted">{f.project ? f.project.code : 'Organisation-wide'}{f.site ? ` · ${f.site.name}` : ''}{f.latest ? ` · ${f.latest.filename}` : ''}</div></td>
                <td className="small">{f.docTypeLabel}</td>
                <td>{f.latest ? <><span className="small">v{f.latestVersion} </span><VersionChip s={f.latest.status} label={f.latest.statusLabel} /></> : <span className="small">v{f.latestVersion} approved</span>}</td>
                <td className="small"><ExpiryNote f={f} /></td>
                <td className="small muted">{fmtDate(f.updatedAt)}</td>
              </tr>))}</tbody>
          </table></div>
          <div className="card-list show-mobile">{data.items.map((f) => (
            <Link key={f.id} className="m-card" to={`/app/library/${f.id}`}>
              <div className="row" style={{ gap: 6 }}><strong>{f.ref}</strong><span className="spacer" />{f.latest && <VersionChip s={f.latest.status} label={f.latest.statusLabel} />}</div>
              <span>{f.title}</span>
              <div className="row small muted" style={{ gap: 6, flexWrap: 'wrap' }}><span>{f.docTypeLabel}</span><ConfChip c={f.confidentiality} />{f.expiry !== 'none' && <ExpiryNote f={f} />}</div>
            </Link>))}</div>
          <div className="panel-body"><Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></div>
        </div>)}
    </>
  );
}

/* ================================================================ metadata form */

interface MetaForm {
  title: string; docNumber: string; docType: LibraryDocType; category: string; tags: string; description: string; projectId: string; siteId: string;
  confidentiality: Confidentiality; retention: Retention; ownerId: string; issueDate: string; expiryDate: string;
}
const toPayload = (m: MetaForm) => ({
  title: m.title, docNumber: m.docNumber, docType: m.docType, category: m.category, description: m.description,
  tags: m.tags.split(',').map((t) => t.trim()).filter(Boolean), projectId: m.projectId && m.projectId !== 'org' ? m.projectId : null, siteId: m.siteId || null,
  confidentiality: m.confidentiality, retention: m.retention, ownerId: m.ownerId || null, issueDate: m.issueDate || null, expiryDate: m.expiryDate || null,
});

function MetaFields({ m, set, errs, canOrgWide }: { m: MetaForm; set: (p: Partial<MetaForm>) => void; errs: Record<string, string>; canOrgWide: boolean }) {
  const { me } = useAuth();
  const project = me?.projects.find((p) => p.id === m.projectId);
  const people = useAsync(() => api<{ items: { id: string; fullName: string; jobTitle: string }[] }>('/library/people', { query: { projectId: m.projectId && m.projectId !== 'org' ? m.projectId : undefined } }), [m.projectId]);
  const e = (k: string) => errs[`meta.${k}`] ?? errs[k];
  return (
    <div className="form-grid">
      <Field label="Title *" htmlFor="lf-title" error={e('title')}><input id="lf-title" className="input" value={m.title} onChange={(x) => set({ title: x.target.value })} required minLength={3} maxLength={200} /></Field>
      <Field label="Document number" htmlFor="lf-no" hint="Your own controlled number, if it has one" error={e('docNumber')}><input id="lf-no" className="input" value={m.docNumber} onChange={(x) => set({ docNumber: x.target.value })} maxLength={60} /></Field>
      <Field label="Document type *" htmlFor="lf-type"><select id="lf-type" className="select" value={m.docType} onChange={(x) => set({ docType: x.target.value as LibraryDocType })}>{LIBRARY_DOC_TYPES.map((t) => <option key={t} value={t}>{LIBRARY_DOC_TYPE_LABELS[t]}</option>)}</select></Field>
      <Field label="Category" htmlFor="lf-cat" hint="For example Lifting, Electrical, Waste" error={e('category')}><input id="lf-cat" className="input" value={m.category} onChange={(x) => set({ category: x.target.value })} maxLength={80} /></Field>
      <Field label="Project *" htmlFor="lf-proj" error={e('projectId')}>
        <select id="lf-proj" className="select" value={m.projectId} onChange={(x) => set({ projectId: x.target.value, siteId: '', ownerId: '' })}>
          {canOrgWide && <option value="org">Organisation-wide</option>}
          {me?.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
        </select>
      </Field>
      <Field label="Site" htmlFor="lf-site" error={e('siteId')}><select id="lf-site" className="select" value={m.siteId} disabled={!project} onChange={(x) => set({ siteId: x.target.value })}><option value="">Whole project</option>{project?.sites.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}</select></Field>
      <Field label="Confidentiality *" htmlFor="lf-conf" hint={CONFIDENTIALITY_LABELS[m.confidentiality].help}><select id="lf-conf" className="select" value={m.confidentiality} onChange={(x) => set({ confidentiality: x.target.value as Confidentiality })}>{CONFIDENTIALITY.map((c) => <option key={c} value={c}>{CONFIDENTIALITY_LABELS[c].label}</option>)}</select></Field>
      <Field label="Retention" htmlFor="lf-ret" hint="Files are never deleted automatically"><select id="lf-ret" className="select" value={m.retention} onChange={(x) => set({ retention: x.target.value as Retention })}>{RETENTION.map((r) => <option key={r} value={r}>{RETENTION_LABELS[r]}</option>)}</select></Field>
      <Field label="Owner" htmlFor="lf-owner" hint="Responsible person for this document"><select id="lf-owner" className="select" value={m.ownerId} onChange={(x) => set({ ownerId: x.target.value })}><option value="">Not set</option>{people.data?.items.map((u) => <option key={u.id} value={u.id}>{u.fullName}{u.jobTitle ? ` — ${u.jobTitle}` : ''}</option>)}</select></Field>
      <Field label="Tags" htmlFor="lf-tags" hint="Separate with commas" error={e('tags')}><input id="lf-tags" className="input" value={m.tags} onChange={(x) => set({ tags: x.target.value })} /></Field>
      <Field label="Issue date" htmlFor="lf-issue" error={e('issueDate')}><input id="lf-issue" type="date" className="input" value={m.issueDate} onChange={(x) => set({ issueDate: x.target.value })} /></Field>
      <Field label="Expiry date" htmlFor="lf-exp" hint="Certificates, licences, inspections" error={e('expiryDate')}><input id="lf-exp" type="date" className="input" value={m.expiryDate} onChange={(x) => set({ expiryDate: x.target.value })} /></Field>
      <div style={{ gridColumn: '1 / -1' }}><Field label="Description" htmlFor="lf-desc" error={e('description')}><textarea id="lf-desc" className="textarea" rows={3} value={m.description} onChange={(x) => set({ description: x.target.value })} maxLength={1000} /></Field></div>
    </div>
  );
}

/* ================================================================ upload */

export function LibraryUpload() {
  const { me } = useAuth();
  const { search } = useLocation();
  const toast = useToast();
  const meta = useAsync(() => api<Meta>('/library/meta'), []);
  const recordType = search.get('recordType') as LibraryRecordType | null; const recordId = search.get('recordId');
  const [file, setFile] = useState<File | null>(null);
  const [m, setM] = useState<MetaForm>({
    title: '', docNumber: '', docType: (search.get('docType') as LibraryDocType) || (recordType === 'observation' ? 'photo_evidence' : 'procedure'), category: '', tags: '', description: '',
    projectId: search.get('projectId') ?? me?.projects[0]?.id ?? 'org', siteId: search.get('siteId') ?? '', confidentiality: 'internal', retention: 'project', ownerId: '', issueDate: '', expiryDate: '',
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'' | 'uploading' | 'saving'>('');
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (file && !m.title) setM((x) => ({ ...x, title: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 200) })); }, [file]);
  if (meta.loading) return <Loading />;
  if (meta.error) return <ErrorNotice error={meta.error} />;
  const max = meta.data!.maxUploadMb;
  const submit = async () => {
    if (!file) { setErrs({ file: 'Choose a file to upload' }); return; }
    if (file.size > max * 1024 * 1024) { setErrs({ file: `The file is larger than ${max} MB` }); return; }
    setErr(null); setErrs({});
    try {
      setBusy('uploading');
      const u = await stageUpload(file);
      setBusy('saving');
      const created = await api<FileDetail>('/library', { method: 'POST', body: { uploadId: u.uploadId, meta: toPayload(m), link: recordType && recordId ? { recordType, recordId } : undefined } });
      toast(`${created.ref} uploaded as a draft`, 'ok');
      navigate(search.get('return') ?? `/app/library/${created.id}`);
    } catch (e) { setErr(e); setErrs(fieldErrors(e)); } finally { setBusy(''); }
  };
  return (
    <>
      <PageHead title="Upload to the library" sub={recordType ? `The file will be linked to this ${RECORD_LABEL[recordType].toLowerCase()}.` : 'The file starts as a draft. Submit it for review when it is ready; an approver who did not upload it decides.'} />
      <div className="panel" style={{ maxWidth: 960 }}>
        <div className="panel-body stack">
          <DropZone id="lf-file" file={file} onFile={setFile} maxMb={max} />
          {errs.file && <div className="field-error" role="alert">{errs.file}</div>}
          <MetaFields m={m} set={(p) => setM({ ...m, ...p })} errs={errs} canOrgWide={meta.data!.canCreateOrgWide} />
          {err instanceof ApiError && !Object.keys(fieldErrors(err)).length && <ErrorNotice error={err} />}
          {!meta.data!.malwareScanning && <p className="small muted">Files are checked for type and integrity (SHA-256). Virus scanning is not available on this server yet.</p>}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary" onClick={submit} disabled={!!busy}>{busy === 'uploading' ? 'Uploading…' : busy === 'saving' ? 'Saving…' : 'Upload as draft'}</button>
            <button className="btn btn-ghost" onClick={() => history.back()} disabled={!!busy}>Cancel</button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ================================================================ detail */

function Preview({ v }: { v: Version }) {
  const src = `/api/library/versions/${v.id}/content`;
  if (!v.previewable) return <p className="small muted">No preview for this file type. Download it to open it.</p>;
  if (v.contentType.startsWith('image/')) return <img className="lib-preview" src={src} alt={`Preview of ${v.filename}`} />;
  if (v.contentType.startsWith('video/')) return <video className="lib-preview" src={src} controls preload="metadata" />;
  if (v.contentType.startsWith('audio/')) return <audio src={src} controls preload="metadata" />;
  if (v.contentType === 'application/pdf') return <iframe className="lib-preview lib-pdf" src={src} title={`Preview of ${v.filename}`} />;
  return <p className="small muted">Download the file to open it.</p>;
}

export function LibraryFile({ id }: { id: string }) {
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api<FileDetail>(`/library/${id}`), [id]);
  const meta = useAsync(() => api<Meta>('/library/meta'), []);
  const [dlg, setDlg] = useState<null | 'approve' | 'reject' | 'version' | 'obsolete' | 'edit'>(null);
  const [note, setNote] = useState(''); const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [form, setForm] = useState<MetaForm | null>(null); const [errs, setErrs] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNotice error={error} retry={reload} />;
  const f = data!;
  const latest = f.versions[0];
  const shown = f.versions.find((v) => v.id === selected) ?? f.versions.find((v) => v.id === f.currentVersionId) ?? latest;
  const close = () => { setDlg(null); setNote(''); setFile(null); setErr(null); setErrs({}); };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setErr(null);
    try { await fn(); toast(ok, 'ok'); close(); reload(); } catch (e) { setErr(e); setErrs(fieldErrors(e)); } finally { setBusy(false); }
  };
  const transition = (action: string, msg: string) => run(() => api(`/library/${f.id}/versions/${latest!.id}/transition`, { method: 'POST', body: { action, note, version: f.version } }), msg);
  const share = async (v: Version) => {
    try {
      const r = await api<{ path: string; expiresAt: string }>(`/library/versions/${v.id}/share-link`, { method: 'POST' });
      const url = location.origin + r.path;
      await navigator.clipboard?.writeText(url).catch(() => {});
      toast(`Download link copied. It works until ${fmtDateTime(r.expiresAt)}.`, 'ok');
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not create the link', 'error'); }
  };
  const editForm = (): MetaForm => ({ title: f.title, docNumber: f.docNumber, docType: f.docType, category: f.category, tags: f.tags.join(', '), description: f.description, projectId: f.project?.id ?? 'org',
    siteId: f.site?.id ?? '', confidentiality: f.confidentiality, retention: f.retention, ownerId: f.owner?.id ?? '', issueDate: f.issueDate ?? '', expiryDate: f.expiryDate ?? '' });
  const p = f.permissions;
  return (
    <>
      <PageHead title={f.title} sub={<>{f.ref}{f.docNumber ? ` · ${f.docNumber}` : ''} · {f.docTypeLabel} · {f.project ? f.project.code : 'Organisation-wide'}{f.site ? ` · ${f.site.name}` : ''}</>}
        actions={<>
          {p.edit && <button className="btn" onClick={() => { setForm(editForm()); setDlg('edit'); }}><Icon name="edit" />Edit details</button>}
          {p.newVersion && <button className="btn" onClick={() => setDlg('version')}><Icon name="upload" />New version</button>}
          {p.submit && <button className="btn btn-primary" disabled={busy} onClick={() => transition('submit', 'Submitted for review')}>Submit for review</button>}
          {p.withdraw && <button className="btn" disabled={busy} onClick={() => transition('withdraw', 'Withdrawn from review')}>Withdraw</button>}
          {p.decide && <><button className="btn btn-primary" onClick={() => setDlg('approve')}>Approve v{latest!.versionNo}</button><button className="btn btn-danger" onClick={() => setDlg('reject')}>Reject</button></>}
        </>} />
      {f.status === 'obsolete' && <div className="notice error" role="status">Obsolete: {f.obsoleteReason}. Kept for the record; it cannot be changed or shared.</div>}
      {f.expiry === 'expired' && <div className="notice error" role="status">This document expired on {fmtDate(f.expiryDate)}.</div>}
      {f.expiry === 'due_30' && <div className="notice warn" role="status">This document expires on {fmtDate(f.expiryDate)}.</div>}
      <div className="detail-grid">
        <div className="stack">
          <section className="panel">
            <div className="panel-head"><h3>{shown ? `Version ${shown.versionNo}` : 'No version you can see'}</h3>{shown && <VersionChip s={shown.status} label={shown.statusLabel} />}<span className="spacer" />
              {shown && <><a className="btn btn-sm" href={`/api/library/versions/${shown.id}/content?download=1`}><Icon name="download" />Download</a>
                {f.status === 'active' && <button className="btn btn-sm" onClick={() => share(shown)}><Icon name="copy" />Copy 10-minute link</button>}</>}
            </div>
            <div className="panel-body">{shown ? <><Preview v={shown} /><p className="small muted" style={{ marginTop: 8 }}>{shown.filename} · {formatBytes(shown.sizeBytes)} · SHA-256 <code title={shown.sha256}>{shown.sha256.slice(0, 16)}…</code></p></> : <p className="muted">Nothing to show yet.</p>}</div>
          </section>
          <section className="panel">
            <div className="panel-head"><h3>Revision history</h3></div>
            <div className="table-wrap"><table className="data">
              <thead><tr><th>Version</th><th>File</th><th>Status</th><th>Uploaded</th><th>Decision</th></tr></thead>
              <tbody>{f.versions.map((v) => (
                <tr key={v.id} aria-selected={shown?.id === v.id}>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => setSelected(v.id)} aria-label={`Show version ${v.versionNo}`}>v{v.versionNo}</button></td>
                  <td className="small">{v.filename}<div className="muted">{v.changeNote}</div></td>
                  <td><VersionChip s={v.status} label={v.statusLabel} /></td>
                  <td className="small">{v.uploadedBy.name}<div className="muted">{fmtDateTime(v.uploadedAt)}</div></td>
                  <td className="small">{v.decidedBy ? <>{v.decidedBy.name}<div className="muted">{fmtDateTime(v.decidedAt)}{v.decisionNote ? ` — ${v.decisionNote}` : ''}</div></> : '—'}</td>
                </tr>))}</tbody>
            </table></div>
          </section>
        </div>
        <aside className="stack">
          <section className="panel"><div className="panel-head"><h3>Details</h3></div>
            <dl className="kv panel-body small">
              <dt>Confidentiality</dt><dd>{CONFIDENTIALITY_LABELS[f.confidentiality].label}<div className="muted">{CONFIDENTIALITY_LABELS[f.confidentiality].help}</div></dd>
              <dt>Owner</dt><dd>{f.owner?.name ?? 'Not set'}</dd>
              <dt>Category</dt><dd>{f.category || '—'}</dd>
              <dt>Issue date</dt><dd>{f.issueDate ? fmtDate(f.issueDate) : '—'}</dd>
              <dt>Expiry</dt><dd><ExpiryNote f={f} /></dd>
              <dt>Retention</dt><dd>{RETENTION_LABELS[f.retention]}</dd>
              <dt>Tags</dt><dd>{f.tags.length ? f.tags.join(', ') : '—'}</dd>
              <dt>Added by</dt><dd>{f.createdBy.name}<div className="muted">{fmtDateTime(f.createdAt)}</div></dd>
            </dl>
            {f.description && <p className="panel-body small" style={{ paddingTop: 0 }}>{f.description}</p>}
          </section>
          <section className="panel"><div className="panel-head"><h3>Linked records</h3></div>
            <div className="panel-body stack" style={{ gap: 6 }}>
              {!f.links.length && <p className="small muted">Not linked to any record. Attach files from an observation, hazard or HSE document.</p>}
              {f.links.map((l) => (
                <div key={l.id} className="row small" style={{ gap: 6 }}>
                  <span className="muted">{RECORD_LABEL[l.recordType]}</span><Link to={RECORD_PATH[l.recordType] + l.recordId}>{l.ref ?? 'Record'}</Link><span className="truncate">{l.label}</span><span className="spacer" />
                  {p.link && <button className="btn btn-ghost btn-sm" aria-label={`Remove link to ${l.ref}`} onClick={() => run(() => api(`/library/${f.id}/links/${l.id}`, { method: 'DELETE' }), 'Link removed')}><Icon name="x" /></button>}
                </div>))}
            </div>
          </section>
          {p.obsolete && <button className="btn btn-ghost" onClick={() => setDlg('obsolete')}>Mark as obsolete</button>}
        </aside>
      </div>

      {(dlg === 'approve' || dlg === 'reject') && (
        <Dialog title={dlg === 'approve' ? `Approve version ${latest!.versionNo}` : `Reject version ${latest!.versionNo}`} onClose={close}
          footer={<><button className="btn" onClick={close}>Cancel</button><button className={`btn ${dlg === 'approve' ? 'btn-primary' : 'btn-danger'}`} disabled={busy || (dlg === 'reject' && !note.trim())} onClick={() => transition(dlg, dlg === 'approve' ? 'Version approved' : 'Version rejected')}>{dlg === 'approve' ? 'Approve' : 'Reject'}</button></>}>
          {dlg === 'approve' && f.currentVersionId && <p className="small">Version {f.versions.find((v) => v.id === f.currentVersionId)?.versionNo} will be marked superseded.</p>}
          <Field label={dlg === 'reject' ? 'Reason *' : 'Note'} htmlFor="lf-note"><textarea id="lf-note" className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
          {err != null && <ErrorNotice error={err} />}
        </Dialog>)}
      {dlg === 'version' && (
        <Dialog title="Upload a new version" onClose={close}
          footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn btn-primary" disabled={busy || !file || note.trim().length < 3}
            onClick={() => run(async () => { const u = await stageUpload(file!); await api(`/library/${f.id}/versions`, { method: 'POST', body: { uploadId: u.uploadId, version: f.version, changeNote: note } }); }, 'New version uploaded as a draft')}>{busy ? 'Uploading…' : 'Upload'}</button></>}>
          <p className="small">Version {f.latestVersion + 1} starts as a draft. The approved version stays in force until the new one is approved.</p>
          <DropZone id="lf-vfile" file={file} onFile={setFile} maxMb={meta.data?.maxUploadMb ?? 25} />
          <Field label="What changed *" htmlFor="lf-change" error={errs.changeNote}><textarea id="lf-change" className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
          {err != null && <ErrorNotice error={err} />}
        </Dialog>)}
      {dlg === 'obsolete' && (
        <Dialog title="Mark as obsolete" onClose={close}
          footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn btn-danger" disabled={busy || note.trim().length < 3} onClick={() => run(() => api(`/library/${f.id}/obsolete`, { method: 'POST', body: { version: f.version, note } }), 'Marked obsolete')}>Mark obsolete</button></>}>
          <p className="small">The file and all its versions are kept for the record. It can no longer be changed, linked or shared.</p>
          <Field label="Reason *" htmlFor="lf-obs"><textarea id="lf-obs" className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
          {err != null && <ErrorNotice error={err} />}
        </Dialog>)}
      {dlg === 'edit' && form && (
        <Dialog title="Edit details" onClose={close}
          footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => run(() => api(`/library/${f.id}`, { method: 'PATCH', body: { version: f.version, meta: toPayload(form) } }), 'Details saved')}>Save</button></>}>
          <MetaFields m={form} set={(x) => setForm({ ...form, ...x })} errs={errs} canOrgWide={meta.data?.canCreateOrgWide ?? false} />
          {err != null && <ErrorNotice error={err} />}
        </Dialog>)}
    </>
  );
}

/* ================================================================ record panel */

/** Files linked to an HSE record, with an "Attach file" action. Embed on record pages. */
export function RecordFiles({ recordType, recordId, projectId, siteId, canAttach = true }: { recordType: LibraryRecordType; recordId: string; projectId: string | null; siteId?: string | null; canAttach?: boolean }) {
  const { can } = useAuth();
  const { path } = useLocation();
  const { data, error, loading } = useAsync(() => can('library.view') ? api<ListResp>('/library', { query: { recordType, recordId, status: 'all' } }) : Promise.resolve(null), [recordType, recordId]);
  if (!can('library.view')) return null;
  const attach = `/app/library/new?recordType=${recordType}&recordId=${recordId}${projectId ? `&projectId=${projectId}` : ''}${siteId ? `&siteId=${siteId}` : ''}&return=${encodeURIComponent(path)}`;
  return (
    <section className="panel" aria-label="Linked files">
      <div className="panel-head"><h3>Files & evidence</h3><span className="spacer" />{canAttach && can('library.upload') && <Link className="btn btn-sm" to={attach}><Icon name="clip" />Attach file</Link>}</div>
      <div className="panel-body stack" style={{ gap: 6 }}>
        {loading && <Loading />}{error && <ErrorNotice error={error} />}
        {data && !data.items.length && <p className="small muted">No files linked yet.</p>}
        {data?.items.map((f) => (
          <Link key={f.id} to={`/app/library/${f.id}`} className="row small lib-row" style={{ gap: 8 }}>
            <Icon name={f.latest?.contentType.startsWith('image/') ? 'image' : 'doc'} size={16} /><span className="truncate">{f.title}</span><span className="spacer" />
            {f.latest ? <VersionChip s={f.latest.status} label={f.latest.statusLabel} /> : <span className="muted">v{f.latestVersion}</span>}
          </Link>))}
      </div>
    </section>
  );
}
