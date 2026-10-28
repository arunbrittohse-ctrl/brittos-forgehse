-- Reverses 0012. Rows keep their core columns; the added workflow columns and links are removed.
DELETE FROM library_links WHERE record_type IN ('action','incident','inspection');
ALTER TABLE library_links DROP CONSTRAINT library_links_record_type_check;
ALTER TABLE library_links ADD CONSTRAINT library_links_record_type_check CHECK (record_type IN ('observation','hazard','document','permit'));

DROP TRIGGER IF EXISTS domain_record_events_no_update ON domain_record_events;
DROP FUNCTION IF EXISTS domain_record_events_immutable();

ALTER TABLE inspection_responses DROP CONSTRAINT IF EXISTS inspection_responses_finding_comment, DROP COLUMN closed_on_spot;
ALTER TABLE inspections DROP COLUMN created_by, DROP COLUMN started_at, DROP COLUMN submitted_at, DROP COLUMN reviewed_at, DROP COLUMN review_note,
  DROP COLUMN closed_by, DROP COLUMN closed_at, DROP COLUMN summary, DROP COLUMN updated_by;

ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_close_independent;
ALTER TABLE incidents DROP COLUMN potential_severity, DROP COLUMN external_notifications, DROP COLUMN investigation_submitted_at,
  DROP COLUMN accepted_at, DROP COLUMN review_note, DROP COLUMN close_note, DROP COLUMN updated_by;

ALTER TABLE corrective_actions DROP CONSTRAINT IF EXISTS corrective_actions_verifier_not_owner, DROP CONSTRAINT IF EXISTS corrective_actions_cancel_reason;
ALTER TABLE corrective_actions DROP COLUMN completion_note, DROP COLUMN cancel_reason, DROP COLUMN updated_by;
UPDATE corrective_actions SET source_type = 'risk_assessment' WHERE source_type = 'hazard';
ALTER TABLE corrective_actions DROP CONSTRAINT corrective_actions_source_type_check;
ALTER TABLE corrective_actions ADD CONSTRAINT corrective_actions_source_type_check
  CHECK (source_type IN ('observation','incident','inspection','audit','risk_assessment','permit','gap','drill','environmental','management_review','other'));
