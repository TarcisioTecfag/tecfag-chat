-- Permite que negociações pausadas ('paused') também mantenham o vínculo ativo como
-- negociação atual da conversa (current_deal_id), registrando normalmente mensagens,
-- notas, tarefas e eventos de atendimento sem alterar o status 'paused' do card.

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
    JOIN crm_deals d ON d.id = c.current_deal_id AND d.tenant_id = p_tenant AND d.status IN ('open', 'paused')
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

CREATE OR REPLACE FUNCTION bind_pending_attendance_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_deal_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM crm_deals d JOIN crm_conversation_deals l
      ON l.deal_id = d.id AND l.tenant_id = NEW.tenant_id AND l.is_active
      AND l.conversation_id = NEW.conversation_id
    WHERE d.id = NEW.current_deal_id AND d.tenant_id = NEW.tenant_id AND d.status IN ('open', 'paused')
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
