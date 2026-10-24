import { useEffect, useState } from 'react';
import { OBSERVATION_TYPE_LABELS, OBSERVATION_TYPES, type ObservationStatus, type RiskBand, type ObservationType } from '@forgehse/shared';
import { api, qs } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Link, navigate, setQuery, useLocation } from '../lib/router';
import { fmtDate } from '../lib/format';
import { PageHead } from '../components/AppShell';
import { Loading, ErrorNotice, Empty, RiskChip, StatusBadge, Pagination, Icon } from '../components/ui';

export interface ObservationSummary {
  id: string; refNo: string; type: ObservationType; hazardCategory: string; location: string; description: string;
  riskScore: number; riskBand: RiskBand; status: ObservationStatus; overdue: boolean; observedAt: string; dueDate: string | null;
  assigneeName: string | null; projectCode: string; siteName: string; reportedByName: string;
}

const STATUS_FILTERS: [string, string][] = [['', 'All'], ['active', 'Open & in progress'], ['open', 'Not assigned'], ['overdue', 'Overdue'], ['action_submitted', 'Awaiting verification'], ['closed', 'Closed']];

export function ObservationList() {
  const { me, can } = useAuth();
  const { search } = useLocation();
  const f = Object.fromEntries(search.entries()) as Record<string, string>;
  const page = Number(f.page ?? 1);
  const [q, setQ] = useState(f.q ?? '');
  useEffect(() => { setQ(f.q ?? ''); }, [f.q]);

  const { data, error, loading, reload } = useAsync(
    () => api<{ items: ObservationSummary[]; total: number; page: number; pageSize: number }>('/observations', { query: { ...f, pageSize: 25 } }),
    [search.toString()],
  );
  const project = me?.projects.find((p) => p.id === f.projectId);
  const exportQuery = { ...f }; delete exportQuery.page;
  const filtered = Object.keys(exportQuery).length > 0;

  return (
    <>
      <PageHead
        title="Observations"
        sub="Unsafe acts, unsafe conditions and near misses reported across your projects."
        actions={<>
          {can('report.export') && <>
            <a className="btn btn-sm" href={`/api/observations/export${qs({ ...exportQuery, format: 'pdf' })}`}><Icon name="download" />PDF register</a>
            <a className="btn btn-sm" href={`/api/observations/export${qs({ ...exportQuery, format: 'xlsx' })}`}><Icon name="download" />Excel</a>
          </>}
          {can('observation.create') && <Link to="/app/report" className="btn btn-primary"><Icon name="plus" />Report observation</Link>}
        </>}
      />

      <section className="panel">
        <div className="panel-head" style={{ flexWrap: 'wrap' }}>
          <form className="row" style={{ flex: '1 1 260px' }} onSubmit={(e) => { e.preventDefault(); setQuery({ q: q || undefined, page: undefined }); }}>
            <label className="sr-only" htmlFor="obs-q">Search</label>
            <input id="obs-q" className="input" placeholder="Search reference, description or location" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 340 }} />
            <button className="btn"><Icon name="search" />Search</button>
          </form>
          <label className="sr-only" htmlFor="f-project">Project</label>
          <select id="f-project" className="select" style={{ width: 'auto' }} value={f.projectId ?? ''} onChange={(e) => setQuery({ projectId: e.target.value || undefined, siteId: undefined, page: undefined })}>
            <option value="">All projects</option>
            {me?.projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
          </select>
          {project && (<>
            <label className="sr-only" htmlFor="f-site">Site</label>
            <select id="f-site" className="select" style={{ width: 'auto' }} value={f.siteId ?? ''} onChange={(e) => setQuery({ siteId: e.target.value || undefined, page: undefined })}>
              <option value="">All sites</option>
              {project.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </>)}
          <label className="sr-only" htmlFor="f-type">Type</label>
          <select id="f-type" className="select" style={{ width: 'auto' }} value={f.type ?? ''} onChange={(e) => setQuery({ type: e.target.value || undefined, page: undefined })}>
            <option value="">All types</option>
            {OBSERVATION_TYPES.map((t) => <option key={t} value={t}>{OBSERVATION_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        <div className="panel-head" style={{ borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
          <div className="segmented" role="group" aria-label="Status">
            {STATUS_FILTERS.map(([v, l]) => <button key={v} aria-pressed={(f.status ?? '') === v} onClick={() => setQuery({ status: v || undefined, page: undefined })}>{l}</button>)}
          </div>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={f.assignedToMe === 'true'} onChange={(e) => setQuery({ assignedToMe: e.target.checked ? 'true' : undefined, page: undefined })} />
            Assigned to me
          </label>
          {(f.likelihood || f.severity) && <button className="btn btn-sm" onClick={() => setQuery({ likelihood: undefined, severity: undefined })}>Risk cell L{f.likelihood} × S{f.severity}<Icon name="x" size={14} /></button>}
          <span className="spacer" />
          {filtered && <button className="btn btn-sm btn-ghost" onClick={() => navigate('/app/observations', { replace: true })}>Clear filters</button>}
        </div>

        {error && <div className="panel-body"><ErrorNotice error={error} retry={reload} /></div>}
        {loading && !data && <Loading />}
        {data && data.items.length === 0 && (
          <Empty title={filtered ? 'No observations match these filters' : 'No observations yet'}
            action={!filtered && can('observation.create') ? <Link to="/app/report" className="btn btn-primary">Report the first observation</Link> : undefined}>
            {filtered ? 'Try widening the filters or clearing the search.' : 'Reported hazards appear here as soon as they are submitted, from the web or the field app.'}
          </Empty>
        )}
        {data && data.items.length > 0 && (
          <>
            <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
              <table className="data">
                <thead><tr><th>Ref</th><th>Observed</th><th>Project / site</th><th>Type</th><th>Hazard and description</th><th>Risk</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>
                  {data.items.map((o) => (
                    <tr key={o.id} className="clickable" onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) navigate(`/app/observations/${o.id}`); }}>
                      <td><Link className="ref" to={`/app/observations/${o.id}`}>{o.refNo}</Link></td>
                      <td className="num">{fmtDate(o.observedAt)}</td>
                      <td>{o.projectCode}<div className="small muted">{o.siteName}</div></td>
                      <td>{OBSERVATION_TYPE_LABELS[o.type]}</td>
                      <td className="wrap"><strong style={{ fontWeight: 500 }}>{o.hazardCategory}</strong>, {o.location}<div className="small muted">{o.description.length > 140 ? o.description.slice(0, 140) + '…' : o.description}</div></td>
                      <td><RiskChip band={o.riskBand} score={o.riskScore} /></td>
                      <td>{o.assigneeName ?? <span className="muted">Unassigned</span>}</td>
                      <td className="num">{fmtDate(o.dueDate)}</td>
                      <td><StatusBadge status={o.status} overdue={o.overdue} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQuery({ page: String(p) })} />
          </>
        )}
      </section>
    </>
  );
}
