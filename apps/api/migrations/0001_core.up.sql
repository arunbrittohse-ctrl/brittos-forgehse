-- FORGEHSE core schema: tenancy, identity, RBAC, sessions, audit, numbering.
-- gen_random_uuid() is built into PostgreSQL 13+.

CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 160),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text NOT NULL CHECK (email = lower(email) AND position('@' in email) > 1),
  full_name             text NOT NULL,
  job_title             text NOT NULL DEFAULT '',
  password_hash         text NOT NULL,
  active                boolean NOT NULL DEFAULT true,
  must_change_password  boolean NOT NULL DEFAULT false,
  failed_logins         integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (email);

CREATE TABLE projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code             text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  name             text NOT NULL,
  client           text NOT NULL DEFAULT '',
  location         text NOT NULL DEFAULT '',
  start_date       date,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','closed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (id, organization_id)            -- target for tenant-consistent composite FKs
);

CREATE TABLE sites (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  project_id       uuid NOT NULL,
  code             text NOT NULL CHECK (code ~ '^[A-Z0-9-]{1,20}$'),
  name             text NOT NULL,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id) ON DELETE RESTRICT,
  UNIQUE (project_id, code),
  UNIQUE (id, project_id, organization_id)
);

CREATE TABLE role_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('super_admin','org_admin','corporate_hse_manager','project_hse_manager',
                                                 'hse_engineer','hse_officer','project_manager','site_engineer','supervisor','viewer')),
  project_id       uuid,
  site_id          uuid,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (site_id IS NULL OR project_id IS NOT NULL),
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id),
  FOREIGN KEY (site_id, project_id, organization_id) REFERENCES sites (id, project_id, organization_id)
);
CREATE INDEX role_assignments_user_idx ON role_assignments (user_id, organization_id);
CREATE UNIQUE INDEX role_assignments_uq ON role_assignments
  (user_id, organization_id, role, coalesce(project_id, '00000000-0000-0000-0000-000000000000'), coalesce(site_id, '00000000-0000-0000-0000-000000000000'));

CREATE TABLE sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash       bytea NOT NULL UNIQUE,     -- SHA-256 of the bearer token; raw token never stored
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client           text NOT NULL CHECK (client IN ('web','mobile')),
  ip               text,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

-- Append-only audit trail. Updates and deletes are blocked by trigger, including for the application role.
CREATE TABLE audit_log (
  id               bigserial PRIMARY KEY,
  organization_id  uuid REFERENCES organizations(id),
  actor_user_id    uuid REFERENCES users(id),
  action           text NOT NULL,
  entity_type      text NOT NULL,
  entity_id        uuid,
  project_id       uuid,
  summary          text NOT NULL DEFAULT '',
  changes          jsonb,
  ip               text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_idx ON audit_log (organization_id, created_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);

CREATE FUNCTION forbid_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_mutation();

-- Reference-number engine: gap-free per organisation / scope / year, allocated inside the caller's transaction.
CREATE TABLE number_sequences (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope            text NOT NULL,
  year             integer NOT NULL,
  value            integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, scope, year)
);
