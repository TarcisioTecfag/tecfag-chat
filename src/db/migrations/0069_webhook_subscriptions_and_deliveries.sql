-- 0069: Garantir tabelas webhook_subscriptions e webhook_deliveries em produção (alinhadas ao src/db/schema.ts)
-- Corrige ERROR: relation "webhook_subscriptions" does not exist no dispatcher de webhooks de saída.

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  secret text NOT NULL,
  events jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_tenant
  ON webhook_subscriptions (tenant_id);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_tenant_active
  ON webhook_subscriptions (tenant_id, is_active);

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
