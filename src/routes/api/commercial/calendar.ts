import { createFileRoute } from "@tanstack/react-router";
import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "../../../db";
import { commercialCalendarDays } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { saoPauloDay } from "../../../lib/commercial/metrics";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const isMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const isDay = (value: string) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
  && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

export const Route = createFileRoute("/api/commercial/calendar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin") return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        const month = new URL(request.url).searchParams.get("month") || saoPauloDay().slice(0, 7);
        if (!isMonth(month)) return json({ error: "Mês inválido." }, 400);
        const [year, monthNumber] = month.split("-").map(Number);
        const nextMonth = `${monthNumber === 12 ? year + 1 : year}-${String(monthNumber === 12 ? 1 : monthNumber + 1).padStart(2, "0")}-01`;
        try {
          const days = await db.select().from(commercialCalendarDays)
            .where(and(eq(commercialCalendarDays.tenantId, tenantId), gte(commercialCalendarDays.date, `${month}-01`), lt(commercialCalendarDays.date, nextMonth)))
            .orderBy(commercialCalendarDays.date);
          return json({ month, days });
        } catch (error) {
          console.error("[commercial/calendar] GET:", error);
          return json({ error: "Falha ao listar o calendário comercial." }, 500);
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
          const date = typeof body.date === "string" ? body.date : "";
          const type = body.type;
          const description = typeof body.description === "string" ? body.description.trim() : "";
          if (!isDay(date) || !["holiday", "bridge", "extra_work", "suspension"].includes(type)
            || !description || description.length > 200 || typeof body.affectsGoal !== "boolean") {
            return json({ error: "Data, tipo, descrição e impacto na meta são obrigatórios." }, 400);
          }
          const [day] = await db.insert(commercialCalendarDays).values({
            id: crypto.randomUUID(), tenantId, date, type, description,
            affectsGoal: body.affectsGoal, createdByOperatorId: session.operator.id,
          }).onConflictDoUpdate({
            target: [commercialCalendarDays.tenantId, commercialCalendarDays.date],
            set: { type, description, affectsGoal: body.affectsGoal, createdByOperatorId: session.operator.id },
          }).returning();
          return json({ day });
        } catch (error) {
          console.error("[commercial/calendar] POST:", error);
          return json({ error: "Falha ao salvar o dia comercial." }, 500);
        }
      },
      DELETE: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin") return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        const date = new URL(request.url).searchParams.get("date") || "";
        if (!isDay(date)) return json({ error: "Data inválida." }, 400);
        try {
          const [deleted] = await db.delete(commercialCalendarDays)
            .where(and(eq(commercialCalendarDays.tenantId, tenantId), eq(commercialCalendarDays.date, date)))
            .returning({ id: commercialCalendarDays.id });
          return deleted ? json({ deleted: true }) : json({ error: "Dia não encontrado neste tenant." }, 404);
        } catch (error) {
          console.error("[commercial/calendar] DELETE:", error);
          return json({ error: "Falha ao remover o dia comercial." }, 500);
        }
      },
    },
  },
});
