-- Preserve explicitly enabled configurations; new configurations default to isolated testing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                 AND table_name = 'rd_marketing_sync_settings' AND column_name = 'outbound_scope') THEN
    ALTER TABLE rd_marketing_sync_settings ADD COLUMN outbound_scope text NOT NULL DEFAULT 'test';
    UPDATE rd_marketing_sync_settings SET outbound_scope = 'all' WHERE outbound_enabled;
  END IF;
END $$;
ALTER TABLE rd_marketing_sync_settings ADD COLUMN IF NOT EXISTS test_contact jsonb;
