import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../lib/crm/crm-service";

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
       * Exige canViewCrm e respeita canViewAllDeals.
       */
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canViewCrm");
          if (permError) return permError;

          const { dealId } = params as { dealId: string };
          const deal = await crmService.getDealById(tenantId, dealId);

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

          const { dealId } = params as { dealId: string };
          const body = await request.json();

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

          const targetOpId = body.operatorId !== undefined ? body.operatorId : body.ownerId;

          const updated = await crmService.updateDeal(tenantId, dealId, session.operator.id, {
            title: body.title,
            stageId: body.stageId,
            status: body.status,
            value: body.value,
            expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : undefined,
            operatorId: targetOpId,
            accountId: body.accountId,
            rating: body.rating,
            source: body.source,
            campaign: body.campaign,
            lossReason: body.lossReason,
            pausedReason: body.pausedReason,
            expectedVersion: body.expectedVersion,
            customFields: body.customFields,
          });

          return new Response(JSON.stringify({ deal: updated }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deal Detail API] Erro no PATCH:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
