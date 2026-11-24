import { requireCrmDealAccess, requireCrmTransitionAccess } from "../../../../lib/access-control/crm-record-access";
import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { getAllowedPipelineIds, requireCrmPermission } from "../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../lib/crm/crm-service";
import { conversationReadCondition } from "../../../../lib/access-control/conversation-access";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals/$dealId")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/deals/:dealId
       * Retorna ficha detalhada da negociação com comprador, contatos e conversas vinculadas.
       * Exige canViewCrm e respeita canViewAllDeals.
       */
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const recordDenied = await requireCrmDealAccess(session, (params as { dealId: string }).dealId);
          if (recordDenied) return recordDenied;

          const permError = requireCrmPermission(session, "canViewCrm");
          if (permError) return permError;

          const { dealId } = params as { dealId: string };
          const deal = await crmService.getDealById(tenantId, dealId, conversationReadCondition(session));

          if (!deal) {
            return new Response(JSON.stringify({ error: "Negociação não encontrada.", code: "NOT_FOUND" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Se operador não tiver permissão para ver todos os negócios, bloqueia negócios de outros operadores
          if (
            session.operator.role !== "admin" &&
            !session.permissions?.crm?.canViewAllDeals &&
            deal.operatorId &&
            deal.operatorId !== session.operator.id
          ) {
            return new Response(
              JSON.stringify({
                error: "Acesso restrito: você não tem permissão para visualizar negociações de outros operadores.",
                code: "FORBIDDEN",
              }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          return new Response(JSON.stringify({ deal }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deal Detail API] Erro no GET:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * PATCH /api/crm/deals/:dealId
       * Atualiza negociação com concorrência otimista (etapa, status, vendedor, valor).
       * Valida permissões granulares: canMoveStages para etapas, canCloseDeals para ganho/perda, canEditDeals para outros.
       */
      PATCH: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const recordDenied = await requireCrmDealAccess(session, (params as { dealId: string }).dealId);
          if (recordDenied) return recordDenied;

          const { dealId } = params as { dealId: string };
          const body = await request.json();
          const transitionDenied = await requireCrmTransitionAccess(session, body, { dealId });
          if (transitionDenied) return transitionDenied;

          // Validações de permissões específicas
          if (body.stageId) {
            const stagePerm = requireCrmPermission(session, "canMoveStages");
            if (stagePerm) return stagePerm;
          }
          if (body.status === "won" || body.status === "lost") {
            const closePerm = requireCrmPermission(session, "canCloseDeals");
            if (closePerm) return closePerm;
          }
          if (
            body.title !== undefined ||
            body.pipelineId !== undefined ||
            body.value !== undefined ||
            body.expectedCloseDate !== undefined ||
            body.operatorId !== undefined ||
            body.ownerId !== undefined ||
            body.accountId !== undefined ||
            body.rating !== undefined ||
            body.source !== undefined ||
            body.campaign !== undefined
            || body.customFields !== undefined
          ) {
            const editPerm = requireCrmPermission(session, "canEditDeals");
            if (editPerm) return editPerm;
          }

          if (
            body.status === "open" ||
            body.status === "paused" ||
            (body.lossReason !== undefined && body.status !== "lost" && !body.stageId) ||
            body.pausedReason !== undefined ||
            (body.winReason !== undefined && body.status !== "won" && !body.stageId)
          ) {
            const denied = requireCrmPermission(session, "canEditDeals");
            if (denied) return denied;
          }

          const targetOpId = body.operatorId !== undefined ? body.operatorId : body.ownerId;

          const updated = await crmService.updateDeal(tenantId, dealId, session.operator.id, {
            title: body.title,
            pipelineId: body.pipelineId,
            stageId: body.stageId,
            status: body.status,
            value: body.value,
            expectedCloseDate:
              body.expectedCloseDate === null
                ? null
                : body.expectedCloseDate
                  ? new Date(body.expectedCloseDate)
                  : undefined,
            operatorId: targetOpId,
            accountId: body.accountId,
            rating: body.rating,
            source: body.source,
            campaign: body.campaign,
            lossReason: body.lossReason,
            pausedReason: body.pausedReason,
            winReason: body.winReason,
            expectedVersion: body.expectedVersion,
            customFields: body.customFields,
          }, session.operator.role !== "admin" && !session.permissions?.crm?.canViewAllDeals ? session.operator.id : undefined);

          return new Response(JSON.stringify({ deal: updated }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deal Detail API] Erro no PATCH:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * DELETE /api/crm/deals/:dealId
       * Envia a negociação para a lixeira (mode: "delete_trash") ou exclui permanentemente (mode: "delete_permanent").
       * Exige acesso à negociação pai (requireCrmDealAccess) + permissão explícita canDeleteDeals.
       */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const { dealId } = params as { dealId: string };

          const recordDenied = await requireCrmDealAccess(session, dealId);
          if (recordDenied) return recordDenied;

          const deleteDenied = requireCrmPermission(session, "canDeleteDeals");
          if (deleteDenied) return deleteDenied;

          const body = await request.json().catch(() => ({}));
          const mode =
            body?.mode === "delete_trash" || body?.action === "delete_trash"
              ? "delete_trash"
              : "delete_permanent";

          const authorizedPipelineIds = getAllowedPipelineIds(session) ?? undefined;
          const authorizedOperatorId =
            session.operator.role !== "admin" && !session.permissions?.crm?.canViewAllDeals
              ? session.operator.id
              : undefined;

          const result = await crmService.bulkUpdateDeals(
            tenantId,
            session.operator.id,
            {
              dealIds: [dealId],
              action: mode,
              deleteConversationIds: Array.isArray(body?.deleteConversationIds)
                ? body.deleteConversationIds
                : undefined,
              deleteContactIds: Array.isArray(body?.deleteContactIds)
                ? body.deleteContactIds
                : undefined,
              authorizedPipelineIds,
            },
            session.operator.name,
            authorizedOperatorId,
          );

          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deal Detail API] Erro no DELETE:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
