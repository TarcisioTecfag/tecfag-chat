import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { db } from "../../../db";
import { crmActionHistory } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";

export const Route = createFileRoute("/api/crm/action-history")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        if (session.operator.role !== "admin") {
          return Response.json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, { status: 403 });
        }

        const url = new URL(request.url);
        const kind = url.searchParams.get("kind");
        const offset = Number(url.searchParams.get("offset") || 0);
        if (kind && !["deletion", "bulk", "export"].includes(kind)) {
          return Response.json({ error: "Filtro inválido." }, { status: 400 });
        }
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
          return Response.json({ error: "Página inválida." }, { status: 400 });
        }

        try {
          const rows = await db.select().from(crmActionHistory)
            .where(and(
              eq(crmActionHistory.tenantId, session.tenantId),
              kind === "export" ? eq(crmActionHistory.action, "export") : undefined,
              kind === "deletion" ? or(like(crmActionHistory.action, "delete_%"), like(crmActionHistory.action, "archive_%")) : undefined,
              kind === "bulk" ? inArray(crmActionHistory.action, ["bulk_update", "create_deals_for_companies", "create_tasks", "bulk_voice_appointments", "reset_tenant"]) : undefined,
            ))
            .orderBy(desc(crmActionHistory.createdAt), desc(crmActionHistory.id))
            .limit(51).offset(offset);
          return Response.json({ entries: rows.slice(0, 50), hasMore: rows.length > 50 });
        } catch (error) {
          console.error("[CRM Action History] Erro ao consultar:", error);
          return Response.json({ error: "Não foi possível carregar o histórico." }, { status: 500 });
        }
      },
    },
  },
});
