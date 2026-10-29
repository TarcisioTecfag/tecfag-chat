-- ══════════════════════════════════════════════════════════════════════════════
-- 0052_sector_copilot_config.sql
-- Adiciona mensagem inicial e sugestões de perguntas do Copiloto (Fagner/Valentina)
-- configuráveis por setor na tabela `sectors`, já pré-configuradas para todos os
-- setores existentes da operação.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE sectors
  ADD COLUMN IF NOT EXISTS copilot_welcome_message text,
  ADD COLUMN IF NOT EXISTS copilot_suggestions jsonb DEFAULT '[]'::jsonb;
