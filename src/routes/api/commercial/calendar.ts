import { createFileRoute } from "@tanstack/react-router";
import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "../../../db";
import {
  commercialCalendarDays,
  commercialConsultantProfiles,
  commercialGoals,
  crmDeals,
  operators,
} from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { saoPauloDay } from "../../../lib/commercial/metrics";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const isMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const isDay = (value: string) =>
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
  new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

export const Route = createFileRoute("/api/commercial/calendar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin")
          return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        const month = new URL(request.url).searchParams.get("month") || saoPauloDay().slice(0, 7);
        if (!isMonth(month)) return json({ error: "Mês inválido." }, 400);
        const [year, monthNumber] = month.split("-").map(Number);
        const nextMonth = `${monthNumber === 12 ? year + 1 : year}-${String(monthNumber === 12 ? 1 : monthNumber + 1).padStart(2, "0")}-01`;
        try {
          const [days, wonDeals, goalRows, operatorRows] = await Promise.all([
            db
              .select()
              .from(commercialCalendarDays)
              .where(
                and(
                  eq(commercialCalendarDays.tenantId, tenantId),
                  gte(commercialCalendarDays.date, `${month}-01`),
                  lt(commercialCalendarDays.date, nextMonth),
                ),
              )
              .orderBy(commercialCalendarDays.date),
            db
              .select({
                id: crmDeals.id,
                title: crmDeals.title,
                value: crmDeals.value,
                closedAt: crmDeals.closedAt,
                operatorId: crmDeals.operatorId,
                operatorName: operators.name,
                operatorAvatar: operators.avatar,
                division: commercialConsultantProfiles.division,
                rdDealId: crmDeals.rdDealId,
                rdDealUrl: crmDeals.rdDealUrl,
              })
              .from(crmDeals)
              .leftJoin(
                commercialConsultantProfiles,
                and(
                  eq(commercialConsultantProfiles.operatorId, crmDeals.operatorId),
                  eq(commercialConsultantProfiles.tenantId, tenantId),
                ),
              )
              .leftJoin(
                operators,
                and(eq(operators.id, crmDeals.operatorId), eq(operators.tenantId, tenantId)),
              )
              .where(
                and(
                  eq(crmDeals.tenantId, tenantId),
                  eq(crmDeals.status, "won"),
                  gte(crmDeals.closedAt, new Date(`${month}-01T00:00:00Z`)),
                  lt(crmDeals.closedAt, new Date(`${nextMonth}T03:00:00Z`)),
                ),
              ),
            db
              .select()
              .from(commercialGoals)
              .where(
                and(
                  eq(commercialGoals.tenantId, tenantId),
                  eq(commercialGoals.month, month),
                ),
              ),
            db
              .select({
                operatorId: operators.id,
                name: operators.name,
                email: operators.email,
                avatar: operators.avatar,
                division: commercialConsultantProfiles.division,
                activeOnTv: commercialConsultantProfiles.activeOnTv,
              })
              .from(operators)
              .leftJoin(
                commercialConsultantProfiles,
                and(
                  eq(commercialConsultantProfiles.operatorId, operators.id),
                  eq(commercialConsultantProfiles.tenantId, tenantId),
                ),
              )
              .where(eq(operators.tenantId, tenantId))
              .orderBy(operators.name),
          ]);

          const closingMap = new Map<
            string,
            Array<{
              id: string;
              title: string;
              value: number;
              operatorId: string | null;
              operatorName: string;
              operatorAvatar: string | null;
              division: string | null;
              rdDealId: string | null;
              rdDealUrl: string | null;
            }>
          >();

          for (const deal of wonDeals) {
            if (!deal.closedAt) continue;
            const date = saoPauloDay(deal.closedAt);
            if (date.slice(0, 7) !== month) continue;
            closingMap.set(date, [
              ...(closingMap.get(date) || []),
              {
                id: deal.id,
                title: deal.title,
                value: Number(deal.value || 0),
                operatorId: deal.operatorId,
                operatorName: deal.operatorName || "Consultor",
                operatorAvatar: deal.operatorAvatar || null,
                division: deal.division || null,
                rdDealId: deal.rdDealId || null,
                rdDealUrl: deal.rdDealUrl || null,
              },
            ]);
          }

          const closings = [...closingMap].map(([date, deals]) => ({
            date,
            count: deals.length,
            value: deals.reduce((total, deal) => total + deal.value, 0),
            deals,
          }));

          const today = saoPauloDay();
          const overrides = new Map(
            days.filter((d) => d.affectsGoal).map((d) => [d.date, d.type]),
          );
          const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
          let businessDays = 0;
          let elapsedDays = 0;
          const isCurrentMonth = month === today.slice(0, 7);
          const isPastMonth = month < today.slice(0, 7);

          for (let day = 1; day <= lastDay; day += 1) {
            const dateStr = `${month}-${String(day).padStart(2, "0")}`;
            const weekday = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
            const override = overrides.get(dateStr);
            const isBusinessDay =
              override === "extra_work" || (weekday !== 0 && weekday !== 6 && !override);
            if (!isBusinessDay) continue;
            businessDays += 1;
            if (isPastMonth) {
              elapsedDays += 1;
            } else if (isCurrentMonth && dateStr <= today) {
              elapsedDays += 1;
            }
          }
          const remainingDays = Math.max(0, businessDays - elapsedDays);

          const totalTarget = goalRows.reduce((acc, g) => acc + Number(g.targetValue || 0), 0);
          const totalRealized = wonDeals.reduce((acc, d) => acc + Number(d.value || 0), 0);
          const gap = Math.max(0, totalTarget - totalRealized);
          const attainment = totalTarget > 0 ? (totalRealized / totalTarget) * 100 : 0;
          const dailyRequired = remainingDays > 0 ? gap / remainingDays : 0;
          const linearDailyTarget = businessDays > 0 ? totalTarget / businessDays : 0;
          const runRate = elapsedDays > 0 ? (totalRealized / elapsedDays) * businessDays : 0;

          let bestDay = { day: 0, date: "", value: 0, count: 0 };
          for (const [date, dealList] of closingMap.entries()) {
            const sum = dealList.reduce((acc, d) => acc + d.value, 0);
            if (sum > bestDay.value) {
              const dayNum = Number(date.split("-")[2]);
              bestDay = { day: dayNum, date, value: sum, count: dealList.length };
            }
          }

          return json({
            month,
            today,
            days,
            closings,
            goals: goalRows,
            consultants: operatorRows,
            summary: {
              totalTarget,
              totalRealized,
              gap,
              attainment,
              businessDays,
              elapsedDays,
              remainingDays,
              dailyRequired,
              linearDailyTarget,
              runRate,
              bestDay,
            },
          });
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
        if (session.operator.role !== "admin")
          return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        try {
          const body = await request.json();
          const date = typeof body.date === "string" ? body.date : "";
          const type = body.type;
          const description = typeof body.description === "string" ? body.description.trim() : "";
          if (
            !isDay(date) ||
            !["holiday", "bridge", "extra_work", "suspension"].includes(type) ||
            !description ||
            description.length > 200 ||
            typeof body.affectsGoal !== "boolean"
          ) {
            return json(
              { error: "Data, tipo, descrição e impacto na meta são obrigatórios." },
              400,
            );
          }
          const [day] = await db
            .insert(commercialCalendarDays)
            .values({
              id: crypto.randomUUID(),
              tenantId,
              date,
              type,
              description,
              affectsGoal: body.affectsGoal,
              createdByOperatorId: session.operator.id,
            })
            .onConflictDoUpdate({
              target: [commercialCalendarDays.tenantId, commercialCalendarDays.date],
              set: {
                type,
                description,
                affectsGoal: body.affectsGoal,
                createdByOperatorId: session.operator.id,
              },
            })
            .returning();
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
        if (session.operator.role !== "admin")
          return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        const date = new URL(request.url).searchParams.get("date") || "";
        if (!isDay(date)) return json({ error: "Data inválida." }, 400);
        try {
          const [deleted] = await db
            .delete(commercialCalendarDays)
            .where(
              and(
                eq(commercialCalendarDays.tenantId, tenantId),
                eq(commercialCalendarDays.date, date),
              ),
            )
            .returning({ id: commercialCalendarDays.id });
          return deleted
            ? json({ deleted: true })
            : json({ error: "Dia não encontrado neste tenant." }, 404);
        } catch (error) {
          console.error("[commercial/calendar] DELETE:", error);
          return json({ error: "Falha ao remover o dia comercial." }, 500);
        }
      },
    },
  },
});
