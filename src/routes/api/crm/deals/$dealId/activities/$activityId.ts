import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals/$dealId/activities/$activityId")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * PATCH /api/crm/deals/:dealId/activities/:activityId
       * Atualiza tarefa/atividade comercial (concluir, reabrir, reagendar, cancelar ou editar).
       * Regra E3: Notas comerciais imutáveis não podem ser alteradas.
       */
      PATCH: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          const { dealId, activityId } = params as any;
          const body = await request.json();

          const activity = await crmService.updateDealActivity(
            tenantId,
            dealId,
            activityId,
            session.operator.id,
            {
              status: body.status,
              title: body.title,
              description: body.description,
              dueDate: body.dueDate !== undefined ? (body.dueDate ? new Date(body.dueDate) : null) : undefined,
              type: body.type,
              assignedToOperatorId: body.assignedToOperatorId,
            }
          );

          return new Response(JSON.stringify({ activity }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Activity Detail API] Erro no PATCH:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * DELETE /api/crm/deals/:dealId/activities/:activityId
       * Remove atividade comercial da negociação.
       * Regra E3: Notas comerciais imutáveis não podem ser excluídas.
       */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          const { dealId, activityId } = params as any;

          const result = await crmService.deleteDealActivity(
            tenantId,
            dealId,
            activityId,
            session.operator.id
          );

          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Activity Detail API] Erro no DELETE:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
