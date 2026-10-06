import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  messages,
  conversations,
  contacts,
  internalMessages,
  aiUsageLogs,
  aiConversationAudits,
  responseTimeLogs,
  operatorDailyMetrics,
  aiReports,
  aiReportVersions,
  aiReportFeedback,
  agentFlowStates,
  roundRobinState,
  mediaFiles,
  callSessions,
  tasks,
  crmActivityMessages,
  crmDealActivities,
  crmDealContacts,
  crmConversationDeals,
  crmDealProducts,
  crmProposals,
  crmDealFiles,
  crmDealQuestionnaires,
  crmDealEmails,
  crmDealEvents,
  crmDeals,
  crmAccountConversations,
  crmContactAccountHistory,
  crmAccounts,
  crmStageSettings,
  crmStages,
  crmPipelines,
  crmCustomFieldDefinitions,
  crmCatalogItems,
  crmCatalogPolicies,
  crmProducts,
  crmActionHistory,
  crmMigrationRuns,
  quickResponses,
  pendingInbounds,
} from "../../../db/schema";
import { eq, and } from "drizzle-orm";
import { SdrDebouncer } from "../../../lib/valentina/sdr-debouncer";
import { rdRequest } from "../../../lib/rdCrmService";
import { requireSession } from "../../../lib/auth-session.js";
import { recordCrmAction } from "../../../lib/crm/action-history";

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ─── POST /api/admin/reset ───────────────────────────────────────────────────
// ATENÇÃO: Rota estritamente desabilitada em produção. Em desenvolvimento, exige
// sessão ativa com perfil de administrador do respectivo tenant.
export const Route = createFileRoute("/api/admin/reset")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
      },

      GET: async ({ request }: any) => {
        if (process.env.NODE_ENV === "production") {
          return new Response(
            JSON.stringify({ error: "Rotas de diagnóstico e manutenção estão desabilitadas em produção." }),
            { status: 403, headers: corsHeaders }
          );
        }

        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        if (session.operator.role !== "admin") {
          return new Response(
            JSON.stringify({ error: "Acesso restrito a administradores autenticados." }),
            { status: 403, headers: corsHeaders }
          );
        }

        const url = new URL(request.url);
        const action = url.searchParams.get("action");
        const tenantId = session.tenantId;

        // ─── GET ?action=rd-pipelines ────────────────────────────────────────
        // Retorna todos os funis do RD CRM com IDs exatos de pipeline e stages.
        // Uso: GET /api/admin/reset?action=rd-pipelines&tenantId=valem&token=VALEM_ADMIN_2024
        if (action === "rd-pipelines") {
          const results: Record<string, any> = {};
          // Testa múltiplos endpoints possíveis da RD CRM v2
          const endpoints = ["/funnels", "/pipelines", "/deals/funnels", "/stages"];
          for (const ep of endpoints) {
            try {
              const res = await rdRequest<any>(tenantId, "GET", ep);
              results[ep] = res;
            } catch (err: any) {
              results[ep] = { error: err?.message };
            }
          }
          return new Response(JSON.stringify({ ok: true, results }, null, 2), {
            status: 200,
            headers: corsHeaders,
          });
        }

        // ─── GET ?action=rd-stages ────────────────────────────────────────────
        // Busca os nomes dos stages do FUNIL VÁLVULAS.
        // Uso: GET /api/admin/reset?action=rd-stages&tenantId=valem&token=VALEM_ADMIN_2024
        if (action === "rd-stages") {
          const VALVULAS_STAGE_IDS = [
            "6967f181aed2510013671a15",
            "6980b17faa2a4c0016d28ac0",
            "6967f1eba86785001d83fd3e",
            "6967f181aed2510013671a16",
            "6967f181aed2510013671a17",
            "6967f181aed2510013671a18",
            "6967f182aed2510013671a19",
            "6970dd8c3f269500131a9d74",
          ];
          const stageResults: any[] = [];
          for (const stageId of VALVULAS_STAGE_IDS) {
            try {
              const res = await rdRequest<any>(tenantId, "GET", `/deal_stages/${stageId}`);
              stageResults.push({ id: stageId, data: res });
            } catch (err: any) {
              // Tenta endpoint alternativo
              try {
                const res2 = await rdRequest<any>(tenantId, "GET", `/stages/${stageId}`);
                stageResults.push({ id: stageId, data: res2 });
              } catch (err2: any) {
                stageResults.push({ id: stageId, error: err?.message });
              }
            }
          }
          return new Response(JSON.stringify({ ok: true, stages: stageResults }, null, 2), {
            status: 200,
            headers: corsHeaders,
          });
        }

        if (action !== "fix-duplicates") {
          return new Response(JSON.stringify({ error: "Actions disponíveis: fix-duplicates, rd-pipelines" }), { status: 400, headers: corsHeaders });
        }

        const log: string[] = [];
        let mergedGroups = 0;
        let deletedContacts = 0;
        const deletedContactDetails: Array<{ id: string; name: string }> = [];

        try {
          // 1. Buscar todos os contatos do tenant com phone preenchido
          const allContacts = await db
            .select({ id: contacts.id, name: contacts.name, phone: contacts.phone, createdAt: contacts.createdAt })
            .from(contacts)
            .where(eq(contacts.tenantId, tenantId));

          // 2. Agrupar por phone normalizado para detectar duplicados
          const byPhone = new Map<string, Array<{ id: string; name: string | null; phone: string | null; createdAt: Date }>>();
          for (const c of allContacts) {
            if (!c.phone) continue;
            const key = c.phone.replace(/\D/g, "");
            if (!byPhone.has(key)) byPhone.set(key, []);
            byPhone.get(key)!.push(c);
          }

          // 3. Processar grupos com duplicados
          for (const [phone, group] of byPhone.entries()) {
            if (group.length < 2) continue;
            mergedGroups++;

            // O mais antigo (menor createdAt) é o contato principal — preservar
            group.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            const primary  = group[0];
            const dupes    = group.slice(1);

            log.push(`[GRUPO] Phone ${phone}: mantendo ${primary.id} (${primary.name}), removendo ${dupes.map(d => d.id).join(", ")}`);

            // Remover contatos duplicados e suas conversas
            for (const dupe of dupes) {
              const dupeConvs = await db
                .select({ id: conversations.id })
                .from(conversations)
                .where(and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, dupe.id)));

              for (const conv of dupeConvs) {
                SdrDebouncer.getInstance().clearSession(conv.id);
                await db.delete(agentFlowStates).where(and(eq(agentFlowStates.conversationId, conv.id), eq(agentFlowStates.tenantId, tenantId)));
                await db.delete(messages).where(and(eq(messages.conversationId, conv.id), eq(messages.tenantId, tenantId)));
                await db.delete(conversations).where(and(eq(conversations.id, conv.id), eq(conversations.tenantId, tenantId)));
                log.push(`  Conversa duplicada ${conv.id} removida`);
              }

              await db.delete(contacts).where(and(eq(contacts.id, dupe.id), eq(contacts.tenantId, tenantId)));
              deletedContacts++;
              deletedContactDetails.push({ id: dupe.id, name: dupe.name || dupe.id });
              log.push(`  Contato duplicado ${dupe.id} deletado`);
            }

            // Resetar conversas do contato PRINCIPAL para começar do zero
            const primaryConvs = await db
              .select({ id: conversations.id })
              .from(conversations)
              .where(and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, primary.id)));

            for (const conv of primaryConvs) {
              SdrDebouncer.getInstance().clearSession(conv.id);
              await db.delete(agentFlowStates).where(and(eq(agentFlowStates.conversationId, conv.id), eq(agentFlowStates.tenantId, tenantId)));
              await db.delete(messages).where(and(eq(messages.conversationId, conv.id), eq(messages.tenantId, tenantId)));
              await db.update(conversations)
                .set({ queueState: "automacao", operatorId: null, unreadCount: 0, lastMessageText: null })
                .where(and(eq(conversations.id, conv.id), eq(conversations.tenantId, tenantId)));
              log.push(`  Conversa principal ${conv.id} resetada (fresh start)`);
            }
          }

          if (deletedContactDetails.length) await recordCrmAction({ tenantId,
            operatorId: session.operator.id, operatorName: session.operator.name,
            action: "delete_contact", entityType: "contact", itemCount: deletedContactDetails.length,
            details: { contacts: deletedContactDetails, source: "duplicate_cleanup" } });

          return new Response(JSON.stringify({
            ok: true,
            mergedGroups,
            deletedContacts,
            log,
            message: mergedGroups === 0
              ? "Nenhum duplicado encontrado. Tudo limpo!"
              : `${mergedGroups} grupo(s) corrigido(s). Proxima msg do cliente começa do zero.`,
          }), { status: 200, headers: corsHeaders });

        } catch (err: any) {
          return new Response(JSON.stringify({ ok: false, error: err?.message || String(err), log }), {
            status: 500, headers: corsHeaders,
          });
        }
      },

      POST: async ({ request }: any) => {
        try {
          if (process.env.NODE_ENV === "production") {
            return new Response(
              JSON.stringify({ error: "Operação destrutiva estritamente desabilitada em produção." }),
              { status: 403, headers: corsHeaders }
            );
          }

          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          if (session.operator.role !== "admin") {
            return new Response(
              JSON.stringify({ error: "Acesso restrito a administradores autenticados." }),
              { status: 403, headers: corsHeaders }
            );
          }

          const body = await request.json().catch(() => ({}));
          const tenantId = session.tenantId;

          // Chave de segurança simples para evitar resets acidentais
          if (body?.confirm !== "RESET_TUDO_AGORA") {
            return new Response(
              JSON.stringify({
                error: "Confirmação necessária",
                hint: 'Envie { "confirm": "RESET_TUDO_AGORA" } no body',
              }),
              { status: 400, headers: corsHeaders }
            );
          }

          const results: Record<string, number> = {};

          // Deleções estritamente filtradas pelo tenant do administrador autenticado (ordem de FKs)
          // 1. CRM Atividades e Negociações
          const r_crmActMsgs = await db.delete(crmActivityMessages).where(eq(crmActivityMessages.tenantId, tenantId)).returning({ id: crmActivityMessages.id });
          results.crm_activity_messages = r_crmActMsgs.length;

          const r_crmAct = await db.delete(crmDealActivities).where(eq(crmDealActivities.tenantId, tenantId)).returning({ id: crmDealActivities.id });
          results.crm_deal_activities = r_crmAct.length;

          const r_crmContacts = await db.delete(crmDealContacts).where(eq(crmDealContacts.tenantId, tenantId)).returning({ id: crmDealContacts.id });
          results.crm_deal_contacts = r_crmContacts.length;

          const r_crmConvDeals = await db.delete(crmConversationDeals).where(eq(crmConversationDeals.tenantId, tenantId)).returning({ id: crmConversationDeals.id });
          results.crm_conversation_deals = r_crmConvDeals.length;

          const r_crmProducts = await db.delete(crmDealProducts).where(eq(crmDealProducts.tenantId, tenantId)).returning({ id: crmDealProducts.id });
          results.crm_deal_products = r_crmProducts.length;

          const r_crmProposals = await db.delete(crmProposals).where(eq(crmProposals.tenantId, tenantId)).returning({ id: crmProposals.id });
          results.crm_proposals = r_crmProposals.length;

          const r_crmFiles = await db.delete(crmDealFiles).where(eq(crmDealFiles.tenantId, tenantId)).returning({ id: crmDealFiles.id });
          results.crm_deal_files = r_crmFiles.length;

          const r_crmQuest = await db.delete(crmDealQuestionnaires).where(eq(crmDealQuestionnaires.tenantId, tenantId)).returning({ id: crmDealQuestionnaires.id });
          results.crm_deal_questionnaires = r_crmQuest.length;

          const r_crmEmails = await db.delete(crmDealEmails).where(eq(crmDealEmails.tenantId, tenantId)).returning({ id: crmDealEmails.id });
          results.crm_deal_emails = r_crmEmails.length;

          const r_crmEvents = await db.delete(crmDealEvents).where(eq(crmDealEvents.tenantId, tenantId)).returning({ id: crmDealEvents.id });
          results.crm_deal_events = r_crmEvents.length;

          const r_crmDeals = await db.delete(crmDeals).where(eq(crmDeals.tenantId, tenantId)).returning({ id: crmDeals.id });
          results.crm_deals = r_crmDeals.length;

          // 2. Chat, Mensagens e Tarefas
          const r_tasks = await db.delete(tasks).where(eq(tasks.tenantId, tenantId)).returning({ id: tasks.id });
          results.tasks = r_tasks.length;

          const r_msgs = await db.delete(messages).where(eq(messages.tenantId, tenantId)).returning({ id: messages.id });
          results.messages = r_msgs.length;

          const r_media = await db.delete(mediaFiles).where(eq(mediaFiles.tenantId, tenantId)).returning({ id: mediaFiles.id });
          results.media_files = r_media.length;

          const r_calls = await db.delete(callSessions).where(eq(callSessions.tenantId, tenantId)).returning({ id: callSessions.id });
          results.call_sessions = r_calls.length;

          const r_rtLogs = await db.delete(responseTimeLogs).where(eq(responseTimeLogs.tenantId, tenantId)).returning({ id: responseTimeLogs.id });
          results.response_time_logs = r_rtLogs.length;

          const r_audits = await db.delete(aiConversationAudits).where(eq(aiConversationAudits.tenantId, tenantId)).returning({ id: aiConversationAudits.id });
          results.ai_conversation_audits = r_audits.length;

          const r_metrics = await db.delete(operatorDailyMetrics).where(eq(operatorDailyMetrics.tenantId, tenantId)).returning({ id: operatorDailyMetrics.id });
          results.operator_daily_metrics = r_metrics.length;

          const r_repFb = await db.delete(aiReportFeedback).where(eq(aiReportFeedback.tenantId, tenantId)).returning({ id: aiReportFeedback.id });
          results.ai_report_feedback = r_repFb.length;

          const r_repVer = await db.delete(aiReportVersions).where(eq(aiReportVersions.tenantId, tenantId)).returning({ id: aiReportVersions.id });
          results.ai_report_versions = r_repVer.length;

          const r_reports = await db.delete(aiReports).where(eq(aiReports.tenantId, tenantId)).returning({ id: aiReports.id });
          results.ai_reports = r_reports.length;

          const r_flowStates = await db.delete(agentFlowStates).where(eq(agentFlowStates.tenantId, tenantId)).returning({ id: agentFlowStates.id });
          results.agent_flow_states = r_flowStates.length;

          const r_rr = await db.delete(roundRobinState).where(eq(roundRobinState.tenantId, tenantId)).returning({ id: roundRobinState.id });
          results.round_robin_state = r_rr.length;

          const r_internal = await db.delete(internalMessages).where(eq(internalMessages.tenantId, tenantId)).returning({ id: internalMessages.id });
          results.internal_messages = r_internal.length;

          const r_pending = await db.delete(pendingInbounds).where(eq(pendingInbounds.tenantId, tenantId)).returning({ id: pendingInbounds.id });
          results.pending_inbounds = r_pending.length;

          const r_aiLogs = await db.delete(aiUsageLogs).where(eq(aiUsageLogs.tenantId, tenantId)).returning({ id: aiUsageLogs.id });
          results.ai_usage_logs = r_aiLogs.length;

          // 3. Conversas e Vínculos de Empresa
          const r_accConvs = await db.delete(crmAccountConversations).where(eq(crmAccountConversations.tenantId, tenantId)).returning({ id: crmAccountConversations.id });
          results.crm_account_conversations = r_accConvs.length;

          const r_convs = await db.delete(conversations).where(eq(conversations.tenantId, tenantId)).returning({ id: conversations.id });
          results.conversations = r_convs.length;

          // 4. Contatos e Histórico
          const r_cAccHist = await db.delete(crmContactAccountHistory).where(eq(crmContactAccountHistory.tenantId, tenantId)).returning({ id: crmContactAccountHistory.id });
          results.crm_contact_account_history = r_cAccHist.length;

          const r_contacts = await db.delete(contacts).where(eq(contacts.tenantId, tenantId)).returning({ id: contacts.id });
          results.contacts = r_contacts.length;

          // 5. Empresas
          const r_accounts = await db.delete(crmAccounts).where(eq(crmAccounts.tenantId, tenantId)).returning({ id: crmAccounts.id });
          results.crm_accounts = r_accounts.length;

          // 6. Funis e Etapas
          const r_stageSet = await db.delete(crmStageSettings).where(eq(crmStageSettings.tenantId, tenantId)).returning({ stageId: crmStageSettings.stageId });
          results.crm_stage_settings = r_stageSet.length;

          const r_stages = await db.delete(crmStages).where(eq(crmStages.tenantId, tenantId)).returning({ id: crmStages.id });
          results.crm_stages = r_stages.length;

          const r_pipelines = await db.delete(crmPipelines).where(eq(crmPipelines.tenantId, tenantId)).returning({ id: crmPipelines.id });
          results.crm_pipelines = r_pipelines.length;

          // 7. Campos Personalizados, Catálogos e Produtos
          const r_cfDefs = await db.delete(crmCustomFieldDefinitions).where(eq(crmCustomFieldDefinitions.tenantId, tenantId)).returning({ id: crmCustomFieldDefinitions.id });
          results.crm_custom_field_definitions = r_cfDefs.length;

          const r_catItems = await db.delete(crmCatalogItems).where(eq(crmCatalogItems.tenantId, tenantId)).returning({ id: crmCatalogItems.id });
          results.crm_catalog_items = r_catItems.length;

          const r_catPolicies = await db.delete(crmCatalogPolicies).where(eq(crmCatalogPolicies.tenantId, tenantId)).returning({ id: crmCatalogPolicies.tenantId });
          results.crm_catalog_policies = r_catPolicies.length;

          const r_prod = await db.delete(crmProducts).where(eq(crmProducts.tenantId, tenantId)).returning({ id: crmProducts.id });
          results.crm_products = r_prod.length;

          const r_actHist = await db.delete(crmActionHistory).where(eq(crmActionHistory.tenantId, tenantId)).returning({ id: crmActionHistory.id });
          results.crm_action_history = r_actHist.length;

          const r_migRuns = await db.delete(crmMigrationRuns).where(eq(crmMigrationRuns.tenantId, tenantId)).returning({ id: crmMigrationRuns.id });
          results.crm_migration_runs = r_migRuns.length;

          const r_quick = await db.delete(quickResponses).where(eq(quickResponses.tenantId, tenantId)).returning({ id: quickResponses.id });
          results.quick_responses = r_quick.length;
          if (r_contacts.length) await recordCrmAction({ tenantId,
            operatorId: session.operator.id, operatorName: session.operator.name,
            action: "delete_contact", entityType: "contact", itemCount: r_contacts.length,
            details: { contactIds: r_contacts.map((contact) => contact.id), source: "development_reset" } });

          const total = Object.values(results).reduce((a, b) => a + b, 0);

          await recordCrmAction({ tenantId, operatorId: session.operator.id,
            operatorName: session.operator.name, action: "reset_tenant", entityType: "system",
            itemCount: total, details: { counts: results, environment: "development" } });

          console.log(`[AdminReset] ✅ Reset completo. ${total} registros removidos:`, results);

          return new Response(
            JSON.stringify({
              success: true,
              message: `Reset completo! ${total} registros removidos.`,
              details: results,
              preserved: ["operators", "access_groups", "sectors", "quick_responses", "operator_templates", "agent_configs", "channel_configs", "tenants", "knowledge_folders", "knowledge_files"],
            }),
            { status: 200, headers: corsHeaders }
          );
        } catch (error: any) {
          console.error("[AdminReset] ❌ Erro durante reset:", error);
          return new Response(
            JSON.stringify({
              error: "Erro ao executar reset",
              details: error?.message || String(error),
            }),
            { status: 500, headers: corsHeaders }
          );
        }
      },
    },
  },
});
