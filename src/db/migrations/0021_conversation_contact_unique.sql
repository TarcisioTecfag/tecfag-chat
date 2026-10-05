-- Impede novos históricos para o mesmo contato sem interromper o startup
-- caso dados antigos precisem de reconciliação manual.
DO $$
DECLARE duplicate_groups integer;
BEGIN
  SELECT count(*) INTO duplicate_groups
  FROM (
    SELECT tenant_id, contact_id
    FROM conversations
    GROUP BY tenant_id, contact_id
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_groups = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_tenant_contact_uniq
      ON conversations (tenant_id, contact_id);
  ELSE
    RAISE WARNING 'Unique index on conversations skipped: % duplicated tenant/contact groups require review', duplicate_groups;
  END IF;
END $$;
