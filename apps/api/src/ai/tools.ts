/**
 * Tools the AI Studio chat can call. Every tool runs server-side with the caller's own
 * permissions (scopeFilter), so the model can only ever see records the user could open themselves.
 */
import { z } from 'zod';
import { DOCUMENT_TYPES } from '@forgehse/shared';
import type { Db } from '../db/db';
import { scopeFilter, type AuthContext } from '../auth/session';
import type { ToolDef } from './claude';

export const CHAT_TOOLS: ToolDef[] = [
  {
    name: 'search_observations',
    description: 'Search the HSE observation records this user is allowed to see. Use for questions about specific hazards, locations, activities, open or overdue items, or to find examples. Returns up to 15 records; cite them by refNo.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords matched against description, location, activity and hazard category. Empty string for no keyword filter.' },
        status: { type: 'string', enum: ['any', 'open', 'overdue', 'closed'], description: 'open = not yet closed; overdue = assigned and past due date' },
        riskBand: { type: 'string', enum: ['any', 'low', 'medium', 'high', 'critical', 'high_or_critical'] },
        days: { type: 'integer', minimum: 1, maximum: 730, description: 'Look-back window in days by observation date (default 90)' },
        limit: { type: 'integer', minimum: 1, maximum: 15 },
      },
    },
  },
  {
    name: 'hse_statistics',
    description: 'Aggregate statistics for observations in the user’s accessible scope over a period: totals by type, status, risk band and hazard category, overdue actions and on-time closure.',
    input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 730, description: 'Period in days (default 30)' } } },
  },
  {
    name: 'create_studio_draft',
    description: 'Start generating a checklist, HSE document, safety poster or flowchart in FORGEHSE Studio for the user to review. Use whenever the user asks you to create, prepare or make one of these.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['checklist', 'document', 'poster', 'flowchart'] },
        documentType: { type: 'string', enum: [...DOCUMENT_TYPES], description: 'Only for kind=document' },
        brief: { type: 'string', description: 'A complete brief keeping every detail the user gave: activity, location, audience, equipment, constraints, language level.' },
      },
      required: ['kind', 'brief'],
    },
  },
  {
    name: 'prepare_observation',
    description: 'Open a pre-filled observation report form for the user to review and submit, from their description of something seen on site.',
    input_schema: { type: 'object', properties: { notes: { type: 'string', description: 'The user’s description, cleaned up but without adding facts' } }, required: ['notes'] },
  },
];

const searchInput = z.object({
  query: z.string().max(200).optional().default(''),
  status: z.enum(['any', 'open', 'overdue', 'closed']).optional().default('any'),
  riskBand: z.enum(['any', 'low', 'medium', 'high', 'critical', 'high_or_critical']).optional().default('any'),
  days: z.number().int().min(1).max(730).optional().default(90),
  limit: z.number().int().min(1).max(15).optional().default(10),
}).passthrough();

export interface Citation { id: string; refNo: string; title: string }

export async function searchObservations(db: Db, auth: AuthContext, raw: unknown, projectId: string | null) {
  const f = searchInput.parse(raw ?? {});
  const params: unknown[] = [];
  const where = [scopeFilter(auth, 'observation.view', params, { org: 'o.organization_id', project: 'o.project_id', site: 'o.site_id' }), "o.status <> 'cancelled'"];
  if (projectId) { params.push(projectId); where.push(`o.project_id = $${params.length}`); }
  params.push(f.days); where.push(`o.observed_at >= now() - make_interval(days => $${params.length})`);
  if (f.status === 'open') where.push("o.status IN ('open','assigned','action_submitted')");
  if (f.status === 'closed') where.push("o.status = 'closed'");
  if (f.status === 'overdue') where.push("o.status = 'assigned' AND o.due_date < current_date");
  if (f.riskBand === 'high_or_critical') where.push("o.risk_band IN ('high','critical')");
  else if (f.riskBand !== 'any') { params.push(f.riskBand); where.push(`o.risk_band = $${params.length}`); }
  const terms = f.query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2).slice(0, 6);
  if (terms.length) {
    const ors = terms.map((t) => {
      params.push(`%${t.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
      const p = `$${params.length}`;
      return `(o.description ILIKE ${p} OR o.location ILIKE ${p} OR o.activity ILIKE ${p} OR o.hazard_category ILIKE ${p})`;
    });
    where.push(`(${ors.join(' OR ')})`);
  }
  params.push(f.limit);
  const rows = (await db.query<{ id: string; refNo: string; type: string; hazardCategory: string; location: string; activity: string; description: string; riskBand: string; riskScore: number; status: string; dueDate: string | null; observedAt: string; project: string; site: string }>(
    `SELECT o.id, o.ref_no AS "refNo", o.type, o.hazard_category AS "hazardCategory", o.location, o.activity, left(o.description, 400) AS description,
            o.risk_band AS "riskBand", o.risk_score AS "riskScore", o.status, o.due_date::text AS "dueDate", o.observed_at AS "observedAt",
            p.code AS project, s.name AS site
       FROM observations o JOIN projects p ON p.id = o.project_id JOIN sites s ON s.id = o.site_id
      WHERE ${where.join(' AND ')}
      ORDER BY o.risk_score DESC, o.observed_at DESC LIMIT $${params.length}`, params)).rows;
  const citations: Citation[] = rows.map((r) => ({ id: r.id, refNo: r.refNo, title: `${r.hazardCategory} · ${r.location || r.site}` }));
  return { result: { matched: rows.length, filters: f, records: rows.map(({ id: _id, ...r }) => r) }, citations };
}

export async function hseStatistics(db: Db, auth: AuthContext, raw: unknown, projectId: string | null) {
  const { days } = z.object({ days: z.number().int().min(1).max(730).optional().default(30) }).passthrough().parse(raw ?? {});
  const params: unknown[] = [];
  const where = [scopeFilter(auth, 'observation.view', params, { org: 'o.organization_id', project: 'o.project_id', site: 'o.site_id' }), "o.status <> 'cancelled'"];
  if (projectId) { params.push(projectId); where.push(`o.project_id = $${params.length}`); }
  params.push(days);
  const period = `o.observed_at >= now() - make_interval(days => $${params.length})`;
  const W = where.join(' AND ');
  const [totals, byCat, byBand] = await Promise.all([
    db.query(`SELECT count(*) FILTER (WHERE ${period})::int AS "reportedInPeriod",
                     count(*) FILTER (WHERE ${period} AND o.type='unsafe_act')::int AS "unsafeActs",
                     count(*) FILTER (WHERE ${period} AND o.type='unsafe_condition')::int AS "unsafeConditions",
                     count(*) FILTER (WHERE ${period} AND o.type='near_miss_observed')::int AS "nearMissObserved",
                     count(*) FILTER (WHERE ${period} AND o.type='positive')::int AS "positive",
                     count(*) FILTER (WHERE o.status IN ('open','assigned','action_submitted'))::int AS "openNow",
                     count(*) FILTER (WHERE o.status='assigned' AND o.due_date < current_date)::int AS "overdueNow",
                     count(*) FILTER (WHERE o.status IN ('open','assigned','action_submitted') AND o.risk_band IN ('high','critical'))::int AS "highOrCriticalOpen",
                     count(*) FILTER (WHERE o.status='closed' AND o.closed_at >= now() - make_interval(days => $${params.length}))::int AS "closedInPeriod",
                     count(*) FILTER (WHERE o.status='closed' AND o.closed_at >= now() - make_interval(days => $${params.length}) AND o.due_date IS NOT NULL AND o.closed_at::date <= o.due_date)::int AS "closedOnTime",
                     count(*) FILTER (WHERE o.status='closed' AND o.closed_at >= now() - make_interval(days => $${params.length}) AND o.due_date IS NOT NULL)::int AS "closedWithDueDate"
                FROM observations o WHERE ${W}`, params),
    db.query(`SELECT o.hazard_category AS category, count(*)::int AS n FROM observations o WHERE ${W} AND ${period} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, params),
    db.query(`SELECT o.risk_band AS band, count(*)::int AS n FROM observations o WHERE ${W} AND ${period} GROUP BY 1`, params),
  ]);
  return { result: { periodDays: days, ...totals.rows[0], byHazardCategory: byCat.rows, byRiskBand: byBand.rows, note: 'Computed live from FORGEHSE observation records in the user’s scope.' } };
}

export const studioDraftInput = z.object({
  kind: z.enum(['checklist', 'document', 'poster', 'flowchart']),
  documentType: z.enum(DOCUMENT_TYPES).optional(),
  brief: z.string().trim().min(3).max(4000),
});
export const observationDraftInput = z.object({ notes: z.string().trim().min(3).max(4000) });
