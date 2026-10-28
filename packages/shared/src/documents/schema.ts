/**
 * Structured content of a document produced by the HSE Document Studio.
 *
 * Every section and risk row carries an `origin`:
 *   template — produced by the deterministic template library (no AI model involved)
 *   model    — a suggestion returned by a configured language model; must be verified
 *   author   — written or changed by a person
 * Editing a template or model item turns it into `author` content. None of these mean
 * "approved": approval is a separate, recorded decision on the document.
 */
import { z } from 'zod';
import { DOC_TYPE_KEYS, type DocInputs } from './catalog';
import { calculateRisk, validateRiskMatrix, type RiskBand, type RiskMatrixConfig } from '../risk';

export const CONTENT_ORIGINS = ['template', 'model', 'author'] as const;
export type ContentOrigin = (typeof CONTENT_ORIGINS)[number];

const str = (max: number) => z.string().max(max);
const rating = z.number().int().min(1).max(10).nullable();

export const docTableSchema = z.object({
  columns: z.array(str(80)).min(1).max(8),
  rows: z.array(z.array(str(1500)).max(8)).max(200),
});

export const docSectionSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  heading: z.string().trim().min(1).max(160),
  text: str(8000).default(''),
  bullets: z.array(str(600)).max(60).default([]),
  table: docTableSchema.nullable().default(null),
  origin: z.enum(CONTENT_ORIGINS),
});
export type DocSection = z.infer<typeof docSectionSchema>;

export const docRiskRowSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,24}$/),
  step: str(300),
  hazard: str(400),
  consequence: str(400),
  exposed: str(300),
  existingControls: z.array(str(400)).max(15).default([]),
  initialLikelihood: rating,
  initialSeverity: rating,
  additionalControls: z.array(str(400)).max(15).default([]),
  controlOwner: str(160),
  residualLikelihood: rating,
  residualSeverity: rating,
  verification: str(600),
  origin: z.enum(CONTENT_ORIGINS),
});
export type DocRiskRow = z.infer<typeof docRiskRowSchema>;

export const docReferenceSchema = z.object({ source: str(200), reference: str(200), requirement: str(1000) });

export const docGeneratorSchema = z.object({
  mode: z.enum(['template', 'template+model']),
  templateVersion: z.string().max(40),
  provider: z.string().max(40).nullable(),
  model: z.string().max(120).nullable(),
  /** True only when a language model was actually called and its output used. */
  modelCalled: z.boolean(),
  modelSuggestions: z.number().int().min(0),
  generatedAt: z.string().max(40),
  note: z.string().max(500),
});
export type DocGenerator = z.infer<typeof docGeneratorSchema>;

export const docContentSchema = z.object({
  schemaVersion: z.literal(1),
  sections: z.array(docSectionSchema).min(1).max(40),
  riskRows: z.array(docRiskRowSchema).max(80).default([]),
  references: z.array(docReferenceSchema).max(60).default([]),
  assumptions: z.array(str(600)).max(40).default([]),
  missingInputs: z.array(str(300)).max(60).default([]),
  reviewRequirements: z.array(str(600)).max(20).default([]),
});
export type DocContent = z.infer<typeof docContentSchema>;

/* ---------------------------------------------------------------- inputs (request validation) */

const refInput = z.object({ source: str(200).default(''), reference: str(200).default(''), requirement: str(1000).default('') });
const contactInput = z.object({ role: str(120).default(''), name: str(120).default(''), phone: str(60).default('') });
const inputValue = z.union([str(8000), z.array(str(600)).max(80), z.array(refInput).max(60), z.array(contactInput).max(40)]);
export const docInputsSchema = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,40}$/), inputValue)
  .refine((r) => Object.keys(r).length <= 120, 'Too many fields');

export const docGenerateRequestSchema = z.object({
  docType: z.enum(DOC_TYPE_KEYS),
  projectId: z.string().uuid().nullable().optional(),
  siteId: z.string().uuid().nullable().optional(),
  inputs: docInputsSchema,
  /** Ask a configured language model for extra suggestions on top of the template. */
  useModel: z.boolean().default(false),
});

export const docSaveRequestSchema = z.object({
  version: z.number().int().min(1),
  title: z.string().trim().min(3).max(160).optional(),
  inputs: docInputsSchema.optional(),
  content: docContentSchema.optional(),
  changeNote: z.string().trim().max(500).default(''),
});

export const docDecisionRequestSchema = z.object({
  version: z.number().int().min(1),
  decision: z.enum(['approve', 'return']),
  note: z.string().trim().max(1000).default(''),
});

/* ---------------------------------------------------------------- risk on the document's matrix */

export interface RatedRisk { score: number; band: RiskBand }

/**
 * Score a likelihood/severity pair on the matrix stored with the document.
 * Returns null when either rating is missing or outside the matrix — it is never guessed.
 */
export function rateOnMatrix(l: number | null, s: number | null, matrix: RiskMatrixConfig): RatedRisk | null {
  if (l === null || s === null) return null;
  if (!Number.isInteger(l) || !Number.isInteger(s) || l < 1 || s < 1 || l > matrix.size || s > matrix.size) return null;
  return calculateRisk(l, s, matrix);
}

/** Human-readable description of the matrix convention, printed in every risk document. */
export function describeMatrix(matrix: RiskMatrixConfig): string[] {
  validateRiskMatrix(matrix);
  const max = matrix.size * matrix.size;
  const bands = matrix.bands.map((b, i) => {
    const hi = i + 1 < matrix.bands.length ? matrix.bands[i + 1]!.minScore - 1 : max;
    return `${b.band.toUpperCase()} ${b.minScore}–${hi}`;
  });
  return [
    `Risk score = likelihood × severity on the organisation's ${matrix.size}×${matrix.size} matrix (scores 1–${max}).`,
    `Bands: ${bands.join(', ')}.`,
    ...(matrix.likelihoodLabels?.length ? [`Likelihood: ${matrix.likelihoodLabels.map((x, i) => `${i + 1} ${x}`).join(', ')}.`] : []),
    ...(matrix.severityLabels?.length ? [`Severity: ${matrix.severityLabels.map((x, i) => `${i + 1} ${x}`).join(', ')}.`] : []),
    'This convention is the organisation\'s configured matrix. Confirm it matches the project or client risk procedure before approval; scoring conventions are not universal.',
  ];
}

/* ---------------------------------------------------------------- readiness */

/** Unresolved placeholders look like "[Confirm …]", "[Insert …]", "[confirm limit per project procedure]" or "[TBC]". */
export const PLACEHOLDER_RE = /\[(?:confirm|insert|to be confirmed|tbc|to confirm|add|verify)[^\]]{0,160}\]/gi;

export interface ReadinessIssue { code: string; message: string; path?: string }

export function contentPlaceholders(content: DocContent): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const scan = (path: string, s: string) => { for (const m of s.matchAll(PLACEHOLDER_RE)) out.push({ path, text: m[0] }); };
  content.sections.forEach((s, i) => {
    scan(`sections.${i}.heading`, s.heading); scan(`sections.${i}.text`, s.text);
    s.bullets.forEach((b, j) => scan(`sections.${i}.bullets.${j}`, b));
    s.table?.rows.forEach((r, j) => r.forEach((c, k) => scan(`sections.${i}.table.${j}.${k}`, c)));
  });
  content.riskRows.forEach((r, i) => {
    for (const k of ['step', 'hazard', 'consequence', 'exposed', 'controlOwner', 'verification'] as const) scan(`riskRows.${i}.${k}`, r[k]);
    r.existingControls.forEach((c, j) => scan(`riskRows.${i}.existingControls.${j}`, c));
    r.additionalControls.forEach((c, j) => scan(`riskRows.${i}.additionalControls.${j}`, c));
  });
  return out;
}

/**
 * Checks a risk register against the matrix. Residual risk may only be lower than the initial
 * risk when additional controls AND a verification requirement are recorded for that row —
 * entering a control is not, by itself, evidence that the risk has gone down.
 */
export function riskRowIssues(rows: DocRiskRow[], matrix: RiskMatrixConfig): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  rows.forEach((r, i) => {
    const p = `riskRows.${i}`;
    const label = `Risk row ${i + 1}${r.hazard ? ` (${r.hazard.slice(0, 60)})` : ''}`;
    if (!r.step.trim() || !r.hazard.trim() || !r.consequence.trim()) issues.push({ code: 'risk_row_incomplete', message: `${label}: task step, hazard and consequence are required.`, path: p });
    if (!r.exposed.trim()) issues.push({ code: 'risk_row_exposed', message: `${label}: state the people or assets exposed.`, path: `${p}.exposed` });
    const a = rateOnMatrix(r.initialLikelihood, r.initialSeverity, matrix);
    const b = rateOnMatrix(r.residualLikelihood, r.residualSeverity, matrix);
    if (!a) issues.push({ code: 'risk_initial_unrated', message: `${label}: initial likelihood and severity must be assessed (1–${matrix.size}).`, path: `${p}.initialLikelihood` });
    if (!b) issues.push({ code: 'risk_residual_unrated', message: `${label}: residual likelihood and severity must be assessed (1–${matrix.size}).`, path: `${p}.residualLikelihood` });
    if (!r.existingControls.length && !r.additionalControls.length) issues.push({ code: 'risk_no_controls', message: `${label}: at least one control is required.`, path: `${p}.existingControls` });
    if (!r.controlOwner.trim()) issues.push({ code: 'risk_no_owner', message: `${label}: name the control owner.`, path: `${p}.controlOwner` });
    if (a && b && b.score > a.score) issues.push({ code: 'risk_residual_higher', message: `${label}: residual risk (${b.score}) is higher than initial risk (${a.score}); check the ratings.`, path: `${p}.residualLikelihood` });
    if (a && b && b.score < a.score && (!r.additionalControls.length || !r.verification.trim())) {
      issues.push({ code: 'risk_reduction_unsupported', message: `${label}: residual risk is lower than initial risk, so record the additional controls and how their effectiveness will be verified.`, path: `${p}.additionalControls` });
    }
  });
  return issues;
}

export type DocInputsValue = DocInputs;
