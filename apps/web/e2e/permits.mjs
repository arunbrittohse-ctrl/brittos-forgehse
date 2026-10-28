// Browser walk-through of Permit to Work (Playwright/Chromium), DEMO seed.
// Usage: BASE_URL=http://127.0.0.1:4000 node e2e/permits.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4000';
const SHOTS = process.env.SHOT_DIR ?? new URL('./screens/', import.meta.url).pathname;
await mkdir(SHOTS, { recursive: true });
const results = []; const errors = [];
let current = null;
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); if (current) await current.screenshot({ path: SHOTS + `fail-${results.length}.png`, fullPage: true }).catch(() => {}); } };
const watch = (p) => { p.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(m.text()); }); p.on('pageerror', (e) => errors.push(String(e))); };
async function page(email, viewport = { width: 1440, height: 960 }) {
  const p = await (await browser.newContext({ viewport })).newPage(); watch(p);
  await p.goto(`${BASE}/login`);
  await p.getByLabel('Work email').fill(email); await p.getByLabel('Password').fill('DemoUser2026!');
  await p.getByRole('button', { name: 'Sign in' }).click(); await p.waitForURL(/\/app/);
  return p;
}
const local = (h) => { const d = new Date(Date.now() + h * 3_600_000); const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
const doAction = async (p, button, note) => {
  await p.getByRole('button', { name: button, exact: true }).first().click();
  const dlg = p.getByRole('dialog');
  if (note) await dlg.getByLabel(/note/i).fill(note);
  await dlg.getByRole('button', { name: button, exact: true }).click();
  await dlg.waitFor({ state: 'detached' });
};

const browser = await chromium.launch();
let url = ''; let ref = '';
const sup = await page('supervisor@demo.forgehse.local');

await step('supervisor applies for a confined space permit', async () => {
  await sup.getByRole('link', { name: 'Permits to Work' }).click();
  await sup.getByRole('heading', { name: 'Permits to Work' }).waitFor();
  await sup.getByRole('link', { name: 'Apply for a permit' }).first().click();
  await sup.locator('label.ptw-type', { hasText: 'Confined space entry' }).click();
  await sup.getByLabel('Work to be done *').fill('Inspect and clean the lift pit sump');
  await sup.getByLabel('Exact location *').fill('Lift pit, core 2');
  await sup.getByLabel('Valid from *').fill(local(-1));
  await sup.getByLabel('Valid to *').fill(local(6));
  await sup.getByLabel('Attendant (name) *').fill('R. Kumar');
  await sup.getByLabel('Authorised entrants *').fill('S. Ali, M. Das');
  await sup.getByLabel('Rescue plan (reference or summary) *').fill('RP-04 tripod, winch and harness');
  await sup.screenshot({ path: SHOTS + 'ptw-01-apply.png', fullPage: true });
  await sup.getByRole('button', { name: 'Save draft' }).click();
  await sup.waitForURL(/\/app\/permits\/[0-9a-f-]{36}$/);
  url = sup.url();
  ref = (await sup.getByRole('heading', { level: 1 }).innerText()).split(' ')[0];
  await sup.getByText('Draft', { exact: true }).first().waitFor();
  await sup.getByRole('button', { name: 'Submit for review' }).click();
  await sup.getByText('Submitted', { exact: true }).first().waitFor();
});

const eng = await page('hse.engineer@demo.forgehse.local');
await step('HSE engineer reviews, records a gas test, confirms checks and authorises', async () => {
  current = eng;
  await eng.goto(BASE + '/app/permits?view=awaiting');
  await eng.getByLabel('Project').selectOption({ label: 'DEMO-TWR — DEMO Marina Residential Tower' });
  await eng.getByRole('link', { name: ref, exact: true }).first().click();
  await doAction(eng, 'Start safety review');
  await eng.getByText('Before authorising:').waitFor();
  const authorise = eng.getByRole('button', { name: 'Authorise', exact: true });
  if (await authorise.isEnabled()) throw new Error('Authorise enabled before checks and gas test');
  for (const box of await eng.locator('.ptw-checks input[type=checkbox]').all()) await box.check();
  await eng.getByRole('button', { name: 'Save checks' }).click();
  await eng.getByText(/Confirmed by HSE Engineer/).first().waitFor();
  await eng.getByRole('button', { name: 'Record gas test' }).click();
  const d = eng.getByRole('dialog');
  await d.getByLabel('Instrument and calibration *').fill('MG-7 multi-gas, cal. 01 Oct');
  await d.getByLabel('Oxygen (%)').fill('20.9'); await d.getByLabel('Flammable (% LEL)').fill('0');
  await d.getByText('Yes, within the site limits').click();
  await d.getByRole('button', { name: 'Record' }).click(); await d.waitFor({ state: 'detached' });
  await eng.getByText('Within site limits', { exact: true }).first().waitFor();
  await doAction(eng, 'Authorise', 'Pit inspected, ventilation running');
  await eng.getByText('Authorised', { exact: true }).first().waitFor();
  await eng.screenshot({ path: SHOTS + 'ptw-02-authorised.png', fullPage: true });
});

await step('supervisor starts work, suspends it and cannot revalidate their own permit', async () => {
  await sup.goto(url);
  await doAction(sup, 'Accept and start work');
  await sup.getByText('Work authorised now').waitFor();
  await doAction(sup, 'Suspend (stop work)', 'Gas alarm sounded');
  await sup.getByText('Work suspended.').waitFor();
  if (await sup.getByRole('button', { name: 'Revalidate', exact: true }).count()) throw new Error('applicant offered revalidation');
});

await step('engineer retests, revalidates; supervisor hands back; manager closes', async () => {
  current = eng;
  await eng.goto(url);
  await eng.getByText('Before revalidating:').waitFor();
  await eng.getByRole('button', { name: 'Record gas test' }).click();
  const d = eng.getByRole('dialog');
  await d.getByLabel('Instrument and calibration *').fill('MG-7 multi-gas, cal. 01 Oct'); await d.getByLabel('Oxygen (%)').fill('20.8');
  await d.getByText('Yes, within the site limits').click(); await d.getByRole('button', { name: 'Record' }).click(); await d.waitFor({ state: 'detached' });
  await doAction(eng, 'Revalidate', 'Leak traced to a pump seal, isolated; retested');
  current = sup;
  await sup.goto(url);
  await doAction(sup, 'Hand back (work complete)', 'Sump cleaned, tools removed, cover replaced');
  const mgr = await page('project.hse@demo.forgehse.local');
  current = mgr;
  await mgr.goto(url);
  await doAction(mgr, 'Close permit', 'Close-out inspection: area safe, barriers removed');
  await mgr.getByText('Closed', { exact: true }).first().waitFor();
  await mgr.screenshot({ path: SHOTS + 'ptw-03-closed.png', fullPage: true });
});

await step('phone layout: register and permit fit the screen', async () => {
  const m = await page('supervisor@demo.forgehse.local', { width: 390, height: 844 });
  for (const path of ['/app/permits?view=all', url.replace(BASE, ''), '/app/permits/new']) {
    await m.goto(BASE + path); await m.waitForTimeout(500);
    const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) throw new Error(`${path} overflows by ${over}px`);
  }
  await m.goto(url); await m.waitForTimeout(400);
  await m.screenshot({ path: SHOTS + 'ptw-04-mobile.png', fullPage: true });
});

await browser.close();
for (const r of results) console.log(r.join(' — '));
if (errors.length) console.log('Console errors:', errors);
console.log(`${results.filter((r) => r[0] === 'PASS').length}/${results.length} passed`);
process.exit(results.every((r) => r[0] === 'PASS') && !errors.length ? 0 : 1);
