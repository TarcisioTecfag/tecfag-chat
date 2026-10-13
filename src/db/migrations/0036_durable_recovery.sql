ALTER TABLE messages ADD COLUMN IF NOT EXISTS next_retry_at timestamp;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS lease_token text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS lease_until timestamp;
ALTER TABLE ai_conversation_audits ADD COLUMN IF NOT EXISTS lease_token text;
ALTER TABLE ai_conversation_audits ADD COLUMN IF NOT EXISTS lease_until timestamp;

CREATE TABLE IF NOT EXISTS rd_marketing_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  flow_id text NOT NULL,
  payload jsonb NOT NULL,
  settings jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  outcomes jsonb NOT NULL DEFAULT '[]',
  attempts integer NOT NULL DEFAULT 0,
  next_retry_at timestamp NOT NULL DEFAULT now(),
  lease_token text,
  lease_until timestamp,
  error_message text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rd_marketing_events_due
  ON rd_marketing_events(tenant_id, status, next_retry_at);
