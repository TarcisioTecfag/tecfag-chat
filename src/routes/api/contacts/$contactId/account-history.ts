import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { crmService, handleCrmError } from "../../../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/contacts/$contactId/account-history")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/contacts/:contactId/account-history
       * Retorna o histórico de transferências/vínculos de cliente do contato.
       */
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const { contactId } = params as { contactId: string };
          const history = await crmService.getContactAccountHistory(tenantId, contactId);

          return new Response(JSON.stringify({ history }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[Contact Account History API] Erro no GET:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
