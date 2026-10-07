import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import { commercialGoals, operators } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { saoPauloDay } from "../../../lib/commercial/metrics";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/commercial/goals")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin") return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        const month = new URL(request.url).searchParams.get("month") || saoPauloDay().slice(0, 7);
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({ error: "Mês inválido." }, 400);
        try {
          const goals = await db.select({
            id: commercialGoals.id,
            operatorId: commercialGoals.operatorId,
            operatorName: operators.name,
            targetValue: commercialGoals.targetValue,
            conversionRate: commercialGoals.conversionRate,
          })
            .from(commercialGoals)
            .innerJoin(operators, and(eq(operators.id, commercialGoals.operatorId), eq(operators.tenantId, tenantId)))
            .where(and(eq(commercialGoals.tenantId, tenantId), eq(commercialGoals.month, month)))
            .orderBy(operators.name);
          return json({ month, goals });
        } catch (error) {
          console.error("[commercial/goals] GET:", error);
          return json({ error: "Falha ao listar metas." }, 500);
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
          const month = typeof body.month === "string" ? body.month : "";
          const operatorId = typeof body.operatorId === "string" ? body.operatorId.trim() : "";
          const targetValue = Number(body.targetValue);
          const conversionRate = Number(body.conversionRate);
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !operatorId ||
            body.targetValue === "" || body.targetValue === null || body.targetValue === undefined ||
            body.conversionRate === "" || body.conversionRate === null || body.conversionRate === undefined ||
            !Number.isFinite(targetValue) || targetValue < 0 || targetValue > 999_999_999_999 ||
            !Number.isFinite(conversionRate) || conversionRate < 0 || conversionRate > 100) {
            return json({ error: "Mês, consultor, meta ou conversão inválidos." }, 400);
          }
          const [operator] = await db.select({ id: operators.id }).from(operators)
            .where(and(eq(operators.tenantId, tenantId), eq(operators.id, operatorId))).limit(1);
          if (!operator) return json({ error: "Operador não encontrado neste tenant." }, 404);
          const [goal] = await db.insert(commercialGoals).values({
            id: crypto.randomUUID(), tenantId, month, operatorId,
            targetValue: targetValue.toFixed(2), conversionRate: conversionRate.toFixed(2),
            createdByOperatorId: session.operator.id,
          }).onConflictDoUpdate({
            target: [commercialGoals.tenantId, commercialGoals.month, commercialGoals.operatorId],
            set: { targetValue: targetValue.toFixed(2), conversionRate: conversionRate.toFixed(2), updatedAt: new Date() },
          }).returning();
          return json({ goal });
        } catch (error) {
          console.error("[commercial/goals] POST:", error);
          return json({ error: "Falha ao salvar meta." }, 500);
        }
      },
    },
  },
});
