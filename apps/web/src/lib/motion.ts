/**
 * Motion preferences. The OS "reduce motion" setting always wins; users can also reduce motion
 * in-app (Account → Sound & motion). Reduced motion never disables sound and vice versa.
 */
import { useSyncExternalStore } from 'react';
import { readPref, writePref } from './hooks';

const listeners = new Set<() => void>();
const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
mq?.addEventListener?.('change', () => listeners.forEach((l) => l()));

export function userReducedMotion(): boolean { return readPref('reduceMotion', 'false') === 'true'; }
export function reducedMotion(): boolean { return Boolean(mq?.matches) || userReducedMotion(); }

export function setUserReducedMotion(v: boolean) {
  writePref('reduceMotion', String(v));
  applyMotion();
  listeners.forEach((l) => l());
}

export function applyMotion() {
  document.documentElement.dataset.motion = userReducedMotion() ? 'reduced' : 'full';
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, reducedMotion);
}

/** Run a DOM update inside a View Transition when the browser supports it and motion is allowed. */
export function withViewTransition(update: () => void) {
  type VT = { ready?: Promise<void>; finished?: Promise<void>; updateCallbackDone?: Promise<void> };
  const d = document as Document & { startViewTransition?: (cb: () => void) => VT };
  if (!d.startViewTransition || reducedMotion()) { update(); return; }
  try {
    const t = d.startViewTransition(update);
    // A transition can be skipped (e.g. the viewport resized); the DOM update still happens. Swallow the rejection.
    const ignore = () => undefined;
    t?.ready?.catch(ignore); t?.finished?.catch(ignore); t?.updateCallbackDone?.catch(ignore);
  } catch { update(); }
}
