/**
 * Readiness for review, model-suggestion merging and the document lifecycle.
 */
import { z } from 'zod';
import { docType, missingRequired, type DocInputs, type DocTypeKey } from './catalog';
import {
  contentPlaceholders, rateOnMatrix, riskRowIssues, type DocContent, type DocRiskRow, type ReadinessIssue,
} from './schema';
import type { RiskMatrixConfig } from '../risk';
import { defineLifecycle } from '../domains/lifecycle';

export interface Readiness {
  /** True when the document may be submitted for review. */
  ready: boolean;
  /** Blocking problems — must be fixed before submission. */
  issues: ReadinessIssue[];
  /** Non-blocking points the reviewer must see. */
  warnings: ReadinessIssue[];
  placeholders: number;
  modelSuggestions: number;
}

export function documentReadiness(typeKey: DocTypeKey, inputs: DocInputs, content: DocContent, matrix: RiskMatrixConfig): Readiness {
  const t = docType(typeKey);
  const issues: ReadinessIssue[] = [];
  const warnings: ReadinessIssue[] = [];

  for (const f of missingRequired(typeKey, inputs, 'submit')) issues.push({ code: 'missing_input', message: `Required input missing: ${f.label}.`, path: `inputs.${f.key}` });

  const ph = contentPlaceholders(content);
  if (ph.length) issues.push({ code: 'placeholders', message: `${ph.length} placeholder(s) still need the author's input (for example ${ph[0]!.text}).`, path: ph[0]!.path });

  if (t.riskRegister) {
    if (!content.riskRows.length) issues.push({ code: 'risk_register_empty', message: 'The risk register has no rows.', path: 'riskRows' });
    issues.push(...riskRowIssues(content.riskRows, matrix));
    content.riskRows.forEach((r, i) => {
      const res = rateOnMatrix(r.residualLikelihood, r.residualSeverity, matrix);
      if (res && (res.band === 'high' || res.band === 'critical')) {
        warnings.push({ code: 'residual_high', message: `Risk row ${i + 1}: residual risk is ${res.band.toUpperCase()} (${res.score}). Work at this level needs authorised approval and, under most procedures, further controls before it starts.`, path: `riskRows.${i}` });
      }
    });
  }

  const model = countModel(content);
  if (model) issues.push({ code: 'model_suggestions', message: `${model} model suggestion(s) have not been accepted or removed. A person must check each one.`, path: 'sections' });

  if (!content.references.length) warnings.push({ code: 'no_references', message: 'No authority, client or standard references were supplied; the reviewer must confirm the applicable requirements.' });
  for (const r of content.reviewRequirements) warnings.push({ code: 'qualified_review', message: r });

  return { ready: issues.length === 0, issues, warnings, placeholders: ph.length, modelSuggestions: model };
}

function countModel(c: DocContent): number {
  return c.sections.filter((s) => s.origin === 'model').length + c.riskRows.filter((r) => r.origin === 'model').length;
}

/* ---------------------------------------------------------------- model suggestions */

/** Shape a language model must return (forced tool / JSON schema). Kept small on purpose. */
export const modelSuggestionSchema = z.object({
  additionalHazards: z.array(z.object({
    step: z.string().max(300), hazard: z.string().max(400), consequence: z.string().max(400), controls: z.array(z.string().max(400)).max(6),
  })).max(10).default([]),
  additionalPoints: z.array(z.object({ heading: z.string().max(160), points: z.array(z.string().max(600)).min(1).max(8) })).max(6).default([]),
});
export type ModelSuggestions = z.infer<typeof modelSuggestionSchema>;

export const MODEL_SUGGESTION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    additionalHazards: { type: 'array', maxItems: 10, items: { type: 'object', properties: { step: { type: 'string' }, hazard: { type: 'string' }, consequence: { type: 'string' }, controls: { type: 'array', maxItems: 6, items: { type: 'string' } } }, required: ['step', 'hazard', 'consequence', 'controls'] } },
    additionalPoints: { type: 'array', maxItems: 6, items: { type: 'object', properties: { heading: { type: 'string' }, points: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string' } } }, required: ['heading', 'points'] } },
  },
  required: ['additionalHazards', 'additionalPoints'],
};

/**
 * Add model suggestions to a template document. Every added item is marked `origin: 'model'`,
 * gets no risk ratings, and blocks submission until a person accepts or removes it.
 * Returns the number of items added.
 */
export function mergeModelSuggestions(content: DocContent, s: ModelSuggestions, riskRegister: boolean): number {
  let added = 0;
  if (riskRegister) {
    for (const h of s.additionalHazards) {
      if (!h.hazard.trim() || content.riskRows.length >= 80) continue;
      const row: DocRiskRow = {
        id: `M${content.riskRows.length + 1}`, step: h.step.trim() || 'Model suggestion', hazard: h.hazard.trim(), consequence: h.consequence.trim(),
        exposed: '[Confirm: people and assets exposed]', existingControls: h.controls.map((x) => x.trim()).filter(Boolean),
        initialLikelihood: null, initialSeverity: null, additionalControls: [], controlOwner: '[Confirm: control owner]',
        residualLikelihood: null, residualSeverity: null, verification: '[Confirm: how the controls will be verified]', origin: 'model',
      };
      content.riskRows.push(row);
      added++;
    }
  }
  s.additionalPoints.forEach((p, i) => {
    if (content.sections.length >= 40) return;
    content.sections.push({ key: `model-${i + 1}`, heading: `Model suggestion: ${p.heading.trim() || 'Additional points'}`, text: 'Suggested by a language model. Check each point, edit it as needed and accept it, or delete this section.', bullets: p.points.map((x) => x.trim()).filter(Boolean), table: null, origin: 'model' });
    added++;
  });
  return added;
}

/* ---------------------------------------------------------------- lifecycle */

export const DOCUMENT_STUDIO_STATUSES = ['draft', 'in_review', 'approved', 'withdrawn'] as const;
export type DocumentStudioStatus = (typeof DOCUMENT_STUDIO_STATUSES)[number];

/**
 * draft → in_review (submit; must be ready) → approved (independent approver) or back to draft (returned, with comment).
 * An approved document is changed only by starting a new revision, which becomes a new draft; the approved revision is
 * preserved in the revision history. Drafts and documents in review can be withdrawn with a reason.
 */
export const documentStudioLifecycle = defineLifecycle({
  states: DOCUMENT_STUDIO_STATUSES,
  initial: 'draft',
  terminal: ['withdrawn'],
  transitions: {
    submit: { from: ['draft'], to: 'in_review', label: 'Submit for review' },
    approve: { from: ['in_review'], to: 'approved', requiresIndependentVerifier: true, label: 'Approve' },
    return: { from: ['in_review'], to: 'draft', requiresComment: true, label: 'Return to author with comments' },
    new_revision: { from: ['approved'], to: 'draft', requiresComment: true, label: 'Start a new revision' },
    withdraw: { from: ['draft', 'in_review'], to: 'withdrawn', requiresComment: true, label: 'Withdraw' },
  },
});

export const DOCUMENT_STATUS_LABELS: Record<DocumentStudioStatus, string> = {
  draft: 'Draft — not approved', in_review: 'In review — not approved', approved: 'Approved', withdrawn: 'Withdrawn',
};

/** "Rev 00", "Rev 01" … */
export const revisionLabel = (n: number) => `Rev ${String(n).padStart(2, '0')}`;
