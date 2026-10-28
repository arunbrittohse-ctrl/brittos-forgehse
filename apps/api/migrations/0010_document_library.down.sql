-- Reverses 0010. Drops ONLY the library tables (and the metadata in them).
-- Stored objects (storage_key) are left in object storage; remove them separately if required.
DROP TABLE IF EXISTS library_download_links, library_uploads, library_links;
ALTER TABLE IF EXISTS library_files DROP CONSTRAINT IF EXISTS library_files_current_version_fk;
DROP TRIGGER IF EXISTS library_versions_guard ON library_versions;
DROP TABLE IF EXISTS library_versions, library_files;
DROP FUNCTION IF EXISTS library_versions_guard();
