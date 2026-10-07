import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../lib/auth-session";
import { requireCrmPermission } from "../../../lib/rbac";
import { getCommercialHome } from "../../../lib/commercial/home-service";

export const Route = createFileRoute("/api/commercial/home")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const permError = requireCrmPermission(session, "canViewCrm");
        if (permError) return permError;

        try {
          const home = await getCommercialHome(tenantId, session.operator.id);
          return new Response(JSON.stringify(home), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (error) {
          console.error("[commercial/home] Falha ao carregar dados:", error);
          return new Response(
            JSON.stringify({ error: "Não foi possível carregar o início comercial." }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      },
    },
  },
});
