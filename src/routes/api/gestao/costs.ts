import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { aiUsageLogs } from "../../../db/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import crypto from "crypto";

const uuidv4 = () => crypto.randomUUID();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/gestao/costs")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const period = url.searchParams.get("period") || "7d"; // 'today' | '7d' | '30d' | 'all'
        const selectedFeature = url.searchParams.get("feature");
        const selectedModel = url.searchParams.get("model");

        try {
          // Determina filtro de data
          const now = new Date();
          let startDate: Date | null = null;
          if (period === "today") {
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          } else if (period === "7d") {
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          } else if (period === "30d") {
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          }

          const filters: any[] = [];
          if (tenantId) {
            filters.push(eq(aiUsageLogs.tenantId, tenantId));
          }
          if (selectedFeature && selectedFeature !== "all") {
            filters.push(eq(aiUsageLogs.feature, selectedFeature));
          }
          if (selectedModel && selectedModel !== "all") {
            filters.push(eq(aiUsageLogs.model, selectedModel));
          }
          if (startDate) {
            filters.push(gte(aiUsageLogs.createdAt, startDate));
          }

          let logs = await db
            .select()
            .from(aiUsageLogs)
            .where(filters.length > 0 ? and(...filters) : undefined)
            .orderBy(desc(aiUsageLogs.createdAt))
            .limit(500);

          // Se não houver logs gravados ainda (ambiente recém-criado/dev), fornece telemetria demonstrativa rica
          const isSimulated = logs.length === 0;
          if (isSimulated) {
            logs = generateDemoLogs(period, tenantId || "valem");
          }

          // Cálculos agregados gerais
          let totalCostUsd = 0;
          let totalCostBrl = 0;
          let totalTokens = 0;
          let promptTokens = 0;
          let completionTokens = 0;
          let totalLatencyMs = 0;
          let successCount = 0;
          let errorCount = 0;

          const featureMap: Record<string, { calls: number; tokens: number; usd: number; brl: number }> = {};
          const modelMap: Record<string, { calls: number; tokens: number; usd: number; brl: number }> = {};
          const tenantMap: Record<string, { calls: number; tokens: number; usd: number; brl: number }> = {};
          const dailyMap: Record<string, { date: string; calls: number; tokens: number; usd: number; brl: number }> = {};

          for (const item of logs) {
            const usd = parseFloat(item.costUsd || "0");
            const brl = parseFloat(item.costBrl || "0");
            const tokens = item.totalTokens || 0;
            const pTokens = item.promptTokens || 0;
            const cTokens = item.completionTokens || 0;

            totalCostUsd += usd;
            totalCostBrl += brl;
            totalTokens += tokens;
            promptTokens += pTokens;
            completionTokens += cTokens;
            totalLatencyMs += item.latencyMs || 0;

            if (item.status === "error") {
              errorCount++;
            } else {
              successCount++;
            }

            // Agrupa por funcionalidade
            const feat = item.feature || "general";
            if (!featureMap[feat]) {
              featureMap[feat] = { calls: 0, tokens: 0, usd: 0, brl: 0 };
            }
            featureMap[feat].calls += 1;
            featureMap[feat].tokens += tokens;
            featureMap[feat].usd += usd;
            featureMap[feat].brl += brl;

            // Agrupa por modelo
            const mdl = item.model || "gemini-2.5-pro";
            if (!modelMap[mdl]) {
              modelMap[mdl] = { calls: 0, tokens: 0, usd: 0, brl: 0 };
            }
            modelMap[mdl].calls += 1;
            modelMap[mdl].tokens += tokens;
            modelMap[mdl].usd += usd;
            modelMap[mdl].brl += brl;

            // Agrupa por tenant
            const tnt = item.tenantId || "valem";
            if (!tenantMap[tnt]) {
              tenantMap[tnt] = { calls: 0, tokens: 0, usd: 0, brl: 0 };
            }
            tenantMap[tnt].calls += 1;
            tenantMap[tnt].tokens += tokens;
            tenantMap[tnt].usd += usd;
            tenantMap[tnt].brl += brl;

            // Agrupa por data (YYYY-MM-DD)
            const dateStr = item.createdAt ? new Date(item.createdAt).toISOString().split("T")[0] : new Date().toISOString().split("T")[0];
            if (!dailyMap[dateStr]) {
              dailyMap[dateStr] = { date: dateStr, calls: 0, tokens: 0, usd: 0, brl: 0 };
            }
            dailyMap[dateStr].calls += 1;
            dailyMap[dateStr].tokens += tokens;
            dailyMap[dateStr].usd += usd;
            dailyMap[dateStr].brl += brl;
          }

          const totalCalls = logs.length;
          const avgLatencyMs = totalCalls > 0 ? Math.round(totalLatencyMs / totalCalls) : 0;
          const avgCostPerCallBrl = totalCalls > 0 ? totalCostBrl / totalCalls : 0;

          // Formata lista por funcionalidade
          const featureBreakdown = Object.entries(featureMap).map(([feature, data]) => ({
            feature,
            featureName: getFeatureLabel(feature),
            calls: data.calls,
            tokens: data.tokens,
            costUsd: Number(data.usd.toFixed(4)),
            costBrl: Number(data.brl.toFixed(4)),
            percentage: totalCostBrl > 0 ? Number(((data.brl / totalCostBrl) * 100).toFixed(1)) : 0,
          })).sort((a, b) => b.costBrl - a.costBrl);

          // Formata lista por modelo
          const modelBreakdown = Object.entries(modelMap).map(([model, data]) => ({
            model,
            calls: data.calls,
            tokens: data.tokens,
            costUsd: Number(data.usd.toFixed(4)),
            costBrl: Number(data.brl.toFixed(4)),
            percentage: totalCostBrl > 0 ? Number(((data.brl / totalCostBrl) * 100).toFixed(1)) : 0,
          })).sort((a, b) => b.costBrl - a.costBrl);

          // Formata série temporal para gráficos
          const timeline = Object.values(dailyMap)
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((item) => ({
              date: item.date,
              dateFormatted: formatDateLabel(item.date),
              calls: item.calls,
              tokens: item.tokens,
              costUsd: Number(item.usd.toFixed(4)),
              costBrl: Number(item.brl.toFixed(4)),
            }));

          return new Response(
            JSON.stringify({
              isSimulated,
              summary: {
                totalCalls,
                totalCostUsd: Number(totalCostUsd.toFixed(4)),
                totalCostBrl: Number(totalCostBrl.toFixed(4)),
                totalTokens,
                promptTokens,
                completionTokens,
                avgLatencyMs,
                avgCostPerCallBrl: Number(avgCostPerCallBrl.toFixed(4)),
                successCount,
                errorCount,
              },
              featureBreakdown,
              modelBreakdown,
              tenantMap,
              timeline,
              logs: logs.slice(0, 100),
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } catch (e: any) {
          console.error("[GET /api/gestao/costs] Erro:", e);
          return new Response(
            JSON.stringify({ error: "Erro ao processar custos de IA", details: e?.message }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      },
    },
  },
});

function getFeatureLabel(feature: string): string {
  switch (feature) {
    case "sdr_agent":
      return "SDR Bot (Triagem de Leads)";
    case "conversation_audit":
      return "Auditoria de Atendimento QA";
    case "sla_advisor":
      return "Análise SLA & Alertas";
    case "supervisor_chat":
      return "Valentina Chat Operador";
    case "knowledge_rag":
      return "Base de Conhecimento RAG";
    default:
      return "Uso Geral Vertex AI";
  }
}

function formatDateLabel(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}`;
  }
  return dateStr;
}

/**
 * Gera dados demonstrativos realistas de telemetria quando o banco ainda não possui histórico suficiente
 */
function generateDemoLogs(period: string, tenantId: string) {
  const demoLogs: any[] = [];
  const days = period === "today" ? 1 : period === "7d" ? 7 : 30;
  const now = new Date();

  const features = ["sdr_agent", "conversation_audit", "supervisor_chat", "sla_advisor"];
  const models = ["gemini-2.5-pro", "gemini-1.5-flash"];

  // Gerar ~15 chamadas por dia com variação realista
  for (let d = days - 1; d >= 0; d--) {
    const dayDate = new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
    const callsCount = Math.floor(Math.random() * 8) + 12; // 12-20 chamadas/dia

    for (let c = 0; c < callsCount; c++) {
      const feat = features[Math.floor(Math.random() * features.length)];
      const isSdrOrAudit = feat === "sdr_agent" || feat === "conversation_audit";
      const model = isSdrOrAudit ? "gemini-2.5-pro" : Math.random() > 0.4 ? "gemini-1.5-flash" : "gemini-2.5-pro";
      const isFlash = model.includes("flash");

      const promptTokens = Math.floor(Math.random() * (isSdrOrAudit ? 1800 : 600)) + (isSdrOrAudit ? 800 : 200);
      const completionTokens = Math.floor(Math.random() * (isSdrOrAudit ? 450 : 150)) + 50;
      const totalTokens = promptTokens + completionTokens;

      const pRate = isFlash ? 0.075 : 1.25;
      const cRate = isFlash ? 0.30 : 5.00;
      const costUsd = (promptTokens / 1_000_000) * pRate + (completionTokens / 1_000_000) * cRate;
      const costBrl = costUsd * 5.60;

      const callTime = new Date(dayDate.getTime() + Math.floor(Math.random() * 12 * 60 * 60 * 1000) + 8 * 60 * 60 * 1000);

      demoLogs.push({
        id: uuidv4(),
        tenantId,
        feature: feat,
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd: costUsd.toFixed(6),
        costBrl: costBrl.toFixed(6),
        latencyMs: Math.floor(Math.random() * 1400) + 400,
        status: Math.random() > 0.03 ? "success" : "error",
        errorMessage: null,
        metadata: { demo: true },
        createdAt: callTime,
      });
    }
  }

  return demoLogs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
