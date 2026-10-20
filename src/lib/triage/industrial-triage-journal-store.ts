import { and, desc, eq, sql } from "drizzle-orm";
import {
  conversations,
  messages,
  crmConversationDeals,
  crmDeals,
  crmDealActivities,
} from "../../db/schema";
import { buildIndustrialBriefing } from "./industrial-briefing";
import type { IndustrialTransaction } from "./industrial-rodizio-store";
import {
  buildJournalEntry,
  journalIso,
  type JournalFlow,
  type TriageJournalKind,
} from "./industrial-triage-journal";

/** O chamador mantém a mesma transação da alteração de estado; leitura nunca escreve notas. */
export async function appendIndustrialJournal(
  tx: IndustrialTransaction,
  before: JournalFlow | null,
  after: JournalFlow,
  kind: TriageJournalKind,
  sourceKey: string,
): Promise<string | null> {
  // Antes de retirar o metadado limitado a 20 itens, preserva os resumos ainda disponíveis.
  if (kind === "archive" && after.metadata && typeof after.metadata === "object") {
    const summaries = (after.metadata as Record<string, unknown>).previousTriages;
    if (Array.isArray(summaries))
      for (const item of summaries.slice(-100)) {
        if (
          !item ||
          typeof item !== "object" ||
          typeof item.id !== "string" ||
          !item.id ||
          item.id.length > 240
        )
          continue;
        const startedAt = journalIso(item.startedAt);
        if (!startedAt) continue;
        await appendIndustrialJournal(
          tx,
          null,
          {
            id: item.id,
            tenantId: after.tenantId,
            conversationId: after.conversationId,
            startedAt,
            lastInteractionAt: journalIso(item.completedAt) || startedAt,
            completedAt: journalIso(item.completedAt),
            outcome: typeof item.outcome === "string" ? item.outcome : null,
            currentStep: "Resumo legado",
            collectedData: {},
            metadata: { targetFunnel: item.targetFunnel },
          },
          "legacy_summary",
          "legacy-summary",
        );
      }
  }
  const entry = buildJournalEntry(before, after, kind, sourceKey);
  if (!entry) return null;
  const summary = buildIndustrialBriefing(entry.metadata.snapshot);
  const briefing =
    kind !== "legacy_summary" &&
    (kind === "human_review" ||
      (summary.final &&
        ["handoff", "archive", "manual_stop", "continuity", "status"].includes(kind)))
      ? summary
      : null;
  const [conversation] = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(eq(conversations.tenantId, after.tenantId), eq(conversations.id, after.conversationId)),
    )
    .limit(1);
  if (!conversation) throw new Error("Conversa indisponível para registrar a triagem");
  const [last] = await tx
    .select({ sentAt: messages.sentAt })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, after.tenantId),
        eq(messages.conversationId, after.conversationId),
        eq(messages.isInternalNote, true),
        sql`${messages.metaDetails}->'industrialTriage'->>'cycleId' = ${entry.metadata.cycleId}`,
      ),
    )
    .orderBy(desc(messages.sentAt), desc(messages.id))
    .limit(1);
  // Os escritores mantêm o lock do fluxo/conversa. Milissegundos iguais não invertem snapshots.
  const recordedAt = new Date(Math.max(Date.now(), last ? +last.sentAt + 1 : 0));
  const [saved] = await tx
    .insert(messages)
    .values({
      id: entry.id,
      tenantId: after.tenantId,
      conversationId: after.conversationId,
      senderType: "system",
      senderName: "Sistema",
      content: briefing ? `${entry.content}\n\n${briefing.text}` : entry.content,
      isInternalNote: true,
      direction: "outbound",
      provider: "system",
      status: "accepted",
      metaDetails: { industrialTriage: { ...entry.metadata, ...(briefing ? { briefing } : {}) } },
      sentAt: recordedAt,
      updatedAt: recordedAt,
    })
    .onConflictDoNothing()
    .returning({ id: messages.id });
  if (saved && briefing && entry.metadata.snapshot.dealId) {
    const [linked] = await tx
      .select({ id: crmDeals.id })
      .from(crmConversationDeals)
      .innerJoin(
        crmDeals,
        and(eq(crmDeals.id, crmConversationDeals.dealId), eq(crmDeals.tenantId, after.tenantId)),
      )
      .where(
        and(
          eq(crmConversationDeals.tenantId, after.tenantId),
          eq(crmConversationDeals.conversationId, after.conversationId),
          eq(crmConversationDeals.dealId, entry.metadata.snapshot.dealId),
          eq(crmConversationDeals.isActive, true),
        ),
      )
      .limit(1);
    if (linked)
      await tx
        .insert(crmDealActivities)
        .values({
          id: `brief-${entry.id}`,
          tenantId: after.tenantId,
          conversationId: after.conversationId,
          dealId: linked.id,
          type: "note",
          status: "completed",
          title:
            kind === "human_review" ? "Revisão humana da triagem" : "Briefing final da triagem",
          description: briefing.text,
          operatorId:
            kind === "human_review" ? entry.metadata.snapshot.humanReview?.operatorId : null,
          completedAt: recordedAt,
          createdAt: recordedAt,
          updatedAt: recordedAt,
        })
        .onConflictDoNothing();
  }
  return saved?.id || null;
}
