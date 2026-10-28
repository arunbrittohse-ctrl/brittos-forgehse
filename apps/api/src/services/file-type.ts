/**
 * Content-based file type detection for the document library.
 * The declared type and the file name are not trusted: the bytes must match an accepted format and
 * the file extension must agree with what the bytes are. Macro-enabled Office files are refused.
 */
import { LIBRARY_FILE_TYPES, EXTENSION_ALIASES } from '@forgehse/shared';

export type Detected = { ok: true; type: string; ext: string } | { ok: false; reason: string };

const ACCEPTED = new Map<string, string>(LIBRARY_FILE_TYPES.map((t) => [t.ext, t.type]));

function bytesType(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 5) === '%PDF-') return 'pdf';
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (/^(heic|heix|heim|heis|mif1|msf1|heif)$/.test(brand)) return 'heic';
    if (brand === 'qt  ') return 'mov';
    if (/^(M4A |M4B )$/.test(brand)) return 'm4a';
    if (/^(isom|iso2|iso4|iso5|iso6|mp41|mp42|avc1|dash|M4V |MSNV|3gp4|3gp5)$/.test(brand)) return 'mp4';
    return null;
  }
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    // OOXML packages store part names uncompressed in the ZIP headers.
    const names = buf.toString('latin1');
    if (/vbaProject\.bin|macroEnabled/i.test(names)) return 'macro';
    if (names.includes('word/document.xml')) return 'docx';
    if (names.includes('xl/workbook.xml')) return 'xlsx';
    if (names.includes('ppt/presentation.xml')) return 'pptx';
    return 'zip';
  }
  return null;
}

function isText(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true; } catch { return false; }
}

export function detectLibraryFile(buf: Buffer, filename: string): Detected {
  if (!buf.length) return { ok: false, reason: 'The file is empty' };
  const raw = (filename.split('.').pop() ?? '').toLowerCase();
  const ext = EXTENSION_ALIASES[raw] ?? raw;
  const found = bytesType(buf);
  if (found === 'macro') return { ok: false, reason: 'Macro-enabled Office files are not accepted. Save the file without macros (.docx, .xlsx, .pptx).' };
  if (found === 'zip') return { ok: false, reason: 'ZIP archives are not accepted. Upload the files individually.' };
  if (!found) {
    if (ext === 'csv' && isText(buf)) return { ok: true, type: 'text/csv', ext: 'csv' };
    return { ok: false, reason: 'This file type is not accepted. Use PDF, Word, Excel, PowerPoint, CSV, JPG, PNG, WebP, HEIC, MP4, MOV or M4A.' };
  }
  if (ext !== found) return { ok: false, reason: `The file name says .${raw || '(none)'} but the content is ${found.toUpperCase()}. Rename the file or upload the right one.` };
  return { ok: true, type: ACCEPTED.get(found)!, ext: found };
}

/** Types a browser may display in place (inside a sandboxed response). Everything else downloads. */
export const INLINE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mp4', 'text/csv']);
