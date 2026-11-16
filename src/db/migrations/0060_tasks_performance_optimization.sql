-- Índices compostos e parciais para aceleração do módulo Tarefas e Compromissos (/api/tasks & /api/gestao/tasks)

-- 1. Busca de tarefas ativas (não canceladas e não notas/eventos) por janela de data (calendário Mês/Semana/Dia)
CREATE INDEX IF NOT EXISTS idx_crm_activities_active_tasks_due
  ON crm_deal_activities (tenant_id, due_date ASC, created_at DESC)
  WHERE status != 'cancelled' AND type NOT IN ('note', 'system_event');

-- 2. Contagem instantânea e listagem de tarefas pendentes e em atraso por tenant
CREATE INDEX IF NOT EXISTS idx_crm_activities_pending_tasks_due
  ON crm_deal_activities (tenant_id, due_date ASC)
  WHERE status = 'pending' AND type NOT IN ('note', 'system_event');

-- 3. Busca GIN em múltiplos responsáveis compartilhados (assigned_to_operator_ids @> '["opId"]'::jsonb)
CREATE INDEX IF NOT EXISTS idx_crm_activities_assigned_ops_gin
  ON crm_deal_activities USING gin (assigned_to_operator_ids);

-- 4. Lookup determinístico O(log N) do contato principal da negociação (evita multiplicação cartesiana em JOINs)
CREATE INDEX IF NOT EXISTS idx_crm_deal_contacts_primary_lookup
  ON crm_deal_contacts (tenant_id, deal_id, is_primary DESC, created_at ASC);

-- 5. Lookup instantâneo da conversa mais recente por contato (independente de whatsapp_connection_id ser NULL ou preenchido)
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_contact_updated
  ON conversations (tenant_id, contact_id, updated_at DESC);
