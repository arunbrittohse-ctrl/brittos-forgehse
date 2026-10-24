import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * Object storage abstraction. Keys are server-generated (never user filenames).
 * LocalDiskStorage is for development and single-server installs; an S3-compatible
 * implementation (AWS S3 / MinIO) should implement the same interface for production.
 */
export interface ObjectStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class LocalDiskStorage implements ObjectStorage {
  private root: string;
  constructor(dir: string) { this.root = path.resolve(dir); }
  private resolve(key: string) {
    if (!/^[a-z0-9/_-]+$/i.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    return path.join(this.root, key);
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data, { flag: 'wx', mode: 0o600 });
  }
  get(key: string) { return readFile(this.resolve(key)); }
  async delete(key: string) { await unlink(this.resolve(key)).catch(() => undefined); }
}

export class MemoryStorage implements ObjectStorage {
  files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) { this.files.set(key, data); }
  async get(key: string) { const f = this.files.get(key); if (!f) throw new Error('not found'); return f; }
  async delete(key: string) { this.files.delete(key); }
}

/** Allowed upload types, identified by magic bytes — the client-declared type is not trusted. */
export function sniffContentType(buf: Buffer): { type: string; ext: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: 'png' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  if (buf.toString('ascii', 0, 5) === '%PDF-') return { type: 'application/pdf', ext: 'pdf' };
  if (buf.toString('ascii', 4, 8) === 'ftyp' && /heic|heix|mif1|heif/.test(buf.toString('ascii', 8, 12))) return { type: 'image/heic', ext: 'heic' };
  return null;
}
