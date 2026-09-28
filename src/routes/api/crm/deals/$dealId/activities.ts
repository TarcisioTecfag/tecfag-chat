import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../../lib/auth-session";
import { crmService } from "../../../../../lib/crm/crm-service";

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
       * POST /api/crm/deals/:dealId/activities
       * Cria uma nova nota ou tarefa comercial associada à negociação.
       */
      POST: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const { dealId } = params as { dealId: string };
          const body = await request.json();

          if (!body.title || !body.type) {
            return new Response(
              JSON.stringify({ error: "Título e tipo de atividade são obrigatórios." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

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
          return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
