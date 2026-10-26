import type { RiskBand } from '@forgehse/shared';
import { useState } from 'react';
import { Link, navigate } from '../lib/router';

export interface MatrixProps {
  size: number;
  bands: { band: RiskBand | string; minScore: number }[];
  cells: { likelihood: number; severity: number; count: number }[];
  /** Build a link for a cell (e.g. to the filtered list). */
  href?: (likelihood: number, severity: number) => string;
}

function bandFor(score: number, bands: MatrixProps['bands']): string {
  let b = bands[0]?.band ?? 'low';
  for (const x of bands) if (score >= x.minScore) b = x.band;
  return b;
}

/** Likelihood (rows, high at top) × severity (columns). Each cell shows how many open items sit there. */
export function RiskMatrix({ size, bands, cells, href }: MatrixProps) {
  const count = new Map(cells.map((c) => [`${c.likelihood}:${c.severity}`, c.count]));
  const rows = Array.from({ length: size }, (_, i) => size - i);
  const cols = Array.from({ length: size }, (_, i) => i + 1);
  return (
    <div>
      <div className="matrix-wrap">
        <div className="matrix-axis-y">Likelihood</div>
        <div className="matrix" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }} role="table" aria-label="Open observations by likelihood and severity">
          {rows.map((l) => cols.map((s) => {
            const n = count.get(`${l}:${s}`) ?? 0;
            const cls = `cell b-${bandFor(l * s, bands)} ${n ? 'has' : 'zero'}`;
            const label = `Likelihood ${l}, severity ${s}: ${n} open`;
            return n && href
              ? <Link key={`${l}${s}`} to={href(l, s)} className={cls} aria-label={label} role="cell">{n}</Link>
              : <div key={`${l}${s}`} className={cls} aria-label={label} role="cell">{n || '·'}</div>;
          }))}
        </div>
      </div>
      <div className="matrix-axis-x">Severity</div>
    </div>
  );
}

/** Shared hover / focus tooltip for the SVG charts. */
interface Tip { x: number; y: number; lines: string[]; hint?: string }
function ChartTip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: `${tip.x}%`, top: `${tip.y}%` }} role="status" aria-live="polite">
      {tip.lines.map((l, i) => <div key={i}>{i === 0 ? <b>{l}</b> : l}</div>)}
      {tip.hint && <div className="tip-hint">{tip.hint}</div>}
    </div>
  );
}

const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * Weekly reported vs closed. Animated entry, legend toggles, hover/focus tooltip and
 * click-through: selecting a week opens the observations reported in that week.
 */
export function TrendChart({ data, onSelectWeek }: { data: { week: string; reported: number; closed: number }[]; onSelectWeek?: (from: string, to: string) => void }) {
  const [show, setShow] = useState({ reported: true, closed: true });
  const [tip, setTip] = useState<Tip | null>(null);
  const W = 640, H = 210, P = { l: 30, r: 8, t: 12, b: 24 };
  const vals = data.flatMap((d) => [show.reported ? d.reported : 0, show.closed ? d.closed : 0]);
  const max = Math.max(4, ...vals);
  const step = (W - P.l - P.r) / Math.max(1, data.length);
  const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
  const ticks = [0, Math.round(max / 2), max];
  const series = [show.reported, show.closed].filter(Boolean).length || 1;
  const bw = Math.max(3, (step * 0.64) / series);
  const total = data.reduce((a, d) => ({ r: a.r + d.reported, c: a.c + d.closed }), { r: 0, c: 0 });
  const open = (d: { week: string }) => onSelectWeek?.(d.week, addDays(d.week, 6));
  const tipFor = (d: (typeof data)[number], i: number) => setTip({
    x: ((P.l + i * step + step / 2) / W) * 100, y: (y(Math.max(show.reported ? d.reported : 0, show.closed ? d.closed : 0)) / H) * 100,
    lines: [`Week of ${d.week}`, `${d.reported} reported · ${d.closed} closed`], hint: onSelectWeek ? 'Select to open these records' : undefined,
  });
  return (
    <div className="chart-wrap">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <div className="legend-toggle" role="group" aria-label="Series">
          <button type="button" aria-pressed={show.reported} onClick={() => setShow((s) => ({ ...s, reported: !s.reported || !s.closed ? true : !s.reported }))}><i style={{ background: 'var(--navy)' }} />Reported</button>
          <button type="button" aria-pressed={show.closed} onClick={() => setShow((s) => ({ ...s, closed: !s.closed || !s.reported ? true : !s.closed }))}><i style={{ background: 'var(--teal)' }} />Closed</button>
        </div>
        <span className="small muted">{total.r} reported · {total.c} closed in period</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Weekly observations: ${total.r} reported and ${total.c} closed across ${data.length} weeks`} onMouseLeave={() => setTip(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={P.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{t}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = P.l + i * step;
          let bx = x + step * 0.18;
          const label = `Week of ${d.week}: ${d.reported} reported, ${d.closed} closed`;
          return (
            <g key={d.week} className="chart-hit" tabIndex={onSelectWeek ? 0 : -1} role={onSelectWeek ? 'link' : undefined} aria-label={label}
              onMouseEnter={() => tipFor(d, i)} onFocus={() => tipFor(d, i)} onBlur={() => setTip(null)} onClick={() => open(d)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(d); } }}>
              <rect className="hit-bg" x={x + 1} y={P.t} width={step - 2} height={H - P.t - P.b} rx="4" fill="transparent" />
              {show.reported && (() => { const r = <rect className="grow-y" style={{ ['--i' as string]: i }} x={bx} y={y(d.reported)} width={bw} height={H - P.b - y(d.reported)} rx="2" fill="var(--navy)" opacity="0.92" />; bx += bw + 2; return r; })()}
              {show.closed && <rect className="grow-y" style={{ ['--i' as string]: i }} x={bx} y={y(d.closed)} width={bw} height={H - P.b - y(d.closed)} rx="2" fill="var(--teal)" />}
              {(i % Math.ceil(data.length / 7) === 0) && <text x={x + step / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">{d.week.slice(5)}</text>}
            </g>
          );
        })}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

/** Horizontal bars with animated entry; each row can link to the records behind it. */
export function BarList({ items, max }: { items: { label: string; value: number; href?: string }[]; max?: number }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="bar-list">
      {items.map((it, i) => {
        const body = <>
          <span>{it.label}</span>
          <span className="bar-track"><span className="bar-fill grow-x" style={{ width: `${(it.value / top) * 100}%`, ['--i' as string]: i }} /></span>
          <span className="num" style={{ textAlign: 'right' }}>{it.value}</span>
        </>;
        return it.href
          ? <Link className="bar-row" key={it.label} to={it.href} aria-label={`${it.label}: ${it.value}. Open these records`}>{body}</Link>
          : <div className="bar-row" key={it.label}>{body}</div>;
      })}
    </div>
  );
}

/**
 * Histogram of open items by risk score (Likelihood × Severity), coloured by the
 * organisation's configured bands. Each column links to the open records with that score.
 */
export function RiskHistogram({ size, bands, cells, href }: MatrixProps & { href?: (score: number) => string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const maxScore = size * size;
  const byScore = new Map<number, number>();
  for (const c of cells) byScore.set(c.likelihood * c.severity, (byScore.get(c.likelihood * c.severity) ?? 0) + c.count);
  // Only scores that the matrix can produce (e.g. 7 is impossible on a 5×5) get a column.
  const possible = new Set<number>();
  for (let l = 1; l <= size; l++) for (let s = 1; s <= size; s++) possible.add(l * s);
  const scores = [...possible].sort((a, b) => a - b);
  const total = [...byScore.values()].reduce((a, b) => a + b, 0);
  const W = 640, H = 170, P = { l: 26, r: 6, t: 10, b: 22 };
  const max = Math.max(2, ...byScore.values());
  const step = (W - P.l - P.r) / scores.length;
  const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
  const go = (s: number) => { if (href && byScore.get(s)) navigate(href(s)); };
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Open items by risk score: ${total} in total, highest possible score ${maxScore}`} onMouseLeave={() => setTip(null)}>
        <line x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} stroke="var(--line-strong)" />
        <text x={P.l - 6} y={y(max) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{max}</text>
        {scores.map((s, i) => {
          const n = byScore.get(s) ?? 0;
          const band = bandFor(s, bands);
          const x = P.l + i * step;
          const show = () => setTip({ x: ((x + step / 2) / W) * 100, y: (y(n) / H) * 100, lines: [`Risk score ${s} · ${band}`, `${n} open`], hint: n && href ? 'Select to open these records' : undefined });
          return (
            <g key={s} className="chart-hit" tabIndex={n && href ? 0 : -1} role={n && href ? 'link' : undefined} aria-label={`Risk score ${s}, ${band}: ${n} open`}
              onMouseEnter={show} onFocus={show} onBlur={() => setTip(null)} onClick={() => go(s)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(s); } }}>
              <rect className="hit-bg" x={x + 1} y={P.t} width={step - 2} height={H - P.t - P.b} rx="3" fill="transparent" />
              {n > 0 && <rect className="grow-y" style={{ ['--i' as string]: i }} x={x + step * 0.16} y={y(n)} width={step * 0.68} height={H - P.b - y(n)} rx="2" fill={`var(--${band}, var(--navy))`} />}
              <text x={x + step / 2} y={H - 7} textAnchor="middle" fontSize="9.5" fill="var(--muted)">{s}</text>
            </g>
          );
        })}
      </svg>
      <div className="hist-caption"><span>Lower risk</span><span>Score = likelihood × severity on your organisation’s matrix</span><span>Higher risk</span></div>
      <ChartTip tip={tip} />
    </div>
  );
}
