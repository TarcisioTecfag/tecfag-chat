import { sql } from "drizzle-orm";
import { db } from "../../db";
import { runtimeSingleton } from "../runtime-singleton";

const auditSchemaState = runtimeSingleton("AuditOriginSchemaState", () => ({
  promise: null as Promise<void> | null,
}));

/**
 * Garante de forma idempotente as colunas estruturadas de auditoria de origem
 * (`actor_type`, `source_channel`, `actor_name`, `client_ip`, `entity_id`, `mcp_key_id`, `mcp_key_label`)
 * em `crm_deal_events`, `crm_action_history` e `attendance_events`.
 */
export function ensureAuditOriginSchema(): Promise<void> {
  if (!auditSchemaState.promise) {
    auditSchemaState.promise = (async () => {
      await db.execute(sql`
        ALTER TABLE crm_deal_events
          ADD COLUMN IF NOT EXISTS actor_type text,
          ADD COLUMN IF NOT EXISTS source_channel text,
          ADD COLUMN IF NOT EXISTS actor_name text,
          ADD COLUMN IF NOT EXISTS client_ip text,
          ADD COLUMN IF NOT EXISTS mcp_key_id text,
          ADD COLUMN IF NOT EXISTS mcp_key_label text;
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_crm_deal_events_tenant_channel_created
          ON crm_deal_events (tenant_id, source_channel, created_at DESC);
      `);
      await db.execute(sql`
        ALTER TABLE crm_action_history
          ADD COLUMN IF NOT EXISTS entity_id text,
          ADD COLUMN IF NOT EXISTS actor_type text,
          ADD COLUMN IF NOT EXISTS source_channel text,
          ADD COLUMN IF NOT EXISTS client_ip text,
          ADD COLUMN IF NOT EXISTS mcp_key_id text,
          ADD COLUMN IF NOT EXISTS mcp_key_label text;
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_crm_action_history_tenant_entity_id_created
          ON crm_action_history (tenant_id, entity_type, entity_id, created_at DESC);
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_crm_action_history_tenant_channel_created
          ON crm_action_history (tenant_id, source_channel, created_at DESC);
      `);
      await db.execute(sql`
        ALTER TABLE attendance_events
          ADD COLUMN IF NOT EXISTS actor_type text,
          ADD COLUMN IF NOT EXISTS source_channel text,
          ADD COLUMN IF NOT EXISTS client_ip text,
          ADD COLUMN IF NOT EXISTS mcp_key_id text,
          ADD COLUMN IF NOT EXISTS mcp_key_label text;
      `);
    })().catch((err) => {
      auditSchemaState.promise = null;
      throw err;
    });
  }
  return auditSchemaState.promise;
}
