-- Migração 0015: Paridade Funcional Ampliada (E8)
-- Suporte a Arquivos, Questionários, E-mails e Priorização IA no CRM

-- 1. Campos de Priorização Comercial IA em crm_deals
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS ai_priority_score integer;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS ai_priority_level text; -- 'baixa' | 'media' | 'alta' | 'critica'
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS ai_priority_reason text;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS ai_priority_updated_at timestamp;

-- 2. Tabela de Arquivos do Negócio (crm_deal_files)
CREATE TABLE IF NOT EXISTS crm_deal_files (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id text NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
  conversation_id text REFERENCES conversations(id) ON DELETE SET NULL,
  uploaded_by_operator_id text REFERENCES operators(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  file_size integer NOT NULL, -- em bytes
  mime_type text NOT NULL,
  storage_path text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_deal_files_tenant_deal ON crm_deal_files(tenant_id, deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_deal_files_tenant_conv ON crm_deal_files(tenant_id, conversation_id);

-- 3. Tabela de Questionários e Formulários do Negócio (crm_deal_questionnaires)
CREATE TABLE IF NOT EXISTS crm_deal_questionnaires (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id text NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
  contact_id text REFERENCES contacts(id) ON DELETE SET NULL,
  form_title text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  filled_by_operator_id text REFERENCES operators(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_deal_quest_tenant_deal ON crm_deal_questionnaires(tenant_id, deal_id);

-- 4. Tabela de E-mails do Negócio (crm_deal_emails)
CREATE TABLE IF NOT EXISTS crm_deal_emails (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id text NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
  operator_id text REFERENCES operators(id) ON DELETE SET NULL,
  direction text NOT NULL DEFAULT 'outbound', -- 'outbound' | 'inbound'
  from_address text NOT NULL,
  to_address text NOT NULL,
  cc_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text NOT NULL,
  body_text text,
  body_html text,
  sent_at timestamp NOT NULL DEFAULT now(),
  is_verified boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_deal_emails_tenant_deal ON crm_deal_emails(tenant_id, deal_id);
