-- 0054_attendance_single_status_and_24h_lock.sql
-- 1. Consolida os múltiplos status de envio de mensagem (pending, sending, accepted, delivered, read)
--    em um único evento "message.created" (atualizando metadata.status in-place), mantendo apenas
--    "message.failed" separado para erros reais de entrega.
-- 2. Implementa trava de 24 horas (conversation.window_24h) na projeção de mensagens para o
--    Histórico da Negociação (crm_deal_events), evitando poluir a linha do tempo mensagem por mensagem
--    ou triplicar mídias a cada mudança de status.
-- 3. Garante o vínculo de contatos às negociações da mesma empresa (crm_deal_contacts).

CREATE OR REPLACE FUNCTION capture_attendance_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_type text;
  v_text text;
  v_actor text;
  v_operator text;
  v_key text;
  v_meta jsonb;
  v_deal text;
  v_normalized_status text;
BEGIN
  IF NEW.sender_type = 'client' OR coalesce(NEW.meta_details->>'attendanceSkip', '') = 'true'
    THEN RETURN NEW; END IF;

  v_actor := coalesce(nullif(NEW.meta_details->'attendanceActor'->>'name', ''), nullif(NEW.sender_name, ''), 'Operador');
  v_operator := NEW.meta_details->'attendanceActor'->>'operatorId';
  v_normalized_status := CASE
    WHEN NEW.status IN ('pending', 'sending', 'accepted') THEN 'sent'
    ELSE coalesce(NEW.status, 'sent')
  END;
  v_meta := jsonb_build_object('messageId', NEW.id, 'status', v_normalized_status, 'provider', NEW.provider);

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.is_internal_note THEN RETURN NEW; END IF;

    -- Não cria novos eventos para transições normais de envio/entrega/leitura;
    -- apenas atualiza o status no registro original da mensagem.
    IF NEW.status IN ('pending', 'sending', 'accepted', 'delivered', 'read') THEN
      UPDATE attendance_events
      SET metadata = jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{status}',
        to_jsonb((CASE WHEN NEW.status IN ('pending', 'sending', 'accepted') THEN 'sent' ELSE NEW.status END)::text),
        true
      )
      WHERE tenant_id = NEW.tenant_id
        AND conversation_id = NEW.conversation_id
        AND source_key = 'message:' || NEW.id || ':created';
      RETURN NEW;
    END IF;

    v_type := 'message.' || NEW.status;
    v_text := CASE NEW.status
      WHEN 'failed' THEN 'Falha no envio da mensagem'
      ELSE 'Status da mensagem: ' || NEW.status
    END;
    v_key := 'message:' || NEW.id || ':' || NEW.status || ':' || NEW.retry_count;
    v_meta := v_meta || jsonb_build_object('anchorKey', 'message:' || NEW.id || ':created', 'error', NEW.error_message);
  ELSE
    v_type := CASE
      WHEN NEW.meta_details->>'attendanceEventType' = 'attendance.context_selected' THEN 'attendance.context_selected'
      WHEN NEW.meta_details ? 'activityId' THEN 'task.created'
      WHEN NEW.is_internal_note AND NEW.sender_type <> 'system' THEN 'note.created'
      WHEN NEW.is_internal_note OR NEW.sender_type = 'system' THEN 'system.recorded'
      ELSE 'message.created'
    END;

    IF v_type = 'attendance.context_selected' AND (v_actor IS NULL OR v_actor = 'Sistema') THEN
      v_deal := coalesce(
        NEW.meta_details->>'dealId',
        (SELECT current_deal_id FROM conversation_deal_contexts WHERE tenant_id = NEW.tenant_id AND conversation_id = NEW.conversation_id LIMIT 1)
      );
      IF v_deal IS NOT NULL AND EXISTS (
        SELECT 1 FROM rd_marketing_receipts WHERE tenant_id = NEW.tenant_id AND deal_id = v_deal
      ) THEN
        v_actor := 'Automação RD Station Marketing';
      ELSE
        v_actor := 'Automação CRM';
      END IF;
    END IF;

    v_text := CASE
      WHEN v_type = 'note.created' THEN v_actor || ' adicionou uma nota: ' || NEW.content
      WHEN v_type = 'message.created' THEN v_actor || ' enviou uma mensagem: ' || NEW.content
      ELSE NEW.content
    END;
    v_key := 'message:' || NEW.id || ':created';
    v_meta := v_meta || jsonb_build_object(
      'industrialTriage', NEW.meta_details->'industrialTriage',
      'activityId', NEW.meta_details->>'activityId'
    );
  END IF;

  PERFORM record_attendance_event(
    NEW.tenant_id, NEW.conversation_id, v_key, v_type,
    v_text, v_actor, v_operator, v_meta
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION project_attendance_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_existing_id text;
  v_existing_meta jsonb;
  v_existing_created timestamp;
  v_msg_count integer;
  v_out_count integer;
  v_media_count integer;
  v_is_media boolean;
  v_clean_preview text;
BEGIN
  -- Ignora eventos transitórios de status de mensagem
  IF NEW.event_type IN ('message.sending', 'message.accepted', 'message.delivered', 'message.read') THEN
    RETURN NEW;
  END IF;

  IF NEW.deal_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM crm_deals WHERE tenant_id = NEW.tenant_id AND id = NEW.deal_id
  ) THEN
    -- Trava de 24 horas para mensagens de conversa no Histórico da Negociação:
    -- Consolida todas as mensagens da mesma conversa dentro de uma janela de 24h em um único card.
    IF NEW.event_type = 'message.created' THEN
      v_is_media := (NEW.description LIKE '%[MEDIA:%');
      v_clean_preview := regexp_replace(NEW.description, '^.*?(enviou uma mensagem|registrou uma mensagem \([^)]+\)):\s*', '');
      IF v_is_media THEN
        v_clean_preview := regexp_replace(v_clean_preview, '\[MEDIA:[a-zA-Z]+\][^\n]*\n?', '[Mídia enviada] ');
      END IF;
      v_clean_preview := left(trim(coalesce(nullif(v_clean_preview, ''), 'Mensagem registrada')), 280);

      SELECT id, metadata, created_at
        INTO v_existing_id, v_existing_meta, v_existing_created
      FROM crm_deal_events
      WHERE tenant_id = NEW.tenant_id
        AND deal_id = NEW.deal_id
        AND event_type = 'conversation_action'
        AND metadata->>'conversationId' = NEW.conversation_id
        AND metadata->>'actionType' IN ('conversation.window_24h', 'message.created')
        AND created_at >= (NEW.created_at - INTERVAL '24 hours')
        AND created_at <= (NEW.created_at + INTERVAL '24 hours')
      ORDER BY created_at DESC
      LIMIT 1;

      IF v_existing_id IS NOT NULL THEN
        -- Se já processou o mesmo attendanceEventId, não incrementa duplicado
        IF coalesce(v_existing_meta->>'lastAttendanceEventId', '') = NEW.id
           OR coalesce(v_existing_meta->>'attendanceEventId', '') = NEW.id THEN
          RETURN NEW;
        END IF;

        v_msg_count := coalesce((v_existing_meta->>'messagesCount')::integer, 1) + 1;
        v_out_count := coalesce((v_existing_meta->>'outboundCount')::integer, 1) + 1;
        v_media_count := coalesce((v_existing_meta->>'mediaCount')::integer, 0) + (CASE WHEN v_is_media THEN 1 ELSE 0 END);

        UPDATE crm_deal_events
        SET metadata = coalesce(v_existing_meta, '{}'::jsonb) || jsonb_build_object(
          'actionType', 'conversation.window_24h',
          'attendanceEventType', 'conversation.window_24h',
          'lastAttendanceEventId', NEW.id,
          'conversationId', NEW.conversation_id,
          'cycleId', NEW.cycle_id,
          'actorName', NEW.actor_name,
          'messagesCount', v_msg_count,
          'outboundCount', v_out_count,
          'mediaCount', v_media_count,
          'windowStartAt', coalesce(v_existing_meta->>'windowStartAt', v_existing_created::text),
          'windowEndAt', NEW.created_at,
          'lastMessagePreview', v_clean_preview,
          'description', format(
            'Interação consolidada (janela de 24h): %s mensagens registradas%s. Última: %s',
            v_msg_count,
            CASE WHEN v_media_count > 0 THEN format(' (%s mídias)', v_media_count) ELSE '' END,
            v_clean_preview
          ),
          'occurredAt', NEW.created_at
        ) - 'messageId'
        WHERE id = v_existing_id AND tenant_id = NEW.tenant_id;

        RETURN NEW;
      END IF;

      v_msg_count := 1;
      v_out_count := 1;
      v_media_count := CASE WHEN v_is_media THEN 1 ELSE 0 END;

      INSERT INTO crm_deal_events(id, tenant_id, deal_id, operator_id, event_type, metadata, created_at)
      VALUES (
        'attendance-' || NEW.id,
        NEW.tenant_id,
        NEW.deal_id,
        NEW.operator_id,
        'conversation_action',
        (NEW.metadata - 'messageId') || jsonb_build_object(
          'attendanceEventId', NEW.id,
          'lastAttendanceEventId', NEW.id,
          'conversationId', NEW.conversation_id,
          'cycleId', NEW.cycle_id,
          'actorName', NEW.actor_name,
          'actionType', 'conversation.window_24h',
          'attendanceEventType', 'conversation.window_24h',
          'source', 'attendance',
          'messagesCount', v_msg_count,
          'outboundCount', v_out_count,
          'mediaCount', v_media_count,
          'windowStartAt', NEW.created_at,
          'windowEndAt', NEW.created_at,
          'lastMessagePreview', v_clean_preview,
          'description', format(
            'Interação consolidada (janela de 24h): 1 mensagem registrada%s. Última: %s',
            CASE WHEN v_media_count > 0 THEN ' (1 mídia)' ELSE '' END,
            v_clean_preview
          ),
          'occurredAt', NEW.created_at
        ),
        NEW.created_at
      )
      ON CONFLICT (id) DO NOTHING;

      RETURN NEW;
    END IF;

    INSERT INTO crm_deal_events(id, tenant_id, deal_id, operator_id, event_type, metadata, created_at)
    VALUES (
      'attendance-' || NEW.id,
      NEW.tenant_id,
      NEW.deal_id,
      NEW.operator_id,
      'conversation_action',
      NEW.metadata || jsonb_build_object(
        'attendanceEventId', NEW.id,
        'conversationId', NEW.conversation_id,
        'cycleId', NEW.cycle_id,
        'description', NEW.description,
        'actorName', NEW.actor_name,
        'actionType', NEW.event_type,
        'source', 'attendance',
        'occurredAt', NEW.created_at
      ),
      NEW.created_at
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

-- Remove eventos redundantes de status transitório já gravados anteriormente
DELETE FROM crm_deal_events
WHERE event_type = 'conversation_action'
  AND coalesce(metadata->>'actionType', metadata->>'attendanceEventType', '') IN (
    'message.sending',
    'message.accepted',
    'message.delivered',
    'message.read'
  );

DELETE FROM attendance_events
WHERE event_type IN (
  'message.sending',
  'message.accepted',
  'message.delivered',
  'message.read'
);

-- Atualiza descrições legadas "(pending)" em message.created para texto limpo
UPDATE attendance_events
SET description = regexp_replace(description, ' registrou uma mensagem \([^)]+\): ', ' enviou uma mensagem: '),
    metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{status}', '"sent"'::jsonb, true)
WHERE event_type = 'message.created'
  AND description LIKE '%registrou uma mensagem (%';

-- Garante que todas as negociações vinculadas a uma empresa (account_id) também possuam
-- vínculo em crm_deal_contacts com os contatos daquela empresa (como "Tarcisio Teste (Nova)").
INSERT INTO crm_deal_contacts (id, tenant_id, deal_id, contact_id, is_primary, role, created_at)
SELECT
  'dc-acc-' || substr(md5(d.tenant_id || ':' || d.id || ':' || c.id), 1, 24),
  d.tenant_id,
  d.id,
  c.id,
  false,
  'participant',
  now()
FROM crm_deals d
JOIN contacts c
  ON c.tenant_id = d.tenant_id
 AND c.account_id = d.account_id
WHERE d.account_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM crm_deal_contacts dc
    WHERE dc.tenant_id = d.tenant_id
      AND dc.deal_id = d.id
      AND dc.contact_id = c.id
  )
ON CONFLICT DO NOTHING;

-- Repara negociações órfãs criadas em sequência rápida ("Salvar e criar outra" em até 60s
-- pelo mesmo operador) onde o modal limpava acidentalmente o contato/empresa selecionados.
WITH orphan_burst_deals AS (
  SELECT
    orphan.id AS deal_id,
    orphan.tenant_id,
    anchor.account_id AS resolved_account_id,
    anchor_dc.contact_id AS resolved_contact_id
  FROM crm_deals orphan
  JOIN LATERAL (
    SELECT d2.id, d2.account_id
    FROM crm_deals d2
    WHERE d2.tenant_id = orphan.tenant_id
      AND d2.operator_id = orphan.operator_id
      AND d2.id <> orphan.id
      AND abs(extract(epoch FROM (orphan.created_at - d2.created_at))) <= 60
      AND EXISTS (
        SELECT 1 FROM crm_deal_contacts dc2
        WHERE dc2.tenant_id = d2.tenant_id AND dc2.deal_id = d2.id
      )
    ORDER BY abs(extract(epoch FROM (orphan.created_at - d2.created_at))) ASC
    LIMIT 1
  ) anchor ON true
  JOIN LATERAL (
    SELECT dc3.contact_id
    FROM crm_deal_contacts dc3
    WHERE dc3.tenant_id = orphan.tenant_id AND dc3.deal_id = anchor.id
    ORDER BY dc3.is_primary DESC, dc3.created_at ASC
    LIMIT 1
  ) anchor_dc ON true
  WHERE orphan.operator_id IS NOT NULL
    AND orphan.account_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM crm_deal_contacts dc
      WHERE dc.tenant_id = orphan.tenant_id AND dc.deal_id = orphan.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM crm_conversation_deals cd
      WHERE cd.tenant_id = orphan.tenant_id AND cd.deal_id = orphan.id
    )
)
UPDATE crm_deals d
SET account_id = obd.resolved_account_id
FROM orphan_burst_deals obd
WHERE d.tenant_id = obd.tenant_id
  AND d.id = obd.deal_id
  AND obd.resolved_account_id IS NOT NULL
  AND d.account_id IS NULL;

WITH orphan_burst_contacts AS (
  SELECT
    orphan.id AS deal_id,
    orphan.tenant_id,
    anchor_dc.contact_id AS resolved_contact_id
  FROM crm_deals orphan
  JOIN LATERAL (
    SELECT d2.id
    FROM crm_deals d2
    WHERE d2.tenant_id = orphan.tenant_id
      AND d2.operator_id = orphan.operator_id
      AND d2.id <> orphan.id
      AND abs(extract(epoch FROM (orphan.created_at - d2.created_at))) <= 60
      AND EXISTS (
        SELECT 1 FROM crm_deal_contacts dc2
        WHERE dc2.tenant_id = d2.tenant_id AND dc2.deal_id = d2.id
      )
    ORDER BY abs(extract(epoch FROM (orphan.created_at - d2.created_at))) ASC
    LIMIT 1
  ) anchor ON true
  JOIN LATERAL (
    SELECT dc3.contact_id
    FROM crm_deal_contacts dc3
    WHERE dc3.tenant_id = orphan.tenant_id AND dc3.deal_id = anchor.id
    ORDER BY dc3.is_primary DESC, dc3.created_at ASC
    LIMIT 1
  ) anchor_dc ON true
  WHERE orphan.operator_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM crm_deal_contacts dc
      WHERE dc.tenant_id = orphan.tenant_id AND dc.deal_id = orphan.id
    )
)
INSERT INTO crm_deal_contacts (id, tenant_id, deal_id, contact_id, is_primary, role, created_at)
SELECT
  'dc-burst-' || substr(md5(obc.tenant_id || ':' || obc.deal_id || ':' || obc.resolved_contact_id), 1, 22),
  obc.tenant_id,
  obc.deal_id,
  obc.resolved_contact_id,
  true,
  'primary',
  now()
FROM orphan_burst_contacts obc
ON CONFLICT DO NOTHING;

