import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/health
 * Endpoint de health check usado pelo Railway para verificar se o servidor
 * está pronto antes de redirecionar tráfego, evitando conflito 440 do WhatsApp
 * quando duas instâncias ficam ativas ao mesmo tempo durante o deploy.
 */
export const Route = createFileRoute("/api/health" as any)({
  server: {
    handlers: {
      GET: async () => {
        return new Response(
          JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      },
    },
  },
});
