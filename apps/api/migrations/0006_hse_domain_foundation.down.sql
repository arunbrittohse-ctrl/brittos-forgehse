-- Roll back only the Phase 1 generic HSE domain foundation.
-- Domain-specific feature migrations must not depend on these tables without an explicit migration plan.
DROP TABLE IF EXISTS hse_record_links;
DROP TABLE IF EXISTS hse_record_revisions;
DROP TABLE IF EXISTS hse_record_events;
DROP TABLE IF EXISTS hse_records;
