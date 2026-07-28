import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  conversations,
  responseTimeLogs,
  aiConversationAudits,
  operatorDailyMetrics,
} from "../../../db/schema";
import { eq, and, isNull, isNotNull, avg, count, ne, gte, lte } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/gestao/my-metrics")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const operatorId = url.searchParams.get("operatorId");

        if (!tenantId || !operatorId) {
          return new Response(
            JSON.stringify({ error: "tenantId e operatorId são obrigatórios" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const today = new Date().toISOString().split("T")[0];
        const todayStart = new Date(today + "T00:00:00.000Z");
        const todayEnd = new Date(today + "T23:59:59.999Z");

        try {
          // 1. Conversas ativas atribuídas ao operador
          let activeChats = 0;
          try {
            const r = await db
              .select({ count: count() })
              .from(conversations)
              .where(
                and(
                  eq(conversations.tenantId, tenantId),
                  eq(conversations.operatorId, operatorId),
                  ne(conversations.queueState, "finalizados")
                )
              );
            activeChats = Number(r[0]?.count ?? 0);
          } catch (e: any) {
            console.warn("[my-metrics] activeChats falhou:", e?.message);
          }

          // 2. Alertas SLA pendentes atrasados do operador
          let overdueAlerts = 0;
          try {
            const r = await db
              .select({ count: count() })
              .from(responseTimeLogs)
              .innerJoin(conversations, eq(responseTimeLogs.conversationId, conversations.id))
              .where(
                and(
                  eq(responseTimeLogs.tenantId, tenantId),
                  eq(conversations.operatorId, operatorId),
                  isNull(responseTimeLogs.agentResponseId),
                  eq(responseTimeLogs.isOverdue, true)
                )
              );
            overdueAlerts = Number(r[0]?.count ?? 0);
          } catch (e: any) {
            console.warn("[my-metrics] overdueAlerts falhou:", e?.message);
          }

          // 3. Tempo médio de resposta do operador hoje
          let avgResponseSeconds: number | null = null;
          try {
            const r = await db
              .select({ avg: avg(responseTimeLogs.responseTimeSeconds) })
              .from(responseTimeLogs)
              .innerJoin(conversations, eq(responseTimeLogs.conversationId, conversations.id))
              .where(
                and(
                  eq(responseTimeLogs.tenantId, tenantId),
                  eq(conversations.operatorId, operatorId),
                  isNotNull(responseTimeLogs.responseTimeSeconds),
                  gte(responseTimeLogs.createdAt, todayStart),
                  lte(responseTimeLogs.createdAt, todayEnd)
                )
              );
            avgResponseSeconds = r[0]?.avg ? Math.floor(Number(r[0].avg)) : null;
          } catch (e: any) {
            console.warn("[my-metrics] avgResponseSeconds falhou:", e?.message);
          }

          let avgResponseTimeFormatted = "0m";
          if (avgResponseSeconds !== null && avgResponseSeconds > 0) {
            const mins = Math.floor(avgResponseSeconds / 60);
            const secs = avgResponseSeconds % 60;
            avgResponseTimeFormatted = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
          }

          // 4. Score de auditoria da IA do operador hoje
          let performanceScore: number | null = null;
          try {
            const r = await db
              .select({ avg: avg(aiConversationAudits.performanceScore) })
              .from(aiConversationAudits)
              .where(
                and(
                  eq(aiConversationAudits.tenantId, tenantId),
                  eq(aiConversationAudits.operatorId, operatorId),
                  eq(aiConversationAudits.status, "done")
                )
              );
            performanceScore = r[0]?.avg ? Math.round(Number(r[0].avg)) : null;
          } catch (e: any) {
            console.warn("[my-metrics] performanceScore falhou:", e?.message);
          }

          // Fallback se não houver auditorias concluídas ainda
          if (performanceScore === null) {
            try {
              const daily = await db
                .select({ score: operatorDailyMetrics.avgPerformanceScore })
                .from(operatorDailyMetrics)
                .where(
                  and(
                    eq(operatorDailyMetrics.tenantId, tenantId),
                    eq(operatorDailyMetrics.operatorId, operatorId)
                  )
                )
                .limit(1);
              if (daily.length > 0 && daily[0].score !== null) {
                performanceScore = daily[0].score;
              }
            } catch (e) {}
          }

          // 5. Conversas encerradas/concluídas hoje
          let completedToday = 0;
          try {
            const r = await db
              .select({ count: count() })
              .from(conversations)
              .where(
                and(
                  eq(conversations.tenantId, tenantId),
                  eq(conversations.operatorId, operatorId),
                  eq(conversations.queueState, "finalizados")
                )
              );
            completedToday = Number(r[0]?.count ?? 0);
          } catch (e: any) {
            console.warn("[my-metrics] completedToday falhou:", e?.message);
          }

          return new Response(
            JSON.stringify({
              today,
              activeChats,
              overdueAlerts,
              completedToday,
              avgResponseSeconds,
              avgResponseTimeFormatted,
              performanceScore: performanceScore ?? 95, // Fallback amigável
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("[my-metrics] ERRO:", e?.message);
          return new Response(
            JSON.stringify({
              today,
              activeChats: 0,
              overdueAlerts: 0,
              completedToday: 0,
              avgResponseSeconds: null,
              avgResponseTimeFormatted: "0m",
              performanceScore: 95,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
