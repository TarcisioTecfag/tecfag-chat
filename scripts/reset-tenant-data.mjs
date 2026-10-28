/**
 * SCRIPT SEGURO DE RESET OPERACIONAL ZERO-DAY POR TENANT
 * (NEGOCIAÇÕES, CONTATOS, EMPRESAS, TAREFAS/DIRETRIZES E CONVERSAS/MENSAGENS)
 *
 * 🔒 PRESERVA 100% INTACTOS:
 *   • Tenant Valem ("valem") e qualquer outro tenant diferente do alvo
 *   • Funis e Etapas do CRM (crm_pipelines, crm_stages, crm_stage_settings)
 *   • Campos Personalizados e Catálogos (crm_custom_field_definitions, crm_catalog_items, crm_catalog_policies)
 *   • Catálogo de Produtos (crm_products)
 *   • Operadores, logins, senhas, grupos de acesso e setores (operators, platform_accounts, access_groups, sectors, operator_onboarding)
 *   • Configuração e credenciais do WhatsApp Meta/Baileys (channel_configs, whatsapp_connections, whatsapp_connection_group_access, meta_message_templates, quick_responses, operator_templates)
 *   • Sessões de login ativas (auth_sessions)
 *   • Base de conhecimento da IA e personas (agent_configs, knowledge_folders, knowledge_files)
 *   • Configurações Comerciais, Metas e Calendário (commercial_settings, commercial_consultant_profiles, commercial_goals, commercial_calendar_days)
 *   • Registro de migrações DDL e cargas concluídas (app_deploy_migrations)
 *
 * 🗑️ EXCLUI (FILTRADO 100% POR tenant_id):
 *   • Tarefas, Atividades e Diretrizes Comerciais (commercial_evidence_messages, commercial_evidence, commercial_directives, crm_activity_messages, crm_deal_activities, tasks, voice_agenda)
 *   • Negociações / Cards CRM e vínculos (crm_deals, crm_deal_contacts, crm_conversation_deals, conversation_deal_contexts, crm_deal_products, crm_proposals, crm_deal_files, crm_deal_questionnaires, crm_deal_emails, crm_deal_events, attendance_events, attendance_event_cycles, crm_action_history, crm_migration_runs, rd_marketing_commercial_outbox, rd_marketing_receipts, rd_marketing_logs, rd_marketing_events)
 *   • Conversas, Mensagens e Atendimento (conversations, messages, media_files, pending_inbounds, agent_flow_states, commercial_transfer_response_events, response_time_logs, ai_conversation_audits, call_sessions, lc_messages, lc_chats, lc_pageviews, lc_click_events, lc_visitors, voice_call_messages, voice_campaign_leads, voice_calls)
 *   • Contatos e vínculos de identidade/jornada (contacts, crm_contact_account_history, whatsapp_connection_contacts, contact_channel_identities, rd_marketing_journey_pages, rd_marketing_journey_links, rd_marketing_journey_notifications)
 *   • Empresas / Clientes PJ e PF (crm_accounts, crm_account_conversations)
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
  // 1. Evidências, Diretrizes Comerciais e Tarefas (ordem segura para ON DELETE RESTRICT)
  { name: "commercial_evidence_messages", description: "Mensagens vinculadas a evidências comerciais" },
  { name: "commercial_evidence", description: "Evidências de diretrizes comerciais (commercial_evidence)" },
  { name: "commercial_directives", description: "Diretrizes/responsabilidades comerciais (commercial_directives)" },
  { name: "crm_activity_messages", description: "Vínculos de mensagens em atividades de negociações" },
  { name: "crm_deal_activities", description: "Atividades e tarefas do CRM (crm_deal_activities)" },
  { name: "tasks", description: "Tarefas gerais sincronizadas (tasks)" },
  { name: "voice_agenda", description: "Agenda de retornos de voz (voice_agenda)" },

  // 2. Eventos de Atendimento, Vínculos e Negociações (Deals)
  { name: "attendance_events", description: "Eventos da linha do tempo de atendimento (attendance_events)" },
  { name: "attendance_event_cycles", description: "Ciclos de eventos de atendimento (attendance_event_cycles)" },
  { name: "conversation_deal_contexts", description: "Contexto operacional de card na conversa (conversation_deal_contexts)" },
  { name: "crm_conversation_deals", description: "Vínculos entre conversas e cards CRM (crm_conversation_deals)" },
  { name: "crm_deal_contacts", description: "Participantes/Contatos de negociações (crm_deal_contacts)" },
  { name: "crm_deal_events", description: "Linha do tempo/eventos de cards CRM (crm_deal_events)" },
  { name: "crm_deal_products", description: "Produtos inseridos em cards CRM (crm_deal_products)" },
  { name: "crm_proposals", description: "Orçamentos e propostas comerciais (crm_proposals)" },
  { name: "crm_deal_files", description: "Arquivos anexados a negociações (crm_deal_files)" },
  { name: "crm_deal_questionnaires", description: "Briefings e questionários de cards (crm_deal_questionnaires)" },
  { name: "crm_deal_emails", description: "E-mails vinculados a negociações (crm_deal_emails)" },
  { name: "rd_marketing_commercial_outbox", description: "Outbox de eventos comerciais RD Marketing" },
  { name: "rd_marketing_receipts", description: "Recibos de conversão RD Marketing" },
  { name: "rd_marketing_logs", description: "Logs de fluxos RD Marketing" },
  { name: "rd_marketing_events", description: "Eventos recebidos RD Marketing" },
  { name: "crm_action_history", description: "Histórico de ações em massa do CRM (crm_action_history)" },
  { name: "crm_migration_runs", description: "Histórico de execuções de migração CRM (crm_migration_runs)" },
  { name: "crm_deals", description: "Cards de negociação do CRM (crm_deals)" },

  // 3. Conversas, Mensagens e Atendimento (Chat / WhatsApp / LiveChat / Voz)
  { name: "agent_flow_states", description: "Estados de fluxos de robô SDR (agent_flow_states)" },
  { name: "commercial_transfer_response_events", description: "Eventos de tempo de resposta pós-transferência" },
  { name: "response_time_logs", description: "Logs de tempo de resposta SLA (response_time_logs)" },
  { name: "ai_conversation_audits", description: "Auditorias de conversas por IA (ai_conversation_audits)" },
  { name: "call_sessions", description: "Sessões de chamada WebRTC (call_sessions)" },
  { name: "media_files", description: "Mídias armazenadas em base64 (media_files)" },
  { name: "pending_inbounds", description: "Caixa de entrada durável de webhooks (pending_inbounds)" },
  { name: "messages", description: "Mensagens de conversas (messages)" },
  { name: "crm_account_conversations", description: "Vínculos de empresa com conversas (crm_account_conversations)" },
  { name: "conversations", description: "Conversas de atendimento (conversations)" },
  { name: "lc_messages", description: "Mensagens do widget web (lc_messages)" },
  { name: "lc_chats", description: "Sessões de atendimento web (lc_chats)" },
  { name: "lc_pageviews", description: "Trilhas de navegação do visitante (lc_pageviews)" },
  { name: "lc_click_events", description: "Eventos de clique do visitante (lc_click_events)" },
  { name: "lc_visitors", description: "Visitantes do site webchat (lc_visitors)" },
  { name: "voice_call_messages", description: "Mensagens de transcrição de voz (voice_call_messages)" },
  { name: "voice_campaign_leads", description: "Leads de campanhas de voz (voice_campaign_leads)" },
  { name: "voice_calls", description: "Chamadas telefônicas de voz (voice_calls)" },

  // 4. Contatos e Vínculos de Identidade / Jornada (ordem segura para ON DELETE NO ACTION)
  { name: "rd_marketing_journey_pages", description: "Páginas sincronizadas da jornada RD Marketing" },
  { name: "rd_marketing_journey_links", description: "Vínculos de contato com jornada RD Marketing" },
  { name: "rd_marketing_journey_notifications", description: "Notificações de conversão da jornada RD Marketing" },
  { name: "whatsapp_connection_contacts", description: "Contatos selecionados por conexão WhatsApp individual" },
  { name: "contact_channel_identities", description: "Identidades de canal vinculadas ao contato" },
  { name: "crm_contact_account_history", description: "Histórico de empresas do contato (crm_contact_account_history)" },
  { name: "contacts", description: "Base de contatos e clientes (contacts)" },

  // 5. Empresas / Contas PJ e PF (crm_accounts)
  { name: "crm_accounts", description: "Empresas cadastradas no CRM (crm_accounts)" },
];

/**
 * Executa o reset de dados operacionais de um tenant específico com transação PostgreSQL atômica.
 * Pode ser invocado tanto via CLI quanto programaticamente pelo runner de migrações de deploy.
 */
export async function runTenantReset(sql, targetTenantId = "tecfag", options = { isDryRun: false }) {
  const normalizedTenant = targetTenantId.trim().toLowerCase();

  console.log("\n==================================================================");
  console.log(`🧹 RESET ZERO-DAY DE BASE — TENANT: [${normalizedTenant.toUpperCase()}]`);
  console.log(`Modo: ${options.isDryRun ? "🔍 SIMULAÇÃO (DRY RUN)" : "🚨 EXECUÇÃO REAL (DELEÇÃO ATÔMICA)"}`);
  console.log("==================================================================\n");

  // 1. Validar se o tenant existe no banco
  const [tenantRow] = await sql`SELECT id, name FROM tenants WHERE id = ${normalizedTenant}`;
  if (!tenantRow) {
    throw new Error(`Tenant '${normalizedTenant}' não encontrado na tabela 'tenants'.`);
  }
  console.log(`🏢 Empresa detectada: ${tenantRow.name} (id: ${tenantRow.id})\n`);

  // Descobrir tabelas existentes no schema public para evitar falhas de transação
  const existingTablesRows = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  const existingTables = new Set(existingTablesRows.map((r) => r.table_name));

  // 2. Levantamento prévio dos registros
  console.log("📊 Levantamento de registros do tenant...");
  const counts = {};
  let totalItems = 0;

  for (const table of TABLES_TO_CLEAN) {
    if (!existingTables.has(table.name)) {
      counts[table.name] = 0;
      continue;
    }
    const [result] = await sql.unsafe(
      `SELECT COUNT(*)::int AS count FROM "${table.name}" WHERE tenant_id = $1`,
      [normalizedTenant]
    );
    const count = result ? result.count : 0;
    counts[table.name] = count;
    totalItems += count;
    if (count > 0) {
      console.log(`   • ${table.name.padEnd(36, " ")}: ${String(count).padStart(6, " ")} registros (${table.description})`);
    }
  }

  console.log(`\n📦 Total de registros identificados para exclusão: ${totalItems.toLocaleString("pt-BR")}`);

  if (options.isDryRun) {
    return { ok: true, isDryRun: true, totalItems, counts };
  }

  // 3. Execução real dentro de uma transação atômica com verificação de isolamento dos demais tenants
  console.log("\n🚀 Iniciando deleção atômica no banco de dados...");
  const deletedCounts = {};

  await sql.begin(async (tx) => {
    const otherTenantsBefore = {};
    for (const table of TABLES_TO_CLEAN) {
      if (!existingTables.has(table.name)) continue;
      const [otherRow] = await tx.unsafe(
        `SELECT COUNT(*)::int AS count FROM "${table.name}" WHERE tenant_id <> $1`,
        [normalizedTenant]
      );
      otherTenantsBefore[table.name] = otherRow ? otherRow.count : 0;
    }

    for (const table of TABLES_TO_CLEAN) {
      if (!existingTables.has(table.name)) continue;
      try {
        const res = await tx.unsafe(
          `DELETE FROM "${table.name}" WHERE tenant_id = $1`,
          [normalizedTenant]
        );
        deletedCounts[table.name] = res.count ?? 0;
      } catch (delErr) {
        console.error(`⚠️ Erro ao limpar ${table.name}: ${delErr.message}`);
        throw delErr; // Aborta e desfaz tudo via rollback
      }
    }

    for (const table of TABLES_TO_CLEAN) {
      if (!existingTables.has(table.name)) continue;
      const [otherRowAfter] = await tx.unsafe(
        `SELECT COUNT(*)::int AS count FROM "${table.name}" WHERE tenant_id <> $1`,
        [normalizedTenant]
      );
      const afterCount = otherRowAfter ? otherRowAfter.count : 0;
      if (afterCount !== otherTenantsBefore[table.name]) {
        throw new Error(
          `VIOLAÇÃO DE ISOLAMENTO DETECTADA NA TABELA ${table.name}: outros tenants mudaram de ${otherTenantsBefore[table.name]} para ${afterCount}`
        );
      }
    }
  });

  console.log("\n==================================================================");
  console.log("✅ RESET ZERO-DAY CONCLUÍDO COM SUCESSO!");
  console.log("==================================================================");
  console.log(`Todos os dados operacionais (Negociações, Contatos, Empresas, Tarefas e Conversas) do tenant '${normalizedTenant}' foram zerados.`);
  console.log("Preservados com integridade:");
  console.log("  • Funis, Etapas, Campos Personalizados, Catálogos e Produtos (crm_pipelines, crm_stages, crm_products)");
  console.log("  • Operadores, Senhas, Permissões RBAC e Setores (operators, platform_accounts, access_groups, sectors)");
  console.log("  • Conexões WhatsApp e Templates (channel_configs, whatsapp_connections, meta_message_templates)");
  console.log("  • Base de Conhecimento da IA (agent_configs, knowledge_folders, knowledge_files)");
  console.log("  • Demais tenants (ex: 'valem') 100% intactos");
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
