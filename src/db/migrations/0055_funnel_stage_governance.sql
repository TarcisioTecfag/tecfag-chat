-- 0055_funnel_stage_governance.sql
-- Governança de Funis e Etapas:
-- 1. Motivos de perda vinculados a funis e etapas (crm_catalog_items e crm_catalog_policies)
-- 2. Templates Oficiais da Meta e grupos vinculados a funis e etapas (meta_message_templates, meta_template_groups, channel_configs)

ALTER TABLE "channel_configs"
  ADD COLUMN IF NOT EXISTS "meta_templates_restrict_by_stage" boolean NOT NULL DEFAULT false;

ALTER TABLE "meta_message_templates"
  ADD COLUMN IF NOT EXISTS "all_pipelines" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "pipeline_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "stage_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "meta_template_groups"
  ADD COLUMN IF NOT EXISTS "all_pipelines" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "pipeline_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "stage_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "crm_catalog_items"
  ADD COLUMN IF NOT EXISTS "all_pipelines" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "pipeline_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "stage_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "crm_catalog_policies"
  ADD COLUMN IF NOT EXISTS "restrict_by_stage" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "standard_item_scopes" jsonb NOT NULL DEFAULT '{}'::jsonb;
