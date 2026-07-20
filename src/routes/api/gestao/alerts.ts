import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { responseTimeLogs, conversations, contacts, operators, messages } from "../../../db/schema";
import { eq, isNull, and, desc } from "drizzle-orm";
import { SlaEngine } from "../../../lib/sla-engine";
import { AuditService } from "../../../lib/audit-service";

// Inicializa os engines na primeira request desta rota (lazy init)
SlaEngine.getInstance().start();
AuditService.getInstance().start();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/gestao/alerts")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");

        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          // Busca todos os ciclos SLA sem resposta (pendentes) do tenant
          const openLogs = await db
            .select({
              logId: responseTimeLogs.id,
              conversationId: responseTimeLogs.conversationId,
              clientMessageAt: responseTimeLogs.clientMessageAt,
              isOverdue: responseTimeLogs.isOverdue,
              overdueThresholdSeconds: responseTimeLogs.overdueThresholdSeconds,
              // Dados da conversa
              operatorId: conversations.operatorId,
              queueState: conversations.queueState,
              conversationCreatedAt: conversations.createdAt,
              // Dados do contato
              contactName: contacts.name,
              contactPhone: contacts.phone,
              contactAvatar: contacts.avatar,
              crmCardUrl: contacts.rdCrmDealLink,
            })
            .from(responseTimeLogs)
            .innerJoin(conversations, eq(responseTimeLogs.conversationId, conversations.id))
            .innerJoin(contacts, eq(conversations.contactId, contacts.id))
            .where(
              and(
                eq(responseTimeLogs.tenantId, tenantId),
                isNull(responseTimeLogs.agentResponseId) // Ainda sem resposta
              )
            )
            .orderBy(desc(responseTimeLogs.clientMessageAt)); // Mais antigos primeiro

          const now = Date.now();
          const alerts = await Promise.all(
            openLogs.map(async (log) => {
              const waitingSeconds = Math.floor(
                (now - new Date(log.clientMessageAt).getTime()) / 1000
              );
              const waitingMinutes = Math.floor(waitingSeconds / 60);
              const isOverdue = waitingSeconds >= log.overdueThresholdSeconds;

              // Busca o nome do operador se houver um atribuído
              let operatorName = "Sem operador";
              if (log.operatorId) {
                const op = await db
                  .select({ name: operators.name })
                  .from(operators)
                  .where(eq(operators.id, log.operatorId))
                  .limit(1);
                if (op.length > 0) operatorName = op[0].name;
              }

              // Busca a última mensagem do cliente na conversa para exibição rápida
              let lastMessagePreview = "boa tarde alguem pode me atender?????";
              try {
                const msg = await db
                  .select({ content: messages.content })
                  .from(messages)
                  .where(
                    and(
                      eq(messages.conversationId, log.conversationId),
                      eq(messages.senderType, "client")
                    )
                  )
                  .orderBy(desc(messages.sentAt))
                  .limit(1);
                if (msg.length > 0) lastMessagePreview = msg[0].content;
              } catch (e) {
                console.warn("[gestao/alerts] falhou ao buscar última mensagem:", e);
              }

              // Classificação do tipo de alerta com base nas palavras-chave da mensagem do cliente
              let alertType: "sla" | "conflict" = "sla";
              const lowerMsg = lastMessagePreview.toLowerCase();
              if (
                lowerMsg.includes("horrivel") ||
                lowerMsg.includes("horrível") ||
                lowerMsg.includes("ruim") ||
                lowerMsg.includes("atendimento horrível") ||
                lowerMsg.includes("cancelar") ||
                lowerMsg.includes("sem interesse") ||
                lowerMsg.includes("insatisfeito") ||
                lowerMsg.includes("pessimo") ||
                lowerMsg.includes("péssimo") ||
                lowerMsg.includes("palhaçada")
              ) {
                alertType = "conflict";
              }

              // Formatar a data de início da conversa
              const startedAtDate = new Date(log.conversationCreatedAt);
              const formattedStartedAt = startedAtDate.toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });

              return {
                logId: log.logId,
                conversationId: log.conversationId,
                contactName: log.contactName,
                contactPhone: log.contactPhone,
                contactAvatar: log.contactAvatar,
                operatorName,
                operatorId: log.operatorId,
                queueState: log.queueState,
                waitingSeconds,
                waitingMinutes,
                clientMessageAt: log.clientMessageAt,
                isOverdue,
                isCritical: waitingSeconds >= log.overdueThresholdSeconds * 2, // Dobro do limite = crítico
                alertType,
                lastMessagePreview,
                crmCardUrl: log.crmCardUrl,
                conversationStartedAt: formattedStartedAt,
              };
            })
          );

          // Ordena: críticos primeiro, depois por tempo de espera decrescente
          alerts.sort((a, b) => {
            if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
            if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
            return b.waitingSeconds - a.waitingSeconds;
          });

          return new Response(JSON.stringify(alerts), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          const errDetail = { message: e?.message, code: e?.code, detail: e?.detail, cause: e?.cause ? { message: e.cause?.message, code: e.cause?.code } : null };
          console.error("[gestao/alerts] ERRO:", JSON.stringify(errDetail));
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
