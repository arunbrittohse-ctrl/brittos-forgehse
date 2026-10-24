// End-to-end smoke test in a real browser (Playwright/Chromium).
// Prerequisites: API serving the built web app at BASE_URL with the DEMO seed loaded
// (npm run seed -- --demo). Usage: BASE_URL=http://127.0.0.1:4000 node e2e/run.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4000';
const SHOTS = process.env.SHOT_DIR ?? new URL('./screens/', import.meta.url).pathname;
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch();
const results = [];
const consoleErrors = [];
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); }
}
function watch(page) {
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
}
async function login(page, email, password = 'DemoUser2026!') {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app/);
}

const desktop = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await desktop.newPage();
watch(page);

await step('public site renders hero and sign-in link', async () => {
  await page.goto(BASE + '/');
  await page.getByRole('heading', { name: 'Every hazard, seen and closed out.' }).waitFor();
  await page.screenshot({ path: SHOTS + '01-public.png', fullPage: false });
});

await step('protected route redirects to sign-in', async () => {
  await page.goto(BASE + '/app/observations');
  await page.waitForURL(/\/login\?next=/);
});

await step('wrong password shows a clear error', async () => {
  await page.getByLabel('Work email').fill('hse.engineer@demo.forgehse.local');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('alert').filter({ hasText: 'incorrect' }).waitFor();
  await page.screenshot({ path: SHOTS + '02-login-error.png' });
});

await step('HSE engineer signs in and sees the live dashboard', async () => {
  await login(page, 'hse.engineer@demo.forgehse.local');
  await page.getByRole('heading', { name: 'Command centre' }).waitFor();
  await page.getByRole('heading', { name: 'Open risk' }).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + '03-dashboard.png', fullPage: true });
});

await step('observation list with filters', async () => {
  await page.getByRole('link', { name: 'Observations' }).click();
  await page.getByRole('heading', { name: 'Observations' }).waitFor();
  await page.locator('table.data tbody tr').first().waitFor();
  const rows = await page.locator('table.data tbody tr').count();
  assert.ok(rows > 0, 'expected rows');
  await page.getByRole('button', { name: 'Overdue' }).click();
  await page.waitForURL(/status=overdue/);
  await page.screenshot({ path: SHOTS + '04-list.png', fullPage: false });
});

let newUrl = '';
await step('report a new observation with a photo', async () => {
  await page.getByRole('link', { name: 'Report observation' }).first().click();
  await page.getByRole('heading', { name: 'Report an observation' }).waitFor();
  await page.getByLabel('Project', { exact: true }).selectOption({ label: 'DEMO Marina Residential Tower (DEMO-TWR)' });
  await page.getByLabel('Site', { exact: true }).selectOption({ label: 'Tower superstructure' });
  await page.getByRole('button', { name: 'Unsafe condition' }).click();
  await page.getByLabel('Hazard category').selectOption('Work at height');
  await page.getByLabel('Exact location').fill('Level 16, grid C-4');
  await page.getByLabel('Activity under way').fill('Rebar fixing');
  await page.getByLabel('What did you see?').fill('[E2E] Floor opening 1.2 m wide uncovered next to rebar fixing crew.');
  await page.getByLabel('Likelihood').selectOption('4');
  await page.getByLabel('Severity').selectOption('5');
  await page.locator('.risk').filter({ hasText: 'Critical' }).waitFor();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('#files', { name: 'opening.png', mimeType: 'image/png', buffer: png });
  await page.screenshot({ path: SHOTS + '05-report-form.png', fullPage: true });
  await page.getByRole('button', { name: 'Submit observation' }).click();
  await page.waitForURL(/\/app\/observations\/[0-9a-f-]{36}$/);
  newUrl = page.url();
  await page.getByText('Floor opening 1.2 m wide').waitFor();
  await page.locator('.thumbs img').waitFor();
});

await step('assign the corrective action', async () => {
  await page.getByRole('button', { name: 'Assign corrective action' }).click();
  await page.getByLabel('Owner', { exact: true }).selectOption({ label: 'Site Supervisor (Demo), Foreman' });
  await page.getByLabel('Required corrective action').fill('Cover opening with secured, marked plywood rated for foot traffic');
  await page.getByRole('dialog').getByRole('button', { name: 'Assign corrective action' }).click();
  await page.getByText('Corrective action assigned').waitFor();
  await page.getByText('Site Supervisor (Demo)').first().waitFor();
  await page.screenshot({ path: SHOTS + '06-detail-assigned.png', fullPage: true });
});

await step('supervisor (site-scoped) submits the action', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage(); watch(p);
  await login(p, 'supervisor@demo.forgehse.local');
  await p.goto(newUrl);
  await p.getByRole('button', { name: 'Submit action taken' }).click();
  await p.getByLabel('What was done?').fill('Plywood cover fixed with screws and painted "HOLE" marking; crew briefed.');
  await p.getByRole('dialog').getByRole('button', { name: 'Submit action taken' }).click();
  await p.getByText('Action submitted for verification').waitFor();
  assert.equal(await p.getByRole('button', { name: 'Verify and close' }).count(), 0, 'supervisor must not see verify');
  await ctx.close();
});

await step('engineer verifies and closes', async () => {
  await page.reload();
  await page.getByRole('button', { name: 'Verify and close' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Verify and close' }).click();
  await page.getByText('Verified and closed').first().waitFor();
  await page.locator('.badge.s-closed').first().waitFor();
});

await step('client viewer cannot report or act', async () => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage(); watch(p);
  await login(p, 'client.rep@demo.forgehse.local');
  assert.equal(await p.getByRole('link', { name: 'Report observation' }).count(), 0);
  await p.goto(newUrl);
  await p.getByText('Floor opening').waitFor();
  assert.equal(await p.locator('button', { hasText: 'Reopen' }).count(), 0);
  await ctx.close();
});

await step('admin pages: projects, users, audit trail, AI usage', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const p = await ctx.newPage(); watch(p);
  await login(p, 'admin@demo.forgehse.local', 'DemoAdmin2026!');
  await p.goto(BASE + '/app/admin/users');
  await p.getByRole('heading', { name: 'Users & roles' }).waitFor();
  await p.locator('table.data tbody tr').first().waitFor();
  await p.screenshot({ path: SHOTS + '07-users.png', fullPage: true });
  await p.goto(BASE + '/app/audit');
  await p.getByText('observation.verify_close').first().waitFor();
  await p.screenshot({ path: SHOTS + '08-audit.png' });
  await p.goto(BASE + '/app/ai-usage');
  await p.getByRole('heading', { name: 'AI usage' }).waitFor();
  await p.goto(BASE + '/app/admin/projects');
  await p.getByRole('heading', { name: 'Projects & sites' }).waitFor();
  await ctx.close();
});

await step('mobile viewport: navigation drawer and list remain usable', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); watch(p);
  await login(p, 'hse.engineer@demo.forgehse.local');
  await p.getByRole('heading', { name: 'Command centre' }).waitFor();
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false, 'page scrolls horizontally on mobile');
  await p.screenshot({ path: SHOTS + '09-mobile-dashboard.png', fullPage: false });
  await p.getByRole('button', { name: 'Open navigation' }).click();
  await p.getByRole('link', { name: 'Observations' }).click();
  await p.getByRole('heading', { name: 'Observations' }).waitFor();
  await ctx.close();
});

await step('dark theme toggles', async () => {
  await page.goto(BASE + '/app');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.getByRole('heading', { name: 'Open risk' }).waitFor();
  await page.screenshot({ path: SHOTS + '10-dashboard-dark.png' });
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
});

await step('command palette opens with Ctrl+K and offers an AI request', async () => {
  await page.goto(BASE + '/app');
  await page.getByRole('heading', { name: 'Command centre' }).waitFor();
  await page.keyboard.press('Control+k');
  const box = page.getByRole('combobox', { name: 'Command' });
  await box.waitFor();
  await box.fill('ladder inspection');
  await page.getByRole('option', { name: /Create a checklist/ }).waitFor();
  await page.keyboard.press('Escape');
});

// AI Studio checks need an AI backend. Run with E2E_AI=1 against a server whose ANTHROPIC_BASE_URL
// points at a real key or at scripts/dev/mock-anthropic.mjs (test-only, canned output).
if (process.env.E2E_AI) {
  await step('AI Studio streams a grounded answer with citations', async () => {
    await page.goto(BASE + '/app/studio');
    await page.getByLabel('Message').fill('Which high or critical items are still open?');
    await page.keyboard.press('Enter');
    await page.locator('.msg.assistant .msg-meta').first().waitFor({ timeout: 30000 });
    assert.ok(await page.locator('.msg.assistant a.cite').count() > 0, 'expected citation chips linking to records');
    await page.screenshot({ path: SHOTS + '11-studio-answer.png' });
  });
  await step('AI Studio generates a checklist draft, exports it and an engineer marks it reviewed', async () => {
    await page.getByRole('button', { name: 'Checklist', exact: true }).click();
    await page.getByLabel('Message').fill('Pre-use inspection for a mobile elevating work platform');
    await page.keyboard.press('Enter');
    await page.locator('.canvas .paper').waitFor({ timeout: 30000 });
    assert.ok(await page.locator('.canvas').getByText('Draft — review required').count() > 0);
    const href = await page.locator('.canvas a', { hasText: 'Word' }).getAttribute('href');
    const res = await page.request.get(BASE + href);
    assert.equal(res.status(), 200);
    assert.match(res.headers()['content-disposition'] ?? '', /DRAFT\.docx/);
    await page.screenshot({ path: SHOTS + '12-studio-checklist.png' });
    await page.locator('.canvas').getByRole('link', { name: 'Open' }).click();
    await page.getByRole('button', { name: 'Mark reviewed' }).click();
    await page.getByRole('button', { name: 'Confirm review' }).click();
    await page.getByText('Reviewed by').first().waitFor();
  });
  await step('AI Studio designs a poster rendered as an image (no inline SVG)', async () => {
    await page.goto(BASE + '/app/studio');
    await page.getByRole('button', { name: 'Poster', exact: true }).click();
    await page.getByLabel('Message').fill('Harness use when working at height');
    await page.keyboard.press('Enter');
    const img = page.locator('.canvas .art-frame img');
    await img.waitFor({ timeout: 30000 });
    assert.match(await img.getAttribute('src') ?? '', /^data:image\/svg\+xml/);
    await page.screenshot({ path: SHOTS + '13-studio-poster.png' });
  });
}

await step('no JavaScript errors in the console', async () => {
  assert.deepEqual(consoleErrors, [], consoleErrors.join(' | '));
});

await browser.close();
for (const r of results) console.log(r.join('  '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} e2e checks passed. Screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);
