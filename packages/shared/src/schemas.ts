import { z } from 'zod';
import { ROLES } from './permissions';

const uuid = z.string().uuid();

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
  client: z.enum(['web', 'mobile']).default('web'),
});

export const PASSWORD_RULES = 'At least 12 characters, including a letter and a number.';
export const passwordSchema = z
  .string()
  .min(12, PASSWORD_RULES)
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), PASSWORD_RULES);

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const projectCreateSchema = z.object({
  code: z.string().trim().min(2).max(20).regex(/^[A-Z0-9-]+$/, 'Uppercase letters, digits and dashes only'),
  name: z.string().trim().min(2).max(160),
  client: z.string().trim().max(160).optional().default(''),
  location: z.string().trim().max(160).optional().default(''),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export const projectUpdateSchema = projectCreateSchema.partial().extend({ status: z.enum(['active', 'on_hold', 'closed']).optional() });

export const siteCreateSchema = z.object({
  projectId: uuid,
  code: z.string().trim().min(1).max(20).regex(/^[A-Z0-9-]+$/, 'Uppercase letters, digits and dashes only'),
  name: z.string().trim().min(2).max(160),
});
export const siteUpdateSchema = z.object({ name: z.string().trim().min(2).max(160).optional(), active: z.boolean().optional() });

export const roleAssignmentInputSchema = z
  .object({
    role: z.enum(ROLES),
    projectId: uuid.nullable().default(null),
    siteId: uuid.nullable().default(null),
  })
  .refine((a) => !(a.siteId && !a.projectId), { message: 'A site-scoped role needs its project', path: ['siteId'] });

export const userCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  fullName: z.string().trim().min(2).max(120),
  jobTitle: z.string().trim().max(120).optional().default(''),
  initialPassword: passwordSchema,
  assignments: z.array(roleAssignmentInputSchema).min(1).max(20),
});

export const userUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  active: z.boolean().optional(),
  assignments: z.array(roleAssignmentInputSchema).min(1).max(20).optional(),
});

export const AI_TASKS = ['draft_observation', 'suggest_capa', 'summarize_observations', 'ask'] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const aiRequestSchema = z.object({
  task: z.enum(AI_TASKS),
  projectId: uuid.optional(),
  observationId: uuid.optional(),
  input: z.string().trim().min(3).max(8000),
});

export const auditQuerySchema = z.object({
  entityType: z.string().max(40).optional(),
  entityId: uuid.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
