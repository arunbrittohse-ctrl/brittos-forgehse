import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import JSZip from 'jszip';

export interface Column<T> { header: string; width: number; value: (row: T) => string | number | null }

export interface ReportMeta {
  title: string;
  organization: string;
  filters: string;
  generatedBy: string;
  generatedAt: Date;
  timezone: string;
}

/* ------------------------------------------------------------------ PDF */

const NAVY = rgb(0.043, 0.09, 0.2);
const ELECTRIC = rgb(0.15, 0.39, 0.92);
const GREY = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.86, 0.88, 0.91);

/**
 * pdf-lib's standard fonts only cover WinAnsi (Latin-1-ish). Characters outside it
 * (e.g. Arabic) are replaced with '?' here; embedding a Unicode font is listed as a follow-up.
 */
function winAnsiSafe(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

function fit(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = winAnsiSafe(text).split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const tryLine = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(tryLine, size) <= width) cur = tryLine;
    else {
      if (cur) lines.push(cur);
      let piece = w;
      while (font.widthOfTextAtSize(piece, size) > width && piece.length > 1) {
        let n = piece.length;
        while (n > 1 && font.widthOfTextAtSize(piece.slice(0, n), size) > width) n--;
        lines.push(piece.slice(0, n));
        piece = piece.slice(n);
      }
      cur = piece;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 6); // cap row height; full text is in the spreadsheet export
}

export async function registerPdf<T>(meta: ReportMeta, columns: Column<T>[], rows: T[], summary: [string, string][]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${meta.title} — ${meta.organization}`);
  pdf.setProducer("BRITTO'S FORGEHSE");
  pdf.setCreator("BRITTO'S FORGEHSE");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 842, H = 595, M = 32; // A4 landscape
  const totalWidth = columns.reduce((a, c) => a + c.width, 0);
  const scale = (W - 2 * M) / totalWidth;
  const stamp = meta.generatedAt.toLocaleString('en-GB', { timeZone: meta.timezone, dateStyle: 'medium', timeStyle: 'short' }) + ` (${meta.timezone})`;

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const header = (first: boolean) => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: H - 46, width: W, height: 46, color: NAVY });
    page.drawText("BRITTO'S FORGEHSE", { x: M, y: H - 22, size: 11, font: bold, color: rgb(1, 1, 1) });
    page.drawText('Engineered for Safety. Powered by Intelligence.', { x: M, y: H - 36, size: 7.5, font, color: rgb(0.75, 0.82, 0.95) });
    page.drawText(winAnsiSafe(meta.organization), { x: W - M - bold.widthOfTextAtSize(winAnsiSafe(meta.organization), 10), y: H - 27, size: 10, font: bold, color: rgb(1, 1, 1) });
    y = H - 70;
    if (first) {
      page.drawText(winAnsiSafe(meta.title), { x: M, y, size: 16, font: bold, color: NAVY });
      y -= 16;
      page.drawText(winAnsiSafe(`Filters: ${meta.filters}`), { x: M, y, size: 8, font, color: GREY });
      y -= 11;
      page.drawText(winAnsiSafe(`Generated ${stamp} by ${meta.generatedBy}. Source: live FORGEHSE database records.`), { x: M, y, size: 8, font, color: GREY });
      y -= 18;
      let x = M;
      for (const [label, value] of summary) {
        page.drawRectangle({ x, y: y - 30, width: 118, height: 34, borderColor: LINE, borderWidth: 1, color: rgb(0.97, 0.98, 0.99) });
        page.drawText(winAnsiSafe(value), { x: x + 8, y: y - 13, size: 13, font: bold, color: NAVY });
        page.drawText(winAnsiSafe(label), { x: x + 8, y: y - 25, size: 7, font, color: GREY });
        x += 124;
      }
      y -= 46;
    }
    // table header
    page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 16, color: rgb(0.93, 0.95, 0.98) });
    let x = M + 3;
    for (const c of columns) { page.drawText(c.header, { x, y, size: 7.5, font: bold, color: NAVY }); x += c.width * scale; }
    y -= 16;
  };

  header(true);
  if (rows.length === 0) page.drawText('No records match the selected filters.', { x: M, y: y - 4, size: 9, font, color: GREY });
  for (const row of rows) {
    const cells = columns.map((c) => fit(String(c.value(row) ?? ''), font, 7.5, c.width * scale - 6));
    const height = Math.max(...cells.map((l) => l.length)) * 9.5 + 5;
    if (y - height < M + 20) header(false);
    let x = M + 3;
    cells.forEach((lines, i) => {
      lines.forEach((ln, j) => page.drawText(ln, { x, y: y - j * 9.5, size: 7.5, font, color: rgb(0.1, 0.12, 0.16) }));
      x += columns[i]!.width * scale;
    });
    y -= height;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.5, color: LINE });
  }

  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: W - M - font.widthOfTextAtSize(label, 7.5), y: 16, size: 7.5, font, color: GREY });
    p.drawText(winAnsiSafe(`${meta.title} - ${stamp}`), { x: M, y: 16, size: 7.5, font, color: GREY });
    p.drawLine({ start: { x: M, y: 28 }, end: { x: W - M, y: 28 }, thickness: 0.5, color: ELECTRIC });
  });
  return Buffer.from(await pdf.save());
}

/* ------------------------------------------------------------------ XLSX (minimal SpreadsheetML) */

function xmlEscape(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}
function colName(i: number) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

/** Neutralise spreadsheet formula injection in user-entered text. */
export function safeCell(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export async function registerXlsx<T>(sheetName: string, meta: ReportMeta, columns: Column<T>[], rows: T[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B1733"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf fontId="2" applyFont="1"/><xf applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs></styleSheet>`);

  const cell = (ref: string, v: string | number | null, style = 3) =>
    v === null || v === '' ? '' : typeof v === 'number' ? `<c r="${ref}" s="${style}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlEscape(safeCell(v))}</t></is></c>`;
  const rowsXml: string[] = [];
  rowsXml.push(`<row r="1">${cell('A1', `${meta.title} — ${meta.organization}`, 2)}</row>`);
  rowsXml.push(`<row r="2">${cell('A2', `Filters: ${meta.filters} | Generated ${meta.generatedAt.toISOString()} by ${meta.generatedBy}`, 0)}</row>`);
  rowsXml.push(`<row r="4">${columns.map((c, i) => cell(`${colName(i)}4`, c.header, 1)).join('')}</row>`);
  rows.forEach((r, ri) => {
    const n = ri + 5;
    rowsXml.push(`<row r="${n}">${columns.map((c, i) => cell(`${colName(i)}${n}`, c.value(r))).join('')}</row>`);
  });
  const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(8, Math.round(c.width / 5))}" customWidth="1"/>`).join('');
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${rowsXml.join('')}</sheetData><autoFilter ref="A4:${colName(columns.length - 1)}${Math.max(4, rows.length + 4)}"/></worksheet>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export function registerCsv<T>(columns: Column<T>[], rows: T[]): Buffer {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : safeCell(String(v));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.header)).join(','), ...rows.map((r) => columns.map((c) => esc(c.value(r))).join(','))];
  return Buffer.from('﻿' + lines.join('\r\n'), 'utf8');
}
