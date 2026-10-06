import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../lib/crm/crm-service";
import { recordCrmAction } from "../../../../lib/crm/action-history";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/stages/$stageId")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * PATCH /api/crm/stages/:stageId
       * Atualiza propriedades de uma etapa (nome, orderIndex, flags terminal isWinStage/isLossStage).
       * Exige canManagePipelines.
       */
      PATCH: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canManagePipelines");
          if (permError) return permError;

          const { stageId } = params as unknown as { stageId: string };
          const body = await request.json().catch(() => ({}));

          const updated = await crmService.updateStage(tenantId, stageId, {
            name: body.name,
            orderIndex: body.orderIndex,
            isWinStage: body.isWinStage,
            isLossStage: body.isLossStage,
            requiredFields: body.requiredFields,
          });

          return new Response(JSON.stringify({ stage: updated }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Stages API] Erro no PATCH:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * DELETE /api/crm/stages/:stageId
       * Exclui uma etapa. Rejeita se houver negociações associadas.
       * Exige canManagePipelines.
       */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canManagePipelines");
          if (permError) return permError;

          const { stageId } = params as unknown as { stageId: string };
          const result = await crmService.deleteStage(tenantId, stageId);
          await recordCrmAction({ tenantId, operatorId: session.operator.id, operatorName: session.operator.name,
            action: "delete_stage", entityType: "stage", itemCount: 1, details: { stageId } });

          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Stages API] Erro no DELETE:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
