import { and, asc, desc, eq, exists, or, sql } from "drizzle-orm";
import {
  conversations,
  crmAccounts,
  crmConversationDeals,
  crmDealContacts,
  crmDeals,
  crmPipelines,
  crmStages,
  operators,
} from "../../db/schema";
import type { DealTransaction } from "./deal-associations";

/** Mesma relação de contato para chat, seleção atual e jornada, sem depender de sincronização da UI. */
export async function getContactDealRows(
  reader: Pick<DealTransaction, "select">,
  tenantId: string,
  contactId: string,
) {
  const participant = exists(
    reader
      .select({ id: crmDealContacts.id })
      .from(crmDealContacts)
      .where(
        and(
          eq(crmDealContacts.tenantId, tenantId),
          eq(crmDealContacts.contactId, contactId),
          eq(crmDealContacts.dealId, crmDeals.id),
        ),
      ),
  );
  const conversationLink = (activeOnly: boolean) =>
    exists(
      reader
        .select({ id: crmConversationDeals.id })
        .from(crmConversationDeals)
        .innerJoin(
          conversations,
          and(
            eq(conversations.tenantId, tenantId),
            eq(conversations.id, crmConversationDeals.conversationId),
          ),
        )
        .where(
          and(
            eq(crmConversationDeals.tenantId, tenantId),
            eq(conversations.tenantId, tenantId),
            eq(conversations.contactId, contactId),
            eq(crmConversationDeals.dealId, crmDeals.id),
            activeOnly ? eq(crmConversationDeals.isActive, true) : undefined,
          ),
        ),
    );
  const rows = await reader
    .select({
      deal: crmDeals,
      stageName: crmStages.name,
      stageOrderIndex: crmStages.orderIndex,
      pipelineName: crmPipelines.name,
      accountName: crmAccounts.name,
      operatorName: operators.name,
      isLinked: sql<boolean>`(${participant} OR ${conversationLink(true)})`,
    })
    .from(crmDeals)
    .leftJoin(crmStages, and(eq(crmStages.tenantId, tenantId), eq(crmStages.id, crmDeals.stageId)))
    .leftJoin(
      crmPipelines,
      and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, crmDeals.pipelineId)),
    )
    .leftJoin(
      crmAccounts,
      and(eq(crmAccounts.tenantId, tenantId), eq(crmAccounts.id, crmDeals.accountId)),
    )
    .leftJoin(
      operators,
      and(eq(operators.tenantId, tenantId), eq(operators.id, crmDeals.operatorId)),
    )
    .where(and(eq(crmDeals.tenantId, tenantId), or(participant, conversationLink(false))))
    .orderBy(
      sql`CASE WHEN ${crmDeals.status} = 'open' THEN 0 ELSE 1 END`,
      desc(crmDeals.createdAt),
      asc(crmDeals.id),
    );
  return rows.map(({ deal, ...details }) => ({ ...deal, ...details, stageColor: null }));
}
