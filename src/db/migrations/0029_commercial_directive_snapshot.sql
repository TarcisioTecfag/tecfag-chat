-- Mantém os números e a etapa vistos pelo gestor no instante da pontuação.
-- A migração é aditiva; diretrizes anteriores continuam válidas com snapshot vazio.
ALTER TABLE commercial_directives
  ADD COLUMN IF NOT EXISTS snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
