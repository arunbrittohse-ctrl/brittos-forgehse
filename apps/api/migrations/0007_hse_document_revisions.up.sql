CREATE TABLE hse_document_revisions (
  id bigserial PRIMARY KEY,
  studio_item_id uuid NOT NULL REFERENCES studio_items(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  changed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  change_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (studio_item_id, version)
);
CREATE INDEX hse_document_revisions_org_time_idx ON hse_document_revisions (organization_id, created_at DESC);
