import { and, desc, eq, sql } from "drizzle-orm";
import { agentFlowStates, conversations } from "../../db/schema";
import type { IndustrialDatabase } from "./industrial-rodizio-store";

function latestFlows(database: IndustrialDatabase, tenantId: string, agentType?: string) {
  return database
    .selectDistinctOn([agentFlowStates.conversationId, agentFlowStates.agentType])
    .from(agentFlowStates)
    .where(
      and(
        eq(agentFlowStates.tenantId, tenantId),
        agentType ? eq(agentFlowStates.agentType, agentType) : undefined,
      ),
    )
    .orderBy(
      agentFlowStates.conversationId,
      agentFlowStates.agentType,
      desc(agentFlowStates.startedAt),
      desc(agentFlowStates.id),
    )
    .as("current_agent_flows");
}
export async function readLatestSdrFlows(
  database: IndustrialDatabase,
  tenantId: string,
  limit = 50,
) {
  const latest = latestFlows(database, tenantId, "sdr");
  return database
    .select()
    .from(latest)
    .orderBy(desc(latest.lastInteractionAt), desc(latest.id))
    .limit(limit);
}
/** Snapshot dos ciclos correntes, não histórico completo de leads nem conversão em vendas. */
export async function readAgentMonitoringSummary(
  database: IndustrialDatabase,
  tenantId: string,
  now = new Date(),
) {
  const latest = latestFlows(database, tenantId);
  const rows = await database
    .select({
      agentType: latest.agentType,
      currentCycles: sql<number>`count(*)::int`,
      activeFlows: sql<number>`count(*) filter (where ${latest.outcome} = 'in_progress' and ${latest.completedAt} is null and (${latest.agentType} <> 'sdr' or (${conversations.queueState} = 'automacao' and ${conversations.operatorId} is null)))::int`,
      startedToday: sql<number>`count(*) filter (where (${latest.startedAt} at time zone 'UTC' at time zone 'America/Sao_Paulo')::date = (${now.toISOString()}::timestamptz at time zone 'America/Sao_Paulo')::date)::int`,
    })
    .from(latest)
    .innerJoin(
      conversations,
      and(eq(conversations.id, latest.conversationId), eq(conversations.tenantId, tenantId)),
    )
    .groupBy(latest.agentType);
  return {
    available: true as const,
    generatedAt: now.toISOString(),
    timeZone: "America/Sao_Paulo",
    scope: "current_cycles" as const,
    byAgent: Object.fromEntries(
      rows.map((row) => [
        row.agentType,
        {
          currentCycles: Number(row.currentCycles),
          activeFlows: Number(row.activeFlows),
          startedToday: Number(row.startedToday),
        },
      ]),
    ),
  };
}
export type AgentMonitoringSummary = Awaited<ReturnType<typeof readAgentMonitoringSummary>>;
