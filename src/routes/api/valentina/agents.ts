import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { agentConfigs, agentFlowStates } from "../../../db/schema";
import { eq, and, count } from "drizzle-orm";

// ── Headers CORS padrão ────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── Definição fixa dos 3 agentes Valentina ─────────────────────────────────────
const AGENT_DEFINITIONS = [
  {
    agentType: "sdr",
    name: "Valentina SDR",
    description: "Qualifica leads automaticamente, coleta dados iniciais e agenda com vendedores",
    icon: "Headset",
  },
  {
    agentType: "supervisor",
    name: "Valentina Supervisor",
    description: "Monitora desempenho, sugere melhorias e responde dúvidas dos operadores",
    icon: "Brain",
  },
  {
    agentType: "vendedor",
    name: "Valentina Vendedor",
    description: "Auxilia vendedores com scripts, objeções e recomendações em tempo real",
    icon: "TrendingUp",
  },
];

export const Route = createFileRoute("/api/valentina/agents")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ── GET: Status e métricas de todos os agentes ─────────────────────────
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");

        if (!tenantId) {
          return new Response(
            JSON.stringify({ error: "tenantId é obrigatório" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        try {
          // Buscar configs reais do banco (se existirem)
          let configs: any[] = [];
          try {
            configs = await db
              .select()
              .from(agentConfigs)
              .where(eq(agentConfigs.tenantId, tenantId));
          } catch {
            // Tabela pode não existir ainda — segue com array vazio
          }

          // Contar fluxos ativos por tipo de agente
          let flowCounts: Record<string, number> = {};
          try {
            for (const def of AGENT_DEFINITIONS) {
              const result = await db
                .select({ count: count() })
                .from(agentFlowStates)
                .where(
                  and(
                    eq(agentFlowStates.tenantId, tenantId),
                    eq(agentFlowStates.agentType, def.agentType)
                  )
                );
              flowCounts[def.agentType] = Number(result[0]?.count ?? 0);
            }
          } catch {
            // Tabela pode não existir ainda
          }

          // Montar resposta com definições + dados reais ou mock
          const agents = AGENT_DEFINITIONS.map((def) => {
            const dbConfig = configs.find((c) => c.agentType === def.agentType);
            const activeFlows = flowCounts[def.agentType] ?? 0;

            // Métricas mock — serão substituídas por dados reais quando o engine estiver ativo
            const mockMetrics: Record<string, any> = {
              sdr: {
                leadsQualificados: 47,
                taxaConversao: "32%",
                tempoMedioQualificacao: "2min 15s",
                leadsHoje: 8,
              },
              supervisor: {
                alertasEnviados: 23,
                sugestoesAceitas: "78%",
                operadoresMonitorados: 5,
                interacoesHoje: 14,
              },
              vendedor: {
                scriptsGerados: 156,
                objecoesTratadas: 89,
                recomendacoesAceitas: "65%",
                assistenciasHoje: 6,
              },
            };

            return {
              ...def,
              enabled: dbConfig ? dbConfig.enabled === 1 : false,
              configId: dbConfig?.id ?? null,
              activeFlows,
              metrics: mockMetrics[def.agentType] ?? {},
              lastUpdated: dbConfig?.updatedAt ?? null,
            };
          });

          return new Response(JSON.stringify({ agents }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[valentina/agents] Erro ao buscar agentes:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
