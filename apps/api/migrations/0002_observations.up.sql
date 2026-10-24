-- Observations & hazard reporting, status history, attachments.

CREATE TABLE observations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL,
  project_id            uuid NOT NULL,
  site_id               uuid NOT NULL,
  ref_no                text NOT NULL,
  client_ref            uuid,                                   -- idempotency key from offline mobile clients
  type                  text NOT NULL CHECK (type IN ('unsafe_act','unsafe_condition','positive','near_miss_observed')),
  hazard_category       text NOT NULL,
  location              text NOT NULL,
  activity              text NOT NULL DEFAULT '',
  description           text NOT NULL,
  immediate_action      text NOT NULL DEFAULT '',
  likelihood            smallint NOT NULL CHECK (likelihood BETWEEN 1 AND 10),
  severity              smallint NOT NULL CHECK (severity BETWEEN 1 AND 10),
  risk_score            smallint NOT NULL,
  risk_band             text NOT NULL CHECK (risk_band IN ('low','medium','high','critical')),
  observed_at           timestamptz NOT NULL,
  reported_by           uuid NOT NULL REFERENCES users(id),
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','action_submitted','closed','cancelled')),
  assignee_id           uuid REFERENCES users(id),
  due_date              date,
  corrective_action     text NOT NULL DEFAULT '',
  action_taken          text NOT NULL DEFAULT '',
  preventive_action     text NOT NULL DEFAULT '',
  action_submitted_by   uuid REFERENCES users(id),
  action_submitted_at   timestamptz,
  closed_by             uuid REFERENCES users(id),
  closed_at             timestamptz,
  version               integer NOT NULL DEFAULT 1,             -- optimistic concurrency
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (site_id, project_id, organization_id) REFERENCES sites (id, project_id, organization_id),
  UNIQUE (organization_id, ref_no),
  UNIQUE (organization_id, client_ref),
  CHECK (status <> 'assigned' OR (assignee_id IS NOT NULL AND due_date IS NOT NULL)),
  CHECK (status <> 'closed' OR closed_at IS NOT NULL)
);
CREATE INDEX observations_scope_idx   ON observations (organization_id, project_id, site_id, status);
CREATE INDEX observations_time_idx    ON observations (organization_id, observed_at DESC);
CREATE INDEX observations_assignee_idx ON observations (assignee_id, status) WHERE status IN ('assigned','action_submitted');
CREATE INDEX observations_due_idx     ON observations (organization_id, due_date) WHERE status = 'assigned';

CREATE TABLE observation_events (
  id               bigserial PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  observation_id   uuid NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  actor_user_id    uuid NOT NULL REFERENCES users(id),
  event            text NOT NULL,
  from_status      text,
  to_status        text,
  comment          text NOT NULL DEFAULT '',
  data             jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX observation_events_obs_idx ON observation_events (observation_id, id);

CREATE TABLE attachments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  project_id       uuid NOT NULL,
  entity_type      text NOT NULL CHECK (entity_type IN ('observation')),
  entity_id        uuid NOT NULL,
  purpose          text NOT NULL DEFAULT 'evidence' CHECK (purpose IN ('evidence','closure')),
  filename         text NOT NULL,
  content_type     text NOT NULL,
  size_bytes       integer NOT NULL CHECK (size_bytes > 0),
  sha256           text NOT NULL,
  storage_key      text NOT NULL UNIQUE,
  uploaded_by      uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
);
CREATE INDEX attachments_entity_idx ON attachments (entity_type, entity_id) WHERE deleted_at IS NULL;
