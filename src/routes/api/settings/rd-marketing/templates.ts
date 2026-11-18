import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { createMetaTemplate } from "../../../../lib/whatsapp/meta-templates";

export const Route = createFileRoute("/api/settings/rd-marketing/templates")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin")
          return Response.json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, { status: 403 });
        
        try {
          const body = await request.json();
          const result = await createMetaTemplate(tenantId, body);
          return Response.json(result, { status: 201 });
        } catch (error: any) {
          return Response.json({ error: error.message }, { status: 400 });
        }
      },
    },
  },
});
