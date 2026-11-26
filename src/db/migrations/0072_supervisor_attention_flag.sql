ALTER TABLE conversations ADD COLUMN IF NOT EXISTS supervisor_attention_at TIMESTAMP;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS supervisor_attention_operator_id TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS supervisor_attention_message TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS supervisor_attention_by TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS supervisor_attention_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_attention
  ON conversations (tenant_id, supervisor_attention_at DESC)
  WHERE supervisor_attention_at IS NOT NULL;
