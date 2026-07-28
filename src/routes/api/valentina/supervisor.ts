import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { internalMessages, operators } from "../../../db/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";

// ── Headers CORS padrão ────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/valentina/supervisor")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ── GET: Buscar KPIs, notificações e top perguntas do Supervisor ─────────
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");

        if (!tenantId) {
          return new Response(
            JSON.stringify({ error: "tenantId é obrigatório" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        try {
          const now = new Date();
          const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

          // 1. KPIs das últimas 24 horas usando agregação no banco
          const kpisResult = await db
            .select({
              notificationsSent: sql<number>`COUNT(*) FILTER (WHERE ${internalMessages.direction} = 'from_agent' AND ${internalMessages.agentType} = 'supervisor')`.mapWith(Number),
              questionsAnswered: sql<number>`COUNT(*) FILTER (WHERE ${internalMessages.direction} = 'from_agent' AND ${internalMessages.agentType} = 'supervisor' AND ${internalMessages.metadata}->>'type' IS NULL)`.mapWith(Number),
              slaAlerts: sql<number>`COUNT(*) FILTER (WHERE ${internalMessages.metadata}->>'type' = 'sla_alert')`.mapWith(Number),
              leadsTransferred: sql<number>`COUNT(*) FILTER (WHERE ${internalMessages.metadata}->>'type' = 'lead_transfer')`.mapWith(Number),
            })
            .from(internalMessages)
            .where(
              and(
                eq(internalMessages.tenantId, tenantId),
                gte(internalMessages.createdAt, last24h)
              )
            );

          const kpis = {
            notificationsSent: kpisResult[0]?.notificationsSent || 0,
            questionsAnswered: kpisResult[0]?.questionsAnswered || 0,
            slaAlerts: kpisResult[0]?.slaAlerts || 0,
            leadsTransferred: kpisResult[0]?.leadsTransferred || 0,
          };

          // 2. Notificações do Supervisor (Apenas alertas, não respostas de chat)
          // Filtramos onde metadata->>'type' existe
          const notificationsRaw = await db
            .select({
              id: internalMessages.id,
              content: internalMessages.content,
              metadata: internalMessages.metadata,
              createdAt: internalMessages.createdAt,
              operatorName: operators.name,
            })
            .from(internalMessages)
            .leftJoin(operators, eq(internalMessages.operatorId, operators.id))
            .where(
              and(
                eq(internalMessages.tenantId, tenantId),
                eq(internalMessages.direction, "from_agent"),
                eq(internalMessages.agentType, "supervisor"),
                sql`${internalMessages.metadata}->>'type' IS NOT NULL`
              )
            )
            .orderBy(desc(internalMessages.createdAt))
            .limit(50);

          // Mapeia para o formato esperado pelo frontend
          const notifications = notificationsRaw.map((n) => {
            const meta = n.metadata as Record<string, any>;
            return {
              id: n.id,
              type: meta.type || "unknown",
              title: meta.title || "Alerta do Supervisor",
              description: n.content, // O texto descritivo vem do content da mensagem
              operatorName: n.operatorName || "Operador Desconhecido",
              timestamp: n.createdAt.toISOString(),
              priority: meta.priority || "medium",
              conversationId: meta.conversationId || null,
            };
          });

          // 3. Perguntas recentes dos operadores nas últimas 7 dias
          const recentQuestionsRaw = await db
            .select({
              id: internalMessages.id,
              question: internalMessages.content,
              createdAt: internalMessages.createdAt,
              operatorName: operators.name,
            })
            .from(internalMessages)
            .leftJoin(operators, eq(internalMessages.operatorId, operators.id))
            .where(
              and(
                eq(internalMessages.tenantId, tenantId),
                eq(internalMessages.direction, "to_agent"),
                eq(internalMessages.agentType, "supervisor"),
                gte(internalMessages.createdAt, last7d)
              )
            )
            .orderBy(desc(internalMessages.createdAt))
            .limit(20);

          const recentQuestions = recentQuestionsRaw.map((q) => ({
            id: q.id,
            question: q.question,
            operatorName: q.operatorName || "Operador Desconhecido",
            timestamp: q.createdAt.toISOString(),
          }));

          return new Response(
            JSON.stringify({
              kpis,
              notifications,
              recentQuestions,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } catch (e: any) {
          console.error("[valentina/supervisor] Erro ao carregar dados:", e);
          return new Response(
            JSON.stringify({ error: "Erro interno no servidor ao carregar dados do supervisor", details: e?.message }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      },
    },
  },
});
