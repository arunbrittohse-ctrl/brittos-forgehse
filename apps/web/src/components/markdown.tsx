/**
 * Safe Markdown renderer for AI answers: headings, paragraphs, bullet and numbered lists, tables,
 * code blocks, quotes, rules, bold/italic/code, http(s) links and record citations.
 * It builds React nodes only — model output can never inject HTML.
 */
import type { ReactNode } from 'react';
import { Link } from '../lib/router';

export interface CiteRef { id: string; refNo: string; title: string }

function inline(s: string, cites: Map<string, CiteRef>, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[(OBS-[A-Z0-9-]+)\]|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*[^*\s][^*]*\*|\b_[^_\s][^_]*_\b)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (m[2]) {
      const c = cites.get(m[2]);
      out.push(c ? <Link key={k} className="cite" to={`/app/observations/${c.id}`} title={c.title}>{m[2]}</Link> : <span key={k} className="cite" title="Reference not returned by a record search">{m[2]}</span>);
    } else if (m[3] && m[4]) out.push(<a key={k} href={m[4]} target="_blank" rel="noopener noreferrer">{m[3]}</a>);
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

const isTableSep = (l: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(l.trim());
const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function Markdown({ text, citations = [], streaming = false }: { text: string; citations?: CiteRef[]; streaming?: boolean }) {
  const cites = new Map(citations.map((c) => [c.refNo, c]));
  const lines = text.replace(/\r/g, '').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  const k = () => `b${out.length}`;
  while (i < lines.length) {
    const line = lines[i]!;
    const t = line.trim();
    if (!t) { i++; continue; }
    if (t.startsWith('```')) {
      const body: string[] = []; i++;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) body.push(lines[i++]!);
      i++;
      out.push(<pre key={k()}><code>{body.join('\n')}</code></pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    if (h) { const lvl = h[1]!.length; const c = inline(h[2]!, cites, k()); out.push(lvl <= 2 ? <h2 key={k()}>{c}</h2> : <h3 key={k()}>{c}</h3>); i++; continue; }
    if (/^(-{3,}|\*{3,})$/.test(t)) { out.push(<hr key={k()} />); i++; continue; }
    if (t.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]!)) {
      const head = cells(t); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) rows.push(cells(lines[i++]!));
      out.push(<table key={k()}><thead><tr>{head.map((c, j) => <th key={j}>{inline(c, cites, `h${j}`)}</th>)}</tr></thead>
        <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, cites, `c${ri}${j}`)}</td>)}</tr>)}</tbody></table>);
      continue;
    }
    if (/^[-*•]\s+/.test(t)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i]!)) { items.push(<li key={i}>{inline(lines[i]!.trim().replace(/^[-*•]\s+/, ''), cites, `l${i}`)}</li>); i++; }
      out.push(<ul key={k()}>{items}</ul>);
      continue;
    }
    if (/^\d+[.)]\s+/.test(t)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) { items.push(<li key={i}>{inline(lines[i]!.trim().replace(/^\d+[.)]\s+/, ''), cites, `o${i}`)}</li>); i++; }
      out.push(<ol key={k()}>{items}</ol>);
      continue;
    }
    if (t.startsWith('>')) {
      const q: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) q.push(lines[i++]!.trim().replace(/^>\s?/, ''));
      out.push(<blockquote key={k()}>{inline(q.join(' '), cites, k())}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|[-*•]\s|\d+[.)]\s|>|```)/.test(lines[i]!.trim()) && !(lines[i]!.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]!))) para.push(lines[i++]!.trim());
    out.push(<p key={k()}>{inline(para.join(' '), cites, k())}</p>);
  }
  if (streaming) out.push(<span key="caret" className="caret" aria-hidden />);
  return <div className="md">{out}</div>;
}
