-- Histórico cumulativo de edições em anotações comerciais do card (crm_deal_activities)
ALTER TABLE crm_deal_activities
  ADD COLUMN IF NOT EXISTS edit_history JSONB NOT NULL DEFAULT '[]'::jsonb;
