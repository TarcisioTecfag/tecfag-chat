-- Aditiva: nenhum atendimento ou vínculo existente é reescrito.
CREATE TABLE IF NOT EXISTS conversation_deal_contexts (
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id text PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  current_deal_id text REFERENCES crm_deals(id) ON DELETE SET NULL,
  previous_deal_id text REFERENCES crm_deals(id) ON DELETE SET NULL,
  selection_required boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversation_deal_context_tenant_deal
  ON conversation_deal_contexts(tenant_id, current_deal_id);
