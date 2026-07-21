import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/valemchat";

// Client do PostgreSQL (pool principal)
const client = postgres(connectionString, {
  max: 10,
});

export const db = drizzle(client, { schema });

// ── Auto-Criação das Tabelas de Gestão ────────────────────────────────────────
// Garante que todas as tabelas de IA/gestão existam no banco de produção (Railway).
// Usa CREATE TABLE IF NOT EXISTS — seguro de rodar múltiplas vezes sem falhas de FK.
const setupClient = postgres(connectionString, { max: 1 });

setupClient.unsafe(`
  CREATE TABLE IF NOT EXISTS response_time_logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    operator_id TEXT,
    contact_id TEXT,
    client_message_id TEXT NOT NULL,
    client_message_at TIMESTAMP NOT NULL,
    agent_response_id TEXT,
    agent_response_at TIMESTAMP,
    response_time_seconds INTEGER,
    is_overdue BOOLEAN NOT NULL DEFAULT FALSE,
    overdue_threshold_seconds INTEGER NOT NULL DEFAULT 900,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE response_time_logs ADD COLUMN IF NOT EXISTS contact_id TEXT;
  ALTER TABLE response_time_logs ADD COLUMN IF NOT EXISTS agent_response_id TEXT;
  ALTER TABLE response_time_logs ADD COLUMN IF NOT EXISTS agent_response_at TIMESTAMP;
  ALTER TABLE response_time_logs ADD COLUMN IF NOT EXISTS response_time_seconds INTEGER;
  ALTER TABLE response_time_logs ADD COLUMN IF NOT EXISTS overdue_threshold_seconds INTEGER NOT NULL DEFAULT 900;

  CREATE TABLE IF NOT EXISTS ai_conversation_audits (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    operator_id TEXT,
    contact_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    performance_score INTEGER,
    client_sentiment TEXT,
    had_long_response_gap BOOLEAN DEFAULT FALSE,
    had_missed_objection BOOLEAN DEFAULT FALSE,
    had_rude_language BOOLEAN DEFAULT FALSE,
    had_no_follow_up BOOLEAN DEFAULT FALSE,
    summary TEXT,
    strengths TEXT,
    weaknesses TEXT,
    actionable_insight TEXT,
    raw_ai_response JSONB,
    error_message TEXT,
    audited_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE ai_conversation_audits ADD COLUMN IF NOT EXISTS contact_name TEXT;
  ALTER TABLE ai_conversation_audits ADD COLUMN IF NOT EXISTS performance_score INTEGER;
  ALTER TABLE ai_conversation_audits ADD COLUMN IF NOT EXISTS client_sentiment TEXT;
  ALTER TABLE ai_conversation_audits ADD COLUMN IF NOT EXISTS had_long_response_gap BOOLEAN DEFAULT FALSE;
  ALTER TABLE ai_conversation_audits ADD COLUMN IF NOT EXISTS had_missed_objection BOOLEAN DEFAULT FALSE;
  ALTER TABLE ai_conversation_audits ADD COLUMN IF NOT EXISTS had_rude_language BOOLEAN DEFAULT FALSE;
  ALTER TABLE ai_conversation_audits ADD COLUMN IF NOT EXISTS had_no_follow_up BOOLEAN DEFAULT FALSE;
  ALTER TABLE ai_conversation_audits ADD COLUMN IF NOT EXISTS summary TEXT;
  ALTER TABLE ai_conversation_audits ADD COLUMN IF NOT EXISTS strengths TEXT;
  ALTER TABLE ai_conversation_audits ADD COLUMN IF NOT EXISTS weaknesses TEXT;
  ALTER TABLE ai_conversation_audits ADD COLUMN IF NOT EXISTS actionable_insight TEXT;
  ALTER TABLE ai_conversation_audits ADD COLUMN IF NOT EXISTS raw_ai_response JSONB;
  ALTER TABLE ai_conversation_audits ADD COLUMN IF NOT EXISTS error_message TEXT;
  ALTER TABLE ai_conversation_audits ADD COLUMN IF NOT EXISTS audited_at TIMESTAMP;
  ALTER TABLE ai_conversation_audits ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

  CREATE TABLE IF NOT EXISTS operator_daily_metrics (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    operator_name TEXT NOT NULL,
    date TEXT NOT NULL,
    total_conversations INTEGER NOT NULL DEFAULT 0,
    avg_response_time_seconds INTEGER,
    avg_performance_score INTEGER,
    overdue_count INTEGER NOT NULL DEFAULT 0,
    satisfied_count INTEGER NOT NULL DEFAULT 0,
    neutral_count INTEGER NOT NULL DEFAULT 0,
    frustrated_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE operator_daily_metrics ADD COLUMN IF NOT EXISTS avg_response_time_seconds INTEGER;
  ALTER TABLE operator_daily_metrics ADD COLUMN IF NOT EXISTS max_response_time_seconds INTEGER;
  ALTER TABLE operator_daily_metrics ADD COLUMN IF NOT EXISTS avg_performance_score INTEGER;
  ALTER TABLE operator_daily_metrics ADD COLUMN IF NOT EXISTS satisfied_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE operator_daily_metrics ADD COLUMN IF NOT EXISTS neutral_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE operator_daily_metrics ADD COLUMN IF NOT EXISTS frustrated_count INTEGER NOT NULL DEFAULT 0;

  ALTER TABLE operators ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'disponivel';
  ALTER TABLE operators ADD COLUMN IF NOT EXISTS avatar TEXT;
  ALTER TABLE operators ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE operators ADD COLUMN IF NOT EXISTS group_id TEXT;

  CREATE TABLE IF NOT EXISTS ai_reports (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    report_type TEXT NOT NULL,
    period_start TIMESTAMP NOT NULL,
    period_end TIMESTAMP NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS wallet_operator_id TEXT;

  CREATE TABLE IF NOT EXISTS operator_templates (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- ── Valentina Agent Tables (Sem FKs restritivas para garantir criação 100% resiliente) ──

  CREATE TABLE IF NOT EXISTS agent_configs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS agent_flow_states (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    current_step TEXT NOT NULL,
    collected_data JSONB NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}',
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_interaction_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,
    outcome TEXT
  );

  CREATE TABLE IF NOT EXISTS round_robin_state (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    sector_id TEXT NOT NULL,
    last_assigned_operator_id TEXT,
    assignment_count JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS internal_messages (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    read INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
`)
  .then(() => {
    console.log("[db] ✓ Tabelas de gestão e agentes verificadas/criadas com sucesso.");
    setupClient.end();
  })
  .catch((e) => {
    console.warn("[db] Aviso ao criar tabelas de gestão:", e?.message ?? e);
    setupClient.end();
  });
