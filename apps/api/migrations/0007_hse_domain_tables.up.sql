-- 0007: normalized data foundation for the HSE modules (Phase 1).
-- Purely ADDITIVE: new tables only; no existing table, column or row is changed.
-- Status values mirror the lifecycles in packages/shared/src/domains/hse.ts (a test keeps them in sync).
-- Every record carries organization_id and project_id (site_id where work is site-specific), a
-- per-organisation reference number, optimistic-locking `version`, ownership and timestamps.

-- Generic status history for all new modules (observations keep observation_events).
CREATE TABLE domain_record_events (
  id               bigserial PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  record_type      text NOT NULL,
  record_id        uuid NOT NULL,
  actor_user_id    uuid NOT NULL REFERENCES users(id),
  event            text NOT NULL,
  from_status      text,
  to_status        text,
  comment          text NOT NULL DEFAULT '',
  data             jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hse_record_events_rec_idx ON domain_record_events (organization_id, record_type, record_id, id);

-- Generic revision snapshots (what a record looked like at each approved revision).
CREATE TABLE record_revisions (
  id               bigserial PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  record_type      text NOT NULL,
  record_id        uuid NOT NULL,
  revision         text NOT NULL,
  snapshot         jsonb NOT NULL,
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, record_type, record_id, revision)
);

-- Evidence files for any new module (bytes in object storage; metadata here).
CREATE TABLE hse_evidence (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  record_type      text NOT NULL,
  record_id        uuid NOT NULL,
  file_name        text NOT NULL,
  content_type     text NOT NULL,
  size_bytes       integer NOT NULL CHECK (size_bytes > 0),
  storage_key      text NOT NULL UNIQUE,
  caption          text NOT NULL DEFAULT '',
  uploaded_by      uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hse_evidence_rec_idx ON hse_evidence (organization_id, record_type, record_id);

/* ---------------------------------------------------------------- document control */
CREATE TABLE controlled_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  project_id       uuid NOT NULL,
  site_id          uuid,
  ref_no           text NOT NULL,
  doc_number       text NOT NULL,
  category         text NOT NULL CHECK (category IN ('hse_plan','policy','procedure','method_statement','risk_assessment','emergency_plan','logistics_plan','traffic_management_plan','form','register','report','other')),
  title            text NOT NULL,
  revision         text NOT NULL DEFAULT '00',
  summary          text NOT NULL DEFAULT '',
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','issued','superseded','withdrawn')),
  owner_id         uuid NOT NULL REFERENCES users(id),
  submitted_by     uuid REFERENCES users(id),
  approved_by      uuid REFERENCES users(id),
  approved_at      timestamptz,
  review_due_date  date,
  studio_item_id   uuid REFERENCES studio_items(id),
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id),
  FOREIGN KEY (site_id, project_id, organization_id) REFERENCES sites (id, project_id, organization_id),
  UNIQUE (organization_id, ref_no),
  UNIQUE (organization_id, project_id, doc_number, revision),
  CHECK (status NOT IN ('approved','issued','superseded') OR approved_by IS NOT NULL)
);
CREATE INDEX controlled_documents_scope_idx ON controlled_documents (organization_id, project_id, status);

CREATE TABLE document_revisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  document_id      uuid NOT NULL REFERENCES controlled_documents(id) ON DELETE CASCADE,
  revision         text NOT NULL,
  change_summary   text NOT NULL DEFAULT '',
  evidence_id      uuid REFERENCES hse_evidence(id),
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, revision)
);

/* ---------------------------------------------------------------- hazards & risk assessments */
CREATE TABLE hazard_library (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id),
  hazard_category      text NOT NULL,
  hazard               text NOT NULL,
  typical_consequence  text NOT NULL,
  typical_controls     jsonb NOT NULL DEFAULT '[]',
  active               boolean NOT NULL DEFAULT true,
  created_by           uuid NOT NULL REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hazard_library_org_idx ON hazard_library (organization_id, hazard_category) WHERE active;

CREATE TABLE risk_assessments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  project_id       uuid NOT NULL,
  site_id          uuid,
  ref_no           text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('risk_assessment','jsa','hira','method_statement_ra')),
  title            text NOT NULL,
  activity         text NOT NULL,
  revision         text NOT NULL DEFAULT '00',
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','under_review','approved','superseded','archived')),
  prepared_by      uuid NOT NULL REFERENCES users(id),
  submitted_by     uuid REFERENCES users(id),
  approved_by      uuid REFERENCES users(id),
  approved_at      timestamptz,
  review_date      date,
  supersedes_id    uuid REFERENCES risk_assessments(id),
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id),
  FOREIGN KEY (site_id, project_id, organization_id) REFERENCES sites (id, project_id, organization_id),
  UNIQUE (organization_id, ref_no),
  CHECK (status NOT IN ('approved','superseded') OR approved_by IS NOT NULL),
  CHECK (approved_by IS NULL OR submitted_by IS NULL OR approved_by <> submitted_by)
);
CREATE INDEX risk_assessments_scope_idx ON risk_assessments (organization_id, project_id, status);

CREATE TABLE risk_assessment_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_assessment_id    uuid NOT NULL REFERENCES risk_assessments(id) ON DELETE CASCADE,
  position              integer NOT NULL,
  step                  text NOT NULL DEFAULT '',
  hazard                text NOT NULL,
  consequence           text NOT NULL,
  persons_at_risk       text NOT NULL DEFAULT '',
  existing_controls     jsonb NOT NULL DEFAULT '[]',
  likelihood            smallint NOT NULL CHECK (likelihood BETWEEN 1 AND 10),
  severity              smallint NOT NULL CHECK (severity BETWEEN 1 AND 10),
  additional_controls   jsonb NOT NULL DEFAULT '[]',
  residual_likelihood   smallint NOT NULL CHECK (residual_likelihood BETWEEN 1 AND 10),
  residual_severity     smallint NOT NULL CHECK (residual_severity BETWEEN 1 AND 10),
  control_owner         text NOT NULL DEFAULT '',
  UNIQUE (risk_assessment_id, position)
);

/* ---------------------------------------------------------------- contractors & workforce */
CREATE TABLE contractors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id),
  name              text NOT NULL,
  trade_licence_no  text NOT NULL DEFAULT '',
  scope_of_work     text NOT NULL DEFAULT '',
  contact_name      text NOT NULL DEFAULT '',
  contact_email     text,
  status            text NOT NULL DEFAULT 'prospective' CHECK (status IN ('prospective','prequalified','approved','suspended','inactive')),
  approved_by       uuid REFERENCES users(id),
  version           integer NOT NULL DEFAULT 1,
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

-- Minimum personal data: name, employee number, employer and trade. No ID numbers or health data.
CREATE TABLE workers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  contractor_id    uuid REFERENCES contractors(id),
  project_id       uuid,
  full_name        text NOT NULL,
  employee_no      text NOT NULL DEFAULT '',
  trade            text NOT NULL DEFAULT '',
  inducted_on      date,
  active           boolean NOT NULL DEFAULT true,
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
);
CREATE INDEX workers_org_idx ON workers (organization_id, project_id) WHERE active;

/* ---------------------------------------------------------------- permits to work */
CREATE TABLE permits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  project_id          uuid NOT NULL,
  site_id             uuid NOT NULL,
  ref_no              text NOT NULL,
  permit_type         text NOT NULL CHECK (permit_type IN ('general','hot_work','work_at_height','confined_space','excavation','electrical_isolation','lifting','other')),
  work_description    text NOT NULL,
  location            text NOT NULL,
  contractor_id       uuid REFERENCES contractors(id),
  risk_assessment_id  uuid REFERENCES risk_assessments(id),
  valid_from          timestamptz NOT NULL,
  valid_to            timestamptz NOT NULL,
  precautions         jsonb NOT NULL DEFAULT '[]',
  isolations          jsonb NOT NULL DEFAULT '[]',
  gas_test_required   boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','safety_review','authorised','active','suspended','completed','closed','expired','cancelled','rejected')),
  applicant_id        uuid NOT NULL REFERENCES users(id),
  authorised_by       uuid REFERENCES users(id),
  authorised_at       timestamptz,
  closed_by           uuid REFERENCES users(id),
  closed_at           timestamptz,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (site_id, project_id, organization_id) REFERENCES sites (id, project_id, organization_id),
  UNIQUE (organization_id, ref_no),
  CHECK (valid_to > valid_from),
  -- A permit can never be active, suspended or completed without an authoriser other than the applicant.
  CHECK (status NOT IN ('authorised','active','suspended','completed','closed') OR (authorised_by IS NOT NULL AND authorised_by <> applicant_id)),
  CHECK (status <> 'closed' OR closed_by IS NOT NULL)
);
CREATE INDEX permits_scope_idx ON permits (organization_id, project_id, site_id, status);
CREATE INDEX permits_validity_idx ON permits (organization_id, valid_to) WHERE status IN ('authorised','active','suspended');

CREATE TABLE permit_approvals (
  id               bigserial PRIMARY KEY,
  permit_id        uuid NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
  stage            text NOT NULL,
  approver_id      uuid NOT NULL REFERENCES users(id),
  decision         text NOT NULL CHECK (decision IN ('approved','rejected','returned')),
  comment          text NOT NULL DEFAULT '',
  gas_readings     jsonb,
  decided_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX permit_approvals_permit_idx ON permit_approvals (permit_id, id);

/* ---------------------------------------------------------------- inspections & audits */
CREATE TABLE inspection_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  code             text NOT NULL,
  version          integer NOT NULL DEFAULT 1,
  title            text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('site_inspection','equipment_check','audit','management_walk')),
  items            jsonb NOT NULL,           -- [{id, section, text, critical}] frozen per version
  active           boolean NOT NULL DEFAULT true,
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code, version)
);

CREATE TABLE inspections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  project_id       uuid NOT NULL,
  site_id          uuid,
  ref_no           text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('site_inspection','equipment_check','audit','management_walk')),
  template_id      uuid NOT NULL REFERENCES inspection_templates(id),
  title            text NOT NULL,
  location         text NOT NULL DEFAULT '',
  scheduled_for    date NOT NULL,
  status           text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','submitted','reviewed','closed','cancelled')),
  inspector_id     uuid NOT NULL REFERENCES users(id),
  submitted_by     uuid REFERENCES users(id),
  reviewed_by      uuid REFERENCES users(id),
  compliance_pct   numeric(5,1),
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id),
  FOREIGN KEY (site_id, project_id, organization_id) REFERENCES sites (id, project_id, organization_id),
  UNIQUE (organization_id, ref_no),
  CHECK (reviewed_by IS NULL OR submitted_by IS NULL OR reviewed_by <> submitted_by)
);
CREATE INDEX inspections_scope_idx ON inspections (organization_id, project_id, status, scheduled_for);

CREATE TABLE inspection_responses (
  inspection_id    uuid NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  item_id          text NOT NULL,
  response         text NOT NULL CHECK (response IN ('compliant','non_compliant','not_applicable','not_inspected')),
  comment          text NOT NULL DEFAULT '',
  answered_by      uuid NOT NULL REFERENCES users(id),
  answered_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (inspection_id, item_id)
);

/* ---------------------------------------------------------------- incidents & investigations */
CREATE TABLE incidents (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL,
  project_id             uuid NOT NULL,
  site_id                uuid NOT NULL,
  ref_no                 text NOT NULL,
  client_ref             uuid,
  classification         text NOT NULL CHECK (classification IN ('fatality','lost_time_injury','restricted_work','medical_treatment','first_aid','occupational_illness','near_miss','property_damage','environmental','dangerous_occurrence','other')),
  occurred_at            timestamptz NOT NULL,
  location               text NOT NULL,
  description            text NOT NULL,
  immediate_actions      text NOT NULL DEFAULT '',
  -- People involved are kept in a restricted JSON block (minimum necessary), never in list views or exports by default.
  persons_involved       jsonb NOT NULL DEFAULT '[]',
  investigation_summary  text NOT NULL DEFAULT '',
  root_causes            jsonb NOT NULL DEFAULT '[]',
  lessons_learned        text NOT NULL DEFAULT '',
  status                 text NOT NULL DEFAULT 'reported' CHECK (status IN ('reported','under_investigation','pending_review','actions_in_progress','closed','reopened')),
  reported_by            uuid NOT NULL REFERENCES users(id),
  investigation_lead_id  uuid REFERENCES users(id),
  investigation_submitted_by uuid REFERENCES users(id),
  accepted_by            uuid REFERENCES users(id),
  closed_by              uuid REFERENCES users(id),
  closed_at              timestamptz,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (site_id, project_id, organization_id) REFERENCES sites (id, project_id, organization_id),
  UNIQUE (organization_id, ref_no),
  UNIQUE (organization_id, client_ref),
  CHECK (status <> 'closed' OR (closed_by IS NOT NULL AND closed_at IS NOT NULL)),
  CHECK (accepted_by IS NULL OR investigation_submitted_by IS NULL OR accepted_by <> investigation_submitted_by)
);
CREATE INDEX incidents_scope_idx ON incidents (organization_id, project_id, site_id, status);
CREATE INDEX incidents_time_idx ON incidents (organization_id, occurred_at DESC);

/* ---------------------------------------------------------------- corrective actions & gaps */
CREATE TABLE corrective_actions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  project_id        uuid NOT NULL,
  site_id           uuid,
  ref_no            text NOT NULL,
  source_type       text NOT NULL CHECK (source_type IN ('observation','incident','inspection','audit','risk_assessment','permit','gap','drill','environmental','management_review','other')),
  source_id         uuid,
  title             text NOT NULL,
  description       text NOT NULL,
  priority          text NOT NULL CHECK (priority IN ('low','medium','high','critical')),
  control_level     text CHECK (control_level IN ('elimination','substitution','engineering','administrative','ppe')),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','in_progress','pending_verification','verified_closed','cancelled')),
  owner_id          uuid REFERENCES users(id),
  due_date          date,
  raised_by         uuid NOT NULL REFERENCES users(id),
  submitted_by      uuid REFERENCES users(id),
  submitted_at      timestamptz,
  verified_by       uuid REFERENCES users(id),
  verified_at       timestamptz,
  verification_note text NOT NULL DEFAULT '',
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id),
  FOREIGN KEY (site_id, project_id, organization_id) REFERENCES sites (id, project_id, organization_id),
  UNIQUE (organization_id, ref_no),
  CHECK (status NOT IN ('assigned','in_progress','pending_verification') OR (owner_id IS NOT NULL AND due_date IS NOT NULL)),
  -- Closure needs an independent verifier: never the person who submitted the evidence.
  CHECK (status <> 'verified_closed' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL AND (submitted_by IS NULL OR verified_by <> submitted_by)))
);
CREATE INDEX corrective_actions_scope_idx ON corrective_actions (organization_id, project_id, status);
CREATE INDEX corrective_actions_owner_idx ON corrective_actions (owner_id, status) WHERE status IN ('assigned','in_progress','pending_verification');
CREATE INDEX corrective_actions_source_idx ON corrective_actions (organization_id, source_type, source_id);

CREATE TABLE hse_gaps (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  project_id          uuid NOT NULL,
  site_id             uuid,
  ref_no              text NOT NULL,
  requirement         text NOT NULL,
  requirement_source  text NOT NULL DEFAULT '',
  gap_description     text NOT NULL,
  priority            text NOT NULL CHECK (priority IN ('low','medium','high','critical')),
  status              text NOT NULL DEFAULT 'identified' CHECK (status IN ('identified','remediation_planned','in_progress','pending_verification','closed','risk_accepted')),
  owner_id            uuid REFERENCES users(id),
  target_date         date,
  raised_by           uuid NOT NULL REFERENCES users(id),
  submitted_by        uuid REFERENCES users(id),
  verified_by         uuid REFERENCES users(id),
  verified_at         timestamptz,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id),
  FOREIGN KEY (site_id, project_id, organization_id) REFERENCES sites (id, project_id, organization_id),
  UNIQUE (organization_id, ref_no),
  CHECK (status NOT IN ('closed','risk_accepted') OR (verified_by IS NOT NULL AND (submitted_by IS NULL OR verified_by <> submitted_by)))
);
CREATE INDEX hse_gaps_scope_idx ON hse_gaps (organization_id, project_id, status);

/* ---------------------------------------------------------------- training & competency */
CREATE TABLE training_courses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  code             text NOT NULL,
  title            text NOT NULL,
  validity_months  smallint CHECK (validity_months BETWEEN 1 AND 120),
  mandatory_for    jsonb NOT NULL DEFAULT '[]',
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE training_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  worker_id        uuid NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  course_id        uuid NOT NULL REFERENCES training_courses(id),
  completed_on     date NOT NULL,
  expires_on       date,
  provider         text NOT NULL DEFAULT '',
  certificate_no   text NOT NULL DEFAULT '',
  evidence_id      uuid REFERENCES hse_evidence(id),
  recorded_by      uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_on IS NULL OR expires_on >= completed_on)
);
CREATE INDEX training_records_expiry_idx ON training_records (organization_id, expires_on);
CREATE INDEX training_records_worker_idx ON training_records (worker_id, course_id);

/* ---------------------------------------------------------------- environmental & occupational health */
CREATE TABLE environmental_monitoring (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  project_id       uuid NOT NULL,
  site_id          uuid,
  ref_no           text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('dust','noise','air_quality','water','waste','spill','emissions','occupational_exposure','other')),
  parameter        text NOT NULL,
  value            numeric NOT NULL,
  unit             text NOT NULL,
  limit_value      numeric,
  limit_source     text NOT NULL DEFAULT '',
  -- Exceedance is computed only when a configured limit exists; never guessed.
  exceedance       boolean GENERATED ALWAYS AS (limit_value IS NOT NULL AND value > limit_value) STORED,
  location         text NOT NULL DEFAULT '',
  measured_at      timestamptz NOT NULL,
  restricted       boolean NOT NULL DEFAULT false,   -- occupational health readings: restricted visibility
  status           text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','verified','exceedance_open','exceedance_closed')),
  recorded_by      uuid NOT NULL REFERENCES users(id),
  verified_by      uuid REFERENCES users(id),
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id),
  FOREIGN KEY (site_id, project_id, organization_id) REFERENCES sites (id, project_id, organization_id),
  UNIQUE (organization_id, ref_no),
  CHECK (verified_by IS NULL OR verified_by <> recorded_by)
);
CREATE INDEX environmental_monitoring_scope_idx ON environmental_monitoring (organization_id, project_id, kind, measured_at DESC);

/* ---------------------------------------------------------------- emergency preparedness */
CREATE TABLE emergency_drills (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL,
  project_id         uuid NOT NULL,
  site_id            uuid,
  ref_no             text NOT NULL,
  drill_type         text NOT NULL CHECK (drill_type IN ('fire_evacuation','medical','rescue_at_height','confined_space_rescue','spill','gas_release','other')),
  scenario           text NOT NULL,
  planned_for        date NOT NULL,
  conducted_at       timestamptz,
  participants       integer CHECK (participants IS NULL OR participants >= 0),
  response_minutes   numeric(6,1),
  findings           text NOT NULL DEFAULT '',
  status             text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','conducted','actions_open','closed','cancelled')),
  coordinator_id     uuid NOT NULL REFERENCES users(id),
  closed_by          uuid REFERENCES users(id),
  version            integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id),
  FOREIGN KEY (site_id, project_id, organization_id) REFERENCES sites (id, project_id, organization_id),
  UNIQUE (organization_id, ref_no),
  CHECK (status = 'planned' OR status = 'cancelled' OR conducted_at IS NOT NULL)
);
CREATE INDEX emergency_drills_scope_idx ON emergency_drills (organization_id, project_id, status, planned_for);
