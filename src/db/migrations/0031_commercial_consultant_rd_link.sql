-- Adiciona campo opcional rd_user_id para espelhamento e vínculo visual de operadores no RD Station CRM
ALTER TABLE commercial_consultant_profiles ADD COLUMN IF NOT EXISTS rd_user_id text;
