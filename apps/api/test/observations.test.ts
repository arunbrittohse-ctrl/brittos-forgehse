import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDb, startApp, seedWorld, loggedIn, observationInput, today, type TestApp, type World, type Client } from './helpers';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

describe('observations: workflow, RBAC and tenant isolation', () => {
  let app: TestApp; let w: World;
  let eng: Client, off: Client, supX: Client, supY: Client, viewer: Client, engA2: Client, engB: Client, corp: Client, admin: Client;

  before(async () => {
    const db = await freshDb(); w = await seedWorld(db); app = await startApp(db);
    [eng, off, supX, supY, viewer, engA2, engB, corp, admin] = await Promise.all(
      ['engA1', 'offA1', 'supA1x', 'supA1y', 'viewerA1', 'engA2', 'engB', 'corpA', 'adminA'].map((k) => loggedIn(app.base, k))) as Record<number, Client> as Client[] & [Client, Client, Client, Client, Client, Client, Client, Client, Client];
  });
  after(async () => { await app.close(); await app.db.end(); });

  it('creates an observation with a reference number and server-calculated risk', async () => {
    const r = await supX.post('/api/observations', observationInput(w, { likelihood: 4, severity: 5 }));
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.match(r.data.refNo, /^OBS-A1-\d{4}-00001$/);
    assert.equal(r.data.riskScore, 20);
    assert.equal(r.data.riskBand, 'critical');
    assert.equal(r.data.status, 'open');
    const r2 = await supX.post('/api/observations', observationInput(w));
    assert.match(r2.data.refNo, /-00002$/);
  });

  it('is idempotent for offline retries using clientRef', async () => {
    const clientRef = randomUUID();
    const mobile = await loggedIn(app.base, 'supA1x', 'mobile');
    const a = await mobile.post('/api/observations', observationInput(w, { clientRef }));
    const [b, c] = await Promise.all([mobile.post('/api/observations', observationInput(w, { clientRef })), mobile.post('/api/observations', observationInput(w, { clientRef }))]);
    assert.equal(a.status, 201);
    assert.equal(b.status, 200); assert.equal(c.status, 200);
    assert.equal(b.data.id, a.data.id); assert.equal(b.data.duplicate, true);
    const n = await app.db.query<{ n: number }>('SELECT count(*)::int AS n FROM observations WHERE client_ref = $1', [clientRef]);
    assert.equal(n.rows[0]!.n, 1);
    // Another user cannot replay someone else's key.
    const other = await off.post('/api/observations', observationInput(w, { clientRef }));
    assert.equal(other.status, 409);
  });

  it('validates input and rejects unknown hazard categories / out-of-matrix ratings', async () => {
    assert.equal((await supX.post('/api/observations', observationInput(w, { hazardCategory: 'Made up' }))).status, 400);
    assert.equal((await supX.post('/api/observations', observationInput(w, { likelihood: 7 }))).status, 400);
    assert.equal((await supX.post('/api/observations', observationInput(w, { description: '' }))).status, 400);
    assert.equal((await supX.post('/api/observations', observationInput(w, { observedAt: new Date(Date.now() + 86_400_000).toISOString() }))).status, 400);
  });

  it('enforces create permissions by role, project and site', async () => {
    assert.equal((await viewer.post('/api/observations', observationInput(w))).status, 403, 'viewer cannot create');
    assert.equal((await admin.post('/api/observations', observationInput(w))).status, 403, 'org admin is not an HSE role');
    assert.equal((await supX.post('/api/observations', observationInput(w, { siteId: w.siteA1y }))).status, 403, 'site-scoped supervisor, other site');
    assert.equal((await engA2.post('/api/observations', observationInput(w))).status, 403, 'other project');
    assert.equal((await engB.post('/api/observations', observationInput(w))).status, 403, 'other organisation');
    // A site from another project cannot be smuggled in (rejected as invalid input; nothing is created).
    assert.equal((await eng.post('/api/observations', observationInput(w, { siteId: w.siteA2 }))).status, 400);
    assert.equal((await engB.post('/api/observations', observationInput(w, { projectId: w.projB1, siteId: w.siteA1x }))).status, 400);
  });

  it('isolates organisations, projects and sites on read (404, never leaking existence)', async () => {
    const created = (await supX.post('/api/observations', observationInput(w))).data;
    assert.equal((await engB.get(`/api/observations/${created.id}`)).status, 404, 'other organisation');
    assert.equal((await engA2.get(`/api/observations/${created.id}`)).status, 404, 'other project');
    assert.equal((await supY.get(`/api/observations/${created.id}`)).status, 404, 'other site');
    assert.equal((await viewer.get(`/api/observations/${created.id}`)).status, 200, 'project viewer');
    assert.equal((await corp.get(`/api/observations/${created.id}`)).status, 200, 'org-wide role');

    const listB = await engB.get('/api/observations?pageSize=200');
    assert.equal(listB.data.total, 0);
    const listY = await supY.get('/api/observations?pageSize=200');
    assert.ok(listY.data.items.every((o: { siteId: string }) => o.siteId === w.siteA1y));
    // Filtering by a foreign project id does not widen scope.
    const sneaky = await engB.get(`/api/observations?projectId=${w.projA1}`);
    assert.equal(sneaky.data.total, 0);
    // Exports and dashboard are scoped the same way.
    const csv = await engB.get('/api/observations/export?format=csv');
    assert.equal(csv.data.toString('utf8').trim().split('\n').length, 1, 'header only');
    const dashB = await engB.get('/api/dashboard');
    assert.equal(dashB.data.kpis.reported, 0);
  });

  it('runs the full workflow: assign → submit → (segregated) verify → close → reopen', async () => {
    const o = (await off.post('/api/observations', observationInput(w))).data;
    const id = o.id;
    // Supervisor cannot assign.
    assert.equal((await supX.post(`/api/observations/${id}/transitions`, { transition: 'assign', version: 1, assigneeId: w.users.supA1x, dueDate: today(3) })).status, 403);
    // Past due dates and out-of-scope assignees are rejected.
    assert.equal((await off.post(`/api/observations/${id}/transitions`, { transition: 'assign', version: 1, assigneeId: w.users.supA1x, dueDate: today(-1) })).status, 400);
    assert.equal((await off.post(`/api/observations/${id}/transitions`, { transition: 'assign', version: 1, assigneeId: w.users.engB, dueDate: today(3) })).status, 400);
    assert.equal((await off.post(`/api/observations/${id}/transitions`, { transition: 'assign', version: 1, assigneeId: w.users.supA1y, dueDate: today(3) })).status, 400, 'assignee scoped to another site');

    const assigned = await off.post(`/api/observations/${id}/transitions`, { transition: 'assign', version: 1, assigneeId: w.users.supA1x, dueDate: today(3), correctiveAction: 'Install edge protection' });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
    assert.equal(assigned.data.status, 'assigned');

    // Stale version → conflict.
    assert.equal((await supX.post(`/api/observations/${id}/transitions`, { transition: 'submit_action', version: 1, actionTaken: 'Guardrail installed' })).status, 409);
    // Not the assignee and no assign permission → forbidden.
    assert.equal((await supY.post(`/api/observations/${id}/transitions`, { transition: 'submit_action', version: 2, actionTaken: 'x x x x x' })).status, 404);

    const submitted = await supX.post(`/api/observations/${id}/transitions`, { transition: 'submit_action', version: 2, actionTaken: 'Guardrail installed and inspected' });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.data.status, 'action_submitted');

    // The officer cannot verify (no permission); reject requires a comment.
    assert.equal((await off.post(`/api/observations/${id}/transitions`, { transition: 'verify_close', version: 3 })).status, 403);
    assert.equal((await eng.post(`/api/observations/${id}/transitions`, { transition: 'reject_action', version: 3 })).status, 400);

    const rejected = await eng.post(`/api/observations/${id}/transitions`, { transition: 'reject_action', version: 3, comment: 'Toe board missing' });
    assert.equal(rejected.data.status, 'assigned');
    await supX.post(`/api/observations/${id}/transitions`, { transition: 'submit_action', version: 4, actionTaken: 'Toe board fitted' });

    const closed = await eng.post(`/api/observations/${id}/transitions`, { transition: 'verify_close', version: 5, comment: 'Verified on site' });
    assert.equal(closed.status, 200);
    assert.equal(closed.data.status, 'closed');
    assert.ok(closed.data.closedAt);

    // Closed records cannot be edited.
    assert.equal((await off.patch(`/api/observations/${id}`, { version: 6, description: 'Changed after closure' })).status, 409);
    // Illegal transition.
    assert.equal((await eng.post(`/api/observations/${id}/transitions`, { transition: 'assign', version: 6, assigneeId: w.users.supA1x, dueDate: today(2) })).status, 409);

    const reopened = await eng.post(`/api/observations/${id}/transitions`, { transition: 'reopen', version: 6, comment: 'Guardrail removed again' });
    assert.equal(reopened.data.status, 'open');

    const detail = await eng.get(`/api/observations/${id}`);
    assert.deepEqual(detail.data.events.map((e: { event: string }) => e.event), ['created', 'assign', 'submit_action', 'reject_action', 'submit_action', 'verify_close', 'reopen']);
    const audits = await app.db.query<{ action: string }>("SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY id", [id]);
    assert.equal(audits.rows.length, 7);
  });

  it('prevents the action submitter from verifying their own work', async () => {
    const o = (await eng.post('/api/observations', observationInput(w))).data;
    await eng.post(`/api/observations/${o.id}/transitions`, { transition: 'assign', version: 1, assigneeId: w.users.engA1, dueDate: today(2) });
    await eng.post(`/api/observations/${o.id}/transitions`, { transition: 'submit_action', version: 2, actionTaken: 'Did it myself' });
    const self = await eng.post(`/api/observations/${o.id}/transitions`, { transition: 'verify_close', version: 3 });
    assert.equal(self.status, 403);
    assert.match(self.data.error.message, /cannot verify/);
    assert.equal((await corp.post(`/api/observations/${o.id}/transitions`, { transition: 'verify_close', version: 3 })).status, 200);
  });

  it('only allows on-the-spot closure when an immediate action is recorded', async () => {
    const noAction = (await eng.post('/api/observations', observationInput(w))).data;
    assert.equal((await eng.post(`/api/observations/${noAction.id}/transitions`, { transition: 'verify_close', version: 1 })).status, 400);
    const withAction = (await eng.post('/api/observations', observationInput(w, { immediateAction: 'Barrier reinstated immediately' }))).data;
    assert.equal((await eng.post(`/api/observations/${withAction.id}/transitions`, { transition: 'verify_close', version: 1 })).status, 200);
  });

  it('lets reporters edit their own open records, recalculating risk, with optimistic locking', async () => {
    const o = (await supX.post('/api/observations', observationInput(w, { likelihood: 1, severity: 1 }))).data;
    const r = await supX.patch(`/api/observations/${o.id}`, { version: 1, likelihood: 5, severity: 5 });
    assert.equal(r.status, 200);
    assert.equal(r.data.riskBand, 'critical');
    assert.equal(r.data.version, 2);
    assert.equal((await supX.patch(`/api/observations/${o.id}`, { version: 1, location: 'Stale edit' })).status, 409);
    const other = (await off.post('/api/observations', observationInput(w))).data;
    assert.equal((await supX.patch(`/api/observations/${other.id}`, { version: 1, location: 'Not mine' })).status, 403);
  });

  it('flags overdue items in list, dashboard and filters', async () => {
    const o = (await eng.post('/api/observations', observationInput(w))).data;
    await eng.post(`/api/observations/${o.id}/transitions`, { transition: 'assign', version: 1, assigneeId: w.users.supA1x, dueDate: today(1) });
    await app.db.query("UPDATE observations SET due_date = current_date - 5 WHERE id = $1", [o.id]);
    const overdue = await eng.get('/api/observations?status=overdue');
    assert.ok(overdue.data.items.some((x: { id: string; overdue: boolean }) => x.id === o.id && x.overdue));
    const dash = await eng.get('/api/dashboard');
    assert.ok(dash.data.kpis.overdueNow >= 1);
    assert.ok(dash.data.overdueByAssignee.some((a: { id: string }) => a.id === w.users.supA1x));
    assert.equal(dash.data.modules.incidents.available, false, 'unbuilt modules are reported as unavailable, not zero');
  });

  it('filters the register by risk score, hazard category and owner for chart drill-down', async () => {
    const o = (await eng.post('/api/observations', observationInput(w, { likelihood: 3, severity: 3 }))).data;
    await eng.post(`/api/observations/${o.id}/transitions`, { transition: 'assign', version: 1, assigneeId: w.users.supA1x, dueDate: today(3) });
    const byScore = (await eng.get('/api/observations?riskScore=9&pageSize=200')).data.items as { id: string; riskScore: number }[];
    assert.ok(byScore.some((x) => x.id === o.id) && byScore.every((x) => x.riskScore === 9));
    const byHazard = (await eng.get(`/api/observations?hazardCategory=${encodeURIComponent('Work at height')}&pageSize=200`)).data.items as { hazardCategory: string }[];
    assert.ok(byHazard.length > 0 && byHazard.every((x) => x.hazardCategory === 'Work at height'));
    assert.equal((await eng.get(`/api/observations?hazardCategory=${encodeURIComponent('No such hazard')}`)).data.total, 0);
    const byOwner = (await eng.get(`/api/observations?assigneeId=${w.users.supA1x}&pageSize=200`)).data.items as { id: string; assigneeId: string }[];
    assert.ok(byOwner.some((x) => x.id === o.id) && byOwner.every((x) => x.assigneeId === w.users.supA1x));
    assert.equal((await eng.get('/api/observations?assigneeId=not-a-uuid')).status, 400);
    // A filter never widens scope: another organisation's engineer sees nothing for the same owner.
    assert.equal((await engB.get(`/api/observations?assigneeId=${w.users.supA1x}`)).data.total, 0);
  });

  it('accepts image evidence by magic bytes, rejects other types, and scopes downloads', async () => {
    const o = (await supX.post('/api/observations', observationInput(w))).data;
    const up = await supX.req('POST', `/api/observations/${o.id}/attachments?filename=edge.png`, PNG, { 'content-type': 'image/png' });
    assert.equal(up.status, 201, JSON.stringify(up.data));
    assert.equal(up.data.contentType, 'image/png');
    const fake = await supX.req('POST', `/api/observations/${o.id}/attachments?filename=evil.png`, Buffer.from('<html><script>alert(1)</script></html>'), { 'content-type': 'image/png' });
    assert.equal(fake.status, 415);
    const dl = await viewer.get(`/api/attachments/${up.data.id}`);
    assert.equal(dl.status, 200);
    assert.ok(Buffer.compare(dl.data, PNG) === 0);
    assert.match(dl.headers.get('content-security-policy')!, /sandbox/);
    assert.equal((await engB.get(`/api/attachments/${up.data.id}`)).status, 404);
    assert.equal((await supY.get(`/api/attachments/${up.data.id}`)).status, 404);
  });

  it('exports a scoped register as PDF, XLSX and CSV and audits the export', async () => {
    const pdf = await eng.get('/api/observations/export?format=pdf');
    assert.equal(pdf.status, 200);
    assert.equal(pdf.data.subarray(0, 5).toString(), '%PDF-');
    const xlsx = await eng.get('/api/observations/export?format=xlsx');
    assert.equal(xlsx.data.subarray(0, 2).toString(), 'PK');
    assert.equal((await supX.get('/api/observations/export?format=csv')).status, 403, 'supervisor has no export permission');
    const a = await app.db.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE action = 'report.export'");
    assert.ok(a.rows[0]!.n >= 2);
  });

  it('neutralises spreadsheet formula injection in exports', async () => {
    await eng.post('/api/observations', observationInput(w, { location: '=HYPERLINK("http://evil")' }));
    const csv = (await eng.get('/api/observations/export?format=csv')).data.toString('utf8');
    assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"")"`));
  });

  it('restricts the audit trail to org-wide auditors', async () => {
    assert.equal((await eng.get('/api/audit')).status, 403);
    const r = await corp.get('/api/audit');
    assert.equal(r.status, 200);
    assert.ok(r.data.total > 0);
    assert.equal((await engB.get('/api/audit')).status, 403);
  });
});
