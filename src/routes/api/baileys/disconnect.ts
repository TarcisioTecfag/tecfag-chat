import { createFileRoute } from "@tanstack/react-router";
import { SessionManager } from "../../../lib/baileys/session-manager";
import { requireSession } from "../../../lib/auth-session";
import { canManageWhatsappConnection } from "../../../lib/access-control/channel-permissions";

export const Route = createFileRoute("/api/baileys/disconnect")({
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
      POST: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          if (!canManageWhatsappConnection(session)) return Response.json({ error: "Permissão insuficiente." }, { status: 403 });

          const sessionManager = SessionManager.getInstance();
          await sessionManager.disconnectSession(session.tenantId);

          return new Response(JSON.stringify({ success: true, tenantId: session.tenantId }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
