import { createFileRoute } from "@tanstack/react-router";
import {
  buildSessionCookie,
  createSession,
  extractSessionToken,
  requireSession,
  revokeSessionByToken,
  sanitizeOperator,
} from "../../../lib/auth-session.js";
import { getPlatformMembership } from "../../../lib/platform-access.js";

export const Route = createFileRoute("/api/auth/switch-tenant")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const body = await request.json().catch(() => ({}));
        const requestedTenant = typeof body.tenantId === "string" ? body.tenantId.trim() : "";

        // O body indica somente o destino; a autoridade vem do grupo e dos vínculos no servidor.
        if (!session.accountId || !session.availableTenants.includes(requestedTenant)) {
          return new Response(
            JSON.stringify({ error: "Acesso à empresa não autorizado.", code: "FORBIDDEN" }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        const membership = await getPlatformMembership(session.accountId, requestedTenant);
        if (!membership) {
          return new Response(
            JSON.stringify({ error: "Acesso à empresa não autorizado.", code: "FORBIDDEN" }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        if (requestedTenant === session.tenantId) {
          return Response.json({
            success: true,
            tenantId: session.tenantId,
            operator: session.operator,
            availableTenants: session.availableTenants,
          });
        }

        const { token, expiresAt } = await createSession(requestedTenant, membership.operator.id);
        const previousToken = extractSessionToken(request);
        if (previousToken) await revokeSessionByToken(previousToken);
        return new Response(
          JSON.stringify({
            success: true,
            tenantId: requestedTenant,
            operator: sanitizeOperator(membership.operator),
            availableTenants: session.availableTenants,
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": buildSessionCookie(token, expiresAt),
            },
          },
        );
      },
    },
  },
});
