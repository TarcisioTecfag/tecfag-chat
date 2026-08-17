import { createFileRoute } from "@tanstack/react-router";

// Registra a data/hora de inicialização do processo Node do servidor.
// Cada novo deploy no Railway reinicia a aplicação e gera um novo SERVER_BOOT_TIME.
const SERVER_BOOT_TIME = new Date().toISOString();

/**
 * GET /api/version
 * Endpoint leve de verificação de versão/deploy da aplicação.
 * Retorna o ID de deployment do Railway ou a marca temporal de boot do servidor.
 */
export const Route = createFileRoute("/api/version")({
  server: {
    handlers: {
      GET: async () => {
        const deploymentId =
          process.env.RAILWAY_DEPLOYMENT_ID ||
          process.env.RAILWAY_GIT_COMMIT_SHA ||
          process.env.BUILD_ID ||
          SERVER_BOOT_TIME;

        return new Response(
          JSON.stringify({
            version: deploymentId,
            timestamp: SERVER_BOOT_TIME,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            },
          }
        );
      },
    },
  },
});
