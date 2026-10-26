/**
 * Registry of FORGEHSE platform domains. One place that says what each module is, which tables
 * and lifecycle it uses, its reference-number prefix, and — honestly — how far it is built.
 *
 *  live        API + screens + tests in use
 *  foundation  data model, lifecycle rules and tables exist and are tested; no API or screens yet
 *  planned     not started
 */
import type { Lifecycle } from './lifecycle';
import {
  documentLifecycle, riskAssessmentLifecycle, permitLifecycle, inspectionLifecycle, incidentLifecycle,
  correctiveActionLifecycle, gapLifecycle, contractorLifecycle, monitoringLifecycle, drillLifecycle,
} from './hse';

export type DomainStatus = 'live' | 'foundation' | 'planned';

export interface HseDomain {
  key: string;
  label: string;
  status: DomainStatus;
  /** Delivery phase in the agreed plan. */
  phase: number;
  tables: string[];
  /** Reference-number prefix, e.g. PTW-<PROJECT>-<YYYY>-<00001>. */
  refPrefix?: string;
  lifecycles?: Record<string, Lifecycle<string, string>>;
  notes: string;
}

const L = (x: unknown) => x as Lifecycle<string, string>;

export const HSE_DOMAINS: HseDomain[] = [
  { key: 'projects', label: 'Projects and sites', status: 'live', phase: 0, tables: ['projects', 'sites'], notes: 'Multi-project, multi-site structure with tenant-consistent foreign keys.' },
  { key: 'access', label: 'Users, roles and permissions', status: 'live', phase: 0, tables: ['users', 'role_assignments', 'sessions', 'audit_log'], notes: '10 roles, org/project/site scope, append-only audit log.' },
  { key: 'observations', label: 'Observations and hazard reports', status: 'live', phase: 0, tables: ['observations', 'observation_events', 'attachments'], refPrefix: 'OBS', notes: 'Existing workflow with segregation of duties.' },
  { key: 'documents_ai', label: 'HSE document studio (AI-assisted drafts)', status: 'live', phase: 0, tables: ['studio_items', 'studio_sources'], notes: 'Drafts only until reviewed; local rules engine or optional model provider.' },
  { key: 'risk', label: 'Hazards and risk assessments (incl. JSA)', status: 'foundation', phase: 5, tables: ['hazard_library', 'risk_assessments', 'risk_assessment_items'], refPrefix: 'RA', lifecycles: { riskAssessment: L(riskAssessmentLifecycle) }, notes: 'Initial and residual risk on the organisation matrix; revisions.' },
  { key: 'permits', label: 'Permits to work', status: 'foundation', phase: 6, tables: ['permits', 'permit_approvals'], refPrefix: 'PTW', lifecycles: { permit: L(permitLifecycle) }, notes: 'A permit cannot become active without authorisation by someone other than the applicant.' },
  { key: 'inspections', label: 'Inspections and audits', status: 'foundation', phase: 4, tables: ['inspection_templates', 'inspections', 'inspection_responses'], refPrefix: 'INS', lifecycles: { inspection: L(inspectionLifecycle) }, notes: 'Versioned templates; N/A and uninspected items never count as compliant.' },
  { key: 'incidents', label: 'Incidents and investigations', status: 'foundation', phase: 3, tables: ['incidents'], refPrefix: 'INC', lifecycles: { incident: L(incidentLifecycle) }, notes: 'Restricted personal data; investigation, root causes and linked CAPA.' },
  { key: 'actions', label: 'Corrective actions and HSE gaps', status: 'foundation', phase: 2, tables: ['corrective_actions', 'hse_gaps'], refPrefix: 'CA', lifecycles: { action: L(correctiveActionLifecycle), gap: L(gapLifecycle) }, notes: 'Closure requires evidence and an independent verifier.' },
  { key: 'training', label: 'Training and competency', status: 'foundation', phase: 7, tables: ['training_courses', 'training_records', 'workers'], notes: 'Expiry status computed from dates, never stored.' },
  { key: 'contractors', label: 'Contractors and workforce', status: 'foundation', phase: 7, tables: ['contractors', 'workers'], lifecycles: { contractor: L(contractorLifecycle) }, notes: 'Pre-qualification evidence before approval; minimal personal data.' },
  { key: 'environment', label: 'Environmental and occupational health monitoring', status: 'foundation', phase: 8, tables: ['environmental_monitoring'], refPrefix: 'ENV', lifecycles: { monitoring: L(monitoringLifecycle) }, notes: 'Limits only from verified configuration; occupational health records restricted.' },
  { key: 'emergency', label: 'Emergency preparedness and drills', status: 'foundation', phase: 8, tables: ['emergency_drills'], refPrefix: 'DRL', lifecycles: { drill: L(drillLifecycle) }, notes: 'Drill findings raise corrective actions.' },
  { key: 'document_control', label: 'Document control and reporting', status: 'foundation', phase: 9, tables: ['controlled_documents', 'document_revisions', 'record_revisions'], refPrefix: 'DOC', lifecycles: { document: L(documentLifecycle) }, notes: 'Revisions, independent approval, issue and supersede.' },
];

export function domain(key: string): HseDomain | undefined {
  return HSE_DOMAINS.find((d) => d.key === key);
}
