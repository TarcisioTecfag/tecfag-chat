import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../../lib/crm/crm-service";
import { db } from "../../../../../db";
import { crmDeals } from "../../../../../db/schema";
import { eq, and } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals/$dealId/questionnaires")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/deals/:dealId/questionnaires
       * Lista os questionários/briefings respondidos da negociação.
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

          const [deal] = await db
            .select({ id: crmDeals.id })
            .from(crmDeals)
            .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
            .limit(1);

          if (!deal) {
            return new Response(
              JSON.stringify({ error: "Negociação não encontrada para este tenant.", code: "NOT_FOUND" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const questionnaires = await crmService.getDealQuestionnaires(tenantId, dealId);

          return new Response(JSON.stringify({ questionnaires }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (error) {
          return handleCrmError(error, corsHeaders);
        }
      },

      /**
       * POST /api/crm/deals/:dealId/questionnaires
       * Salva um questionário de qualificação técnica ou briefing comercial.
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
          const body = await request.json().catch(() => ({}));

          if (!body.formTitle || typeof body.formTitle !== "string" || !body.formTitle.trim()) {
            return new Response(
              JSON.stringify({ error: "Título do formulário (formTitle) é obrigatório.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (!Array.isArray(body.answers) || body.answers.length === 0) {
            return new Response(
              JSON.stringify({ error: "Lista de respostas (answers) é obrigatória e deve conter ao menos 1 item.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const questionnaire = await crmService.saveDealQuestionnaire(
            tenantId,
            dealId,
            session.operator.id,
            {
              formTitle: body.formTitle,
              version: typeof body.version === "number" ? body.version : 1,
              answers: body.answers,
              contactId: body.contactId || null,
            }
          );

          return new Response(JSON.stringify({ questionnaire, message: "Questionário salvo com sucesso." }), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (error) {
          return handleCrmError(error, corsHeaders);
        }
      },
    },
  },
});
