import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { documentSchema, DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, type DocumentType, type HseDocument } from '@forgehse/shared';
import type { Deps } from '../app';
import type { Router } from '../http/core';
import { badRequest, forbidden, notFound, conflict } from '../http/core';
import { requireAuth, hasAnywhere, requireProjectReach, projectReach, type AuthContext } from '../auth/session';
import { audit } from '../services/audit';
import { compactParams } from '../db/db';

const inputSchema = z.object({
  docType: z.enum(DOCUMENT_TYPES),
  title: z.string().trim().min(3).max(160),
  projectId: z.string().uuid().optional(),
  projectName: z.string().trim().max(160).default(''),
  site: z.string().trim().max(160).default(''),
  client: z.string().trim().max(160).default(''),
  country: z.string().trim().max(80).default('United Arab Emirates'),
  emirate: z.string().trim().max(80).default('Abu Dhabi'),
  authorityRequirements: z.string().trim().max(2000).default(''),
  workPackage: z.string().trim().max(300).default(''),
  activity: z.string().trim().max(500).default(''),
  scope: z.string().trim().max(2000).default(''),
  sequence: z.string().trim().max(3000).default(''),
  equipment: z.string().trim().max(1200).default(''),
  materials: z.string().trim().max(1200).default(''),
  workforce: z.string().trim().max(1200).default(''),
  environment: z.string().trim().max(1200).default(''),
  isolations: z.string().trim().max(1200).default(''),
  hazards: z.array(z.string().max(100)).max(12).default([]),
  emergency: z.string().trim().max(1200).default(''),
  ppe: z.string().trim().max(800).default(''),
  references: z.string().trim().max(2000).default(''),
  riskMatrixConvention: z.string().trim().max(500).default('Likelihood × Severity; 1–5 scales; confirm the organisation-approved bands before issue.'),
});
const revisionSchema = z.object({ change_note: z.string() });
function buildDocument(v: z.infer<typeof inputSchema>): HseDocument {
  const project = v.projectName || '[PROJECT NAME TO CONFIRM]';
  const sections = [
    { heading: 'Document control and project particulars', body: `Project: ${project}\nSite: ${v.site || '[SITE TO CONFIRM]'}\nClient: ${v.client || '[CLIENT TO CONFIRM]'}\nCountry / Emirate: ${v.country} / ${v.emirate}\nWork package: ${v.workPackage || '[WORK PACKAGE TO CONFIRM]'}\nActivity: ${v.activity || '[ACTIVITY TO CONFIRM]'}\nDocument status: DRAFT — NOT APPROVED\nRisk matrix convention: ${v.riskMatrixConvention}`, bullets: [] },
    { heading: 'Purpose and scope', body: v.scope || 'Scope and boundaries must be confirmed by the responsible project team before issue.', bullets: ['Confirm exact work boundaries, interfaces, exclusions and acceptance criteria before work starts.'] },
    { heading: 'Prerequisites and responsibilities', body: 'The Project Manager is accountable for resources and coordination. The HSE Manager reviews HSE controls. The competent activity supervisor briefs the workforce and verifies controls. Workers follow the approved sequence and stop work when conditions change.', bullets: ['Confirm competency, induction, approved drawings and current method documents.', 'Obtain applicable permits and authorisations before work.', 'Coordinate simultaneous operations and communicate changes.'] },
    { heading: 'Plant, tools, materials and workforce', body: `Equipment: ${v.equipment || '[EQUIPMENT LIST REQUIRED]'}\nMaterials / chemicals: ${v.materials || '[MATERIALS AND SDS TO CONFIRM]'}\nWorkforce / competency: ${v.workforce || '[WORKFORCE AND COMPETENCY TO CONFIRM]'}\nRequired PPE: ${v.ppe || '[TASK-SPECIFIC PPE TO BE CONFIRMED BY COMPETENT PERSON]'}`, bullets: [] },
    { heading: 'Sequence of work and hold points', body: v.sequence || 'Detailed, activity-specific sequence has not been supplied. The competent author must define and approve each step before issue.', bullets: ['Hold point: supervisor confirms permits, isolations, work area and communication arrangements.', 'Hold point: verify equipment inspection and critical controls before the relevant task step.', 'Hold point: inspect completed work and obtain required acceptance before handover.'] },
    { heading: 'Hazards and control requirements', body: `Activity hazards selected for assessment: ${v.hazards.length ? v.hazards.join(', ') : '[ACTIVITY HAZARDS TO BE IDENTIFIED]'}\nExisting energy sources / isolations: ${v.isolations || '[ENERGY SOURCES AND ISOLATION REQUIREMENTS TO CONFIRM]'}\nEnvironmental conditions / simultaneous operations: ${v.environment || '[SITE CONDITIONS AND SIMOPS TO CONFIRM]'}\nAuthority / client requirements supplied: ${v.authorityRequirements || '[NO AUTHORITY OR CLIENT REQUIREMENTS SUPPLIED — VERIFY BEFORE ISSUE]'}\nSource references supplied by author: ${v.references || '[SOURCE REFERENCES NOT SUPPLIED]'}`, bullets: ['Apply the hierarchy of controls; do not rely on PPE alone where higher-level controls are practicable.', 'For work at height, lifting, excavation, confined space and electrical work, confirm task-specific engineered controls, competent personnel, permits and rescue arrangements as applicable.', 'Stop work and reassess if scope, conditions, equipment or interfaces change.'] },
    { heading: 'Emergency arrangements', body: v.emergency || 'Project-specific emergency contacts, access routes, rescue capability, first aid and communication arrangements must be inserted and verified before work.', bullets: ['Brief the workforce on alarm, evacuation, muster point and emergency communication.', 'Do not begin work requiring specialist rescue until a practicable rescue plan and resources are confirmed.'] },
    { heading: 'Environmental controls, inspections and acceptance', body: 'Prevent spills, uncontrolled discharge, unnecessary noise/dust and improper waste disposal. Inspect controls at defined intervals and after changes or adverse conditions. Record defects, assign actions and verify closure.', bullets: ['Inspect work area and equipment before start and at defined hold points.', 'Acceptance criteria, inspection frequency and record retention must be confirmed for the project.'] },
    { heading: 'Assumptions, missing inputs and approval', body: 'This is a deterministic template-based draft, not a live AI model response and not evidence of legal compliance. Placeholders and missing inputs must be resolved by a qualified author. No regulatory or client approval is implied.', bullets: ['Verify current legal requirements, client specifications and document references from controlled sources.', 'HSE Manager / competent technical reviewer: name, signature and date to be completed.', 'Project approval: authorised approver, signature and date to be completed.'] },
  ];
  const riskTable = v.docType === 'risk_assessment' || v.docType === 'method_statement' || v.docType === 'jsa_jha'
    ? [{
      activity: v.activity || '[TASK STEP TO DEFINE]',
      hazard: v.hazards.join(', ') || '[HAZARD TO IDENTIFY]',
      consequence: 'Injury, ill health, asset damage or environmental harm depending on exposure.',
      likelihood: 3, severity: 3,
      controls: ['Elimination / substitution: assess whether the hazard can be removed.', 'Engineering: provide suitable physical barriers or engineered controls where applicable.', 'Administrative: approved procedure, permit, competent supervision and pre-task briefing.', 'PPE: task-specific PPE confirmed by the competent person.'],
      residualLikelihood: 2, residualSeverity: 2,
    }]
    : [];
  return documentSchema.parse({ docType: v.docType, title: v.title, purpose: `Controlled ${DOCUMENT_TYPE_LABELS[v.docType]} draft for ${project}.`, scope: v.scope || 'Scope requires confirmation before issue.', sections, responsibilities: [{ role: 'Project Manager', duties: 'Provide resources, coordinate interfaces and ensure the approved document is implemented.' }, { role: 'HSE Manager / Engineer', duties: 'Review risk controls, verify applicable requirements and record review comments.' }, { role: 'Activity Supervisor', duties: 'Brief the workforce, verify prerequisites and monitor the work.' }], riskTable, reviewNotes: ['Confirm project/site/client particulars and all bracketed placeholders.', 'Confirm authority and client requirements against supplied controlled sources; no legal citations have been inferred.', 'Confirm the approved risk matrix, risk bands and scoring convention. Scores shown are illustrative template values, not an approved assessment.', 'Complete competent-person review and formal approval before use.'] });
}
interface Row { id:string; title:string; brief:string; content:unknown; version:number; created_at:string; updated_at:string; status:'draft'|'reviewed'; project_id:string|null; created_by:string; }
function visibility(auth:AuthContext, p:unknown[]) {
 p.push(auth.organizationId); const org='$'+p.length; p.push(auth.userId);
 const ors=['created_by = $'+p.length]; const reach=projectReach(auth,'ai.use');
 if(reach.orgWide) ors.push('TRUE'); else if(reach.projectIds.length){p.push(reach.projectIds);ors.push('project_id = ANY($'+p.length+'::uuid[])','project_id IS NULL');}
 return `organization_id = ${org} AND kind = 'document' AND deleted_at IS NULL AND (${ors.join(' OR ')})`;
}
export function registerHseDocumentRoutes(r:Router,{db}:Deps) {
 r.post('/api/hse-documents/generate',async ctx=>{
  const auth=requireAuth(ctx); if(!hasAnywhere(auth,'ai.use')) throw forbidden();
  const v=inputSchema.parse(await ctx.json(z.unknown())); if(v.projectId) requireProjectReach(auth,'ai.use',v.projectId);
  const content=buildDocument(v);
  const brief=JSON.stringify(v);
  const id=await db.transaction(async tx=>{
   const row=(await tx.query<{id:string}>(`INSERT INTO studio_items (organization_id,project_id,created_by,kind,title,brief,content) VALUES ($1,$2,$3,'document',$4,$5,$6) RETURNING id`,[auth.organizationId,v.projectId??null,auth.userId,v.title,brief,JSON.stringify(content)])).rows[0]!;
   await tx.query('INSERT INTO hse_document_revisions (studio_item_id, organization_id, version, snapshot, changed_by, change_note) VALUES ($1,$2,1,$3,$4,$5)',[row.id,auth.organizationId,JSON.stringify({title:v.title,content,inputs:v}),auth.userId,'Initial deterministic template draft']);
   await audit(tx,{organizationId:auth.organizationId,actorUserId:auth.userId,action:'studio.generate',entityType:'studio_item',entityId:row.id,projectId:v.projectId??null,summary:'Deterministic HSE document draft: '+v.title,ip:ctx.ip});
   return row.id;
  });
  return {status:201,json:{id, title:v.title, content, version:1, status:'draft', generator:'deterministic-template', disclaimer:'Template-generated draft; no live AI model was called. Qualified review and approval required.'}};
 });
 r.get('/api/hse-documents',async ctx=>{
  const auth=requireAuth(ctx); if(!hasAnywhere(auth,'ai.use')) throw forbidden();
  const p:unknown[]=[]; const W=visibility(auth,p);
  const rows=await db.query<Row>(...compactParams(`SELECT id,title,brief,content,version,created_at,updated_at,status,project_id,created_by FROM studio_items WHERE ${W} ORDER BY updated_at DESC LIMIT 100`,p));
  return {json:{items:rows.rows.map(x=>({id:x.id,title:x.title,content:x.content,version:x.version,createdAt:x.created_at,updatedAt:x.updated_at,status:x.status,projectId:x.project_id}))}};
 });
 r.get('/api/hse-documents/:id',async ctx=>{
  const auth=requireAuth(ctx); if(!hasAnywhere(auth,'ai.use')) throw forbidden();
  const p:unknown[]=[]; const W=visibility(auth,p);p.push(ctx.params.id);
  const row=(await db.query<Row>(...compactParams(`SELECT id,title,brief,content,version,created_at,updated_at,status,project_id,created_by FROM studio_items WHERE ${W} AND id=$${p.length}`,p))).rows[0];
  if(!row) throw notFound('HSE document');
  const revisions=await db.query('SELECT version,change_note,created_at,changed_by FROM hse_document_revisions WHERE studio_item_id=$1 AND organization_id=$2 ORDER BY version DESC',[row.id,auth.organizationId]);
  return {json:{item:{id:row.id,title:row.title,brief:row.brief,content:row.content,version:row.version,status:row.status,projectId:row.project_id,createdAt:row.created_at,updatedAt:row.updated_at},revisions:revisions.rows}};
 });
 r.patch('/api/hse-documents/:id',async ctx=>{
  const auth=requireAuth(ctx); if(!hasAnywhere(auth,'ai.use')) throw forbidden();
  const b=z.object({title:z.string().trim().min(3).max(160),content:documentSchema,version:z.number().int().min(1),changeNote:z.string().max(500).default('Edited draft')}).parse(await ctx.json(z.unknown());
  const p:unknown[]=[]; const W=visibility(auth,p);p.push(ctx.params.id);
  const row=(await db.query<Row>(...compactParams(`SELECT id,title,brief,content,version,created_at,updated_at,status,project_id,created_by FROM studio_items WHERE ${W} AND id=$${p.length}`,p))).rows[0];
  if(!row) throw notFound('HSE document'); if(row.created_by!==auth.userId) throw forbidden();
  const updated=await db.transaction(async tx=>{
   const u=await tx.query(`UPDATE studio_items SET title=$1,content=$2,version=version+1,status='draft',reviewed_by=NULL,reviewed_at=NULL,updated_at=now() WHERE id=$3 AND version=$4`,[b.title,JSON.stringify(b.content),row.id,b.version]);
   if(!u.rowCount) return false;
   await tx.query('INSERT INTO hse_document_revisions (studio_item_id, organization_id, version, snapshot, changed_by, change_note) VALUES ($1,$2,$3,$4,$5,$6)',[row.id,auth.organizationId,b.version+1,JSON.stringify({title:b.title,content:b.content}),auth.userId,b.changeNote]);
   await audit(tx,{organizationId:auth.organizationId,actorUserId:auth.userId,action:'studio.edit',entityType:'studio_item',entityId:row.id,projectId:row.project_id,summary:b.changeNote,ip:ctx.ip});
   return true;
  });
  if(!updated) throw conflict('This document changed in another session. Reload before saving.');
  return {json:{id:row.id,title:b.title,content:b.content,version:b.version+1,status:'draft'}};
 });
}
