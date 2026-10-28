-- Garante que todo evento de atendimento e negociação identifique explicitamente
-- o titular da ação (Operador logado ou Automação específica), sem cair em "Sistema" anônimo.

CREATE OR REPLACE FUNCTION capture_attendance_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_type text; v_text text; v_actor text; v_operator text; v_key text; v_meta jsonb; v_deal text;
BEGIN
  IF NEW.sender_type = 'client' OR coalesce(NEW.meta_details->>'attendanceSkip', '') = 'true'
    THEN RETURN NEW; END IF;
  v_actor := coalesce(nullif(NEW.meta_details->'attendanceActor'->>'name', ''), nullif(NEW.sender_name, ''));
  v_operator := NEW.meta_details->'attendanceActor'->>'operatorId';
  v_meta := jsonb_build_object('messageId', NEW.id, 'status', NEW.status, 'provider', NEW.provider);
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.is_internal_note THEN RETURN NEW; END IF;
    v_type := 'message.' || NEW.status;
    v_text := CASE NEW.status WHEN 'failed' THEN 'Falha no envio da mensagem'
      WHEN 'delivered' THEN 'Mensagem entregue' WHEN 'read' THEN 'Mensagem lida pelo cliente'
      WHEN 'accepted' THEN 'Mensagem aceita pelo canal' WHEN 'sending' THEN 'Envio em andamento'
      ELSE 'Status da mensagem: ' || NEW.status END;
    v_key := 'message:' || NEW.id || ':' || NEW.status || ':' || NEW.retry_count;
    v_meta := v_meta || jsonb_build_object('anchorKey', 'message:' || NEW.id || ':created', 'error', NEW.error_message);
  ELSE
    v_type := CASE WHEN NEW.meta_details->>'attendanceEventType' = 'attendance.context_selected' THEN 'attendance.context_selected'
      WHEN NEW.meta_details ? 'activityId' THEN 'task.created'
      WHEN NEW.is_internal_note AND NEW.sender_type <> 'system' THEN 'note.created'
      WHEN NEW.is_internal_note OR NEW.sender_type = 'system' THEN 'system.recorded'
      ELSE 'message.created' END;
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
    v_text := CASE WHEN v_type = 'note.created' THEN v_actor || ' adicionou uma nota: ' || NEW.content
      WHEN v_type = 'message.created' THEN v_actor || ' registrou uma mensagem (' || NEW.status || '): ' || NEW.content
      ELSE NEW.content END;
    v_key := 'message:' || NEW.id || ':created';
    v_meta := v_meta || jsonb_build_object('industrialTriage', NEW.meta_details->'industrialTriage', 'activityId', NEW.meta_details->>'activityId');
  END IF;
  PERFORM record_attendance_event(NEW.tenant_id, NEW.conversation_id, v_key, v_type,
    v_text, v_actor, v_operator, v_meta);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION capture_attendance_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_type text; v_text text; v_actor text; v_destination text; v_operator text; v_principal jsonb; v_channel text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_type := 'attendance.created'; v_text := 'Atendimento criado';
    v_operator := NEW.operator_id;
  ELSE
    IF NEW.queue_state IS NOT DISTINCT FROM OLD.queue_state AND NEW.operator_id IS NOT DISTINCT FROM OLD.operator_id
      AND NEW.sector_id IS NOT DISTINCT FROM OLD.sector_id THEN RETURN NEW; END IF;
    v_operator := coalesce(NEW.operator_id, OLD.operator_id);
    IF NEW.queue_state = 'finalizados' THEN
      v_type := 'attendance.closed'; v_text := 'Atendimento encerrado'; v_operator := OLD.operator_id;
    ELSIF OLD.queue_state = 'finalizados' THEN
      v_type := 'attendance.reopened'; v_text := 'Atendimento reativado';
    ELSIF NEW.queue_state = 'meus' AND NEW.operator_id IS NOT NULL AND OLD.operator_id IS NULL THEN
      v_type := 'attendance.started'; v_text := 'Atendimento iniciado'; v_operator := NEW.operator_id;
    ELSE
      v_type := 'attendance.transferred'; v_text := 'Atendimento transferido';
    END IF;
  END IF;
  IF v_operator IS NOT NULL THEN
    SELECT name INTO v_actor FROM operators WHERE tenant_id = NEW.tenant_id AND id = v_operator;
  END IF;
  v_principal := nullif(current_setting('attendance.actor', true), '')::jsonb;
  IF v_principal->>'tenantId' = NEW.tenant_id THEN
    v_actor := nullif(v_principal->>'name', '');
    v_operator := nullif(v_principal->>'operatorId', '');
  END IF;
  IF v_actor IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM crm_deal_contacts dc
      JOIN rd_marketing_receipts r ON r.tenant_id = dc.tenant_id AND r.deal_id = dc.deal_id
      WHERE dc.tenant_id = NEW.tenant_id AND dc.contact_id = NEW.contact_id
    ) THEN
      v_actor := 'Automação RD Station Marketing';
    ELSIF NEW.id LIKE 'site-conv-%' THEN
      v_actor := 'Automação Site (Chat Online)';
    ELSIF NEW.queue_state = 'automacao' THEN
      v_actor := 'Automação SDR';
    ELSE
      SELECT main_channel INTO v_channel FROM contacts WHERE tenant_id = NEW.tenant_id AND id = NEW.contact_id;
      v_actor := CASE WHEN v_channel = 'livechat' THEN 'Automação Site (Chat Online)'
        WHEN v_channel = 'whatsapp' THEN 'Automação WhatsApp'
        ELSE 'Sistema' END;
    END IF;
  END IF;
  SELECT concat_ws(' — ', s.name, o.name) INTO v_destination FROM conversations c
    LEFT JOIN sectors s ON s.tenant_id = NEW.tenant_id AND s.id = c.sector_id
    LEFT JOIN operators o ON o.tenant_id = NEW.tenant_id AND o.id = c.operator_id
    WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.id;
  PERFORM record_attendance_event(NEW.tenant_id, NEW.id, 'transition:' || gen_random_uuid()::text, v_type,
    v_text || CASE WHEN v_destination <> '' THEN ': ' || v_destination ELSE '' END,
    coalesce(v_actor, 'Sistema'), v_operator,
    jsonb_build_object('queueState', NEW.queue_state, 'operatorId', NEW.operator_id, 'sectorId', NEW.sector_id));
  IF NEW.queue_state = 'finalizados' THEN
    UPDATE attendance_event_cycles SET closed = true WHERE tenant_id = NEW.tenant_id AND conversation_id = NEW.id;
    INSERT INTO conversation_deal_contexts(tenant_id, conversation_id, selection_required)
      VALUES (NEW.tenant_id, NEW.id, true)
    ON CONFLICT (conversation_id) DO UPDATE SET
      previous_deal_id = coalesce(conversation_deal_contexts.current_deal_id, conversation_deal_contexts.previous_deal_id),
      current_deal_id = NULL, selection_required = true,
      version = conversation_deal_contexts.version + 1, updated_at = clock_timestamp()
    WHERE conversation_deal_contexts.tenant_id = NEW.tenant_id
      AND (conversation_deal_contexts.current_deal_id IS NOT NULL OR NOT conversation_deal_contexts.selection_required);
  END IF;
  RETURN NEW;
END $$;

-- Reparo retroativo dos eventos existentes onde actor_name ficou como 'Sistema'
WITH resolved_created AS (
  SELECT
    ae.id,
    ae.tenant_id,
    ae.conversation_id,
    coalesce(ae.operator_id, cd.created_by_operator_id, conv.operator_id) AS resolved_operator_id,
    op.name AS resolved_operator_name,
    EXISTS (
      SELECT 1 FROM rd_marketing_receipts r
      WHERE r.tenant_id = ae.tenant_id
        AND (
          r.deal_id = ae.deal_id
          OR r.deal_id IN (
            SELECT dc.deal_id FROM crm_deal_contacts dc
            WHERE dc.tenant_id = ae.tenant_id AND dc.contact_id = conv.contact_id
          )
        )
    ) AS is_rd_marketing,
    conv.queue_state,
    conv.id LIKE 'site-conv-%' AS is_site
  FROM attendance_events ae
  JOIN conversations conv ON conv.tenant_id = ae.tenant_id AND conv.id = ae.conversation_id
  LEFT JOIN LATERAL (
    SELECT c.created_by_operator_id
    FROM crm_conversation_deals c
    WHERE c.tenant_id = ae.tenant_id AND c.conversation_id = ae.conversation_id AND c.created_by_operator_id IS NOT NULL
    ORDER BY c.created_at ASC
    LIMIT 1
  ) cd ON true
  LEFT JOIN operators op
    ON op.tenant_id = ae.tenant_id
   AND op.id = coalesce(ae.operator_id, cd.created_by_operator_id, conv.operator_id)
  WHERE ae.event_type = 'attendance.created'
    AND ae.actor_name = 'Sistema'
)
UPDATE attendance_events ae
SET
  operator_id = coalesce(ae.operator_id, rc.resolved_operator_id),
  actor_name = CASE
    WHEN rc.is_rd_marketing AND rc.resolved_operator_name IS NOT NULL AND ae.operator_id IS NULL
      THEN 'Automação RD Station Marketing (' || rc.resolved_operator_name || ')'
    WHEN rc.is_rd_marketing
      THEN 'Automação RD Station Marketing'
    WHEN rc.resolved_operator_name IS NOT NULL
      THEN rc.resolved_operator_name
    WHEN rc.is_site
      THEN 'Automação Site (Chat Online)'
    WHEN rc.queue_state = 'automacao'
      THEN 'Automação SDR'
    ELSE 'Automação WhatsApp'
  END
FROM resolved_created rc
WHERE ae.id = rc.id AND ae.tenant_id = rc.tenant_id;

WITH resolved_context AS (
  SELECT
    ae.id,
    ae.tenant_id,
    ae.conversation_id,
    ae.deal_id,
    coalesce(ae.operator_id, de.operator_id, cd.created_by_operator_id) AS resolved_operator_id,
    op.name AS resolved_operator_name,
    EXISTS (
      SELECT 1 FROM rd_marketing_receipts r
      WHERE r.tenant_id = ae.tenant_id AND r.deal_id = ae.deal_id
    ) AS is_rd_marketing
  FROM attendance_events ae
  LEFT JOIN LATERAL (
    SELECT e.operator_id
    FROM crm_deal_events e
    WHERE e.tenant_id = ae.tenant_id
      AND e.deal_id = ae.deal_id
      AND e.event_type = 'conversation_context_changed'
      AND e.operator_id IS NOT NULL
    ORDER BY e.created_at ASC
    LIMIT 1
  ) de ON true
  LEFT JOIN LATERAL (
    SELECT c.created_by_operator_id
    FROM crm_conversation_deals c
    WHERE c.tenant_id = ae.tenant_id AND c.conversation_id = ae.conversation_id AND c.created_by_operator_id IS NOT NULL
    ORDER BY c.created_at ASC
    LIMIT 1
  ) cd ON true
  LEFT JOIN operators op
    ON op.tenant_id = ae.tenant_id
   AND op.id = coalesce(ae.operator_id, de.operator_id, cd.created_by_operator_id)
  WHERE ae.event_type = 'attendance.context_selected'
    AND ae.actor_name = 'Sistema'
)
UPDATE attendance_events ae
SET
  operator_id = coalesce(ae.operator_id, rc.resolved_operator_id),
  actor_name = CASE
    WHEN rc.is_rd_marketing AND rc.resolved_operator_name IS NOT NULL
      THEN 'Automação RD Station Marketing (' || rc.resolved_operator_name || ')'
    WHEN rc.is_rd_marketing
      THEN 'Automação RD Station Marketing'
    WHEN rc.resolved_operator_name IS NOT NULL
      THEN rc.resolved_operator_name
    ELSE 'Automação CRM'
  END
FROM resolved_context rc
WHERE ae.id = rc.id AND ae.tenant_id = rc.tenant_id;

-- Sincroniza os eventos projetados na ficha da negociação (crm_deal_events)
UPDATE crm_deal_events de
SET
  operator_id = coalesce(de.operator_id, ae.operator_id),
  metadata = de.metadata || jsonb_build_object('actorName', ae.actor_name)
FROM attendance_events ae
WHERE de.tenant_id = ae.tenant_id
  AND de.id = 'attendance-' || ae.id
  AND (de.metadata->>'actorName' IS DISTINCT FROM ae.actor_name OR de.operator_id IS DISTINCT FROM ae.operator_id);

UPDATE crm_deal_events de
SET metadata = de.metadata || jsonb_build_object('actorName', 'Automação RD Station Marketing')
FROM rd_marketing_receipts r
WHERE de.tenant_id = r.tenant_id
  AND de.deal_id = r.deal_id
  AND de.event_type = 'created'
  AND coalesce(de.metadata->>'actorName', '') = '';

UPDATE crm_deal_events de
SET metadata = de.metadata || jsonb_build_object(
  'actorName',
  CASE
    WHEN EXISTS (SELECT 1 FROM rd_marketing_receipts r WHERE r.tenant_id = de.tenant_id AND r.deal_id = de.deal_id)
      THEN CASE WHEN op.name IS NOT NULL THEN 'Automação RD Station Marketing (' || op.name || ')' ELSE 'Automação RD Station Marketing' END
    WHEN op.name IS NOT NULL THEN op.name
    ELSE 'Automação CRM'
  END
)
FROM (
  SELECT d2.id, d2.tenant_id, d2.operator_id FROM crm_deal_events d2 WHERE d2.event_type = 'conversation_context_changed'
) sub
LEFT JOIN operators op ON op.tenant_id = sub.tenant_id AND op.id = sub.operator_id
WHERE de.id = sub.id
  AND de.tenant_id = sub.tenant_id
  AND coalesce(de.metadata->>'actorName', '') = '';
