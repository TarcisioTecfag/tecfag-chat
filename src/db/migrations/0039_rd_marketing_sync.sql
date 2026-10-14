CREATE TABLE IF NOT EXISTS rd_marketing_sync_settings (
  tenant_id text PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  connection_version text,
  outbound_enabled boolean NOT NULL DEFAULT false,
  currency text NOT NULL DEFAULT 'BRL',
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rd_marketing_journey_endpoints (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_version text NOT NULL,
  kind text NOT NULL,
  label text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_encrypted text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  remote_id text,
  registration_status text NOT NULL DEFAULT 'local',
  last_error text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rd_journey_endpoints_tenant ON rd_marketing_journey_endpoints(tenant_id);
CREATE TABLE IF NOT EXISTS rd_marketing_journey_notifications (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_version text NOT NULL,
  endpoint_id text REFERENCES rd_marketing_journey_endpoints(id) ON DELETE SET NULL,
  contact_id text REFERENCES contacts(id) ON DELETE SET NULL,
  rd_uuid text,
  email text,
  phone text,
  event_type text NOT NULL,
  event_key text NOT NULL,
  identifier text,
  occurred_at timestamp,
  data jsonb NOT NULL,
  received_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rd_journey_notification_identity ON rd_marketing_journey_notifications(tenant_id, connection_version, event_key);
CREATE INDEX IF NOT EXISTS idx_rd_journey_notification_contact ON rd_marketing_journey_notifications(tenant_id, connection_version, rd_uuid);
CREATE TABLE IF NOT EXISTS rd_marketing_commercial_outbox (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_version text NOT NULL,
  deal_id text NOT NULL,
  contact_id text,
  deal_version integer NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_retry_at timestamp NOT NULL DEFAULT now(),
  lease_token text,
  lease_until timestamp,
  external_event_id text,
  last_error text,
  created_at timestamp NOT NULL DEFAULT now(),
  sent_at timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rd_commercial_transition ON rd_marketing_commercial_outbox(tenant_id, deal_id, deal_version, event_type);
CREATE INDEX IF NOT EXISTS idx_rd_commercial_pending ON rd_marketing_commercial_outbox(tenant_id, status, next_retry_at);
