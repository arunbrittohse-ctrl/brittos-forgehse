import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, startApp, seedWorld, loggedIn, observationInput, today, type TestApp, type World } from './helpers';
import { sampleInputs } from '../../../packages/shared/src/documents/fixtures';

const effective = { text: 'Hard barrier exclusion zone around the lift', type: 'engineering', effectiveness: 'effective', basis: 'Inspected on 27 Oct, barrier complete' };

describe('Hazard register API (Phase 4)', () => {
  let app: TestApp; let w: World;
  before(async () => { const db = await freshDb(); w = await seedWorld(db); app = await startApp(db); });
  after(async () => { await app.close(); await app.db.end(); });

  const entry = (o: Record<string, unknown> = {}) => ({
    projectId: w.projA1, siteId: w.siteA1x, category: 'lifting', activity: 'Lifting precast parapets', description: 'Suspended load swings into the MEWP basket',
    consequences: 'Crush injury or fall from the basket', personsExposed: 'Riggers, MEWP operator',
    existingControls: [effective], initialLikelihood: 1, initialSeverity: 3, residualLikelihood: 1, residualSeverity: 3, residualJustification: '', reviewDate: today(60), ...o,
  });
  const go = async (c: Awaited<ReturnType<typeof loggedIn>>, id: string, action: string, note = '') => {
    const cur = (await c.get(`/api/hazards/${id}`)).data;
    return c.post(`/api/hazards/${id}/transition`, { version: cur.version, action, note });
  };

  it('creates entries with engine scores, validates input and enforces who may author', async () => {
    const eng = await loggedIn(app.base, 'engA1');
    const r = await eng.post('/api/hazards', entry({ initialLikelihood: 4, initialSeverity: 5, residualLikelihood: 2 , residualSeverity: 5, residualJustification: 'Barrier verified' }));
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.match(r.data.ref, /^HAZ-\d{4}-\d{4}$/);
    assert.deepEqual(r.data.evaluation.initial, { score: 20, band: 'critical' });
    assert.deepEqual(r.data.evaluation.residual, { score: 10, band: 'high' });
    assert.equal(r.data.evaluation.requiresAuthorisedApproval, true);
    assert.equal(r.data.status, 'draft');
    assert.equal((await eng.post('/api/hazards', entry({ category: 'not_a_category' }))).status, 400);
    assert.equal((await eng.post('/api/hazards', entry({ siteId: w.siteA2 }))).status, 400, 'site from another project');
    assert.equal((await eng.post('/api/hazards', entry({ initialLikelihood: 6 }))).status, 201, 'out-of-matrix ratings are stored but never scored');
    assert.equal((await (await loggedIn(app.base, 'supA1x')).post('/api/hazards', entry())).status, 403);
    assert.equal((await (await loggedIn(app.base, 'engA2')).post('/api/hazards', entry())).status, 403, 'other project');
  });

  it('refuses a residual reduction that is not backed by assessed, implemented controls', async () => {
    const eng = await loggedIn(app.base, 'engA1');
    const d = (await eng.post('/api/hazards', entry({ existingControls: [{ text: 'Toolbox talk', type: 'administrative', effectiveness: 'not_assessed', basis: '' }], initialLikelihood: 4, initialSeverity: 4, residualLikelihood: 2, residualSeverity: 4, residualJustification: 'Briefed' }))).data;
    assert.equal(d.permissions.submit, false);
    const s = await eng.post(`/api/hazards/${d.id}/transition`, { version: d.version, action: 'submit' });
    assert.equal(s.status, 422);
    assert.ok(s.data.error.details.some((x: { code: string }) => x.code === 'reduction_unsupported'));
  });

  it('low/medium risk: one independent reviewer approves; the submitter cannot', async () => {
    const off = await loggedIn(app.base, 'offA1'); const eng = await loggedIn(app.base, 'engA1');
    const d = (await off.post('/api/hazards', entry())).data;
    assert.equal(d.evaluation.requiresAuthorisedApproval, false);
    assert.equal((await go(off, d.id, 'submit')).status, 200);
    assert.equal((await go(off, d.id, 'approve')).status, 403, 'no self-approval');
    const a = await go(eng, d.id, 'approve', 'Controls seen on site');
    assert.equal(a.status, 200, JSON.stringify(a.data)); assert.equal(a.data.status, 'approved');
    const viewer = await loggedIn(app.base, 'viewerA1');
    assert.equal((await viewer.get(`/api/hazards/${d.id}`)).status, 200, 'viewers see approved entries');
    const draft = (await off.post('/api/hazards', entry())).data;
    assert.equal((await viewer.get(`/api/hazards/${draft.id}`)).status, 404, 'but not drafts');
  });

  it('high risk: review then a separate authorised approval; approved revision is preserved', async () => {
    const off = await loggedIn(app.base, 'offA1'); const eng = await loggedIn(app.base, 'engA1'); const corp = await loggedIn(app.base, 'corpA');
    const d = (await off.post('/api/hazards', entry({ initialLikelihood: 4, initialSeverity: 5, residualLikelihood: 2, residualSeverity: 5, residualJustification: 'Barrier verified' }))).data;
    assert.equal((await go(off, d.id, 'submit')).status, 200);
    assert.equal((await go(eng, d.id, 'approve')).status, 409, 'must be reviewed first');
    assert.equal((await go(eng, d.id, 'review', 'Checked')).data.status, 'reviewed');
    assert.equal((await go(eng, d.id, 'approve')).status, 403, 'hse_engineer lacks risk.approve (and reviewed it)');
    const a = await go(corp, d.id, 'approve', 'Accepted with barrier and lift plan');
    assert.equal(a.status, 200); assert.equal(a.data.approvedBy.name, 'corpA');
    assert.equal((await off.patch(`/api/hazards/${d.id}`, { ...entry(), version: a.data.version })).status, 409, 'approved entries are not edited in place');
    assert.equal((await go(off, d.id, 'revise')).status, 400, 'reason required');
    const rv = await go(off, d.id, 'revise', 'Night lifting added');
    assert.equal(rv.data.status, 'draft'); assert.equal(rv.data.revisionLabel, 'Rev 01'); assert.equal(rv.data.approvedBy, null);
    const hist = (await off.get(`/api/hazards/${d.id}/revisions`)).data.items;
    assert.deepEqual(hist.map((x: { event: string }) => x.event).reverse(), ['created', 'submitted', 'reviewed', 'approved', 'revised']);
    const ap = hist.find((x: { event: string }) => x.event === 'approved');
    const snap = (await off.get(`/api/hazards/${d.id}/revisions/${ap.id}`)).data;
    assert.equal(snap.status, 'approved'); assert.equal(snap.revisionLabel, 'Rev 00'); assert.equal(snap.snapshot.residual_band, 'high');
    await assert.rejects(app.db.query("UPDATE hazard_register_revisions SET note = 'x' WHERE hazard_id = $1", [d.id]));
    const audit = await app.db.query<{ action: string }>("SELECT action FROM audit_log WHERE entity_type = 'hazard' AND entity_id = $1", [d.id]);
    for (const x of ['hazard.create', 'hazard.submit', 'hazard.review', 'hazard.approve', 'hazard.revise']) assert.ok(audit.rows.some((r) => r.action === x), x);
  });

  it('critical residual risk is escalated and can never be approved', async () => {
    const off = await loggedIn(app.base, 'offA1'); const eng = await loggedIn(app.base, 'engA1'); const corp = await loggedIn(app.base, 'corpA');
    const d = (await off.post('/api/hazards', entry({ initialLikelihood: 4, initialSeverity: 5, residualLikelihood: 4, residualSeverity: 5 }))).data;
    assert.equal(d.evaluation.intolerable, true);
    const s = await go(off, d.id, 'submit');
    assert.equal(s.status, 200);
    assert.ok((await app.db.query("SELECT 1 FROM audit_log WHERE action = 'hazard.escalate' AND entity_id = $1", [d.id])).rowCount);
    await go(eng, d.id, 'review');
    const a = await go(corp, d.id, 'approve');
    assert.equal(a.status, 422); assert.equal(a.data.error.code, 'intolerable_risk');
    await assert.rejects(app.db.query("UPDATE hazard_register SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1", [d.id, w.users.corpA]), (e: { code?: string }) => e.code === '23514');
  });

  it('rejection needs reasons and editing a rejected entry returns it to draft; stale saves conflict', async () => {
    const off = await loggedIn(app.base, 'offA1'); const eng = await loggedIn(app.base, 'engA1');
    const d = (await off.post('/api/hazards', entry())).data;
    await go(off, d.id, 'submit');
    assert.equal((await go(eng, d.id, 'reject', '')).status, 400);
    const r = await go(eng, d.id, 'reject', 'Persons exposed incomplete');
    assert.equal(r.data.status, 'rejected');
    const s = await off.patch(`/api/hazards/${d.id}`, { ...entry({ personsExposed: 'Riggers, MEWP operator, banksman, public on the footpath' }), version: r.data.version });
    assert.equal(s.status, 200); assert.equal(s.data.status, 'draft');
    assert.equal((await off.patch(`/api/hazards/${d.id}`, { ...entry(), version: r.data.version })).status, 409);
  });

  it('filters and summarises the register', async () => {
    const eng = await loggedIn(app.base, 'engA1');
    const all = (await eng.get(`/api/hazards?projectId=${w.projA1}`)).data;
    assert.ok(all.total >= 5);
    const counted = Object.values(all.summary.byBand as Record<string, number>).reduce((a, b) => a + b, 0);
    assert.equal(counted, all.total, 'summary covers the same filtered set');
    const high = (await eng.get(`/api/hazards?projectId=${w.projA1}&band=high`)).data;
    assert.ok(high.items.length >= 1 && high.items.every((x: { residual: { band: string } }) => x.residual.band === 'high'));
    const cat = (await eng.get('/api/hazards?category=lifting&status=approved')).data;
    assert.ok(cat.items.every((x: { status: string }) => x.status === 'approved'));
    const q = (await eng.get('/api/hazards?q=parapets')).data;
    assert.equal(q.total, all.total);
    await app.db.query("UPDATE hazard_register SET review_date = current_date - 3 WHERE status = 'approved'");
    const od = (await eng.get('/api/hazards?review=overdue')).data;
    assert.ok(od.total >= 1 && od.items.every((x: { reviewState: string }) => x.reviewState === 'overdue'));
  });

  it('builds explainable insights from stored observations and register entries', async () => {
    const sup = await loggedIn(app.base, 'supA1x');
    for (let i = 0; i < 3; i++) {
      const r = await sup.post('/api/observations', observationInput(w, { hazardCategory: 'Lifting operations', description: `Sling damaged on lift ${i}`, likelihood: 3, severity: 4 }));
      assert.equal(r.status, 201, JSON.stringify(r.data));
    }
    const eng = await loggedIn(app.base, 'engA1');
    const ins = (await eng.get(`/api/hazards/insights?projectId=${w.projA1}`)).data;
    const rep = ins.insights.find((x: { rule: string }) => x.rule === 'repeated_hazard');
    assert.ok(rep, JSON.stringify(ins.insights.map((x: { rule: string }) => x.rule)));
    assert.equal(rep.evidence.length, 3); assert.ok(rep.reason && rep.limitations.length && rep.recommendedActions.length);
    assert.ok(ins.insights.some((x: { rule: string }) => x.rule === 'review_overdue'));
    assert.match(ins.disclaimer, /not a scientifically validated prediction/);
    assert.ok(ins.unavailable.some((x: string) => /weather/i.test(x)));
    assert.equal(ins.trend.series[0].category, 'Lifting operations');
    const other = (await (await loggedIn(app.base, 'engB')).get('/api/hazards/insights')).data;
    assert.equal(other.counts.observations, 0, 'other organisation sees none of these records');
    assert.equal(other.counts.hazards, 0);
  });

  it('links documents and observations, and imports assessed rows from a Document Studio risk assessment', async () => {
    const eng = await loggedIn(app.base, 'engA1');
    const doc = (await eng.post('/api/documents', { docType: 'risk_assessment', projectId: w.projA1, inputs: sampleInputs('risk_assessment') })).data;
    const content = structuredClone(doc.content);
    content.riskRows[0].initialLikelihood = 3; content.riskRows[0].initialSeverity = 4; content.riskRows[0].residualLikelihood = 3; content.riskRows[0].residualSeverity = 4;
    await eng.patch(`/api/documents/${doc.id}`, { version: doc.version, content });
    const imp = await eng.post('/api/hazards/import-document', { documentId: doc.id, category: 'work_at_height' });
    assert.equal(imp.status, 201, JSON.stringify(imp.data)); assert.equal(imp.data.imported, 1);
    const h = (await eng.get(`/api/hazards/${imp.data.ids[0]}`)).data;
    assert.equal(h.sourceDocumentId, doc.id);
    assert.deepEqual(h.links.map((l: { type: string; ref: string }) => [l.type, l.ref]), [['document', doc.docNumber]]);
    assert.ok(h.existingControls.every((c: { effectiveness: string }) => c.effectiveness === 'not_assessed'), 'controls arrive unassessed');
    const obs = (await (await loggedIn(app.base, 'supA1x')).post('/api/observations', observationInput(w))).data;
    const s = await eng.patch(`/api/hazards/${h.id}`, { ...entry(), links: [{ type: 'document', id: doc.id }, { type: 'observation', id: obs.id }], version: h.version });
    assert.equal(s.status, 200);
    assert.equal((await eng.get(`/api/hazards/${h.id}`)).data.links.length, 2);
    const foreign = (await (await loggedIn(app.base, 'engB')).post('/api/observations', observationInput({ ...w, projA1: w.projB1, siteA1x: w.siteB1 } as World))).data;
    assert.equal((await eng.patch(`/api/hazards/${h.id}`, { ...entry(), links: [{ type: 'observation', id: foreign.id }], version: s.data.version })).status, 400, 'cannot link another organisation\'s record');
  });

  it('isolates projects and tenants', async () => {
    const eng = await loggedIn(app.base, 'engA1');
    const d = (await eng.post('/api/hazards', entry())).data;
    for (const k of ['engA2', 'engB']) {
      const c = await loggedIn(app.base, k);
      assert.equal((await c.get(`/api/hazards/${d.id}`)).status, 404, k);
      assert.ok(!(await c.get('/api/hazards')).data.items.some((x: { id: string }) => x.id === d.id), k);
      assert.equal((await c.post(`/api/hazards/${d.id}/transition`, { version: d.version, action: 'submit' })).status, 404, k);
    }
  });
});
