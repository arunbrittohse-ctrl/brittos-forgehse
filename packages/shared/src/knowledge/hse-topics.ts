/**
 * FORGEHSE local rules engine — curated HSE topic library.
 *
 * General good-practice content for common construction / EPC / industrial activities. It is
 * deliberately generic: no legal clause numbers, no statutory limits, no compliance claims.
 * Wherever a number matters the text says "[confirm limit per project procedure]" so the HSE
 * engineer verifies it against the project's approved procedures and applicable regulations.
 */
import type { PosterIcon, PosterTheme } from '../studio';

export interface TopicHazard {
  activity: string; hazard: string; consequence: string;
  l: number; s: number; controls: string[]; rl: number; rs: number;
}
export interface TopicCheck { heading: string; items: { text: string; critical?: boolean; guidance?: string }[] }
export interface TopicCapa { action: string; controlLevel: string; responsibleRole: string; verificationEvidence: string }

export interface Topic {
  id: string;
  label: string;
  /** The default hazard category this topic maps to (must exist in DEFAULT_HAZARD_CATEGORIES). */
  category: string;
  keywords: RegExp;
  icon: PosterIcon;
  /** Credible worst-outcome severity on a 5-point scale for an uncontrolled situation. */
  baseSeverity: number;
  hazards: TopicHazard[];
  checks: TopicCheck[];
  poster: { theme: PosterTheme; signalWord: string; headline: string; subheadline: string; points: string[] };
  /** Main steps of a safe sequence; a decision is written as "?question|fix step". */
  flow: string[];
  keyControls: string[];
  corrective: TopicCapa[];
  preventive: TopicCapa[];
  rootCauses: string[];
}

const LIMIT = '[confirm limit per project procedure]';

export const TOPICS: Topic[] = [
  {
    id: 'work_at_height', label: 'Work at height', category: 'Work at height', icon: 'harness', baseSeverity: 5,
    keywords: /\b(height|heights|fall|falls|edge|edges|roof|harness|lanyard|ladder|mewp|boom lift|scissor lift|platform|opening|void|guard ?rail|handrail|parapet)\b/i,
    hazards: [
      { activity: 'Working near open edges and floor openings', hazard: 'Fall from height through unprotected edge or opening', consequence: 'Fatal or life-changing injury', l: 3, s: 5,
        controls: ['Elimination: plan work from ground level or install permanent edge protection first', 'Engineering: guardrails, toe boards and secured, marked opening covers', 'Engineering: harness with lanyard to a rated anchor where collective protection is not practical', 'Administrative: permit, supervision and rescue plan before work starts', 'PPE: inspected full-body harness and helmet with chin strap'], rl: 1, rs: 5 },
      { activity: 'Using ladders and mobile elevating work platforms', hazard: 'Fall from ladder or platform; platform overturn', consequence: 'Serious injury or fatality', l: 3, s: 4,
        controls: ['Substitution: use a podium or MEWP instead of a ladder for anything beyond short-duration access', 'Engineering: firm, level ground and outriggers deployed per manufacturer', 'Administrative: trained and authorised operators only; pre-use inspection each shift', 'PPE: harness clipped to the designated MEWP anchor point'], rl: 1, rs: 4 },
      { activity: 'Working above other people', hazard: 'Falling tools and materials', consequence: 'Head or body injury to people below', l: 3, s: 4,
        controls: ['Engineering: toe boards, debris netting and tool tethers', 'Administrative: barricaded exclusion zone with signs below the work', 'PPE: helmets for everyone in the area'], rl: 1, rs: 4 },
    ],
    checks: [
      { heading: 'Planning and authorisation', items: [
        { text: 'Work-at-height permit issued and displayed at the work area', critical: true },
        { text: 'Rescue plan in place, briefed, and rescue equipment available', critical: true },
        { text: 'Workers are trained and authorised for the access equipment used', critical: true, guidance: 'Check competence cards against the training register' } ] },
      { heading: 'Edge protection and access', items: [
        { text: 'Guardrails and toe boards fitted on all open edges', critical: true },
        { text: 'Floor openings covered, secured and marked', critical: true },
        { text: 'Ladders inspected, tagged, secured and extend above the landing', guidance: `Extension above landing ${LIMIT}` } ] },
      { heading: 'Personal fall protection', items: [
        { text: 'Harness and lanyard inspected before use and within inspection date', critical: true },
        { text: 'Anchor points are rated and at or above shoulder height where possible', critical: true },
        { text: 'Exclusion zone below is barricaded and signed' } ] },
    ],
    poster: { theme: 'mandatory', signalWord: 'MANDATORY', headline: 'Clip on before you step out', subheadline: 'Your harness only protects you when it is connected.', points: ['Inspect harness and lanyard before every use', 'Anchor at or above shoulder height', 'Stay connected while moving at height', 'Report damaged equipment immediately'] },
    flow: ['Plan the task and select access equipment', 'Obtain work-at-height permit', '?Edge protection complete?|Install guardrails or covers', '?Rescue plan briefed?|Brief rescue plan and stage equipment', 'Inspect harness, lanyard and anchors', 'Carry out work with supervision', 'Remove tools and materials, close permit'],
    keyControls: ['Plan to avoid work at height where possible', 'Collective protection (guardrails, covers) before personal protection', 'Permit, competent supervision and a rescue plan', 'Inspect harnesses, lanyards, ladders and platforms before use', 'Exclusion zones below overhead work'],
    corrective: [
      { action: 'Stop work at the exposed edge and install guardrails, toe boards or secured covers before work resumes', controlLevel: 'Engineering', responsibleRole: 'Site Engineer', verificationEvidence: 'Photo of installed edge protection signed off by HSE' },
      { action: 'Re-brief the crew on 100% tie-off and the rescue plan', controlLevel: 'Administrative', responsibleRole: 'Supervisor', verificationEvidence: 'Toolbox talk attendance sheet' } ],
    preventive: [
      { action: 'Add edge-protection checks to the daily work-at-height inspection checklist', controlLevel: 'Administrative', responsibleRole: 'HSE Engineer', verificationEvidence: 'Updated checklist issued and in use' },
      { action: 'Sequence permanent edge protection earlier in the construction programme', controlLevel: 'Elimination', responsibleRole: 'Project Manager', verificationEvidence: 'Revised programme / method statement' } ],
    rootCauses: ['Edge protection removed for access and not reinstated', 'Inadequate supervision or inspection of the work area', 'Task planning did not address access at height'],
  },
  {
    id: 'scaffolding', label: 'Scaffolding', category: 'Scaffolding', icon: 'scaffold', baseSeverity: 5,
    keywords: /\b(scaffold|scaffolds|scaffolding|scafftag|scaff tag|tower|base plate|sole board|ledger|transom|bracing)\b/i,
    hazards: [
      { activity: 'Erecting, altering and dismantling scaffolds', hazard: 'Fall of scaffolders; collapse of incomplete structure', consequence: 'Fatal or serious injury', l: 3, s: 5,
        controls: ['Engineering: erect to an approved design with advance guardrail system', 'Administrative: competent scaffolders only, under a scaffold supervisor', 'Administrative: exclusion zone during erection and dismantling', 'PPE: harness clipped while erecting where advance guardrail is not available'], rl: 1, rs: 5 },
      { activity: 'Using scaffolds for access and work', hazard: 'Use of incomplete or modified scaffold; overloading', consequence: 'Falls, collapse, falling materials', l: 3, s: 4,
        controls: ['Administrative: tag system — green tag only after inspection by a competent person', 'Administrative: no unauthorised alterations', `Administrative: respect the load class shown on the tag ${LIMIT}`, 'Engineering: full boarding, guardrails and toe boards on working platforms'], rl: 1, rs: 4 },
    ],
    checks: [
      { heading: 'Status and inspection', items: [
        { text: 'Scaffold has a valid inspection tag showing it is safe to use', critical: true },
        { text: 'Inspection is within its validity period', critical: true, guidance: `Inspection interval ${LIMIT}` },
        { text: 'No unauthorised alterations since the last inspection', critical: true } ] },
      { heading: 'Foundation and structure', items: [
        { text: 'Base plates and sole boards on firm, level ground' , critical: true },
        { text: 'Bracing and ties in place as per design', critical: true },
        { text: 'Standards plumb, couplers tight, no damaged tubes or fittings' } ] },
      { heading: 'Working platforms', items: [
        { text: 'Platforms fully boarded with no gaps or trip hazards', critical: true },
        { text: 'Guardrails, mid-rails and toe boards on all open sides', critical: true },
        { text: 'Safe access ladder or stair tower provided' } ] },
    ],
    poster: { theme: 'warning', signalWord: 'WARNING', headline: 'No green tag, no access', subheadline: 'Only use scaffolds inspected and tagged safe today.', points: ['Check the tag before you climb', 'Never alter or remove scaffold parts', 'Keep platforms clear and fully boarded', 'Report damage to the scaffold supervisor'] },
    flow: ['Scaffold request with load class and use', 'Design or standard configuration approved', 'Erect by competent scaffolders', '?Inspection passed?|Correct defects and re-inspect', 'Green tag issued', 'Use and inspect at the set interval', 'Dismantle under exclusion zone'],
    keyControls: ['Erect, alter and dismantle only by competent scaffolders', 'Inspection and tagging before use and at set intervals', 'Full boarding, guardrails and toe boards', 'Firm foundations, bracing and ties to design', 'No unauthorised alterations'],
    corrective: [
      { action: 'Red-tag and close the scaffold until a competent person inspects and corrects defects', controlLevel: 'Administrative', responsibleRole: 'Scaffold Supervisor', verificationEvidence: 'Inspection record and new tag' } ],
    preventive: [
      { action: 'Introduce a weekly scaffold register review with tag status per location', controlLevel: 'Administrative', responsibleRole: 'HSE Engineer', verificationEvidence: 'Scaffold register with inspection dates' } ],
    rootCauses: ['Tag system not enforced', 'Unauthorised alteration by other trades', 'Inspection interval missed'],
  },
  {
    id: 'hot_work', label: 'Hot work', category: 'Hot work & fire', icon: 'fire', baseSeverity: 4,
    keywords: /\b(hot work|weld|welding|cutting|grinding|grinder|torch|brazing|spark|sparks|fire|flammable|combustible|extinguisher|gas cylinder|oxy|acetylene)\b/i,
    hazards: [
      { activity: 'Welding, cutting and grinding', hazard: 'Ignition of combustible materials by sparks or hot slag', consequence: 'Fire, burns, property damage', l: 3, s: 4,
        controls: ['Elimination: use cold-cutting methods where practical', 'Engineering: remove or protect combustibles with fire blankets and screens', 'Administrative: hot work permit and trained fire watch during and after work', 'PPE: welding helmet, flame-resistant clothing and gloves'], rl: 1, rs: 4 },
      { activity: 'Handling compressed gas cylinders', hazard: 'Leak, flashback or cylinder damage', consequence: 'Fire or explosion', l: 2, s: 5,
        controls: ['Engineering: flashback arrestors and check valves fitted', 'Engineering: cylinders upright, secured and caps fitted when not in use', 'Administrative: leak test connections; store fuel gas and oxygen apart'], rl: 1, rs: 5 },
    ],
    checks: [
      { heading: 'Permit and preparation', items: [
        { text: 'Hot work permit issued for the location and shift', critical: true },
        { text: 'Combustibles removed or protected within the set radius', critical: true, guidance: `Clearance radius ${LIMIT}` },
        { text: 'Gas test completed where flammable atmospheres are possible', critical: true } ] },
      { heading: 'Equipment', items: [
        { text: 'Flashback arrestors fitted on both gas lines', critical: true },
        { text: 'Hoses, regulators and torches in good condition' },
        { text: 'Cylinders upright, chained and away from heat sources' } ] },
      { heading: 'Fire watch', items: [
        { text: 'Trained fire watch present with a suitable extinguisher', critical: true },
        { text: 'Fire watch continues after work stops for the required period', guidance: `Duration ${LIMIT}` } ] },
    ],
    poster: { theme: 'fire', signalWord: 'FIRE SAFETY', headline: 'Permit first, then the spark', subheadline: 'Hot work starts only when the area is prepared and watched.', points: ['Get the hot work permit signed', 'Clear or cover combustibles', 'Keep a fire watch with an extinguisher', 'Check the area after you finish'] },
    flow: ['Request hot work permit', 'Inspect area and remove combustibles', '?Gas test acceptable?|Ventilate and re-test', 'Position fire watch and extinguisher', 'Carry out hot work', 'Post-work fire watch', 'Close permit'],
    keyControls: ['Hot work permit for every location and shift', 'Remove or protect combustibles; check below and behind', 'Trained fire watch with a suitable extinguisher, during and after work', 'Flashback arrestors and secured cylinders', 'Gas testing where flammable atmospheres are possible'],
    corrective: [
      { action: 'Stop hot work until combustibles are cleared and a fire watch with extinguisher is in place', controlLevel: 'Administrative', responsibleRole: 'Supervisor', verificationEvidence: 'Permit re-validated with area checklist' } ],
    preventive: [
      { action: 'Brief all welders and fire watches on the hot work permit conditions', controlLevel: 'Administrative', responsibleRole: 'HSE Officer', verificationEvidence: 'Training record / toolbox talk sheet' } ],
    rootCauses: ['Permit conditions not checked at the work area', 'Fire watch not assigned or left early', 'Combustible storage near work areas'],
  },
  {
    id: 'confined_space', label: 'Confined space entry', category: 'Confined space', icon: 'confined_space', baseSeverity: 5,
    keywords: /\b(confined space|manhole|tank|vessel|pit|sewer|chamber|culvert|duct|silo|gas test|oxygen|toxic atmosphere)\b/i,
    hazards: [
      { activity: 'Entry into tanks, pits, chambers and similar spaces', hazard: 'Oxygen deficiency, toxic or flammable atmosphere', consequence: 'Asphyxiation, poisoning, explosion — multiple fatalities possible', l: 3, s: 5,
        controls: ['Elimination: do the work from outside the space where possible', 'Engineering: isolate, purge and ventilate; continuous gas monitoring', 'Administrative: confined space permit, trained entrants and standby person', 'Administrative: rescue plan and equipment at the entry before entry'], rl: 1, rs: 5 },
    ],
    checks: [
      { heading: 'Before entry', items: [
        { text: 'Confined space entry permit issued and valid', critical: true },
        { text: 'All energy and process lines isolated and locked', critical: true },
        { text: 'Atmosphere tested and results within limits', critical: true, guidance: `Oxygen, flammable and toxic limits ${LIMIT}` },
        { text: 'Rescue plan and retrieval equipment at the entry point', critical: true } ] },
      { heading: 'During entry', items: [
        { text: 'Standby person at the entry in constant contact', critical: true },
        { text: 'Continuous gas monitoring in use' , critical: true },
        { text: 'Entry log kept of everyone inside' } ] },
    ],
    poster: { theme: 'prohibition', signalWord: 'DANGER', headline: 'No permit, no entry', subheadline: 'Confined spaces can kill in seconds — test before you enter.', points: ['Test the air before and during entry', 'Standby person at the entrance always', 'Never enter to rescue without equipment', 'Sign in and sign out'] },
    flow: ['Identify the confined space and need for entry', 'Isolate and ventilate', '?Atmosphere within limits?|Ventilate and re-test', '?Standby and rescue plan ready?|Arrange standby and rescue equipment', 'Issue permit and brief entrants', 'Enter with continuous monitoring', 'Exit, account for all entrants, close permit'],
    keyControls: ['Avoid entry where the work can be done from outside', 'Isolation, ventilation and gas testing before and during entry', 'Permit, trained entrants and a standby person', 'Rescue plan and equipment ready before entry'],
    corrective: [
      { action: 'Stop entry; re-test atmosphere and confirm isolation before any re-entry', controlLevel: 'Administrative', responsibleRole: 'Permit Issuer', verificationEvidence: 'Gas test records on the permit' } ],
    preventive: [
      { action: 'Hold a confined space rescue drill for the crew', controlLevel: 'Administrative', responsibleRole: 'HSE Engineer', verificationEvidence: 'Drill report with lessons learned' } ],
    rootCauses: ['Space not recognised as confined', 'Gas testing not repeated after breaks', 'No standby person assigned'],
  },
  {
    id: 'electrical', label: 'Electrical work', category: 'Electrical', icon: 'electric', baseSeverity: 5,
    keywords: /\b(electric|electrical|cable|cables|live|shock|electrocution|db|distribution board|panel|isolation|loto|lockout|tag ?out|generator|socket|extension lead|rcd|elcb)\b/i,
    hazards: [
      { activity: 'Work on or near electrical systems', hazard: 'Contact with live conductors; arc flash', consequence: 'Electrocution, burns, fatality', l: 3, s: 5,
        controls: ['Elimination: work dead — isolate, lock out and prove dead', 'Engineering: residual current protection on temporary supplies', 'Administrative: electrical permit, authorised electricians only', 'PPE: insulated tools and arc-rated PPE where required'], rl: 1, rs: 5 },
      { activity: 'Temporary power and portable tools', hazard: 'Damaged cables, overloaded or wet connections', consequence: 'Electric shock, fire', l: 3, s: 4,
        controls: ['Engineering: industrial plugs and sockets, cables routed overhead or protected', 'Administrative: inspection and colour-coding of portable equipment', 'Administrative: keep connections dry and off the ground'], rl: 1, rs: 4 },
    ],
    checks: [
      { heading: 'Isolation', items: [
        { text: 'Circuit isolated, locked and tagged by the person doing the work', critical: true },
        { text: 'Absence of voltage proven with a tested instrument', critical: true },
        { text: 'Electrical permit issued for work on systems', critical: true } ] },
      { heading: 'Temporary supplies', items: [
        { text: 'Distribution boards closed, labelled and protected by RCDs', critical: true },
        { text: 'Cables undamaged and routed to avoid traffic and water' },
        { text: 'Portable tools carry a current inspection tag' } ] },
    ],
    poster: { theme: 'warning', signalWord: 'DANGER', headline: 'Lock it, tag it, test it', subheadline: 'Treat every conductor as live until proven dead.', points: ['Isolate and lock out before work', 'Prove dead with a tested meter', 'Never bypass protective devices', 'Report damaged cables at once'] },
    flow: ['Identify circuits and isolation points', 'Issue electrical permit', 'Isolate, lock and tag', '?Proven dead?|Re-isolate and test again', 'Carry out the work', 'Remove locks, re-energise under control', 'Close permit'],
    keyControls: ['Work dead: isolate, lock, tag and prove dead', 'Authorised electricians and electrical permits', 'RCD protection on temporary supplies', 'Inspect cables and portable tools'],
    corrective: [
      { action: 'Isolate the damaged equipment and replace or repair by an authorised electrician', controlLevel: 'Engineering', responsibleRole: 'Electrical Supervisor', verificationEvidence: 'Repair record and test result' } ],
    preventive: [
      { action: 'Set a monthly inspection and tagging cycle for temporary electrical equipment', controlLevel: 'Administrative', responsibleRole: 'Electrical Supervisor', verificationEvidence: 'Inspection register' } ],
    rootCauses: ['Lock-out procedure not followed', 'Inspection of temporary installations not carried out', 'Unauthorised connections'],
  },
  {
    id: 'lifting', label: 'Lifting operations', category: 'Lifting operations', icon: 'crane', baseSeverity: 5,
    keywords: /\b(lift|lifting|crane|cranes|rigging|rigger|sling|slings|shackle|hoist|load|suspended|tower crane|mobile crane|banksman|signaller|tagline)\b/i,
    hazards: [
      { activity: 'Crane lifts and rigging', hazard: 'Dropped or swinging load; crane overturn', consequence: 'Fatality, serious injury, major damage', l: 3, s: 5,
        controls: ['Engineering: crane set up on assessed ground with outriggers fully extended', 'Administrative: lift plan by a competent person; critical lifts reviewed', 'Administrative: certified lifting accessories, competent riggers and signallers', 'Administrative: exclusion zone — nobody under a suspended load'], rl: 1, rs: 5 },
    ],
    checks: [
      { heading: 'Planning', items: [
        { text: 'Lift plan prepared and briefed to the lifting team', critical: true },
        { text: 'Load weight and radius within the crane duty chart', critical: true, guidance: `Utilisation threshold for critical lifts ${LIMIT}` },
        { text: 'Weather and wind checked before lifting', critical: true, guidance: `Wind speed limit ${LIMIT}` } ] },
      { heading: 'Equipment and people', items: [
        { text: 'Crane and accessories have valid inspection certificates', critical: true },
        { text: 'Operator, rigger and signaller are competent and identified', critical: true },
        { text: 'Taglines used to control the load' } ] },
      { heading: 'Lift area', items: [
        { text: 'Exclusion zone barricaded; nobody under the load', critical: true },
        { text: 'Ground conditions and outrigger pads checked', critical: true } ] },
    ],
    poster: { theme: 'prohibition', signalWord: 'DANGER', headline: 'Never stand under a suspended load', subheadline: 'Keep out of the lift zone unless you are part of the lift team.', points: ['Follow the signaller only', 'Use taglines to control loads', 'Check slings and shackles before use', 'Stop the lift if anything changes'] },
    flow: ['Define the lift and load details', 'Prepare and approve lift plan', '?Within crane duty and weather limits?|Re-plan or postpone the lift', 'Set up crane and exclusion zone', 'Brief the lifting team', 'Execute the lift under signaller control', 'Debrief and release the area'],
    keyControls: ['Lift plan by a competent person', 'Certified cranes and lifting accessories', 'Competent operator, rigger and signaller', 'Exclusion zones; nobody under suspended loads', 'Ground, weather and wind checks'],
    corrective: [
      { action: 'Suspend lifting until the lift plan, accessories and exclusion zone are verified', controlLevel: 'Administrative', responsibleRole: 'Lifting Supervisor', verificationEvidence: 'Approved lift plan and accessory certificates' } ],
    preventive: [
      { action: 'Introduce pre-lift checklist sign-off by the appointed person', controlLevel: 'Administrative', responsibleRole: 'HSE Engineer', verificationEvidence: 'Signed pre-lift checklists' } ],
    rootCauses: ['Lift not planned or plan not followed', 'Uncertified or damaged accessories', 'Exclusion zone not enforced'],
  },
  {
    id: 'excavation', label: 'Excavation', category: 'Excavation', icon: 'excavation', baseSeverity: 5,
    keywords: /\b(excavat\w*|trench|trenches|dig|digging|shoring|benching|battering|spoil|underground services|utilit\w*|cave[- ]?in|collapse)\b/i,
    hazards: [
      { activity: 'Excavation and trenching', hazard: 'Collapse of sides; people or plant falling in', consequence: 'Burial, crush injuries, fatality', l: 3, s: 5,
        controls: ['Engineering: shoring, trench boxes, battering or benching per design', 'Engineering: barriers and edge protection around the excavation', 'Administrative: excavation permit and daily inspection by a competent person', 'Administrative: spoil and plant kept back from the edge'], rl: 1, rs: 5 },
      { activity: 'Digging near buried services', hazard: 'Striking underground cables or pipes', consequence: 'Electrocution, gas release, fire', l: 3, s: 5,
        controls: ['Administrative: service drawings and permit to dig', 'Engineering: cable/pipe locator scan before breaking ground', 'Administrative: hand-dig trial holes near located services'], rl: 1, rs: 5 },
    ],
    checks: [
      { heading: 'Before digging', items: [
        { text: 'Permit to excavate issued with service drawings attached', critical: true },
        { text: 'Area scanned for buried services and marked', critical: true },
        { text: 'Support method agreed for the depth and ground type', critical: true, guidance: `Depth at which support is required ${LIMIT}` } ] },
      { heading: 'During work', items: [
        { text: 'Edge protection and barriers around the excavation', critical: true },
        { text: 'Safe means of access and egress provided', critical: true },
        { text: 'Spoil and plant kept back from the edge', guidance: `Set-back distance ${LIMIT}` },
        { text: 'Excavation inspected at the start of each shift and after rain' } ] },
    ],
    poster: { theme: 'warning', signalWord: 'WARNING', headline: 'Support it before you enter it', subheadline: 'Trench walls can collapse without warning.', points: ['Scan for services before you dig', 'Never enter an unsupported trench', 'Keep spoil and plant back from edges', 'Use the ladder to get in and out'] },
    flow: ['Obtain service drawings and permit to excavate', 'Scan and mark buried services', '?Services located and clear?|Hand-dig trial holes', 'Install support and edge protection', 'Inspect excavation', 'Carry out work', 'Backfill and close permit'],
    keyControls: ['Permit to excavate with service drawings', 'Scan for and hand-dig near buried services', 'Support, batter or bench sides', 'Edge protection, safe access and spoil set-back', 'Daily inspection by a competent person'],
    corrective: [
      { action: 'Remove people from the excavation and install support before re-entry', controlLevel: 'Engineering', responsibleRole: 'Site Engineer', verificationEvidence: 'Inspection record with photos of support' } ],
    preventive: [
      { action: 'Add excavation inspection to the shift start checklist', controlLevel: 'Administrative', responsibleRole: 'Supervisor', verificationEvidence: 'Completed inspection forms' } ],
    rootCauses: ['Support not installed to suit depth and soil', 'Services not located before digging', 'Inspection after weather change missed'],
  },
  {
    id: 'traffic', label: 'Traffic and mobile plant', category: 'Traffic & logistics', icon: 'vehicle', baseSeverity: 5,
    keywords: /\b(traffic|vehicle|vehicles|truck|trucks|dumper|reversing|forklift|plant movement|pedestrian|road|delivery|deliveries|banksman|excavator|loader|logistics)\b/i,
    hazards: [
      { activity: 'Vehicle and plant movement on site', hazard: 'Collision between plant and pedestrians', consequence: 'Fatal or serious injury', l: 3, s: 5,
        controls: ['Engineering: segregated pedestrian walkways with physical barriers', 'Engineering: reversing alarms, cameras and proximity warning', 'Administrative: traffic management plan, speed limits and trained banksmen', 'PPE: high-visibility clothing for everyone on foot'], rl: 1, rs: 5 },
    ],
    checks: [
      { heading: 'Layout', items: [
        { text: 'Traffic management plan is current and displayed', critical: true },
        { text: 'Pedestrian routes physically segregated from plant routes', critical: true },
        { text: `Speed limits signed ${LIMIT}` } ] },
      { heading: 'Plant and drivers', items: [
        { text: 'Operators hold valid competence for the machine', critical: true },
        { text: 'Reversing alarms, lights and cameras working' },
        { text: 'Banksman used for reversing in restricted areas', critical: true } ] },
    ],
    poster: { theme: 'warning', signalWord: 'WARNING', headline: 'Stay visible, stay on the walkway', subheadline: 'Plant drivers cannot always see you.', points: ['Use marked pedestrian routes only', 'Make eye contact with the driver', 'Wear high-visibility clothing', 'Never walk behind reversing plant'] },
    flow: ['Prepare traffic management plan', 'Mark routes, barriers and signs', '?Pedestrians segregated?|Install barriers or re-route', 'Brief drivers and banksmen', 'Monitor movements and speeds', 'Review plan as the site changes'],
    keyControls: ['Traffic management plan kept current', 'Physical segregation of pedestrians and plant', 'Competent drivers and banksmen', 'Speed limits, reversing aids and visibility'],
    corrective: [
      { action: 'Install physical barriers to separate the pedestrian route from the plant route', controlLevel: 'Engineering', responsibleRole: 'Logistics Supervisor', verificationEvidence: 'Photo of barriers and updated TMP drawing' } ],
    preventive: [
      { action: 'Review the traffic management plan weekly against the current site layout', controlLevel: 'Administrative', responsibleRole: 'HSE Engineer', verificationEvidence: 'Dated TMP revisions' } ],
    rootCauses: ['Traffic plan not updated as work progressed', 'No physical segregation', 'Banksman not provided'],
  },
  {
    id: 'heat_stress', label: 'Heat stress', category: 'Heat stress', icon: 'heat', baseSeverity: 4,
    keywords: /\b(heat|hot weather|summer|sun|humidity|dehydrat\w*|heat stroke|heat exhaustion|midday|cooling|water station|rest shelter)\b/i,
    hazards: [
      { activity: 'Outdoor and enclosed work in hot weather', hazard: 'Heat exhaustion and heat stroke', consequence: 'Collapse, organ damage, fatality', l: 3, s: 4,
        controls: ['Administrative: heat stress management plan and work-hour restrictions as applicable to the project', 'Engineering: shaded and cooled rest areas, cool drinking water close to the work', 'Administrative: acclimatisation, work/rest cycles and buddy checks', 'Administrative: first aiders trained to recognise and treat heat illness'], rl: 1, rs: 4 },
    ],
    checks: [
      { heading: 'Welfare', items: [
        { text: 'Cool drinking water available near every work front', critical: true },
        { text: 'Shaded, cooled rest areas provided', critical: true },
        { text: 'Work-hour restrictions applicable to the project are followed', critical: true, guidance: '[confirm applicable restriction periods per project procedure]' } ] },
      { heading: 'Monitoring', items: [
        { text: 'Heat index or WBGT monitored and communicated', guidance: `Action levels ${LIMIT}` },
        { text: 'New workers on an acclimatisation schedule' },
        { text: 'First aiders know the signs of heat illness and the emergency number' } ] },
    ],
    poster: { theme: 'information', signalWord: 'BEAT THE HEAT', headline: 'Drink, rest, report', subheadline: 'Heat illness can affect anyone — look after each other.', points: ['Drink water often, before you feel thirsty', 'Rest in the shade at every break', 'Watch your buddy for warning signs', 'Report dizziness or confusion at once'] },
    flow: ['Check the heat forecast and index', 'Brief the crew on controls', '?Index above action level?|Increase rest breaks and adjust tasks', 'Work with scheduled hydration and rest', 'Monitor workers and respond to symptoms', 'Record readings and incidents'],
    keyControls: ['Heat stress plan and any applicable work-hour restrictions', 'Water, shade and cooled rest areas', 'Acclimatisation and work/rest cycles', 'Buddy checks and trained first aiders'],
    corrective: [
      { action: 'Provide additional water and a shaded rest point at the work front', controlLevel: 'Engineering', responsibleRole: 'Supervisor', verificationEvidence: 'Photo of welfare provision' } ],
    preventive: [
      { action: 'Deliver a heat illness toolbox talk to all crews before the hot season', controlLevel: 'Administrative', responsibleRole: 'HSE Officer', verificationEvidence: 'Attendance records' } ],
    rootCauses: ['Welfare facilities too far from the work', 'Work/rest cycle not applied', 'Workers not acclimatised'],
  },
  {
    id: 'chemical', label: 'Hazardous substances', category: 'Chemical / hazardous substances', icon: 'chemical', baseSeverity: 4,
    keywords: /\b(chemical|chemicals|sds|msds|solvent|paint|acid|fuel|diesel|spill|coshh|hazardous substance|fumes|vapour|vapor|resin|epoxy)\b/i,
    hazards: [
      { activity: 'Use and storage of hazardous substances', hazard: 'Skin contact, inhalation, spills and fire', consequence: 'Burns, poisoning, environmental damage', l: 3, s: 4,
        controls: ['Substitution: use less hazardous products where available', 'Engineering: ventilation and bunded, labelled storage', 'Administrative: safety data sheets available and assessed before use', 'PPE: gloves, eye protection and respirators as specified by the SDS'], rl: 1, rs: 3 },
    ],
    checks: [
      { heading: 'Storage and labelling', items: [
        { text: 'Containers labelled and stored in a bunded, ventilated area', critical: true },
        { text: 'Incompatible substances segregated', critical: true },
        { text: 'Safety data sheets available at the point of use' } ] },
      { heading: 'Use', items: [
        { text: 'Assessment completed and controls briefed to users', critical: true },
        { text: 'Specified PPE available and worn' },
        { text: 'Spill kit available and staff know how to use it' } ] },
    ],
    poster: { theme: 'warning', signalWord: 'CAUTION', headline: 'Read the label, follow the SDS', subheadline: 'Know the hazards before you open the container.', points: ['Wear the PPE the SDS specifies', 'Keep containers closed and labelled', 'Use the spill kit and report spills', 'Wash hands before eating'] },
    flow: ['Obtain SDS and assess the substance', 'Set storage, ventilation and PPE', '?Safer substitute available?|Switch to the safer product', 'Brief users', 'Use with controls in place', 'Dispose of waste correctly'],
    keyControls: ['Substitute where possible', 'SDS-based assessment before use', 'Labelled, bunded, segregated storage', 'Ventilation and specified PPE', 'Spill kits and correct waste disposal'],
    corrective: [
      { action: 'Relabel and move containers to the bunded storage area; clean up any spill', controlLevel: 'Engineering', responsibleRole: 'Supervisor', verificationEvidence: 'Photo of corrected storage' } ],
    preventive: [
      { action: 'Maintain a chemical register with SDS and assessments for every product on site', controlLevel: 'Administrative', responsibleRole: 'HSE Officer', verificationEvidence: 'Chemical register' } ],
    rootCauses: ['Products brought to site without assessment', 'Inadequate storage facilities', 'Users not briefed on SDS controls'],
  },
  {
    id: 'housekeeping', label: 'Housekeeping and access', category: 'Housekeeping & access', icon: 'warning', baseSeverity: 3,
    keywords: /\b(housekeeping|trip|trips|slip|slips|debris|clutter|walkway|access route|stairs|untidy|obstruct\w*|waste|rubbish)\b/i,
    hazards: [
      { activity: 'Daily work in general areas', hazard: 'Slips and trips on debris, materials and cables', consequence: 'Sprains, fractures, falls', l: 4, s: 3,
        controls: ['Engineering: designated storage and waste skips close to work fronts', 'Administrative: clean-as-you-go rule and end-of-shift clean-up', 'Administrative: cables routed overhead or protected'], rl: 2, rs: 2 },
    ],
    checks: [
      { heading: 'Access routes', items: [
        { text: 'Walkways and stairs clear of materials and debris', critical: true },
        { text: 'Emergency exits and routes unobstructed', critical: true },
        { text: 'Adequate lighting on access routes' } ] },
      { heading: 'Storage and waste', items: [
        { text: 'Materials stacked stably in designated areas' },
        { text: 'Waste segregated and skips not overfilled' },
        { text: 'Cables and hoses routed to avoid trip hazards' } ] },
    ],
    poster: { theme: 'safe_condition', signalWord: 'GOOD PRACTICE', headline: 'Clean as you go', subheadline: 'A tidy site is a safer site.', points: ['Keep walkways and exits clear', 'Put waste in the right skip', 'Stack materials neatly and stably', 'Route cables away from walkways'] },
    flow: ['Plan storage and waste points', 'Brief clean-as-you-go rule', 'Daily housekeeping inspection', '?Areas acceptable?|Assign clean-up with deadline', 'End-of-shift clean-up', 'Record and track repeat issues'],
    keyControls: ['Clean as you go', 'Designated storage and waste points', 'Clear walkways and emergency routes', 'Cable management'],
    corrective: [
      { action: 'Clear the obstructed route and remove debris to the correct skip', controlLevel: 'Administrative', responsibleRole: 'Supervisor', verificationEvidence: 'Before/after photos' } ],
    preventive: [
      { action: 'Add housekeeping scores to the weekly inspection with named area owners', controlLevel: 'Administrative', responsibleRole: 'HSE Engineer', verificationEvidence: 'Weekly inspection records' } ],
    rootCauses: ['No clean-as-you-go discipline', 'Insufficient waste skips near work fronts', 'Area ownership not assigned'],
  },
  {
    id: 'ppe', label: 'Personal protective equipment', category: 'PPE', icon: 'hard_hat', baseSeverity: 3,
    keywords: /\b(ppe|helmet|hard hat|gloves|goggles|glasses|safety shoes|boots|hi-?vis|vest|ear plugs|respirator|mask|face shield|not wearing)\b/i,
    hazards: [
      { activity: 'General site work', hazard: 'Head, eye, hand and foot injuries when PPE is missing or unsuitable', consequence: 'Lacerations, eye injury, fractures', l: 3, s: 3,
        controls: ['Administrative: task-specific PPE matrix based on the risk assessment', 'Administrative: PPE issue, fitting and replacement system', 'Administrative: supervision and positive reinforcement', 'PPE: correct PPE worn and maintained'], rl: 2, rs: 3 },
    ],
    checks: [
      { heading: 'PPE use', items: [
        { text: 'Workers wear the PPE required for the task', critical: true },
        { text: 'PPE is in good condition and correctly fitted' },
        { text: 'Task-specific PPE (eye, hearing, respiratory) available at the work front' } ] },
    ],
    poster: { theme: 'mandatory', signalWord: 'MANDATORY', headline: 'Right PPE, right task, every time', subheadline: 'PPE is your last line of defence — make it count.', points: ['Wear helmet, boots and hi-vis on site', 'Add task PPE the job needs', 'Replace damaged PPE immediately', 'Check your workmate is protected'] },
    flow: ['Identify PPE from the risk assessment', 'Issue and fit PPE', 'Brief users on correct use', '?PPE worn and in good condition?|Stop task and correct', 'Inspect and replace as needed'],
    keyControls: ['PPE selected from the risk assessment', 'Issue, fit and replace system', 'Supervision and coaching', 'PPE as the last line of defence after other controls'],
    corrective: [
      { action: 'Stop the task until the correct PPE is issued and worn', controlLevel: 'PPE', responsibleRole: 'Supervisor', verificationEvidence: 'Supervisor confirmation and PPE issue record' } ],
    preventive: [
      { action: 'Post the task PPE matrix at each work front and brief new starters', controlLevel: 'Administrative', responsibleRole: 'HSE Officer', verificationEvidence: 'Posted matrix and induction records' } ],
    rootCauses: ['PPE not available at the work front', 'Unclear PPE requirements for the task', 'Weak supervision'],
  },
  {
    id: 'environmental', label: 'Environmental protection', category: 'Environmental', icon: 'leaf', baseSeverity: 3,
    keywords: /\b(environment\w*|spill|spills|oil leak|dust|noise|waste|pollution|emission|emissions|drain|bund|wildlife|vegetation|dewatering)\b/i,
    hazards: [
      { activity: 'Site operations', hazard: 'Spills, dust, noise and uncontrolled waste', consequence: 'Pollution, nuisance, regulatory action', l: 3, s: 3,
        controls: ['Engineering: drip trays and bunding under plant and fuel', 'Engineering: dust suppression and noise barriers where needed', 'Administrative: waste segregation with licensed disposal', 'Administrative: spill response kits and trained responders'], rl: 2, rs: 2 },
    ],
    checks: [
      { heading: 'Pollution prevention', items: [
        { text: 'Fuel and oils stored in bunded areas; drip trays under plant', critical: true },
        { text: 'Spill kits stocked and accessible' },
        { text: 'Dust suppression in use on haul roads and stockpiles' } ] },
      { heading: 'Waste', items: [
        { text: 'Waste segregated and labelled', critical: false },
        { text: 'Waste removed by licensed carriers with records kept', critical: true } ] },
    ],
    poster: { theme: 'safe_condition', signalWord: 'PROTECT', headline: 'Keep it clean, keep it contained', subheadline: 'Every spill and every skip matters.', points: ['Use drip trays under plant', 'Report and contain spills at once', 'Segregate waste correctly', 'Keep dust down with water'] },
    flow: ['Identify environmental aspects', 'Set controls and spill kits', 'Daily environmental check', '?Spill or exceedance?|Contain, report and clean up', 'Dispose of waste with records', 'Review monthly performance'],
    keyControls: ['Bunding and drip trays', 'Spill kits and response', 'Dust and noise controls', 'Waste segregation and licensed disposal'],
    corrective: [
      { action: 'Contain and clean the spill, dispose of contaminated material as hazardous waste', controlLevel: 'Engineering', responsibleRole: 'Environmental Officer', verificationEvidence: 'Spill report and waste manifest' } ],
    preventive: [
      { action: 'Place drip trays under all stationary plant and check daily', controlLevel: 'Engineering', responsibleRole: 'Plant Supervisor', verificationEvidence: 'Daily plant checklist' } ],
    rootCauses: ['No secondary containment', 'Leaking plant not repaired', 'Waste segregation not enforced'],
  },
  {
    id: 'general', label: 'General site safety', category: 'Other', icon: 'shield_check', baseSeverity: 3,
    keywords: /(?!)/,
    hazards: [
      { activity: 'General construction activities', hazard: 'Uncontrolled hazards from changing site conditions', consequence: 'Injury to workers or others', l: 3, s: 3,
        controls: ['Administrative: task risk assessment and method statement before work', 'Administrative: toolbox talk at the start of each shift', 'Administrative: supervision and stop-work authority', 'PPE: basic site PPE plus task PPE'], rl: 2, rs: 3 },
    ],
    checks: [
      { heading: 'Before work', items: [
        { text: 'Risk assessment and method statement approved and briefed', critical: true },
        { text: 'Permits in place where required', critical: true },
        { text: 'Workers competent and inducted' } ] },
      { heading: 'Work area', items: [
        { text: 'Area barricaded and signed', critical: false },
        { text: 'Emergency arrangements and first aid known to the crew', critical: true },
        { text: 'Housekeeping acceptable' } ] },
    ],
    poster: { theme: 'information', signalWord: 'SAFETY FIRST', headline: 'Stop, think, then act', subheadline: 'If it is not safe, it does not happen.', points: ['Know the hazards before you start', 'Follow the approved method', 'Use your stop-work authority', 'Report every near miss'] },
    flow: ['Plan the task', 'Assess risks and prepare method statement', '?Controls in place?|Implement missing controls', 'Brief the crew', 'Carry out work under supervision', 'Review and record lessons'],
    keyControls: ['Risk assessment and method statement before work', 'Permits for high-risk activities', 'Competent, briefed workers', 'Supervision and stop-work authority'],
    corrective: [
      { action: 'Make the area safe and correct the observed condition before work continues', controlLevel: 'Administrative', responsibleRole: 'Supervisor', verificationEvidence: 'Photo of corrected condition' } ],
    preventive: [
      { action: 'Brief the finding and its controls at the next toolbox talk', controlLevel: 'Administrative', responsibleRole: 'HSE Officer', verificationEvidence: 'Toolbox talk record' } ],
    rootCauses: ['Hazard not identified in task planning', 'Controls not verified on site', 'Insufficient supervision'],
  },
];

export const GENERAL_TOPIC = TOPICS[TOPICS.length - 1]!;

/** Pick the best-matching topic by counting keyword hits; falls back to general site safety. */
export function matchTopic(text: string): Topic {
  let best: Topic = GENERAL_TOPIC;
  let score = 0;
  for (const t of TOPICS) {
    const g = new RegExp(t.keywords.source, 'gi');
    const n = (text.match(g) ?? []).length;
    if (n > score) { score = n; best = t; }
  }
  return best;
}

export function topicById(id: string): Topic | undefined {
  return TOPICS.find((t) => t.id === id);
}
