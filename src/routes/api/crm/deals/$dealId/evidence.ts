import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../../lib/auth-session";
import { crmService } from "../../../../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals/$dealId/evidence")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/deals/:dealId/evidence
       * Lista mensagens marcadas como evidência comercial para esta negociação.
       */
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const { dealId } = params as { dealId: string };
          const evidences = await crmService.getDealEvidenceMessages(tenantId, dealId);

          return new Response(JSON.stringify({ evidences }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deal Evidence API] Erro no GET:", err);
          return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      /**
       * POST /api/crm/deals/:dealId/evidence
       * Marca uma mensagem como evidência comercial na negociação.
       */
      POST: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const { dealId } = params as { dealId: string };
          const body = await request.json();

          if (!body.messageId) {
            return new Response(
              JSON.stringify({ error: "ID da mensagem (messageId) é obrigatório." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const evidence = await crmService.markMessageAsEvidence(
            tenantId,
            dealId,
            body.messageId,
            session.operator.id,
            body.note,
            body.activityId
          );

          return new Response(JSON.stringify({ evidence }), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deal Evidence API] Erro no POST:", err);
          return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      /**
       * DELETE /api/crm/deals/:dealId/evidence
       * Remove marcação de evidência comercial.
       */
      DELETE: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const { dealId } = params as { dealId: string };
          const url = new URL(request.url);
          let evidenceId = url.searchParams.get("evidenceId");
          if (!evidenceId) {
            try {
              const body = await request.json();
              evidenceId = body?.evidenceId;
            } catch {}
          }

          if (!evidenceId) {
            return new Response(
              JSON.stringify({ error: "ID da evidência (evidenceId) é obrigatório." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const success = await crmService.unmarkMessageEvidence(
            tenantId,
            dealId,
            evidenceId,
            session.operator.id
          );

          return new Response(JSON.stringify({ success }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[CRM Deal Evidence API] Erro no DELETE:", err);
          return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
