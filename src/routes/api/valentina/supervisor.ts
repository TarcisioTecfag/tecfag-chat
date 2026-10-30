import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { internalMessages, operators, sectors } from "../../../db/schema";
import { eq, and, desc, gte, lte, sql, asc, inArray } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";

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
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;

        if (session.operator.role !== "admin" && session.operator.role !== "supervisor") {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente. Apenas administradores e supervisores podem acessar os dados do supervisor.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const tenantId = session.tenantId;

        const url = new URL(request.url);
        // Filtros de data opcionais (ISO string)
        const dateFrom = url.searchParams.get("dateFrom");
        const dateTo   = url.searchParams.get("dateTo");
        // Filtro de tipo opcional (ex: "sla_alert,sentiment_alert")
        const typeFilter = url.searchParams.get("types");
        // Filtro por operador/usuário opcional
        const operatorIdFilter = url.searchParams.get("operatorId");

        try {
          const now = new Date();
          const from = dateFrom ? new Date(dateFrom) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          const to   = dateTo   ? new Date(dateTo)   : now;

          // ── Lista de operadores do tenant para o filtro de usuário ──────────
          const [tenantOperators, tenantSectors] = await Promise.all([
            db
              .select({
                id: operators.id,
                name: operators.name,
                avatar: operators.avatar,
                role: operators.role,
                status: operators.status,
              })
              .from(operators)
              .where(eq(operators.tenantId, tenantId))
              .orderBy(asc(operators.name)),
            db
              .select({
                id: sectors.id,
                name: sectors.name,
                operatorIds: sectors.operatorIds,
              })
              .from(sectors)
              .where(eq(sectors.tenantId, tenantId)),
          ]);

          const sectorByOpId = new Map<string, string>();
          for (const sec of tenantSectors) {
            const ids = Array.isArray(sec.operatorIds) ? sec.operatorIds : [];
            for (const opId of ids) {
              if (!sectorByOpId.has(opId)) {
                sectorByOpId.set(opId, sec.name);
              }
            }
          }

          const operatorsList = tenantOperators
            .filter((op) => !op.id.startsWith("bot-") && !op.name.toLowerCase().includes("robô"))
            .map((op) => ({
              id: op.id,
              name: op.name,
              avatar: op.avatar || null,
              role: op.role,
              status: op.status,
              sectorTag: sectorByOpId.get(op.id)
                ? sectorByOpId.get(op.id)!.slice(0, 4).toUpperCase()
                : op.role === "admin"
                  ? "ADM"
                  : null,
            }));

          // ── Condições base respeitando período e filtro de usuário ──────────
          const baseConditions = [
            eq(internalMessages.tenantId, tenantId),
            gte(internalMessages.createdAt, from),
            lte(internalMessages.createdAt, to),
          ];
          if (operatorIdFilter && operatorIdFilter !== "all") {
            baseConditions.push(eq(internalMessages.operatorId, operatorIdFilter));
          }

          // ── KPIs sincronizados com o período e usuário selecionados ─────────
          const kpisResult = await db
            .select({
              notificationsSent: sql<number>`COUNT(*) FILTER (WHERE ${internalMessages.direction} = 'from_agent' AND ${internalMessages.agentType} = 'supervisor')`.mapWith(Number),
              questionsAnswered: sql<number>`COUNT(*) FILTER (WHERE ${internalMessages.direction} = 'to_agent' AND ${internalMessages.agentType} IN ('supervisor', 'valentina', 'fagner'))`.mapWith(Number),
              slaAlerts:         sql<number>`COUNT(*) FILTER (WHERE ${internalMessages.metadata}->>'type' IN ('sla_alert', 'no_response'))`.mapWith(Number),
              leadsTransferred:  sql<number>`COUNT(*) FILTER (WHERE ${internalMessages.metadata}->>'type' = 'lead_transfer')`.mapWith(Number),
            })
            .from(internalMessages)
            .where(and(...baseConditions));

          const kpis = {
            notificationsSent: kpisResult[0]?.notificationsSent || 0,
            questionsAnswered:  kpisResult[0]?.questionsAnswered || 0,
            slaAlerts:          kpisResult[0]?.slaAlerts || 0,
            leadsTransferred:   kpisResult[0]?.leadsTransferred || 0,
          };

          const allowedTypes = typeFilter ? typeFilter.split(",").map(t => t.trim()) : null;

          // ── Notificações do Supervisor com filtros aplicados ─────────────────
          const notificationsRaw = await db
            .select({
              id:             internalMessages.id,
              content:        internalMessages.content,
              metadata:       internalMessages.metadata,
              createdAt:      internalMessages.createdAt,
              operatorName:   operators.name,
              operatorAvatar: operators.avatar,
              operatorId:     internalMessages.operatorId,
              repeatCount:    internalMessages.repeatCount,
              lastFiredAt:    internalMessages.lastFiredAt,
            })
            .from(internalMessages)
            .leftJoin(
              operators,
              and(eq(internalMessages.operatorId, operators.id), eq(operators.tenantId, tenantId)),
            )
            .where(and(
              ...baseConditions,
              eq(internalMessages.direction, "from_agent"),
              eq(internalMessages.agentType, "supervisor"),
              sql`${internalMessages.metadata}->>'type' IS NOT NULL`,
            ))
            .orderBy(desc(internalMessages.createdAt))
            .limit(200);

          let notifications = notificationsRaw.map((n) => {
            const meta = (n.metadata as Record<string, any>) || {};
            return {
              id:             n.id,
              type:           meta.type || "unknown",
              title:          meta.title || "Alerta do Supervisor",
              description:    n.content,
              operatorName:   n.operatorName || "Operador",
              operatorAvatar: n.operatorAvatar || null,
              operatorId:     n.operatorId || null,
              timestamp:      n.createdAt.toISOString(),
              priority:       meta.priority || "medium",
              conversationId: meta.conversationId || meta.clientId || null,
              contactName:    meta.contactName || meta.clientName || null,
              waitMinutes:    typeof meta.waitMinutes === "number" ? meta.waitMinutes : null,
              repeatCount:    n.repeatCount ?? 1,
              lastFiredAt:    n.lastFiredAt ? n.lastFiredAt.toISOString() : n.createdAt.toISOString(),
            };
          });

          if (allowedTypes && allowedTypes.length > 0) {
            notifications = notifications.filter(n => allowedTypes.includes(n.type));
          }

          // ── Perguntas recentes dos operadores (respeitando filtro de usuário e período) ──
          const recentQuestionsRaw = await db
            .select({
              id:             internalMessages.id,
              content:        internalMessages.content,
              createdAt:      internalMessages.createdAt,
              operatorId:     internalMessages.operatorId,
              operatorName:   operators.name,
              operatorAvatar: operators.avatar,
              agentType:      internalMessages.agentType,
            })
            .from(internalMessages)
            .leftJoin(
              operators,
              and(eq(internalMessages.operatorId, operators.id), eq(operators.tenantId, tenantId)),
            )
            .where(and(
              ...baseConditions,
              eq(internalMessages.direction, "to_agent"),
              inArray(internalMessages.agentType, ["supervisor", "valentina", "fagner"]),
            ))
            .orderBy(desc(internalMessages.createdAt))
            .limit(30);

          const recentQuestions = recentQuestionsRaw.map((q) => ({
            id:             q.id,
            question:       q.content,
            operatorId:     q.operatorId || "unknown",
            operatorName:   q.operatorName || "Operador",
            operatorAvatar: q.operatorAvatar || null,
            timestamp:      q.createdAt.toISOString(),
          }));

          return new Response(
            JSON.stringify({ kpis, notifications, recentQuestions, operators: operatorsList }),
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
