/**
 * Permit to Work: permit types, default checklists, type-specific details, gas tests, isolations
 * and the readiness rules the server applies before a permit can be authorised or started.
 *
 * The checklists are generic good-practice prompts, not a statement of any regulation. Each
 * organisation must confirm them against its own PTW procedure and client requirements.
 * Gas test acceptance limits are the site's: the tester records the readings and confirms they are
 * within the site's limits; the platform does not invent limits.
 */
import { z } from 'zod';
import { PERMIT_TYPES } from '../domains/hse';

export const PTW_TYPES = ['hot_work', 'cold_work', 'confined_space', 'excavation', 'lifting', 'electrical_isolation', 'work_at_height', 'general'] as const;
export type PtwType = (typeof PTW_TYPES)[number];
export type PermitStatus = 'draft' | 'submitted' | 'safety_review' | 'authorised' | 'active' | 'suspended' | 'completed' | 'closed' | 'expired' | 'cancelled' | 'rejected';
export const PERMIT_STATUS_LABELS: Record<PermitStatus, string> = {
  draft: 'Draft', submitted: 'Submitted', safety_review: 'In safety review', authorised: 'Authorised', active: 'Active (work in progress)',
  suspended: 'Suspended', completed: 'Work complete', closed: 'Closed', expired: 'Expired', cancelled: 'Cancelled', rejected: 'Rejected',
};
/** Statuses in which work is, or may be, under way on site. */
export const LIVE_PERMIT_STATUSES: PermitStatus[] = ['authorised', 'active', 'suspended'];

interface CheckDef { id: string; text: string; critical: boolean }
interface DetailDef { key: string; label: string; kind: 'text' | 'number' | 'list'; required: boolean; hint?: string }
interface TypeDef { label: string; description: string; gasTest: 'always' | 'optional'; needsIsolations: boolean; checks: CheckDef[]; details: DetailDef[] }

const COMMON: CheckDef[] = [
  { id: 'ra_reviewed', text: 'Risk assessment and method statement reviewed with the crew', critical: true },
  { id: 'briefed', text: 'Crew briefed on the hazards and controls for this task', critical: true },
  { id: 'area_inspected', text: 'Work area inspected, barricaded and signed', critical: false },
  { id: 'ppe', text: 'PPE for the task available and in good condition', critical: false },
  { id: 'emergency', text: 'Emergency arrangements, contacts and nearest first aid confirmed', critical: true },
  { id: 'simops', text: 'Other work nearby (simultaneous operations) checked for conflicts', critical: false },
];

export const PTW_TYPE_DEFS: Record<PtwType, TypeDef> = {
  hot_work: {
    label: 'Hot work', description: 'Welding, cutting, grinding, brazing or any work that produces flame, sparks or heat.', gasTest: 'optional', needsIsolations: false,
    checks: [...COMMON,
      { id: 'combustibles', text: 'Combustible materials removed or protected around the work point', critical: true },
      { id: 'extinguisher', text: 'Suitable fire extinguisher at the work point', critical: true },
      { id: 'fire_watch', text: 'Fire watch appointed for the work and for the period after it ends', critical: true },
      { id: 'detection', text: 'Fire detection / alarm impairment arranged where the work affects it', critical: false }],
    details: [
      { key: 'fireWatch', label: 'Fire watch (name)', kind: 'text', required: true },
      { key: 'fireWatchAfterMinutes', label: 'Fire watch after work ends (minutes, per site procedure)', kind: 'number', required: true },
      { key: 'equipment', label: 'Hot work equipment', kind: 'text', required: true, hint: 'e.g. MMA welding set, oxy-acetylene set' }],
  },
  cold_work: { label: 'Cold work', description: 'Maintenance or construction work that does not produce a source of ignition.', gasTest: 'optional', needsIsolations: false, checks: COMMON, details: [] },
  confined_space: {
    label: 'Confined space entry', description: 'Entry into a tank, chamber, pit, duct or any enclosed space with a foreseeable specified risk.', gasTest: 'always', needsIsolations: false,
    checks: [...COMMON,
      { id: 'space_isolated', text: 'Space isolated from process, mechanical and electrical energy', critical: true },
      { id: 'ventilation', text: 'Ventilation arranged and running', critical: true },
      { id: 'attendant', text: 'Attendant stationed at the entry for the whole entry', critical: true },
      { id: 'rescue', text: 'Rescue plan briefed and rescue equipment at the entry', critical: true },
      { id: 'entry_log', text: 'Entry / exit log in use', critical: false }],
    details: [
      { key: 'attendant', label: 'Attendant (name)', kind: 'text', required: true },
      { key: 'entrants', label: 'Authorised entrants', kind: 'list', required: true },
      { key: 'rescuePlan', label: 'Rescue plan (reference or summary)', kind: 'text', required: true }],
  },
  excavation: {
    label: 'Excavation', description: 'Digging, trenching, piling or breaking ground.', gasTest: 'optional', needsIsolations: false,
    checks: [...COMMON,
      { id: 'services', text: 'Underground services located, marked and drawings checked', critical: true },
      { id: 'support', text: 'Excavation support or battering suitable for the depth and soil', critical: true },
      { id: 'edge', text: 'Edge protection and safe access / egress in place', critical: true },
      { id: 'spoil', text: 'Spoil, materials and plant kept back from the edge', critical: false }],
    details: [
      { key: 'maxDepthM', label: 'Maximum depth (m)', kind: 'number', required: true },
      { key: 'servicesSurvey', label: 'Services survey / drawing reference', kind: 'text', required: true },
      { key: 'supportMethod', label: 'Support method', kind: 'text', required: true, hint: 'e.g. trench box, sheet piles, battered at …' }],
  },
  lifting: {
    label: 'Lifting operation', description: 'Lifting with cranes, hoists or other lifting equipment.', gasTest: 'optional', needsIsolations: false,
    checks: [...COMMON,
      { id: 'lift_plan', text: 'Lift plan approved for this lift', critical: true },
      { id: 'equipment_certs', text: 'Lifting equipment and accessories inspected with valid certificates', critical: true },
      { id: 'exclusion', text: 'Lifting zone barricaded and controlled by a banksman / signaller', critical: true },
      { id: 'weather', text: 'Wind and weather within the limits in the lift plan', critical: true }],
    details: [
      { key: 'liftPlanRef', label: 'Lift plan reference', kind: 'text', required: true },
      { key: 'equipment', label: 'Crane / lifting equipment', kind: 'text', required: true },
      { key: 'loadTonnes', label: 'Heaviest load (t)', kind: 'number', required: true },
      { key: 'appointedPerson', label: 'Appointed person / lift supervisor', kind: 'text', required: true }],
  },
  electrical_isolation: {
    label: 'Electrical isolation (LOTO)', description: 'Work on or near electrical equipment that must be isolated, locked and tagged.', gasTest: 'optional', needsIsolations: true,
    checks: [...COMMON,
      { id: 'locked', text: 'Every isolation point locked and tagged', critical: true },
      { id: 'proved_dead', text: 'Isolation proved dead with a tested instrument before work', critical: true },
      { id: 'stored_energy', text: 'Stored energy released (capacitors, springs, pressure)', critical: true }],
    details: [{ key: 'provedDeadBy', label: 'Proved dead by (name)', kind: 'text', required: true }],
  },
  work_at_height: {
    label: 'Work at height', description: 'Work where a person could fall and be injured.', gasTest: 'optional', needsIsolations: false,
    checks: [...COMMON,
      { id: 'access_tagged', text: 'Access equipment inspected and tagged', critical: true },
      { id: 'fall_protection', text: 'Fall protection selected and anchor points confirmed', critical: true },
      { id: 'fall_rescue', text: 'Rescue plan for a suspended worker in place', critical: true },
      { id: 'dropped_objects', text: 'Dropped-object controls and exclusion below', critical: true }],
    details: [
      { key: 'accessEquipment', label: 'Access equipment', kind: 'text', required: true, hint: 'e.g. MEWP, scaffold, ladder' },
      { key: 'rescuePlan', label: 'Rescue plan (reference or summary)', kind: 'text', required: true }],
  },
  general: { label: 'General work', description: 'Any other work the site procedure requires a permit for.', gasTest: 'optional', needsIsolations: false, checks: COMMON, details: [] },
};

const txt = (max: number) => z.string().trim().max(max);
const isoDateTime = z.string().datetime({ offset: true });

export const isolationSchema = z.object({
  point: z.string().trim().min(1, 'Required').max(200), method: txt(200).default(''), lockNo: txt(60).default(''),
  isolatedBy: txt(120).default(''), verifiedBy: txt(120).default(''),
});
export type Isolation = z.infer<typeof isolationSchema>;

export const permitInputSchema = z.object({
  projectId: z.string().uuid(), siteId: z.string().uuid(),
  permitType: z.enum(PTW_TYPES),
  workDescription: z.string().trim().min(10, 'Describe the work (at least 10 characters)').max(1000),
  location: z.string().trim().min(2, 'Required').max(200),
  contractorName: txt(160).default(''),
  crew: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  equipment: txt(500).default(''),
  emergencyArrangements: txt(1000).default(''),
  validFrom: isoDateTime, validTo: isoDateTime,
  gasTestRequired: z.boolean().default(false),
  details: z.record(z.string(), z.union([z.string().max(1000), z.number(), z.array(z.string().max(120)).max(50)])).default({}),
  isolations: z.array(isolationSchema).max(40).default([]),
  hazardIds: z.array(z.string().uuid()).max(20).default([]),
}).superRefine((p, ctx) => {
  if (new Date(p.validTo) <= new Date(p.validFrom)) ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'Validity must end after it starts' });
});
export type PermitInput = z.infer<typeof permitInputSchema>;

export const gasTestSchema = z.object({
  takenAt: isoDateTime,
  instrument: z.string().trim().min(1, 'Instrument and its calibration reference').max(160),
  oxygenPct: z.number().min(0).max(100).nullable().default(null),
  lelPct: z.number().min(0).max(100).nullable().default(null),
  h2sPpm: z.number().min(0).max(10000).nullable().default(null),
  coPpm: z.number().min(0).max(10000).nullable().default(null),
  other: txt(200).default(''),
  withinLimits: z.boolean(),
  note: txt(500).default(''),
}).refine((g) => [g.oxygenPct, g.lelPct, g.h2sPpm, g.coPpm].some((v) => v !== null) || g.other, { message: 'Record at least one reading', path: ['oxygenPct'] });
export type GasTestInput = z.infer<typeof gasTestSchema>;
export interface GasTest extends GasTestInput { id: string; byId: string; byName: string; recordedAt: string }

export interface PermitCheck { id: string; confirmed: boolean; byName: string | null; at: string | null; note: string }

export interface PermitIssue { code: string; message: string }

export interface PermitFacts {
  permitType: PtwType; validFrom: string; validTo: string; gasTestRequired: boolean; details: Record<string, unknown>;
  isolations: Isolation[]; checks: PermitCheck[]; gasTests: GasTest[]; submittedAt: string | null; suspendedAt?: string | null;
}

/** Effective gas-test requirement: always for confined spaces, otherwise as set on the permit. */
export const gasTestNeeded = (f: Pick<PermitFacts, 'permitType' | 'gasTestRequired'>) => PTW_TYPE_DEFS[f.permitType].gasTest === 'always' || f.gasTestRequired;

/** Problems with the application itself (fields the applicant must complete before submitting). */
export function applicationIssues(f: PermitFacts, maxHours: number): PermitIssue[] {
  const out: PermitIssue[] = [];
  const def = PTW_TYPE_DEFS[f.permitType];
  for (const d of def.details) {
    const v = f.details[d.key];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (d.kind === 'number' && (typeof v !== 'number' || Number.isNaN(v)));
    if (d.required && empty) out.push({ code: `detail_${d.key}`, message: `${d.label} is required for ${def.label.toLowerCase()}` });
  }
  if (def.needsIsolations && !f.isolations.length) out.push({ code: 'isolations', message: 'List every isolation point' });
  if (def.needsIsolations && f.isolations.some((i) => !i.lockNo)) out.push({ code: 'lock_numbers', message: 'Every isolation point needs a lock number' });
  const hours = (new Date(f.validTo).getTime() - new Date(f.validFrom).getTime()) / 3_600_000;
  if (hours > maxHours) out.push({ code: 'validity_too_long', message: `Validity is ${hours.toFixed(1)} h; this organisation allows at most ${maxHours} h per permit` });
  return out;
}

/** Everything that must be true before an issuer may authorise the permit. */
export function authorisationIssues(f: PermitFacts, now: Date, maxHours: number): PermitIssue[] {
  const out = applicationIssues(f, maxHours);
  const def = PTW_TYPE_DEFS[f.permitType];
  const confirmed = new Set(f.checks.filter((c) => c.confirmed).map((c) => c.id));
  const missing = def.checks.filter((c) => c.critical && !confirmed.has(c.id));
  if (missing.length) out.push({ code: 'critical_checks', message: `Confirm the critical checks: ${missing.map((c) => c.text).join('; ')}` });
  if (gasTestNeeded(f)) {
    const since = f.submittedAt ? new Date(f.submittedAt).getTime() : 0;
    const recent = f.gasTests.filter((g) => new Date(g.takenAt).getTime() >= since);
    const last = recent.sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0];
    if (!last) out.push({ code: 'gas_test', message: 'Record a gas test taken after the permit was submitted' });
    else if (!last.withinLimits) out.push({ code: 'gas_test_failed', message: 'The latest gas test is not within the site limits' });
  }
  if (new Date(f.validTo) <= now) out.push({ code: 'validity_ended', message: 'The validity period has already ended. Raise a new permit.' });
  return out;
}

/** Conditions for revalidating a suspended permit (fresh gas test where one is needed). */
export function revalidationIssues(f: PermitFacts, now: Date): PermitIssue[] {
  const out: PermitIssue[] = [];
  if (gasTestNeeded(f)) {
    const since = f.suspendedAt ? new Date(f.suspendedAt).getTime() : 0;
    const last = f.gasTests.filter((g) => new Date(g.takenAt).getTime() >= since).sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0];
    if (!last) out.push({ code: 'gas_test', message: 'Record a new gas test taken after the suspension' });
    else if (!last.withinLimits) out.push({ code: 'gas_test_failed', message: 'The latest gas test is not within the site limits' });
  }
  if (new Date(f.validTo) <= now) out.push({ code: 'validity_ended', message: 'The validity period has ended. Raise a new permit.' });
  return out;
}

/** Two time windows overlap. */
export const overlaps = (a: { from: string; to: string }, b: { from: string; to: string }) => new Date(a.from) < new Date(b.to) && new Date(b.from) < new Date(a.to);

/** The foundation table also accepts the older 'other' type; it is shown as general work. */
export const PERMIT_TYPE_LABEL = (t: string) => (PTW_TYPE_DEFS as Record<string, TypeDef>)[t]?.label ?? (t === 'other' ? 'Other' : t);
export const LEGACY_PERMIT_TYPES = PERMIT_TYPES;
