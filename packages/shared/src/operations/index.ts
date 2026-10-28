/**
 * Phase 6 operational modules: corrective & preventive actions (CAPA), incidents & investigations,
 * inspections & audits. Shapes, labels and the readiness rules the server enforces.
 */
import { z } from 'zod';
import { ACTION_PRIORITIES, INCIDENT_CLASSES, INSPECTION_KINDS, INSPECTION_RESPONSES } from '../domains/hse';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const txt = (max: number) => z.string().trim().max(max);
const req = (max: number, min = 1) => z.string().trim().min(min, min > 1 ? `At least ${min} characters` : 'Required').max(max);

/* ================================================================ CAPA */
export const CAPA_SOURCES = ['observation', 'incident', 'inspection', 'hazard', 'permit', 'audit', 'management_review', 'other'] as const;
export type CapaSource = (typeof CAPA_SOURCES)[number];
export const CAPA_SOURCE_LABELS: Record<CapaSource, string> = {
  observation: 'Observation', incident: 'Incident', inspection: 'Inspection', hazard: 'Hazard register', permit: 'Permit to work',
  audit: 'Audit', management_review: 'Management review', other: 'Other',
};
export type ActionStatus = 'open' | 'assigned' | 'in_progress' | 'pending_verification' | 'verified_closed' | 'cancelled';
export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  open: 'Open (no owner)', assigned: 'Assigned', in_progress: 'In progress', pending_verification: 'Awaiting verification', verified_closed: 'Verified and closed', cancelled: 'Cancelled',
};
export const CONTROL_LEVELS = ['elimination', 'substitution', 'engineering', 'administrative', 'ppe'] as const;
export const CONTROL_LEVEL_LABELS: Record<(typeof CONTROL_LEVELS)[number], string> = { elimination: 'Elimination', substitution: 'Substitution', engineering: 'Engineering control', administrative: 'Administrative control', ppe: 'PPE' };
export const PRIORITY_LABELS: Record<(typeof ACTION_PRIORITIES)[number], string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };

export const actionInputSchema = z.object({
  projectId: uuid, siteId: uuid.nullable().default(null),
  sourceType: z.enum(CAPA_SOURCES), sourceId: uuid.nullable().default(null),
  title: req(200, 5), description: req(2000, 10), priority: z.enum(ACTION_PRIORITIES),
  controlLevel: z.enum(CONTROL_LEVELS).nullable().default(null),
  ownerId: uuid.nullable().default(null), dueDate: isoDate.nullable().default(null),
}).superRefine((a, ctx) => {
  if (!!a.ownerId !== !!a.dueDate) ctx.addIssue({ code: 'custom', path: [a.ownerId ? 'dueDate' : 'ownerId'], message: 'An owner and a due date go together' });
  if (a.sourceType !== 'other' && a.sourceType !== 'audit' && a.sourceType !== 'management_review' && !a.sourceId) ctx.addIssue({ code: 'custom', path: ['sourceId'], message: 'Choose the source record' });
});
export type ActionInput = z.infer<typeof actionInputSchema>;

export type ActionDue = 'overdue' | 'due_7' | 'ok' | 'none';
export function actionDue(due: string | null, status: ActionStatus, today: string): ActionDue {
  if (!due || status === 'verified_closed' || status === 'cancelled') return 'none';
  if (due < today) return 'overdue';
  const lim = new Date(`${today}T00:00:00Z`); lim.setUTCDate(lim.getUTCDate() + 7);
  return due <= lim.toISOString().slice(0, 10) ? 'due_7' : 'ok';
}

/* ================================================================ Incidents */
export type IncidentClass = (typeof INCIDENT_CLASSES)[number];
export const INCIDENT_CLASS_LABELS: Record<IncidentClass, string> = {
  fatality: 'Fatality', lost_time_injury: 'Lost time injury', restricted_work: 'Restricted work case', medical_treatment: 'Medical treatment case', first_aid: 'First aid case',
  occupational_illness: 'Occupational illness', near_miss: 'Near miss', property_damage: 'Property / equipment damage', environmental: 'Environmental incident',
  dangerous_occurrence: 'Dangerous occurrence', other: 'Other',
};
/** Classes that are injuries or illnesses to a person (they need the people involved recorded). */
export const PERSON_CLASSES: IncidentClass[] = ['fatality', 'lost_time_injury', 'restricted_work', 'medical_treatment', 'first_aid', 'occupational_illness'];
export type IncidentStatus = 'reported' | 'under_investigation' | 'pending_review' | 'actions_in_progress' | 'closed' | 'reopened';
export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  reported: 'Reported', under_investigation: 'Under investigation', pending_review: 'Investigation awaiting review', actions_in_progress: 'Actions in progress', closed: 'Closed', reopened: 'Reopened',
};
export const ROOT_CAUSE_CATEGORIES = ['people', 'equipment', 'environment', 'procedures', 'management', 'design', 'other'] as const;
export const ROOT_CAUSE_LABELS: Record<(typeof ROOT_CAUSE_CATEGORIES)[number], string> = {
  people: 'People / behaviour', equipment: 'Equipment / plant / tools', environment: 'Work environment / conditions', procedures: 'Procedures / permits / methods',
  management: 'Supervision / management system', design: 'Design / engineering', other: 'Other',
};

export const personInvolvedSchema = z.object({
  name: req(160), role: txt(120).default(''), employer: txt(160).default(''), injury: txt(500).default(''),
});
export const incidentReportSchema = z.object({
  projectId: uuid, siteId: uuid, classification: z.enum(INCIDENT_CLASSES),
  occurredAt: z.string().datetime({ offset: true }), location: req(200), description: req(4000, 20),
  immediateActions: txt(2000).default(''), potentialSeverity: z.number().int().min(1).max(5).nullable().default(null),
  personsInvolved: z.array(personInvolvedSchema).max(20).default([]),
});
export type IncidentReport = z.infer<typeof incidentReportSchema>;

export const investigationSchema = z.object({
  leadId: uuid.nullable().default(null),
  summary: txt(6000).default(''),
  rootCauses: z.array(z.object({ category: z.enum(ROOT_CAUSE_CATEGORIES), cause: req(500) })).max(20).default([]),
  lessonsLearned: txt(3000).default(''),
  externalNotifications: z.array(z.object({ body: req(160), reference: txt(120).default(''), notifiedAt: z.string().datetime({ offset: true }) })).max(20).default([]),
});
export type Investigation = z.infer<typeof investigationSchema>;

export interface Issue { code: string; message: string }
export function investigationIssues(i: { summary: string; rootCauses: unknown[]; lessonsLearned: string }): Issue[] {
  const out: Issue[] = [];
  if (i.summary.trim().length < 50) out.push({ code: 'summary', message: 'Write the investigation summary (what happened and why), at least 50 characters' });
  if (!i.rootCauses.length) out.push({ code: 'root_causes', message: 'Record at least one root cause' });
  if (i.lessonsLearned.trim().length < 10) out.push({ code: 'lessons', message: 'Record the lessons learned' });
  return out;
}

/* ================================================================ Inspections */
export type InspectionKind = (typeof INSPECTION_KINDS)[number];
export const INSPECTION_KIND_LABELS: Record<InspectionKind, string> = { site_inspection: 'Site inspection', equipment_check: 'Equipment check', audit: 'Audit', management_walk: 'Management walk' };
export type InspectionResponse = (typeof INSPECTION_RESPONSES)[number];
export const RESPONSE_LABELS: Record<InspectionResponse, string> = { compliant: 'Compliant', non_compliant: 'Not compliant', not_applicable: 'Not applicable', not_inspected: 'Not inspected' };
export type InspectionStatus = 'scheduled' | 'in_progress' | 'submitted' | 'reviewed' | 'closed' | 'cancelled';
export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = { scheduled: 'Scheduled', in_progress: 'In progress', submitted: 'Submitted for review', reviewed: 'Reviewed', closed: 'Closed', cancelled: 'Cancelled' };

export const templateItemSchema = z.object({ id: z.string().regex(/^[a-z0-9_-]{1,40}$/), section: txt(120).default(''), text: req(300), critical: z.boolean().default(false) });
export type TemplateItem = z.infer<typeof templateItemSchema>;
export const templateInputSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9-]{2,20}$/, '2–20 capital letters, digits or dashes'), title: req(200, 3), kind: z.enum(INSPECTION_KINDS),
  items: z.array(templateItemSchema).min(1, 'Add at least one item').max(150),
}).superRefine((t, ctx) => { if (new Set(t.items.map((i) => i.id)).size !== t.items.length) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Item ids must be unique' }); });

/**
 * Template text format for the editor: one item per line; "## Section" starts a section;
 * a line starting with "!" is a critical item.
 */
export function parseTemplateText(text: string): TemplateItem[] {
  const out: TemplateItem[] = []; let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    if (line.startsWith('##')) { section = line.replace(/^#+/, '').trim(); continue; }
    const critical = line.startsWith('!');
    out.push({ id: `i${out.length + 1}`, section, text: critical ? line.slice(1).trim() : line, critical });
  }
  return out;
}
export const templateToText = (items: TemplateItem[]) => {
  let section = ''; const lines: string[] = [];
  for (const i of items) { if (i.section !== section) { section = i.section; lines.push(`## ${section}`); } lines.push(`${i.critical ? '! ' : ''}${i.text}`); }
  return lines.join('\n');
};

const sec = (section: string, rows: [string, boolean?][]) => rows.map(([text, critical]) => ({ section, text, critical: !!critical }));
const numbered = (rows: { section: string; text: string; critical: boolean }[]): TemplateItem[] => rows.map((r, k) => ({ id: `i${k + 1}`, ...r }));

/** Starter templates created for an organisation on first use. Generic prompts: review against your own procedures. */
export const DEFAULT_INSPECTION_TEMPLATES: { code: string; title: string; kind: InspectionKind; items: TemplateItem[] }[] = [
  { code: 'SITE-GEN', title: 'General site HSE inspection', kind: 'site_inspection', items: numbered([
    ...sec('Access and housekeeping', [['Walkways and access routes clear and marked'], ['Materials stored safely and stable'], ['Waste segregated and removed regularly']]),
    ...sec('Work at height', [['Edge protection complete at open edges and openings', true], ['Scaffolds tagged as inspected', true], ['Ladders in good condition and secured']]),
    ...sec('Plant and equipment', [['Plant operated by authorised operators'], ['Lifting equipment and accessories certified and in date', true], ['Guards fitted on tools and machinery']]),
    ...sec('Electrical', [['Temporary electrics protected (RCD) and cables routed safely', true], ['Distribution boards closed and labelled']]),
    ...sec('Fire and emergency', [['Fire extinguishers available, in date and accessible'], ['Emergency exits and assembly point signage clear'], ['First aid kit stocked; first aider known']]),
    ...sec('People', [['PPE worn as required for the area'], ['Permits in place for permit-required work', true], ['Heat stress controls in place (water, shade, rest) where applicable']]),
  ]) },
  { code: 'SCAF', title: 'Scaffold inspection', kind: 'equipment_check', items: numbered([
    ...sec('Foundation and structure', [['Base plates and sole boards on firm ground', true], ['Standards plumb; ledgers and transoms complete'], ['Bracing and ties as designed', true]]),
    ...sec('Platforms', [['Platforms fully boarded, no gaps or traps', true], ['Guardrails, mid-rails and toe boards on every open side', true], ['Safe access ladder or stair, secured']]),
    ...sec('Status', [['Scaffold tag shows a current inspection'], ['Loading within the scaffold design']]),
  ]) },
  { code: 'WALK', title: 'Management HSE walk', kind: 'management_walk', items: numbered([
    ...sec('Conversation', [['Spoke with workers about the hazards of their task'], ['Workers know how to stop work and report hazards']]),
    ...sec('Controls seen', [['High-risk activities had their controls in place', true], ['Supervision present for high-risk work']]),
    ...sec('Follow-up', [['Good practice recognised'], ['Concerns recorded as actions']]),
  ]) },
];

export interface ResponseRow { itemId: string; response: InspectionResponse; comment: string; closedOnSpot: boolean }
/** What must be true before an inspection can be submitted. */
export function inspectionIssues(items: TemplateItem[], responses: ResponseRow[]): Issue[] {
  const by = new Map(responses.map((r) => [r.itemId, r]));
  const out: Issue[] = [];
  const unansweredCritical = items.filter((i) => i.critical && (!by.has(i.id) || by.get(i.id)!.response === 'not_inspected'));
  if (unansweredCritical.length) out.push({ code: 'critical_unanswered', message: `Answer every critical item (${unansweredCritical.length} left)` });
  const unanswered = items.filter((i) => !by.has(i.id));
  if (unanswered.length) out.push({ code: 'unanswered', message: `${unanswered.length} item${unanswered.length === 1 ? '' : 's'} not answered (mark them "Not inspected" if they were not checked)` });
  const noComment = responses.filter((r) => r.response === 'non_compliant' && !r.comment.trim());
  if (noComment.length) out.push({ code: 'finding_comment', message: 'Describe every non-compliant finding' });
  return out;
}
