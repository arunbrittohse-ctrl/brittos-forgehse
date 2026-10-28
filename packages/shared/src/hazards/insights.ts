/**
 * Explainable risk insights (Phase 4). Plain rules over stored records — no trained model, no
 * prediction claim. Every alert carries the facts, the underlying records, why it fired, its
 * limitations and recommended human actions. Data sources that the platform does not hold
 * (weather, training, inspections, incidents) are reported as unavailable rather than guessed.
 */
import type { RiskBand } from '../risk';
import type { HazardCategoryDef } from './register';

export interface InsightEvidence { type: 'observation' | 'hazard'; id: string; ref: string; label: string; date?: string }
export interface Insight {
  id: string;
  rule: string;
  severity: 'info' | 'warning' | 'high';
  title: string;
  reason: string;
  facts: string[];
  evidence: InsightEvidence[];
  limitations: string[];
  recommendedActions: string[];
  basis: 'rule';
}

export interface ObsRow { id: string; ref: string; siteId: string; siteName: string; category: string; type: string; band: RiskBand; status: string; dueDate: string | null; observedAt: string; description: string; closedAt: string | null; verification: string | null }
export interface HazardRow { id: string; ref: string; category: string; categoryLabel: string; status: string; residualBand: RiskBand | null; reviewDate: string | null; overdueControls: { text: string; dueDate: string }[]; activity: string }

export const INSIGHT_RULES = {
  window: 90,
  repeatedMin: 3,
  nearMissMin: 2,
} as const;

export const INSIGHT_DISCLAIMER = 'Rule-based alerts calculated from records in FORGEHSE. They are not a scientifically validated prediction and do not replace the judgement of a competent person.';

export const UNAVAILABLE_SOURCES = [
  'Weather, heat and environmental alerts: no reliable weather or monitoring feed is connected, so none are shown.',
  'Training and competency expiry: the training module is not live yet (Phase 8).',
  'Inspection expiry: the inspections module is not live yet (Phase 6).',
  'Incidents and investigations: the incidents module is not live yet (Phase 6); near-miss signals come from observations only.',
];

function dayDiff(a: string, b: string) { return Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000); }

export function buildInsights(input: { today: string; observations: ObsRow[]; hazards: HazardRow[]; categories: HazardCategoryDef[] }): Insight[] {
  const { today, observations, hazards, categories } = input;
  const out: Insight[] = [];
  const recent = observations.filter((o) => dayDiff(today, o.observedAt.slice(0, 10)) <= INSIGHT_RULES.window && o.status !== 'cancelled');

  // 1. Repeated hazards at a site (same observation category).
  const bySiteCat = new Map<string, ObsRow[]>();
  for (const o of recent) { const k = `${o.siteId}|${o.category}`; bySiteCat.set(k, [...(bySiteCat.get(k) ?? []), o]); }
  for (const [k, rows] of bySiteCat) {
    if (rows.length < INSIGHT_RULES.repeatedMin) continue;
    const [, cat] = k.split('|');
    const reg = hazards.filter((h) => categories.find((c) => c.key === h.category)?.observationCategories.includes(cat!) && h.status === 'approved');
    out.push({
      id: `repeat:${k}`, rule: 'repeated_hazard', severity: rows.some((r) => r.band === 'high' || r.band === 'critical') ? 'high' : 'warning',
      title: `${rows.length} "${cat}" observations at ${rows[0]!.siteName} in ${INSIGHT_RULES.window} days`,
      reason: `Fires when one site has ${INSIGHT_RULES.repeatedMin} or more observations in the same hazard category within ${INSIGHT_RULES.window} days.`,
      facts: [`${rows.length} observations, ${rows.filter((r) => r.band === 'high' || r.band === 'critical').length} rated high or critical.`, reg.length ? `${reg.length} approved register entr${reg.length === 1 ? 'y covers' : 'ies cover'} this hazard family.` : 'No approved hazard register entry covers this hazard family.'],
      evidence: rows.slice(0, 10).map((r) => ({ type: 'observation', id: r.id, ref: r.ref, label: r.description.slice(0, 90), date: r.observedAt.slice(0, 10) })),
      limitations: ['Counts depend on what people reported; under-reporting hides repeats.', 'Observation categories are mapped to register categories by configuration.'],
      recommendedActions: [reg.length ? 'Review the linked register entries: are the recorded controls actually effective at this site?' : 'Add or update a hazard register entry for this hazard family at this site.', 'Brief the finding at the next toolbox talk and check the controls in the field.'],
      basis: 'rule',
    });
  }

  // 2. Recurring near misses.
  const nm = new Map<string, ObsRow[]>();
  for (const o of recent.filter((x) => x.type === 'near_miss_observed')) nm.set(o.category, [...(nm.get(o.category) ?? []), o]);
  for (const [cat, rows] of nm) {
    if (rows.length < INSIGHT_RULES.nearMissMin) continue;
    out.push({
      id: `nearmiss:${cat}`, rule: 'recurring_near_miss', severity: 'high',
      title: `${rows.length} near misses in "${cat}" in ${INSIGHT_RULES.window} days`,
      reason: `Fires when ${INSIGHT_RULES.nearMissMin} or more near misses share a hazard category within ${INSIGHT_RULES.window} days.`,
      facts: [`Sites: ${[...new Set(rows.map((r) => r.siteName))].join(', ')}.`],
      evidence: rows.slice(0, 10).map((r) => ({ type: 'observation', id: r.id, ref: r.ref, label: r.description.slice(0, 90), date: r.observedAt.slice(0, 10) })),
      limitations: ['Near misses are taken from observations; formal incident records are not available yet.'],
      recommendedActions: ['Reassess the related hazard register entries and the effectiveness of their controls.', 'Consider whether an investigation is needed.'],
      basis: 'rule',
    });
  }

  // 3. Overdue high-risk corrective actions (observations).
  const overdue = observations.filter((o) => (o.band === 'high' || o.band === 'critical') && (o.status === 'assigned' || o.status === 'open') && o.dueDate && o.dueDate < today);
  if (overdue.length) out.push({
    id: 'overdue-actions', rule: 'overdue_high_risk_actions', severity: 'high',
    title: `${overdue.length} high or critical observation action(s) overdue`,
    reason: 'Fires for every high or critical observation whose action due date has passed while it is still open or assigned.',
    facts: overdue.slice(0, 5).map((o) => `${o.ref}: due ${o.dueDate}, ${dayDiff(today, o.dueDate!)} day(s) late.`),
    evidence: overdue.slice(0, 15).map((o) => ({ type: 'observation', id: o.id, ref: o.ref, label: o.description.slice(0, 90), date: o.dueDate! })),
    limitations: ['Uses the due dates recorded on observations.'],
    recommendedActions: ['Escalate to the action owners\' manager.', 'Confirm interim controls are in place until the action is closed.'],
    basis: 'rule',
  });

  // 4. Hazard register: overdue additional controls.
  const ctl = hazards.filter((h) => h.overdueControls.length && h.status !== 'archived');
  if (ctl.length) out.push({
    id: 'overdue-controls', rule: 'overdue_register_controls', severity: 'warning',
    title: `${ctl.reduce((n, h) => n + h.overdueControls.length, 0)} planned control(s) past their due date`,
    reason: 'Fires for additional controls still "planned" after their due date.',
    facts: ctl.slice(0, 5).map((h) => `${h.ref}: ${h.overdueControls.map((c) => `${c.text.slice(0, 40)} (due ${c.dueDate})`).join('; ')}`),
    evidence: ctl.slice(0, 15).map((h) => ({ type: 'hazard', id: h.id, ref: h.ref, label: h.activity.slice(0, 90) })),
    limitations: ['Depends on owners updating control status.'],
    recommendedActions: ['Confirm with the owners whether the controls are in place, then reassess the residual risk.'],
    basis: 'rule',
  });

  // 5. Review dates passed.
  const rev = hazards.filter((h) => h.status === 'approved' && h.reviewDate && h.reviewDate < today);
  if (rev.length) out.push({
    id: 'review-overdue', rule: 'review_overdue', severity: 'warning',
    title: `${rev.length} approved hazard assessment(s) past their review date`,
    reason: 'Fires when an approved register entry\'s review date has passed.',
    facts: rev.slice(0, 5).map((h) => `${h.ref}: review was due ${h.reviewDate}.`),
    evidence: rev.slice(0, 15).map((h) => ({ type: 'hazard', id: h.id, ref: h.ref, label: h.activity.slice(0, 90), date: h.reviewDate! })),
    limitations: ['Review dates are set by the assessor.'],
    recommendedActions: ['Reassess each entry and start a new revision where anything has changed.'],
    basis: 'rule',
  });

  // 6. High residual risk still being worked under.
  const high = hazards.filter((h) => h.status === 'approved' && (h.residualBand === 'high' || h.residualBand === 'critical'));
  if (high.length) out.push({
    id: 'high-residual', rule: 'high_residual', severity: 'high',
    title: `${high.length} approved hazard(s) with HIGH residual risk`,
    reason: 'Fires for approved entries whose residual band is high or critical.',
    facts: high.slice(0, 5).map((h) => `${h.ref} (${h.categoryLabel}): residual ${h.residualBand!.toUpperCase()}.`),
    evidence: high.slice(0, 15).map((h) => ({ type: 'hazard', id: h.id, ref: h.ref, label: h.activity.slice(0, 90) })),
    limitations: ['Ratings are the assessor\'s judgement on the organisation matrix.'],
    recommendedActions: ['Look for further engineering controls; confirm supervision and permits for this work.'],
    basis: 'rule',
  });

  return out.sort((a, b) => ['high', 'warning', 'info'].indexOf(a.severity) - ['high', 'warning', 'info'].indexOf(b.severity));
}

/** Closed observations in the same hazard family whose action was verified — lessons to reuse. */
export function verifiedLessons(category: HazardCategoryDef | undefined, observations: ObsRow[]) {
  if (!category) return [];
  return observations
    .filter((o) => o.status === 'closed' && o.verification && category.observationCategories.includes(o.category))
    .slice(0, 8)
    .map((o) => ({ id: o.id, ref: o.ref, closedAt: o.closedAt, description: o.description.slice(0, 140), verification: o.verification!.slice(0, 240) }));
}
