import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { crmService } from "../../../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals/$dealId")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/deals/:dealId
       * Retorna ficha detalhada da negociação com comprador, contatos e conversas vinculadas.
       */
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const { dealId } = params as { dealId: string };
          const deal = await crmService.getDealById(tenantId, dealId);

          if (!deal) {
            return new Response(JSON.stringify({ error: "Negociação não encontrada.", code: "NOT_FOUND" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify({ deal }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deal Detail API] Erro no GET:", err);
          return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      /**
       * PATCH /api/crm/deals/:dealId
       * Atualiza negociação com concorrência otimista (etapa, status, vendedor, valor).
       */
      PATCH: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const { dealId } = params as { dealId: string };
          const body = await request.json();

          const updated = await crmService.updateDeal(tenantId, dealId, session.operator.id, {
            title: body.title,
            stageId: body.stageId,
            status: body.status,
            value: body.value,
            expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : undefined,
            operatorId: body.operatorId,
            rating: body.rating,
            lossReason: body.lossReason,
            pausedReason: body.pausedReason,
            expectedVersion: body.expectedVersion,
          });

          return new Response(JSON.stringify({ deal: updated }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deal Detail API] Erro no PATCH:", err);
          const status = err.message?.includes("CONCURRENCY_CONFLICT") ? 409 : 500;
          return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
            status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
