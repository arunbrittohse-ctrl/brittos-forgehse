import { z } from 'zod';

/**
 * Shared HSE domain contracts for web, API and mobile.
 * These are foundation contracts, not a claim that every domain has an API workflow yet.
 */
export const HSE_DOMAINS = [
  'document', 'risk_assessment', 'permit', 'inspection', 'audit',
  'incident', 'corrective_action', 'training', 'contractor',
  'environmental', 'emergency', 'workforce', 'man_hours',
] as const;
export type HseDomain = (typeof HSE_DOMAINS)[number];

export const HSE_RECORD_STATUSES = [
  'draft', 'submitted', 'under_review', 'approved', 'active',
  'suspended', 'action_required', 'closed', 'rejected', 'cancelled',
] as const;
export type HseRecordStatus = (typeof HSE_RECORD_STATUSES)[number];

export const HSE_EVENT_TYPES = [
  'created', 'updated', 'submitted', 'review_started', 'approved',
  'rejected', 'activated', 'suspended', 'resumed', 'action_assigned',
  'action_submitted', 'verified', 'closed', 'reopened', 'cancelled',
  'attachment_added', 'revision_created', 'comment_added',
] as const;
export type HseEventType = (typeof HSE_EVENT_TYPES)[number];

const uuid = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });

export const hseRecordCreateSchema = z.object({
  domain: z.enum(HSE_DOMAINS),
  organizationId: uuid,
  projectId: uuid,
  siteId: uuid.nullable().optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(20_000).default(''),
  status: z.enum(HSE_RECORD_STATUSES).default('draft'),
  ownerId: uuid.nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  payload: z.record(z.unknown()).default({}),
  sourceDomain: z.enum(HSE_DOMAINS).nullable().optional(),
  sourceRecordId: uuid.nullable().optional(),
});
export type HseRecordCreate = z.infer<typeof hseRecordCreateSchema>;

export const hseRecordSchema = hseRecordCreateSchema.extend({
  id: uuid,
  reference: z.string().min(3).max(40),
  version: z.number().int().min(1),
  createdBy: uuid,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  submittedAt: isoDateTime.nullable().optional(),
  closedAt: isoDateTime.nullable().optional(),
});
export type HseRecord = z.infer<typeof hseRecordSchema>;

export const hseRecordEventSchema = z.object({
  id: uuid,
  recordId: uuid,
  organizationId: uuid,
  actorUserId: uuid.nullable(),
  eventType: z.enum(HSE_EVENT_TYPES),
  fromStatus: z.enum(HSE_RECORD_STATUSES).nullable(),
  toStatus: z.enum(HSE_RECORD_STATUSES).nullable(),
  comment: z.string().max(10_000).default(''),
  metadata: z.record(z.unknown()).default({}),
  createdAt: isoDateTime,
});
export type HseRecordEvent = z.infer<typeof hseRecordEventSchema>;

export const hseRecordLinkSchema = z.object({
  sourceRecordId: uuid,
  targetRecordId: uuid,
  organizationId: uuid,
  relationship: z.enum([
    'corrective_action', 'evidence_for', 'derived_from', 'supersedes',
    'related_to', 'permit_for', 'inspection_of', 'investigates',
  ]),
  createdBy: uuid.nullable(),
  createdAt: isoDateTime,
});
export type HseRecordLink = z.infer<typeof hseRecordLinkSchema>;

/** Explicit workflow guardrails; domain-specific modules may impose stricter rules. */
const ALLOWED_TRANSITIONS: Record<HseRecordStatus, readonly HseRecordStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['under_review', 'draft', 'rejected', 'cancelled'],
  under_review: ['approved', 'rejected', 'draft', 'action_required', 'cancelled'],
  approved: ['active', 'action_required', 'cancelled'],
  active: ['suspended', 'action_required', 'closed', 'cancelled'],
  suspended: ['active', 'action_required', 'cancelled'],
  action_required: ['submitted', 'under_review', 'active', 'closed', 'cancelled'],
  closed: ['active'],
  rejected: ['draft', 'cancelled'],
  cancelled: [],
};

export function canTransitionHseStatus(from: HseRecordStatus, to: HseRecordStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertHseStatusTransition(from: HseRecordStatus, to: HseRecordStatus): void {
  if (!canTransitionHseStatus(from, to)) {
    throw new Error(`Invalid HSE record transition: ${from} -> ${to}`);
  }
}

export const HSE_DOMAIN_LABELS: Record<HseDomain, string> = {
  document: 'HSE Documents',
  risk_assessment: 'Hazards & Risk Assessments',
  permit: 'Permit to Work',
  inspection: 'Inspections',
  audit: 'Audits',
  incident: 'Incidents & Investigations',
  corrective_action: 'Corrective Actions & HSE Gaps',
  training: 'Training & Competency',
  contractor: 'Contractors',
  environmental: 'Environmental Monitoring',
  emergency: 'Emergency Preparedness',
  workforce: 'Contractor & Workforce',
  man_hours: 'Man-hours',
};
