-- Estrutura aditiva: mantém os dados operacionais dos dois tenants intactos.
CREATE TABLE IF NOT EXISTS crm_custom_field_definitions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('deal', 'company', 'contact', 'product')),
  name text NOT NULL,
  field_type text NOT NULL CHECK (field_type IN ('text', 'date', 'single', 'multiple', 'number', 'url')),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  required boolean NOT NULL DEFAULT false,
  visible_on_create boolean NOT NULL DEFAULT true,
  all_pipelines boolean NOT NULL DEFAULT true,
  pipeline_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  archived_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_custom_fields_tenant_entity_order
  ON crm_custom_field_definitions (tenant_id, entity_type, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_custom_fields_tenant_entity_name_active
  ON crm_custom_field_definitions (tenant_id, entity_type, lower(name))
  WHERE archived_at IS NULL;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE crm_products ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
