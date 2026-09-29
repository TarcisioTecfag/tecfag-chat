import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { operatorDailyMetrics } from "../../../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/gestao/operator-history")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        if (queryTenantId && queryTenantId !== tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const requestedOperatorId = url.searchParams.get("operatorId");
        const operatorId = (session.operator.role === "admin" || session.operator.role === "supervisor")
          ? (requestedOperatorId || session.operator.id)
          : session.operator.id;

        try {
          // Busca todos os registros históricos desse operador no tenant, mais recentes primeiro
          const history = await db
            .select()
            .from(operatorDailyMetrics)
            .where(
              and(
                eq(operatorDailyMetrics.tenantId, tenantId),
                eq(operatorDailyMetrics.operatorId, operatorId)
              )
            )
            .orderBy(desc(operatorDailyMetrics.date));

          // Formatar as métricas para a exibição no histórico
          const formattedHistory = history.map((record) => {
            const totalSentiment = record.satisfiedCount + record.neutralCount + record.frustratedCount;
            const satisfiedPct = totalSentiment > 0 ? Math.round((record.satisfiedCount / totalSentiment) * 100) : 0;
            
            const avgSec = record.avgResponseTimeSeconds ?? 0;
            const formattedTime = avgSec >= 60 
              ? `${Math.floor(avgSec / 60)}min ${avgSec % 60}s` 
              : `${avgSec}s`;

            return {
              id: record.id,
              date: record.date,
              totalConversations: record.totalConversations,
              avgResponseTimeFormatted: formattedTime,
              overdueCount: record.overdueCount,
              avgPerformanceScore: record.avgPerformanceScore,
              satisfiedPct,
              satisfiedCount: record.satisfiedCount,
              neutralCount: record.neutralCount,
              frustratedCount: record.frustratedCount,
            };
          });

          return new Response(JSON.stringify(formattedHistory), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[gestao/operator-history] ERRO:", e?.message);
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
