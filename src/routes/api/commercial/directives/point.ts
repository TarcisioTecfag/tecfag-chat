import { createFileRoute } from "@tanstack/react-router";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../../../db";
import {
  commercialConsultantProfiles,
  commercialDirectives,
  commercialSettings,
  crmDealActivities,
  crmDealEvents,
  crmDeals,
  crmStages,
  operators,
} from "../../../../db/schema";
import { requireSession } from "../../../../lib/auth-session";
import { classifyMaturity, DEFAULT_MATURITY_RULES, saoPauloDay } from "../../../../lib/commercial/metrics";

const RESPONSIBILITY_NOTE = "GESTOR PONTUOU ATENÇÃO E EXECUÇÃO NESSA NEGOCIAÇÃO";
const json = (data: unknown, status = 200) => Response.json(data, { status });

export const Route = createFileRoute("/api/commercial/directives/point")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin") {
          return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "JSON inválido." }, 400);
        }
        if (!body || typeof body !== "object") return json({ error: "Dados inválidos." }, 400);
        const input = body as Record<string, unknown>;
        const operatorId = typeof input.operatorId === "string" ? input.operatorId.trim() : "";
        const dealIds = Array.isArray(input.dealIds) ? input.dealIds : [];
        const now = new Date();
        const assignedDate = saoPauloDay(now);
        if (
          !operatorId ||
          dealIds.length < 1 ||
          dealIds.length > 100 ||
          dealIds.some((id) => typeof id !== "string" || !id.trim()) ||
          new Set(dealIds).size !== dealIds.length
        ) {
          return json({ error: "Informe um consultor e de 1 a 100 negociações distintas." }, 400);
        }

        try {
          const result = await db.transaction(async (tx) => {
            const [operator] = await tx
              .select({ id: operators.id, division: commercialConsultantProfiles.division })
              .from(operators)
              .innerJoin(
                commercialConsultantProfiles,
                and(
                  eq(commercialConsultantProfiles.operatorId, operators.id),
                  eq(commercialConsultantProfiles.tenantId, tenantId),
                ),
              )
              .where(and(eq(operators.tenantId, tenantId), eq(operators.id, operatorId)))
              .limit(1);
            if (!operator)
              return { error: "Consultor comercial não encontrado neste tenant.", status: 404 };

            const deals = await tx
              .select({
                id: crmDeals.id,
                title: crmDeals.title,
                value: crmDeals.value,
                status: crmDeals.status,
                operatorId: crmDeals.operatorId,
                stageId: crmDeals.stageId,
                createdAt: crmDeals.createdAt,
              })
              .from(crmDeals)
              .where(
                and(eq(crmDeals.tenantId, tenantId), inArray(crmDeals.id, dealIds as string[])),
              );
            if (
              deals.length !== dealIds.length ||
              deals.some((deal) => deal.status !== "open" || deal.operatorId !== operatorId)
            ) {
              return {
                error: "Todas as negociações devem estar abertas e atribuídas ao consultor no CRM.",
                status: 409,
              };
            }

            const [settings, stages] = await Promise.all([
              tx
                .select({
                  maturityRules: commercialSettings.maturityRules,
                  excludedStageIds: commercialSettings.excludedStageIds,
                })
                .from(commercialSettings)
                .where(eq(commercialSettings.tenantId, tenantId))
                .limit(1),
              tx
                .select({ id: crmStages.id, name: crmStages.name })
                .from(crmStages)
                .where(and(eq(crmStages.tenantId, tenantId), inArray(crmStages.id, deals.map((deal) => deal.stageId)))),
            ]);
            const excluded = new Set(settings[0]?.excludedStageIds || []);
            const stageNames = new Map(stages.map((stage) => [stage.id, stage.name]));
            const rules = settings[0]?.maturityRules?.length === 5
              ? settings[0].maturityRules
              : DEFAULT_MATURITY_RULES;
            if (deals.some((deal) => excluded.has(deal.stageId) || !classifyMaturity(Number(deal.value || 0), deal.createdAt, now, rules))) {
              return { error: "Selecione apenas negócios com valor positivo nas etapas incluídas no BI.", status: 409 };
            }

            const createdIds: string[] = [];
            for (const deal of deals) {
              const maturity = classifyMaturity(Number(deal.value || 0), deal.createdAt, now, rules)!;
              const [directive] = await tx
                .insert(commercialDirectives)
                .values({
                  id: crypto.randomUUID(),
                  tenantId,
                  dealId: deal.id,
                  assignedToOperatorId: operatorId,
                  assignedByOperatorId: session.operator.id,
                  assignedDate,
                  instruction: RESPONSIBILITY_NOTE,
                  priority: "normal",
                  snapshot: {
                    dealTitle: deal.title,
                    dealValue: Number(deal.value || 0),
                    stageId: deal.stageId,
                    stageName: stageNames.get(deal.stageId) || "Etapa",
                    ageDays: maturity.ageDays,
                    maturityTier: maturity.tierIndex,
                    maturityDays: maturity.tierDays,
                    daysRemaining: maturity.daysRemaining,
                    division: operator.division || undefined,
                  },
                })
                .onConflictDoNothing({
                  target: [
                    commercialDirectives.tenantId,
                    commercialDirectives.dealId,
                    commercialDirectives.assignedDate,
                  ],
                })
                .returning({ id: commercialDirectives.id });
              if (!directive) continue;
              createdIds.push(directive.id);

              const activityId = crypto.randomUUID();
              await tx.insert(crmDealActivities).values({
                id: activityId,
                tenantId,
                dealId: deal.id,
                type: "note",
                title: "Responsabilidade pontuada pelo gestor",
                description: RESPONSIBILITY_NOTE,
                status: "completed",
                completedAt: now,
                operatorId: session.operator.id,
                assignedToOperatorId: operatorId,
                createdAt: now,
                updatedAt: now,
              });
              await tx.insert(crmDealEvents).values({
                id: crypto.randomUUID(),
                tenantId,
                dealId: deal.id,
                eventType: "note_created",
                operatorId: session.operator.id,
                metadata: { activityId, directiveId: directive.id, type: "note" },
                createdAt: now,
              });
              await tx
                .update(crmDeals)
                .set({ lastActivityAt: now, updatedAt: now })
                .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, deal.id)));
            }
            return {
              assignedDate,
              createdCount: createdIds.length,
              alreadyAssignedCount: deals.length - createdIds.length,
              directiveIds: createdIds,
            };
          });
          if ("error" in result) return json({ error: result.error }, result.status);
          return json(result, result.createdCount ? 201 : 200);
        } catch (error) {
          console.error("[commercial/directives/point] POST:", error);
          return json({ error: "Falha ao pontuar responsabilidades." }, 500);
        }
      },
    },
  },
});
