-- Associação explícita de um funil do CRM para cada equipe do War Room.
-- Sem preenchimento automático: cada tenant configura seus próprios funis.
ALTER TABLE commercial_settings
  ADD COLUMN IF NOT EXISTS pipeline_by_division jsonb NOT NULL DEFAULT '{}'::jsonb;
