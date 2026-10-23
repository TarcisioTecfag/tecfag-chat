-- Registro operacional unidirecional: atendimento -> eventos + CRM local.
-- Nenhum backfill, chamada externa ou trigger sobre alterações comerciais do CRM.
CREATE TABLE IF NOT EXISTS attendance_event_cycles (
  conversation_id text PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cycle_id text NOT NULL DEFAULT gen_random_uuid()::text,
  closed boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS attendance_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  cycle_id text NOT NULL,
  source_key text NOT NULL,
  event_type text NOT NULL,
  description text NOT NULL,
  actor_name text NOT NULL,
  operator_id text REFERENCES operators(id) ON DELETE SET NULL,
  deal_id text REFERENCES crm_deals(id) ON DELETE SET NULL,
  pending_binding boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, conversation_id, source_key)
);
CREATE INDEX IF NOT EXISTS idx_attendance_events_timeline
  ON attendance_events(tenant_id, conversation_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_events_pending
  ON attendance_events(tenant_id, conversation_id, cycle_id) WHERE pending_binding;

-- Os escritores do contexto já usam este mesmo lock da conversa. Assim, o card
-- de destino nunca muda entre a ação e seu registro. Erros revertem ambos.
CREATE OR REPLACE FUNCTION record_attendance_event(
  p_tenant text, p_conversation text, p_key text, p_type text,
  p_description text, p_actor text DEFAULT 'Sistema', p_operator text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}', p_created_at timestamp DEFAULT clock_timestamp()
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_conv conversations%ROWTYPE;
  v_cycle attendance_event_cycles%ROWTYPE;
  v_deal text;
  v_id text;
  v_anchor attendance_events%ROWTYPE;
  v_pending boolean;
BEGIN
  SELECT * INTO v_conv FROM conversations
    WHERE tenant_id = p_tenant AND id = p_conversation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Atendimento indisponível para registrar evento'; END IF;
  IF p_operator IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM operators WHERE tenant_id = p_tenant AND id = p_operator
  ) THEN RAISE EXCEPTION 'Operador de outro tenant'; END IF;
  INSERT INTO attendance_event_cycles(conversation_id, tenant_id)
    VALUES (p_conversation, p_tenant) ON CONFLICT DO NOTHING;
  SELECT * INTO v_cycle FROM attendance_event_cycles
    WHERE tenant_id = p_tenant AND conversation_id = p_conversation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ciclo de outro tenant'; END IF;
  IF v_cycle.closed AND (v_conv.queue_state <> 'finalizados' OR p_type = 'triage.started') THEN
    UPDATE attendance_event_cycles SET cycle_id = gen_random_uuid()::text, closed = false
      WHERE tenant_id = p_tenant AND conversation_id = p_conversation RETURNING * INTO v_cycle;
  END IF;
  SELECT d.id INTO v_deal FROM conversation_deal_contexts c
    JOIN crm_deals d ON d.id = c.current_deal_id AND d.tenant_id = p_tenant AND d.status = 'open'
    JOIN crm_conversation_deals l ON l.deal_id = d.id AND l.tenant_id = p_tenant
      AND l.conversation_id = p_conversation AND l.is_active
    WHERE c.tenant_id = p_tenant AND c.conversation_id = p_conversation LIMIT 1;
  v_pending := v_deal IS NULL;
  -- Recibos de entrega pertencem à mensagem original, mesmo após trocar o card.
  IF p_metadata ? 'anchorKey' THEN
    SELECT * INTO v_anchor FROM attendance_events WHERE tenant_id = p_tenant
      AND conversation_id = p_conversation AND source_key = p_metadata->>'anchorKey';
    IF FOUND THEN
      v_cycle.cycle_id := v_anchor.cycle_id;
      v_deal := v_anchor.deal_id;
      v_pending := v_anchor.pending_binding;
      p_actor := v_anchor.actor_name;
      p_operator := v_anchor.operator_id;
    END IF;
  END IF;
  v_id := 'ae-' || md5(jsonb_build_array(p_tenant, p_conversation, p_key)::text);
  INSERT INTO attendance_events(id, tenant_id, conversation_id, cycle_id, source_key,
    event_type, description, actor_name, operator_id, deal_id, pending_binding, metadata, created_at)
  VALUES(v_id, p_tenant, p_conversation, v_cycle.cycle_id, p_key, p_type,
    left(p_description, 16000), coalesce(nullif(p_actor, ''), 'Sistema'), p_operator,
    v_deal, v_pending, p_metadata || jsonb_build_object('dealSnapshotId', v_deal),
    greatest(date_trunc('milliseconds', p_created_at),
      (SELECT max(created_at) + interval '1 millisecond' FROM attendance_events
        WHERE tenant_id = p_tenant AND conversation_id = p_conversation)))
  ON CONFLICT (tenant_id, conversation_id, source_key) DO NOTHING;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION project_attendance_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deal_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM crm_deals WHERE tenant_id = NEW.tenant_id AND id = NEW.deal_id
  ) THEN
    INSERT INTO crm_deal_events(id, tenant_id, deal_id, operator_id, event_type, metadata, created_at)
    VALUES ('attendance-' || NEW.id, NEW.tenant_id, NEW.deal_id, NEW.operator_id, 'conversation_action',
      NEW.metadata || jsonb_build_object('attendanceEventId', NEW.id, 'conversationId', NEW.conversation_id,
        'cycleId', NEW.cycle_id, 'description', NEW.description, 'actorName', NEW.actor_name,
        'actionType', NEW.event_type, 'source', 'attendance', 'occurredAt', NEW.created_at), NEW.created_at)
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS attendance_event_project ON attendance_events;
CREATE TRIGGER attendance_event_project AFTER INSERT OR UPDATE OF deal_id ON attendance_events
  FOR EACH ROW EXECUTE FUNCTION project_attendance_event();

CREATE OR REPLACE FUNCTION bind_pending_attendance_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_deal_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM crm_deals d JOIN crm_conversation_deals l
      ON l.deal_id = d.id AND l.tenant_id = NEW.tenant_id AND l.is_active
      AND l.conversation_id = NEW.conversation_id
    WHERE d.id = NEW.current_deal_id AND d.tenant_id = NEW.tenant_id AND d.status = 'open'
  ) THEN RETURN NEW; END IF;
  UPDATE attendance_events e SET deal_id = NEW.current_deal_id, pending_binding = false,
      metadata = e.metadata || jsonb_build_object('dealSnapshotId', NEW.current_deal_id)
    FROM attendance_event_cycles c, conversations v
    WHERE e.tenant_id = NEW.tenant_id AND e.conversation_id = NEW.conversation_id
      AND e.pending_binding AND e.deal_id IS NULL
      AND c.tenant_id = NEW.tenant_id AND c.conversation_id = NEW.conversation_id
      AND NOT c.closed AND e.cycle_id = c.cycle_id
      AND v.tenant_id = NEW.tenant_id AND v.id = NEW.conversation_id AND v.queue_state <> 'finalizados';
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS attendance_context_bind ON conversation_deal_contexts;
CREATE TRIGGER attendance_context_bind AFTER INSERT OR UPDATE OF current_deal_id ON conversation_deal_contexts
  FOR EACH ROW EXECUTE FUNCTION bind_pending_attendance_events();

CREATE OR REPLACE FUNCTION capture_attendance_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_type text; v_text text; v_actor text; v_operator text; v_key text; v_meta jsonb;
BEGIN
  IF NEW.sender_type = 'client' OR coalesce(NEW.meta_details->>'attendanceSkip', '') = 'true'
    THEN RETURN NEW; END IF;
  v_actor := coalesce(NEW.meta_details->'attendanceActor'->>'name', NEW.sender_name);
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
DROP TRIGGER IF EXISTS attendance_message_capture ON messages;
CREATE TRIGGER attendance_message_capture AFTER INSERT OR UPDATE OF status ON messages
  FOR EACH ROW EXECUTE FUNCTION capture_attendance_message();

CREATE OR REPLACE FUNCTION capture_attendance_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_type text; v_text text; v_actor text; v_destination text; v_operator text; v_principal jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_type := 'attendance.created'; v_text := 'Atendimento criado';
  ELSE
    IF NEW.queue_state IS NOT DISTINCT FROM OLD.queue_state AND NEW.operator_id IS NOT DISTINCT FROM OLD.operator_id
      AND NEW.sector_id IS NOT DISTINCT FROM OLD.sector_id THEN RETURN NEW; END IF;
    v_operator := OLD.operator_id;
    IF NEW.queue_state = 'finalizados' THEN
      v_type := 'attendance.closed'; v_text := 'Atendimento encerrado';
    ELSIF OLD.queue_state = 'finalizados' THEN
      v_type := 'attendance.reopened'; v_text := 'Atendimento reativado';
    ELSIF NEW.queue_state = 'meus' AND NEW.operator_id IS NOT NULL AND OLD.operator_id IS NULL THEN
      v_type := 'attendance.started'; v_text := 'Atendimento iniciado'; v_operator := NEW.operator_id;
    ELSE
      v_type := 'attendance.transferred'; v_text := 'Atendimento transferido';
    END IF;
  END IF;
  SELECT name INTO v_actor FROM operators WHERE tenant_id = NEW.tenant_id AND id = v_operator;
  v_principal := nullif(current_setting('attendance.actor', true), '')::jsonb;
  IF v_principal->>'tenantId' = NEW.tenant_id THEN
    v_actor := v_principal->>'name'; v_operator := v_principal->>'operatorId';
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
DROP TRIGGER IF EXISTS attendance_transition_capture ON conversations;
CREATE TRIGGER attendance_transition_capture AFTER INSERT OR UPDATE OF queue_state, operator_id, sector_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION capture_attendance_transition();

CREATE OR REPLACE FUNCTION capture_attendance_triage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_actor text; v_operator text; v_key text; v_field record; v_before jsonb := '{}'; v_old_meta jsonb := '{}';
BEGIN
  IF NEW.agent_type <> 'sdr' THEN RETURN NEW; END IF;
  v_actor := coalesce(NEW.metadata->>'attendanceActorName', 'Assistente de triagem');
  v_key := 'triage:' || NEW.id || ':' || NEW.started_at::text;
  IF TG_OP = 'UPDATE' THEN
    v_before := coalesce(OLD.collected_data, '{}'); v_old_meta := coalesce(OLD.metadata, '{}');
    IF NEW.metadata->'humanReview' IS DISTINCT FROM OLD.metadata->'humanReview' THEN
      v_operator := NEW.metadata->'humanReview'->>'operatorId';
      IF v_operator IS NOT NULL THEN
        SELECT name INTO v_actor FROM operators WHERE tenant_id = NEW.tenant_id AND id = v_operator;
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    v_before := '{}'; v_old_meta := '{}';
    PERFORM record_attendance_event(NEW.tenant_id, NEW.conversation_id, v_key || ':started', 'triage.started',
      v_actor || ' iniciou a triagem', v_actor);
  END IF;
  IF NEW.metadata->'knownClient' IS NOT NULL AND NEW.metadata->'knownClient' IS DISTINCT FROM v_old_meta->'knownClient' THEN
    PERFORM record_attendance_event(NEW.tenant_id, NEW.conversation_id,
      v_key || ':known:' || md5((NEW.metadata->'knownClient')::text), 'triage.client_recognized',
      v_actor || ' encontrou cadastro anterior do cliente', v_actor,
      NULL, jsonb_build_object('knownClient', NEW.metadata->'knownClient'));
    IF NEW.metadata->'knownClient'->>'confirmed' = 'true' THEN
      PERFORM record_attendance_event(NEW.tenant_id, NEW.conversation_id,
        v_key || ':restored', 'triage.data_restored',
        v_actor || ' confirmou o cadastro e recuperou os dados do cliente', v_actor);
    END IF;
  END IF;
  IF NEW.collected_data->'_KNOWN_COMPANY_CONFIRMED'->>'status' = 'filled' THEN
    IF NEW.metadata->'knownClient' IS NULL THEN
      PERFORM record_attendance_event(NEW.tenant_id, NEW.conversation_id,
        v_key || ':known-confirmed', 'triage.client_recognized',
        v_actor || ' reconheceu o cadastro anterior confirmado pelo cliente', v_actor);
    END IF;
    PERFORM record_attendance_event(NEW.tenant_id, NEW.conversation_id,
      v_key || ':restored', 'triage.data_restored',
      v_actor || ' confirmou o cadastro e recuperou os dados do cliente', v_actor);
  END IF;
  FOR v_field IN SELECT key, value FROM jsonb_each(coalesce(NEW.collected_data, '{}')) LOOP
    IF left(v_field.key, 1) <> '_' AND v_field.value IS DISTINCT FROM v_before->v_field.key THEN
      PERFORM record_attendance_event(NEW.tenant_id, NEW.conversation_id,
        v_key || ':field:' || v_field.key || ':' || gen_random_uuid()::text,
        CASE WHEN v_field.value->>'status' = 'filled' AND coalesce(v_before->v_field.key->>'status', '') <> 'filled' THEN 'triage.field_collected' ELSE 'triage.field_updated' END,
        v_actor || CASE WHEN v_field.value->>'status' = 'filled' AND coalesce(v_before->v_field.key->>'status', '') <> 'filled' THEN ' coletou ' ELSE ' atualizou ' END || v_field.key || ': ' ||
          CASE WHEN v_field.value->>'status' = 'filled' THEN coalesce(v_field.value->>'value', '') ELSE 'Aguardando confirmação' END,
        v_actor, v_operator, jsonb_build_object('field', v_field.key, 'before', v_before->v_field.key, 'after', v_field.value));
    END IF;
  END LOOP;
  IF TG_OP = 'UPDATE' AND (NEW.outcome IS DISTINCT FROM OLD.outcome OR NEW.current_step IS DISTINCT FROM OLD.current_step) THEN
    PERFORM record_attendance_event(NEW.tenant_id, NEW.conversation_id,
      v_key || ':status:' || gen_random_uuid()::text, 'triage.status_changed',
      v_actor || ' atualizou a triagem: ' || NEW.current_step || coalesce(' (' || NEW.outcome || ')', ''), v_actor,
      NULL, jsonb_build_object('outcome', NEW.outcome, 'step', NEW.current_step));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS attendance_triage_capture ON agent_flow_states;
CREATE TRIGGER attendance_triage_capture AFTER INSERT OR UPDATE OF started_at, collected_data, metadata, current_step, outcome ON agent_flow_states
  FOR EACH ROW EXECUTE FUNCTION capture_attendance_triage();

CREATE OR REPLACE FUNCTION capture_attendance_call() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_actor text; v_operator text; v_text text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  SELECT name INTO v_actor FROM operators WHERE tenant_id = NEW.tenant_id AND id = NEW.operator_id;
  v_operator := CASE WHEN NEW.status = 'waiting' THEN NEW.operator_id ELSE NULL END;
  v_text := CASE NEW.status WHEN 'waiting' THEN coalesce(v_actor, 'Operador') || ' solicitou uma ligação'
    WHEN 'connecting' THEN 'Cliente entrou na chamada'
    WHEN 'active' THEN 'Ligação conectada' WHEN 'ended' THEN 'Ligação encerrada'
    WHEN 'missed' THEN 'Ligação não atendida' ELSE 'Situação da ligação: ' || NEW.status END;
  PERFORM record_attendance_event(NEW.tenant_id, NEW.conversation_id,
    'call:' || NEW.id || ':' || NEW.status, 'call.' || NEW.status,
    v_text, CASE WHEN NEW.status = 'waiting' THEN coalesce(v_actor, 'Operador') ELSE 'Sistema' END, v_operator,
    jsonb_build_object('callId', NEW.id, 'roomId', NEW.room_id, 'durationSeconds', NEW.duration_seconds, 'ownerOperatorId', NEW.operator_id));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS attendance_call_capture ON call_sessions;
CREATE TRIGGER attendance_call_capture AFTER INSERT OR UPDATE OF status ON call_sessions
  FOR EACH ROW EXECUTE FUNCTION capture_attendance_call();

CREATE OR REPLACE FUNCTION capture_attendance_reaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_actor jsonb; v_emoji text;
BEGIN
  IF ((NEW.meta_details #> '{reactions,operator}') - 'at'::text) IS NOT DISTINCT FROM ((OLD.meta_details #> '{reactions,operator}') - 'at'::text) THEN RETURN NEW; END IF;
  v_actor := NEW.meta_details->'attendanceReactionActor';
  IF v_actor->>'operatorId' IS NULL THEN RETURN NEW; END IF;
  v_emoji := NEW.meta_details->'reactions'->'operator'->>'emoji';
  PERFORM record_attendance_event(NEW.tenant_id, NEW.conversation_id,
    'reaction:' || NEW.id || ':' || gen_random_uuid()::text, 'message.reaction_changed',
    (v_actor->>'name') || CASE WHEN v_emoji IS NULL THEN ' removeu a reação da mensagem.' ELSE ' reagiu à mensagem com ' || v_emoji END,
    v_actor->>'name', v_actor->>'operatorId', jsonb_build_object('messageId', NEW.id, 'emoji', v_emoji));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS attendance_reaction_capture ON messages;
CREATE TRIGGER attendance_reaction_capture AFTER UPDATE OF meta_details ON messages
  FOR EACH ROW EXECUTE FUNCTION capture_attendance_reaction();
