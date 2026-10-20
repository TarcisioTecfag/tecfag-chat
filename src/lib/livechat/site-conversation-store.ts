import { and, desc, eq, sql } from "drizzle-orm";
import { agentFlowStates, conversations, messages } from "../../db/schema";
import type { IndustrialDatabase, IndustrialTransaction } from "../triage/industrial-rodizio-store";
import { SITE_CHANNEL } from "./site-channel-policy";
import { appendIndustrialJournal } from "../triage/industrial-triage-journal-store";

/** A conversa é travada antes dos fluxos, na mesma ordem usada pelo handoff. */
export async function reopenIndustrialSiteConversation(
  database: IndustrialDatabase,
  tenantId: string,
  conversationId: string,
  inboundMessageId?: string,
) {
  return database.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
      .for("update");
    // Revalidar após o lock impede dois reinícios ou a sobrescrita de uma tomada humana.
    if (!conversation || conversation.queueState !== "finalizados") return null;

    // Retry de uma mensagem já recebida não inicia atendimento novo após o encerramento.
    if (inboundMessageId) {
      const [existing] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, tenantId),
            eq(messages.conversationId, conversationId),
            eq(messages.id, inboundMessageId),
          ),
        )
        .limit(1);
      if (existing) return null;
    }

    const sdrScope = and(
      eq(agentFlowStates.tenantId, tenantId),
      eq(agentFlowStates.conversationId, conversationId),
      eq(agentFlowStates.agentType, "sdr"),
    );
    const flows = await tx.select().from(agentFlowStates).where(sdrScope).for("update");
    const previousTriages: unknown[] = [];
    const now = new Date();
    for (const flow of flows) {
      await appendIndustrialJournal(tx, null, { ...flow, completedAt: flow.completedAt || now, outcome: flow.outcome === "in_progress" ? "completed" : flow.outcome }, "archive", "site_reopen");
      const meta = (flow.metadata as Record<string, unknown>) || {};
      if (Array.isArray(meta.previousTriages)) previousTriages.push(...meta.previousTriages);
      previousTriages.push({
        id: flow.id,
        startedAt: flow.startedAt.toISOString(),
        completedAt: (flow.completedAt || flow.lastInteractionAt || now).toISOString(),
        outcome: flow.outcome && flow.outcome !== "in_progress" ? flow.outcome : "completed",
        targetFunnel: meta.targetFunnel || null,
        responsibleName: meta.allocatedOperatorName || null,
      });
    }
    await tx.delete(agentFlowStates).where(sdrScope);
    await tx.insert(agentFlowStates).values({
      id: `fs-sdr-${tenantId}-${conversationId}`,
      tenantId,
      conversationId,
      agentType: "sdr",
      currentStep: "Em Qualificação",
      collectedData: {},
      metadata: {
        stepNumber: 1,
        totalSteps: 7,
        followUpStage: 0,
        funnelStage: "triagem",
        targetFunnel: null,
        channel: SITE_CHANNEL,
        previousTriages: previousTriages.slice(-20),
      },
      startedAt: new Date(Math.max(now.getTime() - 2000, ...flows.map(row => +row.startedAt + 1))),
      lastInteractionAt: now,
      outcome: "in_progress",
    });
    const [reopened] = await tx
      .update(conversations)
      .set({
        queueState: "automacao",
        operatorId: null,
        sectorId: null,
        updatedAt: now,
        version: sql`${conversations.version} + 1`,
      })
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
      .returning();
    return reopened;
  });
}

/** Últimas 200 mensagens externas, devolvidas em ordem cronológica com desempate estável. */
export async function readSiteContinuationHistory(
  tx: IndustrialDatabase | IndustrialTransaction,
  tenantId: string,
  conversationId: string,
) {
  const rows = await tx
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, tenantId),
        eq(messages.conversationId, conversationId),
        eq(messages.isInternalNote, false),
      ),
    )
    .orderBy(desc(messages.sentAt), desc(messages.id))
    .limit(200);
  return rows.reverse();
}
