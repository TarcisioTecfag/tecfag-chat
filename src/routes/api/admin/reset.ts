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
  agentFlowStates,
  roundRobinState,
  mediaFiles,
  callSessions,
  tasks,
} from "../../../db/schema";

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ─── POST /api/admin/reset ───────────────────────────────────────────────────
// Limpa todos os dados operacionais (conversas, mensagens, contatos, alertas,
// logs de IA, métricas) SEM apagar operadores, setores e grupos de acesso.
// ATENÇÃO: Ação irreversível. Use apenas em ambiente de desenvolvimento/testes.
export const Route = createFileRoute("/api/admin/reset")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
      },

      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}));

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

          // Ordem de deleção respeita FK constraints:
          // 1. Dependentes primeiro, depois pais

          // Logs e auditorias de IA
          const [r_aiLogs] = await db.delete(aiUsageLogs).returning({ id: aiUsageLogs.id });
          results.ai_usage_logs = Array.isArray(r_aiLogs) ? r_aiLogs.length : 0;

          const [r_audits] = await db.delete(aiConversationAudits).returning({ id: aiConversationAudits.id });
          results.ai_conversation_audits = Array.isArray(r_audits) ? r_audits.length : 0;

          const [r_reports] = await db.delete(aiReports).returning({ id: aiReports.id });
          results.ai_reports = Array.isArray(r_reports) ? r_reports.length : 0;

          // Métricas diárias dos operadores
          const [r_metrics] = await db.delete(operatorDailyMetrics).returning({ id: operatorDailyMetrics.id });
          results.operator_daily_metrics = Array.isArray(r_metrics) ? r_metrics.length : 0;

          // Mensagens internas (alertas do Supervisor / Valentina)
          const [r_internal] = await db.delete(internalMessages).returning({ id: internalMessages.id });
          results.internal_messages = Array.isArray(r_internal) ? r_internal.length : 0;

          // Logs de tempo de resposta (SLA)
          const [r_rtLogs] = await db.delete(responseTimeLogs).returning({ id: responseTimeLogs.id });
          results.response_time_logs = Array.isArray(r_rtLogs) ? r_rtLogs.length : 0;

          // Arquivos de mídia e chamadas
          const [r_media] = await db.delete(mediaFiles).returning({ id: mediaFiles.id });
          results.media_files = Array.isArray(r_media) ? r_media.length : 0;

          const [r_calls] = await db.delete(callSessions).returning({ id: callSessions.id });
          results.call_sessions = Array.isArray(r_calls) ? r_calls.length : 0;

          // Tarefas
          const [r_tasks] = await db.delete(tasks).returning({ id: tasks.id });
          results.tasks = Array.isArray(r_tasks) ? r_tasks.length : 0;

          // Estados de agentes e round-robin
          const [r_flowStates] = await db.delete(agentFlowStates).returning({ id: agentFlowStates.id });
          results.agent_flow_states = Array.isArray(r_flowStates) ? r_flowStates.length : 0;

          const [r_rr] = await db.delete(roundRobinState).returning({ id: roundRobinState.id });
          results.round_robin_state = Array.isArray(r_rr) ? r_rr.length : 0;

          // Mensagens das conversas
          const [r_msgs] = await db.delete(messages).returning({ id: messages.id });
          results.messages = Array.isArray(r_msgs) ? r_msgs.length : 0;

          // Conversas
          const [r_convs] = await db.delete(conversations).returning({ id: conversations.id });
          results.conversations = Array.isArray(r_convs) ? r_convs.length : 0;

          // Contatos (por último — referenciado pelas conversas)
          const [r_contacts] = await db.delete(contacts).returning({ id: contacts.id });
          results.contacts = Array.isArray(r_contacts) ? r_contacts.length : 0;

          const total = Object.values(results).reduce((a, b) => a + b, 0);

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
