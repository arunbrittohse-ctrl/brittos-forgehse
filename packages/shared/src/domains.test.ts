import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HSE_MODULES, lifecycleProblems, checkTransition, transitionsFrom, correctiveActionLifecycle, permitLifecycle,
  inspectionCompliance, trainingStatus, permitCreateSchema, correctiveActionCreateSchema, riskAssessmentCreateSchema,
} from './index';

describe('HSE domain model', () => {
  it('registers all 13 platform domains with an honest delivery status', () => {
    const keys = HSE_MODULES.map((d) => d.key);
    for (const k of ['projects', 'access', 'risk', 'permits', 'inspections', 'incidents', 'actions', 'training', 'contractors', 'environment', 'emergency', 'document_control', 'documents_ai']) assert.ok(keys.includes(k), k);
    assert.equal(new Set(keys).size, keys.length, 'keys are unique');
    for (const d of HSE_MODULES.filter((x) => x.status === 'foundation')) assert.ok(d.tables.length > 0 && d.phase > 0, d.key);
  });

  it('every lifecycle is well-formed: declared states, reachable, no dead ends', () => {
    for (const d of HSE_MODULES) for (const [name, l] of Object.entries(d.lifecycles ?? {})) assert.deepEqual(lifecycleProblems(l), [], `${d.key}.${name}`);
  });

  it('corrective actions close only with evidence and an independent verifier', () => {
    const L = correctiveActionLifecycle;
    assert.equal(checkTransition(L, 'submit_evidence', 'in_progress', { evidenceCount: 0 }).ok, false);
    assert.equal(checkTransition(L, 'submit_evidence', 'in_progress', { evidenceCount: 1 }).ok, true);
    assert.match(checkTransition(L, 'verify_close', 'pending_verification', { evidenceCount: 2, actorId: 'u1', submittedBy: 'u1' }).reason!, /cannot verify/);
    assert.equal(checkTransition(L, 'verify_close', 'pending_verification', { evidenceCount: 2, actorId: 'u2', submittedBy: 'u1' }).ok, true);
    assert.equal(checkTransition(L, 'verify_close', 'in_progress', { evidenceCount: 2, actorId: 'u2', submittedBy: 'u1' }).ok, false, 'cannot skip verification step');
    assert.equal(checkTransition(L, 'reject', 'pending_verification', {}).ok, false, 'rejection needs a reason');
    assert.deepEqual(transitionsFrom(L, 'verified_closed'), ['reopen']);
  });

  it('permits cannot become active without passing authorisation', () => {
    assert.equal(checkTransition(permitLifecycle, 'activate', 'safety_review').ok, false);
    assert.equal(checkTransition(permitLifecycle, 'activate', 'authorised').ok, true);
    assert.equal(checkTransition(permitLifecycle, 'authorise', 'safety_review', { actorId: 'a', submittedBy: 'a' }).ok, false);
    const base = { projectId: crypto.randomUUID(), siteId: crypto.randomUUID(), permitType: 'hot_work', workDescription: 'Welding', location: 'L2' };
    assert.equal(permitCreateSchema.safeParse({ ...base, validFrom: '2026-10-27T08:00:00+04:00', validTo: '2026-10-27T07:00:00+04:00' }).success, false);
    assert.equal(permitCreateSchema.safeParse({ ...base, validFrom: '2026-10-27T08:00:00+04:00', validTo: '2026-10-27T17:00:00+04:00' }).success, true);
  });

  it('inspection compliance excludes N/A and uninspected items and never invents a value', () => {
    assert.equal(inspectionCompliance(['compliant', 'compliant', 'non_compliant', 'not_applicable', 'not_inspected']), 66.7);
    assert.equal(inspectionCompliance(['not_applicable', 'not_inspected']), null);
  });

  it('training status is computed from dates', () => {
    assert.equal(trainingStatus(null, '2026-10-26'), 'no_expiry');
    assert.equal(trainingStatus('2026-10-25', '2026-10-26'), 'expired');
    assert.equal(trainingStatus('2026-11-10', '2026-10-26'), 'expiring');
    assert.equal(trainingStatus('2027-06-01', '2026-10-26'), 'valid');
  });

  it('validates input shapes', () => {
    assert.equal(correctiveActionCreateSchema.safeParse({ projectId: crypto.randomUUID(), sourceType: 'incident', title: 'x', description: 'y', priority: 'urgent' }).success, false);
    assert.equal(riskAssessmentCreateSchema.safeParse({ projectId: crypto.randomUUID(), kind: 'jsa', title: 'JSA', activity: 'Lifting', items: [{ hazard: 'h', consequence: 'c', likelihood: 3, severity: 11, residualLikelihood: 1, residualSeverity: 1 }] }).success, false);
  });
});
