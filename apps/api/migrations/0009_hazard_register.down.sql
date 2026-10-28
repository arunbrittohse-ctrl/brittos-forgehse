-- Reverses 0009. Drops ONLY the hazard register tables (and any data in them).
DROP TABLE IF EXISTS hazard_links;
DROP TRIGGER IF EXISTS hazard_register_revisions_no_update ON hazard_register_revisions;
DROP TABLE IF EXISTS hazard_register_revisions, hazard_register;
DROP FUNCTION IF EXISTS hazard_register_revisions_immutable();
