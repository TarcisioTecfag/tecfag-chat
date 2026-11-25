-- 0071: Fila durável de disparo atrasado condicional de templates WhatsApp nos fluxos RD Marketing
-- Permite aguardar N minutos (padrão 5 min) após o webhook do RD: cancela automaticamente se o cliente
-- enviar mensagem no WhatsApp (na janela ou pouco antes) ou já estiver em atendimento ativo; caso contrário,
-- dispara o template oficial Meta e aciona o SDR quando o cliente responder.
-- Mantém no máximo 1 envio pendente por contato/tenant (substituindo pelo fluxo mais recente).

CREATE TABLE IF NOT EXISTS rd_marketing_scheduled_templates (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  flow_id text NOT NULL REFERENCES rd_marketing_flows(id) ON DELETE CASCADE,
  deal_id text NOT NULL,
  contact_id text NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  whatsapp_template_id text NOT NULL,
  client_name text,
  company_name text,
  document text,
  delay_minutes integer NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'pending',
  scheduled_for timestamp NOT NULL,
  triggered_at timestamp NOT NULL DEFAULT now(),
  processed_at timestamp,
  cancel_reason text,
  lease_token text,
  lease_until timestamp,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rd_sched_tpl_due
  ON rd_marketing_scheduled_templates (tenant_id, status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_rd_sched_tpl_contact_status
  ON rd_marketing_scheduled_templates (tenant_id, contact_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rd_sched_tpl_one_pending_per_contact
  ON rd_marketing_scheduled_templates (tenant_id, contact_id)
  WHERE status = 'pending';
