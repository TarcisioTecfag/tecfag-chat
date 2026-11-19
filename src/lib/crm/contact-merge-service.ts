import crypto from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  agentFlowStates,
  aiConversationAudits,
  attendanceEventCycles,
  attendanceEvents,
  callSessions,
  commercialTransferResponseEvents,
  contactChannelIdentities,
  contactPhones,
  contacts,
  conversationDealContexts,
  conversations,
  crmAccountConversations,
  crmActionHistory,
  crmContactAccountHistory,
  crmConversationDeals,
  crmDealActivities,
  crmDealContacts,
  crmDealFiles,
  crmDealQuestionnaires,
  lcChats,
  mediaFiles,
  messages,
  rdMarketingCommercialOutbox,
  rdMarketingJourneyLinks,
  rdMarketingJourneyNotifications,
  responseTimeLogs,
  tasks,
  voiceCalls,
  whatsappConnectionContacts,
} from "../../db/schema";
import { CrmNotFoundError, CrmValidationError } from "./crm-service";

export type ConversationConflictStrategy = "merge_messages" | "block";

export interface MergeContactsParams {
  sourceContactId: string;
  targetContactId: string;
  reason?: string | null;
  preferSourceFields?: boolean;
  conversationConflictStrategy?: ConversationConflictStrategy;
  operatorId?: string | null;
  actorName?: string;
}

export interface MergeContactsResult {
  success: true;
  tenantId: string;
  targetContactId: string;
  mergedSourceContactId: string;
  mergedSourceContactName: string;
  contact: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    cpf: string | null;
    cnpj: string | null;
    accountId: string | null;
    tags: string[];
  };
  summary: {
    movedPhonesCount: number;
    deduplicatedPhonesCount: number;
    movedDealsCount: number;
    deduplicatedDealsCount: number;
    movedConversationsCount: number;
    mergedConversationsCount: number;
    movedMessagesCount: number;
    movedIdentitiesCount: number;
  };
}

function pickField<T>(
  targetVal: T | null | undefined,
  sourceVal: T | null | undefined,
  preferSource: boolean,
): T | null {
  const hasTarget = targetVal !== null && targetVal !== undefined && String(targetVal).trim() !== "";
  const hasSource = sourceVal !== null && sourceVal !== undefined && String(sourceVal).trim() !== "";
  if (preferSource) {
    return hasSource ? (sourceVal as T) : hasTarget ? (targetVal as T) : null;
  }
  return hasTarget ? (targetVal as T) : hasSource ? (sourceVal as T) : null;
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function parseStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
      }
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Mescla atomicamente um contato duplicado (`sourceContactId`) em um contato principal (`targetContactId`),
 * preservando 100% do histórico (telefones, cards do CRM, conversas, mensagens, auditorias e identidades)
 * com isolamento estrito por `tenantId` e tratamento explícito de todas as chaves únicas do schema.
 */
export async function mergeContactsInTenant(
  tenantId: string,
  params: MergeContactsParams,
): Promise<MergeContactsResult> {
  const sourceContactId = params.sourceContactId.trim();
  const targetContactId = params.targetContactId.trim();

  if (!sourceContactId || !targetContactId) {
    throw new CrmValidationError("Campos obrigatórios: 'sourceContactId' e 'targetContactId'.");
  }
  if (sourceContactId === targetContactId) {
    throw new CrmValidationError("Os contatos de origem e destino devem ser diferentes.");
  }

  const strategy: ConversationConflictStrategy =
    params.conversationConflictStrategy === "block" ? "block" : "merge_messages";
  const preferSource = params.preferSourceFields === true;
  const actorName = params.actorName?.trim() || "MCP";
  const reason = params.reason?.trim() || "Mesclagem de contato duplicado via MCP";

  return await db.transaction(async (tx) => {
    // 1. Trava ambos os contatos em ordem determinística para evitar deadlocks
    const orderedIds = [sourceContactId, targetContactId].sort();
    const lockedRows = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, orderedIds)))
      .orderBy(asc(contacts.id))
      .for("update");

    const source = lockedRows.find((c) => c.id === sourceContactId);
    const target = lockedRows.find((c) => c.id === targetContactId);

    if (!source) {
      throw new CrmNotFoundError(
        `Contato duplicado de origem ('${sourceContactId}') não encontrado no tenant '${tenantId}'.`,
      );
    }
    if (!target) {
      throw new CrmNotFoundError(
        `Contato principal de destino ('${targetContactId}') não encontrado no tenant '${tenantId}'.`,
      );
    }

    const now = new Date();
    const summary = {
      movedPhonesCount: 0,
      deduplicatedPhonesCount: 0,
      movedDealsCount: 0,
      deduplicatedDealsCount: 0,
      movedConversationsCount: 0,
      mergedConversationsCount: 0,
      movedMessagesCount: 0,
      movedIdentitiesCount: 0,
    };

    // 2. Verifica conflito de conversas cedo (quando strategy='block') antes de mutações
    const targetConvs = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, targetContactId)));
    const sourceConvs = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, sourceContactId)));

    const convKey = (connId: string | null) => connId ?? "__DEFAULT_CORPORATE__";
    const targetConvByKey = new Map(targetConvs.map((c) => [convKey(c.whatsappConnectionId), c]));

    if (strategy === "block") {
      for (const sc of sourceConvs) {
        const collidingTarget = targetConvByKey.get(convKey(sc.whatsappConnectionId));
        if (collidingTarget) {
          throw new CrmValidationError(
            `Conflito de conversa na mesma conexão (${sc.whatsappConnectionId || "corporativa"}): o contato de origem possui a conversa '${sc.id}' e o destino já possui '${collidingTarget.id}'. Use conversationConflictStrategy='merge_messages' para consolidar o histórico de mensagens.`,
            "CONVERSATION_CONFLICT",
          );
        }
      }
    }

    // 3. Libera o telefone no registro `contacts` de origem antes de migrar `contact_phones`
    // (evita bloqueio do trigger `trg_guard_contact_phones_entry` que impede 2 contatos com o mesmo telefone)
    if (source.phone) {
      await tx
        .update(contacts)
        .set({ phone: null, whatsappJid: null, whatsappUserId: null, updatedAt: now })
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, sourceContactId)));
    }

    // 4. Migração segura de contact_phones (respeitando trigger `guard_contact_phones_entry` e índice único)
    const targetPhones = await tx
      .select()
      .from(contactPhones)
      .where(and(eq(contactPhones.tenantId, tenantId), eq(contactPhones.contactId, targetContactId)));
    const sourcePhones = await tx
      .select()
      .from(contactPhones)
      .where(and(eq(contactPhones.tenantId, tenantId), eq(contactPhones.contactId, sourceContactId)));

    const targetByIdentity = new Map<string, typeof targetPhones[number]>();
    let targetHasPrimaryPhone = false;
    let maxTargetPosition = 0;
    for (const tp of targetPhones) {
      if (tp.phoneIdentity) targetByIdentity.set(tp.phoneIdentity, tp);
      if (tp.isPrimary) targetHasPrimaryPhone = true;
      if (tp.position > maxTargetPosition) maxTargetPosition = tp.position;
    }

    for (const sp of sourcePhones) {
      const existingTargetPhone = sp.phoneIdentity ? targetByIdentity.get(sp.phoneIdentity) : undefined;
      if (existingTargetPhone) {
        await tx
          .update(conversations)
          .set({ contactPhoneId: existingTargetPhone.id, updatedAt: now })
          .where(
            and(
              eq(conversations.tenantId, tenantId),
              eq(conversations.contactPhoneId, sp.id),
            ),
          );
        await tx
          .delete(contactPhones)
          .where(and(eq(contactPhones.tenantId, tenantId), eq(contactPhones.id, sp.id)));
        summary.deduplicatedPhonesCount++;
      } else {
        // Captura conversas que apontavam para este contactPhoneId (FK usa ON DELETE SET NULL)
        const linkedConvs = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, tenantId),
              eq(conversations.contactPhoneId, sp.id),
            ),
          );

        // Remove da origem e reinsere no destino (o trigger BEFORE UPDATE enxergaria a própria linha antiga em contact_phones)
        await tx
          .delete(contactPhones)
          .where(and(eq(contactPhones.tenantId, tenantId), eq(contactPhones.id, sp.id)));

        maxTargetPosition++;
        const nextIsPrimary = targetHasPrimaryPhone ? false : sp.isPrimary;
        const [insertedPhone] = await tx
          .insert(contactPhones)
          .values({
            id: sp.id,
            tenantId,
            contactId: targetContactId,
            phone: sp.phone,
            phoneIdentity: sp.phoneIdentity,
            type: sp.type,
            label: sp.label,
            isPrimary: nextIsPrimary,
            hasWhatsapp: sp.hasWhatsapp,
            whatsappJid: sp.whatsappJid,
            whatsappUserId: sp.whatsappUserId,
            position: maxTargetPosition,
            createdAt: sp.createdAt,
            updatedAt: now,
          })
          .returning();

        if (linkedConvs.length > 0 && insertedPhone) {
          await tx
            .update(conversations)
            .set({ contactPhoneId: insertedPhone.id, updatedAt: now })
            .where(
              and(
                eq(conversations.tenantId, tenantId),
                inArray(
                  conversations.id,
                  linkedConvs.map((c) => c.id),
                ),
              ),
            );
        }

        if (!targetHasPrimaryPhone && nextIsPrimary) targetHasPrimaryPhone = true;
        if (sp.phoneIdentity && insertedPhone) {
          targetByIdentity.set(sp.phoneIdentity, insertedPhone);
        }
        summary.movedPhonesCount++;
      }
    }

    // 5. Migração segura de crm_deal_contacts (respeitando idx_crm_deal_contacts_tenant_deal_contact_uniq)
    const targetDealLinks = await tx
      .select()
      .from(crmDealContacts)
      .where(and(eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.contactId, targetContactId)));
    const sourceDealLinks = await tx
      .select()
      .from(crmDealContacts)
      .where(and(eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.contactId, sourceContactId)));

    const targetLinkByDealId = new Map(targetDealLinks.map((l) => [l.dealId, l]));

    for (const sl of sourceDealLinks) {
      const existingTargetLink = targetLinkByDealId.get(sl.dealId);
      if (existingTargetLink) {
        if (sl.isPrimary && !existingTargetLink.isPrimary) {
          await tx
            .update(crmDealContacts)
            .set({ isPrimary: true })
            .where(and(eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.id, existingTargetLink.id)));
        }
        await tx
          .delete(crmDealContacts)
          .where(and(eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.id, sl.id)));
        summary.deduplicatedDealsCount++;
      } else {
        await tx
          .update(crmDealContacts)
          .set({ contactId: targetContactId })
          .where(and(eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.id, sl.id)));
        summary.movedDealsCount++;
      }
    }

    // 6. Migração segura de conversations (respeitando índices únicos por tenant+contact e connection+contact)
    for (const sc of sourceConvs) {
      const key = convKey(sc.whatsappConnectionId);
      const collidingTarget = targetConvByKey.get(key);

      if (!collidingTarget) {
        await tx
          .update(conversations)
          .set({ contactId: targetContactId, updatedAt: now })
          .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, sc.id)));
        targetConvByKey.set(key, { ...sc, contactId: targetContactId });
        summary.movedConversationsCount++;
        continue;
      }

      // Consolida todos os registros filhos de `sc.id` dentro de `collidingTarget.id`
      const movedMsgs = await tx
        .update(messages)
        .set({ conversationId: collidingTarget.id })
        .where(and(eq(messages.tenantId, tenantId), eq(messages.conversationId, sc.id)))
        .returning({ id: messages.id });
      summary.movedMessagesCount += movedMsgs.length;

      await tx
        .update(mediaFiles)
        .set({ conversationId: collidingTarget.id })
        .where(and(eq(mediaFiles.tenantId, tenantId), eq(mediaFiles.conversationId, sc.id)));
      await tx
        .update(callSessions)
        .set({ conversationId: collidingTarget.id })
        .where(and(eq(callSessions.tenantId, tenantId), eq(callSessions.conversationId, sc.id)));
      await tx
        .update(responseTimeLogs)
        .set({ conversationId: collidingTarget.id })
        .where(and(eq(responseTimeLogs.tenantId, tenantId), eq(responseTimeLogs.conversationId, sc.id)));
      await tx
        .update(aiConversationAudits)
        .set({ conversationId: collidingTarget.id })
        .where(and(eq(aiConversationAudits.tenantId, tenantId), eq(aiConversationAudits.conversationId, sc.id)));
      await tx
        .update(tasks)
        .set({ chatConversationId: collidingTarget.id })
        .where(and(eq(tasks.tenantId, tenantId), eq(tasks.chatConversationId, sc.id)));
      await tx
        .update(crmDealActivities)
        .set({ conversationId: collidingTarget.id })
        .where(and(eq(crmDealActivities.tenantId, tenantId), eq(crmDealActivities.conversationId, sc.id)));
      await tx
        .update(crmDealFiles)
        .set({ conversationId: collidingTarget.id })
        .where(and(eq(crmDealFiles.tenantId, tenantId), eq(crmDealFiles.conversationId, sc.id)));
      await tx
        .update(commercialTransferResponseEvents)
        .set({ conversationId: collidingTarget.id })
        .where(
          and(
            eq(commercialTransferResponseEvents.tenantId, tenantId),
            eq(commercialTransferResponseEvents.conversationId, sc.id),
          ),
        );
      await tx
        .update(agentFlowStates)
        .set({ conversationId: collidingTarget.id })
        .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.conversationId, sc.id)));
      await tx
        .update(lcChats)
        .set({ waConversationId: collidingTarget.id })
        .where(and(eq(lcChats.tenantId, tenantId), eq(lcChats.waConversationId, sc.id)));

      // crm_account_conversations (unique em tenantId + accountId + conversationId)
      const targetAccConvs = await tx
        .select({ accountId: crmAccountConversations.accountId })
        .from(crmAccountConversations)
        .where(
          and(
            eq(crmAccountConversations.tenantId, tenantId),
            eq(crmAccountConversations.conversationId, collidingTarget.id),
          ),
        );
      const targetAccSet = new Set(targetAccConvs.map((r) => r.accountId));
      const srcAccConvs = await tx
        .select()
        .from(crmAccountConversations)
        .where(
          and(
            eq(crmAccountConversations.tenantId, tenantId),
            eq(crmAccountConversations.conversationId, sc.id),
          ),
        );
      for (const ac of srcAccConvs) {
        if (targetAccSet.has(ac.accountId)) {
          await tx
            .delete(crmAccountConversations)
            .where(and(eq(crmAccountConversations.tenantId, tenantId), eq(crmAccountConversations.id, ac.id)));
        } else {
          await tx
            .update(crmAccountConversations)
            .set({ conversationId: collidingTarget.id })
            .where(and(eq(crmAccountConversations.tenantId, tenantId), eq(crmAccountConversations.id, ac.id)));
          targetAccSet.add(ac.accountId);
        }
      }

      // crm_conversation_deals (unique parcial quando is_active = true)
      const targetActiveDeals = await tx
        .select({ dealId: crmConversationDeals.dealId })
        .from(crmConversationDeals)
        .where(
          and(
            eq(crmConversationDeals.tenantId, tenantId),
            eq(crmConversationDeals.conversationId, collidingTarget.id),
            eq(crmConversationDeals.isActive, true),
          ),
        );
      const targetActiveDealSet = new Set(targetActiveDeals.map((r) => r.dealId));
      const srcConvDeals = await tx
        .select()
        .from(crmConversationDeals)
        .where(
          and(
            eq(crmConversationDeals.tenantId, tenantId),
            eq(crmConversationDeals.conversationId, sc.id),
          ),
        );
      for (const cd of srcConvDeals) {
        if (cd.isActive && targetActiveDealSet.has(cd.dealId)) {
          await tx
            .delete(crmConversationDeals)
            .where(and(eq(crmConversationDeals.tenantId, tenantId), eq(crmConversationDeals.id, cd.id)));
        } else {
          await tx
            .update(crmConversationDeals)
            .set({ conversationId: collidingTarget.id })
            .where(and(eq(crmConversationDeals.tenantId, tenantId), eq(crmConversationDeals.id, cd.id)));
          if (cd.isActive) targetActiveDealSet.add(cd.dealId);
        }
      }

      // conversation_deal_contexts (PK = conversationId)
      const [targetCtx] = await tx
        .select({ conversationId: conversationDealContexts.conversationId })
        .from(conversationDealContexts)
        .where(
          and(
            eq(conversationDealContexts.tenantId, tenantId),
            eq(conversationDealContexts.conversationId, collidingTarget.id),
          ),
        )
        .limit(1);
      if (targetCtx) {
        await tx
          .delete(conversationDealContexts)
          .where(
            and(
              eq(conversationDealContexts.tenantId, tenantId),
              eq(conversationDealContexts.conversationId, sc.id),
            ),
          );
      } else {
        await tx
          .update(conversationDealContexts)
          .set({ conversationId: collidingTarget.id, updatedAt: now })
          .where(
            and(
              eq(conversationDealContexts.tenantId, tenantId),
              eq(conversationDealContexts.conversationId, sc.id),
            ),
          );
      }

      // attendance_event_cycles (PK = conversationId)
      const [targetCycle] = await tx
        .select({ conversationId: attendanceEventCycles.conversationId })
        .from(attendanceEventCycles)
        .where(eq(attendanceEventCycles.conversationId, collidingTarget.id))
        .limit(1);
      if (targetCycle) {
        await tx
          .delete(attendanceEventCycles)
          .where(eq(attendanceEventCycles.conversationId, sc.id));
      } else {
        await tx
          .update(attendanceEventCycles)
          .set({ conversationId: collidingTarget.id })
          .where(eq(attendanceEventCycles.conversationId, sc.id));
      }

      // attendance_events (unique em tenantId + conversationId + sourceKey)
      const targetAttEvents = await tx
        .select({ sourceKey: attendanceEvents.sourceKey })
        .from(attendanceEvents)
        .where(
          and(
            eq(attendanceEvents.tenantId, tenantId),
            eq(attendanceEvents.conversationId, collidingTarget.id),
          ),
        );
      const targetSourceKeys = new Set(targetAttEvents.map((e) => e.sourceKey));
      const srcAttEvents = await tx
        .select()
        .from(attendanceEvents)
        .where(
          and(
            eq(attendanceEvents.tenantId, tenantId),
            eq(attendanceEvents.conversationId, sc.id),
          ),
        );
      for (const ev of srcAttEvents) {
        if (targetSourceKeys.has(ev.sourceKey)) {
          await tx
            .delete(attendanceEvents)
            .where(and(eq(attendanceEvents.tenantId, tenantId), eq(attendanceEvents.id, ev.id)));
        } else {
          await tx
            .update(attendanceEvents)
            .set({ conversationId: collidingTarget.id })
            .where(and(eq(attendanceEvents.tenantId, tenantId), eq(attendanceEvents.id, ev.id)));
          targetSourceKeys.add(ev.sourceKey);
        }
      }

      // Preserva metadados mais recentes na conversa de destino
      const shouldTakeSourcePreview =
        sc.lastMessageTime &&
        collidingTarget.lastMessageTime &&
        sc.lastMessageTime.getTime() > collidingTarget.lastMessageTime.getTime();
      await tx
        .update(conversations)
        .set({
          ...(shouldTakeSourcePreview
            ? {
                lastMessageTime: sc.lastMessageTime,
                lastMessageText: sc.lastMessageText,
              }
            : {}),
          unreadCount: (collidingTarget.unreadCount || 0) + (sc.unreadCount || 0),
          updatedAt: now,
        })
        .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, collidingTarget.id)));

      await tx
        .delete(conversations)
        .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, sc.id)));
      summary.mergedConversationsCount++;
    }

    // 5. Demais FKs que apontam para contacts.id
    const targetConnContacts = await tx
      .select({ connectionId: whatsappConnectionContacts.connectionId })
      .from(whatsappConnectionContacts)
      .where(
        and(
          eq(whatsappConnectionContacts.tenantId, tenantId),
          eq(whatsappConnectionContacts.contactId, targetContactId),
        ),
      );
    const targetConnSet = new Set(targetConnContacts.map((r) => r.connectionId));
    const srcConnContacts = await tx
      .select()
      .from(whatsappConnectionContacts)
      .where(
        and(
          eq(whatsappConnectionContacts.tenantId, tenantId),
          eq(whatsappConnectionContacts.contactId, sourceContactId),
        ),
      );
    for (const cc of srcConnContacts) {
      if (targetConnSet.has(cc.connectionId)) {
        await tx
          .delete(whatsappConnectionContacts)
          .where(
            and(
              eq(whatsappConnectionContacts.tenantId, tenantId),
              eq(whatsappConnectionContacts.id, cc.id),
            ),
          );
      } else {
        await tx
          .update(whatsappConnectionContacts)
          .set({ contactId: targetContactId })
          .where(
            and(
              eq(whatsappConnectionContacts.tenantId, tenantId),
              eq(whatsappConnectionContacts.id, cc.id),
            ),
          );
        targetConnSet.add(cc.connectionId);
      }
    }

    const movedIds = await tx
      .update(contactChannelIdentities)
      .set({ contactId: targetContactId })
      .where(
        and(
          eq(contactChannelIdentities.tenantId, tenantId),
          eq(contactChannelIdentities.contactId, sourceContactId),
        ),
      )
      .returning({ id: contactChannelIdentities.id });
    summary.movedIdentitiesCount = movedIds.length;

    await tx
      .update(crmContactAccountHistory)
      .set({ contactId: targetContactId })
      .where(
        and(
          eq(crmContactAccountHistory.tenantId, tenantId),
          eq(crmContactAccountHistory.contactId, sourceContactId),
        ),
      );
    await tx
      .update(crmDealQuestionnaires)
      .set({ contactId: targetContactId })
      .where(
        and(
          eq(crmDealQuestionnaires.tenantId, tenantId),
          eq(crmDealQuestionnaires.contactId, sourceContactId),
        ),
      );
    await tx
      .update(tasks)
      .set({ chatContactId: targetContactId })
      .where(and(eq(tasks.tenantId, tenantId), eq(tasks.chatContactId, sourceContactId)));
    await tx
      .update(voiceCalls)
      .set({ contactId: targetContactId })
      .where(and(eq(voiceCalls.tenantId, tenantId), eq(voiceCalls.contactId, sourceContactId)));

    // rd_marketing_journey_links tem unique em (tenantId, contactId)
    const [targetJourney] = await tx
      .select({ id: rdMarketingJourneyLinks.id })
      .from(rdMarketingJourneyLinks)
      .where(
        and(
          eq(rdMarketingJourneyLinks.tenantId, tenantId),
          eq(rdMarketingJourneyLinks.contactId, targetContactId),
        ),
      )
      .limit(1);
    if (targetJourney) {
      await tx
        .delete(rdMarketingJourneyLinks)
        .where(
          and(
            eq(rdMarketingJourneyLinks.tenantId, tenantId),
            eq(rdMarketingJourneyLinks.contactId, sourceContactId),
          ),
        );
    } else {
      await tx
        .update(rdMarketingJourneyLinks)
        .set({ contactId: targetContactId })
        .where(
          and(
            eq(rdMarketingJourneyLinks.tenantId, tenantId),
            eq(rdMarketingJourneyLinks.contactId, sourceContactId),
          ),
        );
    }

    await tx
      .update(rdMarketingJourneyNotifications)
      .set({ contactId: targetContactId })
      .where(
        and(
          eq(rdMarketingJourneyNotifications.tenantId, tenantId),
          eq(rdMarketingJourneyNotifications.contactId, sourceContactId),
        ),
      );
    await tx
      .update(rdMarketingCommercialOutbox)
      .set({ contactId: targetContactId })
      .where(
        and(
          eq(rdMarketingCommercialOutbox.tenantId, tenantId),
          eq(rdMarketingCommercialOutbox.contactId, sourceContactId),
        ),
      );

    // 6. Consolida atributos do contato principal sem perder dados preenchidos
    const mergedTags = Array.from(
      new Set([...parseStringArray(target.tags), ...parseStringArray(source.tags)]),
    );
    const mergedCustomFields = preferSource
      ? { ...parseJsonObject(target.customFields), ...parseJsonObject(source.customFields) }
      : { ...parseJsonObject(source.customFields), ...parseJsonObject(target.customFields) };
    const mergedCnpjDetails = preferSource
      ? { ...parseJsonObject(target.cnpjDetails), ...parseJsonObject(source.cnpjDetails) }
      : { ...parseJsonObject(source.cnpjDetails), ...parseJsonObject(target.cnpjDetails) };

    const [updatedTarget] = await tx
      .update(contacts)
      .set({
        phone: pickField(target.phone, source.phone, preferSource),
        whatsappJid: pickField(target.whatsappJid, source.whatsappJid, preferSource),
        whatsappUserId: pickField(target.whatsappUserId, source.whatsappUserId, preferSource),
        whatsappUsername: pickField(target.whatsappUsername, source.whatsappUsername, preferSource),
        email: pickField(target.email, source.email, preferSource),
        cpf: pickField(target.cpf, source.cpf, preferSource),
        cnpj: pickField(target.cnpj, source.cnpj, preferSource),
        accountId: pickField(target.accountId, source.accountId, preferSource),
        avatar: pickField(target.avatar, source.avatar, preferSource),
        walletOperatorId: pickField(target.walletOperatorId, source.walletOperatorId, preferSource),
        entryChannel: pickField(target.entryChannel, source.entryChannel, preferSource),
        firstSource: pickField(target.firstSource, source.firstSource, preferSource),
        firstCampaign: pickField(target.firstCampaign, source.firstCampaign, preferSource),
        utmSource: pickField(target.utmSource, source.utmSource, preferSource),
        utmMedium: pickField(target.utmMedium, source.utmMedium, preferSource),
        utmCampaign: pickField(target.utmCampaign, source.utmCampaign, preferSource),
        utmContent: pickField(target.utmContent, source.utmContent, preferSource),
        utmTerm: pickField(target.utmTerm, source.utmTerm, preferSource),
        clickId: pickField(target.clickId, source.clickId, preferSource),
        landingPage: pickField(target.landingPage, source.landingPage, preferSource),
        sectorOrigin: pickField(target.sectorOrigin, source.sectorOrigin, preferSource),
        tags: mergedTags,
        customFields: mergedCustomFields,
        cnpjDetails: mergedCnpjDetails,
        updatedAt: now,
      })
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, targetContactId)))
      .returning();

    // 7. Remove o contato duplicado já esvaziado
    await tx
      .delete(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, sourceContactId)));

    // 8. Registra auditoria administrativa permanente
    await tx.insert(crmActionHistory).values({
      id: crypto.randomUUID(),
      tenantId,
      operatorId: params.operatorId ?? null,
      operatorName: actorName,
      action: "merge_contacts",
      entityType: "contact",
      itemCount: 1,
      details: {
        sourceContactId,
        sourceContactName: source.name,
        sourceContactPhone: source.phone,
        targetContactId,
        targetContactName: updatedTarget.name,
        reason,
        conversationConflictStrategy: strategy,
        preferSourceFields: preferSource,
        summary,
        source: "mcp",
      },
      createdAt: now,
    });

    return {
      success: true,
      tenantId,
      targetContactId: updatedTarget.id,
      mergedSourceContactId: sourceContactId,
      mergedSourceContactName: source.name,
      contact: {
        id: updatedTarget.id,
        name: updatedTarget.name,
        phone: updatedTarget.phone,
        email: updatedTarget.email,
        cpf: updatedTarget.cpf,
        cnpj: updatedTarget.cnpj,
        accountId: updatedTarget.accountId,
        tags: parseStringArray(updatedTarget.tags),
      },
      summary,
    };
  });
}
