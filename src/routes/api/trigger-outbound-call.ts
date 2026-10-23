import { createFileRoute } from "@tanstack/react-router";
import { requireSession, requirePermission } from "../../lib/auth-session";
import { triggerOutboundCallInternal } from "../../lib/voice/outbound-call-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/trigger-outbound-call")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const denied = requirePermission(session, (p) => p.views?.ligacoes === true && p.ligacoes?.canTriggerTestCall === true);
          if (denied) return denied;
          const body = await request.json().catch(() => ({}));

          if (!body.phone) {
            return jsonResponse({ error: "phone é obrigatório" }, 400);
          }

          const result = await triggerOutboundCallInternal({
            tenantId,
            phone: body.phone,
            fromPhone: session.operator.role === "admin" ? body.fromPhone : undefined,
            accountSid: session.operator.role === "admin" ? body.accountSid : undefined,
            authToken: session.operator.role === "admin" ? body.authToken : undefined,
          });

          if (!result.success) {
            return jsonResponse(result, 400);
          }

          return jsonResponse(result, 200);
        } catch (err: any) {
          console.error("[OutboundCall Endpoint] Exceção:", err?.message || err);
          return jsonResponse({ error: "Exception", message: err?.message || String(err) }, 500);
        }
      },
    },
  },
});
