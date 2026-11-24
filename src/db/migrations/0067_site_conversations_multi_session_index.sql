-- Permite múltiplas sessões históricas ou multi-dispositivo do canal Site (`conv-lc-%`)
-- vinculadas ao mesmo contato (inclusive contatos de WhatsApp existentes), mantendo
-- 100% intacta a unicidade das conversas corporativas de WhatsApp.
-- Também garante índices essenciais nas tabelas `lc_*` para suportar alto volume histórico.

DROP INDEX IF EXISTS idx_conversations_tenant_contact_uniq;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM conversations
    WHERE whatsapp_connection_id IS NULL
      AND id NOT LIKE 'conv-lc-%'
    GROUP BY tenant_id, contact_id, COALESCE(contact_phone_id, '')
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_tenant_contact_uniq
      ON conversations (tenant_id, contact_id, COALESCE(contact_phone_id, ''))
      WHERE whatsapp_connection_id IS NULL AND id NOT LIKE 'conv-lc-%';
  ELSE
    RAISE WARNING 'Legacy duplicate corporate conversations preserved; review before enforcing corporate uniqueness';
  END IF;
END $$;

-- Índices de performance nas tabelas de Live Chat / Jornada do Site para alto volume histórico
CREATE INDEX IF NOT EXISTS idx_lc_visitors_tenant_cookie
  ON lc_visitors (tenant_id, cookie_id);

CREATE INDEX IF NOT EXISTS idx_lc_visitors_tenant_last_seen
  ON lc_visitors (tenant_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_lc_visitors_tenant_phone
  ON lc_visitors (tenant_id, phone)
  WHERE phone IS NOT NULL AND phone <> '';

CREATE INDEX IF NOT EXISTS idx_lc_visitors_tenant_email
  ON lc_visitors (tenant_id, lower(email))
  WHERE email IS NOT NULL AND email <> '';

CREATE INDEX IF NOT EXISTS idx_lc_pageviews_tenant_visitor_visited
  ON lc_pageviews (tenant_id, visitor_id, visited_at);

CREATE INDEX IF NOT EXISTS idx_lc_click_events_tenant_visitor_occurred
  ON lc_click_events (tenant_id, visitor_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_lc_chats_tenant_visitor_started
  ON lc_chats (tenant_id, visitor_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_lc_messages_tenant_chat_sent
  ON lc_messages (tenant_id, chat_id, sent_at);
