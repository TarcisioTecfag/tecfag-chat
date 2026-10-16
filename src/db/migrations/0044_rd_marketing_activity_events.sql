-- Opt-in only. No backfill and no external requests from database triggers.
ALTER TABLE rd_marketing_sync_settings ADD COLUMN IF NOT EXISTS activity_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE rd_marketing_sync_settings ADD COLUMN IF NOT EXISTS public_base_url TEXT;
ALTER TABLE rd_marketing_commercial_outbox ADD COLUMN IF NOT EXISTS parent_id TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS rd_marketing_cycle INTEGER NOT NULL DEFAULT 0;
ALTER TABLE crm_deal_activities ADD COLUMN IF NOT EXISTS rd_marketing_cycle INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION rd_activity_deal_snapshot(t TEXT, d TEXT) RETURNS JSONB
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('dealId', x.id, 'dealTitle', x.title, 'title', x.title,
    'status', x.status, 'value', x.value, 'currency', x.currency, 'rating', x.rating,
    'pipeline', p.name, 'stage', s.name, 'owner', o.name, 'company', a.name,
    'source', x.source, 'campaign', x.campaign, 'lossReason', x.loss_reason)
  FROM crm_deals x
  LEFT JOIN crm_pipelines p ON p.id = x.pipeline_id AND p.tenant_id = t
  LEFT JOIN crm_stages s ON s.id = x.stage_id AND s.tenant_id = t
  LEFT JOIN operators o ON o.id = x.operator_id AND o.tenant_id = t
  LEFT JOIN crm_accounts a ON a.id = x.account_id AND a.tenant_id = t
  WHERE x.tenant_id = t AND x.id = d;
$$;

-- Reused by task/conversation triggers. Known conflicting UUID always wins over email/phone.
CREATE OR REPLACE FUNCTION rd_activity_enqueue(t TEXT, k TEXT, entity TEXT, rev INTEGER,
  person TEXT, details JSONB) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE cfg RECORD; c RECORD; u TEXT; recipient JSONB;
BEGIN
  SELECT s.* INTO cfg FROM rd_marketing_sync_settings s
    JOIN rd_marketing_connections r ON r.tenant_id = t AND r.version = s.connection_version
    WHERE s.tenant_id = t AND s.outbound_enabled AND s.activity_enabled
      AND s.public_base_url IS NOT NULL AND r.access_token_encrypted IS NOT NULL
      AND r.refresh_token_encrypted IS NOT NULL;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO c FROM contacts WHERE tenant_id = t AND id = person;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT rd_uuid INTO u FROM rd_marketing_journey_links
    WHERE tenant_id = t AND contact_id = person AND connection_version = cfg.connection_version;
  IF cfg.outbound_scope = 'test' THEN
    IF cfg.test_contact->>'uuid' IS NULL THEN RETURN; END IF;
    IF u IS NOT NULL THEN
      IF lower(u) <> lower(cfg.test_contact->>'uuid') THEN RETURN; END IF;
    ELSIF NOT (
      (nullif(trim(c.email), '') IS NOT NULL AND lower(trim(c.email)) = lower(trim(cfg.test_contact->>'email')))
      OR (nullif(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
        AND regexp_replace(c.phone, '[^0-9]', '', 'g') = regexp_replace(coalesce(cfg.test_contact->>'phone', ''), '[^0-9]', '', 'g'))
    ) IS TRUE THEN RETURN;
    END IF;
    u := cfg.test_contact->>'uuid';
  END IF;
  recipient := CASE WHEN nullif(trim(c.email), '') IS NOT NULL
    THEN jsonb_build_object('email', lower(trim(c.email)))
    ELSE jsonb_build_object('phone', '+' || regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g')) END;
  INSERT INTO rd_marketing_commercial_outbox
    (id, tenant_id, connection_version, deal_id, contact_id, deal_version, event_type, payload, snapshot, created_at)
    VALUES (gen_random_uuid()::text, t, cfg.connection_version, entity, person, rev, k, recipient,
      details || jsonb_build_object('rdUuid', u, 'contactName', c.name, 'contactEmail', c.email,
        'publicBaseUrl', cfg.public_base_url), clock_timestamp())
    ON CONFLICT DO NOTHING;
END;
$$;

-- Enrich at the business transition, then persist the complement atomically with the ACK.
CREATE OR REPLACE FUNCTION rd_activity_commercial_capture() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE cfg RECORD; kind TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.event_type NOT IN ('OPPORTUNITY', 'SALE', 'OPPORTUNITY_LOST') THEN RETURN NEW; END IF;
    SELECT * INTO cfg FROM rd_marketing_sync_settings WHERE tenant_id = NEW.tenant_id
      AND connection_version = NEW.connection_version AND outbound_enabled AND activity_enabled
      AND public_base_url IS NOT NULL;
    IF FOUND THEN
      NEW.snapshot := coalesce((SELECT jsonb_build_object('contactName', name, 'contactEmail', email)
        FROM contacts WHERE tenant_id = NEW.tenant_id AND id = NEW.contact_id), '{}'::jsonb)
        || coalesce(rd_activity_deal_snapshot(NEW.tenant_id, NEW.deal_id), '{}'::jsonb)
        || NEW.snapshot || jsonb_build_object('activityEligible', true, 'publicBaseUrl', cfg.public_base_url);
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent'
    AND NEW.snapshot->>'activityEligible' = 'true'
    AND NEW.event_type IN ('OPPORTUNITY', 'SALE', 'OPPORTUNITY_LOST') THEN
    kind := 'DETAIL_' || NEW.event_type;
    INSERT INTO rd_marketing_commercial_outbox
      (id, tenant_id, connection_version, deal_id, contact_id, deal_version, event_type,
       payload, snapshot, parent_id, created_at)
    VALUES (gen_random_uuid()::text, NEW.tenant_id, NEW.connection_version, NEW.deal_id,
      NEW.contact_id, NEW.deal_version, kind,
      NEW.payload - 'funnel_name' - 'value' - 'reason', NEW.snapshot, NEW.id, NEW.created_at + interval '1 microsecond')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS rd_activity_commercial_snapshot ON rd_marketing_commercial_outbox;
CREATE TRIGGER rd_activity_commercial_snapshot BEFORE INSERT ON rd_marketing_commercial_outbox
  FOR EACH ROW EXECUTE FUNCTION rd_activity_commercial_capture();
DROP TRIGGER IF EXISTS rd_activity_commercial_ack ON rd_marketing_commercial_outbox;
CREATE TRIGGER rd_activity_commercial_ack AFTER UPDATE OF status ON rd_marketing_commercial_outbox
  FOR EACH ROW EXECUTE FUNCTION rd_activity_commercial_capture();

-- Imported/automated cards have no outbound opportunity to echo. Capture only their
-- detailed creation, after participants are saved; manual cards use the ACK path above.
CREATE OR REPLACE FUNCTION rd_activity_deal_capture() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE person TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rd_marketing_sync_settings WHERE tenant_id = NEW.tenant_id
    AND outbound_enabled AND activity_enabled) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM rd_marketing_commercial_outbox WHERE tenant_id = NEW.tenant_id
    AND deal_id = NEW.id AND deal_version = NEW.version AND event_type = 'OPPORTUNITY') THEN RETURN NEW; END IF;
  SELECT contact_id INTO person FROM crm_deal_contacts WHERE tenant_id = NEW.tenant_id AND deal_id = NEW.id
    ORDER BY is_primary DESC, created_at, id LIMIT 1;
  PERFORM rd_activity_enqueue(NEW.tenant_id, 'DETAIL_OPPORTUNITY', NEW.id, NEW.version, person,
    coalesce(rd_activity_deal_snapshot(NEW.tenant_id, NEW.id), '{}'::jsonb)
      || jsonb_build_object('occurredAt', NEW.created_at));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS rd_activity_deal_event ON crm_deals;
CREATE CONSTRAINT TRIGGER rd_activity_deal_event AFTER INSERT ON crm_deals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION rd_activity_deal_capture();

CREATE OR REPLACE FUNCTION rd_activity_cycle() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rd_marketing_sync_settings WHERE tenant_id = NEW.tenant_id
    AND outbound_enabled AND activity_enabled) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'conversations' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.rd_marketing_cycle := CASE WHEN NEW.queue_state <> 'finalizados' THEN 1 ELSE 0 END;
    ELSIF OLD.queue_state = 'finalizados' AND NEW.queue_state <> 'finalizados' THEN
      NEW.rd_marketing_cycle := OLD.rd_marketing_cycle + 1;
    END IF;
  ELSIF NEW.type IN ('task', 'call', 'meeting', 'whatsapp') AND NEW.status = 'completed' THEN
    IF TG_OP = 'INSERT' THEN NEW.rd_marketing_cycle := 1;
    ELSIF OLD.status IS DISTINCT FROM 'completed' THEN NEW.rd_marketing_cycle := OLD.rd_marketing_cycle + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS rd_activity_conversation_cycle ON conversations;
CREATE TRIGGER rd_activity_conversation_cycle BEFORE INSERT OR UPDATE OF queue_state ON conversations
  FOR EACH ROW EXECUTE FUNCTION rd_activity_cycle();
DROP TRIGGER IF EXISTS rd_activity_task_cycle ON crm_deal_activities;
CREATE TRIGGER rd_activity_task_cycle BEFORE INSERT OR UPDATE OF status ON crm_deal_activities
  FOR EACH ROW EXECUTE FUNCTION rd_activity_cycle();

CREATE OR REPLACE FUNCTION rd_activity_task_capture() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE person TEXT; data JSONB;
BEGIN
  IF NEW.type NOT IN ('task', 'call', 'meeting', 'whatsapp') THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM rd_marketing_sync_settings WHERE tenant_id = NEW.tenant_id
    AND outbound_enabled AND activity_enabled) THEN RETURN NEW; END IF;
  SELECT contact_id INTO person FROM crm_deal_contacts
    WHERE tenant_id = NEW.tenant_id AND deal_id = NEW.deal_id
    ORDER BY is_primary DESC, created_at, id LIMIT 1;
  data := coalesce(rd_activity_deal_snapshot(NEW.tenant_id, NEW.deal_id), '{}'::jsonb)
    || jsonb_build_object('subjectType', 'task', 'title', NEW.title, 'taskId', NEW.id, 'taskTitle', NEW.title, 'taskStatus', NEW.status,
      'taskType', NEW.type, 'description', NEW.description, 'dueDate', NEW.due_date,
      'completedAt', NEW.completed_at, 'conversationId', NEW.conversation_id,
      'taskOwner', (SELECT name FROM operators WHERE tenant_id = NEW.tenant_id AND id = NEW.assigned_to_operator_id),
      'actor', (SELECT name FROM operators WHERE tenant_id = NEW.tenant_id AND id = CASE WHEN TG_OP = 'INSERT' THEN NEW.operator_id ELSE nullif(current_setting('app.rd_activity_actor', true), '') END));
  IF TG_OP = 'INSERT' THEN
    PERFORM rd_activity_enqueue(NEW.tenant_id, 'TASK_CREATED', NEW.id, 0, person,
      data || jsonb_build_object('occurredAt', NEW.created_at));
    IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  ELSIF NEW.status <> 'completed' OR OLD.status = 'completed' THEN RETURN NEW;
  END IF;
  PERFORM rd_activity_enqueue(NEW.tenant_id, 'TASK_COMPLETED', NEW.id, NEW.rd_marketing_cycle, person,
    data || jsonb_build_object('occurredAt', coalesce(NEW.completed_at, NEW.updated_at)));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS rd_activity_task_event ON crm_deal_activities;
CREATE TRIGGER rd_activity_task_event AFTER INSERT OR UPDATE OF status ON crm_deal_activities
  FOR EACH ROW EXECUTE FUNCTION rd_activity_task_capture();

CREATE OR REPLACE FUNCTION rd_activity_conversation_capture() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE k TEXT; deals JSONB; data JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.queue_state = 'finalizados' THEN RETURN NEW; END IF;
    k := 'CHAT_STARTED';
  ELSIF NEW.queue_state = OLD.queue_state THEN RETURN NEW;
  ELSIF OLD.queue_state = 'finalizados' THEN k := 'CHAT_STARTED';
  ELSIF NEW.queue_state = 'finalizados' THEN k := 'CHAT_FINISHED';
  ELSE RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rd_marketing_sync_settings WHERE tenant_id = NEW.tenant_id
    AND outbound_enabled AND activity_enabled) THEN RETURN NEW; END IF;
  SELECT coalesce(jsonb_agg(rd_activity_deal_snapshot(NEW.tenant_id, l.deal_id) ORDER BY l.deal_id), '[]'::jsonb)
    INTO deals FROM crm_conversation_deals l JOIN crm_deals d ON d.id = l.deal_id AND d.tenant_id = NEW.tenant_id
    WHERE l.tenant_id = NEW.tenant_id AND d.tenant_id = NEW.tenant_id AND l.conversation_id = NEW.id AND l.is_active;
  data := jsonb_build_object('subjectType', 'conversation', 'conversationId', NEW.id,
    'title', 'Atendimento · ' || coalesce((SELECT name FROM contacts WHERE tenant_id = NEW.tenant_id AND id = NEW.contact_id), 'Contato'), 'queue', NEW.queue_state, 'deals', deals,
    'occurredAt', clock_timestamp(),
    'owner', (SELECT name FROM operators WHERE tenant_id = NEW.tenant_id AND id = CASE WHEN TG_OP = 'INSERT' THEN NEW.operator_id ELSE coalesce(NEW.operator_id, OLD.operator_id) END),
    'sector', (SELECT name FROM sectors WHERE tenant_id = NEW.tenant_id AND id = NEW.sector_id));
  PERFORM rd_activity_enqueue(NEW.tenant_id, k, NEW.id, NEW.rd_marketing_cycle, NEW.contact_id, data);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS rd_activity_conversation_event ON conversations;
-- Deferred capture includes links made later in the same conversation-creation transaction.
CREATE CONSTRAINT TRIGGER rd_activity_conversation_event AFTER INSERT OR UPDATE ON conversations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION rd_activity_conversation_capture();
