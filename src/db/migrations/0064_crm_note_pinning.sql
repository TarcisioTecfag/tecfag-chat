-- Fixação de anotações comerciais no topo do card do CRM (crm_deal_activities)
ALTER TABLE crm_deal_activities
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS pinned_by_operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_deal_activities_pinned_notes
  ON crm_deal_activities (tenant_id, deal_id, is_pinned DESC, pinned_at DESC)
  WHERE type = 'note';
