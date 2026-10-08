import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../lib/auth-session";
import { saoPauloDay } from "../../../lib/commercial/metrics";
import {
  getCohortAnalysis,
  getCohortDealDrilldown,
  getDealDrilldown,
  getGoalAnalysis,
  getLossAnalysis,
  getLossDealDrilldown,
  getMaturityAnalysis,
  getOperationalAnalysis,
  getPipelineAnalysis,
  getResponsibilityAnalysis,
  getTmaAnalysis,
  getTmaEventDrilldown,
} from "../../../lib/commercial/analysis-service";
import type { CommercialDivision } from "../../../lib/commercial/analysis-core";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

export const Route = createFileRoute("/api/commercial/analysis")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        if (session.operator.role !== "admin") {
          return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        }

        const params = new URL(request.url).searchParams;
        const view = params.get("view");
        const divisionInput = params.get("division");
        if (divisionInput && divisionInput !== "personnalite" && divisionInput !== "maquinas") {
          return json({ error: "Divisão inválida." }, 400);
        }
        const division = divisionInput as CommercialDivision;
        const month = params.get("month") || saoPauloDay(new Date()).slice(0, 7);
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
          return json({ error: "Mês inválido." }, 400);
        }
        const options = {
          tenantId: session.tenantId,
          division,
          includeHidden: params.get("includeHidden") === "true",
        };
        const page = Number(params.get("page") || 1);
        const limit = Number(params.get("limit") || 50);
        const search = params.get("search") || undefined;
        const operatorId = params.get("operatorId") || undefined;
        if (
          !Number.isInteger(page) ||
          page < 1 ||
          page > 10000 ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 100 ||
          (search && search.length > 100) ||
          (operatorId && operatorId.length > 100)
        ) {
          return json({ error: "Parâmetros de paginação ou busca inválidos." }, 400);
        }

        try {
          switch (view) {
            case "pipeline":
              return json(await getPipelineAnalysis(options));
            case "operational":
              return json(await getOperationalAnalysis(options));
            case "maturity":
              return json(await getMaturityAnalysis(options));
            case "responsibilities":
              return json(await getResponsibilityAnalysis({ ...options, month }));
            case "tma":
              return json(await getTmaAnalysis({ ...options, month }));
            case "losses":
              return json(await getLossAnalysis({ ...options, month }));
            case "cohorts":
              return json(await getCohortAnalysis(options));
            case "goals":
              return json(await getGoalAnalysis({ ...options, month }));
            case "loss-deals": {
              const period = params.get("period") || "current";
              const reason = params.get("reason") || undefined;
              if (
                (period !== "current" && period !== "previous" && period !== "all") ||
                (reason && reason.length > 160)
              ) {
                return json({ error: "Período ou motivo inválido." }, 400);
              }
              return json(
                await getLossDealDrilldown({ ...options, month, period, reason, page, limit }),
              );
            }
            case "cohort-deals":
              return json(
                await getCohortDealDrilldown({
                  ...options,
                  month,
                  unclassifiedOnly: params.get("unclassified") === "true",
                  search,
                  page,
                  limit,
                }),
              );
            case "tma-events": {
              const bucketInput = params.get("bucket");
              const bucket = bucketInput === null ? undefined : Number(bucketInput);
              if (bucket !== undefined && (!Number.isInteger(bucket) || bucket < 0 || bucket > 3)) {
                return json({ error: "Faixa de TMA inválida." }, 400);
              }
              const result = await getTmaEventDrilldown({
                ...options,
                month,
                operatorId,
                bucket,
                page,
                limit,
              });
              return "error" in result
                ? json({ error: result.error }, result.status)
                : json(result);
            }
            case "deals": {
              const mode = params.get("mode");
              if (mode !== "pipeline" && mode !== "maturity" && mode !== "forecast") {
                return json({ error: "Modo de detalhamento inválido." }, 400);
              }
              const stageId = params.get("stageId") || undefined;
              const tierInput = params.get("tier");
              const tier = tierInput === null ? undefined : Number(tierInput);
              if (
                (stageId && stageId.length > 100) ||
                (tier !== undefined &&
                  (!Number.isInteger(tier) ||
                    tier < -1 ||
                    tier > 5 ||
                    tier === 0 ||
                    (tier === -1 && mode !== "maturity"))) ||
                (mode === "pipeline" && tier !== undefined)
              )
                return json({ error: "Parâmetros de detalhamento inválidos." }, 400);
              const result = await getDealDrilldown({
                ...options,
                mode,
                operatorId,
                stageId,
                tier,
                search,
                page,
                limit,
              });
              return "error" in result
                ? json({ error: result.error }, result.status)
                : json(result);
            }
            default:
              return json({ error: "Análise inválida." }, 400);
          }
        } catch (error) {
          console.error("[commercial/analysis] GET:", error);
          return json({ error: "Falha ao calcular a análise comercial." }, 500);
        }
      },
    },
  },
});
