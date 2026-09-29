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

        try {
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
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;

        if (session.operator.role !== "admin") {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente. Apenas administradores podem gerenciar o rodízio.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const tenantId = session.tenantId;

        try {
          const body = await request.json();
          const { action, operators: updatedOps } = body;

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
