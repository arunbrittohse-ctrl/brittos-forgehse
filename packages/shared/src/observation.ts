import { z } from 'zod';
import type { Permission } from './permissions';

export const OBSERVATION_STATUSES = ['open', 'assigned', 'action_submitted', 'closed', 'cancelled'] as const;
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];

export const OBSERVATION_TYPES = ['unsafe_act', 'unsafe_condition', 'positive', 'near_miss_observed'] as const;
export type ObservationType = (typeof OBSERVATION_TYPES)[number];

export const OBSERVATION_TYPE_LABELS: Record<ObservationType, string> = {
  unsafe_act: 'Unsafe act',
  unsafe_condition: 'Unsafe condition',
  positive: 'Positive observation',
  near_miss_observed: 'Near miss (observed)',
};

/** Default hazard categories. Organisations can extend these in settings. */
export const DEFAULT_HAZARD_CATEGORIES = [
  'Work at height',
  'Housekeeping & access',
  'PPE',
  'Electrical',
  'Lifting operations',
  'Excavation',
  'Plant & machinery',
  'Hot work & fire',
  'Confined space',
  'Traffic & logistics',
  'Hand & power tools',
  'Scaffolding',
  'Welfare & hygiene',
  'Heat stress',
  'Environmental',
  'Chemical / hazardous substances',
  'Other',
] as const;

export const STATUS_LABELS: Record<ObservationStatus, string> = {
  open: 'Open',
  assigned: 'Assigned',
  action_submitted: 'Action submitted',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const TRANSITIONS = ['assign', 'submit_action', 'verify_close', 'reject_action', 'reopen', 'cancel'] as const;
export type Transition = (typeof TRANSITIONS)[number];

interface TransitionRule {
  from: readonly ObservationStatus[];
  to: ObservationStatus;
  permission: Permission;
  /** Permission is waived when the actor is the current assignee. */
  assigneeMayAct?: boolean;
  requiresComment?: boolean;
}

export const TRANSITION_RULES: Record<Transition, TransitionRule> = {
  assign: { from: ['open', 'assigned'], to: 'assigned', permission: 'observation.assign' },
  submit_action: { from: ['assigned'], to: 'action_submitted', permission: 'observation.action', assigneeMayAct: true },
  verify_close: { from: ['open', 'action_submitted'], to: 'closed', permission: 'observation.verify' },
  reject_action: { from: ['action_submitted'], to: 'assigned', permission: 'observation.verify', requiresComment: true },
  reopen: { from: ['closed'], to: 'open', permission: 'observation.verify', requiresComment: true },
  cancel: { from: ['open', 'assigned'], to: 'cancelled', permission: 'observation.archive', requiresComment: true },
};

export function allowedTransitions(status: ObservationStatus): Transition[] {
  return TRANSITIONS.filter((t) => TRANSITION_RULES[t].from.includes(status));
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const uuid = z.string().uuid();

export const observationCreateSchema = z.object({
  projectId: uuid,
  siteId: uuid,
  type: z.enum(OBSERVATION_TYPES),
  hazardCategory: z.string().trim().min(1).max(80),
  location: z.string().trim().min(1).max(200),
  activity: z.string().trim().max(200).optional().default(''),
  description: z.string().trim().min(5).max(4000),
  immediateAction: z.string().trim().max(2000).optional().default(''),
  likelihood: z.number().int().min(1).max(10),
  severity: z.number().int().min(1).max(10),
  observedAt: z.string().datetime({ offset: true }),
  /** Client-generated key so offline mobile submissions are not duplicated on retry. */
  clientRef: z.string().uuid().optional(),
});
export type ObservationCreate = z.infer<typeof observationCreateSchema>;

export const observationUpdateSchema = observationCreateSchema
  .omit({ projectId: true, siteId: true, clientRef: true })
  .partial()
  .extend({ version: z.number().int().min(1) });
export type ObservationUpdate = z.infer<typeof observationUpdateSchema>;

export const observationTransitionSchema = z.discriminatedUnion('transition', [
  z.object({ transition: z.literal('assign'), version: z.number().int(), assigneeId: uuid, dueDate: isoDate, correctiveAction: z.string().trim().max(2000).optional(), comment: z.string().trim().max(2000).optional() }),
  z.object({ transition: z.literal('submit_action'), version: z.number().int(), actionTaken: z.string().trim().min(5).max(4000), preventiveAction: z.string().trim().max(2000).optional(), comment: z.string().trim().max(2000).optional() }),
  z.object({ transition: z.literal('verify_close'), version: z.number().int(), comment: z.string().trim().max(2000).optional() }),
  z.object({ transition: z.literal('reject_action'), version: z.number().int(), comment: z.string().trim().min(3).max(2000) }),
  z.object({ transition: z.literal('reopen'), version: z.number().int(), comment: z.string().trim().min(3).max(2000) }),
  z.object({ transition: z.literal('cancel'), version: z.number().int(), comment: z.string().trim().min(3).max(2000) }),
]);
export type ObservationTransitionInput = z.infer<typeof observationTransitionSchema>;

export const observationListQuerySchema = z.object({
  projectId: uuid.optional(),
  siteId: uuid.optional(),
  status: z.enum([...OBSERVATION_STATUSES, 'overdue', 'active']).optional(),
  type: z.enum(OBSERVATION_TYPES).optional(),
  assignedToMe: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  likelihood: z.coerce.number().int().min(1).max(10).optional(),
  severity: z.coerce.number().int().min(1).max(10).optional(),
  riskScore: z.coerce.number().int().min(1).max(100).optional(),
  hazardCategory: z.string().trim().min(1).max(80).optional(),
  assigneeId: uuid.optional(),
  q: z.string().trim().max(100).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type ObservationListQuery = z.infer<typeof observationListQuerySchema>;
