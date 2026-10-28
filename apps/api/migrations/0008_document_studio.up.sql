-- 0008: HSE Document Studio — controlled documents with revision history.
-- Additive only. Status values mirror documentStudioLifecycle in packages/shared/src/documents/readiness.ts
-- (apps/api/test/domains.test.ts keeps them in sync).

CREATE TABLE hse_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  project_id       uuid,
  site_id          uuid,
  doc_number       text NOT NULL,
  doc_type         text NOT NULL CHECK (doc_type IN (
    'risk_assessment','jsa','method_statement','project_hse_plan','emergency_response_plan','work_method_plan',
    'logistics_plan','traffic_management_plan','safe_work_procedure','hse_policy','qhse_policy',
    'environmental_management_plan','inspection_checklist','toolbox_talk','training_material','hse_audit_report',
    'incident_investigation_report','closeout_handover_report')),
  title            text NOT NULL CHECK (length(title) BETWEEN 3 AND 160),
  revision         integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','withdrawn')),
  inputs           jsonb NOT NULL CHECK (jsonb_typeof(inputs) = 'object'),
  content          jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  -- The organisation's risk matrix at the time the document was created; ratings are read on this matrix.
  risk_matrix      jsonb NOT NULL,
  generator        jsonb NOT NULL,
  created_by       uuid NOT NULL REFERENCES users(id),
  updated_by       uuid NOT NULL REFERENCES users(id),
  submitted_by     uuid REFERENCES users(id),
  submitted_at     timestamptz,
  approved_by      uuid REFERENCES users(id),
  approved_at      timestamptz,
  decision_note    text,
  withdrawn_reason text,
  version          integer NOT NULL DEFAULT 1 CHECK (version > 0),
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id),
  FOREIGN KEY (site_id, project_id, organization_id) REFERENCES sites (id, project_id, organization_id),
  UNIQUE (organization_id, doc_number),
  CHECK (site_id IS NULL OR project_id IS NOT NULL),
  CHECK (status NOT IN ('in_review','approved') OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)),
  -- An approved document always names an approver who is not the person who submitted it.
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_by <> submitted_by)),
  CHECK (status <> 'withdrawn' OR withdrawn_reason IS NOT NULL)
);
CREATE INDEX hse_documents_scope_idx ON hse_documents (organization_id, project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX hse_documents_updated_idx ON hse_documents (organization_id, updated_at DESC) WHERE deleted_at IS NULL;

-- Append-only history: every generation, save, submission, decision and new revision is a row.
CREATE TABLE hse_document_revisions (
  id               bigserial PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  document_id      uuid NOT NULL REFERENCES hse_documents(id),
  event            text NOT NULL CHECK (event IN ('generated','saved','regenerated','restored','submitted','approved','returned','new_revision','withdrawn')),
  revision         integer NOT NULL,
  version          integer NOT NULL,
  status           text NOT NULL,
  title            text NOT NULL,
  inputs           jsonb NOT NULL,
  content          jsonb NOT NULL,
  note             text NOT NULL DEFAULT '',
  actor_id         uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);
CREATE INDEX hse_document_revisions_doc_idx ON hse_document_revisions (document_id, id DESC);

CREATE FUNCTION hse_document_revisions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'hse_document_revisions is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER hse_document_revisions_no_update BEFORE UPDATE OR DELETE ON hse_document_revisions
  FOR EACH ROW EXECUTE FUNCTION hse_document_revisions_immutable();
