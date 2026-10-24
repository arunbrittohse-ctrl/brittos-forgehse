-- Durable object storage inside PostgreSQL, for hosts without a persistent disk (serverless).
-- Holds uploaded evidence photos and Studio source documents. Keys are server-generated.
CREATE TABLE object_store (
  key           text PRIMARY KEY,
  content_type  text NOT NULL,
  size_bytes    integer NOT NULL,
  data_b64      text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
