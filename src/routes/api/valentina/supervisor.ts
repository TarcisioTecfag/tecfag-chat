import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { internalMessages, operators } from "../../../db/schema";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/valentina/supervisor")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        // Filtros de data opcionais (ISO string)
        const dateFrom = url.searchParams.get("dateFrom");
        const dateTo   = url.searchParams.get("dateTo");
        // Filtro de tipo opcional (ex: "sla_alert,sentiment_alert")
        const typeFilter = url.searchParams.get("types"); // CSV ou null para todos

        if (!tenantId) {
          return new Response(
            JSON.stringify({ error: "tenantId é obrigatório" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        try {
          const now = new Date();
          const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

          // ── KPIs (sempre últimas 24h, independente de filtro) ──────────────
          const kpisResult = await db
            .select({
              notificationsSent: sql<number>`COUNT(*) FILTER (WHERE ${internalMessages.direction} = 'from_agent' AND ${internalMessages.agentType} = 'supervisor')`.mapWith(Number),
              questionsAnswered: sql<number>`COUNT(*) FILTER (WHERE ${internalMessages.direction} = 'to_agent' AND ${internalMessages.agentType} = 'supervisor')`.mapWith(Number),
              slaAlerts:         sql<number>`COUNT(*) FILTER (WHERE ${internalMessages.metadata}->>'type' = 'sla_alert')`.mapWith(Number),
              leadsTransferred:  sql<number>`COUNT(*) FILTER (WHERE ${internalMessages.metadata}->>'type' = 'lead_transfer')`.mapWith(Number),
            })
            .from(internalMessages)
            .where(and(
              eq(internalMessages.tenantId, tenantId),
              gte(internalMessages.createdAt, last24h)
            ));

          const kpis = {
            notificationsSent: kpisResult[0]?.notificationsSent || 0,
            questionsAnswered:  kpisResult[0]?.questionsAnswered || 0,
            slaAlerts:          kpisResult[0]?.slaAlerts || 0,
            leadsTransferred:   kpisResult[0]?.leadsTransferred || 0,
          };

          // ── Construir filtros dinâmicos para a timeline ──────────────────────
          const from = dateFrom ? new Date(dateFrom) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // padrão 30 dias
          const to   = dateTo   ? new Date(dateTo)   : now;

          const allowedTypes = typeFilter ? typeFilter.split(",").map(t => t.trim()) : null;

          // ── Notificações do Supervisor com filtros aplicados ─────────────────
          const notificationsRaw = await db
            .select({
              id:           internalMessages.id,
              content:      internalMessages.content,
              metadata:     internalMessages.metadata,
              createdAt:    internalMessages.createdAt,
              operatorName: operators.name,
              operatorId:   internalMessages.operatorId,
            })
            .from(internalMessages)
            .leftJoin(operators, eq(internalMessages.operatorId, operators.id))
            .where(and(
              eq(internalMessages.tenantId, tenantId),
              eq(internalMessages.direction, "from_agent"),
              eq(internalMessages.agentType, "supervisor"),
              sql`${internalMessages.metadata}->>'type' IS NOT NULL`,
              gte(internalMessages.createdAt, from),
              lte(internalMessages.createdAt, to),
            ))
            .orderBy(desc(internalMessages.createdAt))
            .limit(200);

          let notifications = notificationsRaw.map((n) => {
            const meta = n.metadata as Record<string, any>;
            return {
              id:             n.id,
              type:           meta.type || "unknown",
              title:          meta.title || "Alerta do Supervisor",
              description:    n.content,
              operatorName:   n.operatorName || "Operador Desconhecido",
              operatorId:     n.operatorId || null,
              timestamp:      n.createdAt.toISOString(),
              priority:       meta.priority || "medium",
              conversationId: meta.conversationId || null,
              contactName:    meta.contactName || null,
            };
          });

          // Filtrar por tipo no JS (mais simples que SQL dinâmico com IN)
          if (allowedTypes && allowedTypes.length > 0) {
            notifications = notifications.filter(n => allowedTypes.includes(n.type));
          }

          // ── Perguntas recentes dos operadores ─────────────────────────────
          const recentQuestionsRaw = await db
            .select({
              id:             internalMessages.id,
              content:        internalMessages.content,
              createdAt:      internalMessages.createdAt,
              operatorId:     internalMessages.operatorId,
              operatorName:   operators.name,
              operatorAvatar: operators.avatar,
            })
            .from(internalMessages)
            .leftJoin(operators, eq(internalMessages.operatorId, operators.id))
            .where(and(
              eq(internalMessages.tenantId, tenantId),
              eq(internalMessages.direction, "to_agent"),
              eq(internalMessages.agentType, "supervisor")
            ))
            .orderBy(desc(internalMessages.createdAt))
            .limit(20);

          const recentQuestions = recentQuestionsRaw.map((q) => ({
            id:             q.id,
            question:       q.content,
            operatorId:     q.operatorId || "unknown",
            operatorName:   q.operatorName || "Operador",
            operatorAvatar: q.operatorAvatar || null,
            timestamp:      q.createdAt.toISOString(),
          }));

          return new Response(
            JSON.stringify({ kpis, notifications, recentQuestions }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );

        } catch (e: any) {
          console.error("[valentina/supervisor] Erro:", e);
          return new Response(
            JSON.stringify({ error: "Erro interno", details: e?.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
