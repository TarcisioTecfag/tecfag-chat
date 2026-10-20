import { and, desc, eq } from "drizzle-orm";
import { agentFlowStates, conversations } from "../../db/schema";
import type { IndustrialDatabase } from "./industrial-rodizio-store";
import { appendIndustrialJournal } from "./industrial-triage-journal-store";

/** Revalida a decisão de silêncio antes de registrar seu briefing, na ordem conversa -> fluxo. */
export async function markIndustrialNoResponse(
  database: IndustrialDatabase,
  tenantId: string,
  conversationId: string,
  input: {
    flowId: string;
    cycle: string;
    expectedInteraction: string;
    at: Date;
    reason: string;
    partialLeadRescuedAt?: string;
  },
) {
  return database.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
      .for("update");
    if (
      !conversation ||
      conversation.operatorId ||
      ["meus", "finalizados"].includes(conversation.queueState)
    )
      return null;
    const [flow] = await tx
      .select()
      .from(agentFlowStates)
      .where(
        and(
          eq(agentFlowStates.tenantId, tenantId),
          eq(agentFlowStates.conversationId, conversationId),
          eq(agentFlowStates.agentType, "sdr"),
        ),
      )
      .orderBy(desc(agentFlowStates.startedAt), desc(agentFlowStates.id))
      .limit(1)
      .for("update");
    if (
      !flow ||
      flow.id !== input.flowId ||
      flow.startedAt.toISOString() !== input.cycle ||
      flow.lastInteractionAt.toISOString() !== input.expectedInteraction ||
      flow.outcome !== "in_progress" ||
      flow.completedAt
    )
      return null;
    const meta = (flow.metadata as Record<string, unknown>) || {};
    if (meta.handoffRequest || meta.handoffReceipt) return null;
    const preSilenceStage =
      typeof meta.funnelStage === "string" && meta.funnelStage !== "sem_resposta"
        ? meta.funnelStage
        : typeof meta.preSilenceFunnelStage === "string"
          ? meta.preSilenceFunnelStage
          : "triagem";
    const [updated] = await tx
      .update(agentFlowStates)
      .set({
        currentStep: "Sem Resposta",
        outcome: "abandoned",
        lastInteractionAt: input.at,
        metadata: {
          ...meta,
          followUpStage: 3,
          preSilenceFunnelStage: preSilenceStage,
          funnelStage: "sem_resposta",
          noResponseAt: input.at.toISOString(),
          noResponseReason: input.reason.slice(0, 200),
          ...(input.partialLeadRescuedAt
            ? { partialLeadRescuedAt: input.partialLeadRescuedAt }
            : {}),
        },
      })
      .where(
        and(
          eq(agentFlowStates.tenantId, tenantId),
          eq(agentFlowStates.id, flow.id),
          eq(agentFlowStates.conversationId, conversationId),
        ),
      )
      .returning();
    await appendIndustrialJournal(tx, flow, updated, "status", "no_response");
    return updated;
  });
}
