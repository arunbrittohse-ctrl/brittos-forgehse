import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type http from 'node:http';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

/** Content Security Policy for the web app: no inline script, no third-party origins. */
export const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** Serves the built single-page app; unknown paths fall back to index.html for client-side routing. */
export function createStaticHandler(rootDir: string) {
  const root = path.resolve(rootDir);
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let file = path.resolve(root, '.' + urlPath);
    if (!file.startsWith(root + path.sep) && file !== root) return false; // path traversal guard
    let info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) {
      if (path.extname(urlPath)) return false; // missing asset → 404, not index.html
      file = path.join(root, 'index.html');
      info = await stat(file).catch(() => null);
      if (!info) return false;
    }
    const ext = path.extname(file);
    res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
    res.setHeader('Content-Security-Policy', WEB_CSP);
    // The web app itself may use the microphone (voice dictation) and camera (site photos) — same origin only.
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(self), camera=(self)');
    res.setHeader('Cache-Control', /\/assets\//.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.statusCode = 200;
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    return true;
  };
}
