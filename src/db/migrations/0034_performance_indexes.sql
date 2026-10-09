-- Índices B-Tree compostos estratégicos para alta performance (Fase 5)
-- Otimizados para cargas de trabalho corporativas em hardware com gráficos integrados e CPU limitada

-- 1. crm_deals: Otimização para tela inicial de consultor, métricas de pacing e fechamento
CREATE INDEX IF NOT EXISTS idx_crm_deals_tenant_op_status 
  ON crm_deals (tenant_id, operator_id, status);

CREATE INDEX IF NOT EXISTS idx_crm_deals_tenant_status_closed 
  ON crm_deals (tenant_id, status, closed_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_deals_tenant_pipe_stage_updated 
  ON crm_deals (tenant_id, pipeline_id, stage_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_deals_tenant_status_updated 
  ON crm_deals (tenant_id, status, updated_at DESC);

-- 2. crm_deal_activities: Otimização para agenda de tarefas pendentes e próximas ações
CREATE INDEX IF NOT EXISTS idx_crm_activities_tenant_assignee_status_due 
  ON crm_deal_activities (tenant_id, assigned_to_operator_id, status, due_date);

-- 3. contacts: Otimização para match canônico de telefone e carteira de clientes
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_phone 
  ON contacts (tenant_id, phone);

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_wallet 
  ON contacts (tenant_id, wallet_operator_id);

-- 4. conversations: Otimização da fila "Meus Atendimentos" com ordenação cronológica
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_op_queue_msg_time 
  ON conversations (tenant_id, operator_id, queue_state, last_message_time DESC);

-- 5. messages: Otimização para lookup de recibos de entrega (webhooks Meta e Baileys)
CREATE INDEX IF NOT EXISTS idx_messages_tenant_external 
  ON messages (tenant_id, external_id);
