import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { agentFlowStates, conversations, messages } from "../../db/schema";
import type { IndustrialDatabase, IndustrialTransaction } from "./industrial-rodizio-store";
import { appendIndustrialJournal } from "./industrial-triage-journal-store";
import { buildJournalSnapshot } from "./industrial-triage-journal";

/** Arquiva e reinicia apenas o SDR, na mesma transação e com deduplicação da entrada. */
export async function restartIndustrialCycle(
  database: IndustrialDatabase | IndustrialTransaction,
  tenantId: string,
  conversationId: string,
  input: {
    reason: "reset" | "reopened" | "wallet_released";
    sourceKey: string;
    receivedAt?: Date;
  },
) {
  const markerId = `triage-start-${createHash("sha256")
    .update(JSON.stringify([tenantId, conversationId, input.reason, input.sourceKey]))
    .digest("hex")
    .slice(0, 40)}`;
  return database.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
      .for("update");
    if (!conversation) return null;
    const [duplicate] = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, tenantId),
          eq(messages.conversationId, conversationId),
          eq(messages.id, markerId),
        ),
      )
      .limit(1);
    if (duplicate) return { conversation, replayed: true };
    if (
      input.reason === "reopened" &&
      (conversation.operatorId || conversation.queueState === "meus")
    )
      return null;
    const scope = and(
      eq(agentFlowStates.tenantId, tenantId),
      eq(agentFlowStates.conversationId, conversationId),
      eq(agentFlowStates.agentType, "sdr"),
    );
    const flows = await tx.select().from(agentFlowStates).where(scope).for("update");
    const now = new Date();
    const previousTriages: unknown[] = [];
    for (const flow of flows) {
      const meta = (flow.metadata as Record<string, unknown>) || {};
      if (Array.isArray(meta.previousTriages)) previousTriages.push(...meta.previousTriages);
      const archived = {
        ...flow,
        completedAt: flow.completedAt || now,
        outcome: flow.outcome && flow.outcome !== "in_progress" ? flow.outcome : input.reason,
      };
      await appendIndustrialJournal(tx, null, archived, "archive", input.sourceKey);
      const flowData = (flow.collectedData as Record<string, { value?: string }>) || {};
      previousTriages.push({
        id: flow.id,
        startedAt: flow.startedAt.toISOString(),
        completedAt: archived.completedAt.toISOString(),
        outcome: archived.outcome,
        targetFunnel: meta.targetFunnel || null,
        subflow: meta.subflow || null,
        company: flowData["EMPRESA"]?.value || null,
        document:
          flowData["CNPJ OU CPF"]?.value ||
          flowData["CNPJ"]?.value ||
          flowData["CPF"]?.value ||
          null,
        clientName: flowData["NOME COMPLETO"]?.value || null,
        interest:
          flowData["MÁQUINA / PEÇA / INTERESSE"]?.value ||
          flowData["SOLICITAÇÃO"]?.value ||
          flowData["QUAL O TIPO DE PRODUTO?"]?.value ||
          null,
        responsibleName:
          (meta.allocatedOperatorName as string | undefined) ||
          (conversation as { responsibleName?: string | null }).responsibleName ||
          null,
      });
    }
    await tx.delete(agentFlowStates).where(scope);
    const receivedTime =
      input.receivedAt && Number.isFinite(+input.receivedAt)
        ? Math.min(+input.receivedAt, +now)
        : +now;
    const [flow] = await tx
      .insert(agentFlowStates)
      .values({
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
          previousTriages: previousTriages.slice(-20),
        },
        startedAt: new Date(
          Math.max(receivedTime - 2000, ...flows.map((row) => +row.startedAt + 1)),
        ),
        lastInteractionAt: now,
        outcome: "in_progress",
      })
      .returning();
    await tx.insert(messages).values({
      id: markerId,
      tenantId,
      conversationId,
      senderType: "system",
      senderName: "Sistema",
      content: "Novo ciclo de triagem iniciado",
      isInternalNote: true,
      provider: "system",
      direction: "outbound",
      status: "accepted",
      metaDetails: {
        industrialTriage: {
          version: 1,
          kind: "started",
          cycleId: buildJournalSnapshot(flow).cycleId,
          snapshot: buildJournalSnapshot(flow),
          changedFields: [],
        },
      },
      sentAt: now,
      updatedAt: now,
    });
    const [updated] = await tx
      .update(conversations)
      .set({
        operatorId: null,
        sectorId: null,
        queueState: "automacao",
        unreadCount: input.reason === "reset" ? 0 : conversation.unreadCount,
        version: sql`${conversations.version} + 1`,
        updatedAt: now,
      })
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
      .returning();
    return { conversation: updated, replayed: false };
  });
}
