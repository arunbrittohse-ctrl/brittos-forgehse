-- Claude API usage telemetry. Stores token counts and metadata only — never prompt or response text.

CREATE TABLE ai_usage (
  id                           bigserial PRIMARY KEY,
  organization_id              uuid NOT NULL REFERENCES organizations(id),
  user_id                      uuid REFERENCES users(id),
  feature                      text NOT NULL,
  model                        text NOT NULL,
  input_tokens                 integer NOT NULL DEFAULT 0,
  cache_creation_input_tokens  integer NOT NULL DEFAULT 0,
  cache_creation_5m_tokens     integer NOT NULL DEFAULT 0,
  cache_creation_1h_tokens     integer NOT NULL DEFAULT 0,
  cache_read_input_tokens      integer NOT NULL DEFAULT 0,
  output_tokens                integer NOT NULL DEFAULT 0,
  cache_status                 text NOT NULL CHECK (cache_status IN ('hit','write','miss','not_requested','error')),
  stable_prefix_tokens_est     integer NOT NULL DEFAULT 0,
  latency_ms                   integer NOT NULL DEFAULT 0,
  estimated_cost_usd           numeric(12,6),            -- NULL when no price is configured for the model
  uncached_cost_usd            numeric(12,6),            -- same request priced as if nothing were cached
  pricing_version              text,
  stop_reason                  text,
  error_code                   text,
  created_at                   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_org_idx ON ai_usage (organization_id, created_at DESC);
