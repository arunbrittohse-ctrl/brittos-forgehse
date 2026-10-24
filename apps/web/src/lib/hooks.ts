import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> { data: T | undefined; error: Error | undefined; loading: boolean; reload: () => void }

/** Load data when dependencies change; ignores stale responses. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fn().then(
      (data) => { if (mine === seq.current) setState({ data, loading: false }); },
      (error: Error) => { if (mine === seq.current) setState((s) => ({ data: s.data, error, loading: false })); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: state.data, error: state.error, loading: state.loading, reload };
}

/** Persisted per-browser preference. Storage can be unavailable (private mode); fall back to memory. */
export function readPref(key: string, fallback: string): string {
  try { return localStorage.getItem(`fhse.${key}`) ?? fallback; } catch { return fallback; }
}
export function writePref(key: string, value: string) {
  try { localStorage.setItem(`fhse.${key}`, value); } catch { /* ignore */ }
}
