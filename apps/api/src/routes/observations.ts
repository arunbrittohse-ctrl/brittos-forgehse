import { z } from 'zod';
import {
  observationCreateSchema, observationUpdateSchema, observationTransitionSchema, observationListQuerySchema,
  OBSERVATION_TYPE_LABELS, STATUS_LABELS, type ObservationType,
} from '@forgehse/shared';
import type { Deps } from '../app';
import type { Router } from '../http/core';
import { requireAuth, hasAnywhere } from '../auth/session';
import { forbidden } from '../http/core';
import {
  listObservations, createObservation, updateObservation, transitionObservation, observationDetail,
  addAttachment, getAttachment, type ObservationRow,
} from '../services/observations';
import { registerPdf, registerXlsx, registerCsv, type Column } from '../services/exports';
import { audit } from '../services/audit';
import { orgSettings } from '../services/org';

const idParam = z.object({ id: z.string().uuid() });

const REGISTER_COLUMNS: Column<ObservationRow & { overdue: boolean }>[] = [
  { header: 'Ref No', width: 92, value: (o) => o.refNo },
  { header: 'Date', width: 52, value: (o) => o.observedAt.slice(0, 10) },
  { header: 'Project / Site', width: 70, value: (o) => `${o.projectCode} / ${o.siteCode}` },
  { header: 'Type', width: 60, value: (o) => OBSERVATION_TYPE_LABELS[o.type as ObservationType] ?? o.type },
  { header: 'Hazard', width: 66, value: (o) => o.hazardCategory },
  { header: 'Location', width: 70, value: (o) => o.location },
  { header: 'Description', width: 150, value: (o) => o.description },
  { header: 'Risk', width: 44, value: (o) => `${o.riskScore} ${o.riskBand}` },
  { header: 'Assigned to', width: 64, value: (o) => o.assigneeName ?? '' },
  { header: 'Due', width: 48, value: (o) => o.dueDate ?? '' },
  { header: 'Status', width: 60, value: (o) => (o.overdue ? 'Overdue' : STATUS_LABELS[o.status]) },
  { header: 'Closed', width: 48, value: (o) => o.closedAt?.slice(0, 10) ?? '' },
];
const XLSX_EXTRA: Column<ObservationRow & { overdue: boolean }>[] = [
  { header: 'Activity', width: 80, value: (o) => o.activity },
  { header: 'Immediate action', width: 150, value: (o) => o.immediateAction },
  { header: 'Corrective action (required)', width: 150, value: (o) => o.correctiveAction },
  { header: 'Action taken', width: 150, value: (o) => o.actionTaken },
  { header: 'Preventive action', width: 150, value: (o) => o.preventiveAction },
  { header: 'Likelihood', width: 40, value: (o) => o.likelihood },
  { header: 'Severity', width: 40, value: (o) => o.severity },
  { header: 'Reported by', width: 80, value: (o) => o.reportedByName },
  { header: 'Closed by', width: 80, value: (o) => o.closedByName ?? '' },
];

export function registerObservationRoutes(r: Router, { db, storage, config }: Deps) {
  r.get('/api/observations', async (ctx) => {
    const auth = requireAuth(ctx);
    if (!hasAnywhere(auth, 'observation.view')) throw forbidden();
    return { json: await listObservations(db, auth, ctx.parseQuery(observationListQuerySchema)) };
  });

  r.get('/api/observations/meta', async (ctx) => {
    const auth = requireAuth(ctx);
    const s = await orgSettings(db, auth.organizationId);
    return { json: { hazardCategories: s.hazardCategories, riskMatrix: s.riskMatrix, types: OBSERVATION_TYPE_LABELS, statuses: STATUS_LABELS, timezone: s.timezone } };
  });

  r.post('/api/observations', async (ctx) => {
    const auth = requireAuth(ctx);
    const body = await ctx.json(observationCreateSchema);
    const { observation, duplicate } = await createObservation(db, auth, body, ctx.ip);
    return { status: duplicate ? 200 : 201, json: { ...observation, duplicate } };
  });

  r.get('/api/observations/export', async (ctx) => {
    const auth = requireAuth(ctx);
    if (!hasAnywhere(auth, 'report.export')) throw forbidden();
    const format = z.enum(['pdf', 'xlsx', 'csv']).parse(ctx.query.format ?? 'pdf');
    const filters = observationListQuerySchema.parse({ ...ctx.query, page: 1, pageSize: 200 });
    // Export pages through the same scoped query, capped at 5,000 rows.
    const all: (ObservationRow & { overdue: boolean })[] = [];
    let total = 0;
    for (let page = 1; page <= 25; page++) {
      const res = await listObservations(db, auth, { ...filters, page, pageSize: 200 });
      total = res.total;
      all.push(...res.items);
      if (all.length >= res.total) break;
    }
    const org = (await db.query<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [auth.organizationId])).rows[0]!;
    const settings = await orgSettings(db, auth.organizationId);
    const filterText = Object.entries(filters).filter(([k, v]) => v !== undefined && !['page', 'pageSize'].includes(k)).map(([k, v]) => `${k}=${String(v)}`).join(', ') || 'none';
    const meta = { title: 'Observation Register', organization: org.name, filters: filterText, generatedBy: auth.fullName, generatedAt: new Date(), timezone: settings.timezone };
    await audit(db, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'report.export', entityType: 'observation_register', summary: `${format.toUpperCase()} · ${all.length} of ${total} rows · ${filterText}`, ip: ctx.ip });

    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'pdf') {
      const open = all.filter((o) => ['open', 'assigned', 'action_submitted'].includes(o.status)).length;
      const summary: [string, string][] = [
        ['Records', String(all.length)], ['Open / in progress', String(open)], ['Overdue', String(all.filter((o) => o.overdue).length)],
        ['Closed', String(all.filter((o) => o.status === 'closed').length)], ['High + critical', String(all.filter((o) => ['high', 'critical'].includes(o.riskBand)).length)],
      ];
      return { body: await registerPdf(meta, REGISTER_COLUMNS, all, summary), contentType: 'application/pdf', headers: { 'Content-Disposition': `attachment; filename="observation-register-${stamp}.pdf"` } };
    }
    if (format === 'xlsx') {
      return { body: await registerXlsx('Observations', meta, [...REGISTER_COLUMNS, ...XLSX_EXTRA], all), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', headers: { 'Content-Disposition': `attachment; filename="observation-register-${stamp}.xlsx"` } };
    }
    return { body: registerCsv([...REGISTER_COLUMNS, ...XLSX_EXTRA], all), contentType: 'text/csv; charset=utf-8', headers: { 'Content-Disposition': `attachment; filename="observation-register-${stamp}.csv"` } };
  });

  r.get('/api/observations/:id', async (ctx) => {
    const auth = requireAuth(ctx);
    const { id } = idParam.parse(ctx.params);
    return { json: await observationDetail(db, auth, id) };
  });

  r.patch('/api/observations/:id', async (ctx) => {
    const auth = requireAuth(ctx);
    const { id } = idParam.parse(ctx.params);
    return { json: await updateObservation(db, auth, id, await ctx.json(observationUpdateSchema), ctx.ip) };
  });

  r.post('/api/observations/:id/transitions', async (ctx) => {
    const auth = requireAuth(ctx);
    const { id } = idParam.parse(ctx.params);
    return { json: await transitionObservation(db, auth, id, await ctx.json(observationTransitionSchema), ctx.ip) };
  });

  /** Upload: raw file bytes as the body; filename & purpose in the query string. */
  r.post('/api/observations/:id/attachments', async (ctx) => {
    const auth = requireAuth(ctx);
    const { id } = idParam.parse(ctx.params);
    const q = z.object({ filename: z.string().max(200).default('photo.jpg'), purpose: z.enum(['evidence', 'closure']).default('evidence') }).parse(ctx.query);
    const data = await ctx.raw(config.MAX_UPLOAD_MB * 1024 * 1024);
    return { status: 201, json: await addAttachment(db, storage, auth, id, data, q.filename, q.purpose, ctx.ip) };
  });

  r.get('/api/attachments/:id', async (ctx) => {
    const auth = requireAuth(ctx);
    const { id } = idParam.parse(ctx.params);
    const f = await getAttachment(db, storage, auth, id);
    const inline = f.contentType.startsWith('image/') && f.contentType !== 'image/heic';
    return {
      body: f.data, contentType: f.contentType,
      headers: {
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${f.filename.replace(/"/g, '')}"`,
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'private, max-age=300',
      },
    };
  });
}
