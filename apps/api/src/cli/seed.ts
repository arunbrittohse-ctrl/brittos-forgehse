/**
 * Seeding.
 *
 *   npm run seed                 → bootstrap ONE organisation + its first Super Administrator
 *                                   (SEED_ORG_NAME, SEED_ORG_SLUG, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_NAME).
 *   npm run seed -- --demo       → additionally load clearly-labelled DEMO projects, users and observations
 *                                   for local development and UI testing. Refused when NODE_ENV=production.
 */
import { randomUUID } from 'node:crypto';
import { createDb, type Queryable } from '../db/db';
import { hashPassword } from '../auth/passwords';
import { calculateRisk, passwordSchema } from '@forgehse/shared';
import { nextNumber } from '../services/org';

const env = process.env;
if (!env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(1); }
const demo = process.argv.includes('--demo');
if (demo && env.NODE_ENV === 'production') { console.error('Refusing to load demo data in production.'); process.exit(1); }

const db = createDb(env.DATABASE_URL, { max: 2 });

async function user(q: Queryable, email: string, name: string, title: string, password: string, mustChange: boolean): Promise<string> {
  const existing = (await q.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])).rows[0];
  if (existing) return existing.id;
  return (await q.query<{ id: string }>(
    'INSERT INTO users (email, full_name, job_title, password_hash, must_change_password) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [email, name, title, await hashPassword(password), mustChange])).rows[0]!.id;
}

try {
  const orgName = env.SEED_ORG_NAME ?? (demo ? 'Demo Contracting (DEMO DATA)' : undefined);
  const slug = env.SEED_ORG_SLUG ?? (demo ? 'demo' : undefined);
  const adminEmail = (env.SEED_ADMIN_EMAIL ?? (demo ? 'admin@demo.forgehse.local' : '')).toLowerCase();
  const adminPassword = env.SEED_ADMIN_PASSWORD ?? (demo ? 'DemoAdmin2026!' : '');
  if (!orgName || !slug || !adminEmail || !adminPassword) {
    throw new Error('Set SEED_ORG_NAME, SEED_ORG_SLUG, SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (or use --demo for local development).');
  }
  if (!demo) passwordSchema.parse(adminPassword);

  await db.transaction(async (tx) => {
    let org = (await tx.query<{ id: string }>('SELECT id FROM organizations WHERE slug = $1', [slug])).rows[0];
    if (!org) org = (await tx.query<{ id: string }>(`INSERT INTO organizations (name, slug, settings) VALUES ($1,$2,$3) RETURNING id`, [orgName, slug, { timezone: 'Asia/Dubai' }])).rows[0]!;
    const adminId = await user(tx, adminEmail, env.SEED_ADMIN_NAME ?? 'Platform Administrator', 'Administrator', adminPassword, !demo);
    await tx.query(`INSERT INTO role_assignments (user_id, organization_id, role) VALUES ($1,$2,'super_admin') ON CONFLICT DO NOTHING`, [adminId, org.id]);
    console.log(`Organisation "${orgName}" and administrator ${adminEmail} ready.`);

    if (!demo) return;
    const already = (await tx.query('SELECT 1 FROM projects WHERE organization_id = $1 LIMIT 1', [org.id])).rows[0];
    if (already) { console.log('Demo data already present — skipped.'); return; }

    const mkProject = async (code: string, name: string, client: string, location: string) =>
      (await tx.query<{ id: string }>('INSERT INTO projects (organization_id, code, name, client, location, start_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [org!.id, code, name, client, location, '2026-01-05'])).rows[0]!.id;
    const mkSite = async (projectId: string, code: string, name: string) =>
      (await tx.query<{ id: string }>('INSERT INTO sites (organization_id, project_id, code, name) VALUES ($1,$2,$3,$4) RETURNING id', [org!.id, projectId, code, name])).rows[0]!.id;

    const p1 = await mkProject('DEMO-TWR', 'DEMO Marina Residential Tower', 'DEMO Client A', 'Abu Dhabi');
    const p2 = await mkProject('DEMO-INF', 'DEMO Utility Corridor Package', 'DEMO Client B', 'Abu Dhabi');
    const s11 = await mkSite(p1, 'PODIUM', 'Podium & basement');
    const s12 = await mkSite(p1, 'TOWER', 'Tower superstructure');
    const s21 = await mkSite(p2, 'CH-1', 'Chainage 0+000 to 2+500');

    const pw = 'DemoUser2026!';
    const people = {
      corp: await user(tx, 'corp.hse@demo.forgehse.local', 'Corporate HSE Manager (Demo)', 'Corporate HSE Manager', pw, false),
      phm: await user(tx, 'project.hse@demo.forgehse.local', 'Project HSE Manager (Demo)', 'Project HSE Manager', pw, false),
      eng: await user(tx, 'hse.engineer@demo.forgehse.local', 'HSE Engineer (Demo)', 'HSE Engineer', pw, false),
      off: await user(tx, 'hse.officer@demo.forgehse.local', 'HSE Officer (Demo)', 'HSE Officer', pw, false),
      sup: await user(tx, 'supervisor@demo.forgehse.local', 'Site Supervisor (Demo)', 'Foreman', pw, false),
      view: await user(tx, 'client.rep@demo.forgehse.local', 'Client Representative (Demo)', 'Client HSE Representative', pw, false),
    };
    const grant = (u: string, role: string, projectId: string | null = null, siteId: string | null = null) =>
      tx.query('INSERT INTO role_assignments (user_id, organization_id, role, project_id, site_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [u, org!.id, role, projectId, siteId, adminId]);
    await grant(people.corp, 'corporate_hse_manager');
    await grant(people.phm, 'project_hse_manager', p1);
    await grant(people.eng, 'hse_engineer', p1);
    await grant(people.off, 'hse_officer', p1);
    await grant(people.sup, 'supervisor', p1, s12);
    await grant(people.view, 'viewer', p1);
    await grant(people.eng, 'hse_engineer', p2);

    // Demo observations spread over the last ~10 weeks, with a realistic mix of statuses.
    const samples: [string, string, string, string, string, number, number][] = [
      [p1, s12, 'unsafe_condition', 'Work at height', 'Level 14 east slab edge — missing edge protection over 6 m section', 4, 5],
      [p1, s12, 'unsafe_act', 'Work at height', 'Level 12 — worker on mobile scaffold platform with lanyard not attached', 3, 5],
      [p1, s11, 'unsafe_condition', 'Housekeeping & access', 'Basement B2 — access route obstructed by stored rebar', 3, 2],
      [p1, s11, 'unsafe_condition', 'Electrical', 'Basement B1 — temporary distribution board door left open, exposed terminals', 2, 5],
      [p1, s12, 'near_miss_observed', 'Lifting operations', 'Tower crane TC-2 — tag line not used, load swung near formwork crew', 3, 4],
      [p1, s11, 'unsafe_act', 'PPE', 'Podium — two workers cutting blockwork without eye protection', 4, 2],
      [p1, s12, 'positive', 'Heat stress', 'Tower — rest shelter with cool water and shade well maintained during midday', 1, 1],
      [p1, s11, 'unsafe_condition', 'Excavation', 'Podium north — excavation edge without barrier, 1.8 m depth', 3, 4],
      [p1, s12, 'unsafe_condition', 'Scaffolding', 'Level 9 — scaffold tag expired, inspection overdue', 3, 3],
      [p2, s21, 'unsafe_condition', 'Traffic & logistics', 'CH 1+200 — no banksman for reversing tipper at trench', 3, 4],
      [p2, s21, 'unsafe_act', 'Excavation', 'CH 0+800 — worker entered trench before shoring installed', 2, 5],
      [p1, s11, 'unsafe_condition', 'Hot work & fire', 'Basement B2 — welding without fire extinguisher within reach', 3, 4],
    ];
    const day = 86_400_000;
    const now = Date.now();
    for (let i = 0; i < samples.length; i++) {
      const [proj, site, type, cat, desc, l, s] = samples[i]!;
      const observedAt = new Date(now - (68 - i * 5.5) * day);
      const risk = calculateRisk(l, s);
      const code = proj === p1 ? 'DEMO-TWR' : 'DEMO-INF';
      const seq = await nextNumber(tx, org.id, `OBS:${proj}`, observedAt.getUTCFullYear());
      const ref = `OBS-${code}-${observedAt.getUTCFullYear()}-${String(seq).padStart(5, '0')}`;
      const [loc, ...rest] = desc.split(' — ');
      const id = randomUUID();
      const reporter = i % 3 === 0 ? people.sup : people.off;
      const plan = i % 4; // 0 closed, 1 assigned (some overdue), 2 action submitted, 3 open
      const status = type === 'positive' ? 'closed' : ['closed', 'assigned', 'action_submitted', 'open'][plan]!;
      const due = new Date(observedAt.getTime() + 7 * day).toISOString().slice(0, 10);
      await tx.query(
        `INSERT INTO observations (id, organization_id, project_id, site_id, ref_no, type, hazard_category, location, description, immediate_action,
           likelihood, severity, risk_score, risk_band, observed_at, reported_by, status, assignee_id, due_date, corrective_action, action_taken,
           action_submitted_by, action_submitted_at, closed_by, closed_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$15)`,
        [id, org.id, proj, site, ref, type, cat, loc, `[DEMO] ${rest.join(' — ') || desc}`, type === 'positive' ? 'Recognised crew at toolbox talk' : 'Area cordoned off, supervisor informed',
          l, s, risk.score, risk.band, observedAt.toISOString(), reporter, status,
          status === 'open' ? null : people.sup, status === 'open' ? null : due,
          status === 'open' ? '' : 'Rectify condition and brief crew; provide photo evidence',
          ['closed', 'action_submitted'].includes(status) && type !== 'positive' ? 'Condition rectified and crew briefed at toolbox talk' : '',
          ['closed', 'action_submitted'].includes(status) && type !== 'positive' ? people.sup : null,
          ['closed', 'action_submitted'].includes(status) && type !== 'positive' ? new Date(observedAt.getTime() + 3 * day).toISOString() : null,
          status === 'closed' ? people.eng : null, status === 'closed' ? new Date(observedAt.getTime() + 4 * day).toISOString() : null]);
      await tx.query(`INSERT INTO observation_events (organization_id, observation_id, actor_user_id, event, to_status, comment) VALUES ($1,$2,$3,'created','open','Demo data')`, [org.id, id, reporter]);
    }
    console.log('Loaded DEMO projects, users (password: DemoUser2026!) and observations.');
  });
} catch (e) {
  console.error('Seed failed:', (e as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
