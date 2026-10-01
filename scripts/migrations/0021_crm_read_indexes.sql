-- Índices para as telas de CRM com grande volume de negócios e contatos.
-- Executar como migração controlada, fora de uma transação, com
-- CREATE INDEX CONCURRENTLY. Não integrar ao startup do servidor.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_deals_board_recent
  ON crm_deals (tenant_id, pipeline_id, status, stage_id, last_activity_at DESC, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_tenant_created
  ON contacts (tenant_id, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_accounts_tenant_created
  ON crm_accounts (tenant_id, created_at DESC, id DESC);
