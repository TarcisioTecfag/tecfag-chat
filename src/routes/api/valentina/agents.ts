import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { db } from "../../../db";
import { agentConfigs } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { getAiPersona } from "../../../lib/ai-persona";
import { readAgentMonitoringSummary } from "../../../lib/triage/agent-monitor-store";

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
export const Route = createFileRoute("/api/valentina/agents")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const tenantId = auth.session.tenantId;
        const persona = getAiPersona(tenantId);
        try {
          const [configs, summary] = await Promise.all([
            db.select().from(agentConfigs).where(eq(agentConfigs.tenantId, tenantId)),
            readAgentMonitoringSummary(db, tenantId),
          ]);
          const definitions = [
            {
              agentType: "sdr",
              name: `${persona.name} SDR`,
              description: `Triagem de atendimento da ${persona.company}`,
              icon: "Headset",
            },
            {
              agentType: "supervisor",
              name: `${persona.name} Supervisor`,
              description: "Monitoramento e orientação dos operadores",
              icon: "Brain",
            },
            {
              agentType: "vendedor",
              name: `${persona.name} Consultor`,
              description: "Apoio ao atendimento",
              icon: "TrendingUp",
            },
          ];
          const agents = definitions.map((def) => {
            const config = configs.find((c) => c.agentType === def.agentType);
            const measured = summary.byAgent[def.agentType] || {
              currentCycles: 0,
              activeFlows: 0,
              startedToday: 0,
            };
            return {
              ...def,
              enabled: config?.enabled === 1,
              configId: config?.id ?? null,
              activeFlows: measured.activeFlows,
              lastUpdated: config?.updatedAt ?? null,
              metrics: { ...measured, taxaConversao: null, tempoMedioQualificacao: null },
              unavailableMetrics: {
                taxaConversao: "Conversão em vendas ainda não instrumentada.",
                tempoMedioQualificacao: "Duração histórica ainda não consolidada.",
              },
            };
          });
          return new Response(JSON.stringify({ agents, summary }), { headers });
        } catch (error) {
          console.error("[valentina/agents] Falha ao consultar métricas:", error);
          return new Response(
            JSON.stringify({
              error: "Métricas temporariamente indisponíveis.",
              code: "METRICS_UNAVAILABLE",
            }),
            { status: 503, headers },
          );
        }
      },
    },
  },
});
