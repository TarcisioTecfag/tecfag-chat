import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../lib/crm/crm-service";
import { recordCrmAction } from "../../../../lib/crm/action-history";
import { db } from "../../../../db";
import { crmAccounts } from "../../../../db/schema";
import { and, eq } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/accounts/$accountId")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/accounts/:accountId
       * Ficha detalhada do cliente/conta: dados cadastrais, contatos vinculados (1:N),
       * negociações associadas, atendimentos vinculados e histórico de alterações.
       */
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canViewCrm");
          if (permError) return permError;

          const { accountId } = params as any;
          const result = await crmService.getAccountById(tenantId, accountId);

          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Account Detail API] Erro no GET:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * PATCH /api/crm/accounts/:accountId
       * Atualiza dados da conta compradora com validação estrita de documento e isolamento.
       */
      PATCH: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          const { accountId } = params as any;
          const body = await request.json();

          const updated = await crmService.updateAccount(tenantId, accountId, {
            name: body.name,
            tradeName: body.tradeName,
            segment: body.segment,
            type: body.type,
            document: body.document,
            email: body.email,
            phone: body.phone,
            website: body.website,
            address: body.address,
            customFields: body.customFields,
            notes: body.notes,
          });

          return new Response(JSON.stringify({ account: updated }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Account Detail API] Erro no PATCH:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * DELETE /api/crm/accounts/:accountId
       * Arquivamento suave da conta compradora (preserva histórico referencial).
       */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          const { accountId } = params as any;
          const [account] = await db.select({ name: crmAccounts.name }).from(crmAccounts)
            .where(and(eq(crmAccounts.id, accountId), eq(crmAccounts.tenantId, tenantId))).limit(1);
          const result = await crmService.archiveAccount(tenantId, accountId);
          await recordCrmAction({ tenantId, operatorId: session.operator.id,
            operatorName: session.operator.name, action: "archive_account", entityType: "account",
            itemCount: 1, details: { accountId, name: account?.name || accountId } });

          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Account Detail API] Erro no DELETE:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
