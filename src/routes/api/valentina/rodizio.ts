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
          const dashboardData = await RodizioEngine.getDashboardData(tenantId, {
            days,
            dateFrom,
            dateTo,
          });

          return new Response(
            JSON.stringify({
              operators: dashboardData.operators,
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
          const { action, operators: updatedOps, cardId, toOperatorId, toOperatorName } = body;

          if (action === "reassign" && cardId && toOperatorId) {
            await RodizioEngine.reassignLead(tenantId, cardId, toOperatorId, toOperatorName || "Operador");
            const dashboardData = await RodizioEngine.getDashboardData(tenantId);
            return new Response(
              JSON.stringify({ success: true, ...dashboardData }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (action === "remove_card" && cardId) {
            await RodizioEngine.removeLeadCard(tenantId, cardId);
            const dashboardData = await RodizioEngine.getDashboardData(tenantId);
            return new Response(
              JSON.stringify({ success: true, ...dashboardData }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (action === "reset") {
            const resetOps = await RodizioEngine.resetRodizioCounters(tenantId);
            const dashboardData = await RodizioEngine.getDashboardData(tenantId);
            return new Response(
              JSON.stringify({ success: true, ...dashboardData, operators: resetOps }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (Array.isArray(updatedOps)) {
            await RodizioEngine.saveRodizioState(tenantId, updatedOps);
          }

          const dashboardData = await RodizioEngine.getDashboardData(tenantId);

          return new Response(
            JSON.stringify({ success: true, ...dashboardData }),
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
