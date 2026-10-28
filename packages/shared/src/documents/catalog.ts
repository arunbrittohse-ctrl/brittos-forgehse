/**
 * HSE Document Studio — catalogue of controlled document types and the input form.
 *
 * The form is conditional: each field declares which document types it applies to and, where
 * relevant, which selected activity hazards make it appear. A field that does not apply is
 * never shown and never required. Nothing here is a legal requirement; requirements that come
 * from an authority or client are captured as user-supplied references with their source.
 */

export const DOC_TYPE_KEYS = [
  'risk_assessment', 'jsa', 'method_statement', 'project_hse_plan', 'emergency_response_plan',
  'work_method_plan', 'logistics_plan', 'traffic_management_plan', 'safe_work_procedure',
  'hse_policy', 'qhse_policy', 'environmental_management_plan', 'inspection_checklist',
  'toolbox_talk', 'training_material', 'hse_audit_report', 'incident_investigation_report',
  'closeout_handover_report',
] as const;
export type DocTypeKey = (typeof DOC_TYPE_KEYS)[number];

export type DocFamily = 'activity' | 'plan' | 'policy' | 'record' | 'learning';

export interface DocTypeDef {
  key: DocTypeKey;
  label: string;
  /** Short code used in document numbers, e.g. RA → P101-RA-2026-0001. */
  code: string;
  family: DocFamily;
  description: string;
  /** Has a structured risk register (task step → hazard → controls → residual). */
  riskRegister: boolean;
  /** Why a qualified person must review this type before it is approved, shown in the document. */
  qualifiedReview: string;
}

const ACT_REVIEW = 'Contains risk ratings and safety-critical controls; a competent HSE person and the responsible supervisor must review it.';

export const DOC_TYPES: readonly DocTypeDef[] = [
  { key: 'risk_assessment', label: 'Risk Assessment (RA)', code: 'RA', family: 'activity', riskRegister: true, description: 'Task-step hazard identification with initial and residual risk on the organisation\'s matrix.', qualifiedReview: ACT_REVIEW },
  { key: 'jsa', label: 'Job Safety / Hazard Analysis (JSA/JHA)', code: 'JSA', family: 'activity', riskRegister: true, description: 'Step-by-step job breakdown with hazards and controls for the crew doing the work.', qualifiedReview: ACT_REVIEW },
  { key: 'method_statement', label: 'Method Statement (MS)', code: 'MS', family: 'activity', riskRegister: true, description: 'How the work will be done safely: sequence, resources, permits, hold points and acceptance.', qualifiedReview: ACT_REVIEW },
  { key: 'project_hse_plan', label: 'Project HSE Plan', code: 'HSEP', family: 'plan', riskRegister: false, description: 'Project-wide HSE organisation, arrangements, monitoring and reporting.', qualifiedReview: 'Sets project-wide HSE arrangements; the Project HSE Manager and Project Manager must review it, and client requirements must be verified against the contract.' },
  { key: 'emergency_response_plan', label: 'Emergency Response Plan (ERP)', code: 'ERP', family: 'plan', riskRegister: false, description: 'Scenario responses, roles, alarms, muster and communication arrangements.', qualifiedReview: 'Emergency contacts, routes and rescue capability must be verified on site by an authorised person; no contact number is generated.' },
  { key: 'work_method_plan', label: 'Work Method Plan (WMP)', code: 'WMP', family: 'activity', riskRegister: true, description: 'Planning document for a work package: sequence, interfaces, resources and controls.', qualifiedReview: ACT_REVIEW },
  { key: 'logistics_plan', label: 'Logistics Plan', code: 'LOG', family: 'plan', riskRegister: false, description: 'Deliveries, storage, laydown, access and material handling arrangements.', qualifiedReview: 'Affects site traffic and access; the logistics lead and HSE must review it.' },
  { key: 'traffic_management_plan', label: 'Traffic Management Plan (TMP)', code: 'TMP', family: 'plan', riskRegister: false, description: 'Vehicle and pedestrian segregation, routes, signage and plant movement controls.', qualifiedReview: 'Any authority or road-owner approval must be obtained separately; this document does not imply it.' },
  { key: 'safe_work_procedure', label: 'Safe Work Procedure', code: 'SWP', family: 'activity', riskRegister: false, description: 'Standard steps, controls and stop-work points for a recurring task.', qualifiedReview: ACT_REVIEW },
  { key: 'hse_policy', label: 'HSE Policy', code: 'POL', family: 'policy', riskRegister: false, description: 'Statement of HSE commitment, responsibilities and arrangements for signature by top management.', qualifiedReview: 'A policy is only valid once signed by the accountable executive named by the organisation.' },
  { key: 'qhse_policy', label: 'QHSE Policy', code: 'QPOL', family: 'policy', riskRegister: false, description: 'Combined quality, health, safety and environment policy statement.', qualifiedReview: 'A policy is only valid once signed by the accountable executive named by the organisation.' },
  { key: 'environmental_management_plan', label: 'Environmental Management Plan', code: 'EMP', family: 'plan', riskRegister: false, description: 'Environmental aspects, controls, waste, monitoring and responsibilities.', qualifiedReview: 'Monitoring limits and permit conditions must come from the applicable environmental permit or authority; none are generated.' },
  { key: 'inspection_checklist', label: 'Inspection Checklist', code: 'CHK', family: 'activity', riskRegister: false, description: 'Yes / No / N/A checks for an area, activity or equipment, with critical items flagged.', qualifiedReview: 'Critical items and acceptance criteria must be confirmed by a competent person.' },
  { key: 'toolbox_talk', label: 'Toolbox Talk', code: 'TBT', family: 'learning', riskRegister: false, description: 'Short briefing with key hazards, controls, discussion questions and attendance.', qualifiedReview: 'Must be checked by the supervisor delivering it for accuracy on this site.' },
  { key: 'training_material', label: 'Training Material', code: 'TRN', family: 'learning', riskRegister: false, description: 'Course outline, learning objectives, content and knowledge check questions.', qualifiedReview: 'Training content must be reviewed by a competent trainer; it does not confer accredited certification.' },
  { key: 'hse_audit_report', label: 'HSE Audit Report', code: 'AUD', family: 'record', riskRegister: false, description: 'Audit scope, criteria, findings with objective evidence, and agreed actions.', qualifiedReview: 'Findings must be supported by the objective evidence recorded by the audit team.' },
  { key: 'incident_investigation_report', label: 'Incident Investigation Report', code: 'IIR', family: 'record', riskRegister: false, description: 'Facts, timeline, causal analysis (5 Whys) and corrective actions.', qualifiedReview: 'Root causes are only established when the investigation team verifies them; this draft only lists questions and possible factors.' },
  { key: 'closeout_handover_report', label: 'HSE Closeout & Handover Report', code: 'CHR', family: 'record', riskRegister: false, description: 'Completed scope, outstanding actions and residual risks at handover.', qualifiedReview: 'Outstanding actions and residual risks must be accepted in writing by the receiving party.' },
];

export function docType(key: DocTypeKey): DocTypeDef {
  return DOC_TYPES.find((d) => d.key === key)!;
}

/** Activity hazards the form asks about; each maps to a topic in the HSE knowledge base. */
export const ACTIVITY_HAZARDS = [
  { key: 'work_at_height', label: 'Work at height' },
  { key: 'scaffolding', label: 'Scaffolding' },
  { key: 'lifting', label: 'Lifting operations' },
  { key: 'excavation', label: 'Excavation' },
  { key: 'confined_space', label: 'Confined space' },
  { key: 'electrical', label: 'Electrical work' },
  { key: 'hot_work', label: 'Hot work' },
  { key: 'chemical', label: 'Hazardous substances' },
  { key: 'traffic', label: 'Vehicles and mobile plant' },
  { key: 'heat_stress', label: 'Heat stress' },
] as const;
export type ActivityHazard = (typeof ACTIVITY_HAZARDS)[number]['key'];

export const ERP_SCENARIOS = [
  { key: 'fire', label: 'Fire or explosion' },
  { key: 'medical', label: 'Serious injury or medical emergency' },
  { key: 'fall_rescue', label: 'Rescue of a suspended person after a fall arrest' },
  { key: 'confined_space_rescue', label: 'Confined space rescue' },
  { key: 'chemical_release', label: 'Chemical spill or gas release' },
  { key: 'heat_illness', label: 'Heat illness' },
  { key: 'structural_collapse', label: 'Structural, scaffold or excavation collapse' },
  { key: 'utility_strike', label: 'Underground or overhead utility strike' },
  { key: 'severe_weather', label: 'Severe weather (sandstorm, high wind, flooding)' },
] as const;

export const PPE_OPTIONS = [
  'Safety helmet', 'Safety footwear', 'High-visibility clothing', 'Safety glasses', 'Gloves (task-specific)',
  'Hearing protection', 'Full-body harness and lanyard', 'Respiratory protection (task-specific)',
  'Face shield / welding helmet', 'Flame-resistant clothing', 'Chemical-resistant clothing',
] as const;

export type FieldType = 'text' | 'textarea' | 'lines' | 'select' | 'multiselect' | 'date' | 'time' | 'references' | 'contacts';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  group: 'Document' | 'Project' | 'Work' | 'Conditions' | 'Hazards' | 'Emergency' | 'Requirements' | 'Event' | 'Audit' | 'Closeout' | 'Learning' | 'Policy' | 'Plan';
  help?: string;
  options?: readonly { value: string; label: string }[];
  max?: number;
  /** Document types this field applies to; omitted = all types. */
  types?: readonly (DocTypeKey | DocFamily)[];
  /** Only shown when one of these activity hazards is selected. */
  hazards?: readonly ActivityHazard[];
  /** Only shown when another field has one of these values. */
  when?: { key: string; equals: readonly string[] };
  /** Must be supplied before a draft can be generated. */
  requiredToGenerate?: readonly (DocTypeKey | DocFamily)[] | 'all';
  /** Must be supplied before the document can be submitted for review. */
  requiredToSubmit?: readonly (DocTypeKey | DocFamily)[] | 'all';
}

const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x }));
const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unknown', label: 'Not yet known' }] as const;

const ACTIVITY: DocFamily[] = ['activity'];
const ACT_AND_LEARN: DocFamily[] = ['activity', 'learning'];
const SITE_DOCS: DocFamily[] = ['activity', 'plan', 'learning', 'record'];

export const FIELDS: readonly FieldDef[] = [
  /* -------- document */
  { key: 'title', label: 'Document title', type: 'text', group: 'Document', max: 160, requiredToGenerate: 'all', requiredToSubmit: 'all', help: 'For example "Installation of precast parapets at Bridge B2".' },

  /* -------- project particulars */
  { key: 'projectName', label: 'Project name', type: 'text', group: 'Project', max: 160, types: SITE_DOCS, requiredToGenerate: ['plan', 'record'], requiredToSubmit: SITE_DOCS },
  { key: 'site', label: 'Site / location', type: 'text', group: 'Project', max: 160, types: SITE_DOCS, requiredToSubmit: ['activity', 'plan'] },
  { key: 'client', label: 'Client', type: 'text', group: 'Project', max: 160, types: ['activity', 'plan', 'record'] },
  { key: 'country', label: 'Country', type: 'text', group: 'Project', max: 80, help: 'For example United Arab Emirates.' },
  { key: 'emirate', label: 'Emirate / state / region', type: 'text', group: 'Project', max: 80 },
  { key: 'authority', label: 'Relevant authority or client requirements', type: 'textarea', group: 'Requirements', max: 2000, help: 'Describe the requirements the document must meet. Add each source below; the studio does not supply legal citations.' },
  { key: 'references', label: 'Applicable standards, procedures and client specifications', type: 'references', group: 'Requirements', help: 'Each reference is printed exactly as you enter it, with its source. Nothing is added automatically.' },

  /* -------- work */
  { key: 'workPackage', label: 'Work package', type: 'text', group: 'Work', max: 200, types: ['activity', 'plan', 'learning'] },
  { key: 'activity', label: 'Work activity', type: 'textarea', group: 'Work', max: 600, types: ACT_AND_LEARN, requiredToGenerate: ACTIVITY, requiredToSubmit: ACT_AND_LEARN },
  { key: 'scope', label: 'Scope and boundaries', type: 'textarea', group: 'Work', max: 2000, types: ['activity', 'plan', 'record'], requiredToSubmit: ['activity', 'plan'], help: 'What is included, where the work boundaries are, and what is excluded.' },
  { key: 'sequence', label: 'Work sequence (one step per line)', type: 'lines', group: 'Work', max: 40, types: ['risk_assessment', 'jsa', 'method_statement', 'work_method_plan', 'safe_work_procedure'], requiredToSubmit: ['jsa', 'method_statement', 'work_method_plan', 'safe_work_procedure'] },
  { key: 'equipment', label: 'Plant, tools and equipment (one per line)', type: 'lines', group: 'Work', max: 40, types: ['risk_assessment', 'jsa', 'method_statement', 'work_method_plan', 'safe_work_procedure', 'logistics_plan', 'traffic_management_plan'], requiredToSubmit: ['method_statement', 'work_method_plan'] },
  { key: 'materials', label: 'Materials and chemicals (one per line)', type: 'lines', group: 'Work', max: 40, types: ['risk_assessment', 'method_statement', 'work_method_plan', 'safe_work_procedure', 'logistics_plan', 'environmental_management_plan'] },
  { key: 'workforce', label: 'Workforce (roles and numbers)', type: 'textarea', group: 'Work', max: 1200, types: ['risk_assessment', 'method_statement', 'work_method_plan', 'project_hse_plan', 'emergency_response_plan'] },
  { key: 'competency', label: 'Competency and training requirements (one per line)', type: 'lines', group: 'Work', max: 30, types: ['risk_assessment', 'jsa', 'method_statement', 'work_method_plan', 'safe_work_procedure', 'project_hse_plan'], requiredToSubmit: ['method_statement'] },

  /* -------- conditions */
  { key: 'environment', label: 'Environmental and site conditions', type: 'textarea', group: 'Conditions', max: 1200, types: ['activity', 'plan'], help: 'For example summer heat, wind exposure, ground conditions, night work.' },
  { key: 'simops', label: 'Simultaneous operations (SIMOPS) and interfaces', type: 'textarea', group: 'Conditions', max: 1200, types: ['risk_assessment', 'jsa', 'method_statement', 'work_method_plan', 'logistics_plan', 'traffic_management_plan', 'project_hse_plan'] },
  { key: 'energySources', label: 'Existing energy sources and isolations', type: 'textarea', group: 'Conditions', max: 1200, types: ['risk_assessment', 'jsa', 'method_statement', 'work_method_plan', 'safe_work_procedure'], help: 'Electrical, pressure, stored mechanical, hydraulic, chemical, thermal. State how each is isolated.' },

  /* -------- hazards (drive conditional questions) */
  { key: 'hazards', label: 'Activity hazards that apply', type: 'multiselect', group: 'Hazards', options: ACTIVITY_HAZARDS.map((h) => ({ value: h.key, label: h.label })), types: ['activity', 'learning', 'emergency_response_plan', 'project_hse_plan'] },
  { key: 'workingHeight', label: 'Maximum working height', type: 'text', group: 'Hazards', max: 60, hazards: ['work_at_height'], types: ACTIVITY, requiredToSubmit: ['risk_assessment', 'method_statement'] },
  { key: 'accessEquipment', label: 'Access equipment', type: 'multiselect', group: 'Hazards', options: opts(['Scaffold', 'Mobile elevating work platform', 'Ladder (short duration)', 'Rope access', 'Fixed platform / roof edge']), hazards: ['work_at_height', 'scaffolding'], types: ACTIVITY },
  { key: 'fallRescue', label: 'Fall rescue arrangements', type: 'textarea', group: 'Hazards', max: 800, hazards: ['work_at_height'], types: ['activity', 'emergency_response_plan'], requiredToSubmit: ['risk_assessment', 'method_statement'] },
  { key: 'scaffoldType', label: 'Scaffold type and inspection regime', type: 'textarea', group: 'Hazards', max: 600, hazards: ['scaffolding'], types: ACTIVITY },
  { key: 'liftCategory', label: 'Lift category (per the project lifting procedure)', type: 'select', group: 'Hazards', options: opts(['Routine', 'Complex', 'Critical', 'Not yet categorised']), hazards: ['lifting'], types: ACTIVITY, requiredToSubmit: ['risk_assessment', 'method_statement'] },
  { key: 'craneDetails', label: 'Crane / lifting equipment and rated capacity', type: 'text', group: 'Hazards', max: 200, hazards: ['lifting'], types: ACTIVITY, requiredToSubmit: ['method_statement'] },
  { key: 'heaviestLoad', label: 'Heaviest load and lift radius', type: 'text', group: 'Hazards', max: 200, hazards: ['lifting'], types: ACTIVITY },
  { key: 'liftPlanRef', label: 'Lifting plan reference', type: 'text', group: 'Hazards', max: 120, hazards: ['lifting'], types: ACTIVITY },
  { key: 'excavationDepth', label: 'Excavation depth', type: 'text', group: 'Hazards', max: 60, hazards: ['excavation'], types: ACTIVITY, requiredToSubmit: ['risk_assessment', 'method_statement'] },
  { key: 'servicesSurveyed', label: 'Underground services surveyed and marked?', type: 'select', group: 'Hazards', options: yesNo, hazards: ['excavation'], types: ACTIVITY, requiredToSubmit: ['risk_assessment', 'method_statement'] },
  { key: 'excavationSupport', label: 'Excavation support method', type: 'select', group: 'Hazards', options: opts(['Battered / stepped sides', 'Shoring system', 'Trench box', 'Not required (confirmed by competent person)', 'To be decided']), hazards: ['excavation'], types: ACTIVITY },
  { key: 'confinedSpace', label: 'Confined space description', type: 'textarea', group: 'Hazards', max: 600, hazards: ['confined_space'], types: ACTIVITY, requiredToSubmit: ['risk_assessment', 'method_statement'] },
  { key: 'gasTesting', label: 'Atmospheric testing arrangements', type: 'textarea', group: 'Hazards', max: 600, hazards: ['confined_space'], types: ACTIVITY, requiredToSubmit: ['risk_assessment', 'method_statement'] },
  { key: 'confinedRescue', label: 'Standby person and rescue arrangements', type: 'textarea', group: 'Hazards', max: 600, hazards: ['confined_space'], types: ['activity', 'emergency_response_plan'], requiredToSubmit: ['risk_assessment', 'method_statement'] },
  { key: 'voltage', label: 'Voltage / system involved', type: 'text', group: 'Hazards', max: 120, hazards: ['electrical'], types: ACTIVITY, requiredToSubmit: ['risk_assessment', 'method_statement'] },
  { key: 'isolationMethod', label: 'Isolation and lockout/tagout (LOTO) method', type: 'textarea', group: 'Hazards', max: 800, hazards: ['electrical'], types: ACTIVITY, requiredToSubmit: ['risk_assessment', 'method_statement'] },
  { key: 'liveWork', label: 'Will any work be done on or near live conductors?', type: 'select', group: 'Hazards', options: yesNo, hazards: ['electrical'], types: ACTIVITY },
  { key: 'liveWorkJustification', label: 'Justification and authorisation for live work', type: 'textarea', group: 'Hazards', max: 800, hazards: ['electrical'], when: { key: 'liveWork', equals: ['yes'] }, types: ACTIVITY, requiredToSubmit: ['risk_assessment', 'method_statement'] },
  { key: 'fireWatch', label: 'Fire watch arrangements', type: 'textarea', group: 'Hazards', max: 600, hazards: ['hot_work'], types: ACTIVITY },
  { key: 'combustibles', label: 'Combustible materials within the work area?', type: 'select', group: 'Hazards', options: yesNo, hazards: ['hot_work'], types: ACTIVITY },
  { key: 'chemicals', label: 'Hazardous substances used (one per line)', type: 'lines', group: 'Hazards', max: 30, hazards: ['chemical'], types: ACTIVITY },
  { key: 'sdsAvailable', label: 'Safety data sheets available at the work area?', type: 'select', group: 'Hazards', options: yesNo, hazards: ['chemical'], types: ACTIVITY },
  { key: 'plantMovements', label: 'Plant and vehicle movements', type: 'textarea', group: 'Hazards', max: 600, hazards: ['traffic'], types: ACTIVITY },
  { key: 'heatRegime', label: 'Heat stress work-rest and hydration arrangements', type: 'textarea', group: 'Hazards', max: 600, hazards: ['heat_stress'], types: ['activity', 'project_hse_plan'], help: 'State the regime from your project procedure or authority requirement; the studio does not set limits.' },

  /* -------- emergency + PPE */
  { key: 'emergencyArrangements', label: 'Emergency arrangements', type: 'textarea', group: 'Emergency', max: 1500, types: ['activity', 'plan'], requiredToSubmit: ['risk_assessment', 'method_statement', 'work_method_plan', 'emergency_response_plan'], help: 'Alarm, first aid, assembly point, nearest medical facility, access for emergency services.' },
  { key: 'assemblyPoint', label: 'Assembly / muster point', type: 'text', group: 'Emergency', max: 200, types: ['emergency_response_plan', 'project_hse_plan'], requiredToSubmit: ['emergency_response_plan'] },
  { key: 'scenarios', label: 'Emergency scenarios to cover', type: 'multiselect', group: 'Emergency', options: ERP_SCENARIOS.map((s) => ({ value: s.key, label: s.label })), types: ['emergency_response_plan'], requiredToGenerate: ['emergency_response_plan'] },
  { key: 'contacts', label: 'Emergency contacts (verified by your site)', type: 'contacts', group: 'Emergency', types: ['emergency_response_plan', 'project_hse_plan'], requiredToSubmit: ['emergency_response_plan'], help: 'Only numbers you enter are printed. Each must be verified before approval.' },
  { key: 'ppe', label: 'Required PPE', type: 'multiselect', group: 'Emergency', options: opts(PPE_OPTIONS), types: ['activity', 'learning'], requiredToSubmit: ['risk_assessment', 'jsa', 'method_statement', 'safe_work_procedure'] },

  /* -------- plans */
  { key: 'projectDuration', label: 'Project duration / key dates', type: 'text', group: 'Plan', max: 200, types: ['project_hse_plan', 'logistics_plan', 'traffic_management_plan', 'environmental_management_plan'] },
  { key: 'keyActivities', label: 'Key construction activities (one per line)', type: 'lines', group: 'Plan', max: 30, types: ['project_hse_plan', 'environmental_management_plan'], requiredToSubmit: ['project_hse_plan'] },
  { key: 'organisation', label: 'Project HSE organisation (role — name, one per line)', type: 'lines', group: 'Plan', max: 30, types: ['project_hse_plan', 'emergency_response_plan'], requiredToSubmit: ['project_hse_plan'] },
  { key: 'routes', label: 'Vehicle routes, gates and parking', type: 'textarea', group: 'Plan', max: 1500, types: ['traffic_management_plan', 'logistics_plan'], requiredToSubmit: ['traffic_management_plan'] },
  { key: 'pedestrianRoutes', label: 'Pedestrian routes and crossings', type: 'textarea', group: 'Plan', max: 1200, types: ['traffic_management_plan'], requiredToSubmit: ['traffic_management_plan'] },
  { key: 'deliveryHours', label: 'Working and delivery hours', type: 'text', group: 'Plan', max: 200, types: ['traffic_management_plan', 'logistics_plan'] },
  { key: 'storageAreas', label: 'Storage, laydown and material handling areas', type: 'textarea', group: 'Plan', max: 1200, types: ['logistics_plan'], requiredToSubmit: ['logistics_plan'] },
  { key: 'aspects', label: 'Environmental aspects (one per line)', type: 'lines', group: 'Plan', max: 30, types: ['environmental_management_plan'], requiredToSubmit: ['environmental_management_plan'], help: 'For example dust, noise, waste, wastewater, fuel storage, ecology.' },
  { key: 'wasteStreams', label: 'Waste streams and disposal routes (one per line)', type: 'lines', group: 'Plan', max: 30, types: ['environmental_management_plan', 'closeout_handover_report'] },
  { key: 'monitoring', label: 'Monitoring required by permits or client (one per line)', type: 'lines', group: 'Plan', max: 30, types: ['environmental_management_plan'], help: 'Enter limits only from the applicable permit or authority requirement.' },

  /* -------- policy */
  { key: 'organisationName', label: 'Organisation name as it should appear', type: 'text', group: 'Policy', max: 160, types: ['policy'], requiredToGenerate: ['policy'] },
  { key: 'policyScope', label: 'Activities and locations covered', type: 'textarea', group: 'Policy', max: 1000, types: ['policy'], requiredToSubmit: ['policy'] },
  { key: 'signatoryRole', label: 'Accountable signatory (role)', type: 'text', group: 'Policy', max: 120, types: ['policy'], requiredToSubmit: ['policy'], help: 'For example Managing Director.' },
  { key: 'reviewFrequency', label: 'Review frequency', type: 'select', group: 'Policy', options: opts(['Annually', 'Every two years', 'On significant change only']), types: ['policy', 'plan'] },

  /* -------- learning */
  { key: 'audience', label: 'Audience', type: 'text', group: 'Learning', max: 200, types: ['learning'], requiredToSubmit: ['learning'] },
  { key: 'duration', label: 'Duration', type: 'text', group: 'Learning', max: 60, types: ['learning'] },
  { key: 'learningObjectives', label: 'Learning objectives (one per line)', type: 'lines', group: 'Learning', max: 12, types: ['training_material'] },
  { key: 'inspectionArea', label: 'Area, activity or equipment inspected', type: 'text', group: 'Learning', max: 200, types: ['inspection_checklist'], requiredToGenerate: ['inspection_checklist'] },
  { key: 'inspectionFrequency', label: 'Inspection frequency', type: 'text', group: 'Learning', max: 120, types: ['inspection_checklist'] },

  /* -------- incident */
  { key: 'eventDate', label: 'Event date', type: 'date', group: 'Event', types: ['incident_investigation_report'], requiredToGenerate: ['incident_investigation_report'] },
  { key: 'eventTime', label: 'Event time', type: 'time', group: 'Event', types: ['incident_investigation_report'] },
  { key: 'eventLocation', label: 'Exact location', type: 'text', group: 'Event', max: 200, types: ['incident_investigation_report'], requiredToSubmit: ['incident_investigation_report'] },
  { key: 'eventType', label: 'Event category', type: 'select', group: 'Event', options: opts(['Injury', 'Property damage', 'Environmental event', 'Dangerous occurrence', 'Near miss']), types: ['incident_investigation_report'], requiredToGenerate: ['incident_investigation_report'] },
  { key: 'eventDescription', label: 'What happened (facts only)', type: 'textarea', group: 'Event', max: 3000, types: ['incident_investigation_report'], requiredToGenerate: ['incident_investigation_report'] },
  { key: 'immediateActions', label: 'Immediate response and actions taken', type: 'textarea', group: 'Event', max: 1500, types: ['incident_investigation_report'], requiredToSubmit: ['incident_investigation_report'] },
  { key: 'actualSeverity', label: 'Actual severity', type: 'select', group: 'Event', options: opts(['None', 'Minor', 'Moderate', 'Major', 'Severe']), types: ['incident_investigation_report'] },
  { key: 'potentialSeverity', label: 'Potential severity', type: 'select', group: 'Event', options: opts(['Minor', 'Moderate', 'Major', 'Severe', 'Catastrophic']), types: ['incident_investigation_report'], requiredToSubmit: ['incident_investigation_report'] },
  { key: 'impacts', label: 'People, assets and environmental impacts', type: 'textarea', group: 'Event', max: 1500, types: ['incident_investigation_report'] },
  { key: 'investigationTeam', label: 'Investigation team (one per line)', type: 'lines', group: 'Event', max: 12, types: ['incident_investigation_report'], requiredToSubmit: ['incident_investigation_report'] },
  { key: 'whys', label: '5 Whys — answers verified by the investigation team (one per line)', type: 'lines', group: 'Event', max: 7, types: ['incident_investigation_report'], help: 'Leave empty until the team has evidence. The draft will list questions, not conclusions.' },

  /* -------- audit */
  { key: 'auditDate', label: 'Audit date(s)', type: 'text', group: 'Audit', max: 120, types: ['hse_audit_report'], requiredToSubmit: ['hse_audit_report'] },
  { key: 'auditScope', label: 'Audit scope', type: 'textarea', group: 'Audit', max: 1500, types: ['hse_audit_report'], requiredToGenerate: ['hse_audit_report'] },
  { key: 'auditCriteria', label: 'Audit criteria (documents audited against, one per line)', type: 'lines', group: 'Audit', max: 20, types: ['hse_audit_report'], requiredToSubmit: ['hse_audit_report'] },
  { key: 'auditTeam', label: 'Audit team (one per line)', type: 'lines', group: 'Audit', max: 12, types: ['hse_audit_report'], requiredToSubmit: ['hse_audit_report'] },
  { key: 'auditees', label: 'Auditees / areas visited', type: 'textarea', group: 'Audit', max: 800, types: ['hse_audit_report'] },
  { key: 'findings', label: 'Findings: "grade | finding | objective evidence" (one per line)', type: 'lines', group: 'Audit', max: 40, types: ['hse_audit_report'], help: 'Grade = Major, Minor, Observation or Good practice.' },

  /* -------- closeout */
  { key: 'completionDate', label: 'Completion / handover date', type: 'date', group: 'Closeout', types: ['closeout_handover_report'], requiredToSubmit: ['closeout_handover_report'] },
  { key: 'scopeCompleted', label: 'Scope completed', type: 'textarea', group: 'Closeout', max: 1500, types: ['closeout_handover_report'], requiredToGenerate: ['closeout_handover_report'] },
  { key: 'outstandingActions', label: 'Outstanding actions: "action | owner | due date" (one per line)', type: 'lines', group: 'Closeout', max: 40, types: ['closeout_handover_report'] },
  { key: 'residualRisks', label: 'Residual risks handed over (one per line)', type: 'lines', group: 'Closeout', max: 30, types: ['closeout_handover_report'] },
  { key: 'recordsHandedOver', label: 'HSE records handed over (one per line)', type: 'lines', group: 'Closeout', max: 40, types: ['closeout_handover_report'] },
  { key: 'handoverTo', label: 'Receiving party', type: 'text', group: 'Closeout', max: 160, types: ['closeout_handover_report'], requiredToSubmit: ['closeout_handover_report'] },
];

/* ---------------------------------------------------------------- input values */

export interface DocReference { source: string; reference: string; requirement: string }
export interface DocContact { role: string; name: string; phone: string }
export type InputValue = string | string[] | DocReference[] | DocContact[];
export type DocInputs = Record<string, InputValue | undefined>;

function inScope(spec: readonly string[] | 'all' | undefined, t: DocTypeDef): boolean {
  if (!spec) return false;
  if (spec === 'all') return true;
  return spec.includes(t.key) || spec.includes(t.family);
}

export function fieldApplies(f: FieldDef, typeKey: DocTypeKey, inputs: DocInputs): boolean {
  const t = docType(typeKey);
  if (f.types && !(f.types as readonly string[]).includes(t.key) && !(f.types as readonly string[]).includes(t.family)) return false;
  if (f.hazards) {
    const sel = asList(inputs.hazards);
    if (!f.hazards.some((h) => sel.includes(h))) return false;
  }
  if (f.when) {
    const v = inputs[f.when.key];
    if (typeof v !== 'string' || !f.when.equals.includes(v)) return false;
  }
  return true;
}

/** Fields shown for this document type given the current answers (conditional questions included). */
export function visibleFields(typeKey: DocTypeKey, inputs: DocInputs): FieldDef[] {
  return FIELDS.filter((f) => fieldApplies(f, typeKey, inputs));
}

export function isFilled(v: InputValue | undefined): boolean {
  if (v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.some((x) => typeof x === 'string' ? x.trim().length > 0 : Object.values(x).some((y) => String(y).trim().length > 0));
  return false;
}

/** Required fields that are still empty, for the given stage. */
export function missingRequired(typeKey: DocTypeKey, inputs: DocInputs, stage: 'generate' | 'submit'): FieldDef[] {
  const t = docType(typeKey);
  return visibleFields(typeKey, inputs).filter((f) => {
    const req = stage === 'generate' ? f.requiredToGenerate : (f.requiredToSubmit ?? f.requiredToGenerate);
    return inScope(req, t) && !isFilled(inputs[f.key]);
  });
}

export function asList(v: InputValue | undefined): string[] {
  if (v === undefined) return [];
  if (typeof v === 'string') return v.split('\n').map((s) => s.trim()).filter(Boolean);
  return (v as unknown[]).filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean);
}
export function asText(v: InputValue | undefined): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  return asList(v).join(', ');
}
export function asReferences(v: InputValue | undefined): DocReference[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).filter((x): x is DocReference => typeof x === 'object' && x !== null && 'reference' in x)
    .map((r) => ({ source: String(r.source ?? '').trim(), reference: String(r.reference ?? '').trim(), requirement: String(r.requirement ?? '').trim() }))
    .filter((r) => r.source || r.reference || r.requirement);
}
export function asContacts(v: InputValue | undefined): DocContact[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).filter((x): x is DocContact => typeof x === 'object' && x !== null && 'role' in x)
    .map((c) => ({ role: String(c.role ?? '').trim(), name: String(c.name ?? '').trim(), phone: String(c.phone ?? '').trim() }))
    .filter((c) => c.role || c.name || c.phone);
}
