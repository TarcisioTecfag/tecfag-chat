/**
 * run-v2-migrations.ts — Roda as migrations v2 dos relatórios diretamente
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);

async function run() {
  console.log("[Migration] Rodando migrations v2 para ai_reports...");

  await sql`ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'rascunho'`;
  await sql`ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS current_version TEXT NOT NULL DEFAULT 'v1'`;
  await sql`ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS headline TEXT`;
  await sql`ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS summary TEXT`;
  await sql`ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS confidence INTEGER DEFAULT 90`;

  console.log("[Migration] ✓ Colunas v2 adicionadas à ai_reports");

  await sql`
    CREATE TABLE IF NOT EXISTS ai_report_versions (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      author TEXT NOT NULL,
      note TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'rascunho',
      report_data JSONB
    )
  `;
  console.log("[Migration] ✓ Tabela ai_report_versions criada");

  await sql`
    CREATE TABLE IF NOT EXISTS ai_report_feedback (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      version TEXT NOT NULL,
      section_id TEXT NOT NULL,
      vote TEXT,
      comment TEXT DEFAULT '',
      operator_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  console.log("[Migration] ✓ Tabela ai_report_feedback criada");

  console.log("[Migration] ✅ Todas as migrations v2 aplicadas!");
  await sql.end();
  process.exit(0);
}

run().catch((e) => {
  console.error("[Migration] ❌ Erro:", e);
  process.exit(1);
});
