import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  operators,
  responseTimeLogs,
  conversations
} from "../../../db/schema";
import { eq, and, count, avg, isNotNull } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";
import { conversationReadCondition } from "../../../lib/access-control/conversation-access";
import { conversationReadRules } from "../../../lib/access-control/conversation-policy";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Calcula o Tempo Médio de Resposta (TME) operacional expurgando distorções
 * de virada de noite/fim de semana (Winsorized mean no P85 para amostras >= 4).
 */
function computeOperationalAvgSeconds(rawTimes: (number | null | undefined)[]): number {
  const valid = rawTimes.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  if (valid.length === 0) return 0;
  if (valid.length < 4) {
    return Math.round(valid.reduce((acc, curr) => acc + curr, 0) / valid.length);
  }
  const inShift = valid.filter((v) => v <= 4 * 3600);
  const base = inShift.length >= Math.ceil(valid.length * 0.5) ? inShift : valid;
  const sorted = [...base].sort((a, b) => a - b);
  const p85Cap = sorted[Math.floor((sorted.length - 1) * 0.85)] ?? sorted[sorted.length - 1];
  const cappedSum = sorted.reduce((acc, v) => acc + Math.min(v, p85Cap), 0);
  return Math.round(cappedSum / sorted.length);
}

export const Route = createFileRoute("/api/gestao/sla")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (session.permissions?.views?.analytics !== true || session.permissions?.analytics?.canAccessSla !== true) {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente para acessar métricas de SLA.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const readScope = conversationReadCondition(session);
        const rules = conversationReadRules(session);
        const restrictOperatorScope = rules.ownOnly || !rules.others;

        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        if (queryTenantId && queryTenantId !== tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        try {
          // ── 1. Métricas Gerais de SLA ──────────────────────────────────────
          const allSlaLogs = await db
            .select({
              isOverdue: responseTimeLogs.isOverdue,
              responseTimeSeconds: responseTimeLogs.responseTimeSeconds,
            })
            .from(responseTimeLogs)
            .innerJoin(conversations, and(eq(conversations.id, responseTimeLogs.conversationId), eq(conversations.tenantId, tenantId)))
            .where(and(eq(responseTimeLogs.tenantId, tenantId), readScope));

          const totalSlaCount = allSlaLogs.length;
          const overdueCount = allSlaLogs.filter((l) => l.isOverdue).length;
          const withinSlaCount = Math.max(0, totalSlaCount - overdueCount);
          const overallSlaPct = totalSlaCount > 0
            ? Math.round((withinSlaCount / totalSlaCount) * 100)
            : 100;
          const allValidTimes = allSlaLogs
            .map((l) => l.responseTimeSeconds)
            .filter((v): v is number => typeof v === "number" && v > 0);
          const overallAvgResponseSeconds = computeOperationalAvgSeconds(allValidTimes);

          // ── 2. Ranking de SLA por Operador ─────────────────────────────────
          const allOperators = await db
            .select({
              id: operators.id,
              name: operators.name,
              avatar: operators.avatar,
            })
            .from(operators)
            .where(and(
              eq(operators.tenantId, tenantId),
              restrictOperatorScope ? eq(operators.id, session.operator.id) : undefined,
            ));

          const operatorSlaMetrics = await Promise.all(
            allOperators.map(async (op) => {
              const [chatsRes, logsRes] = await Promise.all([
                db
                  .select({ count: count() })
                  .from(conversations)
                  .where(
                    and(
                      eq(conversations.tenantId, tenantId),
                      readScope,
                      eq(conversations.operatorId, op.id)
                    )
                  ),
                db
                  .select({
                    responseTimeSeconds: responseTimeLogs.responseTimeSeconds,
                    isOverdue: responseTimeLogs.isOverdue,
                  })
                  .from(responseTimeLogs)
                  .innerJoin(conversations, and(eq(conversations.id, responseTimeLogs.conversationId), eq(conversations.tenantId, tenantId)))
                  .where(
                    and(
                      eq(responseTimeLogs.tenantId, tenantId),
                      readScope,
                      eq(responseTimeLogs.operatorId, op.id)
                    )
                  ),
              ]);

              const chats = Number(chatsRes[0]?.count ?? 0);
              const validTimes = logsRes.map((l) => l.responseTimeSeconds).filter(Boolean) as number[];
              const avgResponseSeconds = computeOperationalAvgSeconds(validTimes);

              const opTotal = logsRes.length;
              const opOverdue = logsRes.filter((l) => l.isOverdue).length;
              const opWithin = Math.max(0, opTotal - opOverdue);
              const slaPct = opTotal > 0 ? Math.round((opWithin / opTotal) * 100) : 0;

              return {
                id: op.id,
                name: op.name,
                avatar: op.avatar ?? null,
                chats,
                avgResponseSeconds,
                slaPct,
                slaSampleCount: opTotal,
                overdueCount: opOverdue,
                withinSlaCount: opWithin,
              };
            })
          );

          operatorSlaMetrics.sort((a, b) => {
            const aActive = a.chats > 0 || a.slaSampleCount > 0 ? 1 : 0;
            const bActive = b.chats > 0 || b.slaSampleCount > 0 ? 1 : 0;
            if (bActive !== aActive) return bActive - aActive;
            if (b.chats !== a.chats) return b.chats - a.chats;
            if (b.slaPct !== a.slaPct) return b.slaPct - a.slaPct;
            return a.name.localeCompare(b.name, "pt-BR");
          });

          return new Response(
            JSON.stringify({
              overallSlaPct,
              overdueCount,
              totalSlaCount,
              withinSlaCount,
              overallAvgResponseSeconds,
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
