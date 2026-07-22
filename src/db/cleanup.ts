import postgres from "postgres";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/valemchat";

async function main() {
  console.log("🧹 Executando pré-migração e limpeza de integridade referencial...");
  const client = postgres(connectionString, { max: 1 });

  try {
    // 1. Garantir coluna responsible_name em contacts
    await client`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS responsible_name text DEFAULT 'Na Fila' NOT NULL;`;

    // 2. Limpar qualquer group_id órfão em operators que não exista mais em access_groups (evita erro FK 23503)
    await client`UPDATE operators SET group_id = NULL WHERE group_id IS NOT NULL AND group_id NOT IN (SELECT id FROM access_groups);`;

    console.log("✅ Limpeza de integridade concluída com sucesso!");
  } catch (err: any) {
    console.warn("⚠️ Aviso durante limpeza pré-migração:", err?.message || err);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Erro na limpeza de pré-migração:", err);
  process.exit(0);
});
