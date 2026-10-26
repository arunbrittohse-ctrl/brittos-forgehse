-- BRITTO'S FORGEHSE domain foundation.
-- Generic, tenant-scoped record envelope for staged modules. Domain-specific normalized
-- tables and endpoints should be introduced with each feature phase when its workflow is defined.
CREATE TABLE hse_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  site_id uuid,
  domain text NOT NULL CHECK (domain IN (
    'document','risk_assessment','permit','inspection','audit','incident',
    'corrective_action','training','contractor','environmental','emergency',
    'workforce','man_hours'
  )),
  reference text NOT NULL CHECK (length(reference) BETWEEN 3 AND 40),
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','submitted','under_review','approved','active','suspended',
    'action_required','closed','rejected','cancelled'
  )),
  owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  due_date date,
  submitted_at timestamptz,
  closed_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (site_id, project_id, organization_id) REFERENCES sites(id, project_id, organization_id) ON DELETE RESTRICT,
  UNIQUE (organization_id, reference),
  UNIQUE (id, organization_id),
  CHECK (status <> 'closed' OR closed_at IS NOT NULL),
  CHECK (status NOT IN ('submitted','under_review','approved','active','suspended','action_required','closed') OR submitted_at IS NOT NULL)
);
CREATE INDEX hse_records_scope_idx ON hse_records (organization_id, project_id, site_id, domain, status);
CREATE INDEX hse_records_owner_idx ON hse_records (organization_id, owner_user_id, status);
CREATE INDEX hse_records_due_idx ON hse_records (organization_id, due_date) WHERE due_date IS NOT NULL AND status NOT IN ('closed','cancelled');
CREATE INDEX hse_records_payload_gin_idx ON hse_records USING gin (payload);

CREATE TABLE hse_record_events (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  record_id uuid NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'created','updated','submitted','review_started','approved','rejected','activated',
    'suspended','resumed','action_assigned','action_submitted','verified','closed',
    'reopened','cancelled','attachment_added','revision_created','comment_added'
  )),
  from_status text CHECK (from_status IS NULL OR from_status IN (
    'draft','submitted','under_review','approved','active','suspended','action_required','closed','rejected','cancelled'
  )),
  to_status text CHECK (to_status IS NULL OR to_status IN (
    'draft','submitted','under_review','approved','active','suspended','action_required','closed','rejected','cancelled'
  )),
  comment text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (record_id, organization_id) REFERENCES hse_records(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX hse_record_events_record_idx ON hse_record_events (record_id, id);
CREATE INDEX hse_record_events_org_time_idx ON hse_record_events (organization_id, created_at DESC);

CREATE TABLE hse_record_revisions (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  record_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  changed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  change_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (record_id, organization_id) REFERENCES hse_records(id, organization_id) ON DELETE RESTRICT,
  UNIQUE (record_id, version)
);
CREATE INDEX hse_record_revisions_org_time_idx ON hse_record_revisions (organization_id, created_at DESC);

CREATE TABLE hse_record_links (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  source_record_id uuid NOT NULL,
  target_record_id uuid NOT NULL,
  relationship text NOT NULL CHECK (relationship IN (
    'corrective_action','evidence_for','derived_from','supersedes',
    'related_to','permit_for','inspection_of','investigates'
  )),
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_record_id, target_record_id, relationship),
  CHECK (source_record_id <> target_record_id),
  FOREIGN KEY (source_record_id, organization_id) REFERENCES hse_records(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (target_record_id, organization_id) REFERENCES hse_records(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX hse_record_links_target_idx ON hse_record_links (organization_id, target_record_id, relationship);

-- Record events, revisions and links are retained for auditability; application-level
-- authorization must still scope every query by the authenticated organisation/project/site.
