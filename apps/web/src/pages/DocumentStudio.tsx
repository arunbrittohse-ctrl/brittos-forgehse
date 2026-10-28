/**
 * HSE Document Studio — register, conditional input form, editable preview, review workflow,
 * revision history and DOCX/PDF export. All data is read from and saved to the API; nothing here
 * is sample content.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DOC_TYPES, docType, visibleFields, missingRequired, rateOnMatrix, describeMatrix, asList, DOCUMENT_STUDIO_STATUSES, DOCUMENT_STATUS_LABELS,
  type DocTypeKey, type DocInputs, type DocContent, type DocRiskRow, type DocSection, type FieldDef, type RiskMatrixConfig, type DocReference, type DocContact,
  type ReadinessIssue, type DocumentStudioStatus, type DocGenerator,
} from '@forgehse/shared';
import { api, ApiError, fieldErrors } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Link, navigate, useLocation } from '../lib/router';
import { fmtDate, fmtDateTime } from '../lib/format';
import { PageHead } from '../components/AppShell';
import { Dialog, Empty, ErrorNotice, Icon, Loading, Pagination, useToast } from '../components/ui';
import { saveBlob } from '../components/studio-preview';

interface DocView {
  id: string; docNumber: string; docType: DocTypeKey; typeLabel: string; title: string; revision: number; revisionLabel: string;
  status: DocumentStudioStatus; statusLabel: string; inputs: DocInputs; content: DocContent; matrix: RiskMatrixConfig; generator: DocGenerator;
  project: { id: string; code: string; name: string } | null; site: { id: string; name: string } | null;
  createdBy: { id: string; name: string }; updatedBy: { id: string; name: string };
  submittedBy: { name: string } | null; submittedAt: string | null; approvedBy: { name: string } | null; approvedAt: string | null;
  decisionNote: string | null; withdrawnReason: string | null; version: number; createdAt: string; updatedAt: string;
  readiness: { ready: boolean; issues: ReadinessIssue[]; warnings: ReadinessIssue[]; placeholders: number; modelSuggestions: number };
  permissions: { edit: boolean; submit: boolean; approve: boolean; newRevision: boolean; withdraw: boolean; export: boolean };
}
interface Meta { matrix: RiskMatrixConfig; model: { available: boolean; label: string; model: string | null; reason: string } }
interface Revision { id: number; event: string; revisionLabel: string; status: string; title: string; note: string; actor: string; at: string }

const FAMILY_ICON: Record<string, string> = { activity: 'checklist', plan: 'folder', policy: 'shield', record: 'review', learning: 'helmet' };

export function DocStatus({ status, label }: { status: DocumentStudioStatus; label?: string }) {
  const cls = status === 'approved' ? 'risk-low' : status === 'in_review' ? 'risk-medium' : status === 'withdrawn' ? 'risk-critical' : 'risk-high';
  return <span className={`risk ${cls}`} style={{ whiteSpace: 'nowrap' }}>{label ?? DOCUMENT_STATUS_LABELS[status]}</span>;
}

async function download(id: string, format: 'docx' | 'pdf', name: string, revisionId?: number) {
  const res = await fetch(`/api/documents/${id}/export?format=${format}${revisionId ? `&revisionId=${revisionId}` : ''}`, { headers: { 'X-Requested-With': 'forgehse' }, credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(res.status, 'export_failed', 'Export failed');
  const disp = res.headers.get('content-disposition') ?? '';
  saveBlob(await res.blob(), /filename="([^"]+)"/.exec(disp)?.[1] ?? `${name}.${format}`);
}

/* =================================================================== register */

export function DocumentRegister() {
  const { can } = useAuth();
  const [type, setType] = useState<DocTypeKey | ''>('');
  const [status, setStatus] = useState<DocumentStudioStatus | ''>('');
  const [q, setQ] = useState(''); const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAsync(() => api<{ items: { id: string; docNumber: string; typeLabel: string; title: string; revisionLabel: string; status: DocumentStudioStatus; statusLabel: string; project: { code: string } | null; updatedAt: string; updatedBy: string; ready: boolean; generatorMode: string }[]; total: number; page: number; pageSize: number }>('/documents', { query: { type, status, q: query, page } }), [type, status, query, page]);
  return (
    <>
      <PageHead title="HSE Document Studio" sub="Controlled RA, JSA, method statements, plans, policies, checklists, toolbox talks, training, audit, investigation and close-out documents. Generated drafts are never approved until a qualified person approves them."
        actions={can('document.create') ? <Link className="btn btn-primary" to="/app/documents/new"><Icon name="plus" />New document</Link> : undefined} />
      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <select className="select" style={{ width: 'auto' }} aria-label="Document type" value={type} onChange={(e) => { setType(e.target.value as DocTypeKey); setPage(1); }}>
          <option value="">All types</option>{DOC_TYPES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value as DocumentStudioStatus); setPage(1); }}>
          <option value="">Any status</option>{DOCUMENT_STUDIO_STATUSES.map((s) => <option key={s} value={s}>{DOCUMENT_STATUS_LABELS[s]}</option>)}
        </select>
        <span className="spacer" />
        <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); setQuery(q); setPage(1); }}>
          <input className="input" style={{ width: 240 }} placeholder="Search title or number" aria-label="Search documents" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" type="submit"><Icon name="search" />Search</button>
        </form>
      </div>
      {error && <ErrorNotice error={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data && !data.items.length && <div className="panel"><Empty title="No documents yet" action={can('document.create') ? <Link className="btn btn-primary" to="/app/documents/new">Create the first document</Link> : undefined}>Documents you can access appear here. Viewers only see approved documents.</Empty></div>}
      {data && data.items.length > 0 && (
        <div className="panel"><div className="table-wrap"><table className="data">
          <thead><tr><th>Number</th><th>Title</th><th>Type</th><th>Rev</th><th>Status</th><th>Project</th><th>Updated</th></tr></thead>
          <tbody>{data.items.map((d) => (
            <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/app/documents/${d.id}`)}>
              <td><Link to={`/app/documents/${d.id}`}>{d.docNumber}</Link></td><td>{d.title}</td><td className="small">{d.typeLabel}</td><td>{d.revisionLabel}</td>
              <td><DocStatus status={d.status} label={d.statusLabel} /></td><td>{d.project?.code ?? 'Organisation'}</td><td className="small muted">{fmtDate(d.updatedAt)} · {d.updatedBy}</td>
            </tr>))}</tbody>
        </table></div><div className="panel-body"><Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></div></div>
      )}
    </>
  );
}

/* =================================================================== input form */

function FieldInput({ f, value, onChange, error }: { f: FieldDef; value: DocInputs[string]; onChange: (v: DocInputs[string]) => void; error?: string }) {
  const id = `f-${f.key}`;
  let control: ReactNode;
  if (f.type === 'textarea') control = <textarea id={id} className="textarea" rows={3} maxLength={f.max} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
  else if (f.type === 'lines') control = <textarea id={id} className="textarea" rows={4} value={asList(value).join('\n')} onChange={(e) => onChange(e.target.value.split('\n'))} placeholder="One item per line" />;
  else if (f.type === 'select') control = <select id={id} className="select" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}><option value="">Select…</option>{f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  else if (f.type === 'multiselect') {
    const sel = asList(value);
    control = <div className="row" style={{ flexWrap: 'wrap', gap: 6 }} role="group" aria-labelledby={`${id}-l`}>{f.options!.map((o) => (
      <button type="button" key={o.value} className="chip-btn" aria-pressed={sel.includes(o.value)} onClick={() => onChange(sel.includes(o.value) ? sel.filter((x) => x !== o.value) : [...sel, o.value])}>{o.label}</button>))}</div>;
  } else if (f.type === 'references' || f.type === 'contacts') {
    const isRef = f.type === 'references';
    const cols = isRef ? ['source', 'reference', 'requirement'] as const : ['role', 'name', 'phone'] as const;
    const rows = (Array.isArray(value) ? value : []) as unknown as Record<string, string>[];
    const set = (i: number, k: string, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) as unknown as DocReference[]);
    control = (
      <div className="stack" style={{ gap: 6 }}>
        {rows.map((r, i) => (
          <div key={i} className="row" style={{ gap: 6 }}>
            {cols.map((k) => <input key={k} className="input" aria-label={`${f.label} ${i + 1} ${k}`} placeholder={k[0]!.toUpperCase() + k.slice(1)} value={r[k] ?? ''} onChange={(e) => set(i, k, e.target.value)} />)}
            <button type="button" className="icon-btn" aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i) as unknown as DocReference[])}><Icon name="x" /></button>
          </div>))}
        <div><button type="button" className="btn btn-sm" onClick={() => onChange([...rows, Object.fromEntries(cols.map((k) => [k, '']))] as unknown as DocReference[])}><Icon name="plus" />Add {isRef ? 'reference' : 'contact'}</button></div>
      </div>);
  } else control = <input id={id} className="input" type={f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'} maxLength={f.max} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
  return (
    <div className="field">
      <label id={`${id}-l`} htmlFor={id}>{f.label}</label>
      {control}
      {f.help && <span className="small muted">{f.help}</span>}
      {error && <span className="small" style={{ color: 'var(--danger, #b91c1c)' }} role="alert">{error}</span>}
    </div>
  );
}

function InputsForm({ type, inputs, setInputs, errors }: { type: DocTypeKey; inputs: DocInputs; setInputs: (i: DocInputs) => void; errors: Record<string, string> }) {
  const fields = visibleFields(type, inputs);
  const req = new Set([...missingRequired(type, {}, 'submit'), ...missingRequired(type, {}, 'generate')].map((f) => f.key));
  const groups = [...new Set(fields.map((f) => f.group))];
  return (
    <div className="stack">
      {groups.map((g) => (
        <section key={g} className="panel"><div className="panel-head"><h3>{g}</h3></div><div className="panel-body grid-2">
          {fields.filter((f) => f.group === g).map((f) => (
            <div key={f.key} style={f.type === 'textarea' || f.type === 'lines' || f.type === 'multiselect' || f.type === 'references' || f.type === 'contacts' ? { gridColumn: '1 / -1' } : undefined}>
              <FieldInput f={{ ...f, label: req.has(f.key) ? `${f.label} *` : f.label }} value={inputs[f.key]} error={errors[`inputs.${f.key}`]} onChange={(v) => setInputs({ ...inputs, [f.key]: v })} />
            </div>))}
        </div></section>))}
    </div>
  );
}

export function DocumentNew() {
  const { me } = useAuth();
  const toast = useToast();
  const { search } = useLocation();
  const [type, setType] = useState<DocTypeKey | null>((search.get('type') as DocTypeKey) || null);
  const [inputs, setInputs] = useState<DocInputs>({ country: 'United Arab Emirates' });
  const [projectId, setProjectId] = useState(me?.projects[0]?.id ?? '');
  const [siteId, setSiteId] = useState('');
  const [useModel, setUseModel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const meta = useAsync(() => api<Meta>('/documents/meta'), []);
  const project = me?.projects.find((p) => p.id === projectId);
  useEffect(() => { if (project && !inputs.projectName) setInputs((i) => ({ ...i, projectName: project.name })); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!type) return (
    <>
      <PageHead title="New HSE document" sub="Choose the document type. The form then asks only the questions that apply." actions={<Link className="btn" to="/app/documents">Register</Link>} />
      <div className="kind-grid">{DOC_TYPES.map((d) => (
        <button key={d.key} className="kind-card" onClick={() => setType(d.key)} style={{ textAlign: 'left' }}>
          <span className="row" style={{ gap: 8 }}><Icon name={FAMILY_ICON[d.family] ?? 'doc'} /><strong>{d.label}</strong></span>
          <span className="small muted">{d.description}</span>
        </button>))}</div>
    </>
  );

  const t = docType(type);
  const missing = missingRequired(type, inputs, 'generate');
  const policy = t.family === 'policy';
  async function submit() {
    setBusy(true); setErrors({});
    try {
      const d = await api<DocView>('/documents', { body: { docType: type, projectId: projectId || null, siteId: siteId || null, inputs, useModel } });
      toast('Draft generated — review every section before submitting', 'ok');
      navigate(`/app/documents/${d.id}`);
    } catch (e) { setErrors(fieldErrors(e)); toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHead title={`New ${t.label}`} sub={t.description} actions={<button className="btn" onClick={() => setType(null)}>Change type</button>} />
      <div className="notice" style={{ marginBottom: 16 }}><strong>How this works:</strong> the draft is built from your answers and the FORGEHSE template library (no AI model unless you tick the option). Risk ratings are left for the assessor, nothing is invented about laws, approvals or emergency numbers, and the document stays a draft until an authorised person approves it. Fields marked * are needed to submit for review.</div>
      <section className="panel" style={{ marginBottom: 16 }}><div className="panel-body grid-2">
        <div className="field"><label htmlFor="proj">Project{policy ? ' (optional for policies)' : ' *'}</label>
          <select id="proj" className="select" value={projectId} onChange={(e) => { setProjectId(e.target.value); setSiteId(''); }}>
            {policy && <option value="">Organisation-wide</option>}
            {me?.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </select></div>
        <div className="field"><label htmlFor="site">Site</label>
          <select id="site" className="select" value={siteId} onChange={(e) => setSiteId(e.target.value)} disabled={!project}>
            <option value="">Whole project</option>{project?.sites.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
          </select></div>
      </div></section>
      <InputsForm type={type} inputs={inputs} setInputs={setInputs} errors={errors} />
      <section className="panel" style={{ marginTop: 16 }}><div className="panel-body stack">
        <label className="row" style={{ gap: 8, opacity: meta.data?.model.available ? 1 : 0.6 }}>
          <input type="checkbox" checked={useModel} disabled={!meta.data?.model.available} onChange={(e) => setUseModel(e.target.checked)} />
          <span>Add suggestions from a language model{meta.data?.model.available ? ` (${meta.data.model.label})` : ''}</span>
        </label>
        {meta.data && !meta.data.model.available && <span className="small muted">{meta.data.model.reason}</span>}
        {missing.length > 0 && <span className="small" role="status">Still needed to generate: {missing.map((f) => f.label).join(', ')}</span>}
        <div className="row"><button className="btn btn-primary btn-lg" disabled={busy || missing.length > 0 || (!policy && !projectId)} onClick={submit}><Icon name="spark" />{busy ? 'Generating…' : 'Generate draft'}</button></div>
      </div></section>
    </>
  );
}

/* =================================================================== editor */

const lines = (s: string) => s.split('\n').map((x) => x.trimEnd()).filter((x, i, a) => x || i < a.length - 1);

function OriginTag({ origin }: { origin: string }) {
  if (origin === 'model') return <span className="risk risk-high" title="Suggested by a language model — check, edit and accept it, or delete it">Model suggestion — not verified</span>;
  if (origin === 'template') return <span className="badge" title="From the deterministic template library">Template text</span>;
  return <span className="badge" title="Written or edited by a person">Author</span>;
}

function SectionEditor({ s, onChange, onDelete, editable }: { s: DocSection; onChange: (s: DocSection) => void; onDelete: () => void; editable: boolean }) {
  const set = (p: Partial<DocSection>) => onChange({ ...s, ...p, origin: 'author' });
  return (
    <section className="panel doc-section" style={{ marginBottom: 12 }}>
      <div className="panel-head row" style={{ gap: 8 }}>
        {editable ? <input className="input" aria-label="Section heading" value={s.heading} onChange={(e) => set({ heading: e.target.value })} style={{ fontWeight: 700 }} /> : <h3>{s.heading}</h3>}
        <OriginTag origin={s.origin} />
        {editable && s.origin === 'model' && <button className="btn btn-sm" onClick={() => set({})}><Icon name="check" />Accept</button>}
        {editable && <button className="icon-btn" aria-label={`Delete section ${s.heading}`} onClick={onDelete}><Icon name="trash" /></button>}
      </div>
      <div className="panel-body stack" style={{ gap: 8 }}>
        {editable ? <textarea className="textarea" aria-label={`${s.heading} text`} rows={Math.min(8, Math.max(2, s.text.split('\n').length + 1))} value={s.text} onChange={(e) => set({ text: e.target.value })} placeholder="Paragraphs (blank line between paragraphs)" />
          : s.text && s.text.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
        {editable ? <textarea className="textarea" aria-label={`${s.heading} bullet points`} rows={Math.min(10, Math.max(2, s.bullets.length + 1))} value={s.bullets.join('\n')} onChange={(e) => set({ bullets: lines(e.target.value) })} placeholder="Bullet points, one per line" />
          : s.bullets.length > 0 && <ul>{s.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
        {s.table && (
          <div className="table-wrap"><table className="data">
            <thead><tr>{s.table.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
            <tbody>{s.table.rows.map((r, ri) => <tr key={ri}>{s.table!.columns.map((_, ci) => (
              <td key={ci}>{editable ? <textarea className="textarea" aria-label={`${s.heading} row ${ri + 1} ${s.table!.columns[ci]}`} rows={1} value={r[ci] ?? ''} onChange={(e) => set({ table: { ...s.table!, rows: s.table!.rows.map((x, j) => (j === ri ? s.table!.columns.map((_, k) => (k === ci ? e.target.value : x[k] ?? '')) : x)) } })} /> : r[ci]}</td>))}</tr>)}</tbody>
          </table>
          {editable && <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => set({ table: { ...s.table!, rows: [...s.table!.rows, s.table!.columns.map(() => '')] } })}><Icon name="plus" />Add row</button>}</div>)}
      </div>
    </section>
  );
}

function RatingPick({ label, value, size, onChange, disabled }: { label: string; value: number | null; size: number; onChange: (n: number | null) => void; disabled: boolean }) {
  return <select className="select" aria-label={label} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} style={{ width: 64 }}>
    <option value="">–</option>{Array.from({ length: size }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
  </select>;
}

function RiskScore({ l, s, m }: { l: number | null; s: number | null; m: RiskMatrixConfig }) {
  const r = rateOnMatrix(l, s, m);
  return r ? <span className={`risk risk-${r.band}`}>{r.score} {r.band.toUpperCase()}</span> : <span className="small muted">Not rated</span>;
}

function RiskRegister({ rows, setRows, matrix, editable }: { rows: DocRiskRow[]; setRows: (r: DocRiskRow[]) => void; matrix: RiskMatrixConfig; editable: boolean }) {
  const upd = (i: number, p: Partial<DocRiskRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p, origin: 'author' } : r)));
  const ta = (i: number, k: 'step' | 'hazard' | 'consequence' | 'exposed' | 'controlOwner' | 'verification', label: string) =>
    <div className="field"><label className="small">{label}</label><textarea className="textarea" rows={2} aria-label={`Row ${i + 1} ${label}`} disabled={!editable} value={rows[i]![k]} onChange={(e) => upd(i, { [k]: e.target.value })} /></div>;
  const list = (i: number, k: 'existingControls' | 'additionalControls', label: string) =>
    <div className="field"><label className="small">{label} (one per line)</label><textarea className="textarea" rows={3} aria-label={`Row ${i + 1} ${label}`} disabled={!editable} value={rows[i]![k].join('\n')} onChange={(e) => upd(i, { [k]: lines(e.target.value) })} /></div>;
  return (
    <section className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-head"><h3>Risk register</h3><span className="small muted">Ratings 1–{matrix.size} on the matrix stored with this document. Residual risk can be lower only with additional controls and a verification method.</span></div>
      <div className="panel-body stack">
        {rows.map((r, i) => (
          <div key={r.id} className="paper" style={{ padding: 12, border: '1px solid var(--line, #d6dce8)', borderRadius: 8 }}>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}><strong>Row {i + 1}</strong><OriginTag origin={r.origin} />
              {editable && r.origin === 'model' && <button className="btn btn-sm" onClick={() => upd(i, {})}><Icon name="check" />Accept</button>}
              <span className="spacer" />{editable && <button className="icon-btn" aria-label={`Delete row ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="trash" /></button>}</div>
            <div className="grid-3">{ta(i, 'step', 'Task step')}{ta(i, 'hazard', 'Hazard')}{ta(i, 'consequence', 'Potential consequence')}</div>
            <div className="grid-2">{ta(i, 'exposed', 'People / assets exposed')}{list(i, 'existingControls', 'Existing controls')}</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '6px 0' }}>
              <span className="small">Initial L</span><RatingPick label={`Row ${i + 1} initial likelihood`} value={r.initialLikelihood} size={matrix.size} disabled={!editable} onChange={(n) => upd(i, { initialLikelihood: n })} />
              <span className="small">S</span><RatingPick label={`Row ${i + 1} initial severity`} value={r.initialSeverity} size={matrix.size} disabled={!editable} onChange={(n) => upd(i, { initialSeverity: n })} />
              <RiskScore l={r.initialLikelihood} s={r.initialSeverity} m={matrix} />
              <span className="spacer" />
              <span className="small">Residual L</span><RatingPick label={`Row ${i + 1} residual likelihood`} value={r.residualLikelihood} size={matrix.size} disabled={!editable} onChange={(n) => upd(i, { residualLikelihood: n })} />
              <span className="small">S</span><RatingPick label={`Row ${i + 1} residual severity`} value={r.residualSeverity} size={matrix.size} disabled={!editable} onChange={(n) => upd(i, { residualSeverity: n })} />
              <RiskScore l={r.residualLikelihood} s={r.residualSeverity} m={matrix} />
            </div>
            <div className="grid-3">{list(i, 'additionalControls', 'Additional controls')}{ta(i, 'controlOwner', 'Control owner')}{ta(i, 'verification', 'Verification')}</div>
          </div>))}
        {editable && <div><button className="btn btn-sm" onClick={() => setRows([...rows, { id: `A${Date.now().toString(36).slice(-6)}`, step: '', hazard: '', consequence: '', exposed: '', existingControls: [], initialLikelihood: null, initialSeverity: null, additionalControls: [], controlOwner: '', residualLikelihood: null, residualSeverity: null, verification: '', origin: 'author' }])}><Icon name="plus" />Add risk row</button></div>}
        <details><summary className="small">Matrix convention</summary><ul className="small">{describeMatrix(matrix).map((x) => <li key={x}>{x}</li>)}</ul></details>
      </div>
    </section>
  );
}

function ReasonDialog({ title, label, confirm, onClose, onConfirm, required = true }: { title: string; label: string; confirm: string; onClose: () => void; onConfirm: (note: string) => Promise<void>; required?: boolean }) {
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  return <Dialog title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || (required && !note.trim())} onClick={async () => { setBusy(true); try { await onConfirm(note); } finally { setBusy(false); } }}>{confirm}</button></>}>
    <div className="field"><label htmlFor="reason">{label}{required ? ' *' : ''}</label><textarea id="reason" className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
  </Dialog>;
}

export function DocumentEditor({ id }: { id: string }) {
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api<DocView>(`/documents/${id}`), [id]);
  const [doc, setDoc] = useState<DocView | null>(null);
  const [content, setContent] = useState<DocContent | null>(null);
  const [inputs, setInputs] = useState<DocInputs>({});
  const [title, setTitle] = useState('');
  const [tab, setTab] = useState<'document' | 'inputs' | 'history'>('document');
  const [dialog, setDialog] = useState<null | 'return' | 'approve' | 'revise' | 'withdraw' | 'submit'>(null);
  const [busy, setBusy] = useState(false);
  const history = useAsync(() => (tab === 'history' ? api<{ items: Revision[] }>(`/documents/${id}/revisions`) : Promise.resolve({ items: [] as Revision[] })), [tab, id, doc?.version]);

  const load = (d: DocView) => { setDoc(d); setContent(d.content); setInputs(d.inputs); setTitle(d.title); };
  useEffect(() => { if (data) load(data); }, [data]);
  const dirty = useMemo(() => !!doc && (JSON.stringify(content) !== JSON.stringify(doc.content) || JSON.stringify(inputs) !== JSON.stringify(doc.inputs) || title !== doc.title), [doc, content, inputs, title]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  if (error) return <ErrorNotice error={error} retry={reload} />;
  if (loading || !doc || !content) return <Loading label="Opening document" />;
  const editable = doc.permissions.edit;
  const t = docType(doc.docType);

  async function act(fn: () => Promise<DocView>, ok: string) {
    setBusy(true);
    try { load(await fn()); toast(ok, 'ok'); setDialog(null); }
    catch (e) {
      const msg = e instanceof ApiError && Array.isArray(e.details) ? `${e.message}: ${(e.details as { message: string }[]).slice(0, 3).map((x) => x.message).join(' ')}` : (e as Error).message;
      toast(msg, 'error');
    } finally { setBusy(false); }
  }
  const save = () => act(() => api<DocView>(`/documents/${id}`, { method: 'PATCH', body: { version: doc.version, title, inputs: { ...inputs, title }, content, changeNote: 'Saved in editor' } }), 'Draft saved');
  const post = (path: string, body: Record<string, unknown>, ok: string) => act(() => api<DocView>(`/documents/${id}/${path}`, { body: { version: doc.version, ...body } }), ok);
  const exp = async (f: 'docx' | 'pdf', revisionId?: number) => { try { await download(id, f, doc.docNumber, revisionId); } catch (e) { toast((e as Error).message, 'error'); } };

  return (
    <>
      <PageHead title={doc.title} sub={<span>{doc.docNumber} · {doc.revisionLabel} · {doc.typeLabel}{doc.project ? ` · ${doc.project.code}` : ' · Organisation-wide'}{doc.site ? ` · ${doc.site.name}` : ''}</span>}
        actions={<div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <DocStatus status={doc.status} label={doc.statusLabel} />
          <button className="btn" onClick={() => exp('docx')} disabled={dirty} title={dirty ? 'Save first — exports use the saved document' : undefined}><Icon name="download" />DOCX</button>
          <button className="btn" onClick={() => exp('pdf')} disabled={dirty} title={dirty ? 'Save first — exports use the saved document' : undefined}><Icon name="download" />PDF</button>
          <button className="btn" onClick={() => window.print()}><Icon name="print" />Print</button>
        </div>} />

      <div className={`notice no-print ${doc.status === 'approved' ? '' : 'notice-warn'}`} style={{ marginBottom: 12 }}>
        {doc.status === 'approved' ? <>Approved by <strong>{doc.approvedBy?.name}</strong> on {fmtDateTime(doc.approvedAt)}. To change it, start a new revision; this revision stays in the history.</>
          : doc.status === 'withdrawn' ? <>Withdrawn: {doc.withdrawnReason}</>
          : <><strong>Draft — not approved.</strong> {doc.generator.note} {doc.status === 'in_review' ? `Submitted by ${doc.submittedBy?.name} for review.` : ''}{doc.decisionNote && doc.status === 'draft' ? ` Reviewer comments: ${doc.decisionNote}` : ''}</>}
      </div>

      <div className="row no-print" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="segmented" role="tablist">
          {(['document', 'inputs', 'history'] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} className="chip-btn" aria-pressed={tab === k} onClick={() => setTab(k)}>{k === 'document' ? 'Document' : k === 'inputs' ? 'Inputs' : 'History'}</button>)}
        </div>
        <span className="spacer" />
        {editable && <button className="btn btn-primary" disabled={!dirty || busy} onClick={save}><Icon name="check" />{dirty ? 'Save draft' : 'Saved'}</button>}
        {doc.permissions.submit && <button className="btn" disabled={dirty || busy || !doc.readiness.ready} title={!doc.readiness.ready ? 'Resolve the readiness issues first' : dirty ? 'Save first' : undefined} onClick={() => setDialog('submit')}>Submit for review</button>}
        {doc.permissions.approve && <><button className="btn btn-primary" disabled={busy} onClick={() => setDialog('approve')}>Approve</button><button className="btn" disabled={busy} onClick={() => setDialog('return')}>Return with comments</button></>}
        {doc.permissions.newRevision && <button className="btn" disabled={busy} onClick={() => setDialog('revise')}>Start new revision</button>}
        {doc.permissions.withdraw && <button className="btn btn-ghost" disabled={busy} onClick={() => setDialog('withdraw')}>Withdraw</button>}
        {t.riskRegister && doc.project && <ImportToRegister docId={doc.id} disabled={busy || dirty} />}
      </div>

      {doc.status !== 'approved' && doc.status !== 'withdrawn' && (
        <section className="panel no-print" style={{ marginBottom: 12 }}><div className="panel-body">
          <strong>{doc.readiness.ready ? 'Ready to submit for review' : `Before submitting (${doc.readiness.issues.length})`}</strong>{dirty && <span className="small muted"> — checks refresh when you save</span>}
          {doc.readiness.issues.length > 0 && <ul className="small">{doc.readiness.issues.slice(0, 12).map((x, i) => <li key={i}>{x.message}</li>)}{doc.readiness.issues.length > 12 && <li>…and {doc.readiness.issues.length - 12} more</li>}</ul>}
          {doc.readiness.warnings.length > 0 && <><span className="small muted">For the reviewer:</span><ul className="small muted">{doc.readiness.warnings.map((x, i) => <li key={i}>{x.message}</li>)}</ul></>}
        </div></section>)}

      {tab === 'document' && (
        <div className="doc-print">
          {editable ? <div className="field no-print" style={{ marginBottom: 12 }}><label htmlFor="doc-title">Title</label><input id="doc-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div> : null}
          <div className="print-only"><h1>{doc.title}</h1><p>{doc.docNumber} · {doc.revisionLabel} · {doc.statusLabel}</p></div>
          {content.sections.map((s, i) => <SectionEditor key={s.key} s={s} editable={editable}
            onChange={(n) => setContent({ ...content, sections: content.sections.map((x, j) => (j === i ? n : x)) })}
            onDelete={() => setContent({ ...content, sections: content.sections.filter((_, j) => j !== i) })} />)}
          {t.riskRegister && <RiskRegister rows={content.riskRows} matrix={doc.matrix} editable={editable} setRows={(rows) => setContent({ ...content, riskRows: rows })} />}
          <section className="panel"><div className="panel-head"><h3>Assumptions, missing inputs and required review</h3></div><div className="panel-body small">
            <ul>{content.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
            {content.missingInputs.length > 0 && <><strong>Missing inputs</strong><ul>{content.missingInputs.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
            <strong>Qualified review</strong><ul>{content.reviewRequirements.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </div></section>
        </div>)}

      {tab === 'inputs' && (
        <>
          {editable ? <InputsForm type={doc.docType} inputs={inputs} setInputs={setInputs} errors={{}} /> : <div className="notice">Inputs can only be changed on a draft.</div>}
          {editable && <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" disabled={busy || dirty} title={dirty ? 'Save the inputs first' : undefined} onClick={() => { if (window.confirm('Rebuild the document from the saved inputs? Edits made in the Document tab will be replaced (the current version stays in History).')) void post('regenerate', {}, 'Rebuilt from saved inputs'); }}><Icon name="refresh" />Rebuild document from saved inputs</button>
          </div>}
        </>)}

      {tab === 'history' && (
        <div className="panel">{history.loading && <Loading />}{history.data && (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>When</th><th>Event</th><th>Rev</th><th>By</th><th>Note</th><th></th></tr></thead>
            <tbody>{history.data.items.map((h) => (
              <tr key={h.id}><td className="small">{fmtDateTime(h.at)}</td><td>{h.event}</td><td>{h.revisionLabel}</td><td>{h.actor}</td><td className="small">{h.note}</td>
                <td className="row" style={{ gap: 4 }}>
                  <button className="btn btn-sm" onClick={() => exp('pdf', h.id)}>PDF</button><button className="btn btn-sm" onClick={() => exp('docx', h.id)}>DOCX</button>
                  {editable && <button className="btn btn-sm" disabled={busy || dirty} onClick={() => { if (window.confirm('Copy this snapshot into the current draft?')) void post('restore', { revisionId: h.id }, 'Snapshot restored into the draft'); }}>Restore</button>}
                </td></tr>))}</tbody>
          </table></div>)}</div>)}

      {dialog === 'submit' && <ReasonDialog title="Submit for review" label="Note for the reviewer" confirm="Submit" required={false} onClose={() => setDialog(null)} onConfirm={(note) => post('submit', { note }, 'Submitted for review')} />}
      {dialog === 'approve' && <ReasonDialog title="Approve document" label="Approval note (recorded in the history)" confirm="Approve" required={false} onClose={() => setDialog(null)} onConfirm={(note) => post('decision', { decision: 'approve', note }, 'Approved')} />}
      {dialog === 'return' && <ReasonDialog title="Return to the author" label="What must change" confirm="Return" onClose={() => setDialog(null)} onConfirm={(note) => post('decision', { decision: 'return', note }, 'Returned to the author')} />}
      {dialog === 'revise' && <ReasonDialog title="Start a new revision" label="Reason for the revision" confirm="Start revision" onClose={() => setDialog(null)} onConfirm={(note) => post('new-revision', { note }, 'New revision started')} />}
      {dialog === 'withdraw' && <ReasonDialog title="Withdraw document" label="Reason" confirm="Withdraw" onClose={() => setDialog(null)} onConfirm={(note) => post('withdraw', { note }, 'Withdrawn')} />}
    </>
  );
}

/** Sends the rated rows of a risk-register document to the hazard register as draft entries. */
function ImportToRegister({ docId, disabled }: { docId: string; disabled: boolean }) {
  const { can } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('');
  const cats = useAsync(() => (open ? api<{ categories: { key: string; label: string }[] }>('/hazards/meta') : Promise.resolve(null)), [open]);
  if (!can('risk.manage')) return null;
  return <>
    <button className="btn" disabled={disabled} title={disabled ? 'Save first' : 'Create draft hazard register entries from the rated rows'} onClick={() => setOpen(true)}><Icon name="arrow" />Send to hazard register</button>
    {open && <Dialog title="Send rated rows to the hazard register" onClose={() => setOpen(false)} footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!category} onClick={async () => {
      try { const r = await api<{ imported: number; skipped: number }>('/hazards/import-document', { body: { documentId: docId, category } }); toast(`${r.imported} draft hazard(s) created${r.skipped ? `, ${r.skipped} unrated or unaccepted row(s) skipped` : ''}`, 'ok'); setOpen(false); navigate('/app/risk-assessments'); }
      catch (e) { toast((e as Error).message, 'error'); }
    }}>Create drafts</button></>}>
      <p className="small">Each row with an initial rating becomes a draft entry linked to this document. Its controls arrive as "not assessed", so the register will ask for effectiveness evidence before accepting any reduction in risk.</p>
      <div className="field"><label htmlFor="imp-cat">Hazard category</label><select id="imp-cat" className="select" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Select…</option>{cats.data?.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
    </Dialog>}
  </>;
}
