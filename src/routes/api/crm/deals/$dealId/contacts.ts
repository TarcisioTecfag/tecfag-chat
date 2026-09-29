import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals/$dealId/contacts")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/deals/:dealId/contacts
       * Lista os contatos participantes de uma negociação.
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
          const contacts = await crmService.getDealContacts(tenantId, dealId);

          return new Response(JSON.stringify({ contacts }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deal Contacts API] Erro no GET:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * POST /api/crm/deals/:dealId/contacts
       * Adiciona um contato como participante da negociação com papel comercial e flag primário.
       */
      POST: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          const { dealId } = params as any;
          const body = await request.json();

          if (!body.contactId) {
            return new Response(
              JSON.stringify({ error: "O contactId é obrigatório.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const contacts = await crmService.addDealContact(
            tenantId,
            dealId,
            body.contactId,
            body.role || "buyer",
            body.isPrimary || false
          );

          return new Response(JSON.stringify({ contacts }), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deal Contacts API] Erro no POST:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * PATCH /api/crm/deals/:dealId/contacts
       * Atualiza o papel comercial ou define um participante como principal.
       * Body: { contactId: string, role?: string, isPrimary?: boolean }
       */
      PATCH: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          const { dealId } = params as any;
          const body = await request.json();

          if (!body.contactId) {
            return new Response(
              JSON.stringify({ error: "O contactId é obrigatório.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          let contacts;
          if (body.isPrimary) {
            contacts = await crmService.setPrimaryDealContact(tenantId, dealId, body.contactId);
          } else if (body.role) {
            contacts = await crmService.addDealContact(tenantId, dealId, body.contactId, body.role, false);
          } else {
            contacts = await crmService.getDealContacts(tenantId, dealId);
          }

          return new Response(JSON.stringify({ contacts }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deal Contacts API] Erro no PATCH:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * DELETE /api/crm/deals/:dealId/contacts
       * Remove um participante da negociação.
       * Query: ?contactId=...
       */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          const { dealId } = params as any;
          const url = new URL(request.url);
          const contactId = url.searchParams.get("contactId");

          if (!contactId) {
            return new Response(
              JSON.stringify({ error: "O contactId é obrigatório via query param.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const contacts = await crmService.removeDealContact(tenantId, dealId, contactId);

          return new Response(JSON.stringify({ contacts }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deal Contacts API] Erro no DELETE:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
