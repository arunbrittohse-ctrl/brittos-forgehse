import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { DOC_TYPE_KEYS, docType, type DocContent } from '@forgehse/shared';
import { sampleInputs } from '../../../packages/shared/src/documents/fixtures';
import { freshDb, startApp, seedWorld, loggedIn, type TestApp, type World } from './helpers';
import type { AiBackend } from '../src/ai/providers/types';
import { LocalRulesBackend } from '../src/ai/providers/local/backend';

/** Text of a .docx (all XML parts, tags removed). */
async function docxText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const parts = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  const xml = (await Promise.all(parts.map((p) => zip.file(p)!.async('string')))).join('\n');
  return xml.replace(/<w:tab\/>/g, ' ').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** Text drawn on the pages of a pdf-lib PDF (inflates content streams and decodes the hex strings). */
function pdfText(buf: Buffer): string {
  const s = buf.toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    const raw = Buffer.from(s.slice(start, end).replace(/\r?\n$/, ''), 'latin1');
    let body: string;
    try { body = inflateSync(raw).toString('latin1'); } catch { body = raw.toString('latin1'); }
    for (const t of body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(t[1]!, 'hex').toString('latin1'));
    for (const t of body.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) out.push(t[1]!);
    re.lastIndex = end + 9;
  }
  return out.join('\n');
}

/** What an assessor does before submitting: rate every row, accept suggestions and resolve placeholders. */
function completeContent(c: DocContent): DocContent {
  const x = structuredClone(c);
  const fill = (s: string) => s.replace(/\[(?:confirm|insert|to be confirmed|tbc|to confirm|add|verify)[^\]]*\]/gi, 'Confirmed by assessor');
  for (const s of x.sections) {
    s.heading = fill(s.heading); s.text = fill(s.text); s.bullets = s.bullets.map(fill);
    if (s.table) s.table.rows = s.table.rows.map((r) => r.map(fill));
    if (s.origin === 'model') s.origin = 'author';
  }
  for (const r of x.riskRows) {
    r.initialLikelihood = 4; r.initialSeverity = 4; r.residualLikelihood = 2; r.residualSeverity = 4;
    r.additionalControls = ['Engineering: hard barrier exclusion zone'];
    for (const k of ['step', 'hazard', 'consequence', 'exposed', 'controlOwner', 'verification'] as const) r[k] = fill(r[k]);
    r.existingControls = r.existingControls.map(fill);
    if (!r.existingControls.length) r.existingControls = ['Administrative: supervised method'];
    if (r.origin === 'model') r.origin = 'author';
  }
  return x;
}

/** A stand-in for a locally hosted language model, used only in tests (clearly not the rules engine). */
function stubModelBackend(): AiBackend & { calls: number } {
  const b = {
    id: 'openai_compatible' as const, label: 'Test stub model (not a real model)', model: 'test-stub-model', configured: true, deterministic: false, calls: 0,
    async send() {
      b.calls++;
      return { content: [{ type: 'tool_use' as const, id: 't1', name: 'emit_document_suggestions', input: {
        additionalHazards: [{ step: 'Grouting parapet bases', hazard: 'Skin contact with wet grout', consequence: 'Skin burns', controls: ['PPE: impervious gloves'] }],
        additionalPoints: [{ heading: 'Coastal wind', points: ['Check wind conditions before each lift'] }],
      } }], stopReason: 'tool_use', usage: {}, model: 'test-stub-model' };
    },
    async stream() { throw new Error('not used'); },
  };
  return b;
}

describe('HSE Document Studio API', () => {
  let app: TestApp; let w: World;
  before(async () => { const db = await freshDb(); w = await seedWorld(db); app = await startApp(db, { backend: new LocalRulesBackend() }); });
  after(async () => { await app.close(); await app.db.end(); });

  const generate = async (c: Awaited<ReturnType<typeof loggedIn>>, t: (typeof DOC_TYPE_KEYS)[number], extra: Record<string, unknown> = {}) =>
    c.post('/api/documents', { docType: t, projectId: docType(t).family === 'policy' ? null : w.projA1, siteId: null, inputs: sampleInputs(t), ...extra });

  it('generates, edits, saves, reopens and exports every document type with the saved content', async () => {
    const eng = await loggedIn(app.base, 'engA1');
    for (const t of DOC_TYPE_KEYS) {
      const g = await generate(eng, t);
      assert.equal(g.status, 201, `${t}: ${JSON.stringify(g.data)}`);
      const d = g.data;
      assert.match(d.docNumber, new RegExp(`${docType(t).code}-\\d{4}-\\d{4}$`));
      assert.equal(d.status, 'draft'); assert.equal(d.revisionLabel, 'Rev 00');
      assert.equal(d.generator.modelCalled, false); assert.equal(d.generator.mode, 'template');
      if (docType(t).riskRegister) assert.equal(d.readiness.ready, false, `${t}: unrated risk rows block submission`);
      assert.equal(d.readiness.ready, d.readiness.issues.length === 0);

      // Edit: change the title and one section, then save.
      const marker = `EDITED-${t.toUpperCase()}-${Date.now()}`;
      const content: DocContent = structuredClone(d.content);
      content.sections[0]!.text = `${marker} — author note.`;
      content.sections[0]!.origin = 'author';
      const s = await eng.patch(`/api/documents/${d.id}`, { version: d.version, title: `Edited ${t}`, content, changeNote: 'Author edits' });
      assert.equal(s.status, 200, `${t} save: ${JSON.stringify(s.data)}`);
      assert.equal(s.data.version, d.version + 1);

      // Reopen.
      const r = await eng.get(`/api/documents/${d.id}`);
      assert.equal(r.data.title, `Edited ${t}`);
      assert.equal(r.data.content.sections[0].text, `${marker} — author note.`);
      assert.equal(r.data.content.sections[0].origin, 'author');

      // Export: both formats carry the saved edit, the number, revision and draft status.
      const docx = await eng.get(`/api/documents/${d.id}/export?format=docx`);
      assert.equal(docx.status, 200);
      assert.match(String(docx.headers.get('content-disposition')), /-DRAFT\.docx"/);
      const dt = await docxText(docx.data);
      for (const needle of [marker, `Edited ${t}`, d.docNumber, 'Rev 00', 'DRAFT — NOT APPROVED', docType(t).label.toUpperCase()]) assert.ok(dt.includes(needle), `${t} docx missing ${needle}`);
      const pdf = await eng.get(`/api/documents/${d.id}/export?format=pdf`);
      assert.equal(pdf.status, 200);
      assert.equal(pdf.data.subarray(0, 5).toString(), '%PDF-');
      const pt = pdfText(pdf.data);
      for (const needle of [marker, `Edited ${t}`, d.docNumber, 'Rev 00', 'DRAFT - NOT APPROVED', 'Page 1 of']) assert.ok(pt.includes(needle), `${t} pdf missing ${needle}`);
      if (docType(t).riskRegister) {
        assert.ok(dt.includes('Risk register') && dt.includes('Not rated'), `${t}: register exported with unrated rows`);
        assert.ok(pt.includes('Risk register'), `${t}: pdf register`);
      }
    }
  });

  it('validates inputs and content', async () => {
    const eng = await loggedIn(app.base, 'engA1');
    const miss = await eng.post('/api/documents', { docType: 'risk_assessment', projectId: w.projA1, inputs: { title: 'Lift' } });
    assert.equal(miss.status, 400);
    assert.deepEqual(miss.data.error.details.map((x: { path: string }) => x.path), ['inputs.activity']);
    assert.equal((await eng.post('/api/documents', { docType: 'made_up', projectId: w.projA1, inputs: { title: 'x' } })).status, 400);
    assert.equal((await eng.post('/api/documents', { docType: 'risk_assessment', inputs: sampleInputs('risk_assessment') })).status, 400, 'project required for project documents');
    const g = await generate(eng, 'risk_assessment');
    const bad = await eng.patch(`/api/documents/${g.data.id}`, { version: g.data.version, content: { ...g.data.content, sections: [] } });
    assert.equal(bad.status, 400);
    const stale = await eng.patch(`/api/documents/${g.data.id}`, { version: g.data.version, title: 'First save' });
    assert.equal(stale.status, 200);
    const again = await eng.patch(`/api/documents/${g.data.id}`, { version: g.data.version, title: 'Stale save' });
    assert.equal(again.status, 409, 'optimistic locking');
  });

  it('enforces permissions, project scope and tenant isolation', async () => {
    const eng = await loggedIn(app.base, 'engA1');
    const g = await generate(eng, 'method_statement');
    const sup = await loggedIn(app.base, 'supA1x');
    assert.equal((await generate(sup, 'risk_assessment')).status, 403, 'supervisors view documents but do not author them');
    const viewer = await loggedIn(app.base, 'viewerA1');
    assert.equal((await viewer.get(`/api/documents/${g.data.id}`)).status, 404, 'viewers do not see drafts');
    assert.ok(!(await viewer.get('/api/documents')).data.items.some((x: { id: string }) => x.id === g.data.id));
    const other = await loggedIn(app.base, 'engA2');
    assert.equal((await other.get(`/api/documents/${g.data.id}`)).status, 404, 'other project');
    assert.equal((await generate(other, 'risk_assessment')).status, 403, 'cannot create in a project outside scope');
    const tenant = await loggedIn(app.base, 'engB');
    assert.equal((await tenant.get(`/api/documents/${g.data.id}`)).status, 404, 'other organisation');
    assert.equal((await tenant.get(`/api/documents/${g.data.id}/export?format=pdf`)).status, 404);
    assert.equal((await tenant.patch(`/api/documents/${g.data.id}`, { version: g.data.version, title: 'hijack' })).status, 404);
    const anon = await (await import('./helpers')).Client.prototype.req.call(new (await import('./helpers')).Client(app.base), 'GET', '/api/documents');
    assert.equal(anon.status, 401);
  });

  it('runs the review workflow with readiness checks, independent approval and preserved revisions', async () => {
    const off = await loggedIn(app.base, 'offA1');
    const eng = await loggedIn(app.base, 'engA1');
    const corp = await loggedIn(app.base, 'corpA');
    let d = (await generate(off, 'risk_assessment')).data;

    const early = await off.post(`/api/documents/${d.id}/submit`, { version: d.version });
    assert.equal(early.status, 422);
    const codes = early.data.error.details.map((x: { code: string }) => x.code);
    assert.ok(codes.includes('placeholders') && codes.includes('risk_initial_unrated'), JSON.stringify(codes));

    // Residual lower than initial without additional controls is refused.
    const weak = completeContent(d.content); weak.riskRows[0]!.additionalControls = [];
    d = (await off.patch(`/api/documents/${d.id}`, { version: d.version, content: weak })).data;
    assert.ok(d.readiness.issues.some((x: { code: string }) => x.code === 'risk_reduction_unsupported'));

    d = (await off.patch(`/api/documents/${d.id}`, { version: d.version, content: completeContent(d.content), changeNote: 'Ratings assessed' })).data;
    assert.deepEqual(d.readiness.issues, []);
    assert.ok(d.readiness.warnings.some((x: { code: string }) => x.code === 'qualified_review'));
    d = (await off.post(`/api/documents/${d.id}/submit`, { version: d.version, note: 'Ready' })).data;
    assert.equal(d.status, 'in_review');
    assert.equal((await off.patch(`/api/documents/${d.id}`, { version: d.version, title: 'Change in review' })).status, 409, 'locked in review');

    assert.equal((await off.post(`/api/documents/${d.id}/decision`, { version: d.version, decision: 'approve' })).status, 403, 'no self-approval');
    assert.equal((await eng.post(`/api/documents/${d.id}/decision`, { version: d.version, decision: 'approve' })).status, 403, 'hse_engineer has no document.approve');
    assert.equal((await corp.post(`/api/documents/${d.id}/decision`, { version: d.version, decision: 'return', note: '' })).status, 400, 'return needs a comment');
    d = (await corp.post(`/api/documents/${d.id}/decision`, { version: d.version, decision: 'return', note: 'Name the lifting supervisor' })).data;
    assert.equal(d.status, 'draft'); assert.equal(d.decisionNote, 'Name the lifting supervisor');
    d = (await off.post(`/api/documents/${d.id}/submit`, { version: d.version })).data;
    d = (await corp.post(`/api/documents/${d.id}/decision`, { version: d.version, decision: 'approve', note: 'Approved for use' })).data;
    assert.equal(d.status, 'approved'); assert.equal(d.approvedBy.name, 'corpA');

    const viewer = await loggedIn(app.base, 'viewerA1');
    assert.equal((await viewer.get(`/api/documents/${d.id}`)).status, 200, 'viewers see approved documents');
    const approvedPdf = pdfText((await viewer.get(`/api/documents/${d.id}/export?format=pdf`)).data);
    assert.ok(approvedPdf.includes('APPROVED by corpA') && !approvedPdf.includes('DRAFT - NOT APPROVED'));

    assert.equal((await off.patch(`/api/documents/${d.id}`, { version: d.version, title: 'Edit approved' })).status, 409, 'approved documents are not edited in place');
    assert.equal((await off.post(`/api/documents/${d.id}/new-revision`, { version: d.version })).status, 400, 'reason required');
    d = (await off.post(`/api/documents/${d.id}/new-revision`, { version: d.version, note: 'Night works added' })).data;
    assert.equal(d.status, 'draft'); assert.equal(d.revisionLabel, 'Rev 01'); assert.equal(d.approvedBy, null);

    const hist = (await off.get(`/api/documents/${d.id}/revisions`)).data.items;
    const approvedSnap = hist.find((h: { event: string }) => h.event === 'approved');
    assert.ok(approvedSnap && approvedSnap.revisionLabel === 'Rev 00');
    assert.deepEqual(hist.map((h: { event: string }) => h.event).reverse(), ['generated', 'saved', 'saved', 'submitted', 'returned', 'submitted', 'approved', 'new_revision']);
    const snapDocx = await docxText((await off.get(`/api/documents/${d.id}/export?format=docx&revisionId=${approvedSnap.id}`)).data);
    assert.ok(snapDocx.includes('HISTORICAL SNAPSHOT') && snapDocx.includes('Rev 00') && snapDocx.includes('corpA'), 'approved revision exports with its approver');

    // Revision history is append-only at database level.
    await assert.rejects(app.db.query("UPDATE hse_document_revisions SET note = 'tampered' WHERE document_id = $1", [d.id]));
    await assert.rejects(app.db.query('DELETE FROM hse_document_revisions WHERE document_id = $1', [d.id]));
    // And an approval by the submitter is impossible even with direct SQL.
    await assert.rejects(app.db.query("UPDATE hse_documents SET status = 'approved', approved_by = submitted_by, approved_at = now(), submitted_by = created_by, submitted_at = now() WHERE id = $1", [d.id]), (e: { code?: string }) => e.code === '23514');

    const audit = await app.db.query<{ action: string }>("SELECT action FROM audit_log WHERE entity_type = 'hse_document' AND entity_id = $1 ORDER BY id", [d.id]);
    for (const a of ['document.generate', 'document.submit', 'document.return', 'document.approve', 'document.new_revision', 'document.export']) assert.ok(audit.rows.some((x) => x.action === a), a);
  });

  it('restores an earlier snapshot into the draft and supports withdrawal with a reason', async () => {
    const eng = await loggedIn(app.base, 'engA1');
    let d = (await generate(eng, 'toolbox_talk')).data;
    const original = d.content.sections[0].text;
    d = (await eng.patch(`/api/documents/${d.id}`, { version: d.version, content: { ...d.content, sections: [{ ...d.content.sections[0], text: 'Changed', origin: 'author' }, ...d.content.sections.slice(1)] } })).data;
    const gen = (await eng.get(`/api/documents/${d.id}/revisions`)).data.items.find((h: { event: string }) => h.event === 'generated');
    d = (await eng.post(`/api/documents/${d.id}/restore`, { version: d.version, revisionId: gen.id })).data;
    assert.equal(d.content.sections[0].text, original);
    assert.equal((await eng.post(`/api/documents/${d.id}/withdraw`, { version: d.version, note: '' })).status, 400);
    d = (await eng.post(`/api/documents/${d.id}/withdraw`, { version: d.version, note: 'Superseded by site-wide talk' })).data;
    assert.equal(d.status, 'withdrawn');
    const pdf = pdfText((await eng.get(`/api/documents/${d.id}/export?format=pdf`)).data);
    assert.ok(pdf.includes('WITHDRAWN'));
  });

  it('labels the generator honestly and only offers model suggestions when a real model is configured', async () => {
    const eng = await loggedIn(app.base, 'engA1');
    const meta = (await eng.get('/api/documents/meta')).data;
    assert.equal(meta.model.available, false);
    assert.match(meta.model.reason, /rules engine/);
    const refused = await generate(eng, 'risk_assessment', { useModel: true });
    assert.equal(refused.status, 409);
    assert.equal(refused.data.error.code, 'model_unavailable');

    const stub = stubModelBackend();
    const app2 = await startApp(app.db, { backend: stub });
    try {
      const e2 = await loggedIn(app2.base, 'engA1');
      assert.equal((await e2.get('/api/documents/meta')).data.model.available, true);
      const plain = (await generate(e2, 'risk_assessment')).data;
      assert.equal(plain.generator.modelCalled, false, 'not called unless asked');
      assert.equal(stub.calls, 0);
      const d = (await generate(e2, 'risk_assessment', { useModel: true })).data;
      assert.equal(stub.calls, 1);
      assert.equal(d.generator.modelCalled, true); assert.equal(d.generator.mode, 'template+model');
      assert.equal(d.generator.model, 'test-stub-model'); assert.equal(d.generator.modelSuggestions, 2);
      assert.equal(d.content.riskRows.filter((r: { origin: string }) => r.origin === 'model').length, 1);
      assert.ok(d.readiness.issues.some((x: { code: string }) => x.code === 'model_suggestions'));
      const dt = await docxText((await e2.get(`/api/documents/${d.id}/export?format=docx`)).data);
      assert.ok(dt.includes('MODEL SUGGESTION — NOT VERIFIED') && dt.includes('test-stub-model'));
    } finally { await app2.close(); }
  });
});
