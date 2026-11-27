import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { agentFlowStates, conversations, lcChats } from "../../db/schema";
import { isSiteConversationId, visitorIdFromSiteConversation } from "../livechat/site-channel-policy";
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

    // Canal Site (`conv-lc-*`): ao encerrar sessão expirada por inatividade como Sem Resposta,
    // finaliza também a conversa em `automacao` e o `lc_chats` aberto para que não continue
    // aparecendo como triagem ativa em `Automação` ou `Visitantes do Site`.
    // Se o visitante retornar depois no site, o livechat reabre a conversa automaticamente.
    if (isSiteConversationId(conversationId)) {
      await tx
        .update(conversations)
        .set({
          queueState: "finalizados",
          unreadCount: 0,
          updatedAt: input.at,
          version: sql`${conversations.version} + 1`,
        })
        .where(
          and(
            eq(conversations.tenantId, tenantId),
            eq(conversations.id, conversationId),
            isNull(conversations.operatorId),
            eq(conversations.queueState, "automacao"),
          ),
        );

      const visitorId = visitorIdFromSiteConversation(conversationId);
      if (visitorId) {
        await tx
          .update(lcChats)
          .set({
            status: "closed",
            outcome: "abandoned",
            closedAt: input.at,
          })
          .where(
            and(
              eq(lcChats.tenantId, tenantId),
              eq(lcChats.visitorId, visitorId),
              inArray(lcChats.status, ["active", "operator_took_over"]),
            ),
          );
      }
    }

    return updated;
  });
}
