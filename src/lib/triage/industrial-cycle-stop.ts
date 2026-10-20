import { and, eq, sql } from "drizzle-orm";
import { agentFlowStates, conversations } from "../../db/schema";
import type { IndustrialDatabase } from "./industrial-rodizio-store";
import { appendIndustrialJournal } from "./industrial-triage-journal-store";

export async function stopIndustrialCycle(
  database: IndustrialDatabase,
  tenantId: string,
  conversationId: string,
  operatorId: string,
) {
  return database.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
      .for("update");
    if (!conversation) return false;
    const active = await tx
      .select()
      .from(agentFlowStates)
      .where(
        and(
          eq(agentFlowStates.tenantId, tenantId),
          eq(agentFlowStates.conversationId, conversationId),
          eq(agentFlowStates.agentType, "sdr"),
          eq(agentFlowStates.outcome, "in_progress"),
        ),
      )
      .for("update");
    const now = new Date();
    for (const flow of active) {
      const [stopped] = await tx
        .update(agentFlowStates)
        .set({
          outcome: "stopped",
          currentStep: "Interrompido Manualmente",
          lastInteractionAt: now,
          completedAt: now,
        })
        .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, flow.id)))
        .returning();
      await appendIndustrialJournal(tx, flow, stopped, "manual_stop", operatorId);
    }
    if (!conversation.operatorId && conversation.queueState !== "finalizados")
      await tx
        .update(conversations)
        .set({ queueState: "fila", updatedAt: now, version: sql`${conversations.version} + 1` })
        .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)));
    return true;
  });
}
