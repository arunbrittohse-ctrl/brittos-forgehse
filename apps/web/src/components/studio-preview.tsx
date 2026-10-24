/** Previews and client-side exports for HSE Studio items. */
import { useMemo } from 'react';
import {
  calculateRisk, DOCUMENT_TYPE_LABELS, renderFlowchartSvg, renderPosterSvg, STUDIO_KIND_LABELS, DEFAULT_RISK_MATRIX,
  type Checklist, type DocumentReview, type Flowchart, type HseDocument, type Poster, type RiskMatrixConfig, type StudioKind,
} from '@forgehse/shared';
import { Icon } from './ui';
import { fmtDate } from '../lib/format';

export interface StudioItem {
  id: string; kind: StudioKind; title: string; brief: string; content: unknown; status: 'draft' | 'reviewed'; version: number;
  projectId: string | null; project: string | null; createdBy: { id: string; name: string }; createdAt: string; updatedAt: string;
  reviewedBy: { id: string; name: string } | null; reviewedAt: string | null; reviewNote: string | null;
  permissions: { edit: boolean; review: boolean };
}

export const KIND_ICON: Record<StudioKind, string> = { checklist: 'checklist', document: 'doc', poster: 'image', flowchart: 'flow', review: 'review' };

export const svgFor = (item: StudioItem, org?: string) =>
  item.kind === 'poster' ? renderPosterSvg(item.content as Poster, { draft: item.status !== 'reviewed', orgLabel: org })
    : item.kind === 'flowchart' ? renderFlowchartSvg(item.content as Flowchart, { draft: item.status !== 'reviewed' }) : '';

/** SVG is shown through <img src="data:…"> so it can never script the page. */
export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export async function downloadPng(svg: string, name: string, scale = 2) {
  const img = new Image();
  img.src = svgDataUrl(svg);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth * scale; c.height = img.naturalHeight * scale;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!blob) throw new Error('PNG export failed');
  saveBlob(blob, `${name}.png`);
}

export function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const fileBase = (item: StudioItem) => (item.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'forgehse') + (item.status === 'draft' ? '-DRAFT' : '');

function PaperHead({ item, org }: { item: StudioItem; org?: string }) {
  return (
    <>
      <div className="ph"><b>BRITTO'S FORGEHSE</b><span>{org}</span></div>
      <div className="kicker">{STUDIO_KIND_LABELS[item.kind].toUpperCase()}</div>
      <h1>{item.title}</h1>
      <table className="meta"><tbody>
        <tr><td>Project</td><td>{item.project ?? 'All projects'}</td></tr>
        <tr><td>Prepared by</td><td>{item.createdBy.name} (AI-assisted)</td></tr>
        <tr><td>Generated</td><td>{fmtDate(item.createdAt.slice(0, 10))}</td></tr>
        <tr><td>Status</td><td className={item.status === 'draft' ? 'draft-note' : ''}>{item.status === 'reviewed' && item.reviewedBy ? `Reviewed by ${item.reviewedBy.name} on ${fmtDate(item.reviewedAt?.slice(0, 10) ?? null)}` : 'AI-assisted draft — NOT reviewed. Verify against project procedures before use.'}</td></tr>
      </tbody></table>
    </>
  );
}

function ChecklistPaper({ c }: { c: Checklist }) {
  let n = 0;
  return (
    <>
      <p>{c.scope}</p>
      {c.sections.map((s, si) => (
        <section key={si}>
          <h2>{s.heading}</h2>
          <table><thead><tr><th style={{ width: 28 }}>#</th><th>Check item</th><th style={{ width: 36 }}>Yes</th><th style={{ width: 36 }}>No</th><th style={{ width: 36 }}>N/A</th><th style={{ width: '22%' }}>Comments</th></tr></thead>
            <tbody>{s.items.map((it, ii) => (
              <tr key={ii} className={it.critical ? 'crit' : ''}><td>{++n}</td>
                <td>{it.critical && <span className="crit-tag">CRITICAL — STOP WORK IF NO</span>}<div>{it.text}</div>{it.guidance && <span className="guidance">{it.guidance}</span>}</td>
                <td /><td /><td /><td /></tr>))}</tbody></table>
        </section>
      ))}
      {c.notes.length > 0 && <div className="box"><b>Notes for the HSE engineer</b><ul>{c.notes.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
      <h2>Sign-off</h2>
      <table><thead><tr><th>Role</th><th>Name</th><th>Signature</th><th>Date</th></tr></thead><tbody><tr><td>Inspected by</td><td /><td /><td /></tr><tr><td>Reviewed by</td><td /><td /><td /></tr></tbody></table>
    </>
  );
}

function DocumentPaper({ d, matrix }: { d: HseDocument; matrix: RiskMatrixConfig }) {
  let i = 3;
  const r = (l: number, s: number) => { try { return calculateRisk(Math.min(matrix.size, l), Math.min(matrix.size, s), matrix); } catch { return null; } };
  return (
    <>
      <p><b>{DOCUMENT_TYPE_LABELS[d.docType]}</b></p>
      <h2>1. Purpose</h2>{d.purpose.split(/\n{2,}/).map((x, j) => <p key={j}>{x}</p>)}
      <h2>2. Scope</h2>{d.scope.split(/\n{2,}/).map((x, j) => <p key={j}>{x}</p>)}
      {d.responsibilities.length > 0 && <><h2>{i++}. Roles and responsibilities</h2><table><thead><tr><th>Role</th><th>Responsibilities</th></tr></thead><tbody>{d.responsibilities.map((x, j) => <tr key={j}><td><b>{x.role}</b></td><td>{x.duties}</td></tr>)}</tbody></table></>}
      {d.sections.map((s, j) => (
        <section key={j}><h2>{i++}. {s.heading}</h2>{s.body.split(/\n{2,}/).filter(Boolean).map((x, q) => <p key={q}>{x}</p>)}{s.bullets.length > 0 && <ul>{s.bullets.map((b, q) => <li key={q}>{b}</li>)}</ul>}</section>
      ))}
      {d.riskTable.length > 0 && (
        <><h2>{i++}. Risk assessment</h2>
          <table><thead><tr><th>Activity</th><th>Hazard</th><th>Consequence</th><th>Initial</th><th>Controls</th><th>Residual</th></tr></thead>
            <tbody>{d.riskTable.map((x, j) => { const a = r(x.likelihood, x.severity), b = r(x.residualLikelihood, x.residualSeverity); return (
              <tr key={j}><td>{x.activity}</td><td>{x.hazard}</td><td>{x.consequence}</td>
                <td className={a ? `band-${a.band}` : ''}><b>{x.likelihood}×{x.severity} = {a?.score}</b><br />{a?.band}</td>
                <td><ul style={{ margin: 0, paddingLeft: 16 }}>{x.controls.map((c, q) => <li key={q}>{c}</li>)}</ul></td>
                <td className={b ? `band-${b.band}` : ''}><b>{x.residualLikelihood}×{x.residualSeverity} = {b?.score}</b><br />{b?.band}</td></tr>); })}</tbody></table></>
      )}
      {d.reviewNotes.length > 0 && <div className="box"><b>Reviewer checklist — complete before issue</b><ul>{d.reviewNotes.map((x, j) => <li key={j}>{x}</li>)}</ul></div>}
    </>
  );
}

const RATING = { adequate: 'Adequate', needs_improvement: 'Needs improvement', inadequate: 'Inadequate' } as const;
function ReviewPaper({ r }: { r: DocumentReview }) {
  return (
    <>
      <h2>Summary</h2>
      <p><b>Document reviewed:</b> {r.documentTitle} ({r.documentType})</p>
      <p>{r.summary}</p>
      <p><b>Overall assessment: {RATING[r.overallRating]}</b></p>
      {r.strengths.length > 0 && <><h2>Strengths</h2><ul>{r.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      {r.findings.length > 0 && <><h2>Findings</h2><table><thead><tr><th>#</th><th>Severity</th><th>Section</th><th>Issue</th><th>Recommendation</th></tr></thead>
        <tbody>{r.findings.map((f, i) => <tr key={i}><td>{i + 1}</td><td className={`sev-${f.severity}`}><b>{f.severity}</b></td><td>{f.section}</td><td>{f.issue}</td><td>{f.recommendation}</td></tr>)}</tbody></table></>}
      {r.missingElements.length > 0 && <><h2>Missing elements</h2><ul>{r.missingElements.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      {r.questionsForAuthor.length > 0 && <><h2>Questions for the author</h2><ul>{r.questionsForAuthor.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      <p style={{ color: '#64748b', fontSize: '0.78rem' }}>This review compares the document with general good HSE practice. It is not a legal compliance determination.</p>
    </>
  );
}

export function StudioPreview({ item, org, matrix = DEFAULT_RISK_MATRIX }: { item: StudioItem; org?: string; matrix?: RiskMatrixConfig }) {
  const svg = useMemo(() => svgFor(item, org), [item, org]);
  if (item.kind === 'poster' || item.kind === 'flowchart') {
    return <div className="art-frame"><img src={svgDataUrl(svg)} alt={`${STUDIO_KIND_LABELS[item.kind]}: ${item.title}`} style={{ width: item.kind === 'poster' ? 'min(100%, 520px)' : '100%' }} /></div>;
  }
  return (
    <article className="paper">
      <PaperHead item={item} org={org} />
      {item.kind === 'checklist' && <ChecklistPaper c={item.content as Checklist} />}
      {item.kind === 'document' && <DocumentPaper d={item.content as HseDocument} matrix={matrix} />}
      {item.kind === 'review' && <ReviewPaper r={item.content as DocumentReview} />}
    </article>
  );
}

export function StatusPill({ status }: { status: 'draft' | 'reviewed' }) {
  return <span className={`status-pill ${status}`}><Icon name={status === 'reviewed' ? 'check' : 'alert'} size={12} />{status === 'reviewed' ? 'Reviewed' : 'Draft — review required'}</span>;
}

export function ExportButtons({ item, org }: { item: StudioItem; org?: string }) {
  const base = `/api/studio/items/${item.id}/export`;
  const doc = ['checklist', 'document', 'review'].includes(item.kind);
  return (
    <div className="row" style={{ gap: 8 }}>
      {doc && <a className="btn btn-sm" href={`${base}?format=docx`} download><Icon name="download" size={15} />Word</a>}
      {doc && <a className="btn btn-sm" href={`${base}?format=pdf`} download><Icon name="download" size={15} />PDF</a>}
      {!doc && <button className="btn btn-sm" onClick={() => void downloadPng(svgFor(item, org), fileBase(item))}><Icon name="download" size={15} />PNG</button>}
      {!doc && <a className="btn btn-sm" href={`${base}?format=svg`} download><Icon name="download" size={15} />SVG</a>}
      <button className="btn btn-sm btn-ghost" onClick={() => window.print()}><Icon name="print" size={15} />Print</button>
    </div>
  );
}
