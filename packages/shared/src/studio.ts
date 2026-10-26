/**
 * HSE Studio: the structured outputs FORGEHSE can generate from a short brief.
 *
 * The same zod schemas are used three ways:
 *   1. converted to JSON Schema and given to Claude as a forced tool, so replies come back structured;
 *   2. validated again on the server before anything is stored;
 *   3. typed rendering in the web app, the SVG renderers and the DOCX/PDF exporters.
 *
 * Everything generated is a DRAFT until a person with `studio.review` marks it reviewed.
 * Uses zod v4 (bundled with zod 3.25 under `zod/v4`) for its built-in JSON Schema export.
 */
import { z } from 'zod/v4';

export const STUDIO_KINDS = ['checklist', 'document', 'poster', 'flowchart', 'review'] as const;
export type StudioKind = (typeof STUDIO_KINDS)[number];

export const STUDIO_KIND_LABELS: Record<StudioKind, string> = {
  checklist: 'Checklist',
  document: 'HSE document',
  poster: 'Safety poster',
  flowchart: 'Flowchart',
  review: 'Document review',
};

export const DOCUMENT_TYPES = [
  'risk_assessment','jsa_jha','method_statement','project_hse_plan','emergency_response_plan','work_method_plan',
  'logistics_plan','traffic_management_plan','safe_work_procedure','hse_policy','qhse_policy','environmental_management_plan',
  'inspection_checklist','toolbox_talk','training_material','hse_audit_report','incident_investigation_report',
  'hse_closeout_handover_report','inspection_report','incident_report','hse_plan_section','training_handout','other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  risk_assessment:'Risk Assessment (RA)', jsa_jha:'Job Safety / Hazard Analysis (JSA/JHA)',
  method_statement:'Method Statement (MS)', project_hse_plan:'Project HSE Plan',
  emergency_response_plan:'Emergency Response Plan (ERP)', work_method_plan:'Work Method Plan (WMP)',
  logistics_plan:'Logistics Plan', traffic_management_plan:'Traffic Management Plan (TMP)',
  safe_work_procedure:'Safe Work Procedure', hse_policy:'HSE Policy', qhse_policy:'QHSE Policy',
  environmental_management_plan:'Environmental Management Plan', inspection_checklist:'Inspection Checklist',
  toolbox_talk:'Toolbox Talk Materials', training_material:'Training Materials', hse_audit_report:'HSE Audit Report',
  incident_investigation_report:'Incident Investigation Report', hse_closeout_handover_report:'HSE Closeout & Handover Report',
  inspection_report:'Inspection Report', incident_report:'Incident Report', hse_plan_section:'HSE Plan Section',
  training_handout:'Training Handout', other:'Other HSE Document',
};

const line = (max: number) => z.string().trim().min(1).max(max);

/* ---------------------------------------------------------------- checklist */
export const checklistSchema = z.object({
  title: line(140).describe('Short checklist title, e.g. "Mobile scaffold pre-use inspection"'),
  scope: line(400).describe('One or two sentences: what activity or equipment this covers and when to use it'),
  sections: z.array(z.object({
    heading: line(100),
    items: z.array(z.object({
      text: line(220).describe('A yes/no checkable statement, e.g. "Guardrails and toe boards fitted on all open sides"'),
      guidance: z.string().trim().max(260).default('').describe('Optional: what to look for, or empty string'),
      critical: z.boolean().default(false).describe('true if a "No" answer must stop work until corrected'),
    })).min(1).max(25),
  })).min(1).max(12),
  notes: z.array(line(260)).max(8).default([]).describe('Points the HSE engineer must confirm or adapt locally'),
});
export type Checklist = z.output<typeof checklistSchema>;

/* ---------------------------------------------------------------- document */
export const riskRowSchema = z.object({
  activity: line(160),
  hazard: line(200),
  consequence: line(200),
  peopleExposed: z.string().trim().max(300).default('[PEOPLE / ASSETS EXPOSED TO BE CONFIRMED]'),
  likelihood: z.number().int().min(1).max(10),
  severity: z.number().int().min(1).max(10),
  initialRiskScore: z.number().int().min(1).max(100).optional(),
  initialRiskLevel: z.string().trim().max(40).default('To be classified using the approved matrix'),
  controls: z.array(line(240)).min(1).max(8).describe('Controls in hierarchy order, each starting with its level, e.g. "Engineering: ..."'),
  additionalControls: z.array(line(240)).max(8).default([]),
  controlOwner: z.string().trim().max(120).default('[RESPONSIBLE CONTROL OWNER TO CONFIRM]'),
  residualLikelihood: z.number().int().min(1).max(10),
  residualSeverity: z.number().int().min(1).max(10),
  residualRiskScore: z.number().int().min(1).max(100).optional(),
  residualRiskLevel: z.string().trim().max(40).default('To be classified using the approved matrix'),
  verificationRequirements: z.array(line(240)).max(8).default([]),
});
export type RiskRow = z.output<typeof riskRowSchema>;

export const documentSchema = z.object({
  docType: z.enum(DOCUMENT_TYPES),
  title: line(160),
  purpose: line(600),
  scope: line(600),
  sections: z.array(z.object({
    heading: line(120),
    body: z.string().trim().max(3000).default('').describe('Plain paragraphs separated by a blank line; no Markdown'),
    bullets: z.array(line(300)).max(15).default([]),
  })).min(1).max(16),
  responsibilities: z.array(z.object({ role: line(80), duties: line(400) })).max(10).default([]),
  riskTable: z.array(riskRowSchema).max(20).default([]).describe('Only for risk assessments and method statements; otherwise an empty array'),
  reviewNotes: z.array(line(300)).max(10).default([]).describe('What the reviewer must check, fill in or verify before issue'),
});
export type HseDocument = z.output<typeof documentSchema>;

/* ---------------------------------------------------------------- poster */
export const POSTER_THEMES = ['prohibition', 'warning', 'mandatory', 'safe_condition', 'fire', 'information'] as const;
export type PosterTheme = (typeof POSTER_THEMES)[number];

export const POSTER_ICONS = [
  'hard_hat', 'harness', 'gloves', 'goggles', 'ear_protection', 'respirator', 'boots', 'hi_vis_vest', 'fire', 'extinguisher',
  'electric', 'ladder', 'scaffold', 'excavation', 'crane', 'forklift', 'vehicle', 'confined_space', 'chemical', 'heat',
  'water', 'first_aid', 'stop_hand', 'warning', 'shield_check', 'noise', 'dust', 'manual_handling', 'eye', 'leaf',
  'people', 'tools', 'lockout',
] as const;
export type PosterIcon = (typeof POSTER_ICONS)[number];

export const posterSchema = z.object({
  theme: z.enum(POSTER_THEMES).describe('prohibition=red, warning=amber, mandatory=blue, safe_condition=green, fire=fire red, information=navy'),
  signalWord: z.string().trim().max(24).default('').describe('Short banner word such as "WARNING" or "MANDATORY"; empty for the theme default'),
  icon: z.enum(POSTER_ICONS),
  headline: line(70).describe('At most 8 words, positive and specific'),
  subheadline: z.string().trim().max(140).default(''),
  points: z.array(line(90)).min(2).max(5).describe('Short imperative points, each under 12 words'),
  footerNote: z.string().trim().max(90).default(''),
});
export type Poster = z.output<typeof posterSchema>;

/* ---------------------------------------------------------------- flowchart */
export const FLOW_NODE_KINDS = ['start', 'step', 'decision', 'end'] as const;
export const flowchartSchema = z.object({
  title: line(140),
  nodes: z.array(z.object({
    id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,24}$/),
    label: line(120),
    kind: z.enum(FLOW_NODE_KINDS),
  })).min(2).max(40),
  edges: z.array(z.object({
    from: z.string().trim().max(24),
    to: z.string().trim().max(24),
    label: z.string().trim().max(24).default('').describe('For decisions: "Yes" / "No"; otherwise empty'),
  })).min(1).max(60),
}).check((ctx) => {
  const ids = new Set<string>();
  for (const n of ctx.value.nodes) {
    if (ids.has(n.id)) ctx.issues.push({ code: 'custom', message: `Duplicate node id ${n.id}`, input: n.id });
    ids.add(n.id);
  }
  for (const e of ctx.value.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) ctx.issues.push({ code: 'custom', message: `Edge ${e.from}→${e.to} refers to a missing node`, input: e });
  }
});
export type Flowchart = z.output<typeof flowchartSchema>;

/* ---------------------------------------------------------------- review of an uploaded document */
export const FINDING_SEVERITIES = ['critical', 'major', 'minor', 'observation'] as const;
export const reviewSchema = z.object({
  documentTitle: line(200),
  documentType: line(80),
  summary: line(1200),
  overallRating: z.enum(['adequate', 'needs_improvement', 'inadequate']),
  strengths: z.array(line(300)).max(10).default([]),
  findings: z.array(z.object({
    severity: z.enum(FINDING_SEVERITIES),
    section: z.string().trim().max(120).default(''),
    issue: line(500),
    recommendation: line(500),
  })).max(30).default([]),
  missingElements: z.array(line(300)).max(15).default([]),
  questionsForAuthor: z.array(line(300)).max(10).default([]),
});
export type DocumentReview = z.output<typeof reviewSchema>;

export const STUDIO_SCHEMAS = {
  checklist: checklistSchema,
  document: documentSchema,
  poster: posterSchema,
  flowchart: flowchartSchema,
  review: reviewSchema,
} as const;

export type StudioContent = Checklist | HseDocument | Poster | Flowchart | DocumentReview;

/** JSON Schema (draft 2020-12 subset) suitable for a Claude tool `input_schema`. */
export function studioJsonSchema(kind: StudioKind): Record<string, unknown> {
  const s = z.toJSONSchema(STUDIO_SCHEMAS[kind], { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

export function parseStudioContent(kind: StudioKind, value: unknown) {
  return STUDIO_SCHEMAS[kind].safeParse(value);
}

/* ---------------------------------------------------------------- request schemas (zod v4 types are compatible at runtime) */
export const studioGenerateSchema = z.object({
  kind: z.enum(STUDIO_KINDS),
  brief: z.string().trim().min(3).max(4000),
  projectId: z.string().uuid().optional(),
  documentType: z.enum(DOCUMENT_TYPES).optional(),
  /** For `review`: id of an uploaded source file (from POST /api/studio/sources). */
  sourceId: z.string().uuid().optional(),
});

export const studioUpdateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  content: z.unknown().optional(),
  version: z.number().int().min(1),
});

export const studioReviewSchema = z.object({
  decision: z.enum(['reviewed', 'draft']),
  note: z.string().trim().max(1000).default(''),
  version: z.number().int().min(1),
});

/** Plain-text title for an item. */
export function studioTitle(kind: StudioKind, c: StudioContent): string {
  if (kind === 'poster') return (c as Poster).headline;
  if (kind === 'review') return `Review: ${(c as DocumentReview).documentTitle}`;
  return (c as Checklist | HseDocument | Flowchart).title;
}
