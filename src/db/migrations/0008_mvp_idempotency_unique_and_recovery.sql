-- 1. Índice único de idempotência para mensagens de saída por tenant (evita corrida concorrente)
CREATE UNIQUE INDEX IF NOT EXISTS "idx_messages_tenant_idempotency_uniq"
ON "messages" ("tenant_id", "idempotency_key")
WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint

-- 2. Índice único de deduplicação para eventos de entrada por tenant (evita duplicar webhook)
CREATE UNIQUE INDEX IF NOT EXISTS "idx_pending_inbounds_tenant_event_uniq"
ON "pending_inbounds" ("tenant_id", "external_event_id")
WHERE "external_event_id" IS NOT NULL;
