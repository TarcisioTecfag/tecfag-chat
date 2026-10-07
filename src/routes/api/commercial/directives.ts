import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../../db";
import { commercialDirectives, crmDeals, operators } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { saoPauloDay } from "../../../lib/commercial/metrics";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/commercial/directives")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin") return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        try {
          const directives = await db.select({
            id: commercialDirectives.id,
            dealId: commercialDirectives.dealId,
            dealTitle: crmDeals.title,
            assignedToOperatorId: commercialDirectives.assignedToOperatorId,
            assignedDate: commercialDirectives.assignedDate,
            priority: commercialDirectives.priority,
            instruction: commercialDirectives.instruction,
            status: commercialDirectives.status,
            createdAt: commercialDirectives.createdAt,
          })
            .from(commercialDirectives)
            .innerJoin(crmDeals, and(eq(crmDeals.id, commercialDirectives.dealId), eq(crmDeals.tenantId, tenantId)))
            .where(eq(commercialDirectives.tenantId, tenantId))
            .orderBy(desc(commercialDirectives.assignedDate))
            .limit(100);
          return json({ directives });
        } catch (error) {
          console.error("[commercial/directives] GET:", error);
          return json({ error: "Falha ao listar diretrizes." }, 500);
        }
      },
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin") return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        try {
          const body = await request.json();
          const dealId = typeof body.dealId === "string" ? body.dealId.trim() : "";
          const assignedToOperatorId = typeof body.assignedToOperatorId === "string" ? body.assignedToOperatorId.trim() : "";
          const assignedDate = typeof body.assignedDate === "string" ? body.assignedDate : saoPauloDay();
          const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
          const priority = body.priority || "normal";
          if (!dealId || !assignedToOperatorId || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(assignedDate) ||
            !instruction || instruction.length > 2000 || !["normal", "high", "critical"].includes(priority)) {
            return json({ error: "Negociação, consultor, data, prioridade e instrução válidos são obrigatórios." }, 400);
          }
          const [[deal], [operator]] = await Promise.all([
            db.select({ id: crmDeals.id, status: crmDeals.status }).from(crmDeals)
              .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, dealId))).limit(1),
            db.select({ id: operators.id }).from(operators)
              .where(and(eq(operators.tenantId, tenantId), eq(operators.id, assignedToOperatorId))).limit(1),
          ]);
          if (!deal || !operator) return json({ error: "Negociação ou consultor não encontrado neste tenant." }, 404);
          if (deal.status !== "open") return json({ error: "A diretriz exige uma negociação aberta." }, 409);
          const [directive] = await db.insert(commercialDirectives).values({
            id: crypto.randomUUID(), tenantId, dealId, assignedToOperatorId,
            assignedByOperatorId: session.operator.id, assignedDate, instruction, priority,
          }).onConflictDoNothing({ target: [commercialDirectives.tenantId, commercialDirectives.dealId, commercialDirectives.assignedDate] }).returning();
          if (!directive) return json({ error: "Já existe uma diretriz para esta negociação nesta data." }, 409);
          return json({ directive }, 201);
        } catch (error) {
          console.error("[commercial/directives] POST:", error);
          return json({ error: "Falha ao criar diretriz." }, 500);
        }
      },
    },
  },
});
