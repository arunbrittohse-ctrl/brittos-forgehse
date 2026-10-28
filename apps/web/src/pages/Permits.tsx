/**
 * Permit to Work: register, application form and permit page (checks, gas tests, isolations,
 * segregation of duties, history and other live permits nearby). All data comes from the API.
 */
import { useEffect, useState } from 'react';
import { PTW_TYPES, PTW_TYPE_DEFS, type PtwType, type PermitStatus, type Isolation } from '@forgehse/shared';
import { api, fieldErrors } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Link, navigate, useLocation } from '../lib/router';
import { fmtDateTime } from '../lib/format';
import { PageHead } from '../components/AppShell';
import { Dialog, Empty, ErrorNotice, Field, Icon, Loading, Pagination, useToast } from '../components/ui';
import { RecordFiles } from './Library';

interface Issue { code: string; message: string }
interface Check { id: string; text: string; critical: boolean; confirmed: boolean; byName: string | null; at: string | null; note: string }
interface Gas { id: string; takenAt: string; instrument: string; oxygenPct: number | null; lelPct: number | null; h2sPpm: number | null; coPpm: number | null; other: string; withinLimits: boolean; note: string; byName: string }
type Who = { id: string; name: string } | null;
interface PermitView {
  id: string; ref: string; permitType: PtwType; typeLabel: string; workDescription: string; location: string; contractorName: string; crew: string[]; equipment: string; emergencyArrangements: string;
  validFrom: string; validTo: string; gasTestRequired: boolean; gasTestNeeded: boolean; details: Record<string, string | number | string[]>; isolations: Isolation[]; checks: Check[]; gasTests: Gas[]; hazardIds: string[];
  project: { id: string; code: string; name: string }; site: { id: string; name: string }; status: PermitStatus; statusLabel: string;
  applicant: { id: string; name: string }; reviewedBy: Who; authorisedBy: Who; authorisedAt: string | null; acceptedBy: Who; completedBy: Who; completionNote: string | null; closedBy: Who; closureNote: string | null; decisionNote: string | null;
  version: number; issues: { application: Issue[]; authorisation: Issue[]; revalidation: Issue[] }; liveNow: boolean;
  permissions: Record<'edit' | 'submit' | 'startReview' | 'confirmChecks' | 'gasTest' | 'authorise' | 'reject' | 'activate' | 'suspend' | 'revalidate' | 'complete' | 'close' | 'cancel' | 'copy', boolean>;
  history: { id: number; event: string; toLabel: string; note: string; actor: string; at: string }[];
  simops: { id: string; ref: string; typeLabel: string; location: string; statusLabel: string; validFrom: string; validTo: string }[];
  hazards: { id: string; ref: string; activity: string; residualBand: string | null; status: string }[]; maxHours: number;
}
interface ListItem { id: string; ref: string; typeLabel: string; workDescription: string; location: string; project: string; site: string; validFrom: string; validTo: string; status: PermitStatus; statusLabel: string; applicant: string; contractorName: string }
interface ListResp { items: ListItem[]; total: number; page: number; pageSize: number; counts: { active: number; suspended: number; awaiting: number; ending: number } }
interface Meta { maxHours: number; canApply: boolean; canIssue: boolean; notice: string }

export function PermitStatusChip({ s, label }: { s: PermitStatus; label: string }) {
  const c = s === 'active' ? 'risk-low' : s === 'suspended' || s === 'rejected' || s === 'expired' ? 'risk-critical' : s === 'authorised' ? 'chip-live' : s === 'closed' || s === 'cancelled' || s === 'completed' ? 'chip-neutral' : s === 'draft' ? 'risk-high' : 'risk-medium';
  return <span className={`risk ${c}`}>{label}</span>;
}
const toLocal = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : '');

/* ================================================================ register */

export function PermitRegister() {
  const { me, can } = useAuth();
  const { search } = useLocation();
  const [projectId, setProjectId] = useState(search.get('projectId') ?? me?.projects[0]?.id ?? '');
  const [view, setView] = useState(search.get('view') ?? 'live'); const [permitType, setPermitType] = useState('');
  const [q, setQ] = useState(''); const [query, setQuery] = useState(''); const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAsync(() => api<ListResp>('/permits', { query: { projectId, view, permitType, q: query, page } }), [projectId, view, permitType, query, page]);
  const reset = (f: () => void) => { f(); setPage(1); };
  const tab = (v: string, label: string, n?: number) => <button className={`kpi kpi-btn ${view === v ? 'active' : ''} ${v === 'live' && data?.counts.suspended ? 'alert' : ''}`} aria-pressed={view === v} onClick={() => reset(() => setView(v))}><div className="value">{n ?? '–'}</div><span className="label">{label}</span></button>;
  return (
    <>
      <PageHead title="Permits to Work" sub="Apply, review, authorise, start, suspend and close permits. The applicant never authorises or closes their own permit, and a permit ends automatically when its validity runs out."
        actions={can('permit.apply') ? <Link className="btn btn-primary" to={`/app/permits/new${projectId ? `?projectId=${projectId}` : ''}`}><Icon name="plus" />Apply for a permit</Link> : undefined} />
      <section className="kpi-strip panel-eng" aria-label="Permit status" style={{ marginBottom: 16 }}>
        {tab('live', 'Live (authorised, active, suspended)', data ? data.counts.active + data.counts.suspended : undefined)}
        {tab('awaiting', 'Awaiting review / authorisation', data?.counts.awaiting)}
        <div className={`kpi ${data?.counts.ending ? 'alert' : ''}`}><div className="value">{data?.counts.ending ?? '–'}</div><span className="label">Live permits ending within 2 hours</span></div>
        <div className={`kpi ${data?.counts.suspended ? 'alert' : ''}`}><div className="value">{data?.counts.suspended ?? '–'}</div><span className="label">Suspended</span></div>
      </section>
      <div className="row filter-bar" style={{ marginBottom: 12 }}>
        <select className="select" aria-label="Project" value={projectId} onChange={(e) => reset(() => setProjectId(e.target.value))}>{me?.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select>
        <select className="select" aria-label="View" value={view} onChange={(e) => reset(() => setView(e.target.value))}>
          <option value="live">Live permits</option><option value="awaiting">Awaiting review</option><option value="mine">My applications</option><option value="closed">Closed, expired, cancelled</option><option value="all">All permits</option>
        </select>
        <select className="select" aria-label="Permit type" value={permitType} onChange={(e) => reset(() => setPermitType(e.target.value))}><option value="">All types</option>{PTW_TYPES.map((t) => <option key={t} value={t}>{PTW_TYPE_DEFS[t].label}</option>)}</select>
        <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); reset(() => setQuery(q)); }}><input className="input" placeholder="Search ref, work, location, contractor" aria-label="Search permits" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn" type="submit" aria-label="Search permits"><Icon name="search" /></button></form>
      </div>
      {error && <ErrorNotice error={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data && !data.items.length && <div className="panel"><Empty title="No permits in this view" action={can('permit.apply') ? <Link className="btn btn-primary" to="/app/permits/new">Apply for a permit</Link> : undefined}>Drafts are visible only to the applicant until they are submitted.</Empty></div>}
      {data && data.items.length > 0 && (
        <div className="panel">
          <div className="table-wrap hide-mobile"><table className="data">
            <thead><tr><th>Permit</th><th>Work</th><th>Valid</th><th>Applicant</th><th>Status</th></tr></thead>
            <tbody>{data.items.map((p) => (
              <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/app/permits/${p.id}`)}>
                <td><Link to={`/app/permits/${p.id}`}>{p.ref}</Link><div className="small muted">{p.typeLabel}</div></td>
                <td>{p.workDescription}<div className="small muted">{p.site} · {p.location}{p.contractorName ? ` · ${p.contractorName}` : ''}</div></td>
                <td className="small">{fmtDateTime(p.validFrom)}<div className="muted">to {fmtDateTime(p.validTo)}</div></td>
                <td className="small">{p.applicant}</td>
                <td><PermitStatusChip s={p.status} label={p.statusLabel} /></td>
              </tr>))}</tbody>
          </table></div>
          <div className="card-list show-mobile">{data.items.map((p) => (
            <Link key={p.id} className="m-card" to={`/app/permits/${p.id}`}>
              <div className="row" style={{ gap: 6 }}><strong>{p.ref}</strong><span className="spacer" /><PermitStatusChip s={p.status} label={p.statusLabel} /></div>
              <span>{p.typeLabel}: {p.workDescription}</span>
              <span className="small muted">{p.site} · {p.location} · until {fmtDateTime(p.validTo)}</span>
            </Link>))}</div>
          <div className="panel-body"><Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /></div>
        </div>)}
    </>
  );
}

/* ================================================================ application form */

interface Form {
  projectId: string; siteId: string; permitType: PtwType; workDescription: string; location: string; contractorName: string; crew: string; equipment: string;
  emergencyArrangements: string; validFrom: string; validTo: string; gasTestRequired: boolean; details: Record<string, string>; isolations: Isolation[]; hazardIds: string[];
}
function toBody(f: Form) {
  const def = PTW_TYPE_DEFS[f.permitType];
  const details: Record<string, string | number | string[]> = {};
  for (const d of def.details) {
    const v = (f.details[d.key] ?? '').trim();
    if (!v) continue;
    details[d.key] = d.kind === 'number' ? Number(v) : d.kind === 'list' ? v.split(',').map((x) => x.trim()).filter(Boolean) : v;
  }
  return {
    projectId: f.projectId, siteId: f.siteId, permitType: f.permitType, workDescription: f.workDescription, location: f.location, contractorName: f.contractorName,
    crew: f.crew.split(',').map((x) => x.trim()).filter(Boolean), equipment: f.equipment, emergencyArrangements: f.emergencyArrangements,
    validFrom: fromLocal(f.validFrom), validTo: fromLocal(f.validTo), gasTestRequired: f.gasTestRequired, details, isolations: def.needsIsolations ? f.isolations : [], hazardIds: f.hazardIds,
  };
}

export function PermitForm({ id }: { id?: string }) {
  const { me } = useAuth();
  const { search } = useLocation();
  const toast = useToast();
  const meta = useAsync(() => api<Meta>('/permits/meta'), []);
  const existing = useAsync(() => (id ? api<PermitView>(`/permits/${id}`) : Promise.resolve(null)), [id]);
  const start = new Date(Math.ceil(Date.now() / 1_800_000) * 1_800_000);
  const [f, setF] = useState<Form>({
    projectId: search.get('projectId') ?? me?.projects[0]?.id ?? '', siteId: '', permitType: (search.get('type') as PtwType) || 'hot_work', workDescription: '', location: '', contractorName: '', crew: '', equipment: '',
    emergencyArrangements: '', validFrom: toLocal(start.toISOString()), validTo: toLocal(new Date(start.getTime() + 8 * 3_600_000).toISOString()), gasTestRequired: false, details: {}, isolations: [], hazardIds: [],
  });
  useEffect(() => {
    const p = existing.data; if (!p) return;
    setF({ projectId: p.project.id, siteId: p.site.id, permitType: p.permitType, workDescription: p.workDescription, location: p.location, contractorName: p.contractorName, crew: p.crew.join(', '),
      equipment: p.equipment, emergencyArrangements: p.emergencyArrangements, validFrom: toLocal(p.validFrom), validTo: toLocal(p.validTo), gasTestRequired: p.gasTestRequired,
      details: Object.fromEntries(Object.entries(p.details).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)])), isolations: p.isolations, hazardIds: p.hazardIds });
  }, [existing.data]);
  const [errs, setErrs] = useState<Record<string, string>>({}); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const project = me?.projects.find((p) => p.id === f.projectId);
  useEffect(() => { if (!f.siteId && project?.sites[0]) setF((x) => ({ ...x, siteId: project.sites[0]!.id })); }, [f.projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (meta.loading || existing.loading) return <Loading />;
  if (meta.error || existing.error) return <ErrorNotice error={meta.error ?? existing.error} />;
  const def = PTW_TYPE_DEFS[f.permitType];
  const set = (p: Partial<Form>) => setF({ ...f, ...p });
  const e = (k: string) => errs[k] ?? errs[`permit.${k}`];
  const save = async () => {
    setBusy(true); setErr(null); setErrs({});
    try {
      const body = toBody(f);
      const r = id ? await api<PermitView>(`/permits/${id}`, { method: 'PATCH', body: { version: existing.data!.version, permit: body } }) : await api<PermitView>('/permits', { method: 'POST', body });
      toast(id ? 'Draft saved' : `${r.ref} created as a draft`, 'ok');
      navigate(`/app/permits/${r.id}`);
    } catch (x) { setErr(x); setErrs(fieldErrors(x)); } finally { setBusy(false); }
  };
  const hours = (new Date(f.validTo).getTime() - new Date(f.validFrom).getTime()) / 3_600_000;
  return (
    <>
      <PageHead title={id ? `Edit ${existing.data?.ref}` : 'Apply for a permit to work'} sub="Save as a draft, then submit it. A permit issuer who is not you reviews the work area, confirms the checks and authorises it." />
      <div className="panel" style={{ maxWidth: 960 }}><div className="panel-body stack">
        <fieldset className="ptw-types"><legend className="label">Permit type *</legend>
          <div className="ptw-type-grid">{PTW_TYPES.map((t) => (
            <label key={t} className={`ptw-type ${f.permitType === t ? 'sel' : ''}`}>
              <input type="radio" name="ptw-type" value={t} checked={f.permitType === t} onChange={() => set({ permitType: t, details: {} })} disabled={!!id} />
              <strong>{PTW_TYPE_DEFS[t].label}</strong><span className="small muted">{PTW_TYPE_DEFS[t].description}</span>
            </label>))}</div>
        </fieldset>
        <div className="form-grid">
          <Field label="Project *" htmlFor="pt-proj"><select id="pt-proj" className="select" value={f.projectId} disabled={!!id} onChange={(x) => set({ projectId: x.target.value, siteId: '' })}>{me?.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
          <Field label="Site *" htmlFor="pt-site" error={e('siteId')}><select id="pt-site" className="select" value={f.siteId} onChange={(x) => set({ siteId: x.target.value })}>{project?.sites.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}</select></Field>
          <div style={{ gridColumn: '1 / -1' }}><Field label="Work to be done *" htmlFor="pt-work" error={e('workDescription')}><textarea id="pt-work" className="textarea" rows={3} value={f.workDescription} onChange={(x) => set({ workDescription: x.target.value })} maxLength={1000} /></Field></div>
          <Field label="Exact location *" htmlFor="pt-loc" hint="Level, grid, room or equipment tag" error={e('location')}><input id="pt-loc" className="input" value={f.location} onChange={(x) => set({ location: x.target.value })} maxLength={200} /></Field>
          <Field label="Contractor" htmlFor="pt-con"><input id="pt-con" className="input" value={f.contractorName} onChange={(x) => set({ contractorName: x.target.value })} maxLength={160} /></Field>
          <Field label="Valid from *" htmlFor="pt-from" error={e('validFrom')}><input id="pt-from" type="datetime-local" className="input" value={f.validFrom} onChange={(x) => set({ validFrom: x.target.value })} /></Field>
          <Field label="Valid to *" htmlFor="pt-to" hint={`${Number.isFinite(hours) ? hours.toFixed(1) : '–'} h · at most ${meta.data!.maxHours} h per permit`} error={e('validTo')}><input id="pt-to" type="datetime-local" className="input" value={f.validTo} onChange={(x) => set({ validTo: x.target.value })} /></Field>
          <Field label="Crew" htmlFor="pt-crew" hint="Names, separated with commas"><input id="pt-crew" className="input" value={f.crew} onChange={(x) => set({ crew: x.target.value })} /></Field>
          <Field label="Plant and equipment" htmlFor="pt-eq"><input id="pt-eq" className="input" value={f.equipment} onChange={(x) => set({ equipment: x.target.value })} maxLength={500} /></Field>
          {def.details.map((d) => (
            <Field key={d.key} label={`${d.label}${d.required ? ' *' : ''}`} htmlFor={`pt-d-${d.key}`} hint={d.kind === 'list' ? 'Separate with commas' : d.hint}>
              <input id={`pt-d-${d.key}`} className="input" inputMode={d.kind === 'number' ? 'decimal' : undefined} type={d.kind === 'number' ? 'number' : 'text'} min={d.kind === 'number' ? 0 : undefined} step="any"
                value={f.details[d.key] ?? ''} onChange={(x) => set({ details: { ...f.details, [d.key]: x.target.value } })} />
            </Field>))}
          <div style={{ gridColumn: '1 / -1' }}><Field label="Emergency arrangements" htmlFor="pt-em" hint="Who to call, nearest first aid, rescue arrangements"><textarea id="pt-em" className="textarea" rows={2} value={f.emergencyArrangements} onChange={(x) => set({ emergencyArrangements: x.target.value })} maxLength={1000} /></Field></div>
        </div>
        {def.gasTest === 'always'
          ? <div className="notice"><strong>Gas test required.</strong> A passing gas test taken after submission is needed before authorisation.</div>
          : <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={f.gasTestRequired} onChange={(x) => set({ gasTestRequired: x.target.checked })} />A gas test is required before work starts</label>}
        {def.needsIsolations && (
          <section className="stack" aria-label="Isolation points">
            <strong>Isolation points *</strong>
            {f.isolations.map((iso, k) => (
              <div key={k} className="iso-row">
                <input className="input" aria-label={`Isolation ${k + 1} point`} placeholder="Point (e.g. DB-3A incomer)" value={iso.point} onChange={(x) => set({ isolations: f.isolations.map((y, j) => (j === k ? { ...y, point: x.target.value } : y)) })} />
                <input className="input" aria-label={`Isolation ${k + 1} method`} placeholder="Method" value={iso.method} onChange={(x) => set({ isolations: f.isolations.map((y, j) => (j === k ? { ...y, method: x.target.value } : y)) })} />
                <input className="input" aria-label={`Isolation ${k + 1} lock number`} placeholder="Lock no. *" value={iso.lockNo} onChange={(x) => set({ isolations: f.isolations.map((y, j) => (j === k ? { ...y, lockNo: x.target.value } : y)) })} />
                <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove isolation ${k + 1}`} onClick={() => set({ isolations: f.isolations.filter((_, j) => j !== k) })}><Icon name="x" /></button>
              </div>))}
            <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => set({ isolations: [...f.isolations, { point: '', method: '', lockNo: '', isolatedBy: '', verifiedBy: '' }] })}><Icon name="plus" />Add isolation point</button>
          </section>)}
        <details className="small"><summary>Checks that will be confirmed for {def.label.toLowerCase()}</summary><ul>{def.checks.map((c) => <li key={c.id}>{c.text}{c.critical ? ' (critical)' : ''}</li>)}</ul><p className="muted">{meta.data!.notice}</p></details>
        {err != null && !Object.keys(errs).length && <ErrorNotice error={err} />}
        {Object.keys(errs).length > 0 && <div className="notice error" role="alert">Some fields need attention.</div>}
        <div className="row" style={{ gap: 8 }}><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button><button className="btn btn-ghost" onClick={() => history.back()}>Cancel</button></div>
      </div></div>
    </>
  );
}

/* ================================================================ permit page */

const ACTION_TEXT: Record<string, { label: string; note?: 'required' | 'optional'; danger?: boolean; help?: string }> = {
  submit: { label: 'Submit for review' },
  start_safety_review: { label: 'Start safety review', help: 'You will inspect the work area, confirm the checks and record any gas test.' },
  authorise: { label: 'Authorise', note: 'optional', help: 'Authorise only after you have seen the work area and the controls are in place.' },
  reject: { label: 'Reject', note: 'required', danger: true },
  activate: { label: 'Accept and start work', help: 'You confirm the crew has been briefed and the precautions on this permit are in place.' },
  suspend: { label: 'Suspend (stop work)', note: 'required', danger: true, help: 'Work stops immediately. An issuer must revalidate before it restarts.' },
  revalidate: { label: 'Revalidate', note: 'required', help: 'Confirm the reason for the suspension has been dealt with.' },
  complete: { label: 'Hand back (work complete)', note: 'required', help: 'Describe how the work area was left.' },
  close: { label: 'Close permit', note: 'required', help: 'Record your close-out inspection of the work area.' },
  cancel: { label: 'Cancel permit', note: 'required', danger: true },
};

function GasTestDialog({ p, onClose, onDone }: { p: PermitView; onClose: () => void; onDone: () => void }) {
  const [g, setG] = useState({ takenAt: toLocal(new Date().toISOString()), instrument: '', oxygenPct: '', lelPct: '', h2sPpm: '', coPpm: '', other: '', withinLimits: '', note: '' });
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await api(`/permits/${p.id}/gas-tests`, { method: 'POST', body: { version: p.version, test: { takenAt: fromLocal(g.takenAt), instrument: g.instrument, oxygenPct: num(g.oxygenPct), lelPct: num(g.lelPct), h2sPpm: num(g.h2sPpm), coPpm: num(g.coPpm), other: g.other, withinLimits: g.withinLimits === 'yes', note: g.note } } });
      onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Record a gas test" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !g.instrument || !g.withinLimits} onClick={save}>Record</button></>}>
      <div className="form-grid">
        <Field label="Taken at *" htmlFor="gt-at"><input id="gt-at" type="datetime-local" className="input" value={g.takenAt} onChange={(e) => setG({ ...g, takenAt: e.target.value })} /></Field>
        <Field label="Instrument and calibration *" htmlFor="gt-ins"><input id="gt-ins" className="input" value={g.instrument} onChange={(e) => setG({ ...g, instrument: e.target.value })} /></Field>
        <Field label="Oxygen (%)" htmlFor="gt-o2"><input id="gt-o2" type="number" step="0.1" className="input" value={g.oxygenPct} onChange={(e) => setG({ ...g, oxygenPct: e.target.value })} /></Field>
        <Field label="Flammable (% LEL)" htmlFor="gt-lel"><input id="gt-lel" type="number" step="0.1" className="input" value={g.lelPct} onChange={(e) => setG({ ...g, lelPct: e.target.value })} /></Field>
        <Field label="H₂S (ppm)" htmlFor="gt-h2s"><input id="gt-h2s" type="number" step="0.1" className="input" value={g.h2sPpm} onChange={(e) => setG({ ...g, h2sPpm: e.target.value })} /></Field>
        <Field label="CO (ppm)" htmlFor="gt-co"><input id="gt-co" type="number" step="0.1" className="input" value={g.coPpm} onChange={(e) => setG({ ...g, coPpm: e.target.value })} /></Field>
      </div>
      <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0 }}><legend className="label">Are all readings within this site's acceptance limits? *</legend>
        <label className="row small" style={{ gap: 8 }}><input type="radio" name="gt-ok" checked={g.withinLimits === 'yes'} onChange={() => setG({ ...g, withinLimits: 'yes' })} />Yes, within the site limits</label>
        <label className="row small" style={{ gap: 8 }}><input type="radio" name="gt-ok" checked={g.withinLimits === 'no'} onChange={() => setG({ ...g, withinLimits: 'no' })} />No — not safe to enter or work</label>
      </fieldset>
      <Field label="Note" htmlFor="gt-note"><input id="gt-note" className="input" value={g.note} onChange={(e) => setG({ ...g, note: e.target.value })} /></Field>
      {err != null && <ErrorNotice error={err} />}
    </Dialog>
  );
}

export function PermitDetail({ id }: { id: string }) {
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api<PermitView>(`/permits/${id}`), [id]);
  const [act, setAct] = useState<string | null>(null); const [note, setNote] = useState(''); const [isoRemoved, setIsoRemoved] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [gasOpen, setGasOpen] = useState(false);
  const [checks, setChecks] = useState<Record<string, boolean> | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNotice error={error} retry={reload} />;
  const p = data!; const P = p.permissions;
  const close = () => { setAct(null); setNote(''); setErr(null); setIsoRemoved(false); };
  const run = async (action: string) => {
    setBusy(true); setErr(null);
    try { await api(`/permits/${p.id}/transition`, { method: 'POST', body: { action, version: p.version, note, isolationsRemoved: p.isolations.length ? isoRemoved : undefined } }); toast(`${ACTION_TEXT[action]!.label}: done`, 'ok'); close(); reload(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const saveChecks = async () => {
    setBusy(true);
    try { await api(`/permits/${p.id}/checks`, { method: 'POST', body: { version: p.version, checks: p.checks.map((c) => ({ id: c.id, confirmed: checks?.[c.id] ?? c.confirmed, note: c.note })) } }); toast('Checks saved', 'ok'); setChecks(null); reload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not save', 'error'); } finally { setBusy(false); }
  };
  const copy = async () => { try { const r = await api<PermitView>(`/permits/${p.id}/copy`, { method: 'POST' }); toast(`${r.ref} created as a draft`, 'ok'); navigate(`/app/permits/${r.id}/edit`); } catch (e) { toast(e instanceof Error ? e.message : 'Could not copy', 'error'); } };
  const buttons = (['submit', 'start_safety_review', 'authorise', 'activate', 'revalidate', 'complete', 'close'] as const).filter((a) => P[{ submit: 'submit', start_safety_review: 'startReview', authorise: 'authorise', activate: 'activate', revalidate: 'revalidate', complete: 'complete', close: 'close' }[a] as keyof typeof P]);
  const blocking = p.status === 'draft' ? p.issues.application : p.status === 'safety_review' ? p.issues.authorisation : p.status === 'suspended' ? p.issues.revalidation : [];
  const dirty = checks && Object.keys(checks).length > 0;
  return (
    <>
      <PageHead title={`${p.ref} · ${p.typeLabel}`} sub={<>{p.project.code} · {p.site.name} · {p.location}</>}
        actions={<>
          {P.edit && <Link className="btn" to={`/app/permits/${p.id}/edit`}><Icon name="edit" />Edit draft</Link>}
          {buttons.map((a) => <button key={a} className="btn btn-primary" disabled={busy || ((a === 'authorise' || a === 'submit' || a === 'revalidate') && blocking.length > 0) || !!dirty} title={blocking.length ? 'Resolve the items listed first' : dirty ? 'Save the checks first' : undefined} onClick={() => (a === 'submit' ? run('submit') : setAct(a))}>{ACTION_TEXT[a]!.label}</button>)}
          {P.suspend && <button className="btn btn-danger" onClick={() => setAct('suspend')}>Suspend (stop work)</button>}
          {P.reject && <button className="btn" onClick={() => setAct('reject')}>Reject</button>}
        </>} />
      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <PermitStatusChip s={p.status} label={p.statusLabel} />
        <span className="small">Valid {fmtDateTime(p.validFrom)} → {fmtDateTime(p.validTo)}</span>
        {p.liveNow && <span className="small text-ok"><Icon name="check" size={14} /> Work authorised now</span>}
      </div>
      {p.status === 'suspended' && <div className="notice error" role="status"><strong>Work suspended.</strong> It must not restart until an issuer revalidates this permit.</div>}
      {p.status === 'expired' && <div className="notice error" role="status"><strong>Expired.</strong> The validity ended. Work must not continue on this permit — copy it as a new application.</div>}
      {p.simops.length > 0 && (
        <div className="notice warn" role="status"><strong>Other permits on this site in the same period:</strong>
          <ul>{p.simops.map((s) => <li key={s.id}><Link to={`/app/permits/${s.id}`}>{s.ref}</Link> {s.typeLabel} — {s.location} ({s.statusLabel}, {fmtDateTime(s.validFrom)}–{fmtDateTime(s.validTo)})</li>)}</ul>
          Check that the work does not conflict (simultaneous operations).</div>)}
      {blocking.length > 0 && (P.submit || P.authorise || P.revalidate || P.edit || P.confirmChecks) && (
        <div className="notice warn" role="status"><strong>{p.status === 'draft' ? 'Before submitting:' : p.status === 'suspended' ? 'Before revalidating:' : 'Before authorising:'}</strong><ul>{blocking.map((i) => <li key={i.code}>{i.message}</li>)}</ul></div>)}

      <div className="detail-grid">
        <div className="stack">
          <section className="panel"><div className="panel-head"><h3>Work</h3></div><div className="panel-body stack" style={{ gap: 10 }}>
            <p className="prose-block">{p.workDescription}</p>
            <dl className="kv small">
              <dt>Applicant</dt><dd>{p.applicant.name}</dd>
              {p.contractorName && <><dt>Contractor</dt><dd>{p.contractorName}</dd></>}
              {p.crew.length > 0 && <><dt>Crew</dt><dd>{p.crew.join(', ')}</dd></>}
              {p.equipment && <><dt>Plant and equipment</dt><dd>{p.equipment}</dd></>}
              {PTW_TYPE_DEFS[p.permitType].details.map((d) => <div key={d.key} style={{ display: 'contents' }}><dt>{d.label}</dt><dd>{Array.isArray(p.details[d.key]) ? (p.details[d.key] as string[]).join(', ') : String(p.details[d.key] ?? '—')}</dd></div>)}
              {p.emergencyArrangements && <><dt>Emergency arrangements</dt><dd>{p.emergencyArrangements}</dd></>}
            </dl>
            {p.isolations.length > 0 && <><strong className="small">Isolation points</strong><div className="table-wrap"><table className="data"><thead><tr><th>Point</th><th>Method</th><th>Lock no.</th></tr></thead><tbody>{p.isolations.map((i, k) => <tr key={k}><td>{i.point}</td><td>{i.method || '—'}</td><td>{i.lockNo}</td></tr>)}</tbody></table></div></>}
          </div></section>

          <section className="panel"><div className="panel-head"><h3>Checks</h3><span className="spacer" />{P.confirmChecks && <button className="btn btn-sm btn-primary" disabled={busy || !dirty} onClick={saveChecks}>Save checks</button>}</div>
            <ul className="ptw-checks">{p.checks.map((c) => {
              const v = checks?.[c.id] ?? c.confirmed;
              return (
                <li key={c.id}>
                  <label className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <input type="checkbox" checked={v} disabled={!P.confirmChecks} onChange={(e) => setChecks({ ...(checks ?? {}), [c.id]: e.target.checked })} />
                    <span>{c.text}{c.critical && <span className="risk risk-high" style={{ marginLeft: 6 }}>Critical</span>}
                      {c.confirmed && c.byName && <span className="small muted" style={{ display: 'block' }}>Confirmed by {c.byName}{c.at ? `, ${fmtDateTime(c.at)}` : ''}</span>}</span>
                  </label>
                </li>);
            })}</ul>
          </section>

          {p.gasTestNeeded && (
            <section className="panel"><div className="panel-head"><h3>Gas tests</h3><span className="spacer" />{P.gasTest && <button className="btn btn-sm" onClick={() => setGasOpen(true)}><Icon name="plus" />Record gas test</button>}</div>
              {!p.gasTests.length && <p className="panel-body small muted">No gas test recorded yet.</p>}
              {p.gasTests.length > 0 && <div className="table-wrap"><table className="data">
                <thead><tr><th>Taken</th><th>O₂ %</th><th>LEL %</th><th>H₂S ppm</th><th>CO ppm</th><th>Result</th><th>By</th></tr></thead>
                <tbody>{p.gasTests.map((g) => <tr key={g.id}><td className="small">{fmtDateTime(g.takenAt)}<div className="muted">{g.instrument}</div></td><td>{g.oxygenPct ?? '—'}</td><td>{g.lelPct ?? '—'}</td><td>{g.h2sPpm ?? '—'}</td><td>{g.coPpm ?? '—'}</td>
                  <td>{g.withinLimits ? <span className="risk risk-low">Within site limits</span> : <span className="risk risk-critical">Not within limits</span>}</td><td className="small">{g.byName}</td></tr>)}</tbody>
              </table></div>}
            </section>)}

          <section className="panel"><div className="panel-head"><h3>History</h3></div>
            <ol className="timeline panel-body">{p.history.map((h) => <li key={h.id}><strong>{h.toLabel}</strong> <span className="small muted">· {h.actor} · {fmtDateTime(h.at)}</span>{h.note && <div className="small">{h.note}</div>}</li>)}</ol>
          </section>
        </div>
        <aside className="stack">
          <section className="panel"><div className="panel-head"><h3>Sign-offs</h3></div><dl className="kv panel-body small">
            <dt>Applicant</dt><dd>{p.applicant.name}</dd>
            <dt>Safety review</dt><dd>{p.reviewedBy?.name ?? '—'}</dd>
            <dt>Authorised</dt><dd>{p.authorisedBy ? `${p.authorisedBy.name}, ${fmtDateTime(p.authorisedAt)}` : '—'}</dd>
            <dt>Accepted on site</dt><dd>{p.acceptedBy?.name ?? '—'}</dd>
            <dt>Handed back</dt><dd>{p.completedBy ? <>{p.completedBy.name}<div className="muted">{p.completionNote}</div></> : '—'}</dd>
            <dt>Closed</dt><dd>{p.closedBy ? <>{p.closedBy.name}<div className="muted">{p.closureNote}</div></> : '—'}</dd>
            {p.decisionNote && <><dt>Decision note</dt><dd>{p.decisionNote}</dd></>}
          </dl></section>
          {p.hazards.length > 0 && <section className="panel"><div className="panel-head"><h3>Linked hazards</h3></div><ul className="panel-body small">{p.hazards.map((h) => <li key={h.id}><Link to={`/app/hazards/${h.id}`}>{h.ref}</Link> {h.activity}</li>)}</ul></section>}
          <RecordFiles recordType="permit" recordId={p.id} projectId={p.project.id} siteId={p.site.id} canAttach={!['closed', 'cancelled', 'rejected', 'expired'].includes(p.status)} />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {P.copy && <button className="btn btn-ghost" onClick={copy}><Icon name="copy" />Copy as new application</button>}
            {P.cancel && <button className="btn btn-ghost" onClick={() => setAct('cancel')}>Cancel permit</button>}
          </div>
        </aside>
      </div>

      {act && act !== 'submit' && (
        <Dialog title={ACTION_TEXT[act]!.label} onClose={close}
          footer={<><button className="btn" onClick={close}>Back</button><button className={`btn ${ACTION_TEXT[act]!.danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (ACTION_TEXT[act]!.note === 'required' && note.trim().length < (act === 'complete' || act === 'close' ? 5 : 1)) || (act === 'complete' && p.isolations.length > 0 && !isoRemoved)} onClick={() => run(act)}>{ACTION_TEXT[act]!.label}</button></>}>
          {ACTION_TEXT[act]!.help && <p className="small">{ACTION_TEXT[act]!.help}</p>}
          {ACTION_TEXT[act]!.note && <Field label={ACTION_TEXT[act]!.note === 'required' ? 'Reason / note *' : 'Note'} htmlFor="pt-note"><textarea id="pt-note" className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>}
          {act === 'complete' && p.isolations.length > 0 && <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={isoRemoved} onChange={(e) => setIsoRemoved(e.target.checked)} />Every isolation has been removed or formally handed over *</label>}
          {err != null && <ErrorNotice error={err} />}
        </Dialog>)}
      {gasOpen && <GasTestDialog p={p} onClose={() => setGasOpen(false)} onDone={() => { setGasOpen(false); toast('Gas test recorded', 'ok'); reload(); }} />}
    </>
  );
}
