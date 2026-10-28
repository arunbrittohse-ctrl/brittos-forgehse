import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { freshDb, startApp, seedWorld, loggedIn, observationInput, type TestApp, type World } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const PDF2 = Buffer.from('%PDF-1.4\n% revision two\ntrailer << >>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const zipWith = (...names: string[]) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), ...names.map((n) => Buffer.from(n)), Buffer.alloc(16)]);
const DOCX = zipWith('[Content_Types].xml', 'word/document.xml');
const DOCM = zipWith('[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin');
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

type C = Awaited<ReturnType<typeof loggedIn>>;

describe('Document & evidence library', () => {
  let app: TestApp; let w: World;
  before(async () => { const db = await freshDb(); w = await seedWorld(db); app = await startApp(db); });
  after(async () => { await app.close(); await app.db.end(); });

  const stage = (c: C, buf: Buffer, name: string, headers: Record<string, string> = {}) => c.req('POST', `/api/library/uploads?filename=${encodeURIComponent(name)}`, buf, { 'content-type': 'application/octet-stream', ...headers });
  const meta = (o: Record<string, unknown> = {}) => ({ title: 'Lifting plan — tower crane TC1', docNumber: 'A1-LP-001', docType: 'plan', category: 'Lifting', tags: ['crane', 'lifting'], projectId: w.projA1, siteId: w.siteA1x, ...o });
  async function addFile(c: C, o: Record<string, unknown> = {}, buf = PDF, name = 'plan.pdf') {
    const u = await stage(c, buf, name);
    assert.equal(u.status, 201, JSON.stringify(u.data));
    return c.post('/api/library', { uploadId: u.data.uploadId, meta: meta(o) });
  }
  const act = async (c: C, id: string, action: string, note = '') => {
    const f = (await c.get(`/api/library/${id}`)).data;
    return c.post(`/api/library/${id}/versions/${f.versions[0].id}/transition`, { action, note, version: f.version });
  };

  it('checks file content, extension and checksum before accepting an upload', async () => {
    const eng = await loggedIn(app.base, 'engA1');
    assert.equal((await stage(eng, EXE, 'tool.pdf')).status, 415, 'not a PDF');
    assert.equal((await stage(eng, PDF, 'plan.docx')).status, 415, 'extension does not match content');
    const macro = await stage(eng, DOCM, 'form.docx');
    assert.equal(macro.status, 415); assert.match(macro.data.error.message, /Macro/);
    assert.equal((await stage(eng, PDF, 'plan.pdf', { 'x-content-sha256': 'f'.repeat(64) })).status, 422, 'checksum mismatch');
    const ok = await stage(eng, PDF, 'plan.pdf', { 'x-content-sha256': sha(PDF) });
    assert.equal(ok.status, 201); assert.equal(ok.data.sha256, sha(PDF)); assert.equal(ok.data.contentType, 'application/pdf');
    assert.equal((await stage(eng, DOCX, 'form.docx')).data.contentType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal((await stage(eng, Buffer.from('a,b\n1,2\n'), 'register.csv')).status, 201);
    assert.equal((await stage(await loggedIn(app.base, 'viewerA1'), PDF, 'plan.pdf')).status, 403, 'viewers cannot upload');
    const big = await stage(eng, Buffer.concat([PDF, Buffer.alloc(26 * 1024 * 1024)]), 'big.pdf');
    assert.equal(big.status, 413);
  });

  it('creates files in scope only, numbers them and records the upload in the audit trail', async () => {
    const eng = await loggedIn(app.base, 'engA1');
    const r = await addFile(eng);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.match(r.data.ref, /^LIB-\d{4}-\d{5}$/);
    assert.equal(r.data.versions.length, 1); assert.equal(r.data.versions[0].status, 'draft'); assert.equal(r.data.versions[0].sha256, sha(PDF));
    assert.equal((await addFile(eng, { projectId: null, siteId: null })).status, 403, 'organisation-wide files need an organisation-wide role');
    assert.equal((await addFile(eng, { projectId: w.projA2, siteId: null })).status, 403, 'other project');
    assert.equal((await addFile(eng, { siteId: w.siteA2 })).status, 400, 'site from another project');
    assert.equal((await addFile(eng, { expiryDate: '2020-01-01', issueDate: '2021-01-01' })).status, 400);
    const u = (await stage(eng, PDF, 'plan.pdf')).data;
    assert.equal((await (await loggedIn(app.base, 'offA1')).post('/api/library', { uploadId: u.uploadId, meta: meta() })).status, 400, 'a staged upload belongs to the person who uploaded it');
    assert.equal((await addFile(await loggedIn(app.base, 'corpA'), { projectId: null, siteId: null, title: 'Group HSE policy', docType: 'policy' })).status, 201);
    const a = await app.db.query<{ action: string; changes: { sha256: string } }>(`SELECT action, changes FROM audit_log WHERE entity_id = $1`, [r.data.id]);
    assert.equal(a.rows[0]!.action, 'library.upload'); assert.equal(a.rows[0]!.changes.sha256, sha(PDF));
  });

  it('keeps files inside their organisation, project and site', async () => {
    const eng = await loggedIn(app.base, 'engA1');
    const f = (await addFile(eng)).data;
    for (const k of ['engA2', 'engB']) assert.equal((await (await loggedIn(app.base, k)).get(`/api/library/${f.id}`)).status, 404, k);
    assert.equal((await (await loggedIn(app.base, 'supA1x')).get(`/api/library/${f.id}`)).status, 200, 'same site');
    assert.equal((await (await loggedIn(app.base, 'supA1y')).get(`/api/library/${f.id}`)).status, 404, 'other site');
    assert.equal((await (await loggedIn(app.base, 'viewerA1')).get(`/api/library/${f.id}`)).status, 404, 'readers only see approved files');
    const list = (await (await loggedIn(app.base, 'engB')).get('/api/library')).data;
    assert.ok(list.items.every((x: { id: string }) => x.id !== f.id));
    assert.equal((await (await loggedIn(app.base, 'engB')).get(`/api/library/versions/${f.versions[0].id}/content`)).status, 404);
  });

  it('approves versions only by an independent approver and supersedes the previous approved version', async () => {
    const eng = await loggedIn(app.base, 'engA1'); const corp = await loggedIn(app.base, 'corpA'); const off = await loggedIn(app.base, 'offA1');
    const f = (await addFile(eng)).data;
    assert.equal((await act(eng, f.id, 'approve')).status, 409, 'draft cannot be approved');
    assert.equal((await act(eng, f.id, 'submit')).status, 200);
    assert.equal((await act(eng, f.id, 'approve')).status, 403, 'no self-approval');
    assert.equal((await act(off, f.id, 'approve')).status, 403, 'officers cannot approve');
    assert.equal((await act(corp, f.id, 'reject')).status, 400, 'rejection needs a reason');
    const ap = await act(corp, f.id, 'approve', 'Checked against the lift study');
    assert.equal(ap.status, 200, JSON.stringify(ap.data)); assert.equal(ap.data.versions[0].status, 'approved'); assert.equal(ap.data.currentVersionId, ap.data.versions[0].id);

    const viewer = await loggedIn(app.base, 'viewerA1');
    assert.equal((await viewer.get(`/api/library/${f.id}`)).status, 200, 'approved files are visible to readers');

    const u = (await stage(eng, PDF2, 'plan-r2.pdf')).data;
    const cur = (await eng.get(`/api/library/${f.id}`)).data;
    assert.equal((await eng.post(`/api/library/${f.id}/versions`, { uploadId: u.uploadId, version: cur.version, changeNote: '' })).status, 400, 'a change note is required');
    const v2 = await eng.post(`/api/library/${f.id}/versions`, { uploadId: u.uploadId, version: cur.version, changeNote: 'Crane moved to grid C4' });
    assert.equal(v2.status, 201, JSON.stringify(v2.data));
    assert.deepEqual(v2.data.versions.map((v: { status: string }) => v.status), ['draft', 'approved']);
    const u3 = (await stage(eng, PDF, 'plan-r3.pdf')).data;
    assert.equal((await eng.post(`/api/library/${f.id}/versions`, { uploadId: u3.uploadId, version: v2.data.version, changeNote: 'Another' })).status, 409, 'one open version at a time');
    assert.equal((await viewer.get(`/api/library/${f.id}`)).data.versions.length, 1, 'readers do not see the draft');
    await act(eng, f.id, 'submit');
    const ap2 = await act(corp, f.id, 'approve');
    assert.deepEqual(ap2.data.versions.map((v: { status: string }) => v.status), ['approved', 'superseded']);
    const content = await viewer.get(`/api/library/versions/${ap2.data.versions[0].id}/content`);
    assert.equal(content.status, 200); assert.ok(Buffer.compare(content.data, PDF2) === 0); assert.equal(content.headers.get('x-content-sha256'), sha(PDF2));
    assert.match(content.headers.get('content-security-policy')!, /sandbox/);
    assert.ok((await app.db.query(`SELECT 1 FROM audit_log WHERE action = 'library.view_file' AND entity_id = $1`, [f.id])).rowCount);
  });

  it('the database refuses to change or delete a version', async () => {
    const eng = await loggedIn(app.base, 'engA1');
    const f = (await addFile(eng)).data;
    await assert.rejects(app.db.query(`UPDATE library_versions SET sha256 = $1 WHERE id = $2`, ['0'.repeat(64), f.versions[0].id]), /immutable/);
    await assert.rejects(app.db.query(`DELETE FROM library_versions WHERE id = $1`, [f.versions[0].id]), /cannot be deleted/);
    await assert.rejects(app.db.query(`UPDATE library_versions SET status = 'approved', decided_by = uploaded_by WHERE id = $1`, [f.versions[0].id]), /check/i);
  });

  it('applies confidentiality on top of project scope', async () => {
    const off = await loggedIn(app.base, 'offA1');
    const restricted = (await addFile(off, { title: 'Medical fitness certificates', confidentiality: 'restricted', docType: 'certificate' })).data;
    assert.equal((await off.get(`/api/library/${restricted.id}`)).status, 200, 'uploader');
    assert.equal((await (await loggedIn(app.base, 'corpA')).get(`/api/library/${restricted.id}`)).status, 200, 'approver');
    assert.equal((await (await loggedIn(app.base, 'engA1')).get(`/api/library/${restricted.id}`)).status, 404, 'other HSE staff');
    const conf = (await addFile(off, { title: 'Investigation interview notes', confidentiality: 'confidential' })).data;
    assert.equal((await (await loggedIn(app.base, 'engA1')).get(`/api/library/${conf.id}`)).status, 200);
    assert.equal((await (await loggedIn(app.base, 'supA1x')).get(`/api/library/${conf.id}`)).status, 404, 'field reporters do not see confidential files');
  });

  it('links files to records in the same project and lists them by record', async () => {
    const eng = await loggedIn(app.base, 'engA1'); const engB = await loggedIn(app.base, 'engB');
    const obs = (await eng.post('/api/observations', observationInput(w))).data;
    const other = (await (await loggedIn(app.base, 'engA2')).post('/api/observations', observationInput(w, { projectId: w.projA2, siteId: w.siteA2 }))).data;
    const obsB = (await engB.post('/api/observations', observationInput(w, { projectId: w.projB1, siteId: w.siteB1 }))).data;
    const f = (await addFile(eng, {}, PNG, 'edge.png')).data;
    const l = await eng.post(`/api/library/${f.id}/links`, { recordType: 'observation', recordId: obs.id });
    assert.equal(l.status, 201, JSON.stringify(l.data)); assert.equal(l.data.links[0].ref, obs.refNo);
    assert.equal((await eng.post(`/api/library/${f.id}/links`, { recordType: 'observation', recordId: other.id })).status, 404, 'cannot see the other project record');
    assert.equal((await eng.post(`/api/library/${f.id}/links`, { recordType: 'observation', recordId: obsB.id })).status, 404, 'other organisation');
    const byRecord = (await eng.get(`/api/library?recordType=observation&recordId=${obs.id}`)).data;
    assert.deepEqual(byRecord.items.map((x: { id: string }) => x.id), [f.id]);
    const un = await app.db.query<{ id: string }>('SELECT id FROM library_links WHERE file_id = $1', [f.id]);
    const d = await eng.req('DELETE', `/api/library/${f.id}/links/${un.rows[0]!.id}`);
    assert.equal(d.status, 200); assert.equal(d.data.links.length, 0);
    const direct = await (async () => { const u = (await stage(eng, PDF, 'photo-note.pdf')).data; return eng.post('/api/library', { uploadId: u.uploadId, meta: meta({ title: 'Closure evidence' }), link: { recordType: 'observation', recordId: obs.id } }); })();
    assert.equal(direct.status, 201); assert.equal(direct.data.links.length, 1, 'upload and link in one step');
  });

  it('download links expire and work without a session; obsolete files stop working', async () => {
    const eng = await loggedIn(app.base, 'engA1'); const corp = await loggedIn(app.base, 'corpA');
    const f = (await addFile(eng)).data;
    const link = await eng.post(`/api/library/versions/${f.versions[0].id}/share-link`);
    assert.equal(link.status, 201);
    assert.ok(new Date(link.data.expiresAt).getTime() - Date.now() <= 10 * 60_000 + 5000);
    const anon = await fetch(app.base + link.data.path);
    assert.equal(anon.status, 200); assert.ok(Buffer.compare(Buffer.from(await anon.arrayBuffer()), PDF) === 0);
    assert.equal((await fetch(app.base + '/api/library/dl/' + 'A'.repeat(43))).status, 410);
    assert.equal((await fetch(app.base + '/api/library/dl/short')).status, 404);
    await app.db.query(`UPDATE library_download_links SET created_at = now() - interval '30 minutes', expires_at = now() - interval '1 second'`);
    assert.equal((await fetch(app.base + link.data.path)).status, 410, 'expired');

    const cur = (await eng.get(`/api/library/${f.id}`)).data;
    assert.equal((await eng.post(`/api/library/${f.id}/obsolete`, { version: cur.version, note: '' })).status, 400, 'reason required');
    const ob = await eng.post(`/api/library/${f.id}/obsolete`, { version: cur.version, note: 'Wrong crane' });
    assert.equal(ob.status, 200, 'the uploader may withdraw a file that was never approved'); assert.equal(ob.data.status, 'obsolete');
    assert.equal((await corp.post(`/api/library/versions/${f.versions[0].id}/share-link`)).status, 409);
  });

  it('filters by expiry and counts what needs attention', async () => {
    const corp = await loggedIn(app.base, 'corpA');
    await addFile(corp, { title: 'Crane load test certificate', docType: 'certificate', issueDate: '2025-01-01', expiryDate: '2025-12-31' });
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await addFile(corp, { title: 'Scaffold inspection tag', docType: 'certificate', expiryDate: soon });
    const expired = (await corp.get('/api/library?expiry=expired')).data;
    assert.ok(expired.items.length >= 1 && expired.items.every((x: { expiry: string }) => x.expiry === 'expired'));
    const due = (await corp.get('/api/library?expiry=due_30')).data;
    assert.ok(due.items.some((x: { title: string; expiry: string }) => x.title === 'Scaffold inspection tag' && x.expiry === 'due_30'));
    assert.ok(due.counts.expired >= 1 && due.counts.due >= 1);
    assert.ok((await corp.get('/api/library?q=load%20test')).data.items.length === 1);
  });
});
