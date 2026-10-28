-- 0009: Hazard register and risk review workflow (Phase 4). Additive only.
-- Status values mirror hazardLifecycle in packages/shared/src/hazards/register.ts.

CREATE TABLE hazard_register (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id),
  project_id             uuid NOT NULL,
  site_id                uuid,
  ref_no                 text NOT NULL,
  category               text NOT NULL CHECK (length(category) BETWEEN 1 AND 60),
  activity               text NOT NULL,
  work_package           text NOT NULL DEFAULT '',
  description            text NOT NULL,
  consequences           text NOT NULL,
  persons_exposed        text NOT NULL,
  existing_controls      jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(existing_controls) = 'array'),
  initial_likelihood     smallint CHECK (initial_likelihood BETWEEN 1 AND 10),
  initial_severity       smallint CHECK (initial_severity BETWEEN 1 AND 10),
  additional_controls    jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(additional_controls) = 'array'),
  residual_likelihood    smallint CHECK (residual_likelihood BETWEEN 1 AND 10),
  residual_severity      smallint CHECK (residual_severity BETWEEN 1 AND 10),
  residual_justification text NOT NULL DEFAULT '',
  -- Scores/bands as calculated by the engine at the last save, on the matrix stored below. Kept for filtering.
  initial_score          smallint, initial_band text CHECK (initial_band IN ('low','medium','high','critical')),
  residual_score         smallint, residual_band text CHECK (residual_band IN ('low','medium','high','critical')),
  risk_matrix            jsonb NOT NULL,
  review_date            date,
  revision               integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  status                 text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','reviewed','approved','rejected','archived')),
  source_document_id     uuid REFERENCES hse_documents(id),
  created_by             uuid NOT NULL REFERENCES users(id),
  updated_by             uuid NOT NULL REFERENCES users(id),
  submitted_by           uuid REFERENCES users(id), submitted_at timestamptz,
  reviewed_by            uuid REFERENCES users(id), reviewed_at  timestamptz,
  approved_by            uuid REFERENCES users(id), approved_at  timestamptz,
  decision_note          text,
  archived_reason        text,
  version                integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id),
  FOREIGN KEY (site_id, project_id, organization_id) REFERENCES sites (id, project_id, organization_id),
  UNIQUE (organization_id, ref_no),
  CHECK (status NOT IN ('submitted','reviewed','approved') OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)),
  CHECK (status <> 'reviewed' OR (reviewed_by IS NOT NULL AND reviewed_by <> submitted_by)),
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_by <> submitted_by)),
  -- An approved entry is always fully rated and never approved with an intolerable residual risk.
  CHECK (status <> 'approved' OR (initial_score IS NOT NULL AND residual_score IS NOT NULL AND residual_band <> 'critical' AND residual_score <= initial_score)),
  CHECK (status <> 'archived' OR archived_reason IS NOT NULL)
);
CREATE INDEX hazard_register_scope_idx ON hazard_register (organization_id, project_id, site_id, status);
CREATE INDEX hazard_register_band_idx ON hazard_register (organization_id, residual_band, category);
CREATE INDEX hazard_register_review_idx ON hazard_register (organization_id, review_date) WHERE status = 'approved';

CREATE TABLE hazard_register_revisions (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  hazard_id       uuid NOT NULL REFERENCES hazard_register(id),
  event           text NOT NULL CHECK (event IN ('created','imported','saved','submitted','reviewed','approved','rejected','rework','revised','archived','linked','unlinked')),
  revision        integer NOT NULL,
  version         integer NOT NULL,
  status          text NOT NULL,
  snapshot        jsonb NOT NULL,
  note            text NOT NULL DEFAULT '',
  actor_id        uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hazard_id, version)
);
CREATE INDEX hazard_register_revisions_idx ON hazard_register_revisions (hazard_id, id DESC);
CREATE FUNCTION hazard_register_revisions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'hazard_register_revisions is append-only' USING ERRCODE = 'insufficient_privilege'; END $$;
CREATE TRIGGER hazard_register_revisions_no_update BEFORE UPDATE OR DELETE ON hazard_register_revisions
  FOR EACH ROW EXECUTE FUNCTION hazard_register_revisions_immutable();

-- Links from a hazard to the records that control or evidence it. Only modules that exist are linkable.
CREATE TABLE hazard_links (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  hazard_id       uuid NOT NULL REFERENCES hazard_register(id),
  link_type       text NOT NULL CHECK (link_type IN ('document','observation')),
  target_id       uuid NOT NULL,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hazard_id, link_type, target_id)
);
CREATE INDEX hazard_links_target_idx ON hazard_links (organization_id, link_type, target_id);
