import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PTW_TYPE_DEFS } from '@forgehse/shared';
import { freshDb, startApp, seedWorld, loggedIn, type TestApp, type World } from './helpers';

type C = Awaited<ReturnType<typeof loggedIn>>;
const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe('Permit to Work (Phase 5)', () => {
  let app: TestApp; let w: World;
  before(async () => { const db = await freshDb(); w = await seedWorld(db); app = await startApp(db); });
  after(async () => { await app.close(); await app.db.end(); });

  const hot = (o: Record<string, unknown> = {}) => ({
    projectId: w.projA1, siteId: w.siteA1x, permitType: 'hot_work', workDescription: 'Welding handrail brackets on level 3', location: 'Level 3, grid B4',
    contractorName: 'Steel Co (synthetic)', crew: ['Welder A', 'Helper B'], validFrom: hours(-1), validTo: hours(6),
    details: { fireWatch: 'Helper B', fireWatchAfterMinutes: 60, equipment: 'MMA welding set' }, ...o,
  });
  const get = async (c: C, id: string) => (await c.get(`/api/permits/${id}`)).data;
  const go = async (c: C, id: string, action: string, extra: Record<string, unknown> = {}) => c.post(`/api/permits/${id}/transition`, { action, version: (await get(c, id)).version, ...extra });
  const confirmAll = async (c: C, id: string, criticalOnly = false) => {
    const p = await get(c, id);
    return c.post(`/api/permits/${id}/checks`, { version: p.version, checks: p.checks.filter((x: { critical: boolean }) => !criticalOnly || x.critical).map((x: { id: string }) => ({ id: x.id, confirmed: true })) });
  };
  const gas = async (c: C, id: string, withinLimits = true, takenAt = new Date().toISOString()) =>
    c.post(`/api/permits/${id}/gas-tests`, { version: (await get(c, id)).version, test: { takenAt, instrument: 'Multi-gas meter MG-7 (cal. 01 Oct)', oxygenPct: 20.9, lelPct: 0, h2sPpm: 0, coPpm: 0, withinLimits } });

  it('applicants create drafts only where they hold permit.apply, with validated details', async () => {
    const sup = await loggedIn(app.base, 'supA1x');
    const r = await sup.post('/api/permits', hot());
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.match(r.data.ref, /^PTW-A1-\d{4}-\d{5}$/);
    assert.equal(r.data.status, 'draft'); assert.equal(r.data.applicant.name, 'supA1x');
    assert.equal(r.data.checks.length, PTW_TYPE_DEFS.hot_work.checks.length);
    assert.equal((await sup.post('/api/permits', hot({ siteId: w.siteA1y }))).status, 403, 'other site');
    assert.equal((await (await loggedIn(app.base, 'viewerA1')).post('/api/permits', hot())).status, 403);
    assert.equal((await sup.post('/api/permits', hot({ validTo: hours(-2) }))).status, 400);
    assert.equal((await sup.post('/api/permits', hot({ details: { surprise: 'x' } }))).status, 400);
    assert.equal((await (await loggedIn(app.base, 'engA1')).post('/api/permits', hot({ siteId: w.siteA2 }))).status, 400, 'site from another project');
    assert.equal((await (await loggedIn(app.base, 'engA1')).get(`/api/permits/${r.data.id}`)).status, 404, 'drafts are private to the applicant');
    assert.equal((await (await loggedIn(app.base, 'engB')).get(`/api/permits/${r.data.id}`)).status, 404);
  });

  it('cannot submit an incomplete application or one longer than the organisation allows', async () => {
    const sup = await loggedIn(app.base, 'supA1x');
    const d = (await sup.post('/api/permits', hot({ details: { fireWatch: '' } }))).data;
    const s = await go(sup, d.id, 'submit');
    assert.equal(s.status, 422);
    assert.deepEqual(s.data.error.details.map((x: { code: string }) => x.code).sort(), ['detail_equipment', 'detail_fireWatch', 'detail_fireWatchAfterMinutes']);
    const long = (await sup.post('/api/permits', hot({ validTo: hours(30) }))).data;
    assert.equal((await go(sup, long.id, 'submit')).data.error.details[0].code, 'validity_too_long');
    const fix = await sup.patch(`/api/permits/${d.id}`, { version: d.version, permit: hot() });
    assert.equal(fix.status, 200, JSON.stringify(fix.data));
    assert.equal((await go(sup, d.id, 'submit')).status, 200);
    assert.equal((await sup.patch(`/api/permits/${d.id}`, { version: (await get(sup, d.id)).version, permit: hot() })).status, 409, 'submitted permits are not editable');
  });

  it('runs the full hot work flow with segregation of duties at every step', async () => {
    const sup = await loggedIn(app.base, 'supA1x'); const eng = await loggedIn(app.base, 'engA1'); const corp = await loggedIn(app.base, 'corpA');
    const d = (await sup.post('/api/permits', hot())).data;
    await go(sup, d.id, 'submit');
    const viewer = await loggedIn(app.base, 'viewerA1');
    assert.equal((await viewer.get(`/api/permits/${d.id}`)).status, 200, 'viewers see submitted permits');
    assert.equal((await go(sup, d.id, 'start_safety_review')).status, 403, 'applicant cannot review');
    assert.equal((await go(eng, d.id, 'start_safety_review')).status, 200);
    assert.equal((await confirmAll(sup, d.id)).status, 403, 'applicant cannot tick checks in review');
    const early = await go(eng, d.id, 'authorise');
    assert.equal(early.status, 422); assert.ok(early.data.error.details.some((x: { code: string }) => x.code === 'critical_checks'));
    assert.equal((await confirmAll(eng, d.id, true)).status, 200);
    const checked = await get(eng, d.id);
    assert.ok(checked.checks.filter((c: { critical: boolean }) => c.critical).every((c: { confirmed: boolean; byName: string }) => c.confirmed && c.byName === 'engA1'));
    assert.equal((await go(sup, d.id, 'authorise')).status, 403, 'no self-authorisation');
    const a = await go(eng, d.id, 'authorise', { note: 'Area checked' });
    assert.equal(a.status, 200, JSON.stringify(a.data)); assert.equal(a.data.status, 'authorised');
    assert.equal((await go(eng, d.id, 'activate')).status, 403, 'the applicant accepts and starts the work');
    assert.equal((await go(sup, d.id, 'activate')).data.status, 'active');
    assert.equal((await go(sup, d.id, 'suspend')).status, 400, 'a reason is required');
    assert.equal((await go(sup, d.id, 'suspend', { note: 'Fire alarm test in the building' })).data.status, 'suspended', 'anyone on the permit can stop the work');
    assert.equal((await go(sup, d.id, 'revalidate', { note: 'Back to work' })).status, 403);
    assert.equal((await go(eng, d.id, 'revalidate', { note: 'Alarm test finished, area rechecked' })).data.status, 'active');
    assert.equal((await go(sup, d.id, 'complete', { note: '' })).status, 400);
    assert.equal((await go(sup, d.id, 'complete', { note: 'Work finished, fire watch completed, area clean' })).data.status, 'completed');
    assert.equal((await go(sup, d.id, 'close', { note: 'Inspected' })).status, 403);
    const c = await go(corp, d.id, 'close', { note: 'Close-out inspection: area safe' });
    assert.equal(c.status, 200); assert.equal(c.data.status, 'closed'); assert.equal(c.data.closedBy.name, 'corpA');
    const events = c.data.history.map((e: { event: string }) => e.event).reverse();
    assert.deepEqual(events, ['create', 'submit', 'start_safety_review', 'checks', 'authorise', 'activate', 'suspend', 'revalidate', 'complete', 'close']);
    await assert.rejects(app.db.query('UPDATE permit_events SET note = $1 WHERE permit_id = $2', ['x', d.id]), /append-only/);
    await assert.rejects(app.db.query(`UPDATE permits SET closed_by = completed_by WHERE id = $1`, [d.id]), /check/i, 'database refuses a self-closed permit');
  });

  it('confined space needs a passing gas test after submission, and a new one after suspension', async () => {
    const sup = await loggedIn(app.base, 'supA1x'); const eng = await loggedIn(app.base, 'engA1');
    const d = (await sup.post('/api/permits', hot({ permitType: 'confined_space', workDescription: 'Inspect inside the sump pit', details: { attendant: 'Helper B', entrants: ['Fitter C'], rescuePlan: 'RP-07 tripod and winch' } }))).data;
    assert.equal(d.gasTestNeeded, true);
    await go(sup, d.id, 'submit'); await go(eng, d.id, 'start_safety_review'); await confirmAll(eng, d.id);
    assert.ok((await go(eng, d.id, 'authorise')).data.error.details.some((x: { code: string }) => x.code === 'gas_test'));
    assert.equal((await gas(eng, d.id, true, hours(-3))).status, 201);
    assert.ok((await go(eng, d.id, 'authorise')).data.error.details.some((x: { code: string }) => x.code === 'gas_test'), 'a test from before submission does not count');
    await gas(eng, d.id, false);
    assert.ok((await go(eng, d.id, 'authorise')).data.error.details.some((x: { code: string }) => x.code === 'gas_test_failed'));
    assert.equal((await gas(eng, d.id, true, hours(2))).status, 400, 'future reading');
    await gas(eng, d.id, true);
    assert.equal((await go(eng, d.id, 'authorise')).status, 200);
    await go(sup, d.id, 'activate');
    await go(sup, d.id, 'suspend', { note: 'Gas alarm' });
    assert.equal((await go(eng, d.id, 'revalidate', { note: 'Retested' })).status, 422, 'needs a fresh test');
    await gas(sup, d.id, true);
    assert.equal((await go(eng, d.id, 'revalidate', { note: 'Retested, ventilation running' })).data.status, 'active');
  });

  it('electrical isolation needs locked isolation points and their removal at hand-back', async () => {
    const sup = await loggedIn(app.base, 'supA1x'); const eng = await loggedIn(app.base, 'engA1');
    const base = hot({ permitType: 'electrical_isolation', workDescription: 'Replace MCCB in DB-3A', details: { provedDeadBy: 'Electrician D' } });
    const d = (await sup.post('/api/permits', { ...base, isolations: [{ point: 'DB-3A incomer', lockNo: '' }] })).data;
    assert.deepEqual((await go(sup, d.id, 'submit')).data.error.details.map((x: { code: string }) => x.code), ['lock_numbers']);
    await sup.patch(`/api/permits/${d.id}`, { version: (await get(sup, d.id)).version, permit: { ...base, isolations: [{ point: 'DB-3A incomer', method: 'Breaker locked off', lockNo: 'L-114' }] } });
    await go(sup, d.id, 'submit'); await go(eng, d.id, 'start_safety_review'); await confirmAll(eng, d.id, true); await go(eng, d.id, 'authorise'); await go(sup, d.id, 'activate');
    assert.equal((await go(sup, d.id, 'complete', { note: 'MCCB replaced and tested' })).status, 400);
    assert.equal((await go(sup, d.id, 'complete', { note: 'MCCB replaced and tested', isolationsRemoved: true })).data.status, 'completed');
  });

  it('expires automatically when validity ends; an expired permit is copied, never extended', async () => {
    const sup = await loggedIn(app.base, 'supA1x'); const eng = await loggedIn(app.base, 'engA1');
    const d = (await sup.post('/api/permits', hot())).data;
    await go(sup, d.id, 'submit'); await go(eng, d.id, 'start_safety_review'); await confirmAll(eng, d.id, true); await go(eng, d.id, 'authorise'); await go(sup, d.id, 'activate');
    await app.db.query(`UPDATE permits SET valid_from = now() - interval '8 hours', valid_to = now() - interval '1 minute' WHERE id = $1`, [d.id]);
    const p = await get(sup, d.id);
    assert.equal(p.status, 'expired');
    assert.equal(p.history[0].event, 'expire'); assert.equal(p.history[0].actor, 'System');
    assert.equal((await go(sup, d.id, 'complete', { note: 'done done' })).status, 409);
    const copy = await sup.post(`/api/permits/${d.id}/copy`);
    assert.equal(copy.status, 201); assert.equal(copy.data.status, 'draft'); assert.notEqual(copy.data.ref, p.ref);
    assert.ok(copy.data.checks.every((c: { confirmed: boolean }) => !c.confirmed), 'checks start again');
    assert.ok((await app.db.query(`SELECT 1 FROM audit_log WHERE action = 'permit.expire' AND entity_id = $1 AND actor_user_id IS NULL`, [d.id])).rowCount);
  });

  it('warns about other live permits in the same site and time window, and lists live counts', async () => {
    const sup = await loggedIn(app.base, 'supA1x'); const eng = await loggedIn(app.base, 'engA1');
    const a = (await sup.post('/api/permits', hot({ location: 'Roof east' }))).data; await go(sup, a.id, 'submit');
    const b = (await sup.post('/api/permits', hot({ permitType: 'work_at_height', location: 'Roof east edge', details: { accessEquipment: 'MEWP', rescuePlan: 'RP-02' } }))).data; await go(sup, b.id, 'submit');
    const later = (await sup.post('/api/permits', hot({ validFrom: hours(10), validTo: hours(12) }))).data; await go(sup, later.id, 'submit');
    const view = await get(eng, b.id);
    assert.ok(view.simops.some((x: { id: string }) => x.id === a.id)); assert.ok(!view.simops.some((x: { id: string }) => x.id === later.id), 'no overlap');
    const list = (await eng.get(`/api/permits?projectId=${w.projA1}&view=awaiting`)).data;
    assert.ok(list.counts.awaiting >= 3); assert.ok(list.items.every((x: { status: string }) => ['submitted', 'safety_review'].includes(x.status)));
    assert.equal((await (await loggedIn(app.base, 'engA2')).get(`/api/permits?projectId=${w.projA1}`)).data.items.length, 0, 'other project sees nothing');
  });

  it('library files can be linked to a permit', async () => {
    const sup = await loggedIn(app.base, 'supA1x');
    const d = (await sup.post('/api/permits', hot())).data;
    const pdf = Buffer.from('%PDF-1.4\ntrailer << >>\n%%EOF\n');
    const u = (await sup.req('POST', '/api/library/uploads?filename=gas-cert.pdf', pdf, { 'content-type': 'application/octet-stream' })).data;
    const f = await sup.post('/api/library', { uploadId: u.uploadId, meta: { title: 'Welding set inspection', docType: 'certificate', projectId: w.projA1, siteId: w.siteA1x }, link: { recordType: 'permit', recordId: d.id } });
    assert.equal(f.status, 201, JSON.stringify(f.data)); assert.equal(f.data.links[0].ref, d.ref);
  });
});
