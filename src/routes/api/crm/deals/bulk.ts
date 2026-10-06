import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals/bulk")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * POST /api/crm/deals/bulk
       * Atualiza negociações em lote (etapa, status ou vendedor responsável).
       * Exige permissão canEditDeals (ou canMoveDeals se apenas stageId).
       */
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          const body = await request.json();

          if (!body.allFiltered && (!body.dealIds || !Array.isArray(body.dealIds) || body.dealIds.length === 0)) {
            return new Response(
              JSON.stringify({ error: "Lista 'dealIds' é obrigatória quando não for seleção de filtro.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const result = await crmService.bulkUpdateDeals(tenantId, session.operator.id, {
            dealIds: body.dealIds || [],
            allFiltered: body.allFiltered,
            filterParams: body.filterParams,
            stageId: body.stageId,
            pipelineId: body.pipelineId,
            operatorId: body.operatorId,
            status: body.status,
            lossReason: body.lossReason,
            rating: body.rating,
            campaign: body.campaign,
            source: body.source,
            productId: body.productId,
            action: body.action,
            taskData: body.taskData,
          });

          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deals Bulk API] Erro no POST:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
