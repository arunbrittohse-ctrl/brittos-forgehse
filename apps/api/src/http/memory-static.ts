/**
 * Serves the built web app from files embedded in the server bundle (for hosts that deploy a
 * single file, such as Prisma Compute). Same headers and fallback rules as ./static.ts.
 */
import type http from 'node:http';
import path from 'node:path';
import { WEB_CSP } from './static';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

export function createMemoryStaticHandler(filesB64: Record<string, string>) {
  const files = new Map(Object.entries(filesB64).map(([p, b]) => [p, Buffer.from(b, 'base64')]));
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let urlPath: string;
    try { urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname); } catch { return false; }
    let key = path.posix.normalize(urlPath);
    let body = files.get(key);
    if (!body) {
      if (path.posix.extname(key)) return false; // missing asset → 404, not index.html
      key = '/index.html';
      body = files.get(key);
      if (!body) return false;
    }
    res.setHeader('Content-Type', TYPES[path.posix.extname(key)] ?? 'application/octet-stream');
    res.setHeader('Content-Security-Policy', WEB_CSP);
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(self), camera=(self)');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Cache-Control', key.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.statusCode = 200;
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}
