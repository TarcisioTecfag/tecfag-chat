import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals/$dealId/activities")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/deals/:dealId/activities
       * Lista atividades/tarefas de uma negociação.
       */
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canViewCrm");
          if (permError) return permError;

          const { dealId } = params as any;
          const url = new URL(request.url);
          const status = url.searchParams.get("status") as "pending" | "completed" | "cancelled" | null;
          const type = url.searchParams.get("type") || undefined;
          const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!, 10) : undefined;
          const offset = url.searchParams.get("offset") ? parseInt(url.searchParams.get("offset")!, 10) : undefined;

          const activities = await crmService.getDealActivities(tenantId, dealId, {
            status: status || undefined,
            type,
            limit,
            offset,
          });

          return new Response(JSON.stringify({ activities }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Activities API] Erro no GET:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * POST /api/crm/deals/:dealId/activities
       * Cria uma nova nota ou tarefa comercial associada à negociação.
       * Exige permissão canEditDeals.
       */
      POST: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          const { dealId } = params as { dealId: string };
          const body = await request.json();

          const activity = await crmService.createDealActivity(
            tenantId,
            dealId,
            session.operator.id,
            {
              type: body.type,
              title: body.title,
              description: body.description,
              dueDate: body.dueDate ? new Date(body.dueDate) : null,
              conversationId: body.conversationId || null,
              assignedToOperatorId: body.assignedToOperatorId || session.operator.id,
            }
          );

          return new Response(JSON.stringify({ activity }), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Activities API] Erro no POST:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
