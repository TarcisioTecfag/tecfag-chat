import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  operators,
  responseTimeLogs,
  aiConversationAudits,
  conversations,
} from "../../../db/schema";
import { eq, and, isNull, isNotNull, avg, count, ne, gte, lte, inArray } from "drizzle-orm";
import { getComercialOperatorIds } from "../../../lib/gestao-filter";
import { requireSession } from "../../../lib/auth-session.js";
import { conversationReadCondition } from "../../../lib/access-control/conversation-access";
import { conversationReadRules } from "../../../lib/access-control/conversation-policy";
import {
  computeOperatorsOverviewAnalytics,
  formatSecondsPt,
} from "../../../lib/operator-ranking-analytics";

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
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response; // retorna 401 automaticamente
        const { session } = auth;
        const tenantId = session.tenantId; // SEMPRE da sessão

        const canViewOverview =
          (session.permissions?.views?.monitor === true && session.permissions?.monitor?.canAccessRanking === true) ||
          (session.permissions?.views?.analytics === true && session.permissions?.analytics?.canAccessOverview === true);
        if (!canViewOverview) {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente para acessar o painel de gestão.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const readScope = conversationReadCondition(session);
        const rules = conversationReadRules(session);
        const restrictOperatorScope = rules.ownOnly || !rules.others;

        const today = new Date().toISOString().split("T")[0];
        const todayStart = new Date(today + "T00:00:00.000Z");
        const todayEnd   = new Date(today + "T23:59:59.999Z");

        // ── 0. IDs dos operadores do setor Comercial (regra de negócio) ──────
        // Apenas operadores do setor "Comercial" aparecem no painel de monitoramento.
        // Se nenhum setor Comercial for encontrado, retorna overview sem operadores.
        const comercialIds = await getComercialOperatorIds(tenantId);
        // Se o setor existe mas está vazio, nenhum operador é exibido
        if (comercialIds !== null && comercialIds.length === 0) {
          return new Response(JSON.stringify({
            today,
            activeConversations: 0,
            overdueAlerts: 0,
            avgResponseTimeSeconds: null,
            avgResponseTimeFormatted: "–",
            teamPerformanceScore: null,
            operators: [],
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // ── 1. Conversas ativas (fail-safe independente) ──────────────────────
        let activeConversations = 0;
        try {
          const r = await db
            .select({ count: count() })
            .from(conversations)
            .where(and(eq(conversations.tenantId, tenantId), readScope, ne(conversations.queueState, "finalizados")));
          activeConversations = Number(r[0]?.count ?? 0);
        } catch (e: any) {
          console.warn("[overview] conversas ativas falhou:", e?.message);
        }

        // ── 2. Alertas SLA pendentes no log (fail-safe independente) ──────────
        let logOverdueAlerts = 0;
        try {
          const r = await db
            .select({ count: count() })
            .from(responseTimeLogs)
            .innerJoin(conversations, and(eq(conversations.id, responseTimeLogs.conversationId), eq(conversations.tenantId, tenantId)))
            .where(and(
              eq(responseTimeLogs.tenantId, tenantId),
              readScope,
              isNull(responseTimeLogs.agentResponseId),
              eq(responseTimeLogs.isOverdue, true)
            ));
          logOverdueAlerts = Number(r[0]?.count ?? 0);
        } catch (e: any) {
          console.warn("[overview] alertas SLA falhou:", e?.message);
        }

        // ── 3. Tempo médio de resposta hoje no log (fail-safe independente) ───
        let logAvgResponseSeconds: number | null = null;
        try {
          const r = await db
            .select({ avg: avg(responseTimeLogs.responseTimeSeconds) })
            .from(responseTimeLogs)
            .innerJoin(conversations, and(eq(conversations.id, responseTimeLogs.conversationId), eq(conversations.tenantId, tenantId)))
            .where(and(
              eq(responseTimeLogs.tenantId, tenantId),
              readScope,
              isNotNull(responseTimeLogs.responseTimeSeconds),
              gte(responseTimeLogs.createdAt, todayStart),
              lte(responseTimeLogs.createdAt, todayEnd)
            ));
          logAvgResponseSeconds = r[0]?.avg ? Math.floor(Number(r[0].avg)) : null;
        } catch (e: any) {
          console.warn("[overview] tempo médio resposta falhou:", e?.message);
        }

        // ── 4. Score médio de auditoria IA da equipe hoje (fail-safe) ─────────
        let auditTeamScore: number | null = null;
        try {
          const r = await db
            .select({ avg: avg(aiConversationAudits.performanceScore) })
            .from(aiConversationAudits)
            .innerJoin(conversations, and(eq(conversations.id, aiConversationAudits.conversationId), eq(conversations.tenantId, tenantId)))
            .where(and(
              eq(aiConversationAudits.tenantId, tenantId),
              readScope,
              eq(aiConversationAudits.status, "done"),
              gte(aiConversationAudits.auditedAt, todayStart),
              lte(aiConversationAudits.auditedAt, todayEnd)
            ));
          auditTeamScore = r[0]?.avg ? Math.round(Number(r[0].avg)) : null;
        } catch (e: any) {
          console.warn("[overview] score equipe falhou:", e?.message);
        }

        // ── 5. Operadores monitorados do tenant (com presença real e perfil) ──
        let allOperators: {
          id: string;
          name: string;
          email: string;
          role: string;
          status: string;
          avatar: string | null;
          groupId: string | null;
          isOnline: boolean;
          lastSeenAt: Date | null;
          usageDate: string | null;
          usageSecondsToday: number;
        }[] = [];
        try {
          allOperators = await db
            .select({
              id: operators.id,
              name: operators.name,
              email: operators.email,
              role: operators.role,
              status: operators.status,
              avatar: operators.avatar,
              groupId: operators.groupId,
              isOnline: operators.isOnline,
              lastSeenAt: operators.lastSeenAt,
              usageDate: operators.usageDate,
              usageSecondsToday: operators.usageSecondsToday,
            })
            .from(operators)
            .where(and(
              eq(operators.tenantId, tenantId),
              comercialIds !== null ? inArray(operators.id, comercialIds) : undefined,
              restrictOperatorScope ? eq(operators.id, session.operator.id) : undefined,
            ));
        } catch (e: any) {
          console.warn("[overview] operadores falhou:", e?.message);
        }

        // ── 6. Motor completo de Analytics dos Operadores (Real-Time + Histórico 7d/30d) ─
        const analytics = await computeOperatorsOverviewAnalytics({
          tenantId,
          viewerOperatorId: session.operator.id,
          readScope,
          allOperators,
        });

        const avgResponseSeconds = analytics.avgResponseSecondsToday ?? logAvgResponseSeconds;
        const overdueAlerts = Math.max(analytics.overdueAlertsCount, logOverdueAlerts);
        const teamPerformanceScore = auditTeamScore ?? analytics.teamPerformanceScore;

        return new Response(JSON.stringify({
          today: analytics.todayBrt || today,
          activeConversations,
          overdueAlerts,
          avgResponseTimeSeconds: avgResponseSeconds,
          avgResponseTimeFormatted: formatSecondsPt(avgResponseSeconds),
          teamPerformanceScore,
          operators: analytics.operators,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      },
    },
  },
});
