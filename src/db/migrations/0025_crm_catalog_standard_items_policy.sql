-- Suporte a loss_reason e controle de motivos/itens padrão desativados por tenant
ALTER TABLE crm_catalog_policies DROP CONSTRAINT IF EXISTS crm_catalog_policies_kind_check;
ALTER TABLE crm_catalog_policies ADD CONSTRAINT crm_catalog_policies_kind_check CHECK (kind IN ('segment', 'source', 'campaign', 'loss_reason'));

ALTER TABLE crm_catalog_policies ADD COLUMN IF NOT EXISTS include_standard boolean NOT NULL DEFAULT true;
ALTER TABLE crm_catalog_policies ADD COLUMN IF NOT EXISTS disabled_standard_items jsonb NOT NULL DEFAULT '[]'::jsonb;
