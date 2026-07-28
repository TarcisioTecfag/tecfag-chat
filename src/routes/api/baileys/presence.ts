import { createFileRoute } from "@tanstack/react-router";
import { SessionManager } from "../../../lib/baileys/session-manager";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/baileys/presence")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId = "valem", jid } = body;

          if (!jid) {
            return new Response(JSON.stringify({ error: "jid é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const sessionManager = SessionManager.getInstance();
          await sessionManager.subscribePresence(tenantId, jid);

          return new Response(JSON.stringify({ success: true, jid }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[POST /api/baileys/presence] Erro:", e);
          return new Response(
            JSON.stringify({ error: "Erro ao subscrever presença", details: e?.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
