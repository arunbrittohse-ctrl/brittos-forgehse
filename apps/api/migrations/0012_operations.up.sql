-- Phase 6: corrective & preventive actions, incidents & investigations, inspections & audits go live.
-- The foundation tables (0007) had no rows written by the app; this adds the workflow fields,
-- makes the shared event history append-only and lets library files link to these records.

-- CAPA
ALTER TABLE corrective_actions DROP CONSTRAINT corrective_actions_source_type_check;
ALTER TABLE corrective_actions ADD CONSTRAINT corrective_actions_source_type_check
  CHECK (source_type IN ('observation','incident','inspection','audit','risk_assessment','hazard','permit','gap','drill','environmental','management_review','other'));
ALTER TABLE corrective_actions
  ADD COLUMN completion_note text NOT NULL DEFAULT '',
  ADD COLUMN cancel_reason   text,
  ADD COLUMN updated_by      uuid REFERENCES users(id);
-- The owner of an action never verifies it either.
ALTER TABLE corrective_actions ADD CONSTRAINT corrective_actions_verifier_not_owner
  CHECK (status <> 'verified_closed' OR owner_id IS NULL OR verified_by <> owner_id);
ALTER TABLE corrective_actions ADD CONSTRAINT corrective_actions_cancel_reason
  CHECK (status <> 'cancelled' OR coalesce(cancel_reason, '') <> '');

-- Incidents
ALTER TABLE incidents
  ADD COLUMN potential_severity       integer CHECK (potential_severity BETWEEN 1 AND 5),
  ADD COLUMN external_notifications   jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN investigation_submitted_at timestamptz,
  ADD COLUMN accepted_at              timestamptz,
  ADD COLUMN review_note              text,
  ADD COLUMN close_note               text,
  ADD COLUMN updated_by               uuid REFERENCES users(id);
ALTER TABLE incidents ADD CONSTRAINT incidents_close_independent
  CHECK (status <> 'closed' OR investigation_submitted_by IS NULL OR closed_by <> investigation_submitted_by);

-- Inspections
ALTER TABLE inspections
  ADD COLUMN created_by    uuid REFERENCES users(id),
  ADD COLUMN started_at    timestamptz,
  ADD COLUMN submitted_at  timestamptz,
  ADD COLUMN reviewed_at   timestamptz,
  ADD COLUMN review_note   text,
  ADD COLUMN closed_by     uuid REFERENCES users(id),
  ADD COLUMN closed_at     timestamptz,
  ADD COLUMN summary       text NOT NULL DEFAULT '',
  ADD COLUMN updated_by    uuid REFERENCES users(id);
ALTER TABLE inspection_responses
  ADD COLUMN closed_on_spot boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT inspection_responses_finding_comment CHECK (response <> 'non_compliant' OR comment <> '');

-- Shared status history becomes append-only.
CREATE FUNCTION domain_record_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'domain_record_events is append-only' USING ERRCODE = 'insufficient_privilege'; END $$;
CREATE TRIGGER domain_record_events_no_update BEFORE UPDATE OR DELETE ON domain_record_events FOR EACH ROW EXECUTE FUNCTION domain_record_events_immutable();

ALTER TABLE library_links DROP CONSTRAINT library_links_record_type_check;
ALTER TABLE library_links ADD CONSTRAINT library_links_record_type_check
  CHECK (record_type IN ('observation','hazard','document','permit','action','incident','inspection'));
