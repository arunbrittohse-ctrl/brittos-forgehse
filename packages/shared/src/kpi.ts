/**
 * KPI formulas. All are pure functions so they can be unit-tested and
 * documented in one place.
 *
 * Frequency rate = (number of cases × normalisation base) ÷ total man-hours worked.
 * The base is configurable because organisations report differently:
 *   - 1,000,000 hours is common for LTIFR in UAE/GCC and many corporate standards
 *   - 200,000 hours (100 workers × 2,000 h) is the OSHA-style base used for TRIR / DART
 * Which base and which case definitions apply is an organisational or client
 * contract decision; FORGEHSE does not assume one is legally mandated.
 */

export const FREQUENCY_BASES = { perMillion: 1_000_000, osha200k: 200_000 } as const;

export function frequencyRate(cases: number, manHours: number, base: number = FREQUENCY_BASES.perMillion): number | null {
  if (cases < 0 || manHours < 0 || base <= 0) throw new RangeError('cases, manHours must be ≥ 0 and base > 0');
  if (manHours === 0) return null; // undefined, not zero — avoid reporting a misleading 0.00
  return Math.round(((cases * base) / manHours) * 100) / 100;
}

/** Percentage of actions closed on or before their due date. null when there is nothing due. */
export function onTimeClosureRate(closedOnTime: number, totalDue: number): number | null {
  if (totalDue === 0) return null;
  return Math.round((closedOnTime / totalDue) * 1000) / 10;
}

/**
 * Sum man-hours from daily entries without double counting:
 * one entry per (site, date, employer) is the unit of record; later corrections replace earlier ones.
 */
export function totalManHours(entries: { siteId: string; date: string; employer: string; hours: number; revision: number }[]): number {
  const latest = new Map<string, { hours: number; revision: number }>();
  for (const e of entries) {
    const key = `${e.siteId}|${e.date}|${e.employer}`;
    const prev = latest.get(key);
    if (!prev || e.revision > prev.revision) latest.set(key, { hours: e.hours, revision: e.revision });
  }
  let sum = 0;
  for (const v of latest.values()) sum += v.hours;
  return sum;
}
