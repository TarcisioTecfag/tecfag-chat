import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { channelConfigs } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { clearTokenCache, isRdCrmConfigured } from "../../../lib/rdCrmService";
import { requireSession } from "../../../lib/auth-session";
import { createSignedOAuthState } from "../../../lib/auth-crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/settings/rd-crm")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // GET — Verifica se o RD CRM está configurado para o tenant da sessão
      GET: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;

          if (session.operator.role !== "admin") {
            return new Response(JSON.stringify({ error: "Permissão insuficiente.", code: "FORBIDDEN" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const tenantId = session.tenantId;
          const configured = await isRdCrmConfigured(tenantId);

          return new Response(JSON.stringify({ configured }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      // POST — Salva credenciais do RD CRM (clientId + clientSecret) e gera URL com estado assinado
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;

          if (session.operator.role !== "admin") {
            return new Response(JSON.stringify({ error: "Permissão insuficiente.", code: "FORBIDDEN" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const tenantId = session.tenantId;
          const body = await request.json();
          const { clientId, clientSecret } = body;

          if (!clientId || !clientSecret) {
            return new Response(
              JSON.stringify({ error: "clientId e clientSecret são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          await db
            .update(channelConfigs)
            .set({
              rdCrmClientId: clientId,
              rdCrmClientSecret: clientSecret,
              updatedAt: new Date(),
            })
            .where(eq(channelConfigs.tenantId, tenantId));

          clearTokenCache(tenantId);

          // Gera estado assinado criptograficamente (tenantId + operatorId + timestamp + hmac)
          const signedState = createSignedOAuthState(tenantId, session.operator.id);

          // Gera a URL de autorização oficial do RD Station (accounts.rdstation.com)
          const origin = new URL(request.url).origin;
          const redirectUri = encodeURIComponent(`${origin}/api/settings/rd-crm/callback`);
          const authUrl = `https://accounts.rdstation.com/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${redirectUri}&state=${encodeURIComponent(signedState)}`;

          return new Response(
            JSON.stringify({ success: true, authUrl }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("[RD CRM Settings] Erro POST:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
