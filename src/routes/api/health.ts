import { createFileRoute } from "@tanstack/react-router";
import { readinessResponse } from "../../lib/readiness";

/**
 * GET /api/health
 * Endpoint de health check usado pelo Railway para verificar se o servidor
 * está pronto antes de redirecionar tráfego, evitando conflito 440 do WhatsApp
 * quando duas instâncias ficam ativas ao mesmo tempo durante o deploy.
 * Em desenvolvimento/teste, inclui o nome do banco conectado para prova de isolamento.
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        return readinessResponse();
      },
    },
  },
});
