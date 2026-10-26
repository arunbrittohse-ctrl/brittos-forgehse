/**
 * HSE module data model: statuses, lifecycles and validated input shapes for every planned domain.
 *
 * These definitions are the contract for later phases. Tables exist (migration 0006) and rules are
 * unit-tested, but a domain only becomes usable when its API and screens are built and tested —
 * see `HSE_MODULES` in ./registry for the delivery status of each module.
 *
 * Conventions shared with observations: stable UUIDs, organisation/project(/site) scope on every
 * record, per-organisation reference numbers, `version` for optimistic locking, status history in
 * `domain_record_events`, and corrective actions linked back to their source record.
 */
import { z } from 'zod';
import { defineLifecycle } from './lifecycle';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (max: number) => z.string().trim().max(max);
const req = (max: number) => z.string().trim().min(1, 'Required').max(max);
const rating = z.number().int().min(1).max(10);
const scope = { projectId: uuid, siteId: uuid.optional() };

/* ================================================================ Controlled documents */
export const DOCUMENT_CATEGORIES = ['hse_plan', 'policy', 'procedure', 'method_statement', 'risk_assessment', 'emergency_plan', 'logistics_plan', 'traffic_management_plan', 'form', 'register', 'report', 'other'] as const;
export const documentLifecycle = defineLifecycle({
  states: ['draft', 'in_review', 'approved', 'issued', 'superseded', 'withdrawn'] as const,
  initial: 'draft', terminal: ['superseded', 'withdrawn'] as const,
  transitions: {
    submit_review: { from: ['draft'], to: 'in_review', label: 'Submit for review' },
    return_draft: { from: ['in_review'], to: 'draft', requiresComment: true, label: 'Return for correction' },
    approve: { from: ['in_review'], to: 'approved', requiresIndependentVerifier: true, label: 'Approve' },
    issue: { from: ['approved'], to: 'issued', label: 'Issue (controlled copy)' },
    supersede: { from: ['issued'], to: 'superseded', requiresComment: true, label: 'Supersede by new revision' },
    withdraw: { from: ['draft', 'in_review', 'approved', 'issued'], to: 'withdrawn', requiresComment: true, label: 'Withdraw' },
  },
});
export const controlledDocumentCreateSchema = z.object({
  ...scope, siteId: uuid.optional(),
  category: z.enum(DOCUMENT_CATEGORIES),
  docNumber: req(60), title: req(200), revision: req(10).default('00'),
  summary: text(2000).default(''), reviewDueDate: isoDate.optional(),
});

/* ================================================================ Hazards & risk assessments (incl. JSA) */
export const RISK_ASSESSMENT_KINDS = ['risk_assessment', 'jsa', 'hira', 'method_statement_ra'] as const;
export const riskAssessmentLifecycle = defineLifecycle({
  states: ['draft', 'submitted', 'under_review', 'approved', 'superseded', 'archived'] as const,
  initial: 'draft', terminal: ['superseded', 'archived'] as const,
  transitions: {
    submit: { from: ['draft'], to: 'submitted', label: 'Submit' },
    start_review: { from: ['submitted'], to: 'under_review', label: 'Start review' },
    return_for_revision: { from: ['submitted', 'under_review'], to: 'draft', requiresComment: true, label: 'Return for revision' },
    approve: { from: ['under_review'], to: 'approved', requiresIndependentVerifier: true, label: 'Approve' },
    supersede: { from: ['approved'], to: 'superseded', requiresComment: true, label: 'Supersede by new revision' },
    archive: { from: ['draft', 'approved'], to: 'archived', requiresComment: true, label: 'Archive' },
  },
});
export const riskItemSchema = z.object({
  step: text(300).default(''), hazard: req(300), consequence: req(300), personsAtRisk: text(200).default(''),
  existingControls: z.array(req(300)).max(15).default([]),
  likelihood: rating, severity: rating,
  additionalControls: z.array(req(300)).max(15).default([]),
  residualLikelihood: rating, residualSeverity: rating,
  controlOwner: text(120).default(''),
});
export const riskAssessmentCreateSchema = z.object({
  ...scope, kind: z.enum(RISK_ASSESSMENT_KINDS), title: req(200), activity: req(400),
  revision: req(10).default('00'), reviewDate: isoDate.optional(),
  items: z.array(riskItemSchema).max(200).default([]),
});
export const hazardLibraryEntrySchema = z.object({
  hazardCategory: req(80), hazard: req(300), typicalConsequence: req(300),
  typicalControls: z.array(req(300)).max(15).default([]),
});

/* ================================================================ Permit to work */
export const PERMIT_TYPES = ['general', 'hot_work', 'work_at_height', 'confined_space', 'excavation', 'electrical_isolation', 'lifting', 'other'] as const;
export const permitLifecycle = defineLifecycle({
  states: ['draft', 'submitted', 'safety_review', 'authorised', 'active', 'suspended', 'completed', 'closed', 'expired', 'cancelled', 'rejected'] as const,
  initial: 'draft', terminal: ['closed', 'expired', 'cancelled', 'rejected'] as const,
  transitions: {
    submit: { from: ['draft'], to: 'submitted', label: 'Submit application' },
    start_safety_review: { from: ['submitted'], to: 'safety_review', label: 'Start safety review' },
    reject: { from: ['submitted', 'safety_review'], to: 'rejected', requiresComment: true, label: 'Reject' },
    authorise: { from: ['safety_review'], to: 'authorised', requiresIndependentVerifier: true, label: 'Authorise (all prerequisites met)' },
    activate: { from: ['authorised'], to: 'active', label: 'Accept and start work' },
    suspend: { from: ['active'], to: 'suspended', requiresComment: true, label: 'Suspend' },
    revalidate: { from: ['suspended'], to: 'active', requiresComment: true, label: 'Revalidate after suspension' },
    complete: { from: ['active'], to: 'completed', label: 'Work complete / hand back' },
    close: { from: ['completed'], to: 'closed', requiresIndependentVerifier: true, label: 'Close (area left safe)' },
    expire: { from: ['authorised', 'active', 'suspended'], to: 'expired', label: 'Expire (validity ended)' },
    cancel: { from: ['draft', 'submitted', 'authorised'], to: 'cancelled', requiresComment: true, label: 'Cancel' },
  },
});
export const permitCreateSchema = z.object({
  ...scope, siteId: uuid, permitType: z.enum(PERMIT_TYPES), workDescription: req(1000), location: req(200),
  contractorId: uuid.optional(), riskAssessmentId: uuid.optional(),
  validFrom: z.string().datetime({ offset: true }), validTo: z.string().datetime({ offset: true }),
  precautions: z.array(req(300)).max(30).default([]), isolations: z.array(req(300)).max(30).default([]),
  gasTestRequired: z.boolean().default(false),
}).refine((p) => p.validTo > p.validFrom, { message: 'Validity must end after it starts', path: ['validTo'] });

/* ================================================================ Inspections & audits */
export const INSPECTION_KINDS = ['site_inspection', 'equipment_check', 'audit', 'management_walk'] as const;
export const INSPECTION_RESPONSES = ['compliant', 'non_compliant', 'not_applicable', 'not_inspected'] as const;
export const inspectionLifecycle = defineLifecycle({
  states: ['scheduled', 'in_progress', 'submitted', 'reviewed', 'closed', 'cancelled'] as const,
  initial: 'scheduled', terminal: ['closed', 'cancelled'] as const,
  transitions: {
    start: { from: ['scheduled'], to: 'in_progress', label: 'Start' },
    submit: { from: ['in_progress'], to: 'submitted', label: 'Submit' },
    return: { from: ['submitted'], to: 'in_progress', requiresComment: true, label: 'Return for completion' },
    review: { from: ['submitted'], to: 'reviewed', requiresIndependentVerifier: true, label: 'Review' },
    close: { from: ['reviewed'], to: 'closed', label: 'Close (findings handed to CAPA)' },
    cancel: { from: ['scheduled', 'in_progress'], to: 'cancelled', requiresComment: true, label: 'Cancel' },
  },
});
/** Compliance = compliant ÷ (compliant + non-compliant). N/A and uninspected items are excluded, never counted compliant. */
export function inspectionCompliance(responses: readonly (typeof INSPECTION_RESPONSES)[number][]): number | null {
  const c = responses.filter((r) => r === 'compliant').length;
  const nc = responses.filter((r) => r === 'non_compliant').length;
  return c + nc === 0 ? null : Math.round((1000 * c) / (c + nc)) / 10;
}
export const inspectionCreateSchema = z.object({
  ...scope, kind: z.enum(INSPECTION_KINDS), templateId: uuid, title: req(200), scheduledFor: isoDate, location: text(200).default(''),
});

/* ================================================================ Incidents & investigations */
export const INCIDENT_CLASSES = ['fatality', 'lost_time_injury', 'restricted_work', 'medical_treatment', 'first_aid', 'occupational_illness', 'near_miss', 'property_damage', 'environmental', 'dangerous_occurrence', 'other'] as const;
export const incidentLifecycle = defineLifecycle({
  states: ['reported', 'under_investigation', 'pending_review', 'actions_in_progress', 'closed', 'reopened'] as const,
  initial: 'reported', terminal: ['closed'] as const,
  transitions: {
    start_investigation: { from: ['reported', 'reopened'], to: 'under_investigation', label: 'Start investigation' },
    submit_investigation: { from: ['under_investigation'], to: 'pending_review', label: 'Submit investigation' },
    return_investigation: { from: ['pending_review'], to: 'under_investigation', requiresComment: true, label: 'Return investigation' },
    accept_investigation: { from: ['pending_review'], to: 'actions_in_progress', requiresIndependentVerifier: true, label: 'Accept findings; track actions' },
    close: { from: ['actions_in_progress'], to: 'closed', requiresComment: true, requiresIndependentVerifier: true, label: 'Close (all actions verified)' },
    reopen: { from: ['closed'], to: 'reopened', requiresComment: true, label: 'Reopen' },
  },
});
export const incidentCreateSchema = z.object({
  ...scope, siteId: uuid, classification: z.enum(INCIDENT_CLASSES), occurredAt: z.string().datetime({ offset: true }),
  location: req(200), description: req(4000), immediateActions: text(2000).default(''),
  clientRef: uuid.optional(),
});

/* ================================================================ Corrective actions (CAPA) & HSE gaps */
export const ACTION_SOURCE_TYPES = ['observation', 'incident', 'inspection', 'audit', 'risk_assessment', 'permit', 'gap', 'drill', 'environmental', 'management_review', 'other'] as const;
export const ACTION_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export const correctiveActionLifecycle = defineLifecycle({
  states: ['open', 'assigned', 'in_progress', 'pending_verification', 'verified_closed', 'cancelled'] as const,
  initial: 'open', terminal: ['verified_closed', 'cancelled'] as const,
  transitions: {
    assign: { from: ['open', 'assigned'], to: 'assigned', label: 'Assign owner and due date' },
    start: { from: ['assigned'], to: 'in_progress', label: 'Start' },
    submit_evidence: { from: ['assigned', 'in_progress'], to: 'pending_verification', requiresEvidence: true, label: 'Submit closure evidence' },
    reject: { from: ['pending_verification'], to: 'in_progress', requiresComment: true, label: 'Reject — rework required' },
    verify_close: { from: ['pending_verification'], to: 'verified_closed', requiresEvidence: true, requiresIndependentVerifier: true, label: 'Verify effectiveness and close' },
    reopen: { from: ['verified_closed'], to: 'in_progress', requiresComment: true, label: 'Reopen' },
    cancel: { from: ['open', 'assigned', 'in_progress'], to: 'cancelled', requiresComment: true, label: 'Cancel (authorised)' },
  },
});
export const correctiveActionCreateSchema = z.object({
  ...scope, sourceType: z.enum(ACTION_SOURCE_TYPES), sourceId: uuid.optional(),
  title: req(200), description: req(2000), priority: z.enum(ACTION_PRIORITIES),
  controlLevel: z.enum(['elimination', 'substitution', 'engineering', 'administrative', 'ppe']).optional(),
  ownerId: uuid.optional(), dueDate: isoDate.optional(),
});
export const gapLifecycle = defineLifecycle({
  states: ['identified', 'remediation_planned', 'in_progress', 'pending_verification', 'closed', 'risk_accepted'] as const,
  initial: 'identified', terminal: ['closed', 'risk_accepted'] as const,
  transitions: {
    plan: { from: ['identified'], to: 'remediation_planned', label: 'Plan remediation' },
    start: { from: ['remediation_planned'], to: 'in_progress', label: 'Start' },
    submit: { from: ['in_progress'], to: 'pending_verification', requiresEvidence: true, label: 'Submit evidence' },
    reject: { from: ['pending_verification'], to: 'in_progress', requiresComment: true, label: 'Reject' },
    verify_close: { from: ['pending_verification'], to: 'closed', requiresEvidence: true, requiresIndependentVerifier: true, label: 'Verify and close' },
    accept_risk: { from: ['identified', 'remediation_planned'], to: 'risk_accepted', requiresComment: true, requiresIndependentVerifier: true, label: 'Accept risk (management decision)' },
  },
});
export const gapCreateSchema = z.object({
  ...scope, requirement: req(500), requirementSource: text(200).default(''), gapDescription: req(2000),
  priority: z.enum(ACTION_PRIORITIES), ownerId: uuid.optional(), targetDate: isoDate.optional(),
});

/* ================================================================ Training, competency, workforce, contractors */
export const contractorLifecycle = defineLifecycle({
  states: ['prospective', 'prequalified', 'approved', 'suspended', 'inactive'] as const,
  initial: 'prospective', terminal: ['inactive'] as const,
  transitions: {
    prequalify: { from: ['prospective'], to: 'prequalified', requiresEvidence: true, label: 'Pre-qualify' },
    approve: { from: ['prequalified'], to: 'approved', requiresIndependentVerifier: true, label: 'Approve' },
    suspend: { from: ['approved'], to: 'suspended', requiresComment: true, label: 'Suspend' },
    reinstate: { from: ['suspended'], to: 'approved', requiresComment: true, label: 'Reinstate' },
    deactivate: { from: ['prospective', 'prequalified', 'approved', 'suspended'], to: 'inactive', requiresComment: true, label: 'Deactivate' },
  },
});
export const contractorCreateSchema = z.object({ name: req(200), tradeLicenceNo: text(80).default(''), scopeOfWork: text(1000).default(''), contactName: text(120).default(''), contactEmail: z.string().email().optional() });
/** Workforce records hold the minimum personal data needed for competence and induction tracking. */
export const workerCreateSchema = z.object({ fullName: req(160), employeeNo: text(60).default(''), contractorId: uuid.optional(), trade: text(120).default(''), projectId: uuid.optional() });
export const trainingCourseCreateSchema = z.object({ code: req(40), title: req(200), validityMonths: z.number().int().min(1).max(120).optional(), mandatoryFor: z.array(req(120)).max(30).default([]) });
export const trainingRecordCreateSchema = z.object({ workerId: uuid, courseId: uuid, completedOn: isoDate, expiresOn: isoDate.optional(), provider: text(160).default(''), certificateNo: text(80).default('') });
/** Competence status is computed, never stored, so it cannot drift from the dates. */
export function trainingStatus(expiresOn: string | null | undefined, today: string, warnDays = 30): 'valid' | 'expiring' | 'expired' | 'no_expiry' {
  if (!expiresOn) return 'no_expiry';
  if (expiresOn < today) return 'expired';
  const d = (Date.parse(expiresOn) - Date.parse(today)) / 86_400_000;
  return d <= warnDays ? 'expiring' : 'valid';
}

/* ================================================================ Environmental & occupational health */
export const MONITORING_KINDS = ['dust', 'noise', 'air_quality', 'water', 'waste', 'spill', 'emissions', 'occupational_exposure', 'other'] as const;
export const monitoringLifecycle = defineLifecycle({
  states: ['recorded', 'verified', 'exceedance_open', 'exceedance_closed'] as const,
  initial: 'recorded', terminal: ['verified', 'exceedance_closed'] as const,
  transitions: {
    verify: { from: ['recorded'], to: 'verified', requiresIndependentVerifier: true, label: 'Verify reading' },
    flag_exceedance: { from: ['recorded', 'verified'], to: 'exceedance_open', requiresComment: true, label: 'Flag exceedance' },
    close_exceedance: { from: ['exceedance_open'], to: 'exceedance_closed', requiresEvidence: true, requiresIndependentVerifier: true, label: 'Close exceedance' },
  },
});
/** Limits come from verified project configuration (never invented); without a limit no exceedance is computed. */
export const monitoringCreateSchema = z.object({
  ...scope, kind: z.enum(MONITORING_KINDS), parameter: req(120), value: z.number().finite(), unit: req(30),
  limitValue: z.number().finite().optional(), limitSource: text(200).default(''), location: text(200).default(''),
  measuredAt: z.string().datetime({ offset: true }), restricted: z.boolean().default(false),
});

/* ================================================================ Emergency preparedness */
export const DRILL_TYPES = ['fire_evacuation', 'medical', 'rescue_at_height', 'confined_space_rescue', 'spill', 'gas_release', 'other'] as const;
export const drillLifecycle = defineLifecycle({
  states: ['planned', 'conducted', 'actions_open', 'closed', 'cancelled'] as const,
  initial: 'planned', terminal: ['closed', 'cancelled'] as const,
  transitions: {
    record: { from: ['planned'], to: 'conducted', label: 'Record drill results' },
    raise_actions: { from: ['conducted'], to: 'actions_open', label: 'Raise improvement actions' },
    close: { from: ['conducted', 'actions_open'], to: 'closed', requiresIndependentVerifier: true, label: 'Close drill' },
    cancel: { from: ['planned'], to: 'cancelled', requiresComment: true, label: 'Cancel' },
  },
});
export const drillCreateSchema = z.object({ ...scope, drillType: z.enum(DRILL_TYPES), scenario: req(1000), plannedFor: isoDate });
