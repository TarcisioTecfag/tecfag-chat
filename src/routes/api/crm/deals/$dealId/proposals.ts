import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../../lib/crm/crm-service";
import { db } from "../../../../../db";
import { crmDeals } from "../../../../../db/schema";
import { eq, and } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const VALID_PROPOSAL_STATUSES = [
  "draft",
  "copied",
  "sent",
  "accepted",
  "rejected",
  "expired",
] as const;

export const Route = createFileRoute("/api/crm/deals/$dealId/proposals")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/deals/:dealId/proposals
       * Lista propostas comerciais emitidas para a negociação com validação de tenant.
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

          // Valida existência e pertencimento do Deal ao tenant
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

          const proposals = await crmService.getProposals(tenantId, dealId);

          return new Response(JSON.stringify({ proposals }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Proposals API] Erro no GET:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * POST /api/crm/deals/:dealId/proposals
       * Gera uma proposta comercial formalizada com numeração concorrente atômica
       * e snapshot dos itens persistido dentro de transação.
       */
      POST: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canManageProposals");
          if (permError) return permError;

          const { dealId } = params as { dealId: string };
          const body = await request.json();

          // Valida existência e pertencimento do Deal ao tenant
          const [deal] = await db
            .select({ id: crmDeals.id })
            .from(crmDeals)
            .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
            .limit(1);

          if (!deal) {
            return new Response(
              JSON.stringify({ error: "Negociação não encontrada ou não pertence ao seu tenant.", code: "FORBIDDEN" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const proposal = await crmService.createProposal(tenantId, dealId, session.operator.id, {
            title: body.title,
            paymentTerms: body.paymentTerms,
            deliveryTerms: body.deliveryTerms,
            validityDays: body.validityDays ? parseInt(body.validityDays, 10) : undefined,
            notes: body.notes,
          });

          return new Response(JSON.stringify({ proposal }), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Proposals API] Erro no POST:", err);
          return handleCrmError(err, corsHeaders);
        }
      },

      /**
       * PATCH /api/crm/deals/:dealId/proposals
       * Atualiza status da proposta comercial ('draft' | 'copied' | 'sent' | 'accepted' | 'rejected' | 'expired').
       */
      PATCH: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canManageProposals");
          if (permError) return permError;

          const body = await request.json();
          const { proposalId, status, metadata } = body;

          if (!proposalId || !status) {
            return new Response(JSON.stringify({ error: "proposalId e status são obrigatórios" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (!VALID_PROPOSAL_STATUSES.includes(status)) {
            return new Response(
              JSON.stringify({
                error: `Status inválido: '${status}'. Status permitidos: ${VALID_PROPOSAL_STATUSES.join(", ")}`,
              }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const proposal = await crmService.updateProposalStatus(
            tenantId,
            proposalId,
            session.operator.id,
            status,
            metadata
          );

          return new Response(JSON.stringify({ proposal }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Proposals API] Erro no PATCH:", err);
          return handleCrmError(err, corsHeaders);
        }
      },
    },
  },
});
