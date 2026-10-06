-- Adiciona suporte a unicidade e regras de obrigatoriedade por etapa em campos personalizados do CRM
ALTER TABLE crm_custom_field_definitions ADD COLUMN IF NOT EXISTS is_unique boolean NOT NULL DEFAULT false;
ALTER TABLE crm_custom_field_definitions ADD COLUMN IF NOT EXISTS required_rule text NOT NULL DEFAULT 'always';
ALTER TABLE crm_custom_field_definitions ADD COLUMN IF NOT EXISTS required_from_stage_id text;
