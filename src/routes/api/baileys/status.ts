import { createFileRoute } from "@tanstack/react-router";
import { SessionManager } from "../../../lib/baileys/session-manager";

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
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");

        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

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
