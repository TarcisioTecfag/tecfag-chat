-- 0062: Estruturação CRM × Marketing — Chaves de Cruzamento, Atribuição/UTMs Imutáveis,
-- Setores (sector_origin / sector_current), Legado (is_legacy), Testes (is_test) e Datas de Ganho/Perda.

-- 1. Colunas em contacts (Lead / 1º Toque Imutável + updated_at para sync incremental)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS entry_channel TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_source TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_campaign TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS utm_content TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS utm_term TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS click_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS landing_page TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sector_origin TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

-- Inicializa updated_at com created_at onde aplicável para ordenação fiel no 1º sync
UPDATE contacts SET updated_at = created_at WHERE updated_at IS NULL;

-- Trigger leve para manter contacts.updated_at sincronizado em qualquer UPDATE
CREATE OR REPLACE FUNCTION touch_contacts_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_contacts_touch_updated_at ON contacts;
CREATE TRIGGER trg_contacts_touch_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION touch_contacts_updated_at();

-- 2. Colunas em crm_deals (Negociação / Card)
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS entry_channel TEXT;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS utm_content TEXT;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS utm_term TEXT;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS click_id TEXT;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS landing_page TEXT;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS original_pipeline_id TEXT;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS sector_origin TEXT;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS sector_current TEXT;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS won_at TIMESTAMP;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS lost_at TIMESTAMP;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Índices compostos para paginação determinística e sync incremental (updated_since)
CREATE INDEX IF NOT EXISTS idx_crm_deals_marketing_sync
  ON crm_deals (tenant_id, is_test, updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_crm_deals_marketing_created
  ON crm_deals (tenant_id, is_test, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_crm_deals_marketing_won
  ON crm_deals (tenant_id, is_test, won_at ASC)
  WHERE won_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_deals_marketing_sectors
  ON crm_deals (tenant_id, sector_origin, sector_current);

CREATE INDEX IF NOT EXISTS idx_contacts_marketing_sync
  ON contacts (tenant_id, is_test, updated_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_conversations_marketing_sync
  ON conversations (tenant_id, updated_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_messages_marketing_sync
  ON messages (tenant_id, sent_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_crm_activities_marketing_sync
  ON crm_deal_activities (tenant_id, updated_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_agent_flows_marketing_sync
  ON agent_flow_states (tenant_id, last_interaction_at ASC, id ASC);
