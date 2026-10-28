-- Permit to Work goes live: the foundation `permits` table (0007, no rows written by the app yet)
-- gains the fields the workflow needs, an append-only event history replaces the unused
-- permit_approvals table, and library files can be linked to permits.

ALTER TABLE permits DROP CONSTRAINT permits_permit_type_check;
ALTER TABLE permits ADD CONSTRAINT permits_permit_type_check
  CHECK (permit_type IN ('general','hot_work','cold_work','work_at_height','confined_space','excavation','electrical_isolation','lifting','other'));

ALTER TABLE permits
  ADD COLUMN contractor_name        text NOT NULL DEFAULT '',
  ADD COLUMN crew                   jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN equipment              text NOT NULL DEFAULT '',
  ADD COLUMN emergency_arrangements text NOT NULL DEFAULT '',
  ADD COLUMN details                jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN checks                 jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN gas_tests              jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN hazard_ids             uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN submitted_at           timestamptz,
  ADD COLUMN reviewed_by            uuid REFERENCES users(id),
  ADD COLUMN reviewed_at            timestamptz,
  ADD COLUMN accepted_by            uuid REFERENCES users(id),
  ADD COLUMN accepted_at            timestamptz,
  ADD COLUMN suspended_at           timestamptz,
  ADD COLUMN completed_by           uuid REFERENCES users(id),
  ADD COLUMN completed_at           timestamptz,
  ADD COLUMN completion_note        text,
  ADD COLUMN closure_note           text,
  ADD COLUMN decision_note          text,
  ADD COLUMN created_by             uuid REFERENCES users(id),
  ADD COLUMN updated_by             uuid REFERENCES users(id);

-- Closing needs someone other than the applicant and the person who handed the work back.
ALTER TABLE permits ADD CONSTRAINT permits_close_independent
  CHECK (status <> 'closed' OR (closed_by <> applicant_id AND (completed_by IS NULL OR closed_by <> completed_by)));
ALTER TABLE permits ADD CONSTRAINT permits_completed_has_note
  CHECK (status NOT IN ('completed','closed') OR coalesce(completion_note, '') <> '');

DROP TABLE permit_approvals;

CREATE TABLE permit_events (
  id               bigserial PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  permit_id        uuid NOT NULL REFERENCES permits(id),
  event            text NOT NULL,
  from_status      text,
  to_status        text NOT NULL,
  actor_id         uuid REFERENCES users(id),          -- NULL = automatic (expiry)
  note             text NOT NULL DEFAULT '',
  data             jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX permit_events_permit_idx ON permit_events (permit_id, id);
CREATE FUNCTION permit_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'permit_events is append-only' USING ERRCODE = 'insufficient_privilege'; END $$;
CREATE TRIGGER permit_events_no_update BEFORE UPDATE OR DELETE ON permit_events FOR EACH ROW EXECUTE FUNCTION permit_events_immutable();

ALTER TABLE library_links DROP CONSTRAINT library_links_record_type_check;
ALTER TABLE library_links ADD CONSTRAINT library_links_record_type_check CHECK (record_type IN ('observation','hazard','document','permit'));
