/**
 * Hazard register and risk engine (Phase 4).
 *
 * Scoring uses the organisation's configurable matrix (../risk.ts). The engine treats inherent
 * (initial) and residual risk separately and does NOT accept a lower residual risk just because a
 * control was typed in: a reduction must be supported by controls that are implemented and whose
 * effectiveness has been assessed, plus a written justification. Planned controls only give a
 * "target" residual risk, never the current one.
 */
import { z } from 'zod';
import { calculateRisk, type RiskBand, type RiskMatrixConfig } from '../risk';
import { defineLifecycle } from '../domains/lifecycle';

/* ---------------------------------------------------------------- categories (configurable) */

export interface HazardCategoryDef { key: string; label: string; /** Observation categories that count as the same hazard family for insights. */ observationCategories: string[] }

export const DEFAULT_REGISTER_CATEGORIES: HazardCategoryDef[] = [
  { key: 'electrical_energy', label: 'Electrical energy', observationCategories: ['Electrical'] },
  { key: 'arc_flash', label: 'Arc flash', observationCategories: ['Electrical'] },
  { key: 'work_at_height', label: 'Work at height', observationCategories: ['Work at height', 'Scaffolding'] },
  { key: 'lifting', label: 'Lifting operations', observationCategories: ['Lifting operations'] },
  { key: 'dropped_objects', label: 'Dropped objects', observationCategories: ['Work at height', 'Scaffolding', 'Lifting operations'] },
  { key: 'excavation', label: 'Excavation', observationCategories: ['Excavation'] },
  { key: 'confined_space', label: 'Confined spaces', observationCategories: ['Confined space'] },
  { key: 'hazardous_substances', label: 'Hazardous substances', observationCategories: ['Chemical / hazardous substances'] },
  { key: 'gas_exposure', label: 'Gas exposure', observationCategories: ['Confined space', 'Chemical / hazardous substances'] },
  { key: 'fire', label: 'Fire', observationCategories: ['Hot work & fire'] },
  { key: 'vehicle_movement', label: 'Vehicle and plant movement', observationCategories: ['Traffic & logistics', 'Plant & machinery'] },
  { key: 'heat_stress', label: 'Heat stress', observationCategories: ['Heat stress'] },
  { key: 'noise', label: 'Noise', observationCategories: [] },
  { key: 'ergonomics', label: 'Ergonomics and manual handling', observationCategories: ['Hand & power tools'] },
  { key: 'biological', label: 'Biological exposure', observationCategories: ['Welfare & hygiene'] },
  { key: 'environmental_spill', label: 'Environmental spills', observationCategories: ['Environmental'] },
  { key: 'simops', label: 'Simultaneous operations (SIMOPS)', observationCategories: [] },
  { key: 'other', label: 'Other', observationCategories: ['Other', 'Housekeeping & access', 'PPE'] },
];

/** Reads an organisation override (settings.hazardRegisterCategories) and falls back to the defaults. */
export function registerCategories(settings: unknown): HazardCategoryDef[] {
  const raw = (settings as { hazardRegisterCategories?: unknown } | null)?.hazardRegisterCategories;
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_REGISTER_CATEGORIES;
  const ok = raw.filter((c): c is HazardCategoryDef => !!c && typeof c === 'object' && typeof (c as HazardCategoryDef).key === 'string' && typeof (c as HazardCategoryDef).label === 'string')
    .map((c) => ({ key: c.key, label: c.label, observationCategories: Array.isArray(c.observationCategories) ? c.observationCategories.filter((x) => typeof x === 'string') : [] }));
  return ok.length ? ok : DEFAULT_REGISTER_CATEGORIES;
}

/* ---------------------------------------------------------------- controls */

export const CONTROL_TYPES = ['elimination', 'substitution', 'engineering', 'administrative', 'ppe'] as const;
export type ControlType = (typeof CONTROL_TYPES)[number];
export const CONTROL_TYPE_LABELS: Record<ControlType, string> = { elimination: 'Elimination', substitution: 'Substitution', engineering: 'Engineering', administrative: 'Administrative', ppe: 'PPE' };

export const EFFECTIVENESS = ['not_assessed', 'effective', 'partially_effective', 'ineffective'] as const;
export type Effectiveness = (typeof EFFECTIVENESS)[number];
export const EFFECTIVENESS_LABELS: Record<Effectiveness, string> = { not_assessed: 'Not assessed', effective: 'Effective', partially_effective: 'Partially effective', ineffective: 'Ineffective' };

export const ADDITIONAL_STATUSES = ['planned', 'implemented', 'verified'] as const;
export type AdditionalStatus = (typeof ADDITIONAL_STATUSES)[number];

const txt = (max: number) => z.string().trim().max(max);
const req = (max: number) => z.string().trim().min(1).max(max);
const rating = z.number().int().min(1).max(10).nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const existingControlSchema = z.object({
  text: req(400), type: z.enum(CONTROL_TYPES), effectiveness: z.enum(EFFECTIVENESS).default('not_assessed'),
  /** How effectiveness was judged (inspection, observation, test, record). Required when not "not_assessed". */
  basis: txt(400).default(''),
});
export const additionalControlSchema = existingControlSchema.extend({
  owner: txt(160).default(''), dueDate: isoDate.nullable().default(null), status: z.enum(ADDITIONAL_STATUSES).default('planned'),
});
export type ExistingControl = z.infer<typeof existingControlSchema>;
export type AdditionalControl = z.infer<typeof additionalControlSchema>;

/* ---------------------------------------------------------------- hazard entry */

export const hazardInputSchema = z.object({
  projectId: z.string().uuid(),
  siteId: z.string().uuid().nullable().default(null),
  category: req(60),
  activity: req(300),
  workPackage: txt(200).default(''),
  description: req(1500),
  consequences: req(1500),
  personsExposed: req(600),
  existingControls: z.array(existingControlSchema).max(20).default([]),
  initialLikelihood: rating.default(null),
  initialSeverity: rating.default(null),
  additionalControls: z.array(additionalControlSchema).max(20).default([]),
  residualLikelihood: rating.default(null),
  residualSeverity: rating.default(null),
  residualJustification: txt(1500).default(''),
  reviewDate: isoDate.nullable().default(null),
  links: z.array(z.object({ type: z.enum(['document', 'observation']), id: z.string().uuid() })).max(30).default([]),
});
export type HazardInput = z.infer<typeof hazardInputSchema>;

/* ---------------------------------------------------------------- engine */

export interface EngineIssue { code: string; message: string; path?: string; blocking: boolean }
export interface RiskEval {
  initial: { score: number; band: RiskBand } | null;
  residual: { score: number; band: RiskBand } | null;
  /** True when the residual risk is lower than the initial risk. */
  reduced: boolean;
  /** Highest band of initial and residual: drives the approval route. */
  approvalBand: RiskBand | null;
  requiresAuthorisedApproval: boolean;
  intolerable: boolean;
  issues: EngineIssue[];
}

const BAND_ORDER: RiskBand[] = ['low', 'medium', 'high', 'critical'];
export const bandRank = (b: RiskBand) => BAND_ORDER.indexOf(b);

/** Score on the matrix or null if a rating is missing or outside the matrix (never clamped). */
export function score(l: number | null, s: number | null, m: RiskMatrixConfig) {
  if (l === null || s === null || !Number.isInteger(l) || !Number.isInteger(s) || l < 1 || s < 1 || l > m.size || s > m.size) return null;
  return calculateRisk(l, s, m);
}

const supports = (c: ExistingControl | AdditionalControl) =>
  (c.effectiveness === 'effective' || c.effectiveness === 'partially_effective') && c.basis.trim().length > 0 && (!('status' in c) || c.status !== 'planned');

export function evaluateHazard(h: Pick<HazardInput, 'existingControls' | 'additionalControls' | 'initialLikelihood' | 'initialSeverity' | 'residualLikelihood' | 'residualSeverity' | 'residualJustification'>, m: RiskMatrixConfig, today: string): RiskEval {
  const issues: EngineIssue[] = [];
  const initial = score(h.initialLikelihood, h.initialSeverity, m);
  const residual = score(h.residualLikelihood, h.residualSeverity, m);
  if (!initial) issues.push({ code: 'initial_unrated', message: `Rate the initial likelihood and severity (1–${m.size}).`, path: 'initialLikelihood', blocking: true });
  if (!residual) issues.push({ code: 'residual_unrated', message: `Rate the residual likelihood and severity (1–${m.size}). If no control has been verified yet, residual equals initial.`, path: 'residualLikelihood', blocking: true });
  if (!h.existingControls.length && !h.additionalControls.length) issues.push({ code: 'no_controls', message: 'Record at least one control.', path: 'existingControls', blocking: true });

  [...h.existingControls, ...h.additionalControls].forEach((c, i) => {
    if (c.effectiveness !== 'not_assessed' && !c.basis.trim()) issues.push({ code: 'effectiveness_basis', message: `Control "${c.text.slice(0, 50)}": state how its effectiveness was judged.`, path: `controls.${i}`, blocking: true });
  });
  h.additionalControls.forEach((c, i) => {
    if (!c.owner.trim()) issues.push({ code: 'control_owner', message: `Additional control "${c.text.slice(0, 50)}": name the owner.`, path: `additionalControls.${i}.owner`, blocking: true });
    if (!c.dueDate) issues.push({ code: 'control_due', message: `Additional control "${c.text.slice(0, 50)}": set a due date.`, path: `additionalControls.${i}.dueDate`, blocking: true });
    else if (c.status === 'planned' && c.dueDate < today) issues.push({ code: 'control_overdue', message: `Additional control "${c.text.slice(0, 50)}" was due ${c.dueDate} and is still planned.`, path: `additionalControls.${i}`, blocking: false });
  });

  let reduced = false;
  if (initial && residual) {
    if (residual.score > initial.score) issues.push({ code: 'residual_higher', message: `Residual risk (${residual.score}) is higher than initial risk (${initial.score}).`, path: 'residualLikelihood', blocking: true });
    if (residual.score < initial.score) {
      reduced = true;
      const supporting = [...h.existingControls, ...h.additionalControls].filter(supports);
      if (!supporting.length) issues.push({ code: 'reduction_unsupported', message: 'Residual risk is lower than initial risk, but no control is both in place and assessed as effective or partially effective with a stated basis. Entering a control does not by itself reduce the risk.', path: 'residualLikelihood', blocking: true });
      if (!h.residualJustification.trim()) issues.push({ code: 'reduction_unjustified', message: 'Explain why the residual ratings are lower than the initial ratings.', path: 'residualJustification', blocking: true });
      if (h.residualSeverity !== null && h.initialSeverity !== null && h.residualSeverity < h.initialSeverity && !supporting.some((c) => c.type === 'elimination' || c.type === 'substitution' || c.type === 'engineering')) {
        issues.push({ code: 'severity_admin_only', message: 'Severity was reduced, but only administrative or PPE controls support it. Those usually reduce likelihood, not the consequence — confirm the justification.', path: 'residualSeverity', blocking: false });
      }
      if (supporting.every((c) => c.effectiveness === 'partially_effective') && supporting.length && bandRank(initial.band) - bandRank(residual.band) >= 2) {
        issues.push({ code: 'large_reduction_partial', message: 'Risk drops by two or more bands while every supporting control is only partially effective — the reviewer should challenge this.', path: 'residualLikelihood', blocking: false });
      }
    }
  }
  const ineffective = [...h.existingControls, ...h.additionalControls].filter((c) => c.effectiveness === 'ineffective');
  if (ineffective.length) issues.push({ code: 'ineffective_controls', message: `${ineffective.length} control(s) assessed as ineffective — they must not be relied on.`, blocking: false });

  const bands = [initial?.band, residual?.band].filter((b): b is RiskBand => !!b);
  const approvalBand = bands.length ? bands.reduce((a, b) => (bandRank(b) > bandRank(a) ? b : a)) : null;
  const intolerable = residual?.band === 'critical';
  if (intolerable) issues.push({ code: 'residual_intolerable', message: 'Residual risk is CRITICAL. It cannot be approved: reduce the risk further or stop the activity, and escalate to the project HSE manager.', path: 'residualLikelihood', blocking: false });
  return { initial, residual, reduced, approvalBand, requiresAuthorisedApproval: !!approvalBand && bandRank(approvalBand) >= bandRank('high'), intolerable, issues };
}

export type ReviewState = 'none' | 'ok' | 'due_soon' | 'overdue';
export function reviewState(reviewDate: string | null, today: string, soonDays = 14): ReviewState {
  if (!reviewDate) return 'none';
  if (reviewDate < today) return 'overdue';
  const soon = new Date(`${today}T00:00:00Z`); soon.setUTCDate(soon.getUTCDate() + soonDays);
  return reviewDate <= soon.toISOString().slice(0, 10) ? 'due_soon' : 'ok';
}

/* ---------------------------------------------------------------- lifecycle */

export const HAZARD_STATUSES = ['draft', 'submitted', 'reviewed', 'approved', 'rejected', 'archived'] as const;
export type HazardStatus = (typeof HAZARD_STATUSES)[number];
export const HAZARD_STATUS_LABELS: Record<HazardStatus, string> = {
  draft: 'Draft', submitted: 'Submitted', reviewed: 'Reviewed — awaiting approval', approved: 'Approved', rejected: 'Rejected', archived: 'Archived',
};

/**
 * draft → submitted → reviewed → approved. Low/medium entries may be approved straight from "submitted"
 * by an independent reviewer; high/critical entries need a separate review and an authorised approver.
 * Rejected entries go back to draft when edited. An approved entry is changed only by revising it
 * (new revision as draft); the approved revision is kept in the history.
 */
export const hazardLifecycle = defineLifecycle({
  states: HAZARD_STATUSES,
  initial: 'draft',
  terminal: ['archived'],
  transitions: {
    submit: { from: ['draft'], to: 'submitted', label: 'Submit for review' },
    review: { from: ['submitted'], to: 'reviewed', requiresIndependentVerifier: true, label: 'Mark reviewed' },
    approve: { from: ['submitted', 'reviewed'], to: 'approved', requiresIndependentVerifier: true, label: 'Approve' },
    reject: { from: ['submitted', 'reviewed'], to: 'rejected', requiresComment: true, label: 'Reject with reasons' },
    rework: { from: ['rejected'], to: 'draft', label: 'Rework' },
    revise: { from: ['approved'], to: 'draft', requiresComment: true, label: 'Reassess / revise' },
    archive: { from: ['draft', 'approved', 'rejected'], to: 'archived', requiresComment: true, label: 'Archive' },
  },
});
