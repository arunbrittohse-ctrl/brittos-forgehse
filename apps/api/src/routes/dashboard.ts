import { z } from 'zod';
import { onTimeClosureRate } from '@forgehse/shared';
import type { Deps } from '../app';
import type { Router } from '../http/core';
import { forbidden } from '../http/core';
import { requireAuth, hasAnywhere, scopeFilter } from '../auth/session';
import { orgSettings } from '../services/org';
import { compactParams } from '../db/db';

const querySchema = z.object({
  projectId: z.string().uuid().optional(),
  siteId: z.string().uuid().optional(),
  status: z.enum(['active', 'open', 'action_submitted', 'closed']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * Command-centre KPIs. Every number is computed from live records in the caller's scope —
 * nothing is hard-coded. Modules that are not built yet are reported as `available: false`
 * so the UI can say so instead of showing zeros.
 */
export function registerDashboardRoutes(r: Router, { db }: Deps) {
  r.get('/api/dashboard', async (ctx) => {
    const auth = requireAuth(ctx);
    if (!hasAnywhere(auth, 'dashboard.view') || !hasAnywhere(auth, 'observation.view')) throw forbidden();
    const q = ctx.parseQuery(querySchema);
    const settings = await orgSettings(db, auth.organizationId);
    const tz = settings.timezone;
    const today = (await db.query<{ d: string }>('SELECT (now() AT TIME ZONE $1)::date::text AS d', [tz])).rows[0]!.d;
    const to = q.to ?? today;
    const from = q.from ?? (await db.query<{ d: string }>("SELECT ($1::date - interval '89 days')::date::text AS d", [to])).rows[0]!.d;

    const params: unknown[] = [];
    const where = [scopeFilter(auth, 'observation.view', params, { org: 'o.organization_id', project: 'o.project_id', site: 'o.site_id' })];
    if (q.projectId) { params.push(q.projectId); where.push(`o.project_id = $${params.length}`); }
    if (q.siteId) { params.push(q.siteId); where.push(`o.site_id = ${params.length}`); }
    if (q.status) { params.push(q.status); where.push(q.status === 'active' ? `o.status IN ('open','assigned','action_submitted')` : `o.status = ${params.length}`); }
    params.push(from, to, tz, today);
    const [pFrom, pTo, pTz, pToday] = [params.length - 3, params.length - 2, params.length - 1, params.length].map((n) => `$${n}`);
    const W = where.join(' AND ');
    const inPeriod = `(o.observed_at AT TIME ZONE ${pTz})::date BETWEEN ${pFrom}::date AND ${pTo}::date`;
    const closedInPeriod = `o.status = 'closed' AND (o.closed_at AT TIME ZONE ${pTz})::date BETWEEN ${pFrom}::date AND ${pTo}::date`;

    const run = <T = Record<string, unknown>>(sql: string) => db.query<T>(...compactParams(sql, params));
    const [kpi, trend, hazards, bands, sites, overdueBy, highRisk, matrix] = await Promise.all([
      run<Record<string, number | null>>(`
        SELECT count(*) FILTER (WHERE ${inPeriod})::int AS "reported",
               count(*) FILTER (WHERE ${inPeriod} AND o.type = 'unsafe_act')::int AS "unsafeActs",
               count(*) FILTER (WHERE ${inPeriod} AND o.type = 'unsafe_condition')::int AS "unsafeConditions",
               count(*) FILTER (WHERE ${inPeriod} AND o.type = 'near_miss_observed')::int AS "nearMissObserved",
               count(*) FILTER (WHERE ${inPeriod} AND o.type = 'positive')::int AS "positive",
               count(*) FILTER (WHERE o.status IN ('open','assigned','action_submitted'))::int AS "openNow",
               count(*) FILTER (WHERE o.status = 'open')::int AS "unassignedNow",
               count(*) FILTER (WHERE o.status = 'action_submitted')::int AS "awaitingVerification",
               count(*) FILTER (WHERE o.status = 'assigned' AND o.due_date < ${pToday}::date)::int AS "overdueNow",
               count(*) FILTER (WHERE o.status IN ('open','assigned','action_submitted') AND o.risk_band IN ('high','critical'))::int AS "highCriticalOpen",
               count(*) FILTER (WHERE ${closedInPeriod})::int AS "closedInPeriod",
               round(avg(extract(epoch FROM (o.closed_at - o.observed_at)) / 86400) FILTER (WHERE ${closedInPeriod})::numeric, 1)::float AS "avgDaysToClose",
               count(*) FILTER (WHERE ${closedInPeriod} AND o.due_date IS NOT NULL)::int AS "closedWithDue",
               count(*) FILTER (WHERE ${closedInPeriod} AND o.due_date IS NOT NULL AND (o.closed_at AT TIME ZONE ${pTz})::date <= o.due_date)::int AS "closedOnTime"
          FROM observations o WHERE ${W} AND o.status <> 'cancelled'`),
      run(`
        WITH weeks AS (SELECT generate_series(date_trunc('week', ${pFrom}::date), date_trunc('week', ${pTo}::date), interval '1 week')::date AS wk)
        SELECT w.wk::text AS week,
               (SELECT count(*) FROM observations o WHERE ${W} AND o.status <> 'cancelled' AND date_trunc('week', (o.observed_at AT TIME ZONE ${pTz}))::date = w.wk)::int AS reported,
               (SELECT count(*) FROM observations o WHERE ${W} AND o.status = 'closed' AND date_trunc('week', (o.closed_at AT TIME ZONE ${pTz}))::date = w.wk)::int AS closed
          FROM weeks w ORDER BY w.wk`),
      run(`SELECT o.hazard_category AS category, count(*)::int AS count FROM observations o
                 WHERE ${W} AND ${inPeriod} AND o.status <> 'cancelled' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8`),
      run(`SELECT o.risk_band AS band, count(*)::int AS count FROM observations o
                 WHERE ${W} AND o.status IN ('open','assigned','action_submitted') GROUP BY 1`),
      run(`SELECT s.id, p.code AS "projectCode", s.code AS "siteCode", s.name AS "siteName",
                       count(*) FILTER (WHERE ${inPeriod})::int AS reported,
                       count(*) FILTER (WHERE o.status IN ('open','assigned','action_submitted'))::int AS open,
                       count(*) FILTER (WHERE o.status = 'assigned' AND o.due_date < ${pToday}::date)::int AS overdue
                  FROM observations o JOIN sites s ON s.id = o.site_id JOIN projects p ON p.id = o.project_id
                 WHERE ${W} AND o.status <> 'cancelled' GROUP BY s.id, p.code, s.code, s.name ORDER BY p.code, s.code`),
      run(`SELECT u.id, u.full_name AS name, count(*)::int AS overdue, min(o.due_date)::text AS "oldestDue"
                  FROM observations o JOIN users u ON u.id = o.assignee_id
                 WHERE ${W} AND o.status = 'assigned' AND o.due_date < ${pToday}::date GROUP BY u.id, u.full_name ORDER BY 3 DESC LIMIT 10`),
      run(`SELECT o.id, o.ref_no AS "refNo", o.hazard_category AS "hazardCategory", o.location, o.risk_band AS "riskBand", o.risk_score AS "riskScore",
                       o.status, o.due_date AS "dueDate", o.observed_at AS "observedAt"
                  FROM observations o WHERE ${W} AND o.status IN ('open','assigned','action_submitted') AND o.risk_band IN ('high','critical')
                 ORDER BY o.risk_score DESC, o.observed_at DESC LIMIT 6`),
      run(`SELECT o.likelihood, o.severity, count(*)::int AS count FROM observations o
                 WHERE ${W} AND o.status IN ('open','assigned','action_submitted') GROUP BY 1, 2`),
    ]);

    const k = kpi.rows[0]!;
    return {
      json: {
        period: { from, to, timezone: tz },
        kpis: { ...k, onTimeClosureRate: onTimeClosureRate(Number(k.closedOnTime), Number(k.closedWithDue)) },
        trend: trend.rows,
        byHazard: hazards.rows,
        openByRiskBand: bands.rows,
        bySite: sites.rows,
        overdueByAssignee: overdueBy.rows,
        highRiskOpen: highRisk.rows,
        openRiskMatrix: { size: settings.riskMatrix.size, bands: settings.riskMatrix.bands, cells: matrix.rows },
        modules: {
          observations: { available: true },
          incidents: { available: false }, permits: { available: true }, inspections: { available: false },
          riskAssessments: { available: false }, training: { available: false }, manHours: { available: false },
          environmental: { available: false },
        },
      },
    };
  });
}
