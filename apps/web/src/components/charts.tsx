import type { RiskBand } from '@forgehse/shared';
import { Link } from '../lib/router';

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

/** Weekly reported vs closed. Plain SVG; scales to its container. */
export function TrendChart({ data }: { data: { week: string; reported: number; closed: number }[] }) {
  const W = 640, H = 200, P = { l: 28, r: 8, t: 10, b: 24 };
  const max = Math.max(4, ...data.map((d) => Math.max(d.reported, d.closed)));
  const step = (W - P.l - P.r) / Math.max(1, data.length);
  const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
  const ticks = [0, Math.round(max / 2), max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Weekly observations reported and closed">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text x={P.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{t}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = P.l + i * step;
        const bw = Math.max(3, step * 0.32);
        return (
          <g key={d.week}>
            <rect x={x + step * 0.14} y={y(d.reported)} width={bw} height={H - P.b - y(d.reported)} rx="1.5" fill="var(--navy)" opacity="0.9"><title>{`Week of ${d.week}: ${d.reported} reported`}</title></rect>
            <rect x={x + step * 0.14 + bw + 2} y={y(d.closed)} width={bw} height={H - P.b - y(d.closed)} rx="1.5" fill="var(--teal)"><title>{`Week of ${d.week}: ${d.closed} closed`}</title></rect>
            {(i % Math.ceil(data.length / 7) === 0) && <text x={x + step / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">{d.week.slice(5)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function BarList({ items, max }: { items: { label: string; value: number }[]; max?: number }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="bar-list">
      {items.map((i) => (
        <div className="bar-row" key={i.label}>
          <span>{i.label}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${(i.value / top) * 100}%`, display: 'block' }} /></span>
          <span className="num" style={{ textAlign: 'right' }}>{i.value}</span>
        </div>
      ))}
    </div>
  );
}
