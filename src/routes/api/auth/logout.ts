import { createFileRoute } from "@tanstack/react-router";
import { extractSessionToken, revokeSessionByToken, buildLogoutCookie } from "../../../lib/auth-session.js";

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const token = extractSessionToken(request);
          if (token) {
            await revokeSessionByToken(token);
          }

          const logoutCookie = buildLogoutCookie();

          return new Response(
            JSON.stringify({ success: true, message: "Sessão encerrada com sucesso." }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Set-Cookie": logoutCookie,
              },
            }
          );
        } catch (e: any) {
          console.error("[Logout API] Erro ao encerrar sessão:", e);
          const logoutCookie = buildLogoutCookie();
          return new Response(
            JSON.stringify({ success: false, error: "Erro ao encerrar sessão." }),
            {
              status: 500,
              headers: {
                "Content-Type": "application/json",
                "Set-Cookie": logoutCookie,
              },
            }
          );
        }
      },
    },
  },
});
