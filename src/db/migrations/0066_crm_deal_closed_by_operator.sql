-- Registra explicitamente o operador que executou a ação de fechamento (venda ou perda)
-- no card do CRM, permitindo aplicar a carência de 30 dias exclusivamente para aquele usuário.

ALTER TABLE crm_deals
  ADD COLUMN IF NOT EXISTS closed_by_operator_id text REFERENCES operators(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_deals_tenant_closed_by
  ON crm_deals (tenant_id, closed_by_operator_id, closed_at);

-- Backfill seguro a partir da auditoria imutável (crm_deal_events) para cards já encerrados.
UPDATE crm_deals d
SET closed_by_operator_id = sub.operator_id
FROM (
  SELECT DISTINCT ON (e.tenant_id, e.deal_id)
    e.tenant_id,
    e.deal_id,
    e.operator_id
  FROM crm_deal_events e
  WHERE e.operator_id IS NOT NULL
    AND (
      (
        e.event_type = 'status_changed'
        AND (
          e.to_status IN ('won', 'lost')
          OR e.metadata->>'toStatus' IN ('won', 'lost')
        )
      )
      OR (
        e.event_type = 'bulk_updated'
        AND e.metadata->>'newStatus' IN ('won', 'lost')
      )
    )
  ORDER BY e.tenant_id, e.deal_id, e.created_at DESC
) sub
WHERE d.tenant_id = sub.tenant_id
  AND d.id = sub.deal_id
  AND d.status IN ('won', 'lost')
  AND d.closed_by_operator_id IS NULL;
