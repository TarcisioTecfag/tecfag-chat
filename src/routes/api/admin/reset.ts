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

          // Deleções estritamente filtradas pelo tenant do administrador autenticado
          const [r_aiLogs] = await db.delete(aiUsageLogs).where(eq(aiUsageLogs.tenantId, tenantId)).returning({ id: aiUsageLogs.id });
          results.ai_usage_logs = Array.isArray(r_aiLogs) ? r_aiLogs.length : 0;

          const [r_audits] = await db.delete(aiConversationAudits).where(eq(aiConversationAudits.tenantId, tenantId)).returning({ id: aiConversationAudits.id });
          results.ai_conversation_audits = Array.isArray(r_audits) ? r_audits.length : 0;

          const [r_reports] = await db.delete(aiReports).where(eq(aiReports.tenantId, tenantId)).returning({ id: aiReports.id });
          results.ai_reports = Array.isArray(r_reports) ? r_reports.length : 0;

          const [r_metrics] = await db.delete(operatorDailyMetrics).where(eq(operatorDailyMetrics.tenantId, tenantId)).returning({ id: operatorDailyMetrics.id });
          results.operator_daily_metrics = Array.isArray(r_metrics) ? r_metrics.length : 0;

          const [r_internal] = await db.delete(internalMessages).where(eq(internalMessages.tenantId, tenantId)).returning({ id: internalMessages.id });
          results.internal_messages = Array.isArray(r_internal) ? r_internal.length : 0;

          const [r_rtLogs] = await db.delete(responseTimeLogs).where(eq(responseTimeLogs.tenantId, tenantId)).returning({ id: responseTimeLogs.id });
          results.response_time_logs = Array.isArray(r_rtLogs) ? r_rtLogs.length : 0;

          const [r_media] = await db.delete(mediaFiles).where(eq(mediaFiles.tenantId, tenantId)).returning({ id: mediaFiles.id });
          results.media_files = Array.isArray(r_media) ? r_media.length : 0;

          const [r_calls] = await db.delete(callSessions).where(eq(callSessions.tenantId, tenantId)).returning({ id: callSessions.id });
          results.call_sessions = Array.isArray(r_calls) ? r_calls.length : 0;

          const [r_tasks] = await db.delete(tasks).where(eq(tasks.tenantId, tenantId)).returning({ id: tasks.id });
          results.tasks = Array.isArray(r_tasks) ? r_tasks.length : 0;

          const [r_flowStates] = await db.delete(agentFlowStates).where(eq(agentFlowStates.tenantId, tenantId)).returning({ id: agentFlowStates.id });
          results.agent_flow_states = Array.isArray(r_flowStates) ? r_flowStates.length : 0;

          const [r_rr] = await db.delete(roundRobinState).where(eq(roundRobinState.tenantId, tenantId)).returning({ id: roundRobinState.id });
          results.round_robin_state = Array.isArray(r_rr) ? r_rr.length : 0;

          const [r_msgs] = await db.delete(messages).where(eq(messages.tenantId, tenantId)).returning({ id: messages.id });
          results.messages = Array.isArray(r_msgs) ? r_msgs.length : 0;

          const [r_convs] = await db.delete(conversations).where(eq(conversations.tenantId, tenantId)).returning({ id: conversations.id });
          results.conversations = Array.isArray(r_convs) ? r_convs.length : 0;

          const r_contacts = await db.delete(contacts).where(eq(contacts.tenantId, tenantId)).returning({ id: contacts.id });
          results.contacts = r_contacts.length;
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
