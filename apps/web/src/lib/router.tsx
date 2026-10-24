import { useSyncExternalStore, type MouseEvent, type ReactNode, type AnchorHTMLAttributes } from 'react';
import { withViewTransition } from './motion';

/** Minimal history router: no dependency, enough for this app. */
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
window.addEventListener('popstate', emit);

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.scrollTo(0, 0);
  emit();
}

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function useLocation(): { path: string; search: URLSearchParams } {
  const href = useSyncExternalStore(subscribe, () => location.pathname + location.search);
  const u = new URL(href, location.origin);
  return { path: u.pathname, search: u.searchParams };
}

/** Match `/app/observations/:id` against a path. Returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.startsWith(':')) params[a[i]!.slice(1)] = decodeURIComponent(b[i]!);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function setQuery(updates: Record<string, string | undefined>) {
  const u = new URL(location.href);
  for (const [k, v] of Object.entries(updates)) v ? u.searchParams.set(k, v) : u.searchParams.delete(k);
  navigate(u.pathname + u.search, { replace: true });
}

export function Link({ to, children, onClick, ...rest }: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    withViewTransition(() => navigate(to));
  };
  return <a href={to} onClick={handle} {...rest}>{children}</a>;
}
