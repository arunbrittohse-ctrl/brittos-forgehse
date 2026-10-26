-- Reverses 0007. Drops ONLY the tables created by 0007 (and any data in them).
DROP TABLE IF EXISTS emergency_drills, environmental_monitoring, training_records, training_courses,
  hse_gaps, corrective_actions, incidents, inspection_responses, inspections, inspection_templates,
  permit_approvals, permits, workers, contractors, risk_assessment_items, risk_assessments, hazard_library,
  document_revisions, controlled_documents, hse_evidence, record_revisions, domain_record_events;
