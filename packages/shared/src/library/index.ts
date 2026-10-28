/**
 * Document and evidence library: catalogue, metadata schema and version lifecycle.
 *
 * One library holds every HSE file (policies, procedures, certificates, drawings, photos, evidence).
 * A file is a set of immutable versions. Approved versions are never overwritten: a change is a new
 * version that is reviewed by someone other than the person who uploaded it, and approving it marks
 * the previous approved version as superseded.
 */
import { z } from 'zod';
import { defineLifecycle } from '../domains/lifecycle';

export const LIBRARY_DOC_TYPES = [
  'policy', 'plan', 'procedure', 'method_statement', 'risk_assessment', 'register', 'form', 'checklist', 'permit',
  'certificate', 'inspection_record', 'drawing', 'manual', 'correspondence', 'report', 'training_record', 'photo_evidence', 'other',
] as const;
export type LibraryDocType = (typeof LIBRARY_DOC_TYPES)[number];
export const LIBRARY_DOC_TYPE_LABELS: Record<LibraryDocType, string> = {
  policy: 'Policy', plan: 'Plan', procedure: 'Procedure', method_statement: 'Method statement', risk_assessment: 'Risk assessment',
  register: 'Register', form: 'Form', checklist: 'Checklist', permit: 'Permit', certificate: 'Certificate', inspection_record: 'Inspection record',
  drawing: 'Drawing', manual: 'Manual', correspondence: 'Correspondence', report: 'Report', training_record: 'Training record',
  photo_evidence: 'Photo / evidence', other: 'Other',
};

/** Who may see a file, on top of project/site scope. */
export const CONFIDENTIALITY = ['internal', 'confidential', 'restricted'] as const;
export type Confidentiality = (typeof CONFIDENTIALITY)[number];
export const CONFIDENTIALITY_LABELS: Record<Confidentiality, { label: string; help: string }> = {
  internal: { label: 'Internal', help: 'Everyone with library access in the project' },
  confidential: { label: 'Confidential', help: 'Only staff who prepare HSE documents in the project, library approvers, the uploader and the owner' },
  restricted: { label: 'Restricted', help: 'Only the uploader, the named owner and library approvers' },
};

/**
 * Retention categories. Durations are set by the organisation (they depend on the client, contract and
 * applicable law), so the platform stores the category and never deletes a file automatically.
 */
export const RETENTION = ['project', 'statutory', 'permanent', 'temporary'] as const;
export type Retention = (typeof RETENTION)[number];
export const RETENTION_LABELS: Record<Retention, string> = {
  project: 'Keep for the project record', statutory: 'Statutory record (retention period set by the organisation)',
  permanent: 'Keep permanently', temporary: 'Temporary (review for disposal)',
};

export const VERSION_STATUSES = ['draft', 'under_review', 'approved', 'rejected', 'superseded'] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];
export const VERSION_STATUS_LABELS: Record<VersionStatus, string> = {
  draft: 'Draft', under_review: 'Under review', approved: 'Approved', rejected: 'Rejected', superseded: 'Superseded',
};

export const libraryVersionLifecycle = defineLifecycle({
  states: VERSION_STATUSES,
  initial: 'draft',
  terminal: ['approved', 'rejected', 'superseded'],
  transitions: {
    submit: { from: ['draft'], to: 'under_review', label: 'Submit for review' },
    withdraw: { from: ['under_review'], to: 'draft', label: 'Withdraw from review' },
    approve: { from: ['under_review'], to: 'approved', requiresIndependentVerifier: true, label: 'Approve' },
    reject: { from: ['under_review'], to: 'rejected', requiresComment: true, requiresIndependentVerifier: true, label: 'Reject' },
    /** Applied by the system when a newer version is approved; never requested by a user. */
    supersede: { from: ['approved'], to: 'superseded', label: 'Superseded by a newer approved version' },
  },
});
export type LibraryTransition = keyof typeof libraryVersionLifecycle.transitions;

/** HSE records a file can be linked to. */
export const LIBRARY_RECORD_TYPES = ['observation', 'hazard', 'document'] as const;
export type LibraryRecordType = (typeof LIBRARY_RECORD_TYPES)[number];

/** Accepted formats. The server checks the file's content, not only its name. */
export const LIBRARY_FILE_TYPES = [
  { ext: 'pdf', type: 'application/pdf', label: 'PDF' },
  { ext: 'docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word' },
  { ext: 'xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel' },
  { ext: 'pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PowerPoint' },
  { ext: 'csv', type: 'text/csv', label: 'CSV' },
  { ext: 'jpg', type: 'image/jpeg', label: 'JPEG' },
  { ext: 'png', type: 'image/png', label: 'PNG' },
  { ext: 'webp', type: 'image/webp', label: 'WebP' },
  { ext: 'heic', type: 'image/heic', label: 'HEIC' },
  { ext: 'mp4', type: 'video/mp4', label: 'MP4 video' },
  { ext: 'mov', type: 'video/quicktime', label: 'MOV video' },
  { ext: 'm4a', type: 'audio/mp4', label: 'M4A audio' },
] as const;

/** Extensions that share a detected type (e.g. .jpeg is a JPEG). */
export const EXTENSION_ALIASES: Record<string, string> = { jpeg: 'jpg' };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const tag = z.string().trim().min(1).max(30).regex(/^[\p{L}\p{N} _.-]+$/u, 'Letters, numbers, spaces, - _ . only');

export const libraryMetaSchema = z.object({
  title: z.string().trim().min(3, 'At least 3 characters').max(200),
  docNumber: z.string().trim().max(60).default(''),
  docType: z.enum(LIBRARY_DOC_TYPES),
  category: z.string().trim().max(80).default(''),
  tags: z.array(tag).max(12).default([]),
  description: z.string().trim().max(1000).default(''),
  projectId: z.string().uuid().nullable().default(null),
  siteId: z.string().uuid().nullable().default(null),
  confidentiality: z.enum(CONFIDENTIALITY).default('internal'),
  retention: z.enum(RETENTION).default('project'),
  ownerId: z.string().uuid().nullable().default(null),
  issueDate: isoDate.nullable().default(null),
  expiryDate: isoDate.nullable().default(null),
}).superRefine((v, ctx) => {
  if (v.siteId && !v.projectId) ctx.addIssue({ code: 'custom', path: ['siteId'], message: 'Choose the project for this site' });
  if (v.issueDate && v.expiryDate && v.expiryDate < v.issueDate) ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'Expiry date is before the issue date' });
});
export type LibraryMeta = z.infer<typeof libraryMetaSchema>;

export type ExpiryState = 'expired' | 'due_30' | 'valid' | 'none';
/** Expiry state of a document on a given day (YYYY-MM-DD). "due_30" = expires within 30 days. */
export function expiryState(expiry: string | null, today: string): ExpiryState {
  if (!expiry) return 'none';
  if (expiry < today) return 'expired';
  const limit = new Date(`${today}T00:00:00Z`); limit.setUTCDate(limit.getUTCDate() + 30);
  return expiry <= limit.toISOString().slice(0, 10) ? 'due_30' : 'valid';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
