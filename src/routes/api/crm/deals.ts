import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../lib/auth-session";
import { crmService } from "../../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/deals
       * Lista negociações paginadas com filtros por funil, etapa, status, vendedor e busca.
       */
      GET: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const url = new URL(request.url);
          const pipelineId = url.searchParams.get("pipelineId") || undefined;
          const stageId = url.searchParams.get("stageId") || undefined;
          const status = (url.searchParams.get("status") as "open" | "won" | "lost" | "paused") || undefined;
          const operatorId = url.searchParams.get("operatorId") || undefined;
          const accountId = url.searchParams.get("accountId") || undefined;
          const search = url.searchParams.get("search") || undefined;
          const limit = parseInt(url.searchParams.get("limit") || "50", 10);
          const offset = parseInt(url.searchParams.get("offset") || "0", 10);

          const result = await crmService.getDeals(tenantId, {
            pipelineId,
            stageId,
            status,
            operatorId,
            accountId,
            search,
            limit,
            offset,
          });

          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deals API] Erro no GET:", err);
          return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      /**
       * POST /api/crm/deals
       * Cria uma nova negociação comercial com auditoria e vínculo opcional.
       */
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const body = await request.json();
          if (!body.title || !body.title.trim()) {
            return new Response(
              JSON.stringify({ error: "O título da negociação é obrigatório.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          if (!body.pipelineId || !body.stageId) {
            return new Response(
              JSON.stringify({ error: "Funil (pipelineId) e Etapa (stageId) são obrigatórios.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const deal = await crmService.createDeal(tenantId, session.operator.id, {
            title: body.title,
            pipelineId: body.pipelineId,
            stageId: body.stageId,
            accountId: body.accountId,
            value: body.value,
            currency: body.currency,
            expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : null,
            source: body.source,
            campaign: body.campaign,
            rating: body.rating,
            contactId: body.contactId,
            conversationId: body.conversationId,
          });

          return new Response(JSON.stringify({ deal }), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deals API] Erro no POST:", err);
          return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
