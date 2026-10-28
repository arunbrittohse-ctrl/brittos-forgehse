-- Reverses 0011. Permit rows written by the workflow keep their core columns; the added
-- columns, the event history and permit links from the library are removed.
DELETE FROM library_links WHERE record_type = 'permit';
ALTER TABLE library_links DROP CONSTRAINT library_links_record_type_check;
ALTER TABLE library_links ADD CONSTRAINT library_links_record_type_check CHECK (record_type IN ('observation','hazard','document'));

DROP TRIGGER IF EXISTS permit_events_no_update ON permit_events;
DROP TABLE IF EXISTS permit_events;
DROP FUNCTION IF EXISTS permit_events_immutable();

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

ALTER TABLE permits DROP CONSTRAINT IF EXISTS permits_close_independent, DROP CONSTRAINT IF EXISTS permits_completed_has_note;
ALTER TABLE permits
  DROP COLUMN contractor_name, DROP COLUMN crew, DROP COLUMN equipment, DROP COLUMN emergency_arrangements, DROP COLUMN details,
  DROP COLUMN checks, DROP COLUMN gas_tests, DROP COLUMN hazard_ids, DROP COLUMN submitted_at, DROP COLUMN reviewed_by, DROP COLUMN reviewed_at,
  DROP COLUMN accepted_by, DROP COLUMN accepted_at, DROP COLUMN suspended_at, DROP COLUMN completed_by, DROP COLUMN completed_at,
  DROP COLUMN completion_note, DROP COLUMN closure_note, DROP COLUMN decision_note, DROP COLUMN created_by, DROP COLUMN updated_by;
UPDATE permits SET permit_type = 'general' WHERE permit_type = 'cold_work';
ALTER TABLE permits DROP CONSTRAINT permits_permit_type_check;
ALTER TABLE permits ADD CONSTRAINT permits_permit_type_check
  CHECK (permit_type IN ('general','hot_work','work_at_height','confined_space','excavation','electrical_isolation','lifting','other'));
