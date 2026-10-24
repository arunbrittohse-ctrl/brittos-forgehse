/**
 * Studio exports: Word (.docx via the `docx` library), PDF (pdf-lib) and SVG (shared renderers).
 * Every export states its review status. Drafts carry "AI-assisted draft — not reviewed" in the
 * header and footer so an unreviewed document cannot pass as an approved one.
 */
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, Packer, PageNumber, Paragraph, ShadingType,
  Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import {
  calculateRisk, DOCUMENT_TYPE_LABELS, renderFlowchartSvg, renderPosterSvg, STUDIO_KIND_LABELS,
  type Checklist, type DocumentReview, type Flowchart, type HseDocument, type Poster, type RiskMatrixConfig, type StudioKind,
} from '@forgehse/shared';

export interface ExportMeta {
  kind: StudioKind;
  title: string;
  organization: string;
  project: string | null;
  preparedBy: string;
  createdAt: Date;
  status: 'draft' | 'reviewed';
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reference: string;
  timezone: string;
  riskMatrix: RiskMatrixConfig;
}

const NAVY = '0B1F3B', BLUE = '3B82F6', TEAL = '14B8A6', SLATE = '475569', PLATINUM = 'C7D2FE', LIGHT = 'F5F7FB';
const BAND_FILL: Record<string, string> = { low: 'DCFCE7', medium: 'FEF3C7', high: 'FFEDD5', critical: 'FEE2E2' };

const fmtDate = (d: Date, tz: string) => d.toLocaleDateString('en-GB', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' });
const statusLine = (m: ExportMeta) => m.status === 'reviewed' && m.reviewedBy && m.reviewedAt
  ? `Reviewed by ${m.reviewedBy} on ${fmtDate(m.reviewedAt, m.timezone)}`
  : 'AI-assisted draft — NOT reviewed. Verify against project procedures before use.';

function risk(l: number, s: number, cfg: RiskMatrixConfig) {
  const c = (n: number) => Math.min(cfg.size, Math.max(1, Math.round(n)));
  return calculateRisk(c(l), c(s), cfg);
}

/* =================================================================== DOCX */

const t = (text: string, o: { bold?: boolean; color?: string; size?: number; italics?: boolean } = {}) => new TextRun({ text, bold: o.bold, color: o.color, size: o.size, italics: o.italics, font: 'Calibri' });
const p = (text: string, o: Parameters<typeof t>[1] & { after?: number } = {}) => new Paragraph({ children: [t(text, o)], spacing: { after: o.after ?? 120 } });
const h = (text: string, level: 1 | 2 = 1) => new Paragraph({ heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, children: [t(text, { bold: true, color: NAVY, size: level === 1 ? 28 : 24 })], spacing: { before: 240, after: 120 } });
const bullet = (text: string) => new Paragraph({ bullet: { level: 0 }, children: [t(text)], spacing: { after: 60 } });

function cell(text: string, o: { fill?: string; bold?: boolean; color?: string; width?: number; size?: number } = {}) {
  return new TableCell({
    children: text.split('\n').map((ln) => new Paragraph({ children: [t(ln, { bold: o.bold, color: o.color, size: o.size ?? 19 })] })),
    shading: o.fill ? { fill: o.fill, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    width: o.width ? { size: o.width, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
  });
}
const border = { style: BorderStyle.SINGLE, size: 4, color: 'D6DCE8' };
function table(head: string[], rows: (string | { text: string; fill?: string; bold?: boolean })[][], widths?: number[]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({ tableHeader: true, children: head.map((x, i) => cell(x, { fill: NAVY, bold: true, color: 'FFFFFF', width: widths?.[i] })) }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => typeof c === 'string' ? cell(c, { width: widths?.[i] }) : cell(c.text, { fill: c.fill, bold: c.bold, width: widths?.[i] })) })),
    ],
  });
}

function metaTable(m: ExportMeta) {
  const rows: [string, string][] = [
    ['Organisation', m.organization], ['Project', m.project ?? 'All projects'], ['Prepared by', `${m.preparedBy} (AI-assisted)`],
    ['Generated', fmtDate(m.createdAt, m.timezone)], ['Reference', m.reference], ['Status', statusLine(m)],
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: rows.map(([k, v]) => new TableRow({ children: [cell(k, { fill: LIGHT, bold: true, width: 24 }), cell(v, { width: 76, color: k === 'Status' && m.status === 'draft' ? 'B45309' : undefined, bold: k === 'Status' })] })),
  });
}

function wrapDoc(m: ExportMeta, body: (Paragraph | Table)[]) {
  return new Document({
    creator: "BRITTO'S FORGEHSE",
    title: m.title,
    description: `${STUDIO_KIND_LABELS[m.kind]} generated with FORGEHSE AI Studio`,
    styles: { default: { document: { run: { font: 'Calibri', size: 21, color: '1E293B' } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 900, left: 1000, right: 1000 } } },
      headers: {
        default: new Header({ children: [new Paragraph({ children: [t("BRITTO'S FORGEHSE", { bold: true, color: NAVY, size: 18 }), t('   ·   ' + m.organization, { color: SLATE, size: 18 })], border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BLUE, space: 4 } } })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [t(statusLine(m) + '   ', { size: 15, color: m.status === 'draft' ? 'B45309' : SLATE }), new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 15, color: SLATE })],
        })] }),
      },
      children: [
        new Paragraph({ children: [t(STUDIO_KIND_LABELS[m.kind].toUpperCase(), { bold: true, color: TEAL, size: 18 })], spacing: { after: 60 } }),
        new Paragraph({ heading: HeadingLevel.TITLE, children: [t(m.title, { bold: true, color: NAVY, size: 40 })], spacing: { after: 200 } }),
        metaTable(m),
        new Paragraph({ children: [], spacing: { after: 120 } }),
        ...body,
      ],
    }],
  });
}

function checklistDocx(c: Checklist, m: ExportMeta) {
  const body: (Paragraph | Table)[] = [p(c.scope)];
  let n = 0;
  for (const s of c.sections) {
    body.push(h(s.heading, 2));
    body.push(table(['#', 'Check item', 'Yes', 'No', 'N/A', 'Comments'], s.items.map((it) => {
      n++;
      return [String(n), { text: (it.critical ? '■ CRITICAL — stop work if No\n' : '') + it.text + (it.guidance ? `\n${it.guidance}` : ''), fill: it.critical ? 'FEF2F2' : undefined }, '', '', '', ''];
    }), [5, 51, 7, 7, 7, 23]));
  }
  if (c.notes.length) { body.push(h('Notes for the HSE engineer', 2)); c.notes.forEach((x) => body.push(bullet(x))); }
  body.push(h('Sign-off', 2));
  body.push(table(['Role', 'Name', 'Signature', 'Date'], [['Inspected by', '', '', ''], ['Reviewed by', '', '', '']], [25, 30, 25, 20]));
  return wrapDoc(m, body);
}

function documentDocx(d: HseDocument, m: ExportMeta) {
  const body: (Paragraph | Table)[] = [
    new Paragraph({ children: [t(DOCUMENT_TYPE_LABELS[d.docType], { bold: true, color: SLATE })], spacing: { after: 120 } }),
    h('1. Purpose'), ...d.purpose.split(/\n{2,}/).map((x) => p(x)),
    h('2. Scope'), ...d.scope.split(/\n{2,}/).map((x) => p(x)),
  ];
  let i = 3;
  if (d.responsibilities.length) {
    body.push(h(`${i++}. Roles and responsibilities`));
    body.push(table(['Role', 'Responsibilities'], d.responsibilities.map((r) => [r.role, r.duties]), [28, 72]));
  }
  for (const s of d.sections) {
    body.push(h(`${i++}. ${s.heading}`));
    s.body.split(/\n{2,}/).filter(Boolean).forEach((x) => body.push(p(x)));
    s.bullets.forEach((b) => body.push(bullet(b)));
  }
  if (d.riskTable.length) {
    body.push(h(`${i++}. Risk assessment`));
    body.push(p(`Ratings use the organisation's ${m.riskMatrix.size}×${m.riskMatrix.size} matrix (likelihood × severity).`, { color: SLATE, size: 18 }));
    body.push(table(['Activity', 'Hazard', 'Consequence', 'Initial', 'Controls', 'Residual'], d.riskTable.map((r) => {
      const a = risk(r.likelihood, r.severity, m.riskMatrix), b = risk(r.residualLikelihood, r.residualSeverity, m.riskMatrix);
      return [r.activity, r.hazard, r.consequence,
        { text: `${r.likelihood}×${r.severity} = ${a.score}\n${a.band.toUpperCase()}`, fill: BAND_FILL[a.band], bold: true },
        r.controls.map((c) => '• ' + c).join('\n'),
        { text: `${r.residualLikelihood}×${r.residualSeverity} = ${b.score}\n${b.band.toUpperCase()}`, fill: BAND_FILL[b.band], bold: true }];
    }), [14, 16, 16, 10, 34, 10]));
  }
  if (d.reviewNotes.length) {
    body.push(h('Reviewer checklist (complete before issue)'));
    d.reviewNotes.forEach((x) => body.push(bullet(x)));
  }
  body.push(h('Document control', 2));
  body.push(table(['Revision', 'Date', 'Prepared by', 'Reviewed by', 'Approved by'], [['00', '', m.preparedBy, m.reviewedBy ?? '', '']], [12, 18, 24, 23, 23]));
  return wrapDoc(m, body);
}

const SEV_FILL: Record<string, string> = { critical: 'FEE2E2', major: 'FFEDD5', minor: 'FEF3C7', observation: 'E0F2FE' };
function reviewDocx(r: DocumentReview, m: ExportMeta) {
  const rating = { adequate: 'Adequate', needs_improvement: 'Needs improvement', inadequate: 'Inadequate' }[r.overallRating];
  const body: (Paragraph | Table)[] = [
    h('Summary'), p(`Document reviewed: ${r.documentTitle} (${r.documentType})`, { bold: true }), p(r.summary),
    new Paragraph({ children: [t('Overall assessment: ', { bold: true }), t(rating, { bold: true, color: r.overallRating === 'adequate' ? '15803D' : r.overallRating === 'inadequate' ? 'B91C1C' : 'B45309' })] }),
  ];
  if (r.strengths.length) { body.push(h('Strengths')); r.strengths.forEach((x) => body.push(bullet(x))); }
  if (r.findings.length) {
    body.push(h('Findings'));
    body.push(table(['#', 'Severity', 'Section', 'Issue', 'Recommendation'], r.findings.map((f, i) => [String(i + 1), { text: f.severity.toUpperCase(), fill: SEV_FILL[f.severity], bold: true }, f.section, f.issue, f.recommendation]), [5, 12, 15, 34, 34]));
  }
  if (r.missingElements.length) { body.push(h('Missing elements')); r.missingElements.forEach((x) => body.push(bullet(x))); }
  if (r.questionsForAuthor.length) { body.push(h('Questions for the author')); r.questionsForAuthor.forEach((x) => body.push(bullet(x))); }
  body.push(p('This review compares the document with general good HSE practice. It is not a legal compliance determination.', { italics: true, color: SLATE, size: 17 }));
  return wrapDoc(m, body);
}

export async function studioDocx(kind: StudioKind, content: unknown, m: ExportMeta): Promise<Buffer> {
  const doc = kind === 'checklist' ? checklistDocx(content as Checklist, m)
    : kind === 'document' ? documentDocx(content as HseDocument, m)
    : kind === 'review' ? reviewDocx(content as DocumentReview, m)
    : null;
  if (!doc) throw new Error(`DOCX export is not available for ${kind}`);
  return Packer.toBuffer(doc);
}

/* =================================================================== SVG */

export function studioSvg(kind: StudioKind, content: unknown, m: ExportMeta): string {
  if (kind === 'poster') return renderPosterSvg(content as Poster, { draft: m.status !== 'reviewed', orgLabel: m.organization });
  if (kind === 'flowchart') return renderFlowchartSvg(content as Flowchart, { draft: m.status !== 'reviewed' });
  throw new Error(`SVG export is not available for ${kind}`);
}

/* =================================================================== PDF (flowing A4 layout) */

function winAnsi(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[■•]/g, '-').replace(/×/g, 'x')
    .replace(/\t/g, ' ').replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, '?');
}
const hex = (h: string): RGB => rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);

class PdfFlow {
  W = 595; H = 842; M = 48;
  y = 0; page!: PDFPage; pages: PDFPage[] = [];
  constructor(private pdf: PDFDocument, private font: PDFFont, private bold: PDFFont, private m: ExportMeta) {}
  newPage() {
    this.page = this.pdf.addPage([this.W, this.H]);
    this.pages.push(this.page);
    this.page.drawRectangle({ x: 0, y: this.H - 40, width: this.W, height: 40, color: hex(NAVY) });
    this.page.drawText("BRITTO'S FORGEHSE", { x: this.M, y: this.H - 25, size: 10, font: this.bold, color: rgb(1, 1, 1) });
    const org = winAnsi(this.m.organization);
    this.page.drawText(org, { x: this.W - this.M - this.font.widthOfTextAtSize(org, 9), y: this.H - 25, size: 9, font: this.font, color: hex(PLATINUM) });
    this.y = this.H - 70;
  }
  lines(text: string, font: PDFFont, size: number, width: number): string[] {
    const out: string[] = [];
    for (const para of winAnsi(text).split('\n')) {
      let cur = '';
      for (const w of para.split(' ')) {
        const tryL = cur ? `${cur} ${w}` : w;
        if (font.widthOfTextAtSize(tryL, size) <= width) { cur = tryL; continue; }
        if (cur) out.push(cur);
        let piece = w;
        while (font.widthOfTextAtSize(piece, size) > width && piece.length > 1) {
          let n = piece.length;
          while (n > 1 && font.widthOfTextAtSize(piece.slice(0, n), size) > width) n--;
          out.push(piece.slice(0, n)); piece = piece.slice(n);
        }
        cur = piece;
      }
      out.push(cur);
    }
    return out;
  }
  ensure(h: number) { if (this.y - h < this.M + 30) this.newPage(); }
  text(s: string, o: { size?: number; bold?: boolean; color?: string; indent?: number; gap?: number } = {}) {
    const size = o.size ?? 10, f = o.bold ? this.bold : this.font, x = this.M + (o.indent ?? 0);
    for (const ln of this.lines(s, f, size, this.W - 2 * this.M - (o.indent ?? 0))) {
      this.ensure(size * 1.4);
      this.page.drawText(ln, { x, y: this.y, size, font: f, color: hex(o.color ?? '1E293B') });
      this.y -= size * 1.4;
    }
    this.y -= o.gap ?? 4;
  }
  heading(s: string, level: 1 | 2 = 1) {
    this.ensure(40);
    this.y -= level === 1 ? 10 : 6;
    this.text(s, { size: level === 1 ? 13 : 11, bold: true, color: NAVY, gap: 4 });
  }
  bullets(items: string[]) {
    for (const b of items) {
      this.ensure(14);
      this.page.drawCircle({ x: this.M + 4, y: this.y + 3, size: 1.8, color: hex(BLUE) });
      this.text(b, { indent: 14, gap: 2 });
    }
    this.y -= 4;
  }
  table(head: string[], rows: { text: string; fill?: string; bold?: boolean }[][], widths: number[]) {
    const total = this.W - 2 * this.M;
    const ws = widths.map((w) => (w / 100) * total);
    const size = 8.2, lh = size * 1.35, pad = 4;
    const drawRow = (cells: { text: string; fill?: string; bold?: boolean }[], header: boolean) => {
      const wrapped = cells.map((c, i) => this.lines(c.text, c.bold || header ? this.bold : this.font, size, ws[i]! - 2 * pad));
      const hgt = Math.max(...wrapped.map((l) => l.length)) * lh + 2 * pad;
      if (this.y - hgt < this.M + 30) { this.newPage(); if (!header) drawRow(head.map((x) => ({ text: x })), true); }
      let x = this.M;
      cells.forEach((c, i) => {
        this.page.drawRectangle({ x, y: this.y - hgt, width: ws[i]!, height: hgt, color: header ? hex(NAVY) : c.fill ? hex(c.fill) : rgb(1, 1, 1), borderColor: hex('D6DCE8'), borderWidth: 0.6 });
        wrapped[i]!.forEach((ln, j) => this.page.drawText(ln, { x: x + pad, y: this.y - pad - size - j * lh + 1.5, size, font: c.bold || header ? this.bold : this.font, color: header ? rgb(1, 1, 1) : hex('1E293B') }));
        x += ws[i]!;
      });
      this.y -= hgt;
    };
    drawRow(head.map((x) => ({ text: x })), true);
    rows.forEach((r) => drawRow(r, false));
    this.y -= 10;
  }
  finish() {
    const s = winAnsi(statusLine(this.m));
    this.pages.forEach((pg, i) => {
      pg.drawLine({ start: { x: this.M, y: 34 }, end: { x: this.W - this.M, y: 34 }, thickness: 0.6, color: hex(BLUE) });
      pg.drawText(s.slice(0, 110), { x: this.M, y: 22, size: 7, font: this.bold, color: hex(this.m.status === 'draft' ? 'B45309' : SLATE) });
      const lab = `Page ${i + 1} of ${this.pages.length}`;
      pg.drawText(lab, { x: this.W - this.M - this.font.widthOfTextAtSize(lab, 7), y: 22, size: 7, font: this.font, color: hex(SLATE) });
    });
  }
}

export async function studioPdf(kind: StudioKind, content: unknown, m: ExportMeta): Promise<Buffer> {
  if (!['checklist', 'document', 'review'].includes(kind)) throw new Error(`PDF export is not available for ${kind}`);
  const pdf = await PDFDocument.create();
  pdf.setTitle(winAnsi(m.title)); pdf.setCreator("BRITTO'S FORGEHSE"); pdf.setProducer("BRITTO'S FORGEHSE");
  const f = new PdfFlow(pdf, await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold), m);
  f.newPage();
  f.text(STUDIO_KIND_LABELS[kind].toUpperCase(), { size: 8, bold: true, color: TEAL, gap: 10 });
  f.text(m.title, { size: 18, bold: true, color: NAVY, gap: 8 });
  f.table(['Field', 'Detail'], [
    ['Organisation', m.organization], ['Project', m.project ?? 'All projects'], ['Prepared by', `${m.preparedBy} (AI-assisted)`],
    ['Generated', fmtDate(m.createdAt, m.timezone)], ['Reference', m.reference], ['Status', statusLine(m)],
  ].map(([a, b]) => [{ text: a!, fill: LIGHT, bold: true }, { text: b!, bold: a === 'Status' }]), [24, 76]);

  f.y -= 8;
  if (kind === 'checklist') {
    const c = content as Checklist;
    f.text(c.scope, { gap: 8 });
    let n = 0;
    for (const s of c.sections) {
      f.heading(s.heading, 2);
      f.table(['#', 'Check item', 'Yes', 'No', 'N/A', 'Comments'], s.items.map((it) => {
        n++;
        return [{ text: String(n) }, { text: (it.critical ? 'CRITICAL - stop work if No\n' : '') + it.text + (it.guidance ? `\n${it.guidance}` : ''), fill: it.critical ? 'FEF2F2' : undefined }, { text: '' }, { text: '' }, { text: '' }, { text: '' }];
      }), [5, 53, 7, 7, 7, 21]);
    }
    if (c.notes.length) { f.heading('Notes for the HSE engineer', 2); f.bullets(c.notes); }
    f.heading('Sign-off', 2);
    f.table(['Role', 'Name', 'Signature', 'Date'], [['Inspected by', '', '', ''], ['Reviewed by', '', '', '']].map((r) => r.map((x) => ({ text: x }))), [25, 30, 25, 20]);
  } else if (kind === 'document') {
    const d = content as HseDocument;
    f.text(DOCUMENT_TYPE_LABELS[d.docType], { bold: true, color: SLATE });
    f.heading('1. Purpose'); f.text(d.purpose);
    f.heading('2. Scope'); f.text(d.scope);
    let i = 3;
    if (d.responsibilities.length) { f.heading(`${i++}. Roles and responsibilities`); f.table(['Role', 'Responsibilities'], d.responsibilities.map((r) => [{ text: r.role, bold: true }, { text: r.duties }]), [28, 72]); }
    for (const s of d.sections) { f.heading(`${i++}. ${s.heading}`); s.body.split(/\n{2,}/).filter(Boolean).forEach((x) => f.text(x, { gap: 6 })); if (s.bullets.length) f.bullets(s.bullets); }
    if (d.riskTable.length) {
      f.heading(`${i++}. Risk assessment`);
      f.table(['Activity', 'Hazard', 'Consequence', 'Initial', 'Controls', 'Residual'], d.riskTable.map((r) => {
        const a = risk(r.likelihood, r.severity, m.riskMatrix), b = risk(r.residualLikelihood, r.residualSeverity, m.riskMatrix);
        return [{ text: r.activity }, { text: r.hazard }, { text: r.consequence }, { text: `${r.likelihood}x${r.severity}=${a.score}\n${a.band.toUpperCase()}`, fill: BAND_FILL[a.band], bold: true },
          { text: r.controls.map((c) => '- ' + c).join('\n') }, { text: `${r.residualLikelihood}x${r.residualSeverity}=${b.score}\n${b.band.toUpperCase()}`, fill: BAND_FILL[b.band], bold: true }];
      }), [14, 15, 15, 11, 34, 11]);
    }
    if (d.reviewNotes.length) { f.heading('Reviewer checklist (complete before issue)'); f.bullets(d.reviewNotes); }
  } else {
    const r = content as DocumentReview;
    f.heading('Summary'); f.text(`Document reviewed: ${r.documentTitle} (${r.documentType})`, { bold: true }); f.text(r.summary);
    f.text(`Overall assessment: ${{ adequate: 'Adequate', needs_improvement: 'Needs improvement', inadequate: 'Inadequate' }[r.overallRating]}`, { bold: true, color: NAVY, gap: 8 });
    if (r.strengths.length) { f.heading('Strengths'); f.bullets(r.strengths); }
    if (r.findings.length) { f.heading('Findings'); f.table(['#', 'Severity', 'Section', 'Issue', 'Recommendation'], r.findings.map((x, i) => [{ text: String(i + 1) }, { text: x.severity.toUpperCase(), fill: SEV_FILL[x.severity], bold: true }, { text: x.section }, { text: x.issue }, { text: x.recommendation }]), [5, 12, 15, 34, 34]); }
    if (r.missingElements.length) { f.heading('Missing elements'); f.bullets(r.missingElements); }
    if (r.questionsForAuthor.length) { f.heading('Questions for the author'); f.bullets(r.questionsForAuthor); }
    f.text('This review compares the document with general good HSE practice. It is not a legal compliance determination.', { size: 8, color: SLATE });
  }
  f.finish();
  return Buffer.from(await pdf.save());
}
