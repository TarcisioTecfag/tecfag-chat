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

const OVERVIEW_CACHE_TTL_MS = 25_000;
const OVERVIEW_CACHE_MAX_ENTRIES = 60;
const overviewResponseCache = new Map<string, { expiresAt: number; payload: string }>();
const overviewInFlight = new Map<string, Promise<string>>();

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

        const cacheKey = `${tenantId}:${session.operator.id}:${restrictOperatorScope ? "own" : "all"}`;
        const cached = overviewResponseCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          return new Response(cached.payload, {
            headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "HIT" },
          });
        }

        const existingInFlight = overviewInFlight.get(cacheKey);
        if (existingInFlight) {
          const payload = await existingInFlight;
          return new Response(payload, {
            headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "COALESCED" },
          });
        }

        const computePromise = (async (): Promise<string> => {
          const today = new Date().toISOString().split("T")[0];
          const todayStart = new Date(today + "T00:00:00.000Z");
          const todayEnd   = new Date(today + "T23:59:59.999Z");

          // ── 0. IDs dos operadores do setor Comercial (regra de negócio) ──────
          const comercialIds = await getComercialOperatorIds(tenantId);
          if (comercialIds !== null && comercialIds.length === 0) {
            return JSON.stringify({
              today,
              activeConversations: 0,
              overdueAlerts: 0,
              avgResponseTimeSeconds: null,
              avgResponseTimeFormatted: "–",
              teamPerformanceScore: null,
              operators: [],
            });
          }

          // ── 1-5. Consultas independentes em paralelo ─────────────────────────
          const [
            activeConversations,
            logOverdueAlerts,
            logAvgResponseSeconds,
            auditTeamScore,
            allOperators,
          ] = await Promise.all([
            db
              .select({ count: count() })
              .from(conversations)
              .where(and(eq(conversations.tenantId, tenantId), readScope, ne(conversations.queueState, "finalizados")))
              .then((r) => Number(r[0]?.count ?? 0))
              .catch((e: any) => {
                console.warn("[overview] conversas ativas falhou:", e?.message);
                return 0;
              }),
            db
              .select({ count: count() })
              .from(responseTimeLogs)
              .innerJoin(conversations, and(eq(conversations.id, responseTimeLogs.conversationId), eq(conversations.tenantId, tenantId)))
              .where(and(
                eq(responseTimeLogs.tenantId, tenantId),
                readScope,
                isNull(responseTimeLogs.agentResponseId),
                eq(responseTimeLogs.isOverdue, true)
              ))
              .then((r) => Number(r[0]?.count ?? 0))
              .catch((e: any) => {
                console.warn("[overview] alertas SLA falhou:", e?.message);
                return 0;
              }),
            db
              .select({ avg: avg(responseTimeLogs.responseTimeSeconds) })
              .from(responseTimeLogs)
              .innerJoin(conversations, and(eq(conversations.id, responseTimeLogs.conversationId), eq(conversations.tenantId, tenantId)))
              .where(and(
                eq(responseTimeLogs.tenantId, tenantId),
                readScope,
                isNotNull(responseTimeLogs.responseTimeSeconds),
                gte(responseTimeLogs.createdAt, todayStart),
                lte(responseTimeLogs.createdAt, todayEnd)
              ))
              .then((r) => (r[0]?.avg ? Math.floor(Number(r[0].avg)) : null))
              .catch((e: any) => {
                console.warn("[overview] tempo médio resposta falhou:", e?.message);
                return null;
              }),
            db
              .select({ avg: avg(aiConversationAudits.performanceScore) })
              .from(aiConversationAudits)
              .innerJoin(conversations, and(eq(conversations.id, aiConversationAudits.conversationId), eq(conversations.tenantId, tenantId)))
              .where(and(
                eq(aiConversationAudits.tenantId, tenantId),
                readScope,
                eq(aiConversationAudits.status, "done"),
                gte(aiConversationAudits.auditedAt, todayStart),
                lte(aiConversationAudits.auditedAt, todayEnd)
              ))
              .then((r) => (r[0]?.avg ? Math.round(Number(r[0].avg)) : null))
              .catch((e: any) => {
                console.warn("[overview] score equipe falhou:", e?.message);
                return null;
              }),
            db
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
              ))
              .catch((e: any) => {
                console.warn("[overview] operadores falhou:", e?.message);
                return [];
              }),
          ]);

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

          return JSON.stringify({
            today: analytics.todayBrt || today,
            activeConversations,
            overdueAlerts,
            avgResponseTimeSeconds: avgResponseSeconds,
            avgResponseTimeFormatted: formatSecondsPt(avgResponseSeconds),
            teamPerformanceScore,
            operators: analytics.operators,
          });
        })();

        overviewInFlight.set(cacheKey, computePromise);
        try {
          const payload = await computePromise;
          if (overviewResponseCache.size >= OVERVIEW_CACHE_MAX_ENTRIES) {
            const firstKey = overviewResponseCache.keys().next().value;
            if (firstKey) overviewResponseCache.delete(firstKey);
          }
          overviewResponseCache.set(cacheKey, {
            expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS,
            payload,
          });
          return new Response(payload, {
            headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "MISS" },
          });
        } finally {
          overviewInFlight.delete(cacheKey);
        }
      },
    },
  },
});
