/**
 * Hazard register, risk assessment editor and risk insights (Phase 4).
 * All values come from the API; empty states say so instead of showing sample numbers.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  evaluateHazard, rateOnMatrix, describeMatrix, CONTROL_TYPES, CONTROL_TYPE_LABELS, EFFECTIVENESS, EFFECTIVENESS_LABELS, ADDITIONAL_STATUSES, HAZARD_STATUSES, HAZARD_STATUS_LABELS,
  type RiskMatrixConfig, type HazardCategoryDef, type ExistingControl, type AdditionalControl, type HazardStatus, type RiskBand, type Insight, type EngineIssue,
} from '@forgehse/shared';
import { api, ApiError } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Link, navigate, useLocation } from '../lib/router';
import { fmtDate, fmtDateTime, todayISO } from '../lib/format';
import { RecordFiles } from './Library';
import { PageHead } from '../components/AppShell';
import { Dialog, Empty, ErrorNotice, Icon, Loading, Pagination, useToast } from '../components/ui';

interface Meta { categories: HazardCategoryDef[]; matrix: RiskMatrixConfig }
type Rated = { score: number; band: RiskBand } | null;
interface ListItem { id: string; ref: string; categoryLabel: string; activity: string; project: string; site: string | null; initial: Rated; residual: Rated; status: HazardStatus; statusLabel: string; revisionLabel: string; reviewDate: string | null; reviewState: string; updatedAt: string }
interface ListResp { items: ListItem[]; total: number; page: number; pageSize: number; summary: { byBand: Record<string, number>; byCategory: Record<string, number>; byStatus: Record<string, number>; reviewOverdue: number } }
interface Link_ { type: 'document' | 'observation'; id: string; ref?: string; label?: string; status?: string }
interface HazardView {
  id: string; ref: string; projectId: string; siteId: string | null; category: string; categoryLabel: string; activity: string; workPackage: string; description: string; consequences: string; personsExposed: string;
  existingControls: ExistingControl[]; additionalControls: AdditionalControl[]; initialLikelihood: number | null; initialSeverity: number | null; residualLikelihood: number | null; residualSeverity: number | null;
  residualJustification: string; reviewDate: string | null; reviewState: string; matrix: RiskMatrixConfig; status: HazardStatus; statusLabel: string; revisionLabel: string; version: number;
  project: { code: string; name: string }; site: { name: string } | null; submittedBy: { name: string } | null; reviewedBy: { name: string } | null; approvedBy: { name: string } | null; approvedAt: string | null; decisionNote: string | null;
  sourceDocumentId: string | null; links: Link_[]; lessons: { id: string; ref: string; description: string; verification: string; closedAt: string | null }[];
  permissions: { edit: boolean; submit: boolean; review: boolean; approve: boolean; reject: boolean; revise: boolean; archive: boolean };
}

const BANDS: RiskBand[] = ['critical', 'high', 'medium', 'low'];
const BandChip = ({ r, empty = 'Not rated' }: { r: Rated; empty?: string }) => r ? <span className={`risk risk-${r.band}`}><span className="score">{r.score}</span>{r.band.toUpperCase()}</span> : <span className="small muted">{empty}</span>;

function StatusChip({ s, label }: { s: HazardStatus; label: string }) {
  const c = s === 'approved' ? 'risk-low' : s === 'rejected' || s === 'archived' ? 'risk-critical' : s === 'draft' ? 'risk-high' : 'risk-medium';
  return <span className={`risk ${c}`}>{label}</span>;
}

/* =================================================================== insights */

function InsightCard({ i }: { i: Insight }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`insight insight-${i.severity}`}>
      <button className="insight-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="alert" size={16} /><span className="t">{i.title}</span><span className="badge">Rule-based</span><Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="insight-body small">
          <p><strong>Why this fired:</strong> {i.reason}</p>
          <ul>{i.facts.map((f, k) => <li key={k}>{f}</li>)}</ul>
          <strong>Underlying records</strong>
          <ul>{i.evidence.map((e) => <li key={e.id}><Link to={e.type === 'observation' ? `/app/observations/${e.id}` : `/app/hazards/${e.id}`}>{e.ref}</Link> — {e.label}{e.date ? ` (${e.date})` : ''}</li>)}</ul>
          <strong>Recommended human actions</strong><ul>{i.recommendedActions.map((a, k) => <li key={k}>{a}</li>)}</ul>
          <span className="muted">Limitations: {i.limitations.join(' ')}</span>
        </div>)}
    </article>
  );
}

function InsightsPanel({ projectId }: { projectId: string }) {
  const { data, error, loading } = useAsync(() => api<{ insights: Insight[]; disclaimer: string; unavailable: string[]; trend: { months: string[]; series: { category: string; counts: number[] }[]; source: string } }>('/hazards/insights', { query: { projectId } }), [projectId]);
  const max = Math.max(1, ...(data?.trend.series.flatMap((s) => s.counts) ?? [1]));
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head"><h3>Risk insights</h3><span className="small muted">{data?.disclaimer}</span></div>
      <div className="panel-body insights-grid">
        <div className="stack" style={{ gap: 8 }}>
          {loading && <Loading />}{error && <ErrorNotice error={error} />}
          {data && !data.insights.length && <p className="small muted">No rule fired for the records in this scope.</p>}
          {data?.insights.map((i) => <InsightCard key={i.id} i={i} />)}
          {data && <details className="small muted"><summary>Data sources not available</summary><ul>{data.unavailable.map((u) => <li key={u}>{u}</li>)}</ul></details>}
        </div>
        <div>
          <strong className="small">Observation trend (last 6 months)</strong>
          {data && !data.trend.series.length && <p className="small muted">No observations recorded in this period.</p>}
          {data?.trend.series.map((s) => (
            <div key={s.category} className="trend-row" title={`${s.category}: ${s.counts.join(', ')}`}>
              <span className="small">{s.category}</span>
              <div className="trend-bars" role="img" aria-label={`${s.category} by month: ${s.counts.map((c, k) => `${data.trend.months[k]} ${c}`).join(', ')}`}>
                {s.counts.map((c, k) => <span key={k} style={{ height: `${Math.max(4, (c / max) * 100)}%`, opacity: c ? 1 : 0.25 }} />)}
              </div>
            </div>))}
          {data && data.trend.series.length > 0 && <span className="small muted">{data.trend.source}</span>}
        </div>
      </div>
    </section>
  );
}

/* =================================================================== register */

export function HazardRegister() {
  const { me, can } = useAuth();
  const { search } = useLocation();
  const [projectId, setProjectId] = useState(search.get('projectId') ?? me?.projects[0]?.id ?? '');
  const [category, setCategory] = useState(''); const [status, setStatus] = useState(''); const [band, setBand] = useState(search.get('band') ?? '');
  const [review, setReview] = useState(''); const [q, setQ] = useState(''); const [query, setQuery] = useState(''); const [page, setPage] = useState(1);
  const meta = useAsync(() => api<Meta>('/hazards/meta'), []);
  const { data, error, loading, reload } = useAsync(() => api<ListResp>('/hazards', { query: { projectId, category, status, band, review, q: query, page } }), [projectId, category, status, band, review, query, page]);
  const reset = (f: () => void) => { f(); setPage(1); };
  const awaiting = (data?.summary.byStatus.submitted ?? 0) + (data?.summary.byStatus.reviewed ?? 0);
  return (
    <>
      <PageHead title="Hazard register" sub="Inherent and residual risk on your organisation's matrix. A lower residual risk needs implemented controls with assessed effectiveness; high risk needs review and authorised approval."
        actions={can('risk.manage') ? <Link className="btn btn-primary" to={`/app/hazards/new${projectId ? `?projectId=${projectId}` : ''}`}><Icon name="plus" />New hazard</Link> : undefined} />
      <section className="kpi-strip panel-eng" aria-label="Residual risk summary" style={{ marginBottom: 16 }}>
        {BANDS.map((b) => (
          <button key={b} className={`kpi kpi-btn ${band === b ? 'active' : ''}`} aria-pressed={band === b} onClick={() => reset(() => setBand(band === b ? '' : b))}>
            <div className="value">{data ? data.summary.byBand[b] ?? 0 : '–'}</div><span className="label"><span className={`risk risk-${b}`}>{b.toUpperCase()}</span> residual</span>
          </button>))}
        <button className={`kpi kpi-btn ${data?.summary.reviewOverdue ? 'alert' : ''}`} aria-pressed={review === 'overdue'} onClick={() => reset(() => setReview(review === 'overdue' ? '' : 'overdue'))}><div className="value">{data?.summary.reviewOverdue ?? '–'}</div><span className="label">Reviews overdue</span></button>
        <button className="kpi kpi-btn" onClick={() => reset(() => { setStatus(status === 'submitted' ? '' : 'submitted'); })}><div className="value">{data ? awaiting : '–'}</div><span className="label">Awaiting review / approval</span><div className="sub">{data?.summary.byBand.unrated ?? 0} not yet rated</div></button>
      </section>
      {projectId && <InsightsPanel projectId={projectId} />}
      <div className="row filter-bar" style={{ marginBottom: 12 }}>
        <select className="select" aria-label="Project" value={projectId} onChange={(e) => reset(() => setProjectId(e.target.value))}>{me?.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select>
        <select className="select" aria-label="Category" value={category} onChange={(e) => reset(() => setCategory(e.target.value))}><option value="">All categories</option>{meta.data?.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
        <select className="select" aria-label="Status" value={status} onChange={(e) => reset(() => setStatus(e.target.value))}><option value="">Active statuses</option>{HAZARD_STATUSES.map((s) => <option key={s} value={s}>{HAZARD_STATUS_LABELS[s]}</option>)}</select>
        <select className="select" aria-label="Review" value={review} onChange={(e) => reset(() => setReview(e.target.value))}><option value="">Any review date</option><option value="overdue">Review overdue</option><option value="due_soon">Review due in 14 days</option></select>
        <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); reset(() => setQuery(q)); }}><input className="input" placeholder="Search ref, activity, hazard" aria-label="Search hazards" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn" type="submit" aria-label="Search hazards"><Icon name="search" /></button></form>
      </div>
      {error && <ErrorNotice error={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data && !data.items.length && <div className="panel"><Empty title="No hazards match" action={can('risk.manage') ? <Link className="btn btn-primary" to="/app/hazards/new">Add a hazard</Link> : undefined}>Viewers only see approved entries. Clear the filters or add the first hazard for this project.</Empty></div>}
      {data && data.items.length > 0 && (
        <div className="panel">
          <div className="table-wrap hide-mobile"><table className="data">
            <thead><tr><th>Ref</th><th>Hazard / activity</th><th>Category</th><th>Initial</th><th>Residual</th><th>Status</th><th>Review</th></tr></thead>
            <tbody>{data.items.map((h) => (
              <tr key={h.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/app/hazards/${h.id}`)}>
                <td><Link to={`/app/hazards/${h.id}`}>{h.ref}</Link><div className="small muted">{h.revisionLabel}</div></td>
                <td>{h.activity}<div className="small muted">{h.project}{h.site ? ` · ${h.site}` : ''}</div></td><td className="small">{h.categoryLabel}</td>
                <td><BandChip r={h.initial} /></td><td><BandChip r={h.residual} /></td><td><StatusChip s={h.status} label={h.statusLabel} /></td>
                <td className={`small ${h.reviewState === 'overdue' ? 'text-critical' : 'muted'}`}>{h.reviewDate ? fmtDate(h.reviewDate) : '—'}{h.reviewState === 'overdue' ? ' · overdue' : h.reviewState === 'due_soon' ? ' · due soon' : ''}</td>
              </tr>))}</tbody>
          </table></div>
          <div className="card-list show-mobile">{data.items.map((h) => (
            <Link key={h.id} className="m-card" to={`/app/hazards/${h.id}`}>
              <div className="row" style={{ gap: 6 }}><strong>{h.ref}</strong><span className="spacer" /><BandChip r={h.residual} /></div>
              <span>{h.activity}</span>
              <div className="row small muted" style={{ gap: 6, flexWrap: 'wrap' }}><span>{h.categoryLabel}</span><StatusChip s={h.status} label={h.statusLabel} />{h.reviewState === 'overdue' && <span className="text-critical">Review overdue</span>}</div>
            </Link>))}</div>
          <div className="panel-body"><Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></div>
        </div>)}
    </>
  );
}

/* =================================================================== editor */

function MatrixPicker({ label, m, l, s, onPick, disabled }: { label: string; m: RiskMatrixConfig; l: number | null; s: number | null; onPick: (l: number, s: number) => void; disabled: boolean }) {
  const r = rateOnMatrix(l, s, m);
  return (
    <div className="mpick">
      <div className="row" style={{ gap: 8, marginBottom: 6 }}><strong>{label}</strong><BandChip r={r} empty="Click a cell to rate" />{r && <span className="small muted">L{l} × S{s}</span>}</div>
      <div className="mpick-grid" role="group" aria-label={`${label} matrix`} style={{ gridTemplateColumns: `auto repeat(${m.size}, minmax(0, 1fr))` }}>
        {Array.from({ length: m.size }, (_, li) => { const L = m.size - li; return (
          <div key={L} style={{ display: 'contents' }}>
            <span className="mpick-axis small" title={m.likelihoodLabels?.[L - 1]}>{L}{m.likelihoodLabels?.[L - 1] ? <span className="hide-mobile"> {m.likelihoodLabels[L - 1]}</span> : null}</span>
            {Array.from({ length: m.size }, (_, si) => { const S = si + 1; const c = rateOnMatrix(L, S, m)!; const sel = l === L && s === S; return (
              <button key={S} type="button" disabled={disabled} aria-pressed={sel} aria-label={`${label}: likelihood ${L}, severity ${S}, score ${c.score} ${c.band}`}
                className={`mpick-cell b-${c.band} ${sel ? 'sel' : ''}`} onClick={() => onPick(L, S)}>{c.score}</button>); })}
          </div>); })}
        <span />{Array.from({ length: m.size }, (_, si) => <span key={si} className="mpick-axis small" style={{ textAlign: 'center' }} title={m.severityLabels?.[si]}>{si + 1}</span>)}
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>Likelihood ↑ · Severity →</div>
    </div>
  );
}

function ControlRows<T extends ExistingControl>({ title, rows, set, extra, editable, blank }: { title: string; rows: T[]; set: (r: T[]) => void; extra: boolean; editable: boolean; blank: T }) {
  const up = (i: number, p: Partial<T>) => set(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <section className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-head"><h3>{title}</h3><span className="small muted">{extra ? 'Planned controls never lower the current residual risk.' : 'State how effectiveness was judged.'}</span></div>
      <div className="panel-body stack" style={{ gap: 10 }}>
        {!rows.length && <span className="small muted">None recorded.</span>}
        {rows.map((c, i) => (
          <div key={i} className="ctl-row">
            <textarea className="textarea" rows={2} aria-label={`${title} ${i + 1}`} disabled={!editable} value={c.text} onChange={(e) => up(i, { text: e.target.value } as Partial<T>)} placeholder="Control" />
            <select className="select" aria-label={`${title} ${i + 1} type`} disabled={!editable} value={c.type} onChange={(e) => up(i, { type: e.target.value } as Partial<T>)}>{CONTROL_TYPES.map((t) => <option key={t} value={t}>{CONTROL_TYPE_LABELS[t]}</option>)}</select>
            <select className="select" aria-label={`${title} ${i + 1} effectiveness`} disabled={!editable} value={c.effectiveness} onChange={(e) => up(i, { effectiveness: e.target.value } as Partial<T>)}>{EFFECTIVENESS.map((t) => <option key={t} value={t}>{EFFECTIVENESS_LABELS[t]}</option>)}</select>
            <input className="input" aria-label={`${title} ${i + 1} effectiveness basis`} disabled={!editable} value={c.basis} onChange={(e) => up(i, { basis: e.target.value } as Partial<T>)} placeholder="Basis: inspection, test, record…" />
            {extra && <>
              <input className="input" aria-label={`${title} ${i + 1} owner`} disabled={!editable} value={(c as unknown as AdditionalControl).owner} onChange={(e) => up(i, { owner: e.target.value } as unknown as Partial<T>)} placeholder="Owner" />
              <input className="input" type="date" aria-label={`${title} ${i + 1} due date`} disabled={!editable} value={(c as unknown as AdditionalControl).dueDate ?? ''} onChange={(e) => up(i, { dueDate: e.target.value || null } as unknown as Partial<T>)} />
              <select className="select" aria-label={`${title} ${i + 1} status`} disabled={!editable} value={(c as unknown as AdditionalControl).status} onChange={(e) => up(i, { status: e.target.value } as unknown as Partial<T>)}>{ADDITIONAL_STATUSES.map((s) => <option key={s} value={s}>{s[0]!.toUpperCase() + s.slice(1)}</option>)}</select>
            </>}
            {editable && <button type="button" className="icon-btn" aria-label={`Remove ${title} ${i + 1}`} onClick={() => set(rows.filter((_, j) => j !== i))}><Icon name="trash" /></button>}
          </div>))}
        {editable && <div><button type="button" className="btn btn-sm" onClick={() => set([...rows, { ...blank }])}><Icon name="plus" />Add control</button></div>}
      </div>
    </section>
  );
}

function IssueList({ issues }: { issues: EngineIssue[] }) {
  const b = issues.filter((i) => i.blocking), w = issues.filter((i) => !i.blocking);
  if (!issues.length) return <p className="small" style={{ color: 'var(--low)' }}><Icon name="check" size={14} /> The risk engine checks pass.</p>;
  return <div className="small">{b.length > 0 && <><strong>Must fix before submitting</strong><ul>{b.map((i, k) => <li key={k}>{i.message}</li>)}</ul></>}{w.length > 0 && <><strong>For the reviewer</strong><ul className="muted">{w.map((i, k) => <li key={k}>{i.message}</li>)}</ul></>}</div>;
}

const BLANK_EX: ExistingControl = { text: '', type: 'engineering', effectiveness: 'not_assessed', basis: '' };
const BLANK_ADD: AdditionalControl = { text: '', type: 'engineering', effectiveness: 'not_assessed', basis: '', owner: '', dueDate: null, status: 'planned' };

type Form = Omit<HazardView, 'id' | 'ref' | 'categoryLabel' | 'reviewState' | 'status' | 'statusLabel' | 'revisionLabel' | 'version' | 'project' | 'site' | 'submittedBy' | 'reviewedBy' | 'approvedBy' | 'approvedAt' | 'decisionNote' | 'sourceDocumentId' | 'lessons' | 'permissions' | 'matrix'>;

export function HazardEditor({ id }: { id?: string }) {
  const { me } = useAuth();
  const toast = useToast();
  const { search } = useLocation();
  const meta = useAsync(() => api<Meta>('/hazards/meta'), []);
  const existing = useAsync(() => (id ? api<HazardView>(`/hazards/${id}`) : Promise.resolve(null)), [id]);
  const [h, setH] = useState<HazardView | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | 'reject' | 'revise' | 'archive' | 'approve' | 'review' | 'submit'>(null);
  const [tab, setTab] = useState<'assessment' | 'history'>('assessment');
  const history = useAsync(() => (id && tab === 'history' ? api<{ items: { id: number; event: string; revisionLabel: string; note: string; actor: string; at: string; residualBand: string | null }[] }>(`/hazards/${id}/revisions`) : Promise.resolve({ items: [] })), [id, tab, h?.version]);

  const fromView = (v: HazardView): Form => ({ projectId: v.projectId, siteId: v.siteId, category: v.category, activity: v.activity, workPackage: v.workPackage, description: v.description, consequences: v.consequences, personsExposed: v.personsExposed, existingControls: v.existingControls, additionalControls: v.additionalControls, initialLikelihood: v.initialLikelihood, initialSeverity: v.initialSeverity, residualLikelihood: v.residualLikelihood, residualSeverity: v.residualSeverity, residualJustification: v.residualJustification, reviewDate: v.reviewDate, links: v.links.map((l) => ({ type: l.type, id: l.id })) });
  useEffect(() => { if (existing.data) { setH(existing.data); setF(fromView(existing.data)); } }, [existing.data]);
  useEffect(() => {
    if (!id && meta.data && !f) setF({ projectId: search.get('projectId') ?? me?.projects[0]?.id ?? '', siteId: null, category: meta.data.categories[0]?.key ?? '', activity: '', workPackage: '', description: '', consequences: '', personsExposed: '', existingControls: [{ ...BLANK_EX }], additionalControls: [], initialLikelihood: null, initialSeverity: null, residualLikelihood: null, residualSeverity: null, residualJustification: '', reviewDate: todayISO(90), links: [] });
  }, [id, meta.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const matrix = h?.matrix ?? meta.data?.matrix;
  const ev = useMemo(() => (f && matrix ? evaluateHazard(f, matrix, todayISO()) : null), [f, matrix]);
  const dirty = !!h && !!f && JSON.stringify(f) !== JSON.stringify(fromView(h));

  if (meta.error || existing.error) return <ErrorNotice error={meta.error ?? existing.error} />;
  if (!f || !matrix || !meta.data || (id && !h)) return <Loading label="Opening hazard" />;
  const editable = !h || h.permissions.edit;
  const project = me?.projects.find((p) => p.id === f.projectId);
  const set = (p: Partial<Form>) => setF({ ...f, ...p });
  const fail = (e: unknown) => toast(e instanceof ApiError && Array.isArray(e.details) ? `${e.message}: ${(e.details as { message: string }[]).slice(0, 3).map((x) => x.message).join(' ')}` : (e as Error).message, 'error');

  async function save() {
    setBusy(true);
    try {
      if (!h) { const v = await api<HazardView>('/hazards', { body: f }); toast('Hazard created as a draft', 'ok'); navigate(`/app/hazards/${v.id}`, { replace: true }); }
      else { const { projectId: _p, ...rest } = f!; const v = await api<HazardView>(`/hazards/${h.id}`, { method: 'PATCH', body: { ...rest, version: h.version } }); setH({ ...h, ...v }); setF(fromView({ ...h, ...v })); toast('Saved', 'ok'); }
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function act(action: string, note = '') {
    if (!h) return;
    setBusy(true);
    try { const v = await api<HazardView>(`/hazards/${h.id}/transition`, { body: { version: h.version, action, note } }); const nv = { ...h, ...v }; setH(nv); setF(fromView(nv)); setDialog(null); toast(HAZARD_STATUS_LABELS[v.status], 'ok'); }
    catch (e) { fail(e); } finally { setBusy(false); }
  }
  const route = ev?.requiresAuthorisedApproval
    ? `${ev.approvalBand!.toUpperCase()} risk — needs an independent review and then approval by an authorised approver.${ev.intolerable ? ' The residual risk is CRITICAL and cannot be approved until it is reduced.' : ''}`
    : ev?.approvalBand ? 'Low/medium risk — an independent reviewer can approve it.' : 'Rate the risk to see the approval route.';

  return (
    <>
      <PageHead title={h ? `${h.ref} · ${h.activity}` : 'New hazard'} sub={h ? <span>{h.categoryLabel} · {h.project.code}{h.site ? ` · ${h.site.name}` : ''} · {h.revisionLabel}</span> : 'Record the hazard, its controls and the inherent and residual risk.'}
        actions={<div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{h && <StatusChip s={h.status} label={h.statusLabel} />}<Link className="btn" to="/app/risk-assessments">Register</Link></div>} />
      {h?.status === 'approved' && <div className="notice" style={{ marginBottom: 12 }}>Approved by <strong>{h.approvedBy?.name}</strong> on {fmtDateTime(h.approvedAt)}. Reassess to change it; this revision stays in the history.</div>}
      {h?.status === 'rejected' && <div className="notice notice-warn" style={{ marginBottom: 12 }}>Rejected: {h.decisionNote}. Edit and save to rework it.</div>}

      <div className="row no-print" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {h && <div className="segmented">{(['assessment', 'history'] as const).map((k) => <button key={k} className="chip-btn" aria-pressed={tab === k} onClick={() => setTab(k)}>{k === 'assessment' ? 'Assessment' : 'History'}</button>)}</div>}
        <span className="spacer" />
        {editable && <button className="btn btn-primary" disabled={busy || (!!h && !dirty)} onClick={save}><Icon name="check" />{h ? (dirty ? 'Save' : 'Saved') : 'Create draft'}</button>}
        {h?.permissions.submit && <button className="btn" disabled={busy || dirty} onClick={() => setDialog('submit')}>Submit for review</button>}
        {h?.status === 'draft' && !h.permissions.submit && editable && <span className="small muted">Fix the engine issues to submit</span>}
        {h?.permissions.review && <button className="btn" disabled={busy} onClick={() => setDialog('review')}>Mark reviewed</button>}
        {h?.permissions.approve && <button className="btn btn-primary" disabled={busy} onClick={() => setDialog('approve')}>Approve</button>}
        {h?.permissions.reject && <button className="btn" disabled={busy} onClick={() => setDialog('reject')}>Reject</button>}
        {h?.permissions.revise && <button className="btn" disabled={busy} onClick={() => setDialog('revise')}>Reassess (new revision)</button>}
        {h?.permissions.archive && <button className="btn btn-ghost" disabled={busy} onClick={() => setDialog('archive')}>Archive</button>}
      </div>

      {tab === 'assessment' && <div className="hz-grid">
        <div>
          <section className="panel" style={{ marginBottom: 12 }}><div className="panel-head"><h3>Context</h3></div><div className="panel-body grid-2">
            <div className="field"><label htmlFor="hz-proj">Project</label><select id="hz-proj" className="select" disabled={!!h} value={f.projectId} onChange={(e) => set({ projectId: e.target.value, siteId: null })}>{me?.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></div>
            <div className="field"><label htmlFor="hz-site">Site</label><select id="hz-site" className="select" disabled={!editable} value={f.siteId ?? ''} onChange={(e) => set({ siteId: e.target.value || null })}><option value="">Whole project</option>{project?.sites.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}</select></div>
            <div className="field"><label htmlFor="hz-cat">Category *</label><select id="hz-cat" className="select" disabled={!editable} value={f.category} onChange={(e) => set({ category: e.target.value })}>{meta.data.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
            <div className="field"><label htmlFor="hz-wp">Work package</label><input id="hz-wp" className="input" disabled={!editable} value={f.workPackage} onChange={(e) => set({ workPackage: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="hz-act">Activity *</label><input id="hz-act" className="input" disabled={!editable} value={f.activity} onChange={(e) => set({ activity: e.target.value })} /></div>
          </div></section>
          <section className="panel" style={{ marginBottom: 12 }}><div className="panel-head"><h3>Hazard</h3></div><div className="panel-body stack">
            <div className="field"><label htmlFor="hz-desc">Hazard description *</label><textarea id="hz-desc" className="textarea" rows={2} disabled={!editable} value={f.description} onChange={(e) => set({ description: e.target.value })} /></div>
            <div className="field"><label htmlFor="hz-cons">Foreseeable consequences *</label><textarea id="hz-cons" className="textarea" rows={2} disabled={!editable} value={f.consequences} onChange={(e) => set({ consequences: e.target.value })} /></div>
            <div className="field"><label htmlFor="hz-pers">Persons potentially exposed *</label><input id="hz-pers" className="input" disabled={!editable} value={f.personsExposed} onChange={(e) => set({ personsExposed: e.target.value })} /></div>
          </div></section>
          <ControlRows title="Existing controls" rows={f.existingControls} set={(r) => set({ existingControls: r })} extra={false} editable={editable} blank={BLANK_EX} />
          <ControlRows title="Additional controls" rows={f.additionalControls} set={(r) => set({ additionalControls: r })} extra editable={editable} blank={BLANK_ADD} />
          <section className="panel" style={{ marginBottom: 12 }}><div className="panel-head"><h3>Risk rating</h3></div><div className="panel-body">
            <div className="grid-2">
              <MatrixPicker label="Initial (inherent) risk" m={matrix} l={f.initialLikelihood} s={f.initialSeverity} disabled={!editable} onPick={(l, s) => set({ initialLikelihood: l, initialSeverity: s })} />
              <MatrixPicker label="Residual risk" m={matrix} l={f.residualLikelihood} s={f.residualSeverity} disabled={!editable} onPick={(l, s) => set({ residualLikelihood: l, residualSeverity: s })} />
            </div>
            <div className="field" style={{ marginTop: 10 }}><label htmlFor="hz-just">Why is the residual risk at this level?</label><textarea id="hz-just" className="textarea" rows={2} disabled={!editable} value={f.residualJustification} onChange={(e) => set({ residualJustification: e.target.value })} placeholder="Which implemented controls reduce likelihood or severity, and how you know they work" /></div>
            <div className="field" style={{ maxWidth: 240 }}><label htmlFor="hz-rev">Review date</label><input id="hz-rev" type="date" className="input" disabled={!editable} value={f.reviewDate ?? ''} onChange={(e) => set({ reviewDate: e.target.value || null })} /></div>
            <details className="small muted"><summary>Matrix convention</summary><ul>{describeMatrix(matrix).map((x) => <li key={x}>{x}</li>)}</ul></details>
          </div></section>
        </div>
        <aside className="hz-side">
          <section className="panel sticky-panel"><div className="panel-head"><h3>Risk engine</h3></div><div className="panel-body stack" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 8 }}><span className="small">Initial</span><BandChip r={ev?.initial ?? null} /><Icon name="arrow" size={14} /><span className="small">Residual</span><BandChip r={ev?.residual ?? null} /></div>
            <p className="small"><strong>Approval route:</strong> {route}</p>
            {ev && <IssueList issues={ev.issues} />}
            {h?.submittedBy && <p className="small muted">Submitted by {h.submittedBy.name}{h.reviewedBy ? ` · reviewed by ${h.reviewedBy.name}` : ''}</p>}
          </div></section>
          {h && <section className="panel" style={{ marginTop: 12 }}><div className="panel-head"><h3>Linked records</h3></div><div className="panel-body small">
            {!h.links.length && <span className="muted">No linked documents or observations.</span>}
            <ul>{h.links.map((l) => <li key={l.id}><Link to={l.type === 'document' ? `/app/documents/${l.id}` : `/app/observations/${l.id}`}>{l.ref}</Link> — {l.label} <span className="muted">({l.type}, {l.status})</span></li>)}</ul>
            <span className="muted">Permits, incidents and inspections become linkable when those modules go live.</span>
          </div></section>}
          {h && <div style={{ marginTop: 12 }}><RecordFiles recordType="hazard" recordId={h.id} projectId={h.projectId} siteId={h.siteId} /></div>}
          {h && h.lessons.length > 0 && <section className="panel" style={{ marginTop: 12 }}><div className="panel-head"><h3>Verified lessons</h3></div><div className="panel-body small">
            <span className="muted">Closed observations in this hazard family whose corrective action was verified.</span>
            <ul>{h.lessons.map((x) => <li key={x.id}><Link to={`/app/observations/${x.id}`}>{x.ref}</Link>: {x.verification}</li>)}</ul>
          </div></section>}
        </aside>
      </div>}

      {tab === 'history' && <div className="panel">{history.loading && <Loading />}{history.data && <div className="table-wrap"><table className="data">
        <thead><tr><th>When</th><th>Event</th><th>Rev</th><th>Residual</th><th>By</th><th>Note</th></tr></thead>
        <tbody>{history.data.items.map((x) => <tr key={x.id}><td className="small">{fmtDateTime(x.at)}</td><td>{x.event}</td><td>{x.revisionLabel}</td><td>{x.residualBand ? <span className={`risk risk-${x.residualBand}`}>{x.residualBand.toUpperCase()}</span> : '—'}</td><td>{x.actor}</td><td className="small">{x.note}</td></tr>)}</tbody>
      </table></div>}</div>}

      {dialog && <NoteDialog kind={dialog} onClose={() => setDialog(null)} onConfirm={(n) => act(dialog, n)} busy={busy} />}
    </>
  );
}

function NoteDialog({ kind, onClose, onConfirm, busy }: { kind: 'reject' | 'revise' | 'archive' | 'approve' | 'review' | 'submit'; onClose: () => void; onConfirm: (n: string) => void; busy: boolean }) {
  const [n, setN] = useState('');
  const cfg = { reject: ['Reject assessment', 'Reasons', true], revise: ['Reassess — start a new revision', 'Reason for reassessment', true], archive: ['Archive', 'Reason', true], approve: ['Approve assessment', 'Approval note', false], review: ['Mark reviewed', 'Review note', false], submit: ['Submit for review', 'Note for the reviewer', false] }[kind] as [string, string, boolean];
  return <Dialog title={cfg[0]} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || (cfg[2] && !n.trim())} onClick={() => onConfirm(n)}>Confirm</button></>}>
    <div className="field"><label htmlFor="hz-note">{cfg[1]}{cfg[2] ? ' *' : ''}</label><textarea id="hz-note" className="textarea" rows={3} value={n} onChange={(e) => setN(e.target.value)} /></div>
  </Dialog>;
}
