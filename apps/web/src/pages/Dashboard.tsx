import { useState } from 'react';
import type { RiskBand, ObservationStatus } from '@forgehse/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Link } from '../lib/router';
import { fmtDate, todayISO } from '../lib/format';
import { PageHead } from '../components/AppShell';
import { Loading, ErrorNotice, Empty, RiskChip, StatusBadge } from '../components/ui';
import { RiskMatrix, TrendChart, BarList, RiskHistogram } from '../components/charts';
import { Blueprint, HseIcon } from '../components/graphics';
import { LightField, CountUp, Reveal } from '../components/fx';
import { Icon } from '../components/ui';
import { navigate } from '../lib/router';

interface DashboardData {
  period: { from: string; to: string; timezone: string };
  kpis: Record<string, number | null>;
  trend: { week: string; reported: number; closed: number }[];
  byHazard: { category: string; count: number }[];
  bySite: { id: string; projectCode: string; siteCode: string; siteName: string; reported: number; open: number; overdue: number }[];
  overdueByAssignee: { id: string; name: string; overdue: number; oldestDue: string }[];
  highRiskOpen: { id: string; refNo: string; hazardCategory: string; location: string; riskBand: RiskBand; riskScore: number; status: ObservationStatus; dueDate: string | null }[];
  openRiskMatrix: { size: number; bands: { band: RiskBand; minScore: number }[]; cells: { likelihood: number; severity: number; count: number }[] };
  modules: Record<string, { available: boolean }>;
}

const PERIODS = [{ days: 30, label: '30 days' }, { days: 90, label: '90 days' }, { days: 365, label: '12 months' }];
const MODULE_LABELS: Record<string, string> = { incidents: 'Incidents', permits: 'Permits to work', inspections: 'Inspections', riskAssessments: 'Risk assessments', training: 'Training', manHours: 'Man-hours', environmental: 'Environmental' };

export function Dashboard() {
  const { me, can } = useAuth();
  const [ask, setAsk] = useState('');
  const [projectId, setProjectId] = useState('');
  const [days, setDays] = useState(90);
  const from = todayISO(-(days - 1));
  const { data, error, loading, reload } = useAsync(() => api<DashboardData>('/dashboard', { query: { projectId, from, to: todayISO() } }), [projectId, days]);
  const listLink = (extra: Record<string, string>) => '/app/observations?' + new URLSearchParams({ ...(projectId ? { projectId } : {}), ...extra }).toString();

  const k = data?.kpis ?? {};
  const firstName = me?.user.fullName.split(' ')[0] ?? '';
  return (
    <>
      <section className="hero-band" aria-label="Command centre">
        <Blueprint seed={11} nodes={18} />
        <span className="eyebrow">BRITTO'S FORGEHSE · HSE intelligence</span>
        <h1>{firstName ? `Welcome back, ${firstName}.` : 'Command centre'}</h1>
        <p>Live picture of observations, open risk and overdue actions across {projectId ? (me?.projects.find((p) => p.id === projectId)?.name ?? 'this project') : 'all your authorised projects'}. Every figure opens the records behind it.</p>
        <div className="hse-pillars" aria-hidden>
          <span><HseIcon name="first_aid" size={18} />Health</span><span><HseIcon name="hard_hat" size={18} />Safety</span><span><HseIcon name="leaf" size={18} />Environment</span>
        </div>
      </section>
      <PageHead
        title="Command centre"
        sub={data ? `${fmtDate(data.period.from)} to ${fmtDate(data.period.to)}, ${data.period.timezone}` : undefined}
        actions={<>
          <label className="sr-only" htmlFor="dash-project">Project</label>
          <select id="dash-project" className="select" style={{ width: 'auto' }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All my projects</option>
            {me?.projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
          </select>
          <div className="segmented" role="group" aria-label="Period">
            {PERIODS.map((p) => <button key={p.days} aria-pressed={days === p.days} onClick={() => setDays(p.days)}>{p.label}</button>)}
          </div>
        </>}
      />
      {can('ai.use') && (
        <section className="ai-launch has-lightfield" aria-label="AI Studio">
          <LightField />
          <div className="copy">
            <span className="small" style={{ color: '#7dd3fc', fontWeight: 600, letterSpacing: '0.06em' }}><Icon name="spark" size={13} /> AI STUDIO</span>
            <h2 style={{ marginTop: 6 }}>Ask about your site, or create in one line.</h2>
            <p>Answers come from your live records with references. Checklists, toolbox talks, posters and flowcharts are drafted for your review.</p>
            <div className="quick">
              <Link className="chip-btn" to="/app/studio?mode=ask&q=Summarise%20our%20HSE%20observations%20for%20the%20last%2030%20days&send=1"><Icon name="chart" size={14} />30-day summary</Link>
              <Link className="chip-btn" to="/app/studio?mode=checklist"><Icon name="checklist" size={14} />Checklist</Link>
              <Link className="chip-btn" to="/app/studio?mode=document"><Icon name="doc" size={14} />Toolbox talk</Link>
              <Link className="chip-btn" to="/app/studio?mode=poster"><Icon name="image" size={14} />Poster</Link>
              <Link className="chip-btn" to="/app/studio?mode=flowchart"><Icon name="flow" size={14} />Flowchart</Link>
            </div>
          </div>
          <div className="ask">
            <form onSubmit={(e) => { e.preventDefault(); if (ask.trim()) navigate(`/app/studio?mode=ask&q=${encodeURIComponent(ask.trim())}&send=1`); }}>
              <label htmlFor="dash-ask" className="sr-only">Ask AI Studio</label>
              <input id="dash-ask" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. Which sites have the most overdue actions?" />
              <button className="send-btn" aria-label="Ask"><Icon name="send" size={16} /></button>
            </form>
          </div>
        </section>
      )}
      {error && <ErrorNotice error={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          <section className="kpi-strip panel-eng" aria-label="Key indicators">
            <Link className="kpi" to={listLink({ from, to: todayISO() })}><div className="kpi-top"><div className="value"><CountUp value={k.reported as number | null} /></div><span className="hse-ico" aria-hidden><HseIcon name="eye" size={19} /></span></div><span className="label">Reported in period</span><div className="sub">{k.unsafeActs} acts, {k.unsafeConditions} conditions</div></Link>
            <Link className="kpi" to={listLink({ status: 'active' })}><div className="kpi-top"><div className="value"><CountUp value={k.openNow as number | null} /></div><span className="hse-ico" aria-hidden><HseIcon name="warning" size={19} /></span></div><span className="label">Open now</span><div className="sub">{k.unassignedNow} not yet assigned</div></Link>
            <Link className={`kpi ${Number(k.overdueNow) > 0 ? 'alert' : ''}`} to={listLink({ status: 'overdue' })}><div className="kpi-top"><div className="value"><CountUp value={k.overdueNow as number | null} /></div><span className="hse-ico alert" aria-hidden><HseIcon name="heat" size={19} /></span></div><span className="label">Overdue actions</span><div className="sub">Past due date, not submitted</div></Link>
            <Link className="kpi" to={listLink({ status: 'action_submitted' })}><div className="kpi-top"><div className="value"><CountUp value={k.awaitingVerification as number | null} /></div><span className="hse-ico teal" aria-hidden><HseIcon name="shield_check" size={19} /></span></div><span className="label">Awaiting verification</span><div className="sub">Action submitted</div></Link>
            <div className="kpi"><div className="kpi-top"><div className="value"><CountUp value={k.highCriticalOpen as number | null} /></div><span className="hse-ico" aria-hidden><HseIcon name="stop_hand" size={19} /></span></div><span className="label">High or critical, open</span><div className="sub">Current risk rating · see histogram</div></div>
            <div className="kpi"><div className="kpi-top"><div className="value"><CountUp value={k.onTimeClosureRate as number | null} suffix="%" /></div><span className="hse-ico teal" aria-hidden><HseIcon name="shield_check" size={19} /></span></div><span className="label">Closed on time</span><div className="sub">{k.closedInPeriod} closed{k.avgDaysToClose !== null ? `, avg ${k.avgDaysToClose} days` : ''}</div></div>
          </section>

          <div className="dash-grid">
            <section className="panel">
              <div className="panel-head"><h2>Reported and closed per week</h2><span className="spacer" /><span className="small muted">Select a week to open its records</span></div>
              <div className="panel-body">{data.trend.some((t) => t.reported || t.closed) ? <TrendChart data={data.trend} onSelectWeek={(f, t) => navigate(listLink({ from: f, to: t }))} /> : <Empty title="No observations in this period" />}</div>
            </section>
            <section className="panel panel-eng">
              <div className="panel-head"><h2>Open risk</h2><span className="spacer" /><span className="small muted">Select a cell to see the items</span></div>
              <div className="panel-body">
                <RiskMatrix {...data.openRiskMatrix} href={(l, s) => listLink({ status: 'active', likelihood: String(l), severity: String(s) })} />
              </div>
            </section>
          </div>

          <section className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-head"><h2>Open items by risk score</h2><span className="spacer" /><span className="small muted">Histogram · select a column to open its records</span></div>
            <div className="panel-body">{data.openRiskMatrix.cells.some((c) => c.count) ? <RiskHistogram {...data.openRiskMatrix} href={(score) => listLink({ status: 'active', riskScore: String(score) })} /> : <Empty title="No open items">Nothing is waiting for action in this scope.</Empty>}</div>
          </section>

          <div className="dash-grid">
            <section className="panel">
              <div className="panel-head"><h2>High and critical items still open</h2></div>
              {data.highRiskOpen.length === 0 ? <Empty title="None open">Nothing rated high or critical is waiting for action.</Empty> : (
                <div className="table-wrap"><table className="data">
                  <thead><tr><th>Ref</th><th>Hazard and location</th><th>Risk</th><th>Status</th><th>Due</th></tr></thead>
                  <tbody>{data.highRiskOpen.map((o) => (
                    <tr key={o.id}>
                      <td><Link className="ref" to={`/app/observations/${o.id}`}>{o.refNo}</Link></td>
                      <td>{o.hazardCategory}<div className="small muted">{o.location}</div></td><td><RiskChip band={o.riskBand} score={o.riskScore} /></td>
                      <td><StatusBadge status={o.status} overdue={o.status === 'assigned' && !!o.dueDate && o.dueDate < todayISO()} /></td><td className="num">{fmtDate(o.dueDate)}</td>
                    </tr>))}</tbody>
                </table></div>
              )}
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Top hazard categories</h2></div>
              <div className="panel-body">{data.byHazard.length ? <BarList items={data.byHazard.map((h) => ({ label: h.category, value: h.count, href: listLink({ hazardCategory: h.category, from, to: todayISO() }) }))} /> : <Empty title="No data for this period" />}</div>
            </section>
          </div>

          <div className="dash-grid">
            <section className="panel">
              <div className="panel-head"><h2>By site</h2></div>
              {data.bySite.length === 0 ? <Empty title="No sites with observations yet" /> : (
                <div className="table-wrap"><table className="data">
                  <thead><tr><th>Project</th><th>Site</th><th>Reported (period)</th><th>Open</th><th>Overdue</th></tr></thead>
                  <tbody>{data.bySite.map((s) => (
                    <tr key={s.id} className="row-link" onClick={() => navigate(listLink({ siteId: s.id, status: 'active' }))}><td>{s.projectCode}</td><td><Link to={listLink({ siteId: s.id, status: 'active' })} onClick={(e) => e.stopPropagation()}>{s.siteName}</Link></td><td className="num">{s.reported}</td><td className="num">{s.open}</td>
                      <td className="num" style={{ color: s.overdue ? 'var(--critical)' : undefined }}>{s.overdue}</td></tr>))}</tbody>
                </table></div>
              )}
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Overdue by owner</h2></div>
              {data.overdueByAssignee.length === 0 ? <Empty title="Nothing overdue" /> : (
                <div className="table-wrap"><table className="data">
                  <thead><tr><th>Owner</th><th>Overdue</th><th>Oldest due</th></tr></thead>
                  <tbody>{data.overdueByAssignee.map((a) => <tr key={a.id}><td><Link to={listLink({ assigneeId: a.id, status: 'overdue' })}>{a.name}</Link></td><td className="num">{a.overdue}</td><td className="num">{fmtDate(a.oldestDue)}</td></tr>)}</tbody>
                </table></div>
              )}
            </section>
          </div>

          <section className="panel" style={{ marginTop: 20 }}>
            <div className="panel-head"><h2>Modules not yet enabled</h2></div>
            <div className="panel-body stack">
              <p className="small muted">These indicators will appear here once each module is built and holding real records. Until then FORGEHSE shows nothing rather than a placeholder number.</p>
              <div className="modules">{Object.entries(data.modules).filter(([, m]) => !m.available).map(([key]) => <span key={key} className="module-chip">{MODULE_LABELS[key] ?? key}</span>)}</div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
