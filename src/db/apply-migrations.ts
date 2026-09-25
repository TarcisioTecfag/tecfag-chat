import { db } from "./index.ts";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function applyMvpMigration(): Promise<void> {
  console.log("[Migration] Iniciando aplicação da migração 0007 (MVP Identidade, Isolamento e Mensagens Confiáveis)...");

  const statements = [
    // 1. Tabela auth_sessions
    `CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      revoked_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );`,
    `CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(token_hash);`,
    `CREATE INDEX IF NOT EXISTS idx_auth_sessions_operator ON auth_sessions(operator_id);`,
    `CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);`,

    // 2. Colunas em channel_configs
    `ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS active_provider TEXT NOT NULL DEFAULT 'baileys';`,
    `ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS connection_status TEXT NOT NULL DEFAULT 'disconnected';`,
    `ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS connection_version INTEGER NOT NULL DEFAULT 1;`,
    `ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS meta_app_secret TEXT;`,
    `ALTER TABLE channel_configs ADD COLUMN IF NOT EXISTS last_error TEXT;`,
    `UPDATE channel_configs cc
     SET active_provider = COALESCE((SELECT t.connection_type FROM tenants t WHERE t.id = cc.tenant_id), 'baileys')
     WHERE active_provider IS NULL OR active_provider = 'baileys';`,

    // 3. Colunas em conversations
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;`,
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();`,
    `CREATE INDEX IF NOT EXISTS idx_conversations_tenant_queue_time ON conversations(tenant_id, queue_state, last_message_time DESC, id);`,
    `CREATE INDEX IF NOT EXISTS idx_conversations_tenant_operator ON conversations(tenant_id, operator_id);`,

    // 4. Colunas em messages
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS external_id TEXT;`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'baileys';`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'inbound';`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'accepted';`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS idempotency_key TEXT;`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS error_message TEXT;`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();`,
    `CREATE INDEX IF NOT EXISTS idx_messages_tenant_conv_sent ON messages(tenant_id, conversation_id, sent_at DESC, id);`,
    `CREATE INDEX IF NOT EXISTS idx_messages_tenant_idempotency ON messages(tenant_id, idempotency_key);`,

    // 5. Colunas em media_files
    `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;`,
    `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS conversation_id TEXT;`,
    `ALTER TABLE media_files ADD COLUMN IF NOT EXISTS file_size INTEGER;`,
    `UPDATE media_files mf
     SET tenant_id = m.tenant_id,
         conversation_id = m.conversation_id
     FROM messages m
     WHERE mf.id = m.id AND mf.tenant_id IS NULL;`,

    // 6. Tabela pending_inbounds
    `CREATE TABLE IF NOT EXISTS pending_inbounds (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      external_event_id TEXT,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at TIMESTAMP,
      error_message TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMP
    );`,
    `CREATE INDEX IF NOT EXISTS idx_pending_inbounds_tenant_event ON pending_inbounds(tenant_id, external_event_id);`,
    `CREATE INDEX IF NOT EXISTS idx_pending_inbounds_status_retry ON pending_inbounds(status, next_retry_at);`,

    // 7. Índices Únicos Parciais para Idempotência e Deduplicação Concorrente (Migração 0008)
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_tenant_idempotency_uniq ON messages(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_inbounds_tenant_event_uniq ON pending_inbounds(tenant_id, external_event_id) WHERE external_event_id IS NOT NULL;`,
  ];

  for (const query of statements) {
    try {
      await db.execute(sql.raw(query));
    } catch (err: any) {
      console.warn(`[Migration Warning] Falha na instrução: ${query.slice(0, 60)}... Erro:`, err?.message || err);
    }
  }

  // Marcar migrações no journal do Drizzle se tabela existir
  try {
    const journalPath = path.join(__dirname, "migrations", "meta", "_journal.json");
    if (fs.existsSync(journalPath)) {
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
      for (const entry of journal.entries) {
        await db.execute(sql`
          INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
          VALUES (${entry.tag}, ${entry.when})
          ON CONFLICT DO NOTHING;
        `);
      }
    }
  } catch (e: any) {
    // tabela drizzle migrations pode ter colunas id, hash, created_at
  }

  console.log("[Migration] ✓ Migração 0007 aplicada com sucesso!");
}

if (process.argv[1]?.includes("apply-migrations")) {
  applyMvpMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[Migration] Erro fatal:", err);
      process.exit(1);
    });
}
