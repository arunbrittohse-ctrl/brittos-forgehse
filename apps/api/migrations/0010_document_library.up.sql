-- Document & evidence library: files, immutable versions, links to HSE records,
-- staged uploads and short-lived download links. Binary data lives in object storage
-- (storage_key); only metadata and relationships are kept here.

CREATE TABLE library_files (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  project_id       uuid REFERENCES projects(id),          -- NULL = organisation-wide file
  site_id          uuid REFERENCES sites(id),
  ref_no           text NOT NULL,
  title            text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  doc_number       text NOT NULL DEFAULT '',
  doc_type         text NOT NULL,
  category         text NOT NULL DEFAULT '',
  tags             text[] NOT NULL DEFAULT '{}',
  description      text NOT NULL DEFAULT '',
  confidentiality  text NOT NULL DEFAULT 'internal' CHECK (confidentiality IN ('internal','confidential','restricted')),
  retention        text NOT NULL DEFAULT 'project' CHECK (retention IN ('project','statutory','permanent','temporary')),
  owner_id         uuid REFERENCES users(id),
  issue_date       date,
  expiry_date      date,
  latest_version   integer NOT NULL DEFAULT 0,
  current_version_id uuid,                                 -- latest approved version, if any
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','obsolete')),
  obsolete_reason  text,
  created_by       uuid NOT NULL REFERENCES users(id),
  updated_by       uuid NOT NULL REFERENCES users(id),
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, ref_no),
  CHECK (site_id IS NULL OR project_id IS NOT NULL),
  CHECK (expiry_date IS NULL OR issue_date IS NULL OR expiry_date >= issue_date),
  CHECK (status = 'active' OR obsolete_reason IS NOT NULL)
);
CREATE INDEX library_files_scope_idx ON library_files (organization_id, project_id, site_id, status);
CREATE INDEX library_files_expiry_idx ON library_files (organization_id, expiry_date) WHERE status = 'active' AND expiry_date IS NOT NULL;
CREATE INDEX library_files_tags_idx ON library_files USING gin (tags);

CREATE TABLE library_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  file_id          uuid NOT NULL REFERENCES library_files(id),
  version_no       integer NOT NULL CHECK (version_no >= 1),
  filename         text NOT NULL,
  content_type     text NOT NULL,
  size_bytes       integer NOT NULL CHECK (size_bytes > 0),
  sha256           text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key      text NOT NULL UNIQUE,
  change_note      text NOT NULL DEFAULT '',
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','under_review','approved','rejected','superseded')),
  uploaded_by      uuid NOT NULL REFERENCES users(id),
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  submitted_by     uuid REFERENCES users(id),
  submitted_at     timestamptz,
  decided_by       uuid REFERENCES users(id),
  decided_at       timestamptz,
  decision_note    text,
  UNIQUE (file_id, version_no),
  -- Segregation of duties, enforced by the database as well as the API.
  CHECK (status NOT IN ('approved','rejected') OR (decided_by IS NOT NULL AND decided_by <> uploaded_by)),
  CHECK (status <> 'rejected' OR coalesce(decision_note, '') <> '')
);
CREATE INDEX library_versions_file_idx ON library_versions (file_id, version_no DESC);
CREATE INDEX library_versions_review_idx ON library_versions (organization_id, status) WHERE status = 'under_review';
ALTER TABLE library_files ADD CONSTRAINT library_files_current_version_fk FOREIGN KEY (current_version_id) REFERENCES library_versions(id);

-- A version's content and provenance never change and versions are never deleted.
-- Only the review fields may move forward, and an approved version can only become superseded.
CREATE FUNCTION library_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'library versions cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.file_id <> OLD.file_id OR NEW.version_no <> OLD.version_no OR NEW.filename <> OLD.filename OR NEW.content_type <> OLD.content_type
     OR NEW.size_bytes <> OLD.size_bytes OR NEW.sha256 <> OLD.sha256 OR NEW.storage_key <> OLD.storage_key
     OR NEW.uploaded_by <> OLD.uploaded_by OR NEW.uploaded_at <> OLD.uploaded_at OR NEW.organization_id <> OLD.organization_id THEN
    RAISE EXCEPTION 'library version content is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('rejected','superseded') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'a % version cannot change status', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'approved' AND NEW.status NOT IN ('approved','superseded') THEN
    RAISE EXCEPTION 'an approved version can only be superseded' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER library_versions_guard BEFORE UPDATE OR DELETE ON library_versions FOR EACH ROW EXECUTE FUNCTION library_versions_guard();

CREATE TABLE library_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  file_id          uuid NOT NULL REFERENCES library_files(id),
  record_type      text NOT NULL CHECK (record_type IN ('observation','hazard','document')),
  record_id        uuid NOT NULL,
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_id, record_type, record_id)
);
CREATE INDEX library_links_record_idx ON library_links (organization_id, record_type, record_id);

-- Bytes uploaded but not yet attached to a file (two-step upload). Expire after an hour.
CREATE TABLE library_uploads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  uploaded_by      uuid NOT NULL REFERENCES users(id),
  filename         text NOT NULL,
  content_type     text NOT NULL,
  size_bytes       integer NOT NULL CHECK (size_bytes > 0),
  sha256           text NOT NULL,
  storage_key      text NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '1 hour'
);
CREATE INDEX library_uploads_expiry_idx ON library_uploads (expires_at);

-- Short-lived download links. Only a hash of the token is stored.
CREATE TABLE library_download_links (
  token_hash       bytea PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  version_id       uuid NOT NULL REFERENCES library_versions(id),
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 hour')
);
CREATE INDEX library_download_links_expiry_idx ON library_download_links (expires_at);
