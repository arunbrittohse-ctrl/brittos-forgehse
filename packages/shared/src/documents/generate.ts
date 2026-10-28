/**
 * Deterministic template generator for the HSE Document Studio.
 *
 * Same inputs → same document, with no network call and no AI model. Content comes from the
 * form answers plus the curated topic library (packages/shared/src/knowledge). The generator:
 *   • never invents legal citations, authority approvals, emergency numbers or numeric limits;
 *   • leaves anything the author must supply as a visible "[Confirm: …]" placeholder, which
 *     blocks submission for review until it is resolved;
 *   • leaves every likelihood / severity rating EMPTY — risk ratings are assessed by a person on
 *     the organisation's matrix, never defaulted, and residual risk is never assumed lower.
 */
import { TOPICS, matchTopic, topicById, GENERAL_TOPIC, type Topic } from '../knowledge/hse-topics';
import {
  docType, missingRequired, asList, asText, asReferences, asContacts, ACTIVITY_HAZARDS, ERP_SCENARIOS,
  type DocInputs, type DocTypeKey, type DocTypeDef,
} from './catalog';
import { describeMatrix, type DocContent, type DocRiskRow, type DocSection, type ContentOrigin } from './schema';
import type { RiskMatrixConfig } from '../risk';

export const TEMPLATE_VERSION = 'forgehse-doc-templates-1';

export interface GenerateOptions {
  matrix: RiskMatrixConfig;
  /** Organisation name, used by policies when no name is entered. */
  organizationName?: string;
}

/* ---------------------------------------------------------------- small helpers */

const confirm = (what: string) => `[Confirm: ${what}]`;
const orConfirm = (v: string, what: string) => (v ? v : confirm(what));
const listOrConfirm = (xs: string[], what: string) => (xs.length ? xs : [confirm(what)]);
const strip = (s: string) => s.replace(/^(elimination|substitution|engineering|administrative|ppe)\s*:\s*/i, '');

function sec(key: string, heading: string, o: { text?: string | string[]; bullets?: string[]; table?: { columns: string[]; rows: string[][] } } = {}, origin: ContentOrigin = 'template'): DocSection {
  const text = Array.isArray(o.text) ? o.text.filter(Boolean).join('\n\n') : (o.text ?? '');
  return { key, heading, text, bullets: o.bullets ?? [], table: o.table ?? null, origin };
}

interface Ctx { t: DocTypeDef; i: DocInputs; o: GenerateOptions; topics: Topic[]; hz: string[] }

function v(c: Ctx, key: string) { return asText(c.i[key]); }
function l(c: Ctx, key: string) { return asList(c.i[key]); }

/** Topics for the selected hazards; if none were ticked, the best match for the activity text. */
function topicsFor(i: DocInputs, t: DocTypeDef): Topic[] {
  const sel = asList(i.hazards).map((k) => topicById(k)).filter((x): x is Topic => !!x);
  if (sel.length) return sel;
  if (t.family === 'policy' || t.family === 'record') return [];
  const text = [asText(i.title), asText(i.activity), asText(i.workPackage), asText(i.inspectionArea), asText(i.scope)].join(' ');
  const m = matchTopic(text);
  return m === GENERAL_TOPIC ? [GENERAL_TOPIC] : [m];
}

function particulars(c: Ctx): DocSection {
  const rows: string[][] = [
    ['Project', orConfirm(v(c, 'projectName'), 'project name')],
    ['Site / location', orConfirm(v(c, 'site'), 'site or location')],
  ];
  if (c.t.family !== 'learning') rows.push(['Client', v(c, 'client') || 'Not stated']);
  rows.push(['Country / region', [v(c, 'country'), v(c, 'emirate')].filter(Boolean).join(' — ') || 'Not stated']);
  if (v(c, 'workPackage')) rows.push(['Work package', v(c, 'workPackage')]);
  return sec('particulars', 'Project particulars', { table: { columns: ['Item', 'Detail'], rows } });
}

function requirements(c: Ctx): DocSection {
  const refs = asReferences(c.i.references);
  const text = [
    v(c, 'authority') ? `Requirements stated by the author: ${v(c, 'authority')}` : '',
    refs.length
      ? 'The references below were supplied by the author and are reproduced exactly as entered. The reviewer must confirm each is the current controlled version and applies to this work.'
      : 'No authority, client or standard references were supplied. Before approval, the reviewer must confirm the applicable legal, authority and client requirements from controlled sources. This document does not cite or interpret legislation.',
  ];
  return sec('requirements', 'Applicable requirements and references', {
    text,
    table: refs.length ? { columns: ['Source', 'Reference', 'Requirement'], rows: refs.map((r) => [r.source || 'Not stated', r.reference || 'Not stated', r.requirement || 'Not stated']) } : undefined,
  });
}

function ppeSection(c: Ctx): DocSection {
  const ppe = l(c, 'ppe');
  return sec('ppe', 'Personal protective equipment', {
    text: 'PPE is the last line of defence and is used together with the higher-order controls in this document.',
    bullets: listOrConfirm(ppe, 'task-specific PPE'),
  });
}

function emergencySection(c: Ctx): DocSection {
  const bullets = [
    'Every person is briefed on the alarm, the evacuation route and the assembly point before starting work.',
    'Emergency contact numbers are taken only from the verified project emergency contact list.',
  ];
  if (v(c, 'fallRescue')) bullets.push(`Fall rescue: ${v(c, 'fallRescue')}`);
  if (v(c, 'confinedRescue')) bullets.push(`Confined space standby and rescue: ${v(c, 'confinedRescue')}`);
  return sec('emergency', 'Emergency arrangements', { text: orConfirm(v(c, 'emergencyArrangements'), 'emergency arrangements, first aid, assembly point and nearest medical facility'), bullets });
}

function conditionsSection(c: Ctx): DocSection {
  const rows: string[][] = [
    ['Environmental and site conditions', v(c, 'environment') || 'Not stated'],
    ['Simultaneous operations and interfaces', v(c, 'simops') || 'Not stated'],
  ];
  if (c.t.family === 'activity') rows.push(['Energy sources and isolations', orConfirm(v(c, 'energySources'), 'energy sources present and how each is isolated')]);
  return sec('conditions', 'Site conditions, interfaces and energy sources', { table: { columns: ['Aspect', 'Detail'], rows } });
}

/** Activity-specific arrangements from the conditional questions. Only answered or required items appear. */
function hazardArrangements(c: Ctx): DocSection | null {
  const rows: string[][] = [];
  const add = (hz: string, label: string, key: string, required = false) => {
    if (!c.hz.includes(hz)) return;
    const val = v(c, key);
    if (val || required) rows.push([label, orConfirm(val, label.toLowerCase())]);
  };
  add('work_at_height', 'Maximum working height', 'workingHeight', true);
  add('work_at_height', 'Access equipment', 'accessEquipment');
  add('work_at_height', 'Fall rescue arrangements', 'fallRescue', true);
  add('scaffolding', 'Scaffold type and inspection regime', 'scaffoldType', true);
  add('lifting', 'Lift category', 'liftCategory', true);
  add('lifting', 'Crane / lifting equipment and rated capacity', 'craneDetails', true);
  add('lifting', 'Heaviest load and radius', 'heaviestLoad', true);
  add('lifting', 'Lifting plan reference', 'liftPlanRef', true);
  add('excavation', 'Excavation depth', 'excavationDepth', true);
  add('excavation', 'Underground services surveyed and marked', 'servicesSurveyed', true);
  add('excavation', 'Excavation support method', 'excavationSupport', true);
  add('confined_space', 'Confined space', 'confinedSpace', true);
  add('confined_space', 'Atmospheric testing', 'gasTesting', true);
  add('confined_space', 'Standby person and rescue', 'confinedRescue', true);
  add('electrical', 'Voltage / system', 'voltage', true);
  add('electrical', 'Isolation and LOTO method', 'isolationMethod', true);
  add('electrical', 'Work on or near live conductors', 'liveWork', true);
  if (c.hz.includes('electrical') && v(c, 'liveWork') === 'yes') rows.push(['Live work justification and authorisation', orConfirm(v(c, 'liveWorkJustification'), 'justification and authorisation for live work')]);
  add('hot_work', 'Fire watch', 'fireWatch', true);
  add('hot_work', 'Combustibles in the work area', 'combustibles');
  add('chemical', 'Hazardous substances', 'chemicals', true);
  add('chemical', 'Safety data sheets at the work area', 'sdsAvailable', true);
  add('traffic', 'Plant and vehicle movements', 'plantMovements', true);
  add('heat_stress', 'Heat stress work-rest and hydration', 'heatRegime', true);
  if (!rows.length) return null;
  return sec('arrangements', 'Activity-specific arrangements', { table: { columns: ['Arrangement', 'Detail'], rows } });
}

/** Permits that the selected hazards usually call for. Wording defers to the project permit procedure. */
function permitsFor(hz: string[]): string[] {
  const map: Record<string, string> = {
    work_at_height: 'Work-at-height permit', scaffolding: 'Scaffold handover / inspection tag before use', lifting: 'Lifting permit and approved lifting plan',
    excavation: 'Excavation permit with services clearance', confined_space: 'Confined space entry permit with gas test record',
    electrical: 'Electrical isolation permit and LOTO record', hot_work: 'Hot work permit', chemical: 'Chemical use approval (SDS reviewed)',
  };
  return hz.map((h) => map[h]).filter((x): x is string => !!x);
}

function keyControls(c: Ctx): string[] {
  const out: string[] = [];
  for (const t of c.topics) for (const k of t.keyControls) if (!out.includes(k)) out.push(k);
  return out.slice(0, 20);
}

/* ---------------------------------------------------------------- risk register */

function exposedText(c: Ctx) {
  return v(c, 'workforce') ? `Work crew (${v(c, 'workforce').slice(0, 120)}); others in or near the work area` : confirm('people and assets exposed');
}

function rowFrom(c: Ctx, id: string, step: string, hazard: { hazard: string; consequence: string; controls: string[] }): DocRiskRow {
  return {
    id, step, hazard: hazard.hazard, consequence: hazard.consequence, exposed: exposedText(c),
    existingControls: hazard.controls.slice(0, 8),
    initialLikelihood: null, initialSeverity: null,
    additionalControls: [], controlOwner: confirm('control owner'),
    residualLikelihood: null, residualSeverity: null,
    verification: 'Supervisor confirms the controls are in place before work starts and after any change; record on the permit or pre-task briefing.',
    origin: 'template',
  };
}

function riskRows(c: Ctx): DocRiskRow[] {
  const rows: DocRiskRow[] = [];
  const steps = l(c, 'sequence');
  const stepBased = steps.length > 0 && (c.t.key === 'jsa' || c.t.key === 'method_statement' || c.t.key === 'work_method_plan');
  if (stepBased) {
    steps.forEach((s, si) => {
      const hits = c.topics.filter((t) => new RegExp(t.keywords.source, 'i').test(s));
      if (!hits.length) {
        rows.push(rowFrom(c, `R${rows.length + 1}`, s, { hazard: confirm(`hazards for step ${si + 1}`), consequence: confirm('credible consequence'), controls: [] }));
        return;
      }
      for (const t of hits) rows.push(rowFrom(c, `R${rows.length + 1}`, s, t.hazards[0]!));
    });
  } else {
    for (const t of c.topics) for (const h of t.hazards) rows.push(rowFrom(c, `R${rows.length + 1}`, h.activity, h));
  }
  if (v(c, 'energySources') && !c.hz.includes('electrical')) {
    rows.push(rowFrom(c, `R${rows.length + 1}`, 'Isolating stored and live energy before work', { hazard: `Unexpected release of energy (${v(c, 'energySources').slice(0, 120)})`, consequence: 'Injury from contact with energy source', controls: ['Engineering: isolate, lock and tag every energy source listed', 'Administrative: prove zero energy before work and record the isolation'] }));
  }
  return rows.slice(0, 80);
}

/* ---------------------------------------------------------------- shared closing blocks */

function reviewRequirements(c: Ctx): string[] {
  const out = [c.t.qualifiedReview];
  if (c.hz.includes('confined_space')) out.push('Confined space entry is included: the entry procedure, gas testing and rescue arrangements require review by an authorised person.');
  if (c.hz.includes('electrical') && v(c, 'liveWork') === 'yes') out.push('Work on or near live conductors is included: it must be justified and authorised under the project electrical safety rules before approval.');
  if (c.hz.includes('lifting') && /critical|complex/i.test(v(c, 'liftCategory'))) out.push('A complex or critical lift is included: the lifting plan must be approved by the appointed person before work.');
  if (c.hz.includes('excavation') && v(c, 'servicesSurveyed') !== 'yes') out.push('Underground services are not confirmed as surveyed and marked: excavation must not start until they are.');
  return out;
}

function assumptions(c: Ctx): string[] {
  const out = [
    `Generated from the FORGEHSE template library (${TEMPLATE_VERSION}) using the answers in the input form. No AI model produced this text unless a section is labelled as a model suggestion.`,
    'Controls are general good-practice suggestions and must be checked against the actual method, equipment, competence and site conditions.',
    'Numeric limits, distances and frequencies are left as placeholders to be taken from the project procedures or the applicable requirement.',
    'No legal citations, authority approvals or certifications are implied. Only references entered by the author are listed.',
  ];
  if (c.t.riskRegister) out.push('Likelihood and severity ratings are left blank for the assessor. Residual risk is only lower than initial risk where additional controls and their verification are recorded.');
  return out;
}

function missing(c: Ctx): string[] {
  return missingRequired(c.t.key, c.i, 'submit').map((f) => `Missing input: ${f.label}`);
}

function responsibilities(rows: [string, string][]): DocSection {
  return sec('responsibilities', 'Roles and responsibilities', { table: { columns: ['Role', 'Responsibilities'], rows } });
}

const ACTIVITY_ROLES: [string, string][] = [
  ['Project / Construction Manager', 'Provides resources, approves the method and ensures this document is implemented.'],
  ['Site Engineer / Supervisor', 'Plans the work, briefs the crew, checks prerequisites and controls before and during work, and stops work if conditions change.'],
  ['HSE Engineer / Officer', 'Reviews the hazards and controls, monitors implementation and records findings.'],
  ['Permit Issuer / Area Authority', 'Issues and closes permits and confirms isolations where required.'],
  ['Workers', 'Follow the briefed method, use the controls and PPE provided, and stop and report unsafe conditions.'],
];

/* ---------------------------------------------------------------- per-type templates */

function activityCore(c: Ctx, purpose: string): DocSection[] {
  const s: DocSection[] = [
    sec('purpose', 'Purpose and scope', { text: [purpose, orConfirm(v(c, 'scope'), 'scope, work boundaries and exclusions')] }),
    particulars(c),
    sec('activity', 'Work activity', { text: orConfirm(v(c, 'activity'), 'description of the work activity') }),
  ];
  return s;
}

function resourcesSection(c: Ctx): DocSection {
  const rows: string[][] = [
    ['Plant, tools and equipment', l(c, 'equipment').join('\n') || confirm('plant, tools and equipment')],
    ['Materials and chemicals', l(c, 'materials').join('\n') || 'Not stated'],
    ['Workforce', v(c, 'workforce') || confirm('workforce roles and numbers')],
    ['Competency and training', l(c, 'competency').join('\n') || confirm('competency and training required')],
  ];
  return sec('resources', 'Resources and competency', { table: { columns: ['Resource', 'Detail'], rows } });
}

function matrixSection(c: Ctx): DocSection {
  return sec('matrix', 'Risk rating convention', { bullets: describeMatrix(c.o.matrix) });
}

function reviewSection(): DocSection {
  return sec('review', 'Monitoring and review', {
    bullets: [
      'Review this document before work starts, whenever the scope, method, equipment, people or conditions change, and after any incident or near miss related to the work.',
      'Changes are made as a new revision and re-approved before use.',
    ],
  });
}

function riskAssessment(c: Ctx): DocSection[] {
  const s = activityCore(c, 'This risk assessment identifies the hazards of the work activity, the people and assets exposed, and the controls needed to reduce risk to an acceptable level under the organisation\'s risk criteria.');
  s.push(resourcesSection(c), conditionsSection(c));
  const arr = hazardArrangements(c); if (arr) s.push(arr);
  s.push(matrixSection(c));
  s.push(sec('register', 'Risk register', { text: 'The risk register follows this section. Each row records the task step, hazard, consequence, exposure, controls, owner and verification, with initial and residual ratings on the matrix above.' }));
  s.push(ppeSection(c), emergencySection(c), requirements(c), reviewSection());
  return s;
}

function jsa(c: Ctx): DocSection[] {
  const s: DocSection[] = [
    sec('job', 'Job details', { table: { columns: ['Item', 'Detail'], rows: [
      ['Job / task', orConfirm(v(c, 'activity'), 'job or task')], ['Location', orConfirm(v(c, 'site'), 'location')],
      ['Equipment', l(c, 'equipment').join(', ') || confirm('equipment')], ['Permits required', permitsFor(c.hz).join('; ') || 'None identified — confirm with the permit issuer'],
    ] } }),
    sec('steps', 'Job steps', { bullets: listOrConfirm(l(c, 'sequence'), 'job steps in order') }),
    matrixSection(c),
    sec('register', 'Step-by-step hazard analysis', { text: 'The analysis table follows. Each job step lists its hazards, controls and owner.' }),
    ppeSection(c),
    sec('stopwork', 'Stop-work authority', { bullets: ['Anyone may stop the job if a control is missing, conditions change or they are unsure. Work restarts only after the supervisor has made it safe and re-briefed the crew.'] }),
    emergencySection(c),
    sec('briefing', 'Crew briefing record', { text: 'Each crew member signs to confirm the JSA was explained and understood.', table: { columns: ['Name', 'Company', 'Signature', 'Date'], rows: Array.from({ length: 8 }, () => ['', '', '', '']) } }),
  ];
  return s;
}

function holdPoints(c: Ctx): string[][] {
  const rows: string[][] = [['Before work starts', 'Supervisor', 'Permits issued, crew briefed, equipment inspected, area set up']];
  if (c.hz.includes('electrical')) rows.push(['Before electrical work', 'Permit issuer / authorised person', 'Isolation applied, locked, tagged and proved dead']);
  if (c.hz.includes('confined_space')) rows.push(['Before entry', 'Entry supervisor', 'Gas test results recorded; standby and rescue in place']);
  if (c.hz.includes('lifting')) rows.push(['Before each lift', 'Lifting supervisor / appointed person', 'Lifting plan briefed; equipment certified; exclusion zone set']);
  if (c.hz.includes('excavation')) rows.push(['Before digging', 'Site engineer', 'Services located and marked; support method in place']);
  if (c.hz.includes('hot_work')) rows.push(['Before hot work', 'Permit issuer', 'Combustibles removed or protected; fire watch and extinguisher in place']);
  if (c.hz.includes('work_at_height') || c.hz.includes('scaffolding')) rows.push(['Before access at height', 'Supervisor / scaffold inspector', 'Edge protection or scaffold inspected and tagged; rescue plan briefed']);
  rows.push(['On completion', 'Supervisor', 'Work inspected against acceptance criteria; permits closed; area handed back']);
  return rows;
}

function sequenceWithHolds(c: Ctx): string[] {
  const steps = l(c, 'sequence');
  if (!steps.length) return [confirm('sequence of work, one step per line')];
  return ['HOLD POINT — confirm prerequisites, permits and briefing before starting.', ...steps, 'HOLD POINT — inspect completed work and close permits.'];
}

function methodStatement(c: Ctx): DocSection[] {
  const s = activityCore(c, 'This method statement describes how the work will be carried out safely, the resources and permits needed, the hold points and the acceptance criteria.');
  s.push(responsibilities(ACTIVITY_ROLES));
  s.push(sec('prerequisites', 'Prerequisites', { bullets: [
    'Approved drawings, specifications and this method statement are available at the work area.',
    'The crew has completed site induction and holds the competencies listed below.',
    'Plant and lifting equipment have valid inspection or certification records.',
    'Permits listed in this document are issued before the related work starts.',
    ...l(c, 'competency').map((x) => `Competency: ${x}`),
  ] }));
  s.push(resourcesSection(c));
  s.push(sec('permits', 'Permits and authorisations', { text: 'Permits are issued under the project permit-to-work procedure. The list below is based on the selected hazards and must be confirmed with the permit issuer.', bullets: permitsFor(c.hz).length ? permitsFor(c.hz) : ['No permit identified from the selected hazards — confirm with the permit issuer.'] }));
  s.push(sec('isolation', 'Isolation requirements', { text: orConfirm(v(c, 'energySources') || v(c, 'isolationMethod'), 'energy sources and isolation method, or state that none apply') }));
  s.push(conditionsSection(c));
  const arr = hazardArrangements(c); if (arr) s.push(arr);
  s.push(sec('sequence', 'Sequence of work', { bullets: sequenceWithHolds(c) }));
  s.push(sec('holdpoints', 'Hold points', { table: { columns: ['Hold point', 'Released by', 'Verified'], rows: holdPoints(c) } }));
  s.push(sec('controls', 'Safety controls', { bullets: keyControls(c) }));
  s.push(sec('environment', 'Environmental controls', { bullets: [...(topicById('environmental')?.keyControls ?? []).slice(0, 4), ...(l(c, 'materials').length ? ['Store and handle the listed materials per their safety data sheets, with spill kits available.'] : [])] }));
  s.push(emergencySection(c));
  s.push(sec('inspections', 'Inspections and acceptance criteria', { table: { columns: ['Inspection', 'Frequency', 'By', 'Acceptance criteria'], rows: [
    ['Work area and controls', 'Before each shift', 'Supervisor', 'Controls in this document in place'],
    ['Plant and equipment', 'Before use', 'Operator / competent person', 'Pre-use checks passed; certificates valid'],
    ['Completed work', 'On completion', 'Site engineer / QA', confirm('technical acceptance criteria from the specification')],
  ] } }));
  s.push(matrixSection(c));
  s.push(sec('register', 'Risk assessment', { text: 'The risk register for this method follows.' }));
  s.push(ppeSection(c), requirements(c), reviewSection());
  return s;
}

function workMethodPlan(c: Ctx): DocSection[] {
  const s = activityCore(c, 'This work method plan sets out how the work package will be planned and executed: sequence, interfaces, resources, controls and verification.');
  s.push(responsibilities(ACTIVITY_ROLES.slice(0, 4)));
  s.push(resourcesSection(c));
  s.push(conditionsSection(c));
  const arr = hazardArrangements(c); if (arr) s.push(arr);
  s.push(sec('sequence', 'Work sequence and hold points', { bullets: sequenceWithHolds(c) }));
  s.push(sec('interfaces', 'Interfaces and coordination', { bullets: [
    'Coordinate with other contractors and the area authority at the daily coordination meeting.',
    v(c, 'simops') ? `SIMOPS: ${v(c, 'simops')}` : 'No simultaneous operations stated — confirm with the area authority.',
  ] }));
  s.push(sec('permits', 'Permits and approvals', { bullets: permitsFor(c.hz).length ? permitsFor(c.hz) : ['Confirm permit requirements with the permit issuer.'] }));
  s.push(sec('controls', 'Key controls', { bullets: keyControls(c) }));
  s.push(matrixSection(c));
  s.push(sec('register', 'Risk register', { text: 'The risk register for this work package follows.' }));
  s.push(ppeSection(c), emergencySection(c), requirements(c), reviewSection());
  return s;
}

function safeWorkProcedure(c: Ctx): DocSection[] {
  const checks = c.topics.flatMap((t) => t.checks.flatMap((g) => g.items.filter((it) => it.critical).map((it) => it.text))).slice(0, 15);
  const flow = c.topics.flatMap((t) => t.flow.map((f) => (f.startsWith('?') ? `Check: ${f.slice(1).split('|')[0]} If not, ${(f.split('|')[1] ?? '').toLowerCase()} before continuing.` : f)));
  return [
    sec('purpose', 'Purpose and scope', { text: [`This procedure sets the standard steps and controls for: ${orConfirm(v(c, 'activity'), 'the task')}.`, v(c, 'scope')] }),
    responsibilities(ACTIVITY_ROLES.slice(1)),
    sec('prestart', 'Pre-start checks (stop if any answer is No)', { bullets: checks.length ? checks : [confirm('critical pre-start checks')] }),
    sec('steps', 'Procedure', { bullets: l(c, 'sequence').length ? l(c, 'sequence') : flow.length ? flow : [confirm('procedure steps')] }),
    sec('controls', 'Controls', { bullets: keyControls(c) }),
    sec('stopwork', 'Stop-work conditions', { bullets: ['A required permit, isolation or inspection is missing or expired.', 'Weather or site conditions change beyond what was planned.', 'Equipment is damaged or behaves unexpectedly.', 'Anyone is unsure how to proceed safely.'] }),
    ppeSection(c), emergencySection(c),
    sec('records', 'Records', { bullets: ['Permits and isolation records', 'Pre-use inspection records', 'Briefing attendance'] }),
    requirements(c),
  ];
}

function projectHsePlan(c: Ctx): DocSection[] {
  const org = l(c, 'organisation');
  return [
    sec('purpose', 'Purpose and scope', { text: [`This plan describes how health, safety and environment will be managed on ${orConfirm(v(c, 'projectName'), 'project name')}.`, orConfirm(v(c, 'scope'), 'project scope and boundaries')] }),
    particulars(c),
    sec('description', 'Project description', { text: v(c, 'projectDuration') ? `Duration / key dates: ${v(c, 'projectDuration')}` : '', bullets: listOrConfirm(l(c, 'keyActivities'), 'key construction activities') }),
    sec('objectives', 'HSE policy and objectives', { text: 'Work is carried out under the organisation\'s HSE policy. Project HSE objectives and targets are agreed with the client and reviewed at the monthly HSE meeting.', bullets: [confirm('project HSE objectives and measurable targets')] }),
    sec('organisation', 'HSE organisation and responsibilities', { table: { columns: ['Role — name'], rows: listOrConfirm(org, 'project HSE organisation').map((x) => [x]) } }),
    requirements(c),
    sec('risk', 'Hazard identification and risk management', { bullets: [
      'Each significant activity has a risk assessment and method statement approved before work starts.',
      'Daily task briefings and JSAs cover changing site conditions.',
      ...l(c, 'keyActivities').map((a) => `Risk assessment and method statement required for: ${a}`),
    ] }),
    sec('ptw', 'Permit to work', { text: 'High-risk work is controlled under the project permit-to-work procedure with defined issuers, isolations and close-out.', bullets: permitsFor(c.hz) }),
    sec('training', 'Induction, training and competency', { bullets: ['Site induction for every person before starting work.', 'Task-specific training and competency records maintained in the training matrix.', 'Toolbox talks at a frequency set by the project procedure.', ...l(c, 'competency')] }),
    sec('subcontractors', 'Subcontractor management', { bullets: ['HSE prequalification before award.', 'Subcontractor RAMS reviewed and approved before mobilisation.', 'Subcontractor performance reviewed at the HSE meeting.'] }),
    sec('inspections', 'Inspections and audits', { table: { columns: ['Activity', 'Frequency', 'Responsible'], rows: [
      ['Site HSE inspection', confirm('frequency'), 'HSE Officer'], ['Management walk-through', confirm('frequency'), 'Project Manager'],
      ['Plant and equipment inspection', 'Before use and per certification', 'Operators / competent person'], ['Internal HSE audit', confirm('frequency'), 'HSE Manager'],
    ] } }),
    sec('incidents', 'Incident reporting and investigation', { bullets: ['All incidents and near misses are reported immediately to the supervisor and HSE.', 'Investigations identify causes and corrective actions, which are tracked to verified closure.', 'Notification to the client and authorities follows the contract and applicable requirements, which the project must confirm.'] }),
    sec('emergency', 'Emergency preparedness', { text: 'Emergencies are managed under the project Emergency Response Plan, with drills at a frequency set by the project procedure.', bullets: v(c, 'assemblyPoint') ? [`Assembly point: ${v(c, 'assemblyPoint')}`] : [] }),
    sec('welfare', 'Health and welfare', { bullets: ['Drinking water, shade, rest areas, toilets and first aid provided for the peak workforce.', v(c, 'heatRegime') ? `Heat stress: ${v(c, 'heatRegime')}` : `Heat stress arrangements: ${confirm('work-rest and hydration regime from the project procedure')}`] }),
    sec('environment', 'Environmental management', { bullets: (topicById('environmental')?.keyControls ?? []).slice(0, 5) }),
    sec('communication', 'Communication and consultation', { bullets: ['HSE meetings, toolbox talks and notice boards.', 'Workers can raise concerns without reprisal and take part in hazard identification.'] }),
    sec('kpi', 'Monitoring, KPIs and reporting', { text: 'KPIs are calculated only from recorded data with stated definitions. Leading indicators (for example inspections completed and actions closed on time) and lagging indicators (for example recordable injuries) are reported monthly. Frequency rates use exposure hours from verified man-hour records.', bullets: [confirm('client reporting requirements and KPI definitions')] }),
    sec('records', 'Document control and records', { bullets: ['HSE documents are controlled with revision and approval records.', 'Records are retained for the period required by the contract and applicable requirements.'] }),
    reviewSection(),
  ];
}

const SCENARIO_STEPS: Record<string, string[]> = {
  fire: ['Raise the alarm and shout a warning.', 'Stop work and make equipment safe only if it is safe to do so.', 'Evacuate by the nearest safe route to the assembly point.', 'Emergency coordinator calls emergency services using the verified contact list.', 'Fire wardens sweep their areas and report to the coordinator.', 'Nobody re-enters until the coordinator authorises it.'],
  medical: ['Make the area safe; do not put yourself at risk.', 'Call the site first aider and the emergency coordinator.', 'Give first aid within your training until help arrives.', 'Coordinator calls emergency services and arranges a guide at the gate.', 'Preserve the scene for investigation once the casualty is cared for.'],
  fall_rescue: ['Raise the alarm; keep talking to the suspended person.', 'Start the pre-planned rescue immediately with the trained rescue team and staged equipment.', 'Call emergency services in parallel.', 'After rescue, keep the casualty under medical observation as advised by the first aider.'],
  confined_space_rescue: ['Standby person raises the alarm and does not enter.', 'Rescue team performs the planned rescue using the staged equipment.', 'Call emergency services.', 'Account for all entrants using the entry log.'],
  chemical_release: ['Move people upwind and away from the release.', 'Raise the alarm and isolate the source only if trained and safe.', 'Contain the spill with spill kits; prevent entry to drains.', 'Consult the safety data sheet for first aid and disposal.', 'Report to HSE; record and dispose of waste via an approved route.'],
  heat_illness: ['Move the person to shade or a cooled area and stop work.', 'Call the first aider; start cooling and give water if conscious.', 'Call emergency services for confusion, collapse or no improvement.', 'Review the work-rest regime for the crew.'],
  structural_collapse: ['Raise the alarm and clear the area.', 'Do not attempt rescue inside an unstable structure or excavation.', 'Call emergency services and account for all personnel.', 'Isolate services in the area if safe to do so.'],
  utility_strike: ['Stop work and move everyone to a safe distance.', 'Do not touch damaged cables or pipes.', 'Notify the utility owner and the emergency coordinator.', 'Keep the area barricaded until the utility owner makes it safe.'],
  severe_weather: ['Monitor weather warnings at the start of each shift.', 'Suspend lifting and work at height when the project procedure limits are reached.', 'Secure loose materials and move people to shelter.', 'Inspect the site before work resumes.'],
};

function emergencyResponsePlan(c: Ctx): DocSection[] {
  const contacts = asContacts(c.i.contacts);
  const scen = l(c, 'scenarios');
  const s: DocSection[] = [
    sec('purpose', 'Purpose and scope', { text: [`This plan sets out how the project will respond to emergencies at ${orConfirm(v(c, 'site'), 'site')}.`, v(c, 'scope'), 'Response steps are a site framework. They must be agreed with the emergency services where required and verified during drills.'] }),
    particulars(c),
    sec('organisation', 'Emergency organisation and roles', { table: { columns: ['Role', 'Duties'], rows: [
      ['Emergency coordinator', 'Takes charge, calls emergency services, coordinates the response and authorises re-entry.'],
      ['Fire wardens / marshals', 'Sweep areas, guide people to the assembly point and report head counts.'],
      ['First aiders', 'Provide first aid within their training.'],
      ['Gate / security', 'Controls access and guides emergency services to the scene.'],
      ...l(c, 'organisation').map((x) => [x, 'As assigned by the emergency coordinator']),
    ] } }),
    sec('contacts', 'Emergency contacts', { text: 'Only contacts entered and verified by the project are listed. Check every number during each drill.', table: { columns: ['Role', 'Name', 'Number'], rows: contacts.length ? contacts.map((x) => [x.role, x.name, x.phone]) : [[confirm('verified emergency contacts'), '', '']] } }),
    sec('alarm', 'Alarm, communication and muster', { bullets: ['Alarm method and sound are briefed at induction.', `Assembly point: ${orConfirm(v(c, 'assemblyPoint'), 'assembly point location')}`, 'Head count against the site attendance record at the assembly point.'] }),
  ];
  const chosen = scen.length ? scen : [];
  if (!chosen.length) s.push(sec('scenarios', 'Scenario responses', { bullets: [confirm('emergency scenarios for this site')] }));
  for (const k of chosen) {
    const label = ERP_SCENARIOS.find((x) => x.key === k)?.label ?? k;
    s.push(sec(`scenario-${k}`.replace(/_/g, '-').slice(0, 40), `Scenario: ${label}`, { bullets: SCENARIO_STEPS[k] ?? [confirm(`response for ${label}`)] }));
  }
  if (v(c, 'fallRescue') || v(c, 'confinedRescue')) s.push(sec('rescue', 'Rescue arrangements', { bullets: [v(c, 'fallRescue') && `Fall rescue: ${v(c, 'fallRescue')}`, v(c, 'confinedRescue') && `Confined space rescue: ${v(c, 'confinedRescue')}`].filter((x): x is string => !!x) }));
  s.push(
    sec('equipment', 'Emergency equipment', { bullets: ['Fire extinguishers, first aid kits, spill kits, stretcher and rescue equipment located and inspected at a frequency set by the project procedure.', confirm('locations of emergency equipment')] }),
    sec('drills', 'Drills and training', { bullets: ['Emergency drills are scheduled, observed and recorded with lessons learned.', 'Actions from drills are tracked to verified closure.', `Drill frequency: ${confirm('drill frequency per project procedure')}`] }),
    sec('after', 'After an emergency', { bullets: ['Report and investigate the event.', 'Replace used equipment and review this plan.'] }),
    requirements(c), reviewSection(),
  );
  return s;
}

function logisticsPlan(c: Ctx): DocSection[] {
  return [
    sec('purpose', 'Purpose and scope', { text: ['This plan controls deliveries, storage, laydown and material movement so they do not create hazards or disrupt the work.', orConfirm(v(c, 'scope'), 'scope and boundaries')] }),
    particulars(c),
    sec('access', 'Site access, gates and routes', { text: orConfirm(v(c, 'routes'), 'site access, gates and delivery routes') }),
    sec('deliveries', 'Delivery scheduling', { bullets: [`Working and delivery hours: ${orConfirm(v(c, 'deliveryHours'), 'working and delivery hours')}`, 'Deliveries are booked in advance; drivers report to the gate and are escorted to the unloading area.', 'Vehicles are unloaded only in designated, segregated areas.'] }),
    sec('storage', 'Storage and laydown', { text: orConfirm(v(c, 'storageAreas'), 'storage and laydown areas'), bullets: ['Materials stacked stable and within height limits set by the project procedure.', 'Hazardous materials stored per their safety data sheets with secondary containment.'] }),
    sec('handling', 'Material handling', { bullets: [...(c.hz.includes('lifting') ? ['Lifting of materials follows the approved lifting plan.'] : []), 'Mechanical aids used where practicable to avoid manual handling.', ...l(c, 'equipment').map((x) => `Equipment: ${x}`)] }),
    sec('traffic', 'Traffic interface', { text: 'Vehicle and pedestrian movements follow the Traffic Management Plan.', bullets: v(c, 'simops') ? [`Interfaces: ${v(c, 'simops')}`] : [] }),
    sec('waste', 'Waste and housekeeping', { bullets: ['Packaging and waste segregated and removed regularly.', 'Access routes kept clear.'] }),
    responsibilities([['Logistics coordinator', 'Plans and books deliveries and manages laydown.'], ['Gate / security', 'Controls entry and escorts vehicles.'], ['Supervisor', 'Controls unloading and handling in the work area.'], ['HSE', 'Monitors compliance with this plan.']]),
    requirements(c), reviewSection(),
  ];
}

function trafficManagementPlan(c: Ctx): DocSection[] {
  return [
    sec('purpose', 'Purpose and scope', { text: ['This plan separates people from vehicles and mobile plant and controls traffic on and around the site.', orConfirm(v(c, 'scope'), 'scope and boundaries'), 'Any approval needed from a road owner or authority is obtained separately; this plan does not imply it.'] }),
    particulars(c),
    sec('routes', 'Vehicle routes, gates and parking', { text: orConfirm(v(c, 'routes'), 'vehicle routes, gates and parking') }),
    sec('pedestrians', 'Pedestrian routes and crossings', { text: orConfirm(v(c, 'pedestrianRoutes'), 'pedestrian routes and crossings') }),
    sec('controls', 'Traffic controls', { bullets: [`Site speed limit: ${confirm('site speed limit')}`, 'One-way systems where practicable to minimise reversing.', 'Trained banksmen for reversing and restricted visibility.', 'Exclusion zones around operating plant.', 'Signage, barriers and lighting maintained and inspected.', ...(topicById('traffic')?.keyControls ?? []).slice(0, 4)] }),
    sec('hours', 'Working hours and deliveries', { text: v(c, 'deliveryHours') || 'Not stated' }),
    sec('operators', 'Operator and driver competence', { bullets: ['Only trained and authorised operators drive plant.', 'Daily pre-use checks recorded.'] }),
    sec('emergency', 'Emergency vehicle access', { bullets: ['Emergency access routes kept clear at all times.'] }),
    sec('inspections', 'Inspections', { table: { columns: ['Item', 'Frequency', 'By'], rows: [['Routes, barriers and signage', confirm('frequency'), 'Traffic marshal / HSE'], ['Plant pre-use checks', 'Daily', 'Operator']] } }),
    requirements(c), reviewSection(),
  ];
}

function policy(c: Ctx, qhse: boolean): DocSection[] {
  const org = v(c, 'organisationName') || c.o.organizationName || confirm('organisation name');
  const commitments = [
    'Provide safe and healthy working conditions to prevent work-related injury and ill health.',
    'Eliminate hazards and reduce risks using the hierarchy of controls.',
    'Fulfil the legal requirements and other requirements that apply to our activities.',
    'Consult workers and encourage their participation in HSE decisions; everyone has the authority to stop unsafe work.',
    'Protect the environment, prevent pollution and use resources responsibly.',
    'Set measurable objectives, monitor performance and continually improve our management system.',
    'Require our subcontractors and suppliers to meet the same standards.',
  ];
  if (qhse) commitments.splice(0, 0, 'Deliver work that meets customer and specified requirements, right first time.');
  return [
    sec('statement', qhse ? 'Quality, Health, Safety and Environment Policy' : 'Health, Safety and Environment Policy', {
      text: [`${org} is committed to conducting its activities in a way that protects people, the environment${qhse ? ' and the quality of what we deliver' : ''}.`, `Scope: ${orConfirm(v(c, 'policyScope'), 'activities and locations covered')}`],
    }),
    sec('commitments', 'Our commitments', { bullets: commitments }),
    sec('responsibilities', 'Responsibilities', { bullets: ['Top management is accountable for this policy and provides the resources to implement it.', 'Managers and supervisors put it into practice in their areas.', 'Every worker follows safe systems of work and reports hazards and incidents.'] }),
    sec('communication', 'Communication and review', { bullets: ['This policy is communicated to all workers and made available to interested parties.', `It is reviewed ${(v(c, 'reviewFrequency') || 'annually').toLowerCase()} and when significant changes occur.`] }),
    sec('signature', 'Authorisation', { text: 'This policy takes effect when signed by the accountable executive.', table: { columns: ['Role', 'Name', 'Signature', 'Date'], rows: [[orConfirm(v(c, 'signatoryRole'), 'accountable signatory role'), '', '', '']] } }),
  ];
}

const ASPECT_CONTROLS: [RegExp, string, string][] = [
  [/dust|air|emission|exhaust/i, 'Air quality / dust', 'Water suppression on haul roads and stockpiles; cover loads; maintain engines; stop dusty work in high wind.'],
  [/noise|vibration/i, 'Noise and vibration', 'Low-noise equipment, maintained silencers, restricted working hours near sensitive receptors.'],
  [/waste|debris|packag/i, 'Waste', 'Segregate at source; licensed carriers; waste transfer records kept.'],
  [/water|wastewater|runoff|drain|dewater/i, 'Water and wastewater', 'Protect drains; settle and test before discharge per the permit; no discharge to land without approval.'],
  [/fuel|oil|diesel|chemical|spill/i, 'Fuel and chemicals', 'Bunded storage; drip trays; spill kits; trained refuellers.'],
  [/ecolog|habitat|wildlife|tree|marine|mangrove/i, 'Ecology', 'Fence protected areas; follow any ecological survey recommendations.'],
  [/light/i, 'Light', 'Direct lighting into the work area and away from sensitive receptors.'],
];

function environmentalPlan(c: Ctx): DocSection[] {
  const aspects = l(c, 'aspects');
  const rows = (aspects.length ? aspects : [confirm('environmental aspects')]).map((a) => {
    const hit = ASPECT_CONTROLS.find(([re]) => re.test(a));
    return [a, hit ? hit[1] : 'To be assessed', hit ? hit[2] : confirm(`controls for ${a}`)];
  });
  return [
    sec('purpose', 'Purpose and scope', { text: ['This plan identifies the environmental aspects of the work and the controls, monitoring and responsibilities to manage them.', orConfirm(v(c, 'scope'), 'scope and boundaries')] }),
    particulars(c),
    sec('activities', 'Activities covered', { bullets: listOrConfirm(l(c, 'keyActivities'), 'activities covered') }),
    sec('aspects', 'Environmental aspects and controls', { table: { columns: ['Aspect', 'Category', 'Controls'], rows } }),
    sec('permits', 'Environmental permits and conditions', { text: `${confirm('environmental permits, approvals and conditions held for the project')} Monitoring limits are taken only from these documents.` }),
    sec('waste', 'Waste management', { bullets: listOrConfirm(l(c, 'wasteStreams'), 'waste streams and disposal routes') }),
    sec('monitoring', 'Monitoring', { text: 'Only monitoring required by a permit, authority or the client is listed. Results are recorded and exceedances reported and investigated.', bullets: l(c, 'monitoring').length ? l(c, 'monitoring') : ['No monitoring requirement entered.'] }),
    sec('spill', 'Spill and environmental incident response', { bullets: SCENARIO_STEPS.chemical_release! }),
    sec('training', 'Training and awareness', { bullets: ['Environmental content in site induction.', 'Toolbox talks on waste, spills and dust.'] }),
    responsibilities([['Project Manager', 'Resources and accountability for this plan.'], ['Environmental / HSE lead', 'Monitoring, inspections, reporting and permit compliance.'], ['Supervisors', 'Implement controls in their areas.'], ['All workers', 'Follow controls and report spills and incidents.']]),
    requirements(c), reviewSection(),
  ];
}

function inspectionChecklist(c: Ctx): DocSection[] {
  const s: DocSection[] = [
    sec('header', 'Inspection details', { table: { columns: ['Item', 'Detail'], rows: [
      ['Area / activity / equipment', orConfirm(v(c, 'inspectionArea'), 'area inspected')], ['Location', v(c, 'site') || 'Not stated'],
      ['Frequency', orConfirm(v(c, 'inspectionFrequency'), 'inspection frequency')], ['Inspector', ''], ['Date', ''],
    ] } }),
    sec('instructions', 'How to use this checklist', { bullets: ['Answer every item Yes, No or N/A and add comments for any No.', 'Items marked CRITICAL stop the work until corrected.', 'Raise an action for every No and record who will close it.'] }),
  ];
  let n = 0;
  const topics = c.topics.length ? c.topics : [GENERAL_TOPIC];
  const general = [topicById('housekeeping'), topicById('ppe')].filter((x): x is Topic => !!x && !topics.includes(x));
  for (const t of [...topics, ...general]) {
    for (const g of t.checks) {
      const rows = g.items.map((it) => [String(++n), `${it.critical ? 'CRITICAL — ' : ''}${it.text}${it.guidance ? ` (${it.guidance})` : ''}`, '', '', '', '']);
      s.push(sec(`chk-${t.id}-${g.heading}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40), `${t.label}: ${g.heading}`, { table: { columns: ['#', 'Check item', 'Yes', 'No', 'N/A', 'Comments'], rows } }));
    }
  }
  s.push(sec('signoff', 'Sign-off', { table: { columns: ['Role', 'Name', 'Signature', 'Date'], rows: [['Inspected by', '', '', ''], ['Reviewed by', '', '', '']] } }));
  return s;
}

function toolboxTalk(c: Ctx): DocSection[] {
  const topics = c.topics.length ? c.topics : [GENERAL_TOPIC];
  const hazards = topics.flatMap((t) => t.hazards.map((h) => `${h.hazard} — ${h.consequence.toLowerCase()}`)).slice(0, 8);
  const questions = topics.flatMap((t) => t.hazards.slice(0, 2).map((h) => `What controls must be in place before: ${h.activity.toLowerCase()}?`));
  return [
    sec('details', 'Talk details', { table: { columns: ['Item', 'Detail'], rows: [['Topic', v(c, 'title')], ['Activity', orConfirm(v(c, 'activity'), 'activity this talk supports')], ['Audience', orConfirm(v(c, 'audience'), 'audience')], ['Duration', v(c, 'duration') || '10–15 minutes'], ['Presenter', ''], ['Date / location', '']] } }),
    sec('why', 'Why this matters', { text: `This talk covers ${topics.map((t) => t.label.toLowerCase()).join(', ')}. Talk through what could go wrong on this job today and how we stop it.` }),
    sec('hazards', 'Key hazards', { bullets: hazards }),
    sec('controls', 'What we do to stay safe', { bullets: keyControls(c).length ? keyControls(c) : GENERAL_TOPIC.keyControls }),
    sec('stopwork', 'Stop and ask', { bullets: ['If a control is missing or something changes, stop and tell your supervisor.'] }),
    sec('site', 'Site-specific points', { bullets: [confirm('points specific to this site, crew and task today')] }),
    sec('questions', 'Discussion questions', { bullets: questions.slice(0, 6) }),
    ppeSection(c),
    sec('attendance', 'Attendance', { table: { columns: ['Name', 'Company', 'Signature'], rows: Array.from({ length: 12 }, () => ['', '', '']) } }),
  ];
}

function trainingMaterial(c: Ctx): DocSection[] {
  const topics = c.topics.length ? c.topics : [GENERAL_TOPIC];
  const objectives = l(c, 'learningObjectives').length ? l(c, 'learningObjectives') : [
    ...topics.map((t) => `Recognise the main hazards of ${t.label.toLowerCase()}.`),
    'Apply the controls in the order of the hierarchy of controls.',
    'Know when and how to stop work and how to respond in an emergency.',
  ];
  const s: DocSection[] = [
    sec('overview', 'Course overview', { table: { columns: ['Item', 'Detail'], rows: [['Course', v(c, 'title')], ['Audience', orConfirm(v(c, 'audience'), 'audience')], ['Duration', orConfirm(v(c, 'duration'), 'duration')], ['Delivery', 'Classroom briefing with practical demonstration'], ['Assessment', 'Knowledge check and practical observation by a competent assessor']] } }),
    sec('objectives', 'Learning objectives', { bullets: objectives }),
  ];
  topics.forEach((t, i) => {
    s.push(sec(`module-${i + 1}`, `Module ${i + 1}: ${t.label}`, {
      text: 'Hazards and controls',
      bullets: [...t.hazards.map((h) => `${h.hazard}: ${h.controls.map(strip).slice(0, 3).join('; ')}`), ...t.keyControls.slice(0, 3)],
    }));
  });
  const qs = topics.flatMap((t) => t.hazards.slice(0, 2).map((h) => [`Name two controls for: ${h.hazard.toLowerCase()}.`, h.controls.slice(0, 3).map(strip).join(' / ')]));
  s.push(sec('quiz', 'Knowledge check', { text: 'Open questions with an answer guide for the assessor.', table: { columns: ['Question', 'Answer guide'], rows: qs.slice(0, 10) } }));
  s.push(sec('competence', 'Competence and certification', { bullets: ['Attendance alone does not demonstrate competence. A competent assessor confirms competence by assessment as defined in the training matrix.', 'This material does not confer accredited certification.'] }));
  s.push(sec('attendance', 'Attendance and assessment record', { table: { columns: ['Name', 'Employer', 'Knowledge check', 'Practical', 'Assessor'], rows: Array.from({ length: 10 }, () => ['', '', '', '', '']) } }));
  return s;
}

function auditReport(c: Ctx): DocSection[] {
  const findings = l(c, 'findings').map((line) => {
    const [grade = '', finding = '', evidence = ''] = line.split('|').map((x) => x.trim());
    return { grade: grade || 'Ungraded', finding: finding || line, evidence: evidence || confirm('objective evidence') };
  });
  const count = (g: RegExp) => findings.filter((f) => g.test(f.grade)).length;
  const summary = findings.length
    ? `The audit recorded ${findings.length} item(s): ${count(/^major/i)} major, ${count(/^minor/i)} minor, ${count(/^obs/i)} observation(s) and ${count(/good/i)} good practice. Counts are taken from the findings entered below.`
    : 'No findings have been entered yet.';
  return [
    sec('summary', 'Executive summary', { text: [summary, `Conclusion: ${confirm('audit conclusion agreed by the audit team')}`] }),
    particulars(c),
    sec('scope', 'Audit scope', { text: orConfirm(v(c, 'auditScope'), 'audit scope') }),
    sec('criteria', 'Audit criteria', { text: 'The audit compared what was observed with the criteria below, as supplied by the audit team.', bullets: listOrConfirm(l(c, 'auditCriteria'), 'audit criteria') }),
    sec('team', 'Audit team, dates and auditees', { table: { columns: ['Item', 'Detail'], rows: [['Date(s)', orConfirm(v(c, 'auditDate'), 'audit dates')], ['Audit team', l(c, 'auditTeam').join(', ') || confirm('audit team')], ['Auditees / areas', v(c, 'auditees') || 'Not stated']] } }),
    sec('method', 'Method', { text: confirm('audit methods used, for example interviews, document review and site observation') }),
    sec('findings', 'Findings', { table: { columns: ['#', 'Grade', 'Finding', 'Objective evidence', 'Action owner / due'], rows: findings.length ? findings.map((f, i) => [String(i + 1), f.grade, f.finding, f.evidence, confirm('owner and due date')]) : [['', '', confirm('findings with objective evidence'), '', '']] } }),
    sec('followup', 'Follow-up', { bullets: ['Each major and minor finding is raised as a corrective action with an owner and due date.', 'Closure requires evidence and verification by an authorised person.'] }),
    requirements(c),
  ];
}

function incidentReport(c: Ctx): DocSection[] {
  const desc = v(c, 'eventDescription');
  const topic = matchTopic(`${desc} ${v(c, 'activity')}`);
  const whys = l(c, 'whys');
  const whyRows = whys.length
    ? whys.map((w, i) => [`Why ${i + 1}`, w, 'Entered by the investigation team'])
    : Array.from({ length: 5 }, (_, i) => [`Why ${i + 1}`, confirm('answer supported by evidence, verified by the investigation team'), '']);
  return [
    sec('summary', 'Summary of the event', { text: orConfirm(desc, 'factual description of the event'), bullets: ['This report records facts and the investigation. It does not assign blame.'] }),
    sec('details', 'Event details', { table: { columns: ['Item', 'Detail'], rows: [
      ['Date / time', `${orConfirm(v(c, 'eventDate'), 'date')} ${v(c, 'eventTime')}`.trim()], ['Location', orConfirm(v(c, 'eventLocation'), 'exact location')],
      ['Project / site', [v(c, 'projectName'), v(c, 'site')].filter(Boolean).join(' — ') || confirm('project and site')],
      ['Category', orConfirm(v(c, 'eventType'), 'event category')], ['Actual severity', v(c, 'actualSeverity') || 'Not stated'], ['Potential severity', orConfirm(v(c, 'potentialSeverity'), 'potential severity')],
    ] } }),
    sec('response', 'Immediate response', { text: orConfirm(v(c, 'immediateActions'), 'immediate response and actions taken') }),
    sec('impacts', 'People, assets and environmental impacts', { text: v(c, 'impacts') || 'Not stated', bullets: ['Personal and medical details are held in the restricted incident record, not in this report.'] }),
    sec('team', 'Investigation team', { bullets: listOrConfirm(l(c, 'investigationTeam'), 'investigation team') }),
    sec('timeline', 'Sequence of events', { table: { columns: ['Time', 'Event', 'Source of information'], rows: [[confirm('timeline from statements and records'), '', '']] } }),
    sec('evidence', 'Evidence collected', { table: { columns: ['Evidence', 'Held by', 'Reference'], rows: [[confirm('photographs, statements, records and equipment'), '', '']] } }),
    sec('whys', 'Causal analysis — 5 Whys', { text: 'Each answer must be supported by evidence and verified by the investigation team before it is treated as a cause.', table: { columns: ['Question', 'Answer', 'Basis'], rows: whyRows } }),
    sec('factors', 'Possible contributing factors to examine (not findings)', { text: 'These are prompts for the investigation team from the topic library. They are not conclusions and must be confirmed or rejected with evidence.', bullets: topic.rootCauses }),
    sec('causes', 'Established causes', { table: { columns: ['Level', 'Cause', 'Verified by'], rows: [['Immediate', confirm('immediate cause verified by the team'), ''], ['Underlying', confirm('underlying cause verified by the team'), ''], ['Root', confirm('root cause verified by the team'), '']] } }),
    sec('actions', 'Corrective and preventive actions (proposed)', { text: 'Proposed from the topic library; confirm against the verified causes, then raise each in the corrective action register.', table: { columns: ['Action', 'Control level', 'Responsible role', 'Verification evidence'], rows: [...topic.corrective, ...topic.preventive].map((a) => [a.action, a.controlLevel, a.responsibleRole, a.verificationEvidence]) } }),
    sec('lessons', 'Lessons learned', { bullets: [confirm('lessons learned agreed by the investigation team')] }),
    sec('review', 'Management review', { table: { columns: ['Role', 'Name', 'Comments', 'Date'], rows: [['Project Manager', '', '', ''], ['HSE Manager', '', '', '']] } }),
  ];
}

function closeoutReport(c: Ctx): DocSection[] {
  const acts = l(c, 'outstandingActions').map((line) => { const [a = '', o = '', d = ''] = line.split('|').map((x) => x.trim()); return [a || line, o || confirm('owner'), d || confirm('due date')]; });
  return [
    sec('summary', 'Summary', { text: [`This report records the HSE status of ${orConfirm(v(c, 'projectName'), 'project')} at completion and handover to ${orConfirm(v(c, 'handoverTo'), 'receiving party')}.`, `Completion / handover date: ${orConfirm(v(c, 'completionDate'), 'completion date')}`] }),
    particulars(c),
    sec('scope', 'Scope completed', { text: orConfirm(v(c, 'scopeCompleted'), 'scope completed') }),
    sec('performance', 'HSE performance', { text: `${confirm('HSE statistics taken from verified project records (man-hours, incidents, inspections)')} No figures are generated by this document.` }),
    sec('actions', 'Outstanding actions', { table: { columns: ['Action', 'Owner', 'Due date'], rows: acts.length ? acts : [['None recorded', '', '']] } }),
    sec('risks', 'Residual risks handed over', { bullets: l(c, 'residualRisks').length ? l(c, 'residualRisks') : ['None recorded'] }),
    sec('records', 'Records handed over', { bullets: listOrConfirm(l(c, 'recordsHandedOver'), 'HSE records handed over') }),
    sec('environment', 'Environmental close-out', { bullets: [...(l(c, 'wasteStreams').length ? l(c, 'wasteStreams').map((w) => `Waste: ${w}`) : []), 'Temporary works, materials and waste removed; disturbed areas reinstated as agreed.'] }),
    sec('acceptance', 'Acceptance', { text: 'The receiving party accepts the outstanding actions and residual risks listed above.', table: { columns: ['Party', 'Name', 'Signature', 'Date'], rows: [['Handing over', '', '', ''], [orConfirm(v(c, 'handoverTo'), 'receiving party'), '', '', '']] } }),
  ];
}

/* ---------------------------------------------------------------- entry point */

export function generateDocument(typeKey: DocTypeKey, inputs: DocInputs, opts: GenerateOptions): DocContent {
  const t = docType(typeKey);
  const hz = asList(inputs.hazards).filter((h) => ACTIVITY_HAZARDS.some((a) => a.key === h));
  const c: Ctx = { t, i: inputs, o: opts, topics: topicsFor(inputs, t), hz };
  const sections = (() => {
    switch (typeKey) {
      case 'risk_assessment': return riskAssessment(c);
      case 'jsa': return jsa(c);
      case 'method_statement': return methodStatement(c);
      case 'work_method_plan': return workMethodPlan(c);
      case 'safe_work_procedure': return safeWorkProcedure(c);
      case 'project_hse_plan': return projectHsePlan(c);
      case 'emergency_response_plan': return emergencyResponsePlan(c);
      case 'logistics_plan': return logisticsPlan(c);
      case 'traffic_management_plan': return trafficManagementPlan(c);
      case 'hse_policy': return policy(c, false);
      case 'qhse_policy': return policy(c, true);
      case 'environmental_management_plan': return environmentalPlan(c);
      case 'inspection_checklist': return inspectionChecklist(c);
      case 'toolbox_talk': return toolboxTalk(c);
      case 'training_material': return trainingMaterial(c);
      case 'hse_audit_report': return auditReport(c);
      case 'incident_investigation_report': return incidentReport(c);
      case 'closeout_handover_report': return closeoutReport(c);
    }
  })();
  // Section keys must be unique for editing; de-duplicate deterministically.
  const seen = new Map<string, number>();
  for (const s of sections) {
    const n = seen.get(s.key) ?? 0;
    seen.set(s.key, n + 1);
    if (n) s.key = `${s.key.slice(0, 36)}-${n + 1}`;
  }
  return {
    schemaVersion: 1,
    sections,
    riskRows: t.riskRegister ? riskRows(c) : [],
    references: asReferences(inputs.references),
    assumptions: assumptions(c),
    missingInputs: missing(c),
    reviewRequirements: reviewRequirements(c),
  };
}

/** All topics referenced by the studio, exported for the UI hazard picker hints. */
export const DOCUMENT_TOPICS = TOPICS;
