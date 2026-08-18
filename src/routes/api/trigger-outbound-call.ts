import { createFileRoute } from "@tanstack/react-router";
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
          const body = await request.json().catch(() => ({}));

          if (!body.tenantId) {
            return jsonResponse({ error: "tenantId é obrigatório" }, 400);
          }
          if (!body.phone) {
            return jsonResponse({ error: "phone é obrigatório" }, 400);
          }

          const result = await triggerOutboundCallInternal({
            phone: body.phone,
            fromPhone: body.fromPhone,
            accountSid: body.accountSid,
            authToken: body.authToken,
            twimlUrl: body.twimlUrl,
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
