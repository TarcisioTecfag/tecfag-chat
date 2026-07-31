/**
 * SCRIPT DE RESET TOTAL DOS DADOS OPERACIONAIS — TENANT VALEM
 *
 * ✅ APAGA: contatos, conversas, mensagens, auditorias, métricas,
 *           logs de IA, tarefas, states do SDR, notificações internas,
 *           logs de tempo de resposta, sessões de chamada, arquivos de mídia
 *
 * 🔒 PRESERVA: operadores, grupos de acesso, setores, configurações de canal,
 *              agentConfigs (Valentina), base de conhecimento (RAG),
 *              respostas rápidas, templates, credenciais Baileys (auth WA)
 */

import postgres from "postgres";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/valemchat";
const TENANT_ID = "valem";

async function main() {
  console.log(`\n🔴 RESET TOTAL DE DADOS OPERACIONAIS — Tenant: ${TENANT_ID}`);
  console.log("══════════════════════════════════════════════════════════");
  
  const client = postgres(connectionString, { max: 1, onnotice: () => {} });

  try {
    // Executa tudo em uma única transação para garantir atomicidade
    await client.begin(async (tx) => {
      
      // ─── 1. Tabelas que dependem de messages (FK) ────────────────────────
      console.log("🗑️  Limpando logs de tempo de resposta...");
      await tx`DELETE FROM response_time_logs WHERE tenant_id = ${TENANT_ID}`;
      
      // ─── 2. Auditorias de IA ──────────────────────────────────────────────
      console.log("🗑️  Limpando auditorias de conversa (IA QA)...");
      await tx`DELETE FROM ai_conversation_audits WHERE tenant_id = ${TENANT_ID}`;

      // ─── 3. Mensagens internas (notificações Valentina Supervisor) ────────
      console.log("🗑️  Limpando mensagens internas...");
      await tx`DELETE FROM internal_messages WHERE tenant_id = ${TENANT_ID}`;

      // ─── 4. Tarefas (tasks) ───────────────────────────────────────────────
      console.log("🗑️  Limpando tarefas...");
      await tx`DELETE FROM tasks WHERE tenant_id = ${TENANT_ID}`;

      // ─── 5. Estados do SDR/Agent Flow ─────────────────────────────────────
      console.log("🗑️  Limpando estados do agente (SDR flow)...");
      await tx`DELETE FROM agent_flow_states WHERE tenant_id = ${TENANT_ID}`;

      // ─── 6. Sessões de chamada ────────────────────────────────────────────
      console.log("🗑️  Limpando sessões de chamada...");
      await tx`DELETE FROM call_sessions WHERE tenant_id = ${TENANT_ID}`;

      // ─── 7. Arquivos de mídia das conversas ──────────────────────────────
      console.log("🗑️  Limpando arquivos de mídia...");
      await tx`DELETE FROM media_files WHERE tenant_id = ${TENANT_ID}`;

      // ─── 8. Mensagens (FK de conversations) ──────────────────────────────
      console.log("🗑️  Limpando mensagens...");
      await tx`DELETE FROM messages WHERE tenant_id = ${TENANT_ID}`;

      // ─── 9. Conversas ─────────────────────────────────────────────────────
      console.log("🗑️  Limpando conversas...");
      await tx`DELETE FROM conversations WHERE tenant_id = ${TENANT_ID}`;

      // ─── 10. Contatos ──────────────────────────────────────────────────────
      console.log("🗑️  Limpando contatos...");
      await tx`DELETE FROM contacts WHERE tenant_id = ${TENANT_ID}`;

      // ─── 11. Métricas diárias de operadores ───────────────────────────────
      console.log("🗑️  Limpando métricas diárias de operadores...");
      await tx`DELETE FROM operator_daily_metrics WHERE tenant_id = ${TENANT_ID}`;

      // ─── 12. Relatórios de IA ──────────────────────────────────────────────
      console.log("🗑️  Limpando relatórios de IA...");
      await tx`DELETE FROM ai_reports WHERE tenant_id = ${TENANT_ID}`;

      // ─── 13. Logs de uso de IA (custos) ───────────────────────────────────
      console.log("🗑️  Limpando logs de uso de IA...");
      await tx`DELETE FROM ai_usage_logs WHERE tenant_id = ${TENANT_ID}`;

      // ─── 14. Push subscriptions ────────────────────────────────────────────
      console.log("🗑️  Limpando push subscriptions...");
      await tx`DELETE FROM push_subscriptions WHERE tenant_id = ${TENANT_ID}`;

      // ─── 15. Round robin state (zerar fila de rodízio) ────────────────────
      console.log("🔄  Zerando estado do rodízio...");
      await tx`DELETE FROM round_robin_state WHERE tenant_id = ${TENANT_ID}`;

    });

    // ─── Resumo ──────────────────────────────────────────────────────────────
    console.log("\n══════════════════════════════════════════════════════════");
    console.log("✅ RESET CONCLUÍDO COM SUCESSO!");
    console.log("\n🔒 PRESERVADOS:");
    console.log("   • Operadores e senhas");
    console.log("   • Grupos de acesso e setores");
    console.log("   • Configurações de canal (Baileys auth WA intacto)");
    console.log("   • Config da Valentina (agentConfigs)");
    console.log("   • Base de conhecimento (RAG)");
    console.log("   • Respostas rápidas e templates");
    console.log("\n🗑️  APAGADOS:");
    console.log("   • Todos os contatos");
    console.log("   • Todas as conversas e mensagens");
    console.log("   • Todas as auditorias de IA");
    console.log("   • Todos os logs de tempo de resposta");
    console.log("   • Todos os estados do SDR");
    console.log("   • Todas as métricas e relatórios");
    console.log("   • Todos os logs de custo de IA");
    console.log("\n🟢 Sistema pronto para atendimento limpo!\n");

  } catch (err: any) {
    console.error("\n❌ ERRO durante o reset:", err?.message || err);
    console.error("⚠️  Nenhum dado foi apagado (transação revertida).");
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
