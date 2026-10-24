-- HSE Studio (AI-generated drafts with human review) and assistant conversations.
-- Every row is tenant-scoped by organization_id; project_id, when set, must belong to the same organisation.

CREATE TABLE studio_sources (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  uploaded_by      uuid NOT NULL REFERENCES users(id),
  file_name        text NOT NULL CHECK (length(file_name) <= 200),
  content_type     text NOT NULL,
  size_bytes       integer NOT NULL CHECK (size_bytes > 0),
  storage_key      text NOT NULL UNIQUE,
  extracted_text   text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX studio_sources_org_idx ON studio_sources (organization_id, uploaded_by);

CREATE TABLE studio_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  project_id       uuid,
  created_by       uuid NOT NULL REFERENCES users(id),
  kind             text NOT NULL CHECK (kind IN ('checklist','document','poster','flowchart','review')),
  title            text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  brief            text NOT NULL,
  content          jsonb NOT NULL,
  source_id        uuid REFERENCES studio_sources(id),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','reviewed')),
  ai_generated     boolean NOT NULL DEFAULT true,
  reviewed_by      uuid REFERENCES users(id),
  reviewed_at      timestamptz,
  review_note      text,
  version          integer NOT NULL DEFAULT 1,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id),
  CHECK ((status = 'reviewed') = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX studio_items_org_idx ON studio_items (organization_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE ai_conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  user_id          uuid NOT NULL REFERENCES users(id),
  project_id       uuid,
  title            text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id)
);
CREATE INDEX ai_conversations_user_idx ON ai_conversations (organization_id, user_id, updated_at DESC);

CREATE TABLE ai_messages (
  id               bigserial PRIMARY KEY,
  conversation_id  uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('user','assistant')),
  content          text NOT NULL,
  citations        jsonb NOT NULL DEFAULT '[]',
  actions          jsonb NOT NULL DEFAULT '[]',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_conv_idx ON ai_messages (conversation_id, id);
