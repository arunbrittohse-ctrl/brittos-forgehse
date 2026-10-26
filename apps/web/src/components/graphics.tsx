import { HSE_ICON_PATHS, type PosterIcon } from '@forgehse/shared';

/**
 * Corporate graphics for BRITTO'S FORGEHSE: a blueprint grid with a connected-node network.
 * Pure SVG + CSS (no images, no external requests). Deterministic for a given seed so the
 * layout never jumps between renders. Decorative only: always aria-hidden.
 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const W = 1200, H = 600;

function network(seed: number, count: number) {
  const r = rng(seed);
  const nodes = Array.from({ length: count }, (_, i) => ({ x: 40 + r() * (W - 80), y: 30 + r() * (H - 60), alt: i % 3 === 0 }));
  const links: [number, number][] = [];
  nodes.forEach((a, i) => {
    const near = nodes
      .map((b, j) => ({ j, d: (a.x - b.x) ** 2 + (a.y - b.y) ** 2 }))
      .filter((n) => n.j !== i)
      .sort((p, q) => p.d - q.d)
      .slice(0, 2);
    for (const n of near) if (!links.some(([p, q]) => (p === n.j && q === i) || (p === i && q === n.j))) links.push([i, n.j]);
  });
  return { nodes, links };
}

export function Blueprint({ seed = 7, nodes = 16, tone = 'dark', className = '' }: { seed?: number; nodes?: number; tone?: 'dark' | 'light'; className?: string }) {
  const net = network(seed, nodes);
  const id = `bp-${seed}-${tone}`;
  return (
    <svg className={`blueprint ${tone === 'light' ? 'on-light' : ''} ${className}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden focusable="false">
      <defs>
        <pattern id={`${id}-minor`} width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" className="bp-grid" /></pattern>
        <pattern id={`${id}-major`} width="120" height="120" patternUnits="userSpaceOnUse"><rect width="120" height="120" fill={`url(#${id}-minor)`} /><path d="M120 0H0V120" fill="none" className="bp-grid-major" /></pattern>
      </defs>
      <rect width={W} height={H} fill={`url(#${id}-major)`} />
      {net.links.map(([a, b], i) => {
        const p = net.nodes[a], q = net.nodes[b];
        return p && q ? <line key={i} className="bp-link" x1={p.x} y1={p.y} x2={q.x} y2={q.y} /> : null;
      })}
      {net.nodes.map((n, i) => (
        <g key={i}>
          {i % 5 === 0 && <circle className="bp-halo" cx={n.x} cy={n.y} r={6} style={{ animationDelay: `${(i % 4) * 1.1}s` }} />}
          <circle className={`bp-node ${n.alt ? 'alt' : ''}`} cx={n.x} cy={n.y} r={i % 5 === 0 ? 3.6 : 2.4} />
        </g>
      ))}
    </svg>
  );
}

/** One consistent minimalist HSE line-icon family (64-unit grid, round stroke), shared with posters and exports. */
export function HseIcon({ name, size = 20, label, strokeWidth = 3.4 }: { name: PosterIcon; size?: number; label?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <path d={HSE_ICON_PATHS[name]} />
    </svg>
  );
}

/** Small animated node ring used for genuine loading states only. */
export function NodeRing() {
  return (
    <svg className="node-ring" viewBox="0 0 24 24" aria-hidden focusable="false">
      <circle cx="12" cy="3.5" r="2.4" /><circle cx="20.5" cy="12" r="2.4" /><circle cx="12" cy="20.5" r="2.4" /><circle cx="3.5" cy="12" r="2.4" />
    </svg>
  );
}
