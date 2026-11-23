import { and, desc, eq, isNull, sql } from "drizzle-orm";
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

function toTimestampMs(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const ts = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ts) ? ts : 0;
}

/**
 * Mescla os fluxos prioritários pendentes de ação humana (`awaiting_approval`,
 * `waiting_for_team`, `handoff_failed`) com os `N` fluxos mais recentes, deduplicando
 * por `conversationId` e preservando a ordenação decrescente por `lastInteractionAt`.
 * Garante que disparos proativos em massa nunca empurrem aprovações pendentes para fora da UI.
 */
export function mergeLatestAndPrioritySdrFlows<
  T extends { id: string; conversationId: string; lastInteractionAt?: Date | string | null },
>(recentRows: readonly T[], priorityRows: readonly T[]): T[] {
  const byConversation = new Map<string, T>();
  for (const row of priorityRows) {
    if (!byConversation.has(row.conversationId)) {
      byConversation.set(row.conversationId, row);
    }
  }
  for (const row of recentRows) {
    if (!byConversation.has(row.conversationId)) {
      byConversation.set(row.conversationId, row);
    }
  }
  return [...byConversation.values()].sort((a, b) => {
    const diff = toTimestampMs(b.lastInteractionAt) - toTimestampMs(a.lastInteractionAt);
    if (diff !== 0) return diff;
    return String(b.id).localeCompare(String(a.id));
  });
}

export async function readLatestSdrFlows(
  database: IndustrialDatabase,
  tenantId: string,
  limit = 50,
) {
  const latestRecent = latestFlows(database, tenantId, "sdr");
  const latestPriority = latestFlows(database, tenantId, "sdr");

  const [recentRows, priorityRows] = await Promise.all([
    database
      .select()
      .from(latestRecent)
      .orderBy(desc(latestRecent.lastInteractionAt), desc(latestRecent.id))
      .limit(limit),
    database
      .select({
        id: latestPriority.id,
        tenantId: latestPriority.tenantId,
        conversationId: latestPriority.conversationId,
        agentType: latestPriority.agentType,
        currentStep: latestPriority.currentStep,
        collectedData: latestPriority.collectedData,
        metadata: latestPriority.metadata,
        startedAt: latestPriority.startedAt,
        lastInteractionAt: latestPriority.lastInteractionAt,
        completedAt: latestPriority.completedAt,
        outcome: latestPriority.outcome,
      })
      .from(latestPriority)
      .innerJoin(
        conversations,
        and(
          eq(conversations.id, latestPriority.conversationId),
          eq(conversations.tenantId, tenantId),
        ),
      )
      .where(
        and(
          eq(latestPriority.outcome, "in_progress"),
          isNull(latestPriority.completedAt),
          eq(conversations.queueState, "automacao"),
          isNull(conversations.operatorId),
          sql`(
            ${latestPriority.metadata}->>'handoffStatus' IN ('awaiting_approval', 'waiting_for_team', 'handoff_failed')
            OR (
              ${latestPriority.metadata} ? 'pendingApproval'
              AND ${latestPriority.metadata}->'pendingApproval' IS NOT NULL
              AND ${latestPriority.metadata}->>'pendingApproval' <> 'null'
            )
          )`,
        ),
      )
      .orderBy(desc(latestPriority.lastInteractionAt), desc(latestPriority.id))
      .limit(200),
  ]);

  return mergeLatestAndPrioritySdrFlows(recentRows, priorityRows);
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
