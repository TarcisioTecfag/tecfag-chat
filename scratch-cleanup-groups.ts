/**
 * scratch-cleanup-groups.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Script de limpeza segura para remover contatos de grupos, status do WhatsApp
 * e transmissões que foram erroneamente salvos no banco de dados.
 *
 * ⚠️  ATENÇÃO: Este script APAGA dados permanentemente.
 *              Execute SEMPRE com o argumento --dry-run primeiro para ver
 *              o que vai ser removido sem deletar nada.
 *
 * Uso:
 *   bun scratch-cleanup-groups.ts --dry-run    → Apenas lista, não apaga
 *   bun scratch-cleanup-groups.ts --execute    → Apaga de verdade
 *
 * Critérios de remoção (baseados no JID, não no número):
 *   1. whatsapp_jid termina em "@g.us"         → grupo
 *   2. whatsapp_jid = "status@broadcast"       → status do WA
 *   3. whatsapp_jid termina em "@broadcast"    → lista de transmissão
 *   4. whatsapp_jid termina em "@newsletter"   → canal do WhatsApp
 *   5. phone = "status@broadcast"              → status salvo errado no campo phone
 *   6. name LIKE "Status WhatsApp" (sem JID)   → status sem JID salvo corretamente
 * ─────────────────────────────────────────────────────────────────────────────
 */

import postgres from "postgres";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/valemchat";

const isDryRun = process.argv.includes("--dry-run") || !process.argv.includes("--execute");

async function main() {
  const client = postgres(connectionString, { max: 1, onnotice: () => {} });

  console.log("=".repeat(70));
  console.log(`[Cleanup] Modo: ${isDryRun ? "DRY-RUN (nenhum dado será apagado)" : "⚠️  EXECUÇÃO REAL — DADOS SERÃO APAGADOS"}`);
  console.log("=".repeat(70));

  try {
    // ── FASE 1: IDENTIFICAR contatos a serem removidos ────────────────────────
    const toRemove = await client`
      SELECT
        id,
        tenant_id,
        name,
        phone,
        whatsapp_jid,
        created_at
      FROM contacts
      WHERE
        whatsapp_jid LIKE '%@g.us'
        OR whatsapp_jid = 'status@broadcast'
        OR (whatsapp_jid LIKE '%@broadcast' AND whatsapp_jid != 'status@broadcast')
        OR whatsapp_jid LIKE '%@newsletter'
        OR phone = 'status@broadcast'
        OR (name ILIKE '%status whatsapp%' AND (whatsapp_jid IS NULL OR whatsapp_jid = ''))
      ORDER BY tenant_id, created_at
    `;

    if (toRemove.length === 0) {
      console.log("\n✅ Nenhum contato de grupo/status encontrado. Banco está limpo!");
      await client.end();
      return;
    }

    console.log(`\n📋 ${toRemove.length} contato(s) identificado(s) para remoção:\n`);
    console.log(
      "ID".padEnd(25),
      "TENANT".padEnd(8),
      "NOME".padEnd(30),
      "PHONE".padEnd(25),
      "JID"
    );
    console.log("-".repeat(110));

    for (const c of toRemove) {
      console.log(
        (c.id || "").padEnd(25),
        (c.tenant_id || "").padEnd(8),
        (c.name || "").substring(0, 28).padEnd(30),
        (c.phone || "—").padEnd(25),
        c.whatsapp_jid || "—"
      );
    }

    // ── FASE 2: Verificar conversas e mensagens associadas ────────────────────
    const contactIds = toRemove.map((c: any) => c.id);

    const relatedConvs = await client`
      SELECT id, tenant_id, contact_id, queue_state, last_message_text
      FROM conversations
      WHERE contact_id = ANY(${contactIds})
      ORDER BY tenant_id
    `;

    if (relatedConvs.length > 0) {
      console.log(`\n💬 ${relatedConvs.length} conversa(s) associada(s) também serão removidas:`);
      for (const cv of relatedConvs) {
        console.log(`   • [${cv.tenant_id}] conv: ${cv.id} | queue: ${cv.queue_state} | última msg: ${String(cv.last_message_text || "").substring(0, 50)}`);
      }
    } else {
      console.log("\n💬 Nenhuma conversa associada encontrada.");
    }

    // ── FASE 3: EXECUTAR remoção (somente se --execute) ───────────────────────
    if (isDryRun) {
      console.log("\n" + "=".repeat(70));
      console.log("🛑 DRY-RUN: Nenhum dado foi apagado.");
      console.log("   Para apagar de verdade, execute com: --execute");
      console.log("   ⚠️  Faça backup do banco antes (pg_dump) se estiver em produção.");
      console.log("=".repeat(70));
    } else {
      console.log("\n⚠️  Iniciando remoção em 3 segundos... (Ctrl+C para cancelar)");
      await new Promise((resolve) => setTimeout(resolve, 3000));

      console.log("\n🗑️  Removendo contatos de grupos/status...");

      // As conversas e mensagens são removidas em cascata (FK ON DELETE CASCADE)
      const deleted = await client`
        DELETE FROM contacts
        WHERE id = ANY(${contactIds})
        RETURNING id, tenant_id, name
      `;

      console.log(`\n✅ ${deleted.length} contato(s) removido(s) com sucesso:`);
      for (const d of deleted) {
        console.log(`   • [${d.tenant_id}] ${d.name} (id: ${d.id})`);
      }

      console.log("\n💬 Conversas e mensagens associadas foram removidas em cascata (FK).");
      console.log("=".repeat(70));
      console.log("✅ Limpeza concluída com sucesso!");
    }
  } catch (err: any) {
    console.error("\n❌ Erro durante a limpeza:", err?.message || err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
