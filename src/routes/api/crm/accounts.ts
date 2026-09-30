import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../lib/auth-session";
import { requireCrmPermission } from "../../../lib/rbac";
import { crmService, handleCrmError } from "../../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/accounts")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/accounts
       * Busca/listagem paginada de clientes/contas PF e PJ do tenant.
       * Query params: search, document, type, limit, offset
       */
      GET: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canViewCrm");
          if (permError) return permError;

          const url = new URL(request.url);
          const search = url.searchParams.get("search") || undefined;
          const document = url.searchParams.get("document") || undefined;
          const type = (url.searchParams.get("type") as "person" | "company") || undefined;
          const segment = url.searchParams.get("segment") || undefined;
          const limit = parseInt(url.searchParams.get("limit") || "50", 10);
          const offset = parseInt(url.searchParams.get("offset") || "0", 10);

          const result = await crmService.getAccounts(tenantId, {
            search,
            document,
            type,
            segment,
            limit,
            offset,
          });

          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Accounts API] Erro no GET:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * POST /api/crm/accounts
       * Cadastra uma nova conta compradora PF ou PJ.
       */
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canCreateDeals");
          if (permError) return permError;

          const body = await request.json();
          if (!body.name || !body.name.trim()) {
            return new Response(
              JSON.stringify({ error: "O nome ou razão social é obrigatório.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const account = await crmService.createAccount(tenantId, {
            name: body.name,
            type: body.type,
            tradeName: body.tradeName,
            segment: body.segment,
            document: body.document,
            email: body.email,
            phone: body.phone,
            website: body.website,
            address: body.address,
            customFields: body.customFields,
            notes: body.notes,
            rdOrganizationId: body.rdOrganizationId,
          });

          return new Response(JSON.stringify({ account }), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Accounts API] Erro no POST:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
