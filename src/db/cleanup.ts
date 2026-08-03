import postgres from "postgres";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/valemchat";

async function main() {
  console.log("🧹 Executando pré-migração e limpeza de integridade referencial...");
  // onnotice: () => {} suprime mensagens NOTICE do PostgreSQL (ex: "column already exists")
  // que aparecem como erro falso no Railway mas sao inofensivas
  const client = postgres(connectionString, { max: 1, onnotice: () => {} });

  try {
    // 1. Garantir colunas essenciais em contacts
    await client`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS responsible_name text DEFAULT 'Na Fila' NOT NULL;`;
    await client`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS cnpj_details jsonb DEFAULT '{}'::jsonb NOT NULL;`;

    // 2. Garantir coluna de interpretação de mídia em messages (memória visual da Valentina)
    await client`ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_interpretation text;`;

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
