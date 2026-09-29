-- 0014_crm_migration_and_sync_policy.sql
-- Adiciona suporte a política de fonte de verdade (source_of_truth), sincronização e histórico de migrações RD Station CRM.

ALTER TABLE channel_configs
  ADD COLUMN IF NOT EXISTS rd_crm_source_of_truth text DEFAULT 'rd_primary' NOT NULL,
  ADD COLUMN IF NOT EXISTS rd_crm_sync_policy text DEFAULT 'manual' NOT NULL,
  ADD COLUMN IF NOT EXISTS rd_crm_last_sync_at timestamp,
  ADD COLUMN IF NOT EXISTS rd_crm_last_report jsonb DEFAULT '{}'::jsonb NOT NULL;

CREATE TABLE IF NOT EXISTS crm_migration_runs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  triggered_by_operator_id text REFERENCES operators(id) ON DELETE SET NULL,
  source text DEFAULT 'rd_station_v2' NOT NULL,
  status text DEFAULT 'running' NOT NULL,
  source_of_truth text DEFAULT 'rd_primary' NOT NULL,
  report jsonb DEFAULT '{}'::jsonb NOT NULL,
  started_at timestamp DEFAULT now() NOT NULL,
  finished_at timestamp
);

CREATE INDEX IF NOT EXISTS idx_crm_migration_runs_tenant_started
  ON crm_migration_runs (tenant_id, started_at DESC);
