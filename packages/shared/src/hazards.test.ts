import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateHazard, score, reviewState, hazardLifecycle, lifecycleProblems, checkTransition, buildInsights, verifiedLessons, registerCategories,
  DEFAULT_REGISTER_CATEGORIES, DEFAULT_RISK_MATRIX, calculateRisk, type ExistingControl, type AdditionalControl, type ObsRow, type HazardRow, type RiskMatrixConfig,
} from './index';

const M = DEFAULT_RISK_MATRIX;
const TODAY = '2026-10-28';
const eng = (o: Partial<ExistingControl> = {}): ExistingControl => ({ text: 'Hard barrier around the lift zone', type: 'engineering', effectiveness: 'effective', basis: 'Inspected 27 Oct; barrier intact', ...o });
const add = (o: Partial<AdditionalControl> = {}): AdditionalControl => ({ text: 'Tag lines on every load', type: 'administrative', effectiveness: 'not_assessed', basis: '', owner: 'Lifting supervisor', dueDate: '2026-11-15', status: 'planned', ...o });
const base = { existingControls: [eng()], additionalControls: [] as AdditionalControl[], initialLikelihood: 4, initialSeverity: 5, residualLikelihood: 2, residualSeverity: 5, residualJustification: 'Barrier verified; exposure reduced' };
const codes = (r: ReturnType<typeof evaluateHazard>) => r.issues.map((i) => i.code);
const blocking = (r: ReturnType<typeof evaluateHazard>) => r.issues.filter((i) => i.blocking).map((i) => i.code);

describe('risk engine: scoring', () => {
  it('scores every cell of the 5×5 matrix consistently (score = L × S, banded by configuration)', () => {
    for (let l = 1; l <= 5; l++) for (let s = 1; s <= 5; s++) {
      const r = score(l, s, M)!;
      assert.equal(r.score, l * s);
      assert.deepEqual(r, calculateRisk(l, s, M));
    }
    assert.equal(score(4, 5, M)!.band, 'critical'); assert.equal(score(2, 5, M)!.band, 'high');
    assert.equal(score(1, 4, M)!.band, 'low'); assert.equal(score(2, 3, M)!.band, 'medium');
  });
  it('uses the organisation matrix rather than a fixed convention, and never clamps', () => {
    const custom: RiskMatrixConfig = { size: 4, bands: [{ band: 'low', minScore: 1 }, { band: 'high', minScore: 4 }, { band: 'critical', minScore: 12 }] };
    assert.equal(score(2, 2, custom)!.band, 'high');
    assert.equal(score(5, 1, custom), null);
    assert.equal(score(null, 3, M), null);
    assert.ok(codes(evaluateHazard({ ...base, initialLikelihood: 5 }, custom, TODAY)).includes('initial_unrated'));
  });
});

describe('risk engine: residual risk needs evidence', () => {
  it('accepts a reduction supported by an implemented, assessed control and a justification', () => {
    const r = evaluateHazard(base, M, TODAY);
    assert.deepEqual(blocking(r), []);
    assert.equal(r.initial!.score, 20); assert.equal(r.residual!.score, 10); assert.equal(r.reduced, true);
  });
  it('does not reduce risk just because a control was entered', () => {
    assert.ok(blocking(evaluateHazard({ ...base, existingControls: [eng({ effectiveness: 'not_assessed', basis: '' })] }, M, TODAY)).includes('reduction_unsupported'));
    assert.ok(blocking(evaluateHazard({ ...base, existingControls: [eng({ effectiveness: 'ineffective' })] }, M, TODAY)).includes('reduction_unsupported'));
    // Planned additional controls do not support the current residual risk, even when rated "effective".
    const planned = evaluateHazard({ ...base, existingControls: [], additionalControls: [add({ effectiveness: 'effective', basis: 'Expected' })] }, M, TODAY);
    assert.ok(blocking(planned).includes('reduction_unsupported'));
    const done = evaluateHazard({ ...base, existingControls: [], additionalControls: [add({ type: 'engineering', status: 'implemented', effectiveness: 'effective', basis: 'Checked on site' })] }, M, TODAY);
    assert.deepEqual(blocking(done), []);
    assert.ok(blocking(evaluateHazard({ ...base, residualJustification: '' }, M, TODAY)).includes('reduction_unjustified'));
    assert.ok(blocking(evaluateHazard({ ...base, existingControls: [eng({ basis: '' })] }, M, TODAY)).includes('effectiveness_basis'));
  });
  it('flags severity reduced by administrative/PPE controls and rejects residual above initial', () => {
    const adminOnly = evaluateHazard({ ...base, existingControls: [eng({ type: 'administrative' })], residualSeverity: 3 }, M, TODAY);
    assert.ok(codes(adminOnly).includes('severity_admin_only'));
    assert.ok(blocking(evaluateHazard({ ...base, residualLikelihood: 5 }, M, TODAY)).includes('residual_higher'));
  });
  it('allows residual equal to initial without any effectiveness evidence', () => {
    const r = evaluateHazard({ ...base, existingControls: [eng({ effectiveness: 'not_assessed', basis: '' })], residualLikelihood: 4, residualJustification: '' }, M, TODAY);
    assert.deepEqual(blocking(r), []); assert.equal(r.reduced, false);
  });
  it('routes high risk to authorised approval and treats critical residual as intolerable', () => {
    const r = evaluateHazard(base, M, TODAY);
    assert.equal(r.approvalBand, 'critical'); assert.equal(r.requiresAuthorisedApproval, true); assert.equal(r.intolerable, false);
    const crit = evaluateHazard({ ...base, residualLikelihood: 4, residualJustification: '' }, M, TODAY);
    assert.equal(crit.intolerable, true); assert.ok(codes(crit).includes('residual_intolerable'));
    const low = evaluateHazard({ ...base, initialLikelihood: 1, initialSeverity: 3, residualLikelihood: 1, residualSeverity: 3, residualJustification: '' }, M, TODAY);
    assert.equal(low.requiresAuthorisedApproval, false);
  });
  it('requires owners and due dates for additional controls and reports overdue ones', () => {
    const r = evaluateHazard({ ...base, additionalControls: [add({ owner: '', dueDate: null })] }, M, TODAY);
    assert.ok(blocking(r).includes('control_owner') && blocking(r).includes('control_due'));
    const late = evaluateHazard({ ...base, additionalControls: [add({ dueDate: '2026-10-01' })] }, M, TODAY);
    assert.ok(codes(late).includes('control_overdue') && !blocking(late).includes('control_overdue'));
  });
});

describe('hazard review workflow', () => {
  it('is a sound lifecycle with independent review/approval and commented rejection', () => {
    assert.deepEqual(lifecycleProblems(hazardLifecycle), []);
    assert.equal(checkTransition(hazardLifecycle, 'approve', 'submitted', { actorId: 'u1', submittedBy: 'u1' }).ok, false);
    assert.equal(checkTransition(hazardLifecycle, 'review', 'submitted', { actorId: 'u2', submittedBy: 'u1' }).ok, true);
    assert.equal(checkTransition(hazardLifecycle, 'reject', 'reviewed', { comment: ' ' }).ok, false);
    assert.equal(checkTransition(hazardLifecycle, 'revise', 'approved', { comment: 'Night shift added' }).ok, true);
    assert.equal(checkTransition(hazardLifecycle, 'approve', 'draft', {}).ok, false);
  });
  it('computes review reminders', () => {
    assert.equal(reviewState(null, TODAY), 'none');
    assert.equal(reviewState('2026-10-27', TODAY), 'overdue');
    assert.equal(reviewState('2026-11-05', TODAY), 'due_soon');
    assert.equal(reviewState('2027-01-01', TODAY), 'ok');
  });
  it('lets an organisation configure categories', () => {
    assert.equal(registerCategories({}).length, DEFAULT_REGISTER_CATEGORIES.length);
    assert.deepEqual(registerCategories({ hazardRegisterCategories: [{ key: 'tunnel', label: 'Tunnelling', observationCategories: ['Other'] }] }).map((c) => c.key), ['tunnel']);
    for (const k of ['electrical_energy', 'arc_flash', 'work_at_height', 'lifting', 'dropped_objects', 'excavation', 'confined_space', 'hazardous_substances', 'gas_exposure', 'fire', 'vehicle_movement', 'heat_stress', 'noise', 'ergonomics', 'biological', 'environmental_spill', 'simops']) assert.ok(DEFAULT_REGISTER_CATEGORIES.some((c) => c.key === k), k);
  });
});

describe('risk insights are explainable rules over records', () => {
  const obs = (i: number, o: Partial<ObsRow> = {}): ObsRow => ({ id: `o${i}`, ref: `OBS-${i}`, siteId: 's1', siteName: 'Bridge B2', category: 'Lifting operations', type: 'unsafe_condition', band: 'medium', status: 'closed', dueDate: null, observedAt: '2026-10-10T08:00:00Z', description: `Observation ${i}`, closedAt: '2026-10-12T08:00:00Z', verification: null, ...o });
  const hz = (o: Partial<HazardRow> = {}): HazardRow => ({ id: 'h1', ref: 'HAZ-1', category: 'lifting', categoryLabel: 'Lifting operations', status: 'approved', residualBand: 'medium', reviewDate: '2027-01-01', overdueControls: [], activity: 'Lifting parapets', ...o });

  it('fires each rule with evidence, reason, limitations and actions — and nothing on clean data', () => {
    assert.deepEqual(buildInsights({ today: TODAY, observations: [obs(1)], hazards: [hz()], categories: DEFAULT_REGISTER_CATEGORIES }), []);
    const out = buildInsights({
      today: TODAY,
      observations: [obs(1), obs(2), obs(3, { band: 'high' }), obs(4, { type: 'near_miss_observed', category: 'Excavation' }), obs(5, { type: 'near_miss_observed', category: 'Excavation' }),
        obs(6, { band: 'critical', status: 'assigned', dueDate: '2026-10-20' }), obs(7, { observedAt: '2026-01-01T00:00:00Z' })],
      hazards: [hz(), hz({ id: 'h2', ref: 'HAZ-2', residualBand: 'high', reviewDate: '2026-10-01', overdueControls: [{ text: 'Install barrier', dueDate: '2026-10-15' }] })],
      categories: DEFAULT_REGISTER_CATEGORIES,
    });
    const rules = out.map((i) => i.rule).sort();
    assert.deepEqual(rules, ['high_residual', 'overdue_high_risk_actions', 'overdue_register_controls', 'recurring_near_miss', 'repeated_hazard', 'review_overdue'].sort());
    for (const i of out) {
      assert.equal(i.basis, 'rule');
      assert.ok(i.reason && i.facts.length && i.evidence.length && i.limitations.length && i.recommendedActions.length, i.rule);
    }
    const rep = out.find((i) => i.rule === 'repeated_hazard')!;
    assert.equal(rep.evidence.length, 4, 'the January observation is outside the 90-day window');
    assert.ok(rep.facts.some((f) => /approved register entr/.test(f)));
  });

  it('lists verified lessons from closed observations in the same hazard family', () => {
    const cat = DEFAULT_REGISTER_CATEGORIES.find((c) => c.key === 'lifting');
    const l = verifiedLessons(cat, [obs(1, { verification: 'Tag lines now mandatory; verified on 3 lifts' }), obs(2), obs(3, { category: 'Excavation', verification: 'x' })]);
    assert.deepEqual(l.map((x) => x.ref), ['OBS-1']);
  });
});
