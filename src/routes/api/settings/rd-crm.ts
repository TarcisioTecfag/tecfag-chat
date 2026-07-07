import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { channelConfigs } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { exchangeCodeForTokens, clearTokenCache, isRdCrmConfigured } from "../../../lib/rdCrmService";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/settings/rd-crm")(({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // GET — Verifica se o RD CRM está configurado para o tenant
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const code = url.searchParams.get("code");

        // ─── OAuth Callback: recebe o code do RD Station ─────────────────────
        if (code) {
          const tenant = tenantId || "valem"; // fallback para valem (tenant default)
          try {
            const redirectUri = `${url.origin}/api/settings/rd-crm`;
            await exchangeCodeForTokens(tenant, code, redirectUri);
            clearTokenCache(tenant);

            // Redireciona para a página principal com mensagem de sucesso
            return new Response(null, {
              status: 302,
              headers: {
                ...corsHeaders,
                Location: `/?rd_crm_connected=true`,
              },
            });
          } catch (e: any) {
            console.error("[RD CRM Callback] Erro:", e.message);
            return new Response(
              `<html><body><h2>Erro na conexão com o RD CRM</h2><p>${e.message}</p><a href="/">Voltar</a></body></html>`,
              { status: 500, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } }
            );
          }
        }

        // ─── Verificação de status ───────────────────────────────────────────
        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
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

      // POST — Salva credenciais do RD CRM (clientId + clientSecret)
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId, clientId, clientSecret } = body;

          if (!tenantId || !clientId || !clientSecret) {
            return new Response(
              JSON.stringify({ error: "tenantId, clientId e clientSecret são obrigatórios" }),
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

          // Gera a URL de autorização OAuth2 para o usuário clicar
          const origin = new URL(request.url).origin;
          const redirectUri = encodeURIComponent(`${origin}/api/settings/rd-crm?tenantId=${tenantId}`);
          const authUrl = `https://crm.rdstation.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}`;

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
}));
