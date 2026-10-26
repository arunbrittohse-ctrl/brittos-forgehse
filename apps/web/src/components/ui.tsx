import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { STATUS_LABELS, type ObservationStatus, type RiskBand } from '@forgehse/shared';
import { ApiError } from '../lib/api';
import { NodeRing } from './graphics';

/* ---------------------------------------------------------------- icons (stroke, 20px grid) */
const PATHS: Record<string, string> = {
  dashboard: 'M3 3h6v8H3zM11 3h6v5h-6zM11 10h6v7h-6zM3 13h6v4H3z',
  eye: 'M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6S1.5 10 1.5 10zM10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  plus: 'M10 4v12M4 10h12',
  spark: 'M10 2l1.8 4.7L16.5 8.5l-4.7 1.8L10 15l-1.8-4.7L3.5 8.5l4.7-1.8zM16 13l.8 2.2L19 16l-2.2.8L16 19l-.8-2.2L13 16l2.2-.8z',
  folder: 'M2.5 5.5a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z',
  users: 'M7.5 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM1.5 17c0-3 2.7-5 6-5s6 2 6 5M13.5 3.2a3 3 0 0 1 0 5.6M15.5 12.3c1.8.6 3 2.2 3 4.7',
  shield: 'M10 2l6.5 2.5v5c0 4-2.8 7-6.5 8.5C6.3 16.5 3.5 13.5 3.5 9.5v-5z',
  chart: 'M3 17h14M5 14V9M9 14V5M13 14v-7M17 14v-3',
  user: 'M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 18c0-3.5 3.1-5.5 7-5.5s7 2 7 5.5',
  logout: 'M8 3H4v14h4M12 6l4 4-4 4M16 10H8',
  menu: 'M3 5h14M3 10h14M3 15h14',
  download: 'M10 3v10M6 9l4 4 4-4M4 16h12',
  upload: 'M10 14V4M6 8l4-4 4 4M4 16h12',
  x: 'M5 5l10 10M15 5L5 15',
  moon: 'M16.5 12.5A7 7 0 0 1 7.5 3.5a7 7 0 1 0 9 9z',
  sun: 'M10 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6L16 16M4 16l1.4-1.4M14.6 5.4L16 4',
  check: 'M4 10.5l4 4 8-9',
  search: 'M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM13.5 13.5L17 17',
  mic: 'M10 2.5a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-5 0V5A2.5 2.5 0 0 1 10 2.5zM5 9.5a5 5 0 0 0 10 0M10 14.5V18M7 18h6',
  send: 'M17.5 2.5L9 11M17.5 2.5l-5 15-3.5-6.5-6.5-3.5z',
  clip: 'M14.5 9.5l-5.6 5.6a3.5 3.5 0 0 1-5-5l6.4-6.4a2.3 2.3 0 0 1 3.3 3.3L7.4 13.2a1.2 1.2 0 0 1-1.7-1.7l5.5-5.5',
  stop: 'M6 6h8v8H6z',
  volume: 'M3 8h3l4-3.5v11L6 12H3zM13.5 7a4 4 0 0 1 0 6M15.5 4.5a7.5 7.5 0 0 1 0 11',
  mute: 'M3 8h3l4-3.5v11L6 12H3zM13 8l4 4M17 8l-4 4',
  checklist: 'M8.5 5h8.5M8.5 10h8.5M8.5 15h8.5M3 5l1.2 1.2L6.5 4M3 10l1.2 1.2L6.5 9M3 15l1.2 1.2L6.5 14',
  doc: 'M5 2.5h7l3.5 3.5v11.5H5zM12 2.5V6h3.5M7.5 10h5M7.5 13h5',
  image: 'M3 3h14v14H3zM3 13l4-4 4 4 2-2 4 4M13 7.5h.01',
  flow: 'M3 3h6v4H3zM11 13h6v4h-6zM6 7v3h8v3',
  review: 'M9 15A6 6 0 1 0 9 3a6 6 0 0 0 0 12zM13.5 13.5L17 17M6.5 9l1.8 1.8L12 7',
  copy: 'M7 7h10v10H7zM3 13V3h10',
  trash: 'M3.5 5h13M8 5V3h4v2M5 5l1 12h8l1-12',
  history: 'M3 10a7 7 0 1 0 2-4.9M3 3v3.5h3.5M10 6v4l3 2',
  library: 'M3 3h4v14H3zM8 3h4v14H8zM13 4.2l3.3-.9 2.7 13.3-3.3.9z',
  arrow: 'M4 10h12M11 5l5 5-5 5',
  edit: 'M3 17h3.5L16 7.5 12.5 4 3 13.5zM11 5.5l3.5 3.5',
  refresh: 'M16 4v4h-4M4 16v-4h4M15.5 8A6 6 0 0 0 5 6.5M4.5 12a6 6 0 0 0 10.5 1.5',
  print: 'M5 7V3h10v4M5 14H3V8h14v6h-2M5 11h10v6H5z',
  chevron: 'M7 5l5 5-5 5',
  alert: 'M10 2.5l8 14.5H2zM10 8v4M10 14.5v.3',
  helmet: 'M2.5 14.5h15M4.5 14.5v-2a5.5 5.5 0 0 1 11 0v2M8.5 7V4.5h3V7',
  globe: 'M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM2 10h16M10 2c2.5 2.7 2.5 13.3 0 16M10 2c-2.5 2.7-2.5 13.3 0 16',
  camera: 'M2.5 6.5a1 1 0 0 1 1-1h3l1.5-2h4l1.5 2h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1zM10 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
};
export function Icon({ name, size = 18, label }: { name: keyof typeof PATHS | string; size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

/* ---------------------------------------------------------------- status */
export function StatusBadge({ status, overdue }: { status: ObservationStatus; overdue?: boolean }) {
  if (overdue) return <span className="badge s-overdue">Overdue</span>;
  return <span className={`badge s-${status}`}>{STATUS_LABELS[status]}</span>;
}
const BAND_LABEL: Record<RiskBand, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
export function RiskChip({ band, score }: { band: RiskBand; score?: number }) {
  return <span className={`risk risk-${band}`}>{score !== undefined && <span className="score">{score}</span>}{BAND_LABEL[band]}</span>;
}

/* ---------------------------------------------------------------- feedback */
export function Loading({ label = 'Loading' }: { label?: string }) {
  return <div className="loading" role="status"><NodeRing />{label}…</div>;
}
export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : 'Something went wrong while loading this page.';
  return (
    <div className="notice error row" role="alert">
      <span>{msg}</span>
      {retry && <button className="btn btn-sm" onClick={retry}>Try again</button>}
    </div>
  );
}
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}

/* ---------------------------------------------------------------- dialog */
export function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" ref={ref}>
        <div className="dialog-head row"><h2 id="dlg-title">{title}</h2><span className="spacer" /><button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="dialog-body stack">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- toasts */
type Toast = { id: number; text: string; kind: 'ok' | 'error' };
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((t) => [...t, { id, text, kind }]);
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">{items.map((t) => <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------------------------------------------------------------- form field */
export function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="error" id={`${htmlFor}-err`}>{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  return (
    <div className="row small muted" style={{ padding: '12px 18px' }}>
      <span className="num">{(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}</span>
      <span className="spacer" />
      <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <button className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}
