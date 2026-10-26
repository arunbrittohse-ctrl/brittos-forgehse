/**
 * Generic lifecycle (state machine) definitions shared by every HSE module.
 *
 * Each module declares its states and named transitions here, BEFORE any workflow screen or API is
 * built, so the server, web app, mobile app and tests all enforce the same rules. Closure rules are
 * explicit: a transition can demand a comment, attached evidence and a verifier who is not the
 * person who submitted the work (segregation of duties).
 */

export interface TransitionDef<S extends string> {
  from: readonly S[];
  to: S;
  /** A reason / note must accompany the transition. */
  requiresComment?: boolean;
  /** At least one evidence attachment must exist on the record before this transition. */
  requiresEvidence?: boolean;
  /** The actor must not be the user who submitted the work being verified. */
  requiresIndependentVerifier?: boolean;
  /** Short description for screens and documentation. */
  label: string;
}

export interface Lifecycle<S extends string, T extends string> {
  states: readonly S[];
  initial: S;
  /** States from which no further work is expected (may still allow an authorised reopen). */
  terminal: readonly S[];
  transitions: Record<T, TransitionDef<S>>;
}

export function defineLifecycle<S extends string, T extends string>(l: Lifecycle<S, T>): Lifecycle<S, T> {
  return l;
}

export function transitionsFrom<S extends string, T extends string>(l: Lifecycle<S, T>, state: S): T[] {
  return (Object.keys(l.transitions) as T[]).filter((t) => l.transitions[t].from.includes(state));
}

export interface TransitionCheck { ok: boolean; reason?: string }

/** Pure rule check used by the server before it applies any status change. */
export function checkTransition<S extends string, T extends string>(
  l: Lifecycle<S, T>, transition: T, current: S,
  facts: { comment?: string; evidenceCount?: number; actorId?: string; submittedBy?: string | null } = {},
): TransitionCheck {
  const def = l.transitions[transition];
  if (!def) return { ok: false, reason: 'Unknown transition' };
  if (!def.from.includes(current)) return { ok: false, reason: `Not allowed from status "${current}"` };
  if (def.requiresComment && !facts.comment?.trim()) return { ok: false, reason: 'A comment is required' };
  if (def.requiresEvidence && !(facts.evidenceCount && facts.evidenceCount > 0)) return { ok: false, reason: 'Evidence must be attached first' };
  if (def.requiresIndependentVerifier && facts.actorId && facts.submittedBy && facts.actorId === facts.submittedBy) {
    return { ok: false, reason: 'The person who submitted the work cannot verify it' };
  }
  return { ok: true };
}

/** Structural validation of a lifecycle definition: used by the unit tests for every module. */
export function lifecycleProblems<S extends string, T extends string>(l: Lifecycle<S, T>): string[] {
  const problems: string[] = [];
  const states = new Set<string>(l.states);
  if (!states.has(l.initial)) problems.push(`initial state ${l.initial} is not declared`);
  for (const t of l.terminal) if (!states.has(t)) problems.push(`terminal state ${t} is not declared`);
  for (const [name, d] of Object.entries(l.transitions) as [string, TransitionDef<S>][]) {
    if (!states.has(d.to)) problems.push(`${name}: target ${d.to} is not declared`);
    for (const f of d.from) if (!states.has(f)) problems.push(`${name}: source ${f} is not declared`);
    if (d.from.length === 0) problems.push(`${name}: has no source state`);
  }
  // Every state must be reachable from the initial state.
  const seen = new Set<string>([l.initial]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of Object.values(l.transitions) as TransitionDef<S>[]) {
      if (d.from.some((f) => seen.has(f)) && !seen.has(d.to)) { seen.add(d.to); grew = true; }
    }
  }
  for (const s of l.states) if (!seen.has(s)) problems.push(`state ${s} is unreachable`);
  // Every non-terminal state must have a way forward.
  for (const s of l.states) {
    if (l.terminal.includes(s)) continue;
    if (!(Object.values(l.transitions) as TransitionDef<S>[]).some((d) => d.from.includes(s))) problems.push(`state ${s} is a dead end but not terminal`);
  }
  return problems;
}
