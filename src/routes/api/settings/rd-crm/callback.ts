import { createFileRoute } from "@tanstack/react-router";
import { exchangeCodeForTokens, clearTokenCache } from "../../../../lib/rdCrmService";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/settings/rd-crm/callback")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state") || "valem"; // state preserva o tenantId

        if (!code) {
          return new Response(
            `<html><body><h2>Erro na conexão com o RD CRM</h2><p>Código de autorização (code) não fornecido.</p><a href="/">Voltar</a></body></html>`,
            { status: 400, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } }
          );
        }

        try {
          // A redirect URI enviada na troca do token deve ser a mesma cadastrada e usada no login
          const redirectUri = `${url.origin}/api/settings/rd-crm/callback`;
          
          await exchangeCodeForTokens(state, code, redirectUri);
          clearTokenCache(state);

          // Redireciona para o painel principal com query param de conectado
          return new Response(null, {
            status: 302,
            headers: {
              ...corsHeaders,
              Location: `/?rd_crm_connected=true`,
            },
          });
        } catch (e: any) {
          console.error("[RD CRM Callback] Erro ao trocar tokens:", e.message);
          return new Response(
            `<html><body><h2>Erro na conexão com o RD CRM</h2><p>${e.message}</p><a href="/">Voltar</a></body></html>`,
            { status: 500, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } }
          );
        }
      },
    },
  },
});
