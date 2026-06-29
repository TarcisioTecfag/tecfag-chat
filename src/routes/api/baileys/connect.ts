import { createFileRoute } from "@tanstack/react-router";
import { SessionManager } from "../../../lib/baileys/session-manager";

export const Route = createFileRoute("/api/baileys/connect")({
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

        const stream = new ReadableStream({
          start(controller) {
            const listener = (event: any) => {
              try {
                controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
              } catch (e) {
                console.error("Erro ao enfileirar dados no stream SSE:", e);
              }
            };

            sessionManager.registerListener(tenantId, listener);

            sessionManager.initSession(tenantId).catch((err) => {
              console.error("Erro ao inicializar sessão Baileys:", err);
              try {
                controller.enqueue(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
              } catch (e) {}
            });

            request.signal.addEventListener("abort", () => {
              console.log(`Cliente fechou conexão SSE para o tenant ${tenantId}`);
              sessionManager.unregisterListener(tenantId, listener);
            });
          },
        });

        return new Response(stream, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      },
    },
  },
});
