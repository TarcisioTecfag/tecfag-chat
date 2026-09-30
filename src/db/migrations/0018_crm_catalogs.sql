-- Catálogos por tenant; não popula opções automaticamente.
CREATE TABLE IF NOT EXISTS crm_catalog_items (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('segment', 'source', 'campaign', 'loss_reason')),
  name text NOT NULL,
  description text,
  archived_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_catalog_items_tenant_kind
  ON crm_catalog_items (tenant_id, kind);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_catalog_items_active_name
  ON crm_catalog_items (tenant_id, kind, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS crm_catalog_policies (
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('segment', 'source', 'campaign')),
  allow_user_create boolean NOT NULL DEFAULT false,
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT idx_crm_catalog_policies_tenant_kind UNIQUE (tenant_id, kind)
);

ALTER TABLE crm_accounts ADD COLUMN IF NOT EXISTS segment text;
