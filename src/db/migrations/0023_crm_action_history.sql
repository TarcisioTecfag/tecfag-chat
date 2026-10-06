CREATE TABLE IF NOT EXISTS crm_action_history (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operator_id text REFERENCES operators(id) ON DELETE SET NULL,
  operator_name text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  item_count integer NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_action_history_tenant_created
  ON crm_action_history (tenant_id, created_at DESC);
