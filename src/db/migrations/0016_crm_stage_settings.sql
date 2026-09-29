-- Configuração por etapa sem alterar as tabelas operacionais do CRM.
CREATE TABLE IF NOT EXISTS crm_stage_settings (
  stage_id text PRIMARY KEY REFERENCES crm_stages(id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  abbreviation text,
  objective text,
  description text,
  cooling_enabled boolean NOT NULL DEFAULT true,
  cooling_days integer NOT NULL DEFAULT 10,
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT crm_stage_settings_cooling_days_check CHECK (cooling_days BETWEEN 1 AND 365)
);

CREATE INDEX IF NOT EXISTS idx_crm_stage_settings_tenant_stage
  ON crm_stage_settings (tenant_id, stage_id);
