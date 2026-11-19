-- 0065: Tabela de idempotência MCP (Item 8) e fila durável de entregas de webhooks (Item 6)

CREATE TABLE IF NOT EXISTS mcp_idempotency_records (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text,
  response_json jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  expires_at timestamp NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_idempotency_tenant_tool_key_uniq
  ON mcp_idempotency_records (tenant_id, tool_name, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_mcp_idempotency_expires_at
  ON mcp_idempotency_records (expires_at);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  target_url text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 6,
  last_status_code integer,
  last_error text,
  last_response_body text,
  next_retry_at timestamp,
  delivered_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_deliveries_sub_event_uniq
  ON webhook_deliveries (tenant_id, subscription_id, event_id);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status_retry
  ON webhook_deliveries (status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_tenant_created
  ON webhook_deliveries (tenant_id, created_at DESC);
