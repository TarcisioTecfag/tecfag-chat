import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { listRdDiagnostics } from "../../../../lib/rd-marketing/diagnostic-store";
import { integrationError } from "../../../../lib/rd-marketing/http";

export const Route = createFileRoute("/api/settings/rd-marketing/diagnostics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin")
          return Response.json(
            { error: "Permissão insuficiente.", code: "FORBIDDEN" },
            { status: 403 },
          );
        try {
          const flowId = new URL(request.url).searchParams.get("flowId") || undefined;
          return Response.json(
            { samples: await listRdDiagnostics(tenantId, flowId) },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (error) {
          return integrationError(error);
        }
      },
    },
  },
});
