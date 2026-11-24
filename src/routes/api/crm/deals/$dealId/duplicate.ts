import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../../lib/auth-session";
import { requireCrmDealAccess, requireCrmTransitionAccess } from "../../../../../lib/access-control/crm-record-access";
import { isPipelineAllowed, isStageVisibleToSession, requireCrmPermission } from "../../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals/$dealId/duplicate")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * POST /api/crm/deals/:dealId/duplicate
       * Duplica uma negociação acessível dentro do mesmo tenant.
       * Exige acesso à negociação pai (requireCrmDealAccess) + permissão canCreateDeals.
       */
      POST: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const { dealId } = params as { dealId: string };

          const recordDenied = await requireCrmDealAccess(session, dealId);
          if (recordDenied) return recordDenied;

          const createDenied = requireCrmPermission(session, "canCreateDeals");
          if (createDenied) return createDenied;

          const body = await request.json().catch(() => ({}));

          if (body?.pipelineId && !isPipelineAllowed(session, String(body.pipelineId))) {
            return new Response(
              JSON.stringify({
                error: "Permissão insuficiente: seu grupo não possui acesso ao funil selecionado.",
                code: "FORBIDDEN",
              }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          if (body?.pipelineId && body?.stageId) {
            if (!isStageVisibleToSession(session, String(body.pipelineId), String(body.stageId))) {
              const transitionDenied = await requireCrmTransitionAccess(
                session,
                { pipelineId: String(body.pipelineId), stageId: String(body.stageId) },
                { dealId },
              );
              if (transitionDenied) return transitionDenied;
            }
          }

          const authorizedOperatorId =
            session.operator.role !== "admin" && !session.permissions?.crm?.canViewAllDeals
              ? session.operator.id
              : undefined;

          const result = await crmService.duplicateDeal(
            tenantId,
            dealId,
            session.operator.id,
            session.operator.name,
            {
              title: typeof body?.title === "string" ? body.title : undefined,
              pipelineId: typeof body?.pipelineId === "string" ? body.pipelineId : undefined,
              stageId: typeof body?.stageId === "string" ? body.stageId : undefined,
              operatorId: body?.operatorId !== undefined ? body.operatorId : undefined,
              copyProducts: typeof body?.copyProducts === "boolean" ? body.copyProducts : true,
              authorizedOperatorId,
            },
          );

          return new Response(JSON.stringify(result), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deal Duplicate API] Erro no POST:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
