import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { HSE_DOMAINS } from '@forgehse/shared';
import type { Db } from '../src/db/db';
import { freshDb, seedWorld, type World } from './helpers';

/** Tables whose `status` CHECK must list exactly the states of a lifecycle. */
const STATUS_TABLES: Record<string, [string, string]> = {
  controlled_documents: ['document_control', 'document'], risk_assessments: ['risk', 'riskAssessment'], permits: ['permits', 'permit'],
  inspections: ['inspections', 'inspection'], incidents: ['incidents', 'incident'], corrective_actions: ['actions', 'action'],
  hse_gaps: ['actions', 'gap'], contractors: ['contractors', 'contractor'], environmental_monitoring: ['environment', 'monitoring'],
  emergency_drills: ['emergency', 'drill'],
};

describe('HSE domain tables (migration 0006)', () => {
  let db: Db; let w: World;
  before(async () => { db = await freshDb(); w = await seedWorld(db); });
  after(() => db.end());

  it('creates every table named in the domain registry', async () => {
    const have = new Set((await db.query<{ t: string }>("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public'")).rows.map((r) => r.t));
    for (const d of HSE_DOMAINS) for (const t of d.tables) assert.ok(have.has(t), `${d.key}: missing table ${t}`);
  });

  it('keeps database status values identical to the shared lifecycles', async () => {
    for (const [table, [key, lc]] of Object.entries(STATUS_TABLES)) {
      const def = (await db.query<{ d: string }>(
        `SELECT pg_get_constraintdef(c.oid) AS d FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relname = $1 AND c.contype = 'c' AND pg_get_constraintdef(c.oid) ~ '^CHECK \\(\\(status = ANY'`, [table])).rows[0]?.d ?? '';
      const dbStates = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
      const states = [...HSE_DOMAINS.find((d) => d.key === key)!.lifecycles![lc]!.states].sort();
      assert.deepEqual(dbStates, states, table);
    }
  });

  it('enforces independent verification and owner/due date at database level', async () => {
    const u = w.users;
    const ins = (status: string, extra: Record<string, unknown> = {}) => {
      const cols = { organization_id: w.orgA, project_id: w.projA1, ref_no: `CA-${Math.random()}`, source_type: 'inspection', title: 'Fix guardrail', description: 'Missing guardrail', priority: 'high', status, raised_by: u.engA1, ...extra };
      const k = Object.keys(cols);
      return db.query(`INSERT INTO corrective_actions (${k.join(',')}) VALUES (${k.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(cols));
    };
    await assert.rejects(ins('assigned'), (e: { code?: string }) => e.code === '23514', 'assigned needs owner and due date');
    await assert.rejects(ins('verified_closed', { submitted_by: u.supA1x, verified_by: u.supA1x, verified_at: new Date() }), (e: { code?: string }) => e.code === '23514', 'self-verification refused');
    await ins('verified_closed', { owner_id: u.supA1x, due_date: '2026-11-01', submitted_by: u.supA1x, verified_by: u.engA1, verified_at: new Date() });
  });

  it('refuses an active permit authorised by its own applicant, and cross-tenant project/site pairs', async () => {
    const base = { organization_id: w.orgA, project_id: w.projA1, site_id: w.siteA1x, permit_type: 'hot_work', work_description: 'Welding', location: 'L2', valid_from: '2026-10-27T08:00:00+04:00', valid_to: '2026-10-27T17:00:00+04:00', applicant_id: w.users.supA1x };
    const put = (extra: Record<string, unknown>) => {
      const cols = { ...base, ref_no: `PTW-${Math.random()}`, ...extra };
      const k = Object.keys(cols);
      return db.query(`INSERT INTO permits (${k.join(',')}) VALUES (${k.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(cols));
    };
    await assert.rejects(put({ status: 'active' }), (e: { code?: string }) => e.code === '23514');
    await assert.rejects(put({ status: 'active', authorised_by: w.users.supA1x }), (e: { code?: string }) => e.code === '23514');
    await put({ status: 'active', authorised_by: w.users.engA1 });
    await assert.rejects(put({ site_id: w.siteB1 }), (e: { code?: string }) => e.code === '23503', 'site from another organisation');
  });

  it('computes environmental exceedances only when a configured limit exists', async () => {
    const add = (value: number, limit: number | null) => db.query<{ exceedance: boolean }>(
      `INSERT INTO environmental_monitoring (organization_id, project_id, ref_no, kind, parameter, value, unit, limit_value, measured_at, recorded_by)
       VALUES ($1,$2,$3,'dust','PM10',$4,'µg/m³',$5,now(),$6) RETURNING exceedance`, [w.orgA, w.projA1, `ENV-${Math.random()}`, value, limit, w.users.engA1]);
    assert.equal((await add(180, 150)).rows[0]!.exceedance, true);
    assert.equal((await add(120, 150)).rows[0]!.exceedance, false);
    assert.equal((await add(900, null)).rows[0]!.exceedance, false, 'no limit configured → no exceedance claimed');
  });
});
