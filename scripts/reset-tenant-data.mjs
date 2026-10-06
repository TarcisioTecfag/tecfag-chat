/**
 * SCRIPT SEGURO DE RESET OPERACIONAL POR TENANT — CRM, CHAT, CONTATOS, EMPRESAS E FUNIS
 *
 * 🔒 PRESERVA:
 *   • Operadores, logins, senhas e grupos de acesso (operators, platform_accounts, access_groups, sectors)
 *   • Configuração e credenciais do WhatsApp Meta (channel_configs, meta_message_templates)
 *   • Sessões de login ativas (auth_sessions)
 *   • Base de conhecimento da IA e personas (agent_configs, knowledge_folders, knowledge_files)
 *   • Registro de migrações DDL e cargas concluídas (app_deploy_migrations)
 *
 * 🗑️ EXCLUI (FILTRADO 100% POR tenant_id):
 *   • CRM Deals (Cards, propostas, atividades, produtos, eventos, arquivos, histórico)
 *   • Funis & Etapas (crm_pipelines, crm_stages, crm_stage_settings)
 *   • Campos Personalizados (crm_custom_field_definitions)
 *   • Empresas & Clientes (crm_accounts, crm_account_conversations)
 *   • Contatos (contacts, crm_contact_account_history, crm_deal_contacts)
 *   • Chat & Mensagens (conversations, messages, media_files, call_sessions, tasks)
 *   • Métricas, Auditorias e Logs de IA (ai_conversation_audits, ai_usage_logs, response_time_logs, operator_daily_metrics, ai_reports)
 *   • Catálogos e Produtos (crm_catalog_items, crm_catalog_policies, crm_products)
 *   • Filas, Webhook pendentes e LiveChat (pending_inbounds, agent_flow_states, round_robin_state, internal_messages, push_subscriptions, lc_*)
 */

import postgres from "postgres";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Carrega .env nativamente se existir
if (typeof process.loadEnvFile === "function") {
  try {
    if (existsSync(".env")) process.loadEnvFile(".env");
  } catch (e) {}
} else if (existsSync(".env")) {
  try {
    const envContent = readFileSync(".env", "utf8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = (match[2] || "").trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (!process.env[key]) process.env[key] = val;
      }
    }
  } catch (e) {}
}

export const TABLES_TO_CLEAN = [
  // 1. Mensagens referenciadas em atividades de CRM
  { name: "crm_activity_messages", description: "Vínculos de mensagens em atividades de negociações" },
  // 2. Atividades e tarefas vinculadas a negociações
  { name: "crm_deal_activities", description: "Atividades e tarefas do CRM (crm_deal_activities)" },
  // 3. Vínculos de contatos com negociações
  { name: "crm_deal_contacts", description: "Participantes/Contatos de negociações (crm_deal_contacts)" },
  // 4. Vínculos de conversas de chat com negociações
  { name: "crm_conversation_deals", description: "Vínculos entre conversas e cards CRM (crm_conversation_deals)" },
  // 5. Produtos e propostas vinculadas a negociações
  { name: "crm_deal_products", description: "Produtos inseridos em cards CRM (crm_deal_products)" },
  { name: "crm_proposals", description: "Orçamentos e propostas comerciais (crm_proposals)" },
  // 6. Arquivos, formulários e e-mails de negociações
  { name: "crm_deal_files", description: "Arquivos anexados a negociações (crm_deal_files)" },
  { name: "crm_deal_questionnaires", description: "Briefings e questionários de cards (crm_deal_questionnaires)" },
  { name: "crm_deal_emails", description: "E-mails vinculados a negociações (crm_deal_emails)" },
  // 7. Eventos e histórico de auditoria de negociações
  { name: "crm_deal_events", description: "Linha do tempo/eventos de cards CRM (crm_deal_events)" },
  // 8. Tarefas legadas / sincronizadas
  { name: "tasks", description: "Tarefas gerais sincronizadas (tasks)" },
  // 9. Mensagens do Chat e mídias
  { name: "messages", description: "Mensagens de conversas (messages)" },
  { name: "media_files", description: "Mídias armazenadas em base64 (media_files)" },
  // 10. Sessões e logs de chat e atendimento
  { name: "call_sessions", description: "Sessões de chamada WebRTC (call_sessions)" },
  { name: "response_time_logs", description: "Logs de tempo de resposta SLA (response_time_logs)" },
  { name: "ai_conversation_audits", description: "Auditorias de conversas por IA (ai_conversation_audits)" },
  { name: "operator_daily_metrics", description: "Métricas consolidadas de operadores (operator_daily_metrics)" },
  { name: "ai_report_feedback", description: "Feedbacks de relatórios de IA (ai_report_feedback)" },
  { name: "ai_report_versions", description: "Versões de relatórios de IA (ai_report_versions)" },
  { name: "ai_reports", description: "Relatórios de IA (ai_reports)" },
  { name: "agent_flow_states", description: "Estados de fluxos de robô SDR (agent_flow_states)" },
  { name: "round_robin_state", description: "Estado de distribuição de leads (round_robin_state)" },
  { name: "internal_messages", description: "Mensagens internas do operador (internal_messages)" },
  { name: "pending_inbounds", description: "Caixa de entrada durável de webhooks (pending_inbounds)" },
  { name: "ai_usage_logs", description: "Logs de telemetria e custo de IA (ai_usage_logs)" },
  { name: "push_subscriptions", description: "Inscrições Web Push (push_subscriptions)" },
  // 11. Módulo de Voz
  { name: "voice_call_messages", description: "Mensagens de transcrição de voz (voice_call_messages)" },
  { name: "voice_campaign_leads", description: "Leads de campanhas de voz (voice_campaign_leads)" },
  { name: "voice_agenda", description: "Agenda de retornos de voz (voice_agenda)" },
  { name: "voice_calls", description: "Chamadas telefônicas de voz (voice_calls)" },
  { name: "voice_campaigns", description: "Campanhas de voz ativas (voice_campaigns)" },
  { name: "voice_objectives", description: "Objetivos de voz (voice_objectives)" },
  // 12. Cards / Negociações (crm_deals)
  { name: "crm_deals", description: "Cards de negociação do CRM (crm_deals)" },
  // 13. Vínculos e conversas de chat
  { name: "crm_account_conversations", description: "Vínculos de empresa com conversas (crm_account_conversations)" },
  { name: "conversations", description: "Conversas de atendimento (conversations)" },
  // 14. Histórico e Contatos (contacts)
  { name: "crm_contact_account_history", description: "Histórico de empresas do contato (crm_contact_account_history)" },
  { name: "contacts", description: "Base de contatos e clientes (contacts)" },
  // 15. Empresas / Contas PJ e PF (crm_accounts)
  { name: "crm_accounts", description: "Empresas cadastradas no CRM (crm_accounts)" },
  // 16. Etapas e Funis de Vendas (crm_stages, crm_pipelines)
  { name: "crm_stage_settings", description: "Configurações de etapas (crm_stage_settings)" },
  { name: "crm_stages", description: "Etapas dos funis de vendas (crm_stages)" },
  { name: "crm_pipelines", description: "Funis de vendas (crm_pipelines)" },
  // 17. Definições de Campos Personalizados
  { name: "crm_custom_field_definitions", description: "Campos personalizados do CRM (crm_custom_field_definitions)" },
  // 18. Catálogos adicionais e Produtos
  { name: "crm_catalog_items", description: "Itens de catálogo: fontes, campanhas, segmentos (crm_catalog_items)" },
  { name: "crm_catalog_policies", description: "Políticas de catálogo CRM (crm_catalog_policies)" },
  { name: "crm_products", description: "Catálogo de produtos (crm_products)" },
  // 19. Históricos administrativos de CRM
  { name: "crm_action_history", description: "Histórico de ações em massa do CRM (crm_action_history)" },
  { name: "crm_migration_runs", description: "Histórico de execuções de migração CRM (crm_migration_runs)" },
  // 20. Respostas Rápidas e Templates do Operador
  { name: "quick_responses", description: "Respostas rápidas do chat (quick_responses)" },
  { name: "operator_templates", description: "Templates individuais do operador (operator_templates)" },
  // 21. Live Chat Web
  { name: "lc_messages", description: "Mensagens do widget web (lc_messages)" },
  { name: "lc_chats", description: "Sessões de atendimento web (lc_chats)" },
  { name: "lc_pageviews", description: "Trilhas de navegação do visitante (lc_pageviews)" },
  { name: "lc_click_events", description: "Eventos de clique do visitante (lc_click_events)" },
  { name: "lc_visitors", description: "Visitantes do site webchat (lc_visitors)" },
  { name: "lc_tray_config", description: "Configuração Tray Commerce (lc_tray_config)" },
];

/**
 * Executa o reset de dados de um tenant específico com transação PostgreSQL atômica.
 * Pode ser invocado tanto via CLI quanto programaticamente pelo runner de migrações de deploy.
 */
export async function runTenantReset(sql, targetTenantId = "tecfag", options = { isDryRun: false }) {
  const normalizedTenant = targetTenantId.trim().toLowerCase();

  console.log("\n==================================================================");
  console.log(`🧹 RESET SEGURO DE BASE — TENANT: [${normalizedTenant.toUpperCase()}]`);
  console.log(`Modo: ${options.isDryRun ? "🔍 SIMULAÇÃO (DRY RUN)" : "🚨 EXECUÇÃO REAL (DELEÇÃO ATÔMICA)"}`);
  console.log("==================================================================\n");

  // 1. Validar se o tenant existe no banco
  const [tenantRow] = await sql`SELECT id, name FROM tenants WHERE id = ${normalizedTenant}`;
  if (!tenantRow) {
    throw new Error(`Tenant '${normalizedTenant}' não encontrado na tabela 'tenants'.`);
  }
  console.log(`🏢 Empresa detectada: ${tenantRow.name} (id: ${tenantRow.id})\n`);

  // 2. Levantamento prévio dos registros
  console.log("📊 Levantamento de registros do tenant...");
  const counts = {};
  let totalItems = 0;

  for (const table of TABLES_TO_CLEAN) {
    try {
      const [result] = await sql.unsafe(
        `SELECT COUNT(*)::int AS count FROM ${table.name} WHERE tenant_id = $1`,
        [normalizedTenant]
      );
      const count = result ? result.count : 0;
      counts[table.name] = count;
      totalItems += count;
      if (count > 0) {
        console.log(`   • ${table.name.padEnd(30, " ")}: ${String(count).padStart(6, " ")} registros (${table.description})`);
      }
    } catch (err) {
      counts[table.name] = 0;
    }
  }

  console.log(`\n📦 Total de registros identificados para exclusão: ${totalItems.toLocaleString("pt-BR")}`);

  if (options.isDryRun) {
    return { ok: true, isDryRun: true, totalItems, counts };
  }

  // 3. Execução real dentro de uma transação atômica
  console.log("\n🚀 Iniciando deleção atômica no banco de dados...");
  const deletedCounts = {};

  await sql.begin(async (tx) => {
    for (const table of TABLES_TO_CLEAN) {
      try {
        const res = await tx.unsafe(
          `DELETE FROM ${table.name} WHERE tenant_id = $1`,
          [normalizedTenant]
        );
        deletedCounts[table.name] = res.count ?? 0;
      } catch (delErr) {
        console.error(`⚠️ Erro ao limpar ${table.name}: ${delErr.message}`);
        throw delErr; // Aborta e desfaz tudo via rollback
      }
    }
  });

  console.log("\n==================================================================");
  console.log("✅ RESET CONCLUÍDO COM SUCESSO!");
  console.log("==================================================================");
  console.log(`Todos os dados operacionais do tenant '${normalizedTenant}' foram purgados.`);
  console.log("Preservados com integridade:");
  console.log("  • Operadores e Senhas (operators, platform_accounts)");
  console.log("  • Conexão WhatsApp Meta (channel_configs)");
  console.log("  • Templates Meta (meta_message_templates)");
  console.log("  • Permissões RBAC (access_groups) e Setores (sectors)");
  console.log("  • Controle de Migrações do Railway (app_deploy_migrations)");
  console.log("==================================================================\n");

  return { ok: true, isDryRun: false, totalItems, deletedCounts };
}

// ─── EXECUÇÃO VIA CLI ────────────────────────────────────────────────────────
const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution) {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const arg = args.find((a) => a.startsWith(`--${name}=`));
    return arg ? arg.split("=")[1] : null;
  };
  const hasFlag = (name) => args.includes(`--${name}`);

  const tenantId = (getArg("tenant") || "tecfag").trim().toLowerCase();
  const isExecute = hasFlag("execute");
  const isDryRun = hasFlag("dry-run") || !isExecute;
  const confirmToken = getArg("confirm");
  const databaseUrl = getArg("database-url") || process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error("❌ ERRO: DATABASE_URL não definida no ambiente nem informada via --database-url.");
    process.exit(1);
  }

  const expectedConfirm = `CONFIRMO_RESET_${tenantId.toUpperCase()}`;

  if (isExecute && confirmToken !== expectedConfirm) {
    console.error(`❌ CONFIRMAÇÃO INVÁLIDA!`);
    console.error(`Para executar a deleção real no tenant '${tenantId}', adicione obrigatoriamente:`);
    console.error(`   --confirm=${expectedConfirm}\n`);
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });

  runTenantReset(sql, tenantId, { isDryRun })
    .catch((err) => {
      console.error("\n❌ Falha durante o reset:", err.message || err);
      process.exit(1);
    })
    .finally(async () => {
      await sql.end();
    });
}
