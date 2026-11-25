-- 0070: Auditoria completa de origem (actor_type, source_channel, actor_name, client_ip, entity_id, mcp_key_id, mcp_key_label)
-- Retrocompatível (colunas nullable) sem lock pesado nas tabelas existentes.

ALTER TABLE crm_deal_events
  ADD COLUMN IF NOT EXISTS actor_type text,
  ADD COLUMN IF NOT EXISTS source_channel text,
  ADD COLUMN IF NOT EXISTS actor_name text,
  ADD COLUMN IF NOT EXISTS client_ip text,
  ADD COLUMN IF NOT EXISTS mcp_key_id text,
  ADD COLUMN IF NOT EXISTS mcp_key_label text;

CREATE INDEX IF NOT EXISTS idx_crm_deal_events_tenant_channel_created
  ON crm_deal_events (tenant_id, source_channel, created_at DESC);

ALTER TABLE crm_action_history
  ADD COLUMN IF NOT EXISTS entity_id text,
  ADD COLUMN IF NOT EXISTS actor_type text,
  ADD COLUMN IF NOT EXISTS source_channel text,
  ADD COLUMN IF NOT EXISTS client_ip text,
  ADD COLUMN IF NOT EXISTS mcp_key_id text,
  ADD COLUMN IF NOT EXISTS mcp_key_label text;

CREATE INDEX IF NOT EXISTS idx_crm_action_history_tenant_entity_id_created
  ON crm_action_history (tenant_id, entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_action_history_tenant_channel_created
  ON crm_action_history (tenant_id, source_channel, created_at DESC);

ALTER TABLE attendance_events
  ADD COLUMN IF NOT EXISTS actor_type text,
  ADD COLUMN IF NOT EXISTS source_channel text,
  ADD COLUMN IF NOT EXISTS client_ip text,
  ADD COLUMN IF NOT EXISTS mcp_key_id text,
  ADD COLUMN IF NOT EXISTS mcp_key_label text;
