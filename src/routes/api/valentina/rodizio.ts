// ══════════════════════════════════════════════════════════════════════════════
// 🔄 API ROUTE: /api/valentina/rodizio — Gestão de Operadores do Rodízio
// ══════════════════════════════════════════════════════════════════════════════

import { createFileRoute } from "@tanstack/react-router";
import { RodizioEngine } from "../../../lib/valentina/rodizio-engine";

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
        try {
          const url = new URL(request.url);
          const tenantId = url.searchParams.get("tenantId") || "valem";

          const operators = await RodizioEngine.getRodizioState(tenantId);

          return new Response(JSON.stringify({ operators }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[api/valentina/rodizio] Erro ao buscar rodízio:", e);
          return new Response(JSON.stringify({ operators: [] }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { action, tenantId = "valem", operators: updatedOps } = body;

          if (action === "reset") {
            const resetOps = await RodizioEngine.resetRodizioCounters(tenantId);
            return new Response(JSON.stringify({ success: true, operators: resetOps }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (Array.isArray(updatedOps)) {
            await RodizioEngine.saveRodizioState(tenantId, updatedOps);
          }

          const currentOps = await RodizioEngine.getRodizioState(tenantId);

          return new Response(JSON.stringify({ success: true, operators: currentOps }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
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
