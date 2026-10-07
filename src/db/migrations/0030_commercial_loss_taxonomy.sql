-- A classificação é configurada por tenant; negócios mantêm o motivo local original.
ALTER TABLE commercial_settings
  ADD COLUMN IF NOT EXISTS loss_reason_categories jsonb NOT NULL DEFAULT '[]'::jsonb;
