/**
 * OFFLINE-ONLY minimal React typings, used by `npm run typecheck:offline` when @types/react
 * cannot be installed (air-gapped build environment). Hooks and event types are typed;
 * JSX element props are intentionally loose. With network access, install @types/react and
 * use `npm run typecheck` (tsconfig.json), which ignores this folder.
 */
declare module 'react' {
  export type ReactNode = ReactElement | string | number | bigint | boolean | null | undefined | Iterable<ReactNode>;
  export interface ReactElement { type: unknown; props: unknown; key: string | null }
  export type Key = string | number;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: readonly unknown[]): T;
  export interface RefObject<T> { current: T }
  export function useRef<T>(initial: T): RefObject<T>;
  export function useRef<T>(initial: T | null): RefObject<T | null>;
  export function useSyncExternalStore<T>(subscribe: (cb: () => void) => () => void, getSnapshot: () => T): T;
  export interface Context<T> { Provider: (props: { value: T; children?: ReactNode }) => ReactElement }
  export function createContext<T>(value: T): Context<T>;
  export function useContext<T>(ctx: Context<T>): T;
  export const Fragment: unknown;

  interface SyntheticEvent<T = Element> { target: EventTarget; currentTarget: T; preventDefault(): void; stopPropagation(): void; defaultPrevented: boolean }
  export interface FormEvent<T = Element> extends SyntheticEvent<T> {}
  export interface ChangeEvent<T = Element> extends SyntheticEvent<T> { target: T & EventTarget }
  export interface MouseEvent<T = Element> extends SyntheticEvent<T> { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }
  export interface KeyboardEvent<T = Element> extends SyntheticEvent<T> { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; nativeEvent: { isComposing: boolean } }
  export type CSSProperties = Record<string, string | number | undefined>;
  export interface HTMLAttributes<T> { className?: string; id?: string; title?: string; role?: string; style?: CSSProperties; onClick?: (e: MouseEvent<T>) => void; [attr: `aria-${string}`]: unknown; [attr: `data-${string}`]: unknown }
  export interface AnchorHTMLAttributes<T> { href?: string; className?: string; target?: string; rel?: string; title?: string; style?: Record<string, unknown>; role?: string; onClick?: (e: MouseEvent<T>) => void; [attr: `aria-${string}`]: unknown }
}

declare module 'react/jsx-runtime' {
  export const jsx: unknown;
  export const jsxs: unknown;
  export const Fragment: unknown;
}

declare module 'react-dom/client' {
  export function createRoot(el: Element): { render(node: unknown): void; unmount(): void };
}

declare namespace JSX {
  type Element = import('react').ReactElement;
  interface ElementChildrenAttribute { children: {} }
  interface IntrinsicAttributes { key?: string | number }
  interface IntrinsicElements { [tag: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
}
