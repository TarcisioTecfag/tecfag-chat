import { createFileRoute } from "@tanstack/react-router";
import { SessionManager } from "../../../lib/baileys/session-manager";
import { requireSession } from "../../../lib/auth-session";

export const Route = createFileRoute("/api/baileys/status")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      },
      GET: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const session = auth.session;

        const url = new URL(request.url);
        const requestedTenant = url.searchParams.get("tenantId");

        if (requestedTenant && requestedTenant !== session.tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const tenantId = session.tenantId;
        const sessionManager = SessionManager.getInstance();
        const status = sessionManager.getStatus(tenantId);
        const qr = sessionManager.getQr(tenantId);
        const sock = sessionManager.getSession(tenantId);
        const pairedPhone = sock?.user?.id ? sock.user.id.split(":")[0] : null;

        return new Response(JSON.stringify({ status, qr, pairedPhone }), {
          headers: { 
            ...corsHeaders,
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          },
        });
      },
    },
  },
});
