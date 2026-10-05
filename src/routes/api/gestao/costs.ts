import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { aiUsageLogs } from "../../../db/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";

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
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (session.operator.role !== "admin" && session.operator.role !== "supervisor") {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente. Apenas administradores e supervisores podem visualizar custos.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        if (queryTenantId && queryTenantId !== tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const period = url.searchParams.get("period") || "7d";
        const selectedFeature = url.searchParams.get("feature");
        const selectedModel = url.searchParams.get("model");

        try {
          const now = new Date();
          let startDate: Date | null = null;
          if (period === "today") {
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          } else if (period === "7d") {
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          } else if (period === "30d") {
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          }

          const filters: any[] = [eq(aiUsageLogs.tenantId, tenantId)];
          if (selectedFeature && selectedFeature !== "all") filters.push(eq(aiUsageLogs.feature, selectedFeature));
          if (selectedModel && selectedModel !== "all") filters.push(eq(aiUsageLogs.model, selectedModel));
          if (startDate) filters.push(gte(aiUsageLogs.createdAt, startDate));

          // ── Somente dados reais — sem mock ──────────────────────────────────────
          const logs = await db
            .select()
            .from(aiUsageLogs)
            .where(and(...filters))
            .orderBy(desc(aiUsageLogs.createdAt))
            .limit(500);

          // Cálculos agregados
          let totalCostUsd = 0, totalCostBrl = 0, totalTokens = 0;
          let promptTokens = 0, completionTokens = 0, totalLatencyMs = 0;
          let successCount = 0, errorCount = 0;

          const featureMap: Record<string, { calls: number; tokens: number; usd: number; brl: number }> = {};
          const modelMap:   Record<string, { calls: number; tokens: number; usd: number; brl: number }> = {};
          const tenantMap:  Record<string, { calls: number; tokens: number; usd: number; brl: number }> = {};
          const dailyMap:   Record<string, { date: string; calls: number; tokens: number; usd: number; brl: number }> = {};

          for (const item of logs) {
            const usd    = parseFloat(item.costUsd || "0");
            const brl    = parseFloat(item.costBrl || "0");
            const tokens = item.totalTokens || 0;

            totalCostUsd      += usd;
            totalCostBrl      += brl;
            totalTokens       += tokens;
            promptTokens      += item.promptTokens || 0;
            completionTokens  += item.completionTokens || 0;
            totalLatencyMs    += item.latencyMs || 0;
            item.status === "error" ? errorCount++ : successCount++;

            // Agrupa por funcionalidade
            const feat = item.feature || "general";
            if (!featureMap[feat]) featureMap[feat] = { calls: 0, tokens: 0, usd: 0, brl: 0 };
            featureMap[feat].calls++; featureMap[feat].tokens += tokens; featureMap[feat].usd += usd; featureMap[feat].brl += brl;

            // Agrupa por modelo
            const mdl = item.model || "gemini-2.5-pro";
            if (!modelMap[mdl]) modelMap[mdl] = { calls: 0, tokens: 0, usd: 0, brl: 0 };
            modelMap[mdl].calls++; modelMap[mdl].tokens += tokens; modelMap[mdl].usd += usd; modelMap[mdl].brl += brl;

            // Agrupa por tenant
            const tnt = item.tenantId || "valem";
            if (!tenantMap[tnt]) tenantMap[tnt] = { calls: 0, tokens: 0, usd: 0, brl: 0 };
            tenantMap[tnt].calls++; tenantMap[tnt].tokens += tokens; tenantMap[tnt].usd += usd; tenantMap[tnt].brl += brl;

            // Agrupa por data — fuso horário de Brasília para não vazar para o dia seguinte
            const localDate = new Date(item.createdAt).toLocaleDateString("pt-BR", {
              timeZone: "America/Sao_Paulo",
              year: "numeric", month: "2-digit", day: "2-digit",
            }); // DD/MM/YYYY
            const [d, m, y] = localDate.split("/");
            const dateStr = `${y}-${m}-${d}`; // YYYY-MM-DD
            if (!dailyMap[dateStr]) dailyMap[dateStr] = { date: dateStr, calls: 0, tokens: 0, usd: 0, brl: 0 };
            dailyMap[dateStr].calls++; dailyMap[dateStr].tokens += tokens; dailyMap[dateStr].usd += usd; dailyMap[dateStr].brl += brl;
          }

          const totalCalls       = logs.length;
          const avgLatencyMs     = totalCalls > 0 ? Math.round(totalLatencyMs / totalCalls) : 0;
          const avgCostPerCallBrl = totalCalls > 0 ? totalCostBrl / totalCalls : 0;

          const featureBreakdown = Object.entries(featureMap).map(([feature, data]) => ({
            feature,
            featureName: getFeatureLabel(feature, tenantId),
            calls: data.calls,
            tokens: data.tokens,
            costUsd: Number(data.usd.toFixed(4)),
            costBrl: Number(data.brl.toFixed(4)),
            percentage: totalCostBrl > 0 ? Number(((data.brl / totalCostBrl) * 100).toFixed(1)) : 0,
          })).sort((a, b) => b.costBrl - a.costBrl);

          const modelBreakdown = Object.entries(modelMap).map(([model, data]) => ({
            model,
            calls: data.calls,
            tokens: data.tokens,
            costUsd: Number(data.usd.toFixed(4)),
            costBrl: Number(data.brl.toFixed(4)),
            percentage: totalCostBrl > 0 ? Number(((data.brl / totalCostBrl) * 100).toFixed(1)) : 0,
          })).sort((a, b) => b.costBrl - a.costBrl);

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
              isSimulated: false, // Sempre dados reais — sem mock
              summary: {
                totalCalls,
                totalCostUsd:      Number(totalCostUsd.toFixed(4)),
                totalCostBrl:      Number(totalCostBrl.toFixed(4)),
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
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("[GET /api/gestao/costs] Erro:", e);
          return new Response(
            JSON.stringify({ error: "Erro ao processar custos de IA", details: e?.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});

function getFeatureLabel(feature: string, tenantId?: string): string {
  switch (feature) {
    case "sdr_agent":           return "SDR Bot (Triagem de Leads)";
    case "conversation_audit":  return "Auditoria de Atendimento QA";
    case "sla_advisor":         return "Análise SLA & Alertas";
    case "supervisor_chat":     return tenantId === "tecfag" ? "Fagner Supervisor (Chat Interno)" : "Valentina Supervisor (Chat Interno)";
    case "valentina_chat":      return "Valentina Chat do Operador";
    case "fagner_chat":         return "Fagner Chat do Operador";
    case "sentiment_analysis":  return "Análise de Sentimento (Clientes)";
    case "call_transcription":  return "Transcrição de Ligações";
    case "knowledge_rag":       return "Base de Conhecimento RAG";
    default: return feature || "Uso Geral Vertex AI";
  }
}

function formatDateLabel(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
  return dateStr;
}
