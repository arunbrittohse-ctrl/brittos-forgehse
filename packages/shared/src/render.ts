/**
 * Pure SVG renderers for Studio posters and flowcharts. They return a complete, self-contained
 * SVG string and run identically in the browser (preview, PNG export) and on the server (download).
 * All text passes through `esc()` — content from the model or a user can never inject markup.
 */
import { HSE_ICON_PATHS } from './hse-icons';
import type { Flowchart, Poster, PosterTheme } from './studio';

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const FONT = "Inter, 'Segoe UI', Roboto, Arial, sans-serif";

/** Greedy word wrap using an average glyph width; long words are hard-broken. */
export function wrap(text: string, maxChars: number, maxLines = Infinity): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (let w of words) {
    while (w.length > maxChars) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, maxChars - 1) + '-'); w = w.slice(maxChars - 1); }
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1]!.replace(/\s*\S*$/, '') + '…';
    return kept;
  }
  return lines;
}

/* ---------------------------------------------------------------- poster */
interface ThemeStyle { band: string; ink: string; accent: string; word: string }
export const POSTER_THEME_STYLES: Record<PosterTheme, ThemeStyle> = {
  prohibition: { band: '#DC2626', ink: '#FFFFFF', accent: '#DC2626', word: 'DO NOT' },
  warning: { band: '#F59E0B', ink: '#0B1F3B', accent: '#B45309', word: 'WARNING' },
  mandatory: { band: '#2563EB', ink: '#FFFFFF', accent: '#2563EB', word: 'MANDATORY' },
  safe_condition: { band: '#16A34A', ink: '#FFFFFF', accent: '#15803D', word: 'SAFE PRACTICE' },
  fire: { band: '#B91C1C', ink: '#FFFFFF', accent: '#B91C1C', word: 'FIRE SAFETY' },
  information: { band: '#0B1F3B', ink: '#FFFFFF', accent: '#14B8A6', word: 'SAFETY NOTICE' },
};

export interface PosterRenderOptions { draft?: boolean; orgLabel?: string }

export const POSTER_SIZE = { width: 1240, height: 1754 } as const; // ISO A-series ratio

export function renderPosterSvg(p: Poster, opts: PosterRenderOptions = {}): string {
  const { width: W, height: H } = POSTER_SIZE;
  const t = POSTER_THEME_STYLES[p.theme];
  const word = (p.signalWord || t.word).toUpperCase();
  const icon = HSE_ICON_PATHS[p.icon] ?? HSE_ICON_PATHS.shield_check;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(FONT)}">`);
  out.push(`<defs><pattern id="stripe" width="56" height="56" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="28" height="56" fill="#0B1F3B"/></pattern>`,
    `<radialGradient id="glow" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.28"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient></defs>`);
  out.push(`<rect width="${W}" height="${H}" fill="#FFFFFF"/>`);
  // Colour band with soft light, plus hazard striping for warning posters.
  out.push(`<rect width="${W}" height="680" fill="${t.band}"/><rect width="${W}" height="680" fill="url(#glow)"/>`);
  if (p.theme === 'warning') out.push(`<rect width="${W}" height="36" fill="url(#stripe)"/><rect y="644" width="${W}" height="36" fill="url(#stripe)"/>`);
  out.push(`<text x="80" y="${p.theme === 'warning' ? 128 : 118}" font-size="46" font-weight="800" letter-spacing="7" fill="${t.ink}">${esc(word)}</text>`);
  // Icon medallion.
  const cx = W / 2, cy = 390, r = 196;
  out.push(`<circle cx="${cx}" cy="${cy + 10}" r="${r}" fill="#000000" opacity="0.14"/>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFFFFF"/>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="${r - 18}" fill="none" stroke="${t.band}" stroke-width="10" opacity="0.25"/>`);
  const s = 4.4;
  out.push(`<g transform="translate(${cx - 32 * s} ${cy - 32 * s}) scale(${s})" fill="none" stroke="${t.accent}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="${icon}"/></g>`);

  // Headline + subheadline.
  let y = 800;
  for (const l of wrap(p.headline, 20, 3)) { out.push(`<text x="80" y="${y}" font-size="96" font-weight="800" letter-spacing="-2" fill="#0B1F3B">${esc(l)}</text>`); y += 108; }
  if (p.subheadline) {
    y += 6;
    for (const l of wrap(p.subheadline, 46, 3)) { out.push(`<text x="80" y="${y}" font-size="42" fill="#475569">${esc(l)}</text>`); y += 56; }
  }
  y += 34;
  out.push(`<rect x="80" y="${y}" width="120" height="8" rx="4" fill="${t.band}"/>`);
  y += 70;
  // Points.
  p.points.slice(0, 5).forEach((pt, i) => {
    const lines = wrap(pt, 44, 2);
    out.push(`<circle cx="112" cy="${y - 14}" r="30" fill="${t.band}"/><text x="112" y="${y}" font-size="38" font-weight="800" text-anchor="middle" fill="${t.ink}">${i + 1}</text>`);
    lines.forEach((l, j) => out.push(`<text x="170" y="${y + j * 50}" font-size="42" font-weight="600" fill="#0B1F3B">${esc(l)}</text>`));
    y += 50 * lines.length + 42;
  });

  // Footer strip.
  const fy = H - 150;
  out.push(`<rect y="${fy}" width="${W}" height="150" fill="#0B1F3B"/><rect y="${fy}" width="${W}" height="4" fill="#C7D2FE" opacity="0.6"/>`);
  out.push(`<text x="80" y="${fy + 66}" font-size="34" font-weight="800" letter-spacing="1" fill="#FFFFFF">BRITTO'S FORGEHSE</text>`);
  out.push(`<text x="80" y="${fy + 104}" font-size="24" fill="#C7D2FE">Engineered for Safety. Powered by Intelligence.</text>`);
  // Right column: organisation and footer note on separate lines, kept clear of the tagline.
  const rights = [opts.orgLabel, p.footerNote].filter((x): x is string => Boolean(x)).map((x) => wrap(x, 32, 1)[0]!);
  rights.forEach((r, i) => out.push(`<text x="${W - 80}" y="${fy + 62 + i * 34}" font-size="24" text-anchor="end" fill="${i === 0 ? '#FFFFFF' : '#C7D2FE'}" font-weight="${i === 0 ? 700 : 400}">${esc(r)}</text>`));
  if (opts.draft) {
    out.push(`<g transform="translate(${W / 2} ${H / 2 + 120}) rotate(-28)" opacity="0.1"><text text-anchor="middle" font-size="120" font-weight="800" fill="#0B1F3B">DRAFT · NOT REVIEWED</text></g>`);
    out.push(`<rect x="${W - 420}" y="44" width="340" height="56" rx="28" fill="#0B1F3B" opacity="0.85"/><text x="${W - 250}" y="81" font-size="24" font-weight="700" text-anchor="middle" fill="#FFFFFF">AI DRAFT · REVIEW FIRST</text>`);
  }
  out.push('</svg>');
  return out.join('');
}

/* ---------------------------------------------------------------- flowchart */
interface Box { id: string; label: string[]; kind: string; w: number; h: number; x: number; y: number; layer: number }

export interface FlowLayout { width: number; height: number; boxes: Box[]; edges: { from: Box; to: Box; label: string; back: boolean }[] }

/** Layered top-down layout: longest-path layers (cycles become side-routed back edges), barycentre ordering. */
export function layoutFlowchart(f: Flowchart): FlowLayout {
  const nodes = f.nodes;
  const out = new Map<string, string[]>();
  const inc = new Map<string, number>();
  for (const n of nodes) { out.set(n.id, []); inc.set(n.id, 0); }
  // Back-edge detection with DFS from start nodes (then any unvisited).
  const state = new Map<string, 0 | 1 | 2>();
  const back = new Set<string>();
  const order = [...nodes].sort((a, b) => (a.kind === 'start' ? -1 : 0) - (b.kind === 'start' ? -1 : 0));
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  f.edges.forEach((e) => adj.get(e.from)?.push(e.to));
  const visit = (id: string) => {
    state.set(id, 1);
    for (const to of adj.get(id) ?? []) {
      const s = state.get(to) ?? 0;
      if (s === 1) back.add(`${id}>${to}`);
      else if (s === 0) visit(to);
    }
    state.set(id, 2);
  };
  for (const n of order) if (!state.get(n.id)) visit(n.id);
  const forward = f.edges.filter((e) => !back.has(`${e.from}>${e.to}`) && e.from !== e.to);
  for (const e of forward) { out.get(e.from)!.push(e.to); inc.set(e.to, (inc.get(e.to) ?? 0) + 1); }
  // Longest-path layering via Kahn's algorithm.
  const layer = new Map<string, number>();
  const queue = nodes.filter((n) => (inc.get(n.id) ?? 0) === 0).map((n) => n.id);
  queue.forEach((id) => layer.set(id, 0));
  const remaining = new Map(inc);
  while (queue.length) {
    const id = queue.shift()!;
    for (const to of out.get(id) ?? []) {
      layer.set(to, Math.max(layer.get(to) ?? 0, (layer.get(id) ?? 0) + 1));
      remaining.set(to, (remaining.get(to) ?? 1) - 1);
      if (remaining.get(to) === 0) queue.push(to);
    }
  }
  const boxes = new Map<string, Box>();
  for (const n of nodes) {
    const decision = n.kind === 'decision';
    const label = wrap(n.label, decision ? 18 : 26, 4);
    const w = decision ? 250 : n.kind === 'step' ? 260 : 220;
    const h = decision ? Math.max(120, 70 + label.length * 20) : Math.max(56, 26 + label.length * 21);
    boxes.set(n.id, { id: n.id, label, kind: n.kind, w, h, x: 0, y: 0, layer: layer.get(n.id) ?? 0 });
  }
  const layers: Box[][] = [];
  for (const b of boxes.values()) (layers[b.layer] ??= []).push(b);
  // Barycentre ordering pass (top-down) to reduce crossings.
  const parents = new Map<string, string[]>();
  forward.forEach((e) => (parents.get(e.to) ?? parents.set(e.to, []).get(e.to)!).push(e.from));
  const pos = new Map<string, number>();
  layers.forEach((L, li) => {
    if (li > 0) L.sort((a, b) => bary(a) - bary(b));
    L.forEach((b, i) => pos.set(b.id, i));
    function bary(b: Box) { const ps = parents.get(b.id) ?? []; return ps.length ? ps.reduce((s, p) => s + (pos.get(p) ?? 0), 0) / ps.length : 0; }
  });
  const GAPX = 64, GAPY = 74, PAD = 48, TITLE = 92;
  const rowW = layers.map((L) => (L ?? []).reduce((s, b) => s + b.w, 0) + GAPX * Math.max(0, (L ?? []).length - 1));
  const backCount = back.size;
  const gutter = backCount ? 40 + backCount * 16 : 0; // routing lanes for loops, on both sides
  const inner = Math.max(560, ...rowW);
  const width = inner + PAD * 2 + gutter * 2;
  let y = PAD + TITLE;
  layers.forEach((L, li) => {
    if (!L) return;
    let x = PAD + gutter + (inner - rowW[li]!) / 2;
    const rowH = Math.max(...L.map((b) => b.h));
    for (const b of L) { b.x = x; b.y = y + (rowH - b.h) / 2; x += b.w + GAPX; }
    y += rowH + GAPY;
  });
  const height = y - GAPY + PAD;
  void gutter;
  const edges = f.edges.filter((e) => e.from !== e.to).map((e) => ({ from: boxes.get(e.from)!, to: boxes.get(e.to)!, label: e.label, back: back.has(`${e.from}>${e.to}`) }));
  return { width, height, boxes: [...boxes.values()], edges };
}

export function renderFlowchartSvg(f: Flowchart, opts: { draft?: boolean } = {}): string {
  const L = layoutFlowchart(f);
  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.width} ${L.height}" width="${L.width}" height="${L.height}" font-family="${esc(FONT)}">`);
  o.push('<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#475569"/></marker>',
    '<filter id="sh" x="-10%" y="-10%" width="130%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#0B1F3B" flood-opacity="0.14"/></filter></defs>');
  o.push(`<rect width="${L.width}" height="${L.height}" fill="#F5F7FB"/>`);
  o.push(`<text x="48" y="70" font-size="26" font-weight="700" fill="#0B1F3B">${esc(wrap(f.title, Math.max(30, Math.floor((L.width - 96) / 14)), 1)[0]!)}</text>`);
  if (opts.draft) o.push(`<rect x="48" y="86" width="232" height="24" rx="12" fill="#FEF3C7"/><text x="164" y="102.5" font-size="12.5" font-weight="700" text-anchor="middle" fill="#B45309">AI DRAFT · REVIEW BEFORE USE</text>`);
  let backL = 0, backR = 0;
  const minLeft = Math.min(...L.boxes.map((b) => b.x));
  const maxRight = Math.max(...L.boxes.map((b) => b.x + b.w));
  const labels: string[] = [];
  const label = (text: string, lx: number, ly: number) => {
    const w = text.length * 8 + 18;
    labels.push(`<rect x="${lx - w / 2}" y="${ly - 14}" width="${w}" height="22" rx="11" fill="#FFFFFF" stroke="#C7D2FE"/><text x="${lx}" y="${ly + 2}" font-size="12.5" font-weight="700" text-anchor="middle" fill="#0B1F3B">${esc(text)}</text>`);
  };
  for (const e of L.edges) {
    const a = e.from, b = e.to;
    const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2;
    let d: string;
    if (e.back) {
      // Loop back: leave from the side nearest the outside and travel up a gutter lane.
      const leftSide = acx < (minLeft + maxRight) / 2;
      const gx = leftSide ? minLeft - 28 - backL++ * 16 : maxRight + 28 + backR++ * 16;
      const y1 = acy, y2 = b.y + b.h / 2;
      const sx = leftSide ? a.x : a.x + a.w, tx = leftSide ? b.x - 2 : b.x + b.w + 2;
      d = `M${sx} ${y1}H${gx}V${y2}H${tx}`;
      if (e.label) label(e.label, gx, (y1 + y2) / 2);
    } else if (b.layer === a.layer) {
      const left = b.x < a.x;
      d = `M${left ? a.x : a.x + a.w} ${acy}H${left ? b.x + b.w + 2 : b.x - 2}`;
      if (e.label) label(e.label, (a.x + b.x + a.w) / 2, acy - 10);
    } else if (a.kind === 'decision' && Math.abs(bcx - acx) > 12 && !L.boxes.some((o2) => o2 !== a && o2.layer === a.layer && o2.x < Math.max(acx, bcx) && o2.x + o2.w > Math.min(acx, bcx))) {
      // Decision branches leave from the left or right vertex of the diamond, then drop to the target.
      const right = bcx > acx;
      const sx = right ? a.x + a.w : a.x;
      d = `M${sx} ${acy}H${bcx}V${b.y - 2}`;
      if (e.label) label(e.label, (sx + bcx) / 2, acy - 10);
    } else {
      const x1 = acx, y1 = a.y + a.h, y2 = b.y - 2;
      const my = y1 + Math.min(34, (y2 - y1) / 2);
      d = Math.abs(x1 - bcx) < 1 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}V${my}H${bcx}V${y2}`;
      // Label sits just above its own target so sibling branches never overlap.
      if (e.label) label(e.label, bcx + 26, Math.max(y1 + 18, y2 - 16));
    }
    o.push(`<path d="${d}" fill="none" stroke="#475569" stroke-width="2" stroke-linejoin="round" marker-end="url(#arr)"${e.back ? ' stroke-dasharray="6 5"' : ''}/>`);
  }
  for (const b of L.boxes) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (b.kind === 'decision') {
      o.push(`<path d="M${cx} ${b.y}L${b.x + b.w} ${cy}L${cx} ${b.y + b.h}L${b.x} ${cy}Z" fill="#FFF7E6" stroke="#F59E0B" stroke-width="2.5" filter="url(#sh)"/>`);
    } else if (b.kind === 'start' || b.kind === 'end') {
      o.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.h / 2}" fill="${b.kind === 'start' ? '#0B1F3B' : '#14B8A6'}" filter="url(#sh)"/>`);
    } else {
      o.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10" fill="#FFFFFF" stroke="#C7D2FE" stroke-width="1.5" filter="url(#sh)"/><rect x="${b.x}" y="${b.y + 8}" width="4" height="${b.h - 16}" rx="2" fill="#3B82F6"/>`);
    }
    const ink = b.kind === 'start' || b.kind === 'end' ? '#FFFFFF' : '#0B1F3B';
    const startY = cy - ((b.label.length - 1) * 20) / 2 + 5;
    b.label.forEach((l, i) => o.push(`<text x="${cx}" y="${startY + i * 20}" font-size="15" font-weight="${b.kind === 'step' ? 500 : 700}" text-anchor="middle" fill="${ink}">${esc(l)}</text>`));
  }
  o.push(...labels);
  o.push('</svg>');
  return o.join('');
}
