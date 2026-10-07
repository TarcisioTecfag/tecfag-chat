import { createFileRoute } from "@tanstack/react-router";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../../db";
import { commercialSettings, crmStages } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { DEFAULT_MATURITY_RULES, type MaturityRule } from "../../../lib/commercial/metrics";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/commercial/settings")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin")
          return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        try {
          const [settings, stages] = await Promise.all([
            db
              .select()
              .from(commercialSettings)
              .where(eq(commercialSettings.tenantId, tenantId))
              .limit(1),
            db
              .select({ id: crmStages.id, name: crmStages.name, pipelineId: crmStages.pipelineId })
              .from(crmStages)
              .where(eq(crmStages.tenantId, tenantId))
              .orderBy(crmStages.orderIndex),
          ]);
          return json({
            settings: settings[0] || {
              maturityRules: DEFAULT_MATURITY_RULES,
              excludedStageIds: [],
              slaLimitMinutes: 15,
              slaBuckets: [5, 15, 30],
              lossReasonCategories: [],
              tvSettings: {
                rotationSeconds: 24,
                activeModules: [0, 1, 2, 3, 4, 5],
                showSidebar: false,
                liveNotice: "",
              },
            },
            stages,
          });
        } catch (error) {
          console.error("[commercial/settings] GET:", error);
          return json({ error: "Falha ao carregar configurações comerciais." }, 500);
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
          const rules: MaturityRule[] | null = Array.isArray(body.maturityRules)
            ? body.maturityRules
            : null;
          const excludedStageIds: string[] = Array.isArray(body.excludedStageIds)
            ? [
                ...new Set(
                  (body.excludedStageIds as unknown[]).filter(
                    (id): id is string => typeof id === "string" && !!id,
                  ),
                ),
              ]
            : [];
          const slaLimitMinutes = Number(body.slaLimitMinutes);
          const slaBuckets = body.slaBuckets === undefined ? null : body.slaBuckets;
          const lossReasonCategories =
            body.lossReasonCategories === undefined ? null : body.lossReasonCategories;
          const validLossCategories =
            lossReasonCategories === null ||
            (Array.isArray(lossReasonCategories) &&
              lossReasonCategories.length <= 30 &&
              lossReasonCategories.every(
                (category) =>
                  category &&
                  typeof category.name === "string" &&
                  category.name.trim().length >= 2 &&
                  category.name.trim().length <= 100 &&
                  Array.isArray(category.reasons) &&
                  category.reasons.length <= 100 &&
                  category.reasons.every(
                    (reason: unknown) =>
                      typeof reason === "string" &&
                      reason.trim().length >= 2 &&
                      reason.trim().length <= 160,
                  ),
              ) &&
              new Set(
                lossReasonCategories.map((category) =>
                  category.name.trim().toLocaleLowerCase("pt-BR"),
                ),
              ).size === lossReasonCategories.length &&
              new Set(
                lossReasonCategories.flatMap((category) =>
                  category.reasons.map((reason: string) =>
                    reason.trim().toLocaleLowerCase("pt-BR"),
                  ),
                ),
              ).size ===
                lossReasonCategories.reduce((sum, category) => sum + category.reasons.length, 0));
          const validBuckets =
            slaBuckets === null ||
            (Array.isArray(slaBuckets) &&
              slaBuckets.length === 3 &&
              slaBuckets.every(
                (value, index) =>
                  Number.isInteger(value) &&
                  value >= 1 &&
                  value <= 1440 &&
                  (index === 0 || value > slaBuckets[index - 1]),
              ));
          const rotationSeconds = Number(body.tvSettings?.rotationSeconds ?? 24);
          const activeModules: number[] = Array.isArray(body.tvSettings?.activeModules)
            ? body.tvSettings.activeModules
            : [0, 1, 2, 3, 4, 5];
          const showSidebar = Boolean(body.tvSettings?.showSidebar);
          const liveNotice =
            typeof body.tvSettings?.liveNotice === "string"
              ? body.tvSettings.liveNotice.trim().slice(0, 500)
              : "";
          const validRules =
            rules !== null &&
            rules.length === 5 &&
            rules.every(
              (rule, index) =>
                Number.isInteger(rule.days) &&
                rule.days >= 1 &&
                rule.days <= 365 &&
                (index === 0 || rule.days > rules[index - 1].days) &&
                (index === rules.length - 1
                  ? rule.maxValue === null
                  : Number.isFinite(rule.maxValue) && Number(rule.maxValue) > 0) &&
                (index === 0 ||
                  index === rules.length - 1 ||
                  Number(rule.maxValue) > Number(rules[index - 1].maxValue)),
            );
          if (
            !validRules ||
            excludedStageIds.length > 100 ||
            !Number.isInteger(slaLimitMinutes) ||
            slaLimitMinutes < 1 ||
            slaLimitMinutes > 1440 ||
            !validBuckets ||
            !validLossCategories ||
            !Number.isInteger(rotationSeconds) ||
            rotationSeconds < 10 ||
            rotationSeconds > 300 ||
            !activeModules.length ||
            activeModules.some((item) => !Number.isInteger(item) || item < 0 || item > 5) ||
            new Set(activeModules).size !== activeModules.length
          ) {
            return json(
              { error: "Régua, etapas excluídas, SLA ou controle da TV inválidos." },
              400,
            );
          }
          if (excludedStageIds.length) {
            const stages = await db
              .select({ id: crmStages.id })
              .from(crmStages)
              .where(
                and(eq(crmStages.tenantId, tenantId), inArray(crmStages.id, excludedStageIds)),
              );
            if (stages.length !== excludedStageIds.length)
              return json({ error: "Etapa excluída não pertence a este tenant." }, 400);
          }
          const [settings] = await db
            .insert(commercialSettings)
            .values({
              tenantId,
              maturityRules: rules,
              excludedStageIds,
              slaLimitMinutes,
              slaBuckets: slaBuckets || [5, 15, 30],
              lossReasonCategories: lossReasonCategories || [],
              tvSettings: { rotationSeconds, activeModules, showSidebar, liveNotice },
              updatedByOperatorId: session.operator.id,
            })
            .onConflictDoUpdate({
              target: commercialSettings.tenantId,
              set: {
                maturityRules: rules,
                excludedStageIds,
                slaLimitMinutes,
                ...(slaBuckets ? { slaBuckets } : {}),
                ...(lossReasonCategories ? { lossReasonCategories } : {}),
                tvSettings: { rotationSeconds, activeModules, showSidebar, liveNotice },
                updatedByOperatorId: session.operator.id,
                updatedAt: new Date(),
              },
            })
            .returning();
          return json({ settings });
        } catch (error) {
          console.error("[commercial/settings] POST:", error);
          return json({ error: "Falha ao salvar configurações comerciais." }, 500);
        }
      },
    },
  },
});
