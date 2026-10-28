import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOC_TYPES, DOC_TYPE_KEYS, generateDocument, docContentSchema, documentReadiness, visibleFields, missingRequired,
  mergeModelSuggestions, riskRowIssues, rateOnMatrix, describeMatrix, contentPlaceholders, lifecycleProblems, checkTransition,
  documentStudioLifecycle, DEFAULT_RISK_MATRIX, type DocContent, type RiskMatrixConfig,
} from './index';
import { FULL_INPUTS, sampleInputs } from './documents/fixtures';

const M = DEFAULT_RISK_MATRIX;
const allText = (c: DocContent) => JSON.stringify(c);

/** Fill every rating and placeholder the way an assessor would, so readiness can be tested. */
function complete(c: DocContent): DocContent {
  const x = structuredClone(c);
  const fill = (s: string) => s.replace(/\[(?:confirm|insert|to be confirmed|tbc|to confirm|add|verify)[^\]]*\]/gi, 'Confirmed by author');
  for (const s of x.sections) {
    s.heading = fill(s.heading); s.text = fill(s.text); s.bullets = s.bullets.map(fill);
    if (s.table) s.table.rows = s.table.rows.map((r) => r.map(fill));
  }
  for (const r of x.riskRows) {
    r.initialLikelihood = 3; r.initialSeverity = 4; r.residualLikelihood = 3; r.residualSeverity = 4;
    for (const k of ['step', 'hazard', 'consequence', 'exposed', 'controlOwner', 'verification'] as const) r[k] = fill(r[k]);
    r.existingControls = r.existingControls.map(fill);
    if (!r.existingControls.length) r.existingControls = ['Administrative: supervised method'];
  }
  return x;
}

describe('document studio: catalogue and form', () => {
  it('covers every requested document type with a unique code', () => {
    assert.equal(DOC_TYPES.length, 18);
    assert.equal(new Set(DOC_TYPES.map((d) => d.code)).size, 18);
    for (const k of ['risk_assessment', 'jsa', 'method_statement', 'project_hse_plan', 'emergency_response_plan', 'work_method_plan', 'logistics_plan', 'traffic_management_plan', 'safe_work_procedure', 'hse_policy', 'qhse_policy', 'environmental_management_plan', 'inspection_checklist', 'toolbox_talk', 'training_material', 'hse_audit_report', 'incident_investigation_report', 'closeout_handover_report']) {
      assert.ok(DOC_TYPE_KEYS.includes(k as never), k);
    }
  });

  it('asks conditional questions only when they apply', () => {
    const base = { title: 'x', hazards: [] as string[] };
    const keys = (t: Parameters<typeof visibleFields>[0], i: Record<string, unknown>) => visibleFields(t, i as never).map((f) => f.key);
    assert.ok(!keys('risk_assessment', base).includes('liftCategory'));
    assert.ok(keys('risk_assessment', { ...base, hazards: ['lifting'] }).includes('liftCategory'));
    assert.ok(!keys('risk_assessment', { ...base, hazards: ['electrical'] }).includes('liveWorkJustification'));
    assert.ok(keys('risk_assessment', { ...base, hazards: ['electrical'], liveWork: 'yes' }).includes('liveWorkJustification'));
    // A policy never asks about cranes, sequences or incidents.
    const pol = keys('hse_policy', { ...base, hazards: ['lifting'] });
    for (const k of ['liftCategory', 'sequence', 'eventDate', 'hazards', 'activity']) assert.ok(!pol.includes(k), k);
    // An incident report asks for the event, not the work sequence.
    const iir = keys('incident_investigation_report', base);
    assert.ok(iir.includes('eventDescription') && !iir.includes('sequence'));
  });

  it('validates required inputs per stage', () => {
    assert.deepEqual(missingRequired('risk_assessment', { title: 'RA', activity: 'Lift' }, 'generate').map((f) => f.key), []);
    assert.deepEqual(missingRequired('risk_assessment', { title: 'RA' }, 'generate').map((f) => f.key), ['activity']);
    assert.deepEqual(missingRequired('incident_investigation_report', { title: 'IIR' }, 'generate').map((f) => f.key).sort(), ['eventDate', 'eventDescription', 'eventType', 'projectName'].sort());
    for (const t of DOC_TYPE_KEYS) assert.deepEqual(missingRequired(t, sampleInputs(t), 'submit').map((f) => f.key), [], `${t} sample is complete`);
  });
});

describe('document studio: deterministic generation', () => {
  for (const t of DOC_TYPE_KEYS) {
    it(`generates a valid, deterministic ${t}`, () => {
      const a = generateDocument(t, sampleInputs(t), { matrix: M });
      const b = generateDocument(t, sampleInputs(t), { matrix: M });
      assert.deepEqual(a, b, 'same inputs → same document');
      assert.ok(docContentSchema.safeParse(a).success, JSON.stringify(docContentSchema.safeParse(a).error?.issues?.slice(0, 3)));
      assert.ok(a.sections.length >= 4);
      assert.equal(new Set(a.sections.map((s) => s.key)).size, a.sections.length, 'section keys unique');
      assert.ok(a.sections.every((s) => s.origin === 'template'));
      const def = DOC_TYPES.find((d) => d.key === t)!;
      assert.equal(a.riskRows.length > 0, def.riskRegister);
      assert.ok(a.reviewRequirements.length >= 1);
      assert.ok(a.assumptions.some((x) => /No AI model/.test(x)));
    });
  }

  it('never invents citations, approvals or phone numbers', () => {
    const minimal = { title: 'Plain document', activity: 'General works', projectName: 'P', hazards: ['lifting', 'electrical', 'confined_space', 'excavation'] };
    for (const t of DOC_TYPE_KEYS) {
      const s = allText(generateDocument(t, { ...minimal, eventDate: '2026-01-01', eventType: 'Near miss', eventDescription: 'x', auditScope: 'x', scopeCompleted: 'x', organisationName: 'Org', inspectionArea: 'Area', scenarios: ['fire'] }, { matrix: M }));
      assert.ok(!/\b(federal law|law no\.?|decree|cabinet resolution|ministerial|OSHAD|ISO ?\d{4,5}|clause \d|BS ?\d{3,}|OSHA)\b/i.test(s), `${t}: legal citation invented`);
      assert.ok(!/\+?\d[\d ()-]{6,}\d/.test(s.replaceAll('2026-01-01', '')), `${t}: phone-like number invented`);
      assert.ok(!/\b(is approved|has been approved|certified compliant|fully compliant|complies with)\b/i.test(s), `${t}: approval/compliance claim`);
    }
  });

  it('prints only the references the author supplied, verbatim', () => {
    const c = generateDocument('method_statement', sampleInputs('method_statement'), { matrix: M });
    assert.deepEqual(c.references, FULL_INPUTS.references);
    const req = c.sections.find((s) => s.key === 'requirements')!;
    assert.deepEqual(req.table!.rows, [['Client', 'Client HSE Specification Rev 4', 'Contractor RAMS approved before work starts']]);
  });

  it('leaves every rating for the assessor and never assumes residual risk is lower', () => {
    for (const t of ['risk_assessment', 'jsa', 'method_statement', 'work_method_plan'] as const) {
      const c = generateDocument(t, sampleInputs(t), { matrix: M });
      for (const r of c.riskRows) {
        assert.equal(r.initialLikelihood, null); assert.equal(r.initialSeverity, null);
        assert.equal(r.residualLikelihood, null); assert.equal(r.residualSeverity, null);
      }
    }
  });

  it('structures JSA and method statement rows by the entered work steps', () => {
    const c = generateDocument('jsa', sampleInputs('jsa'), { matrix: M });
    const steps = new Set(c.riskRows.map((r) => r.step));
    for (const s of FULL_INPUTS.sequence as string[]) assert.ok(steps.has(s), s);
  });

  it('includes method statement essentials and hold points', () => {
    const c = generateDocument('method_statement', sampleInputs('method_statement'), { matrix: M });
    for (const k of ['purpose', 'responsibilities', 'prerequisites', 'resources', 'permits', 'isolation', 'sequence', 'holdpoints', 'controls', 'environment', 'emergency', 'inspections', 'matrix']) assert.ok(c.sections.some((s) => s.key === k), k);
    assert.ok(c.sections.find((s) => s.key === 'permits')!.bullets.some((b) => /lifting/i.test(b)));
  });

  it('keeps incident causes unestablished until the team verifies them', () => {
    const c = generateDocument('incident_investigation_report', { ...sampleInputs('incident_investigation_report'), whys: [] }, { matrix: M });
    const causes = c.sections.find((s) => s.key === 'causes')!;
    assert.ok(causes.table!.rows.every((r) => /\[Confirm:/.test(r[1]!)));
    assert.ok(c.sections.find((s) => s.key === 'factors')!.heading.includes('not findings'));
  });
});

describe('document studio: matrix, readiness and suggestions', () => {
  it('documents the configured matrix instead of assuming a universal convention', () => {
    const custom: RiskMatrixConfig = { size: 4, bands: [{ band: 'low', minScore: 1 }, { band: 'high', minScore: 6 }] };
    const lines = describeMatrix(custom);
    assert.match(lines[0]!, /4×4/);
    assert.match(lines[1]!, /LOW 1–5, HIGH 6–16/);
    assert.ok(lines.some((l) => /not universal/.test(l)));
    assert.equal(rateOnMatrix(5, 1, custom), null, 'rating outside a 4×4 matrix is rejected, not clamped');
    assert.deepEqual(rateOnMatrix(2, 3, custom), { score: 6, band: 'high' });
    assert.deepEqual(rateOnMatrix(2, 3, M), { score: 6, band: 'medium' });
  });

  it('blocks submission until inputs, placeholders and ratings are complete', () => {
    const t = 'risk_assessment';
    const c = generateDocument(t, sampleInputs(t), { matrix: M });
    const r0 = documentReadiness(t, sampleInputs(t), c, M);
    assert.equal(r0.ready, false);
    assert.ok(r0.issues.some((i) => i.code === 'risk_initial_unrated'));
    assert.ok(r0.issues.some((i) => i.code === 'placeholders'));
    const done = complete(c);
    assert.equal(contentPlaceholders(done).length, 0);
    const r1 = documentReadiness(t, sampleInputs(t), done, M);
    assert.deepEqual(r1.issues, []);
    assert.equal(r1.ready, true);
    assert.ok(r1.warnings.some((w) => w.code === 'residual_high'), '12 on default matrix is HIGH and is flagged for authorised approval');
  });

  it('requires additional controls and verification before residual risk can be lower', () => {
    const row = { ...complete(generateDocument('risk_assessment', sampleInputs('risk_assessment'), { matrix: M })).riskRows[0]!, residualLikelihood: 1, residualSeverity: 4, additionalControls: [] };
    assert.ok(riskRowIssues([row], M).some((i) => i.code === 'risk_reduction_unsupported'));
    assert.deepEqual(riskRowIssues([{ ...row, additionalControls: ['Engineering: exclusion zone hard barrier'] }], M), []);
    assert.ok(riskRowIssues([{ ...row, residualLikelihood: 5, residualSeverity: 5 }], M).some((i) => i.code === 'risk_residual_higher'));
  });

  it('labels model suggestions and blocks submission until a person accepts them', () => {
    const t = 'risk_assessment';
    const c = complete(generateDocument(t, sampleInputs(t), { matrix: M }));
    const n = mergeModelSuggestions(c, { additionalHazards: [{ step: 'Grouting', hazard: 'Cement burns', consequence: 'Skin injury', controls: ['PPE: gloves'] }], additionalPoints: [{ heading: 'Wind', points: ['Check wind before lifts'] }] }, true);
    assert.equal(n, 2);
    const m = c.riskRows.at(-1)!;
    assert.equal(m.origin, 'model'); assert.equal(m.initialLikelihood, null);
    assert.ok(c.sections.at(-1)!.heading.startsWith('Model suggestion'));
    const r = documentReadiness(t, sampleInputs(t), c, M);
    assert.ok(r.issues.some((i) => i.code === 'model_suggestions'));
    assert.equal(r.modelSuggestions, 2);
  });

  it('has a sound lifecycle with independent approval and commented returns', () => {
    assert.deepEqual(lifecycleProblems(documentStudioLifecycle), []);
    assert.equal(checkTransition(documentStudioLifecycle, 'approve', 'in_review', { actorId: 'a', submittedBy: 'a' }).ok, false);
    assert.equal(checkTransition(documentStudioLifecycle, 'approve', 'in_review', { actorId: 'b', submittedBy: 'a' }).ok, true);
    assert.equal(checkTransition(documentStudioLifecycle, 'return', 'in_review', { comment: '' }).ok, false);
    assert.equal(checkTransition(documentStudioLifecycle, 'approve', 'draft', { actorId: 'b', submittedBy: 'a' }).ok, false);
  });
});
