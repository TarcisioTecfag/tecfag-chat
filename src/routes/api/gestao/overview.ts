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

        const today = new Date().toISOString().split("T")[0];
        const todayStart = new Date(today + "T00:00:00.000Z");
        const todayEnd   = new Date(today + "T23:59:59.999Z");

        // ── 1. Conversas ativas (fail-safe independente) ──────────────────────
        let activeConversations = 0;
        try {
          const r = await db
            .select({ count: count() })
            .from(conversations)
            .where(and(eq(conversations.tenantId, tenantId), ne(conversations.queueState, "finalizados")));
          activeConversations = Number(r[0]?.count ?? 0);
        } catch (e: any) {
          console.warn("[overview] conversas ativas falhou:", e?.message);
        }

        // ── 2. Alertas SLA pendentes (fail-safe independente) ─────────────────
        let overdueAlerts = 0;
        try {
          const r = await db
            .select({ count: count() })
            .from(responseTimeLogs)
            .where(and(
              eq(responseTimeLogs.tenantId, tenantId),
              isNull(responseTimeLogs.agentResponseId),
              eq(responseTimeLogs.isOverdue, true)
            ));
          overdueAlerts = Number(r[0]?.count ?? 0);
        } catch (e: any) {
          console.warn("[overview] alertas SLA falhou:", e?.message);
        }

        // ── 3. Tempo médio de resposta hoje (fail-safe independente) ──────────
        let avgResponseSeconds: number | null = null;
        try {
          const r = await db
            .select({ avg: avg(responseTimeLogs.responseTimeSeconds) })
            .from(responseTimeLogs)
            .where(and(
              eq(responseTimeLogs.tenantId, tenantId),
              isNotNull(responseTimeLogs.responseTimeSeconds),
              gte(responseTimeLogs.createdAt, todayStart),
              lte(responseTimeLogs.createdAt, todayEnd)
            ));
          avgResponseSeconds = r[0]?.avg ? Math.floor(Number(r[0].avg)) : null;
        } catch (e: any) {
          console.warn("[overview] tempo médio resposta falhou:", e?.message);
        }

        // ── 4. Score médio da equipe hoje (fail-safe independente) ────────────
        let teamPerformanceScore: number | null = null;
        try {
          const r = await db
            .select({ avg: avg(aiConversationAudits.performanceScore) })
            .from(aiConversationAudits)
            .where(and(
              eq(aiConversationAudits.tenantId, tenantId),
              eq(aiConversationAudits.status, "done"),
              gte(aiConversationAudits.auditedAt, todayStart),
              lte(aiConversationAudits.auditedAt, todayEnd)
            ));
          teamPerformanceScore = r[0]?.avg ? Math.round(Number(r[0].avg)) : null;
        } catch (e: any) {
          console.warn("[overview] score equipe falhou:", e?.message);
        }

        // ── 5. Métricas diárias por operador (fail-safe independente) ─────────
        let dailyMetrics: any[] = [];
        try {
          dailyMetrics = await db
            .select()
            .from(operatorDailyMetrics)
            .where(and(
              eq(operatorDailyMetrics.tenantId, tenantId),
              eq(operatorDailyMetrics.date, today)
            ));
        } catch (e: any) {
          console.warn("[overview] métricas diárias falhou:", e?.message);
        }

        // ── 6. Operadores do tenant (fail-safe independente — SEMPRE executa) ─
        // Reflete automaticamente qualquer add/remoção de operador no DB.
        let allOperators: { id: string; name: string; status: string; avatar: string | null }[] = [];
        try {
          allOperators = await db
            .select({ id: operators.id, name: operators.name, status: operators.status, avatar: operators.avatar })
            .from(operators)
            .where(eq(operators.tenantId, tenantId));
        } catch (e: any) {
          console.warn("[overview] operadores falhou:", e?.message);
        }

        // Monta objeto de operador com métricas (ou zeros se ainda não há dados)
        const operatorsWithMetrics = allOperators.map((op) => {
          const metric = dailyMetrics.find((m) => m.operatorId === op.id);
          const avgSec = metric?.avgResponseTimeSeconds ?? null;

          // Semáforo: verde < 5min, amarelo < 15min, vermelho >= 15min ou sem dados
          let trafficLight: "green" | "yellow" | "red" = "green";
          if (avgSec === null) trafficLight = "yellow";
          else if (avgSec >= 900) trafficLight = "red";
          else if (avgSec >= 300) trafficLight = "yellow";

          return {
            operatorId: op.id,
            operatorName: op.name,
            operatorAvatar: op.avatar,
            status: op.status,
            totalConversations: metric?.totalConversations ?? 0,
            avgResponseTimeSeconds: avgSec,
            avgResponseTimeFormatted: avgSec
              ? avgSec >= 60 ? `${Math.floor(avgSec / 60)}min ${avgSec % 60}s` : `${avgSec}s`
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

        return new Response(JSON.stringify({
          today,
          activeConversations,
          overdueAlerts,
          avgResponseTimeSeconds: avgResponseSeconds,
          avgResponseTimeFormatted: avgResponseSeconds
            ? avgResponseSeconds >= 60 ? `${Math.floor(avgResponseSeconds / 60)}min ${avgResponseSeconds % 60}s` : `${avgResponseSeconds}s`
            : "–",
          teamPerformanceScore,
          operators: operatorsWithMetrics,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      },
    },
  },
});
