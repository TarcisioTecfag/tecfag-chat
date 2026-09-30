-- Metadados do envio e classificação de cobrança retornada pela Meta.
-- Migração aditiva; não altera dados ou canais de nenhum tenant.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS meta_details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS meta_pricing jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS meta_status_at timestamp;
ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS meta_webhook_last_seen_at timestamp;

CREATE INDEX IF NOT EXISTS idx_messages_meta_usage
  ON messages (tenant_id, provider, direction, sent_at)
  WHERE provider = 'meta' AND direction = 'outbound';
