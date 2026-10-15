-- Grupos internos personalizados para organização de Templates Oficiais da Meta (sem impacto na Meta API / cliente)
ALTER TABLE meta_message_templates
  ADD COLUMN IF NOT EXISTS custom_groups jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS meta_template_groups (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_template_groups_tenant
  ON meta_template_groups(tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS meta_template_groups_tenant_name_lower_unique
  ON meta_template_groups(tenant_id, lower(name));
