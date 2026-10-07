import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../lib/auth-session";
import { getCommercialBi } from "../../../lib/commercial/bi-service";

export const Route = createFileRoute("/api/commercial/bi")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin") {
          return Response.json(
            { error: "Permissão insuficiente.", code: "FORBIDDEN" },
            { status: 403 },
          );
        }
        const divisionParam = new URL(request.url).searchParams.get("division");
        if (divisionParam && divisionParam !== "personnalite" && divisionParam !== "maquinas") {
          return Response.json({ error: "Divisão inválida." }, { status: 400 });
        }
        const division = divisionParam as "personnalite" | "maquinas" | null;
        try {
          return Response.json(await getCommercialBi(tenantId, division));
        } catch (error) {
          console.error("[commercial/bi] GET:", error);
          return Response.json({ error: "Falha ao calcular o BI comercial." }, { status: 500 });
        }
      },
    },
  },
});
