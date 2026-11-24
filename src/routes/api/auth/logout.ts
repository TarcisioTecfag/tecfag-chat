import { createFileRoute } from "@tanstack/react-router";
import {
  extractSessionTokens,
  getAuthSessionByToken,
  revokeSessionByToken,
  buildLogoutCookies,
  isSecureRequest,
} from "../../../lib/auth-session.js";
import { markOperatorOffline } from "../../../lib/operator-presence.js";

function buildLogoutResponseHeaders(request: Request): Headers {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const cookie of buildLogoutCookies({ secure: isSecureRequest(request) })) {
    headers.append("Set-Cookie", cookie);
  }
  return headers;
}

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const tokens = extractSessionTokens(request);
          for (const token of tokens) {
            const session = await getAuthSessionByToken(token);
            if (session) {
              await markOperatorOffline(session.tenantId, session.operator.id);
            }
            await revokeSessionByToken(token);
          }

          return new Response(
            JSON.stringify({ success: true, message: "Sessão encerrada com sucesso." }),
            {
              status: 200,
              headers: buildLogoutResponseHeaders(request),
            }
          );
        } catch (e: any) {
          console.error("[Logout API] Erro ao encerrar sessão:", e);
          return new Response(
            JSON.stringify({ success: false, error: "Erro ao encerrar sessão." }),
            {
              status: 500,
              headers: buildLogoutResponseHeaders(request),
            }
          );
        }
      },
    },
  },
});
