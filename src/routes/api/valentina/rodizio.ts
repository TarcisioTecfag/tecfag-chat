// ══════════════════════════════════════════════════════════════════════════════
// 🔄 API ROUTE: /api/valentina/rodizio — Gestão de Operadores do Rodízio
// ══════════════════════════════════════════════════════════════════════════════

import { createFileRoute } from "@tanstack/react-router";
import { RodizioEngine } from "../../../lib/valentina/rodizio-engine";
import { requireSession } from "../../../lib/auth-session";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/valentina/rodizio")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const url = new URL(request.url);
        const days = parseInt(url.searchParams.get("days") || "30", 10);
        const dateFrom = url.searchParams.get("dateFrom") || undefined;
        const dateTo = url.searchParams.get("dateTo") || undefined;

        try {
          const flowOperators = await RodizioEngine.getRodizioState(tenantId);
          const dashboardData = await RodizioEngine.getDashboardData(tenantId, {
            days,
            dateFrom,
            dateTo,
          });

          return new Response(
            JSON.stringify({
              operators: flowOperators,
              dashboardOperators: dashboardData.operators,
              stats: dashboardData.stats,
              byDay: dashboardData.byDay,
              byFunnel: dashboardData.byFunnel,
              deals: dashboardData.deals,
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } catch (e: any) {
          console.error("[api/valentina/rodizio] Erro ao buscar rodízio:", e);
          return new Response(
            JSON.stringify({
              operators: [],
              dashboardOperators: [],
              stats: null,
              byDay: [],
              byFunnel: [],
              deals: [],
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      },

      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;

        if (session.operator.role !== "admin") {
          return new Response(
            JSON.stringify({
              error: "Permissão insuficiente. Apenas administradores podem gerenciar o rodízio.",
              code: "FORBIDDEN",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const tenantId = session.tenantId;

        try {
          const body = await request.json();
          const { action, cardId, toOperatorId, toOperatorName } = body;

          if (action === "add_operator" && body.operator) {
            await RodizioEngine.addOperatorToFlow(tenantId, body.operator);
          } else if (action === "update_operator" && body.operatorId) {
            await RodizioEngine.updateOperatorInFlow(tenantId, body.operatorId, body.patch || {});
          } else if (action === "remove_operator" && body.operatorId) {
            await RodizioEngine.removeOperatorFromFlow(tenantId, body.operatorId);
          } else if (action === "toggle_funnel" && body.operatorId && body.funnel) {
            await RodizioEngine.toggleFunnel(tenantId, body.operatorId, body.funnel);
          } else if (action === "toggle_leave" && body.operatorId) {
            await RodizioEngine.toggleLeave(tenantId, body.operatorId);
          } else if (action === "update_compensation" && body.operatorId) {
            await RodizioEngine.updateCompensation(
              tenantId,
              body.operatorId,
              typeof body.value === "number" ? body.value : (body.delta || 0),
              Boolean(body.isAbsolute)
            );
          } else if (action === "reassign" && cardId && toOperatorId) {
            await RodizioEngine.reassignLead(tenantId, cardId, toOperatorId, toOperatorName || "Operador");
          } else if (action === "remove_card" && cardId) {
            await RodizioEngine.removeLeadCard(tenantId, cardId);
          } else if (action === "reset") {
            await RodizioEngine.resetRodizioCounters(tenantId);
          } else if (Array.isArray(body.operators)) {
            await RodizioEngine.saveRodizioState(tenantId, body.operators);
          }

          const flowOperators = await RodizioEngine.getRodizioState(tenantId);
          const dashboardData = await RodizioEngine.getDashboardData(tenantId);

          return new Response(
            JSON.stringify({
              success: true,
              operators: flowOperators,
              dashboardOperators: dashboardData.operators,
              stats: dashboardData.stats,
              byDay: dashboardData.byDay,
              byFunnel: dashboardData.byFunnel,
              deals: dashboardData.deals,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("[api/valentina/rodizio] Erro no POST do rodízio:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
