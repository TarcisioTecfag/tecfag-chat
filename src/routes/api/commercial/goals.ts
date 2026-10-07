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

export const Route = createFileRoute("/api/commercial/goals")({
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
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({ error: "Mês inválido." }, 400);
        try {
          const today = saoPauloDay();
          const [year, monthNumber] = month.split("-").map(Number);
          const monthStart = `${month}-01`;
          const nextMonthStart = `${monthNumber === 12 ? year + 1 : year}-${String(monthNumber === 12 ? 1 : monthNumber + 1).padStart(2, "0")}-01`;

          // 1. Operadores e perfis comerciais
          const operatorRows = await db
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
            .orderBy(operators.name);

          // 2. Metas cadastradas no mês
          const goalRows = await db
            .select({
              id: commercialGoals.id,
              operatorId: commercialGoals.operatorId,
              targetValue: commercialGoals.targetValue,
              conversionRate: commercialGoals.conversionRate,
            })
            .from(commercialGoals)
            .where(and(eq(commercialGoals.tenantId, tenantId), eq(commercialGoals.month, month)));

          const goalMap = new Map(goalRows.map((g) => [g.operatorId, g]));

          // 3. Feriados e ajustes de expediente no mês
          const calendarRows = await db
            .select({
              date: commercialCalendarDays.date,
              type: commercialCalendarDays.type,
              affectsGoal: commercialCalendarDays.affectsGoal,
            })
            .from(commercialCalendarDays)
            .where(
              and(
                eq(commercialCalendarDays.tenantId, tenantId),
                gte(commercialCalendarDays.date, monthStart),
                lt(commercialCalendarDays.date, nextMonthStart),
              ),
            );

          // 4. Negociações ganhas no mês para apurar realizado por consultor
          const wonDeals = await db
            .select({
              operatorId: crmDeals.operatorId,
              value: crmDeals.value,
            })
            .from(crmDeals)
            .where(
              and(
                eq(crmDeals.tenantId, tenantId),
                eq(crmDeals.status, "won"),
                gte(crmDeals.closedAt, new Date(`${monthStart}T00:00:00Z`)),
                lt(crmDeals.closedAt, new Date(`${nextMonthStart}T00:00:00Z`)),
              ),
            );

          const realizedMap = new Map<string, number>();
          for (const deal of wonDeals) {
            if (!deal.operatorId) continue;
            const current = realizedMap.get(deal.operatorId) || 0;
            realizedMap.set(deal.operatorId, current + Number(deal.value || 0));
          }

          // 5. Cálculo dos dias úteis
          const overrides = new Map(
            calendarRows.filter((d) => d.affectsGoal).map((d) => [d.date, d.type]),
          );
          const lastDayOfMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
          let businessDays = 0;
          let elapsedDays = 0;

          const isCurrentMonth = month === today.slice(0, 7);
          const isPastMonth = month < today.slice(0, 7);

          for (let day = 1; day <= lastDayOfMonth; day += 1) {
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

          // 6. Estruturação dos dados por consultor
          const consultants = operatorRows.map((op) => {
            const goal = goalMap.get(op.operatorId);
            const targetValue = Number(goal?.targetValue || 0);
            const conversionRate = Number(goal?.conversionRate ?? 10);
            const realizedValue = realizedMap.get(op.operatorId) || 0;
            const dailyTarget = businessDays > 0 ? targetValue / businessDays : 0;
            const attainment = targetValue > 0 ? (realizedValue / targetValue) * 100 : 0;
            const gap = Math.max(0, targetValue - realizedValue);

            return {
              operatorId: op.operatorId,
              name: op.name,
              email: op.email,
              avatar: op.avatar,
              division: op.division || null,
              activeOnTv: op.activeOnTv ?? true,
              targetValue,
              conversionRate,
              dailyTarget,
              realizedValue,
              attainment,
              gap,
              goalId: goal?.id || null,
            };
          });

          // 7. Totais consolidados
          const totalTarget = consultants.reduce((acc, c) => acc + c.targetValue, 0);
          const totalRealized = consultants.reduce((acc, c) => acc + c.realizedValue, 0);
          const totalGap = Math.max(0, totalTarget - totalRealized);
          const totalAttainment = totalTarget > 0 ? (totalRealized / totalTarget) * 100 : 0;
          const consultantsWithGoal = consultants.filter((c) => c.targetValue > 0).length;
          const dailyRequired = remainingDays > 0 ? totalGap / remainingDays : 0;
          const totalDailyTarget = businessDays > 0 ? totalTarget / businessDays : 0;
          const validRates = consultants
            .filter((c) => c.targetValue > 0)
            .map((c) => c.conversionRate);
          const avgConversionRate =
            validRates.length > 0
              ? validRates.reduce((a, b) => a + b, 0) / validRates.length
              : 10;

          // Compatibilidade com listagem antiga de goals
          const goals = goalRows.map((g) => {
            const op = operatorRows.find((o) => o.operatorId === g.operatorId);
            return {
              id: g.id,
              operatorId: g.operatorId,
              operatorName: op?.name || "Consultor",
              targetValue: g.targetValue,
              conversionRate: g.conversionRate,
            };
          });

          return json({
            month,
            businessDays,
            elapsedDays,
            remainingDays,
            consultants,
            totals: {
              targetValue: totalTarget,
              realizedValue: totalRealized,
              gap: totalGap,
              attainment: totalAttainment,
              consultantsWithGoal,
              dailyRequired,
              totalDailyTarget,
              avgConversionRate,
            },
            goals,
          });
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
        if (session.operator.role !== "admin")
          return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        try {
          const body = await request.json();
          const month = typeof body.month === "string" ? body.month : "";
          const operatorId = typeof body.operatorId === "string" ? body.operatorId.trim() : "";

          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !operatorId) {
            return json({ error: "Mês e consultor são obrigatórios." }, 400);
          }

          const [operator] = await db
            .select({ id: operators.id, name: operators.name })
            .from(operators)
            .where(and(eq(operators.tenantId, tenantId), eq(operators.id, operatorId)))
            .limit(1);
          if (!operator) return json({ error: "Operador não encontrado neste tenant." }, 404);

          // Buscar meta existente se houver para suportar edição inline parcial
          const [existingGoal] = await db
            .select()
            .from(commercialGoals)
            .where(
              and(
                eq(commercialGoals.tenantId, tenantId),
                eq(commercialGoals.month, month),
                eq(commercialGoals.operatorId, operatorId),
              ),
            )
            .limit(1);

          const targetValue =
            body.targetValue !== undefined && body.targetValue !== null && body.targetValue !== ""
              ? Number(body.targetValue)
              : existingGoal
                ? Number(existingGoal.targetValue)
                : 0;

          const conversionRate =
            body.conversionRate !== undefined &&
            body.conversionRate !== null &&
            body.conversionRate !== ""
              ? Number(body.conversionRate)
              : existingGoal
                ? Number(existingGoal.conversionRate)
                : 10;

          if (
            !Number.isFinite(targetValue) ||
            targetValue < 0 ||
            targetValue > 999_999_999_999 ||
            !Number.isFinite(conversionRate) ||
            conversionRate < 0 ||
            conversionRate > 100
          ) {
            return json({ error: "Meta ou conversão inválidos." }, 400);
          }

          // Garantir que perfil do consultor exista para integridade
          const [profile] = await db
            .select({ division: commercialConsultantProfiles.division })
            .from(commercialConsultantProfiles)
            .where(
              and(
                eq(commercialConsultantProfiles.tenantId, tenantId),
                eq(commercialConsultantProfiles.operatorId, operatorId),
              ),
            )
            .limit(1);

          const division = body.division || profile?.division || "maquinas";
          if (!profile) {
            await db.insert(commercialConsultantProfiles).values({
              id: crypto.randomUUID(),
              tenantId,
              operatorId,
              division,
              activeOnTv: true,
            });
          } else if (body.division && body.division !== profile.division) {
            await db
              .update(commercialConsultantProfiles)
              .set({ division: body.division, updatedAt: new Date() })
              .where(
                and(
                  eq(commercialConsultantProfiles.tenantId, tenantId),
                  eq(commercialConsultantProfiles.operatorId, operatorId),
                ),
              );
          }

          const [goal] = await db
            .insert(commercialGoals)
            .values({
              id: crypto.randomUUID(),
              tenantId,
              month,
              operatorId,
              targetValue: targetValue.toFixed(2),
              conversionRate: conversionRate.toFixed(2),
              createdByOperatorId: session.operator.id,
            })
            .onConflictDoUpdate({
              target: [commercialGoals.tenantId, commercialGoals.month, commercialGoals.operatorId],
              set: {
                targetValue: targetValue.toFixed(2),
                conversionRate: conversionRate.toFixed(2),
                updatedAt: new Date(),
              },
            })
            .returning();
          return json({ goal });
        } catch (error) {
          console.error("[commercial/goals] POST:", error);
          return json({ error: "Falha ao salvar meta." }, 500);
        }
      },
    },
  },
});

