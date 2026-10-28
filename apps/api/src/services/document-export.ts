/**
 * DOCX (docx) and PDF (pdf-lib) export for HSE Document Studio documents.
 *
 * The exporters render the SAVED record passed in — the current row or a stored revision snapshot —
 * never a sample. Every page carries the document number, revision and status; anything not approved
 * is marked "DRAFT — NOT APPROVED", and model suggestions are labelled as unverified.
 */
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, Packer, PageNumber, PageOrientation, Paragraph,
  ShadingType, Table, TableCell, TableRow, TextRun, WidthType, type ISectionOptions,
} from 'docx';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import {
  docType, rateOnMatrix, describeMatrix, revisionLabel, DOCUMENT_STATUS_LABELS,
  type DocContent, type DocGenerator, type DocTypeKey, type DocumentStudioStatus, type RiskMatrixConfig, type DocRiskRow,
} from '@forgehse/shared';

export interface DocExportMeta {
  docType: DocTypeKey;
  docNumber: string;
  title: string;
  revision: number;
  status: DocumentStudioStatus;
  organization: string;
  project: string | null;
  site: string | null;
  preparedBy: string;
  createdAt: Date;
  updatedAt: Date;
  submittedBy: string | null;
  submittedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  generator: DocGenerator;
  matrix: RiskMatrixConfig;
  timezone: string;
  history: { revision: number; event: string; actor: string; at: Date; note: string }[];
  /** Set when exporting a stored snapshot rather than the current document. */
  snapshot?: { event: string; at: Date } | null;
}

const NAVY = '0B1F3B', BLUE = '3B82F6', TEAL = '14B8A6', SLATE = '475569', LIGHT = 'F5F7FB', AMBER = 'B45309';
const BAND_FILL: Record<string, string> = { low: 'DCFCE7', medium: 'FEF3C7', high: 'FFEDD5', critical: 'FEE2E2' };

const fmt = (d: Date | null, tz: string) => (d ? d.toLocaleDateString('en-GB', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' }) : '');
const isApproved = (m: DocExportMeta) => m.status === 'approved' && !!m.approvedBy;

export function statusBanner(m: DocExportMeta): string {
  if (m.snapshot) return `HISTORICAL SNAPSHOT (${m.snapshot.event}, ${fmt(m.snapshot.at, m.timezone)}) — ${isApproved(m) ? 'approved at that time' : 'NOT APPROVED'}`;
  if (isApproved(m)) return `APPROVED by ${m.approvedBy} on ${fmt(m.approvedAt, m.timezone)} — ${revisionLabel(m.revision)}`;
  if (m.status === 'withdrawn') return 'WITHDRAWN — DO NOT USE';
  return `DRAFT — NOT APPROVED. ${m.status === 'in_review' ? 'Under review. ' : ''}Must be reviewed and approved by a qualified person before use.`;
}

function footerLine(m: DocExportMeta) {
  return `${m.docNumber} · ${revisionLabel(m.revision)} · ${isApproved(m) && !m.snapshot ? 'Approved' : m.status === 'withdrawn' ? 'WITHDRAWN' : 'DRAFT — NOT APPROVED'}`;
}

function provenance(m: DocExportMeta): string {
  const g = m.generator;
  return g.modelCalled
    ? `Template ${g.templateVersion} + ${g.modelSuggestions} suggestion(s) from ${g.provider} model ${g.model}`
    : `Template ${g.templateVersion} (deterministic; no AI model)`;
}

function controlRows(m: DocExportMeta): [string, string][] {
  return [
    ['Document number', m.docNumber], ['Revision', revisionLabel(m.revision)], ['Status', DOCUMENT_STATUS_LABELS[m.status]],
    ['Organisation', m.organization], ['Project', m.project ?? 'Organisation-wide'], ['Site', m.site ?? '—'],
    ['Prepared by', `${m.preparedBy}, ${fmt(m.createdAt, m.timezone)}`], ['Last saved', fmt(m.updatedAt, m.timezone)],
    ['Generated from', provenance(m)],
  ];
}

function approvalRows(m: DocExportMeta): string[][] {
  return [
    ['Prepared by', m.preparedBy, fmt(m.createdAt, m.timezone), ''],
    ['Submitted for review by', m.submittedBy ?? 'Pending', fmt(m.submittedAt, m.timezone), ''],
    ['Approved by', isApproved(m) ? m.approvedBy! : 'Pending — not approved', isApproved(m) ? fmt(m.approvedAt, m.timezone) : '', ''],
  ];
}

const ORIGIN_LABEL = { template: '', author: '', model: 'MODEL SUGGESTION — NOT VERIFIED' } as const;

function rating(l: number | null, s: number | null, matrix: RiskMatrixConfig) {
  const r = rateOnMatrix(l, s, matrix);
  return r ? { text: `${l}×${s} = ${r.score}\n${r.band.toUpperCase()}`, fill: BAND_FILL[r.band] } : { text: 'Not rated', fill: 'FFFFFF' };
}

function riskCells(r: DocRiskRow, i: number, matrix: RiskMatrixConfig) {
  const a = rating(r.initialLikelihood, r.initialSeverity, matrix), b = rating(r.residualLikelihood, r.residualSeverity, matrix);
  return [
    { text: `${i + 1}${r.origin === 'model' ? '\n(model)' : ''}` }, { text: r.step }, { text: r.hazard }, { text: r.consequence }, { text: r.exposed },
    { text: r.existingControls.map((c) => `• ${c}`).join('\n') || '—' }, { text: a.text, fill: a.fill, bold: true },
    { text: r.additionalControls.map((c) => `• ${c}`).join('\n') || '—' }, { text: r.controlOwner }, { text: b.text, fill: b.fill, bold: true }, { text: r.verification },
  ];
}
const RISK_HEAD = ['#', 'Task step', 'Hazard', 'Consequence', 'Exposed', 'Existing controls', 'Initial', 'Additional controls', 'Owner', 'Residual', 'Verification'];
const RISK_W = [3, 9, 10, 9, 8, 15, 7, 13, 8, 7, 11];

/** Matrix grid: severity across, likelihood down, each cell coloured by its band. */
function matrixGrid(matrix: RiskMatrixConfig) {
  const head = ['L \\ S', ...Array.from({ length: matrix.size }, (_, s) => `${s + 1}${matrix.severityLabels?.[s] ? ` ${matrix.severityLabels[s]}` : ''}`)];
  const rows = Array.from({ length: matrix.size }, (_, li) => {
    const l = matrix.size - li;
    return [{ text: `${l}${matrix.likelihoodLabels?.[l - 1] ? ` ${matrix.likelihoodLabels[l - 1]}` : ''}`, bold: true },
      ...Array.from({ length: matrix.size }, (_, si) => { const r = rateOnMatrix(l, si + 1, matrix)!; return { text: `${r.score} ${r.band.toUpperCase()}`, fill: BAND_FILL[r.band] }; })];
  });
  return { head, rows };
}

/* =================================================================== DOCX */

type Cell = { text: string; fill?: string; bold?: boolean };
const run = (text: string, o: { bold?: boolean; color?: string; size?: number; italics?: boolean } = {}) => new TextRun({ text, bold: o.bold, color: o.color, size: o.size, italics: o.italics, font: 'Calibri' });
const para = (text: string, o: Parameters<typeof run>[1] & { after?: number } = {}) => new Paragraph({ children: [run(text, o)], spacing: { after: o.after ?? 120 } });
const heading = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run(text, { bold: true, color: NAVY, size: 26 })], spacing: { before: 240, after: 100 }, keepNext: true });
const bullet = (text: string) => new Paragraph({ bullet: { level: 0 }, children: [run(text)], spacing: { after: 50 } });
const bd = { style: BorderStyle.SINGLE, size: 4, color: 'D6DCE8' };

function dcell(c: Cell, head: boolean, width?: number, size = 18) {
  return new TableCell({
    children: c.text.split('\n').map((ln) => new Paragraph({ children: [run(ln, { bold: head || c.bold, color: head ? 'FFFFFF' : undefined, size })] })),
    shading: head ? { fill: NAVY, type: ShadingType.CLEAR, color: 'auto' } : c.fill ? { fill: c.fill, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
  });
}
function dtable(head: string[], rows: (Cell | string)[][], widths?: number[], size = 18) {
  const norm = (c: Cell | string): Cell => (typeof c === 'string' ? { text: c } : c);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: bd, bottom: bd, left: bd, right: bd, insideHorizontal: bd, insideVertical: bd },
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: head.map((h, i) => dcell({ text: h }, true, widths?.[i], size)) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: head.map((_, i) => dcell(norm(r[i] ?? ''), false, widths?.[i], size)) })),
    ],
  });
}

export async function documentDocx(c: DocContent, m: DocExportMeta): Promise<Buffer> {
  const t = docType(m.docType);
  const draft = !isApproved(m) || !!m.snapshot;
  const header = new Header({ children: [new Paragraph({
    children: [run("BRITTO'S FORGEHSE", { bold: true, color: NAVY, size: 16 }), run(`   ·   ${m.organization}   ·   ${m.docNumber}   ·   ${revisionLabel(m.revision)}`, { color: SLATE, size: 16 }), ...(draft ? [run('   ·   DRAFT — NOT APPROVED', { bold: true, color: AMBER, size: 16 })] : [])],
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BLUE, space: 4 } },
  })] });
  const footer = new Footer({ children: [new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [run(`${footerLine(m)}   `, { size: 15, color: draft ? AMBER : SLATE, bold: draft }), new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 15, color: SLATE, font: 'Calibri' })],
  })] });

  const body: (Paragraph | Table)[] = [
    para(t.label.toUpperCase(), { bold: true, color: TEAL, size: 18, after: 40 }),
    new Paragraph({ heading: HeadingLevel.TITLE, children: [run(m.title, { bold: true, color: NAVY, size: 38 })], spacing: { after: 160 } }),
    new Paragraph({ children: [run(statusBanner(m), { bold: true, color: draft ? AMBER : '15803D', size: 20 })], shading: { fill: draft ? 'FEF3C7' : 'DCFCE7', type: ShadingType.CLEAR, color: 'auto' }, spacing: { after: 160 } }),
    dtable(['Document control', ''], controlRows(m).map(([k, v]) => [{ text: k, bold: true, fill: LIGHT }, v]), [28, 72]),
  ];
  let n = 1;
  for (const s of c.sections) {
    body.push(heading(`${n++}. ${s.heading}`));
    if (ORIGIN_LABEL[s.origin]) body.push(para(ORIGIN_LABEL[s.origin], { bold: true, color: AMBER, size: 16 }));
    s.text.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).forEach((x) => body.push(para(x)));
    s.bullets.forEach((b) => body.push(bullet(b)));
    if (s.table) body.push(dtable(s.table.columns, s.table.rows, undefined, 17), para('', { after: 60 }));
  }
  const tail: (Paragraph | Table)[] = [];
  if (t.riskRegister) {
    const g = matrixGrid(m.matrix);
    tail.push(heading(`${n++}. Risk matrix`));
    describeMatrix(m.matrix).forEach((x) => tail.push(bullet(x)));
    tail.push(dtable(g.head, g.rows, undefined, 15));
  }
  if (c.assumptions.length) { tail.push(heading(`${n++}. Assumptions`)); c.assumptions.forEach((x) => tail.push(bullet(x))); }
  tail.push(heading(`${n++}. Missing inputs`));
  if (c.missingInputs.length) c.missingInputs.forEach((x) => tail.push(bullet(x))); else tail.push(para('None recorded at the last save.'));
  tail.push(heading(`${n++}. Qualified review required`)); c.reviewRequirements.forEach((x) => tail.push(bullet(x)));
  tail.push(heading(`${n++}. Approval`), dtable(['Role', 'Name', 'Date', 'Signature'], approvalRows(m), [28, 34, 18, 20]));
  tail.push(heading(`${n++}. Revision history`), dtable(['Revision', 'Event', 'By', 'Date', 'Note'], m.history.map((h) => [revisionLabel(h.revision), h.event, h.actor, fmt(h.at, m.timezone), h.note]), [12, 16, 22, 16, 34]));

  const portrait: ISectionOptions = { properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } }, headers: { default: header }, footers: { default: footer }, children: body };
  const sections: ISectionOptions[] = [portrait];
  if (t.riskRegister) {
    sections.push({
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 700, bottom: 700, left: 700, right: 700 } } },
      headers: { default: header }, footers: { default: footer },
      children: [heading('Risk register'), para(`Ratings on the organisation's ${m.matrix.size}×${m.matrix.size} matrix stored with this document. "Not rated" means the assessor has not yet rated the row.`, { size: 16, color: SLATE }),
        dtable(RISK_HEAD, c.riskRows.length ? c.riskRows.map((r, i) => riskCells(r, i, m.matrix)) : [[{ text: '' }, { text: 'No rows' }]], RISK_W, 15)],
    });
  }
  sections.push({ properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } }, headers: { default: header }, footers: { default: footer }, children: tail });

  const doc = new Document({
    creator: "BRITTO'S FORGEHSE", title: `${m.docNumber} ${m.title}`, description: `${t.label} — ${statusBanner(m)}`,
    styles: { default: { document: { run: { font: 'Calibri', size: 20, color: '1E293B' } } } },
    sections,
  });
  return Packer.toBuffer(doc);
}

/* =================================================================== PDF */

function winAnsi(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[■•]/g, '-').replace(/×/g, 'x').replace(/·/g, '-')
    .replace(/\t/g, ' ').replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, '?');
}
const hex = (h: string): RGB => rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);

class Flow {
  W = 595; H = 842; M = 44; y = 0; page!: PDFPage; pages: PDFPage[] = [];
  constructor(private pdf: PDFDocument, private f: PDFFont, private b: PDFFont, private m: DocExportMeta) {}
  newPage(landscape = false) {
    [this.W, this.H] = landscape ? [842, 595] : [595, 842];
    this.page = this.pdf.addPage([this.W, this.H]); this.pages.push(this.page);
    this.page.drawRectangle({ x: 0, y: this.H - 34, width: this.W, height: 34, color: hex(NAVY) });
    this.page.drawText("BRITTO'S FORGEHSE", { x: this.M, y: this.H - 21, size: 9, font: this.b, color: rgb(1, 1, 1) });
    const right = winAnsi(`${this.m.organization} - ${this.m.docNumber} - ${revisionLabel(this.m.revision)}`);
    this.page.drawText(right, { x: this.W - this.M - this.f.widthOfTextAtSize(right, 8), y: this.H - 21, size: 8, font: this.f, color: hex('C7D2FE') });
    this.y = this.H - 58;
  }
  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const out: string[] = [];
    for (const p of winAnsi(text).split('\n')) {
      let cur = '';
      for (const w of p.split(' ')) {
        const t = cur ? `${cur} ${w}` : w;
        if (font.widthOfTextAtSize(t, size) <= width) { cur = t; continue; }
        if (cur) out.push(cur);
        let piece = w;
        while (font.widthOfTextAtSize(piece, size) > width && piece.length > 1) {
          let k = piece.length; while (k > 1 && font.widthOfTextAtSize(piece.slice(0, k), size) > width) k--;
          out.push(piece.slice(0, k)); piece = piece.slice(k);
        }
        cur = piece;
      }
      out.push(cur);
    }
    return out;
  }
  ensure(h: number) { if (this.y - h < this.M + 26) this.newPage(this.W > this.H); }
  text(s: string, o: { size?: number; bold?: boolean; color?: string; indent?: number; gap?: number } = {}) {
    const size = o.size ?? 9.5, font = o.bold ? this.b : this.f, x = this.M + (o.indent ?? 0);
    for (const ln of this.wrap(s, font, size, this.W - 2 * this.M - (o.indent ?? 0))) {
      this.ensure(size * 1.4);
      this.page.drawText(ln, { x, y: this.y, size, font, color: hex(o.color ?? '1E293B') });
      this.y -= size * 1.4;
    }
    this.y -= o.gap ?? 3;
  }
  banner(s: string, draft: boolean) {
    const lines = this.wrap(s, this.b, 9, this.W - 2 * this.M - 12);
    const h = lines.length * 12.6 + 10;
    this.ensure(h);
    this.page.drawRectangle({ x: this.M, y: this.y - h + 9, width: this.W - 2 * this.M, height: h, color: hex(draft ? 'FEF3C7' : 'DCFCE7') });
    lines.forEach((ln, i) => this.page.drawText(ln, { x: this.M + 6, y: this.y - i * 12.6, size: 9, font: this.b, color: hex(draft ? AMBER : '15803D') }));
    this.y -= h + 4;
  }
  heading(s: string) { this.ensure(42); this.y -= 8; this.text(s, { size: 12, bold: true, color: NAVY, gap: 3 }); }
  bullets(xs: string[]) {
    for (const x of xs) { this.ensure(13); this.page.drawCircle({ x: this.M + 4, y: this.y + 3, size: 1.7, color: hex(BLUE) }); this.text(x, { indent: 13, gap: 1.5 }); }
    this.y -= 3;
  }
  table(head: string[], rows: Cell[][], widths: number[] | undefined, size = 7.8) {
    const total = this.W - 2 * this.M;
    const ws = (widths ?? head.map(() => 100 / head.length)).map((w) => (w / 100) * total);
    const lh = size * 1.32, pad = 3.5;
    const draw = (cells: Cell[], isHead: boolean) => {
      const wrapped = head.map((_, i) => this.wrap(cells[i]?.text ?? '', cells[i]?.bold || isHead ? this.b : this.f, size, ws[i]! - 2 * pad));
      const hgt = Math.max(...wrapped.map((w) => w.length)) * lh + 2 * pad;
      if (this.y - hgt < this.M + 26) { this.newPage(this.W > this.H); if (!isHead) draw(head.map((x) => ({ text: x })), true); }
      let x = this.M;
      head.forEach((_, i) => {
        const c = cells[i];
        this.page.drawRectangle({ x, y: this.y - hgt, width: ws[i]!, height: hgt, color: isHead ? hex(NAVY) : c?.fill ? hex(c.fill) : rgb(1, 1, 1), borderColor: hex('D6DCE8'), borderWidth: 0.5 });
        wrapped[i]!.forEach((ln, j) => this.page.drawText(ln, { x: x + pad, y: this.y - pad - size - j * lh + 1.5, size, font: c?.bold || isHead ? this.b : this.f, color: isHead ? rgb(1, 1, 1) : hex('1E293B') }));
        x += ws[i]!;
      });
      this.y -= hgt;
    };
    draw(head.map((x) => ({ text: x })), true);
    rows.forEach((r) => draw(r, false));
    this.y -= 8;
  }
  finish() {
    const s = winAnsi(footerLine(this.m));
    const draft = !isApproved(this.m) || !!this.m.snapshot;
    this.pages.forEach((pg, i) => {
      const { width } = pg.getSize();
      pg.drawLine({ start: { x: this.M, y: 30 }, end: { x: width - this.M, y: 30 }, thickness: 0.5, color: hex(BLUE) });
      pg.drawText(s.slice(0, 120), { x: this.M, y: 19, size: 7, font: this.b, color: hex(draft ? AMBER : SLATE) });
      const lab = `Page ${i + 1} of ${this.pages.length}`;
      pg.drawText(lab, { x: width - this.M - this.f.widthOfTextAtSize(lab, 7), y: 19, size: 7, font: this.f, color: hex(SLATE) });
    });
  }
}

export async function documentPdf(c: DocContent, m: DocExportMeta): Promise<Buffer> {
  const t = docType(m.docType);
  const draft = !isApproved(m) || !!m.snapshot;
  const pdf = await PDFDocument.create();
  pdf.setTitle(winAnsi(`${m.docNumber} ${m.title}`)); pdf.setSubject(winAnsi(statusBanner(m))); pdf.setCreator("BRITTO'S FORGEHSE"); pdf.setProducer("BRITTO'S FORGEHSE");
  const f = new Flow(pdf, await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold), m);
  f.newPage();
  f.text(t.label.toUpperCase(), { size: 8, bold: true, color: TEAL, gap: 6 });
  f.text(m.title, { size: 17, bold: true, color: NAVY, gap: 8 });
  f.banner(statusBanner(m), draft);
  f.table(['Document control', ''], controlRows(m).map(([k, v]) => [{ text: k, bold: true, fill: LIGHT }, { text: v }]), [28, 72], 8.4);
  let n = 1;
  for (const s of c.sections) {
    f.heading(`${n++}. ${s.heading}`);
    if (ORIGIN_LABEL[s.origin]) f.text(ORIGIN_LABEL[s.origin], { size: 7.5, bold: true, color: AMBER });
    s.text.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).forEach((x) => f.text(x, { gap: 5 }));
    if (s.bullets.length) f.bullets(s.bullets);
    if (s.table) f.table(s.table.columns, s.table.rows.map((r) => s.table!.columns.map((_, i) => ({ text: r[i] ?? '' }))), undefined);
  }
  if (t.riskRegister) {
    f.newPage(true);
    f.heading('Risk register');
    f.text(`Ratings on the organisation's ${m.matrix.size}x${m.matrix.size} matrix stored with this document. "Not rated" means the assessor has not yet rated the row.`, { size: 8, color: SLATE });
    f.table(RISK_HEAD, c.riskRows.map((r, i) => riskCells(r, i, m.matrix)), RISK_W, 6.8);
    f.newPage();
    f.heading(`${n++}. Risk matrix`);
    f.bullets(describeMatrix(m.matrix));
    const g = matrixGrid(m.matrix);
    f.table(g.head, g.rows, undefined, 7);
  }
  if (c.assumptions.length) { f.heading(`${n++}. Assumptions`); f.bullets(c.assumptions); }
  f.heading(`${n++}. Missing inputs`);
  if (c.missingInputs.length) f.bullets(c.missingInputs); else f.text('None recorded at the last save.');
  f.heading(`${n++}. Qualified review required`); f.bullets(c.reviewRequirements);
  f.heading(`${n++}. Approval`);
  f.table(['Role', 'Name', 'Date', 'Signature'], approvalRows(m).map((r) => r.map((x) => ({ text: x }))), [28, 34, 18, 20], 8.2);
  f.heading(`${n++}. Revision history`);
  f.table(['Revision', 'Event', 'By', 'Date', 'Note'], m.history.map((h) => [{ text: revisionLabel(h.revision) }, { text: h.event }, { text: h.actor }, { text: fmt(h.at, m.timezone) }, { text: h.note }]), [12, 16, 22, 16, 34], 7.8);
  f.finish();
  return Buffer.from(await pdf.save());
}
