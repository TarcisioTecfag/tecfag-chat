-- Aditiva: não altera dados, canais ou fluxos existentes. Não cria configurações ativas.
CREATE TABLE IF NOT EXISTS rd_marketing_flows (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  settings jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rd_marketing_flows_tenant ON rd_marketing_flows(tenant_id);
CREATE TABLE IF NOT EXISTS rd_marketing_receipts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  flow_id text NOT NULL REFERENCES rd_marketing_flows(id) ON DELETE CASCADE,
  identity_hash text NOT NULL,
  deal_id text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rd_marketing_receipt_identity ON rd_marketing_receipts(tenant_id, flow_id, identity_hash);
CREATE TABLE IF NOT EXISTS rd_marketing_logs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  flow_id text NOT NULL REFERENCES rd_marketing_flows(id) ON DELETE CASCADE,
  status text NOT NULL,
  deal_id text,
  message text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rd_marketing_logs_tenant_date ON rd_marketing_logs(tenant_id, created_at);
