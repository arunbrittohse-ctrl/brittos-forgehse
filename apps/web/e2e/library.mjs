// Browser walk-through of the document & evidence library (Playwright/Chromium).
// Prerequisites: API serving the built web app at BASE_URL with the DEMO seed loaded.
// Usage: BASE_URL=http://127.0.0.1:4000 node e2e/library.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4000';
const SHOTS = process.env.SHOT_DIR ?? new URL('./screens/', import.meta.url).pathname;
await mkdir(SHOTS, { recursive: true });
const results = []; const errors = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };
const watch = (p) => { p.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(m.text()); }); p.on('pageerror', (e) => errors.push(String(e))); };
async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill('DemoUser2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app/);
}
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

const browser = await chromium.launch();
const eng = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage(); watch(eng);
let fileUrl = '';

await step('engineer opens the library from the navigation', async () => {
  await login(eng, 'hse.engineer@demo.forgehse.local');
  await eng.getByRole('link', { name: 'Document & evidence library' }).click();
  await eng.getByRole('heading', { name: 'Document & evidence library' }).waitFor();
  await eng.getByText('No files match').waitFor();
});

await step('upload refuses a file whose content does not match its name', async () => {
  await eng.getByRole('link', { name: 'Upload' }).first().click();
  await eng.locator('#lf-file').setInputFiles({ name: 'plan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('MZ not really a pdf at all') });
  await eng.getByLabel('Title *').fill('Bad file');
  await eng.getByRole('button', { name: 'Upload as draft' }).click();
  await eng.getByRole('alert').filter({ hasText: 'not accepted' }).waitFor();
});

await step('upload a lifting plan with metadata (drag-and-drop input)', async () => {
  await eng.getByRole('button', { name: 'Choose another file' }).click();
  await eng.locator('#lf-file').setInputFiles({ name: 'TC1-lifting-plan.pdf', mimeType: 'application/pdf', buffer: PDF });
  await eng.getByLabel('Title *').fill('Lifting plan — tower crane TC1');
  await eng.getByLabel('Project *').selectOption({ label: 'DEMO-TWR — DEMO Marina Residential Tower' });
  await eng.getByLabel('Document number').fill('DEMO-LP-001');
  await eng.getByLabel('Document type *').selectOption('plan');
  await eng.getByLabel('Category').fill('Lifting');
  await eng.getByLabel('Expiry date').fill(new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10));
  await eng.screenshot({ path: SHOTS + 'lib-01-upload.png', fullPage: true });
  await eng.getByRole('button', { name: 'Upload as draft' }).click();
  await eng.waitForURL(/\/app\/library\/[0-9a-f-]{36}$/);
  fileUrl = eng.url();
  await eng.getByRole('heading', { name: 'Lifting plan — tower crane TC1' }).waitFor();
  await eng.getByText('Draft').first().waitFor();
  await eng.getByText(/expires on/).waitFor();
});

await step('engineer submits; cannot approve their own upload', async () => {
  await eng.getByRole('button', { name: 'Submit for review' }).click();
  await eng.getByText('Under review').first().waitFor();
  if (await eng.getByRole('button', { name: /^Approve/ }).count()) throw new Error('Approve shown to the uploader');
});

const mgr = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage(); watch(mgr);
await step('project HSE manager sees it awaiting review and approves it', async () => {
  await login(mgr, 'project.hse@demo.forgehse.local');
  await mgr.goto(BASE + '/app/library');
  await mgr.getByRole('button', { name: /Under review/ }).click();
  await mgr.getByRole('link', { name: /LIB-/ }).first().click();
  await mgr.getByRole('button', { name: 'Approve v1' }).click();
  await mgr.getByRole('dialog').getByLabel('Note').fill('Checked against the lift study');
  await mgr.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await mgr.getByText('Approved').first().waitFor();
  await mgr.locator('iframe.lib-pdf').waitFor();
  await mgr.waitForTimeout(600);
  await mgr.screenshot({ path: SHOTS + 'lib-02-approved.png', fullPage: true });
});

await step('a new version keeps the approved one in force until it is approved', async () => {
  await eng.goto(fileUrl);
  await eng.getByRole('button', { name: 'New version' }).click();
  await eng.locator('#lf-vfile').setInputFiles({ name: 'TC1-lifting-plan-r2.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([PDF, Buffer.from('% r2\n')]) });
  await eng.getByLabel('What changed *').fill('Crane moved to grid C4');
  await eng.getByRole('dialog').getByRole('button', { name: 'Upload' }).click();
  await eng.getByRole('row', { name: /version 2.*Draft/ }).waitFor();
  await eng.getByRole('row', { name: /version 1.*Approved/ }).waitFor();
});

await step('client representative (reader) sees only the approved version', async () => {
  const c = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); watch(c);
  await login(c, 'client.rep@demo.forgehse.local');
  await c.goto(fileUrl);
  await c.getByRole('heading', { name: 'Lifting plan — tower crane TC1' }).waitFor();
  const rows = await c.getByRole('row').count();
  if (rows !== 2) throw new Error(`expected header + 1 version row, got ${rows}`);
});

await step('attach evidence from an observation page', async () => {
  await eng.goto(BASE + '/app/observations');
  await eng.locator('table.data tbody tr a').first().click();
  await eng.getByRole('heading', { name: 'Files & evidence' }).waitFor();
  await eng.getByRole('link', { name: 'Attach file' }).click();
  await eng.locator('#lf-file').setInputFiles({ name: 'edge-protection.png', mimeType: 'image/png', buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]) });
  await eng.getByRole('button', { name: 'Upload as draft' }).click();
  await eng.waitForURL(/\/app\/observations\//);
  await eng.getByRole('link', { name: /edge protection/i }).waitFor();
});

await step('phone layout has no horizontal overflow', async () => {
  const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage(); watch(m);
  await login(m, 'hse.engineer@demo.forgehse.local');
  for (const path of ['/app/library', fileUrl.replace(BASE, ''), '/app/library/new']) {
    await m.goto(BASE + path); await m.waitForTimeout(500);
    const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) throw new Error(`${path} overflows by ${over}px`);
  }
  await m.getByRole('button', { name: 'Take a photo' }).waitFor();
  await m.screenshot({ path: SHOTS + 'lib-03-mobile-upload.png', fullPage: true });
});

await browser.close();
for (const r of results) console.log(r.join(' — '));
if (errors.length) console.log('Console errors:', errors);
console.log(`${results.filter((r) => r[0] === 'PASS').length}/${results.length} passed`);
process.exit(results.every((r) => r[0] === 'PASS') && !errors.length ? 0 : 1);
