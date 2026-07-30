import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  operators,
  responseTimeLogs,
  conversations
} from "../../../db/schema";
import { eq, and, count, avg, isNotNull } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/gestao/sla")({
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
          // ── 1. Métricas Gerais de SLA ──────────────────────────────────────
          const allSlaLogs = await db
            .select({
              isOverdue: responseTimeLogs.isOverdue,
              responseTimeSeconds: responseTimeLogs.responseTimeSeconds,
            })
            .from(responseTimeLogs)
            .where(eq(responseTimeLogs.tenantId, tenantId));

          const totalSlaCount = allSlaLogs.length;
          const overdueCount = allSlaLogs.filter((l) => l.isOverdue).length;
          const overallSlaPct = totalSlaCount > 0
            ? Math.round(((totalSlaCount - overdueCount) / totalSlaCount) * 100)
            : 100;

          // ── 2. Ranking de SLA por Operador ─────────────────────────────────
          const allOperators = await db
            .select({
              id: operators.id,
              name: operators.name,
            })
            .from(operators)
            .where(eq(operators.tenantId, tenantId));

          const operatorSlaMetrics = await Promise.all(
            allOperators.map(async (op) => {
              const [chatsRes, logsRes] = await Promise.all([
                db
                  .select({ count: count() })
                  .from(conversations)
                  .where(
                    and(
                      eq(conversations.tenantId, tenantId),
                      eq(conversations.operatorId, op.id)
                    )
                  ),
                db
                  .select({
                    responseTimeSeconds: responseTimeLogs.responseTimeSeconds,
                    isOverdue: responseTimeLogs.isOverdue,
                  })
                  .from(responseTimeLogs)
                  .where(
                    and(
                      eq(responseTimeLogs.tenantId, tenantId),
                      eq(responseTimeLogs.operatorId, op.id)
                    )
                  ),
              ]);

              const chats = Number(chatsRes[0]?.count ?? 0);
              const validTimes = logsRes.map((l) => l.responseTimeSeconds).filter(Boolean) as number[];
              const avgResponseSeconds = validTimes.length > 0
                ? Math.round(validTimes.reduce((acc, curr) => acc + curr, 0) / validTimes.length)
                : 0;

              const opTotal = logsRes.length;
              const opOverdue = logsRes.filter((l) => l.isOverdue).length;
              const slaPct = opTotal > 0 ? Math.round(((opTotal - opOverdue) / opTotal) * 100) : 0;

              return {
                id: op.id,
                name: op.name,
                chats,
                avgResponseSeconds,
                slaPct,
              };
            })
          );

          return new Response(
            JSON.stringify({
              overallSlaPct,
              overdueCount,
              operators: operatorSlaMetrics,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } catch (e: any) {
          console.error("[gestao/sla] Erro GET:", e);
          return new Response(
            JSON.stringify({
              overallSlaPct: 100,
              overdueCount: 0,
              operators: [],
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      },
    },
  },
});
