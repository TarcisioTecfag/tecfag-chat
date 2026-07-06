import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  operators,
  responseTimeLogs,
  aiConversationAudits,
  operatorDailyMetrics,
  conversations,
} from "../../../db/schema";
import { eq, and, isNull, isNotNull, avg, count, ne, gte, lte } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/gestao/overview")({
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
          const today = new Date().toISOString().split("T")[0]; // 'YYYY-MM-DD'

          // ── 1. Métricas gerais do dia ────────────────────────────────────────
          const [activeConvsResult, overdueResult] = await Promise.all([
            // Total de conversas ativas (não finalizadas)
            db
              .select({ count: count() })
              .from(conversations)
              .where(
                and(
                  eq(conversations.tenantId, tenantId),
                  ne(conversations.queueState, "finalizados")
                )
              ),
            // Total de ciclos SLA sem resposta (overdue)
            db
              .select({ count: count() })
              .from(responseTimeLogs)
              .where(
                and(
                  eq(responseTimeLogs.tenantId, tenantId),
                  isNull(responseTimeLogs.agentResponseId),
                  eq(responseTimeLogs.isOverdue, true)
                )
              ),
          ]);

          // Tempo médio de resposta do dia (em segundos, apenas dos que já responderam)
          const todayStart = new Date(today + "T00:00:00.000Z");
          const todayEnd = new Date(today + "T23:59:59.999Z");

          const avgResponseResult = await db
            .select({ avg: avg(responseTimeLogs.responseTimeSeconds) })
            .from(responseTimeLogs)
            .where(
              and(
                eq(responseTimeLogs.tenantId, tenantId),
                isNotNull(responseTimeLogs.responseTimeSeconds),
                gte(responseTimeLogs.createdAt, todayStart),
                lte(responseTimeLogs.createdAt, todayEnd)
              )
            );

          // Score médio da equipe hoje
          const teamScoreResult = await db
            .select({ avg: avg(aiConversationAudits.performanceScore) })
            .from(aiConversationAudits)
            .where(
              and(
                eq(aiConversationAudits.tenantId, tenantId),
                eq(aiConversationAudits.status, "done"),
                gte(aiConversationAudits.auditedAt, todayStart),
                lte(aiConversationAudits.auditedAt, todayEnd)
              )
            );

          // ── 2. Métricas por operador hoje ────────────────────────────────────
          const dailyMetrics = await db
            .select()
            .from(operatorDailyMetrics)
            .where(
              and(
                eq(operatorDailyMetrics.tenantId, tenantId),
                eq(operatorDailyMetrics.date, today)
              )
            );

          // Se não tiver métricas pré-calculadas, busca todos os operadores do tenant
          const allOperators = await db
            .select({ id: operators.id, name: operators.name, status: operators.status, avatar: operators.avatar })
            .from(operators)
            .where(eq(operators.tenantId, tenantId));

          // Monta o objeto de operador com métricas (ou zeros se ainda não há dados)
          const operatorsWithMetrics = allOperators.map((op) => {
            const metric = dailyMetrics.find((m) => m.operatorId === op.id);
            const avgSec = metric?.avgResponseTimeSeconds ?? null;
            
            // Semáforo: verde < 5min, amarelo < 15min, vermelho >= 15min ou sem dados
            let trafficLight: "green" | "yellow" | "red" = "green";
            if (avgSec === null) trafficLight = "yellow";
            else if (avgSec >= 900) trafficLight = "red";       // >= 15min
            else if (avgSec >= 300) trafficLight = "yellow";    // >= 5min

            return {
              operatorId: op.id,
              operatorName: op.name,
              operatorAvatar: op.avatar,
              status: op.status,
              totalConversations: metric?.totalConversations ?? 0,
              avgResponseTimeSeconds: avgSec,
              avgResponseTimeFormatted: avgSec
                ? avgSec >= 60
                  ? `${Math.floor(avgSec / 60)}min ${avgSec % 60}s`
                  : `${avgSec}s`
                : "–",
              overdueCount: metric?.overdueCount ?? 0,
              avgPerformanceScore: metric?.avgPerformanceScore ?? null,
              satisfiedCount: metric?.satisfiedCount ?? 0,
              neutralCount: metric?.neutralCount ?? 0,
              frustratedCount: metric?.frustratedCount ?? 0,
              trafficLight,
            };
          });

          // Ordena: vermelho > amarelo > verde, depois por overdueCount desc
          operatorsWithMetrics.sort((a, b) => {
            const order = { red: 0, yellow: 1, green: 2 };
            if (order[a.trafficLight] !== order[b.trafficLight])
              return order[a.trafficLight] - order[b.trafficLight];
            return (b.overdueCount ?? 0) - (a.overdueCount ?? 0);
          });

          const avgResponseSeconds = avgResponseResult[0]?.avg
            ? Math.floor(Number(avgResponseResult[0].avg))
            : null;

          const overview = {
            today,
            activeConversations: activeConvsResult[0]?.count ?? 0,
            overdueAlerts: overdueResult[0]?.count ?? 0,
            avgResponseTimeSeconds: avgResponseSeconds,
            avgResponseTimeFormatted: avgResponseSeconds
              ? avgResponseSeconds >= 60
                ? `${Math.floor(avgResponseSeconds / 60)}min ${avgResponseSeconds % 60}s`
                : `${avgResponseSeconds}s`
              : "–",
            teamPerformanceScore: teamScoreResult[0]?.avg
              ? Math.round(Number(teamScoreResult[0].avg))
              : null,
            operators: operatorsWithMetrics,
          };

          return new Response(JSON.stringify(overview), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          // Loga o erro completo nos logs do servidor (Railway) para investigação
          const errDetail = {
            message: e?.message,
            code: e?.code,
            detail: e?.detail,
            hint: e?.hint,
            cause: e?.cause ? {
              message: e.cause?.message,
              code: e.cause?.code,
              detail: e.cause?.detail,
            } : null,
          };
          console.error("[gestao/overview] ERRO:", JSON.stringify(errDetail));

          // Retorna dados seguros (zeros) em vez de 500 para não travar o dashboard
          return new Response(JSON.stringify({
            today: new Date().toISOString().split("T")[0],
            activeConversations: 0,
            overdueAlerts: 0,
            avgResponseTimeSeconds: null,
            avgResponseTimeFormatted: "–",
            teamPerformanceScore: null,
            operators: [],
            _debug: errDetail,
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
