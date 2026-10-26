import { PageHead } from '../components/AppShell';
import { Empty, Icon } from '../components/ui';
import { Link } from '../lib/router';

export type HseModuleKey =
  | 'risk-assessments' | 'permits' | 'inspections-audits' | 'incidents'
  | 'actions' | 'training' | 'contractors' | 'environmental-health'
  | 'emergency' | 'documents' | 'analytics' | 'settings';

const MODULES: Record<HseModuleKey, { title: string; description: string; purpose: string; next: string[] }> = {
  'risk-assessments': { title: 'Risk assessments', description: 'Hazard identification, risk evaluation and control review.', purpose: 'Maintain controlled risk assessments linked to project activities and method statements.', next: ['Risk assessment register and revision history', 'Likelihood × severity scoring and control hierarchy', 'Review, approval and periodic review workflow'] },
  permits: { title: 'Permits to Work', description: 'Permit request, review, authorisation, suspension and close-out.', purpose: 'Coordinate high-risk work through controlled permit lifecycles and isolation checks.', next: ['Permit types, validity windows and worksite checks', 'Authorised approver workflow and permit status', 'Isolation, handover and close-out records'] },
  'inspections-audits': { title: 'Inspections and audits', description: 'Planned inspections, audit findings and verification.', purpose: 'Schedule inspections, record findings, assign actions and verify closure evidence.', next: ['Inspection templates and schedules', 'Audit finding severity and responsible owner', 'Evidence-backed close-out and compliance trends'] },
  incidents: { title: 'Incidents and near misses', description: 'Incident notification, investigation and learning.', purpose: 'Capture incident facts, classification, investigation, corrective actions and lessons learned.', next: ['Incident and near-miss register', 'Investigation workflow and evidence', 'Recordable injury and lost-workday source data'] },
  actions: { title: 'HSE actions and gap closure', description: 'Corrective actions, accountability and verification.', purpose: 'Track corrective and preventive actions through assigned ownership, due dates and verified closure.', next: ['Owner, priority, due date and escalation', 'Evidence submission and independent verification', 'Overdue and closure-rate reporting'] },
  training: { title: 'Training and competency', description: 'Training matrix, induction, expiry and competency records.', purpose: 'Monitor role-based training requirements and competency evidence by project and contractor.', next: ['Training matrix by role and activity', 'Attendance, assessment and expiry tracking', 'Compliance rate with an eligible-worker denominator'] },
  contractors: { title: 'Contractors', description: 'Contractor organisations, personnel and assurance status.', purpose: 'Connect contractor assurance, onboarding, competency and performance to project controls.', next: ['Contractor and subcontractor register', 'Prequalification and document expiry', 'Performance indicators linked to source records'] },
  'environmental-health': { title: 'Environmental and occupational health', description: 'Environmental aspects, monitoring and occupational health controls.', purpose: 'Keep environmental and occupational health records traceable to site, activity and responsible person.', next: ['Environmental inspections and incidents', 'Waste, spill and monitoring records', 'Confidential occupational health access controls'] },
  emergency: { title: 'Emergency readiness', description: 'Emergency plans, drills, equipment and readiness actions.', purpose: 'Track emergency arrangements, drill performance and corrective actions without assuming completion.', next: ['Emergency plans and contact lists', 'Drill schedule, attendance and observations', 'Equipment checks and action close-out'] },
  documents: { title: 'Controlled documents', description: 'Revision control, review, approval and distribution.', purpose: 'Maintain controlled HSE documents with clear status, owner, revision and approval evidence.', next: ['Document register and version history', 'Review and approval workflow', 'Superseded-document identification and distribution'] },
  analytics: { title: 'Analytics and reports', description: 'Traceable HSE KPIs, trends and exportable reports.', purpose: 'Present only metrics supported by authorised source records and documented calculation rules.', next: ['Metric definitions and configurable reporting periods', 'Data-quality and denominator checks', 'Project/site comparisons and controlled exports'] },
  settings: { title: 'Administration and settings', description: 'Organisation preferences, role access and configuration.', purpose: 'Manage the organisation\'s working configuration while preserving tenancy and audit controls.', next: ['Organisation and risk-matrix settings', 'Role and permission administration', 'Data retention and audit controls'] },
};

export function ModuleWorkspace({ moduleKey }: { moduleKey: HseModuleKey }) {
  const item = MODULES[moduleKey];
  return (
    <>
      <PageHead title={item.title} sub={item.description} actions={<Link to="/app" className="btn"><Icon name="dashboard" />Command centre</Link>} />
      <section className="panel">
        <div className="panel-body stack">
          <div className="module-state">
            <span className="module-state-icon"><Icon name="layers" size={22} /></span>
            <div>
              <h2>Workflow not yet enabled</h2>
              <p className="muted">This workspace is a navigation destination, not a live register yet. No operational records or completion metrics are being fabricated.</p>
            </div>
          </div>
          <div className="notice">
            <strong>Data status:</strong> Not available in the current build. When the workflow is implemented, this page must use authorised organisation/project/site data and show explicit empty, loading, error and permission states.
          </div>
          <div>
            <h3>Planned workflow scope</h3>
            <ul className="module-scope">{item.next.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
          <div className="row">
            <Link className="btn btn-primary" to="/app/studio"><Icon name="spark" />Open AI Studio</Link>
            <Link className="btn" to="/app/observations">Open live observations register</Link>
          </div>
        </div>
      </section>
      <div className="panel" style={{ marginTop: 16 }}>
        <Empty title="No operational data available">This module will not display demo numbers as live results. Use the command centre for currently supported observation-based metrics.</Empty>
      </div>
    </>
  );
}
