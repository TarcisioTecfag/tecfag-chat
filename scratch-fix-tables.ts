import postgres from "postgres";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/valemchat";

async function run() {
  console.log("🛠️ Criando/Corrigindo tabelas de agentes no PostgreSQL...");
  const sql = postgres(connectionString, { max: 1 });

  try {
    await sql.unsafe(`
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
        metadata JSONB DEFAULT '{}',
        read INTEGER DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    console.log("✅ Tabelas 'agent_configs', 'agent_flow_states', 'round_robin_state' e 'internal_messages' criadas/verificadas no PostgreSQL com SUCESSO!");
  } catch (err) {
    console.error("❌ Erro ao criar tabelas no Postgres:", err);
  } finally {
    await sql.end();
  }
}

run();
