-- Reverses 0008. Drops ONLY the Document Studio tables (and any data in them).
DROP TRIGGER IF EXISTS hse_document_revisions_no_update ON hse_document_revisions;
DROP TABLE IF EXISTS hse_document_revisions, hse_documents;
DROP FUNCTION IF EXISTS hse_document_revisions_immutable();
