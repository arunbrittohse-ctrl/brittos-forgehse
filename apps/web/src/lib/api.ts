/** Thin fetch wrapper. Same-origin cookie session; the custom header is the CSRF defence the API requires. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function qs(q: Query = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

let onUnauthorized: (() => void) | null = null;
let onPasswordChange: (() => void) | null = null;
export function setAuthHandlers(h: { unauthorized: () => void; passwordChange: () => void }) {
  onUnauthorized = h.unauthorized;
  onPasswordChange = h.passwordChange;
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; query?: Query; file?: Blob } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'forgehse' };
  let body: BodyInit | undefined;
  if (opts.file) { body = opts.file; headers['Content-Type'] = opts.file.type || 'application/octet-stream'; }
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['Content-Type'] = 'application/json'; }
  let res: Response;
  try {
    res = await fetch(`/api${path}${qs(opts.query)}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    const err = data?.error ?? {};
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
    if (err.code === 'password_change_required') onPasswordChange?.();
    throw new ApiError(res.status, err.code ?? 'error', err.message ?? `Request failed (${res.status})`, err.details);
  }
  return data as T;
}

/** Field-level messages from a validation error, keyed by field path. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return {};
  const out: Record<string, string> = {};
  for (const d of e.details as { path: string; message: string }[]) out[d.path] = d.message;
  return out;
}
