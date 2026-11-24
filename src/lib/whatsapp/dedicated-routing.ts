import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  contacts,
  conversationDealContexts,
  conversations,
  crmConversationDeals,
  messages,
  operators,
  whatsappConnectionContacts,
  whatsappConnections,
} from "../../db/schema";
import { setAttendanceActor } from "../attendance-events";
import { endDealContext, recordConversationAction } from "../crm/conversation-deal-context";
import { lockContactDeals, syncConversationDeals } from "../crm/deal-associations";
import { isSiteConversationId } from "../livechat/site-channel-policy";
import { conversationConnectionCondition } from "./connections";
import { multiConnectionEnabled } from "./connection-policy";

export type DedicatedDbExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface DedicatedConnectionInfo {
  id: string;
  name: string;
  provider: "baileys";
  ownerOperatorId: string;
  pairedPhone: string | null;
  status: string;
  isConnectedLive: boolean;
}

export interface DedicatedOperatorStatus {
  dedicated: boolean;
  connection: DedicatedConnectionInfo | null;
}

export interface HandoffAcrossChannelsParams {
  tenantId: string;
  sourceConversation: typeof conversations.$inferSelect;
  targetConnectionId: string | null;
  targetConnectionInfo?: DedicatedConnectionInfo | null;
  targetQueueState: "meus" | "fila" | "automacao";
  targetOperatorId: string | null;
  targetOperatorName?: string | null;
  targetSectorId?: string | null;
  targetSectorName?: string | null;
  actorOperatorId?: string | null;
  actorName: string;
  preferredDealId?: string | null;
  sourceSystemMessageText?: string | null;
  targetSystemMessageText?: string | null;
  lastMessagePreview?: string | null;
  sourceMetaDetails?: Record<string, unknown>;
  targetMetaDetails?: Record<string, unknown>;
  preserveSourceOperatorId?: string | null;
  updateContactWallet?: boolean;
  now?: Date;
}

export interface HandoffAcrossChannelsResult {
  redirected: boolean;
  sourceConversation: typeof conversations.$inferSelect;
  targetConversation: typeof conversations.$inferSelect;
  targetConnection: DedicatedConnectionInfo | null;
  sourceSystemMessageId: string | null;
  targetSystemMessageId: string | null;
  transferredDealId: string | null;
}

export interface RouteMetaInboundToDedicatedResult {
  redirected: boolean;
  corporateConversation: typeof conversations.$inferSelect;
  dedicatedConversation: typeof conversations.$inferSelect | null;
  dedicatedConnection: DedicatedConnectionInfo | null;
  systemMessageId: string | null;
}

function isLiveLease(status: string | null | undefined, leaseUntil: Date | null | undefined, nowMs = Date.now()): boolean {
  return status === "connected" && Boolean(leaseUntil && leaseUntil.getTime() > nowMs);
}

function isMissingRelationError(error: unknown): boolean {
  const code = (error as any)?.code ?? (error as any)?.cause?.code;
  return code === "42P01";
}

/**
 * Resolve a conexão Baileys pessoal habilitada cujo titular (`ownerOperatorId`)
 * é o operador informado neste tenant.
 *
 * - Retorna `null` imediatamente quando múltiplas conexões não estão habilitadas no tenant
 *   (preserva 100% tenants como `valem`).
 * - Prioriza conexão atualmente conectada com lease ativo; caso todas estejam desconectadas,
 *   ainda retorna a conexão habilitada mais recente com `isConnectedLive: false` para que
 *   o atendimento nunca vaze para a API Oficial da Meta.
 */
export async function resolveOperatorDedicatedConnection(
  executor: DedicatedDbExecutor,
  tenantId: string,
  operatorId: string | null | undefined,
): Promise<DedicatedConnectionInfo | null> {
  if (!tenantId || !operatorId || !multiConnectionEnabled(tenantId)) {
    return null;
  }

  const rows = await executor
    .select({
      id: whatsappConnections.id,
      name: whatsappConnections.name,
      provider: whatsappConnections.provider,
      ownerOperatorId: whatsappConnections.ownerOperatorId,
      pairedPhone: whatsappConnections.baileysPairedPhone,
      status: whatsappConnections.baileysSessionStatus,
      leaseUntil: whatsappConnections.leaseUntil,
      updatedAt: whatsappConnections.updatedAt,
      createdAt: whatsappConnections.createdAt,
    })
    .from(whatsappConnections)
    .where(
      and(
        eq(whatsappConnections.tenantId, tenantId),
        eq(whatsappConnections.ownerOperatorId, operatorId),
        eq(whatsappConnections.provider, "baileys"),
        eq(whatsappConnections.enabled, true),
      ),
    )
    .orderBy(desc(whatsappConnections.updatedAt), desc(whatsappConnections.createdAt));

  if (!rows.length) return null;

  const nowMs = Date.now();
  const mapped: DedicatedConnectionInfo[] = rows.map((row) => {
    const connectedLive = isLiveLease(row.status, row.leaseUntil, nowMs);
    return {
      id: row.id,
      name: row.name,
      provider: "baileys",
      ownerOperatorId: row.ownerOperatorId || operatorId,
      pairedPhone: row.pairedPhone ?? null,
      status: connectedLive ? "connected" : "disconnected",
      isConnectedLive: connectedLive,
    };
  });

  return mapped.find((c) => c.isConnectedLive) || mapped[0];
}

/**
 * Carrega mapa de conexões Baileys dedicadas por `ownerOperatorId` para exibição em listas
 * (ex.: painel de aprovação SDR ou modal de transferência) em uma única query por tenant.
 */
export async function listDedicatedConnectionsByOperator(
  executor: DedicatedDbExecutor,
  tenantId: string,
): Promise<Map<string, DedicatedConnectionInfo>> {
  const result = new Map<string, DedicatedConnectionInfo>();
  if (!tenantId || !multiConnectionEnabled(tenantId)) return result;

  const rows = await executor
    .select({
      id: whatsappConnections.id,
      name: whatsappConnections.name,
      ownerOperatorId: whatsappConnections.ownerOperatorId,
      pairedPhone: whatsappConnections.baileysPairedPhone,
      status: whatsappConnections.baileysSessionStatus,
      leaseUntil: whatsappConnections.leaseUntil,
      updatedAt: whatsappConnections.updatedAt,
      createdAt: whatsappConnections.createdAt,
    })
    .from(whatsappConnections)
    .where(
      and(
        eq(whatsappConnections.tenantId, tenantId),
        eq(whatsappConnections.provider, "baileys"),
        eq(whatsappConnections.enabled, true),
      ),
    )
    .orderBy(desc(whatsappConnections.updatedAt), desc(whatsappConnections.createdAt));

  const nowMs = Date.now();
  for (const row of rows) {
    if (!row.ownerOperatorId) continue;
    const connectedLive = isLiveLease(row.status, row.leaseUntil, nowMs);
    const candidate: DedicatedConnectionInfo = {
      id: row.id,
      name: row.name,
      provider: "baileys",
      ownerOperatorId: row.ownerOperatorId,
      pairedPhone: row.pairedPhone ?? null,
      status: connectedLive ? "connected" : "disconnected",
      isConnectedLive: connectedLive,
    };
    const existing = result.get(row.ownerOperatorId);
    if (!existing || (!existing.isConnectedLive && candidate.isConnectedLive)) {
      result.set(row.ownerOperatorId, candidate);
    }
  }
  return result;
}

/**
 * Indica se o operador está travado exclusivamente no próprio WhatsApp Baileys dedicado
 * para envio de mensagens externas (impedindo envio pelo WhatsApp Oficial da empresa).
 *
 * Administradores (`role === "admin"`) mantêm master override para operar o número corporativo.
 */
export async function isStrictDedicatedBaileysOperator(
  executor: DedicatedDbExecutor,
  tenantId: string,
  operatorId: string | null | undefined,
  operatorRole?: string | null,
): Promise<DedicatedOperatorStatus> {
  if (!operatorId || operatorRole === "admin") {
    return { dedicated: false, connection: null };
  }
  const connection = await resolveOperatorDedicatedConnection(executor, tenantId, operatorId);
  return {
    dedicated: Boolean(connection),
    connection,
  };
}

/**
 * Resolve o `whatsappConnectionId` de destino para uma transferência ou captura:
 * - Quando o destino é `meus` para um operador que possui conexão Baileys habilitada → `conn.id`.
 * - Quando o destino é `meus` para um operador sem Baileys dedicado, ou `fila` / `automacao` → `null` (Oficial Meta).
 */
export async function resolveTargetConnectionForTransfer(
  executor: DedicatedDbExecutor,
  tenantId: string,
  queueState: string,
  targetOperatorId: string | null | undefined,
): Promise<{ connectionId: string | null; connectionInfo: DedicatedConnectionInfo | null }> {
  if (queueState === "meus" && targetOperatorId) {
    const dedicated = await resolveOperatorDedicatedConnection(executor, tenantId, targetOperatorId);
    if (dedicated) {
      return { connectionId: dedicated.id, connectionInfo: dedicated };
    }
  }
  return { connectionId: null, connectionInfo: null };
}

async function copyDealLinksAndContext(
  tx: DedicatedDbExecutor,
  params: {
    tenantId: string;
    sourceConversationId: string;
    targetConversationId: string;
    contactId: string;
    actorOperatorId: string | null;
    preferredDealId?: string | null;
    now: Date;
  },
): Promise<string | null> {
  const {
    tenantId,
    sourceConversationId,
    targetConversationId,
    contactId,
    actorOperatorId,
    preferredDealId,
    now,
  } = params;

  let resolvedDealId: string | null = preferredDealId || null;

  try {
    const [sourceCtx] = await tx
      .select({
        currentDealId: conversationDealContexts.currentDealId,
        previousDealId: conversationDealContexts.previousDealId,
      })
      .from(conversationDealContexts)
      .where(
        and(
          eq(conversationDealContexts.tenantId, tenantId),
          eq(conversationDealContexts.conversationId, sourceConversationId),
        ),
      )
      .limit(1);

    if (!resolvedDealId) {
      resolvedDealId = sourceCtx?.currentDealId || null;
    }

    const activeSourceLinks = await tx
      .select({
        dealId: crmConversationDeals.dealId,
        origin: crmConversationDeals.origin,
      })
      .from(crmConversationDeals)
      .where(
        and(
          eq(crmConversationDeals.tenantId, tenantId),
          eq(crmConversationDeals.conversationId, sourceConversationId),
          eq(crmConversationDeals.isActive, true),
        ),
      );

    const dealIdsToLink = new Set<string>(activeSourceLinks.map((row) => row.dealId));
    if (resolvedDealId) dealIdsToLink.add(resolvedDealId);

    if (dealIdsToLink.size > 0) {
      const existingTargetLinks = await tx
        .select({
          id: crmConversationDeals.id,
          dealId: crmConversationDeals.dealId,
          isActive: crmConversationDeals.isActive,
        })
        .from(crmConversationDeals)
        .where(
          and(
            eq(crmConversationDeals.tenantId, tenantId),
            eq(crmConversationDeals.conversationId, targetConversationId),
            inArray(crmConversationDeals.dealId, [...dealIdsToLink]),
          ),
        );

      const existingByDeal = new Map(existingTargetLinks.map((row) => [row.dealId, row]));

      for (const dealId of dealIdsToLink) {
        const existing = existingByDeal.get(dealId);
        if (!existing) {
          await tx
            .insert(crmConversationDeals)
            .values({
              id: `cd-${randomUUID()}`,
              tenantId,
              conversationId: targetConversationId,
              dealId,
              origin: "chat",
              createdByOperatorId: actorOperatorId,
              isActive: true,
              createdAt: now,
            })
            .onConflictDoNothing();
        } else if (!existing.isActive) {
          await tx
            .update(crmConversationDeals)
            .set({
              isActive: true,
              unlinkedAt: null,
              unlinkedByOperatorId: null,
            })
            .where(
              and(
                eq(crmConversationDeals.tenantId, tenantId),
                eq(crmConversationDeals.id, existing.id),
              ),
            );
        }
      }
    }

    if (resolvedDealId) {
      const [targetCtx] = await tx
        .select({
          currentDealId: conversationDealContexts.currentDealId,
          previousDealId: conversationDealContexts.previousDealId,
          version: conversationDealContexts.version,
        })
        .from(conversationDealContexts)
        .where(
          and(
            eq(conversationDealContexts.tenantId, tenantId),
            eq(conversationDealContexts.conversationId, targetConversationId),
          ),
        )
        .limit(1);

      if (!targetCtx) {
        await tx
          .insert(conversationDealContexts)
          .values({
            tenantId,
            conversationId: targetConversationId,
            currentDealId: resolvedDealId,
            previousDealId: null,
            selectionRequired: true,
            version: 1,
            updatedAt: now,
          })
          .onConflictDoNothing();
      } else if (targetCtx.currentDealId !== resolvedDealId) {
        await tx
          .update(conversationDealContexts)
          .set({
            currentDealId: resolvedDealId,
            previousDealId: targetCtx.currentDealId || targetCtx.previousDealId,
            selectionRequired: true,
            version: targetCtx.version + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(conversationDealContexts.tenantId, tenantId),
              eq(conversationDealContexts.conversationId, targetConversationId),
            ),
          );
      }
    }

    await endDealContext(tx as any, tenantId, sourceConversationId);
    await syncConversationDeals(tx as any, tenantId, targetConversationId, contactId, actorOperatorId);
  } catch (err) {
    if (!isMissingRelationError(err)) {
      throw err;
    }
  }

  return resolvedDealId;
}

/**
 * Executa a ponte transacional entre threads de canais distintos para o mesmo contato:
 * - Oficial Meta (null) → Baileys dedicado do vendedor destino
 * - Baileys A → Baileys B (outro vendedor dedicado)
 * - Baileys A → Oficial Meta (vendedor comum ou fila de setor)
 *
 * Nunca sobrescreve `whatsapp_connection_id` no registro original (preservando constraints,
 * triggers de mensagens e histórico oficial). Em vez disso, encerra a thread de origem e
 * abre/reabre a thread do canal de destino preservando carteira, contato selecionado e CRM.
 */
export async function handoffConversationAcrossChannels(
  tx: DedicatedDbExecutor,
  params: HandoffAcrossChannelsParams,
): Promise<HandoffAcrossChannelsResult> {
  const {
    tenantId,
    sourceConversation,
    targetConnectionId,
    targetQueueState,
    targetOperatorId,
    actorOperatorId = null,
    actorName,
    now = new Date(),
  } = params;

  const sourceConnectionId = sourceConversation.whatsappConnectionId ?? null;
  const normalizedTargetConnectionId = targetConnectionId ?? null;

  if (
    isSiteConversationId(sourceConversation.id) ||
    sourceConnectionId === normalizedTargetConnectionId
  ) {
    return {
      redirected: false,
      sourceConversation,
      targetConversation: sourceConversation,
      targetConnection: params.targetConnectionInfo ?? null,
      sourceSystemMessageId: null,
      targetSystemMessageId: null,
      transferredDealId: params.preferredDealId ?? null,
    };
  }

  await lockContactDeals(tx as any, tenantId, sourceConversation.contactId);

  const [sourceConnMeta, targetConnMeta] = await Promise.all([
    sourceConnectionId
      ? tx
          .select({
            id: whatsappConnections.id,
            name: whatsappConnections.name,
            pairedPhone: whatsappConnections.baileysPairedPhone,
          })
          .from(whatsappConnections)
          .where(
            and(
              eq(whatsappConnections.tenantId, tenantId),
              eq(whatsappConnections.id, sourceConnectionId),
            ),
          )
          .limit(1)
          .then((r) => r[0] || null)
      : Promise.resolve(null),
    normalizedTargetConnectionId && !params.targetConnectionInfo
      ? tx
          .select({
            id: whatsappConnections.id,
            name: whatsappConnections.name,
            ownerOperatorId: whatsappConnections.ownerOperatorId,
            pairedPhone: whatsappConnections.baileysPairedPhone,
            status: whatsappConnections.baileysSessionStatus,
            leaseUntil: whatsappConnections.leaseUntil,
          })
          .from(whatsappConnections)
          .where(
            and(
              eq(whatsappConnections.tenantId, tenantId),
              eq(whatsappConnections.id, normalizedTargetConnectionId),
            ),
          )
          .limit(1)
          .then((r) => {
            const row = r[0];
            if (!row) return null;
            const live = isLiveLease(row.status, row.leaseUntil, now.getTime());
            return {
              id: row.id,
              name: row.name,
              provider: "baileys" as const,
              ownerOperatorId: row.ownerOperatorId || targetOperatorId || "",
              pairedPhone: row.pairedPhone ?? null,
              status: live ? "connected" : "disconnected",
              isConnectedLive: live,
            };
          })
      : Promise.resolve(params.targetConnectionInfo ?? null),
  ]);

  const sourceChannelLabel = sourceConnMeta?.name
    ? `WhatsApp dedicado (${sourceConnMeta.name})`
    : "WhatsApp Oficial";
  const targetChannelLabel = targetConnMeta?.name
    ? `WhatsApp dedicado (${targetConnMeta.name})`
    : "WhatsApp Oficial";

  // 1. Buscar ou criar a conversa de destino no canal alvo
  const existingTargets = await tx
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.contactId, sourceConversation.contactId),
        conversationConnectionCondition(normalizedTargetConnectionId),
      ),
    )
    .orderBy(desc(conversations.lastMessageTime), desc(conversations.id))
    .for("update");

  const existingTarget =
    (sourceConversation.contactPhoneId
      ? existingTargets.find(
          (row) => !row.contactPhoneId || row.contactPhoneId === sourceConversation.contactPhoneId,
        )
      : existingTargets[0]) || existingTargets[0];

  const resolvedSectorId =
    params.targetSectorId !== undefined
      ? params.targetSectorId
      : sourceConversation.sectorId ?? existingTarget?.sectorId ?? null;

  const previewText = (
    params.lastMessagePreview ||
    sourceConversation.lastMessageText ||
    `Atendimento recebido via ${sourceChannelLabel}`
  ).slice(0, 180);

  const shouldMarkUnread =
    targetQueueState === "meus" &&
    Boolean(targetOperatorId) &&
    targetOperatorId !== actorOperatorId;

  await setAttendanceActor(tx as any, tenantId, actorName, actorOperatorId);

  let targetConversation: typeof conversations.$inferSelect;
  if (existingTarget) {
    const nextUnread = shouldMarkUnread
      ? Math.max(Number(existingTarget.unreadCount || 0), 1)
      : Number(existingTarget.unreadCount || 0);
    const [updatedTarget] = await tx
      .update(conversations)
      .set({
        queueState: targetQueueState,
        operatorId: targetQueueState === "meus" ? targetOperatorId : null,
        sectorId: resolvedSectorId,
        contactPhoneId: existingTarget.contactPhoneId ?? sourceConversation.contactPhoneId ?? null,
        contactPhone: existingTarget.contactPhone ?? sourceConversation.contactPhone ?? null,
        unreadCount: nextUnread,
        lastMessageText: previewText,
        lastMessageTime: now,
        version: sql`${conversations.version} + 1`,
        updatedAt: now,
      })
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, existingTarget.id)))
      .returning();
    targetConversation = updatedTarget;
  } else {
    const [insertedTarget] = await tx
      .insert(conversations)
      .values({
        id: `conv-${randomUUID()}`,
        tenantId,
        contactId: sourceConversation.contactId,
        contactPhoneId: sourceConversation.contactPhoneId ?? null,
        contactPhone: sourceConversation.contactPhone ?? null,
        whatsappConnectionId: normalizedTargetConnectionId,
        operatorId: targetQueueState === "meus" ? targetOperatorId : null,
        sectorId: resolvedSectorId,
        queueState: targetQueueState,
        unreadCount: shouldMarkUnread ? 1 : 0,
        lastMessageText: previewText,
        lastMessageTime: now,
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    targetConversation = insertedTarget;
  }

  // 2. Registrar contato na tabela whatsapp_connection_contacts quando o destino é Baileys
  if (normalizedTargetConnectionId) {
    await tx
      .insert(whatsappConnectionContacts)
      .values({
        id: randomUUID(),
        tenantId,
        connectionId: normalizedTargetConnectionId,
        contactId: sourceConversation.contactId,
      })
      .onConflictDoNothing();
  }

  // 3. Migrar vínculos de negociação e contexto ativo do CRM para a thread de destino
  const transferredDealId = await copyDealLinksAndContext(tx, {
    tenantId,
    sourceConversationId: sourceConversation.id,
    targetConversationId: targetConversation.id,
    contactId: sourceConversation.contactId,
    actorOperatorId,
    preferredDealId: params.preferredDealId,
    now,
  });

  // 4. Encerrar a thread de origem para não haver duplicidade ativa em "Meus Atendimentos"
  const sourceUpdate: Record<string, unknown> = {
    queueState: "finalizados",
    version: sql`${conversations.version} + 1`,
    updatedAt: now,
  };
  if (params.preserveSourceOperatorId !== undefined) {
    sourceUpdate.operatorId = params.preserveSourceOperatorId;
  }
  const [closedSource] = await tx
    .update(conversations)
    .set(sourceUpdate)
    .where(
      and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.id, sourceConversation.id),
      ),
    )
    .returning();

  // 5. Atualizar carteira e responsável do contato
  if (params.updateContactWallet !== false && sourceConversation.contactId) {
    if (targetQueueState === "meus" && targetOperatorId) {
      let resolvedOpName = params.targetOperatorName || null;
      if (!resolvedOpName) {
        const [opRow] = await tx
          .select({ name: operators.name })
          .from(operators)
          .where(and(eq(operators.tenantId, tenantId), eq(operators.id, targetOperatorId)))
          .limit(1);
        resolvedOpName = opRow?.name || "Operador";
      }
      await tx
        .update(contacts)
        .set({
          walletOperatorId: targetOperatorId,
          responsibleName: resolvedOpName,
        })
        .where(
          and(eq(contacts.tenantId, tenantId), eq(contacts.id, sourceConversation.contactId)),
        );
    } else if (targetQueueState === "fila") {
      await tx
        .update(contacts)
        .set({ responsibleName: "Na Fila" })
        .where(
          and(eq(contacts.tenantId, tenantId), eq(contacts.id, sourceConversation.contactId)),
        );
    }
  }

  // 6. Gravar notas de sistema atômicas nas duas threads
  const destinationLabel =
    targetQueueState === "meus"
      ? params.targetOperatorName || "o operador de destino"
      : params.targetSectorName
        ? `a fila do setor ${params.targetSectorName}`
        : "a Fila de Espera";

  const sourceMsgText =
    params.sourceSystemMessageText ||
    `Atendimento transferido para ${destinationLabel} via ${targetChannelLabel} por ${actorName}. Esta conversa foi encerrada neste número para continuidade no número de destino.`;
  const targetMsgText =
    params.targetSystemMessageText ||
    `Atendimento direcionado para ${destinationLabel} neste número (${targetChannelLabel}) a partir do ${sourceChannelLabel} por ${actorName}.${
      params.targetSectorName ? ` Setor: ${params.targetSectorName}.` : ""
    }${
      targetConnMeta && !targetConnMeta.isConnectedLive
        ? " Atenção: este WhatsApp dedicado está desconectado no momento — reconecte o QR Code para enviar mensagens."
        : ""
    }`;

  const sourceSystemMessageId = `sys-handoff-src-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const targetSystemMessageId = `sys-handoff-dst-${Date.now()}-${randomUUID().slice(0, 6)}`;

  const handoffMetadata = {
    dedicatedChannelHandoff: true,
    sourceConversationId: sourceConversation.id,
    sourceConnectionId,
    targetConversationId: targetConversation.id,
    targetConnectionId: normalizedTargetConnectionId,
    targetConnectionName: targetConnMeta?.name || null,
    targetConnectionDisconnected: Boolean(targetConnMeta && !targetConnMeta.isConnectedLive),
    attendanceActor: { name: actorName, operatorId: actorOperatorId },
    attendanceSkip: true,
  };

  await tx.insert(messages).values([
    {
      id: sourceSystemMessageId,
      tenantId,
      conversationId: sourceConversation.id,
      whatsappConnectionId: sourceConnectionId,
      senderType: "system",
      senderName: "Sistema",
      content: sourceMsgText,
      isInternalNote: true,
      direction: "outbound",
      provider: "system",
      status: "accepted",
      metaDetails: {
        ...handoffMetadata,
        handoffSide: "source",
        ...(params.sourceMetaDetails || {}),
      },
      sentAt: now,
      updatedAt: now,
    },
    {
      id: targetSystemMessageId,
      tenantId,
      conversationId: targetConversation.id,
      whatsappConnectionId: normalizedTargetConnectionId,
      senderType: "system",
      senderName: "Sistema",
      content: targetMsgText,
      isInternalNote: true,
      direction: "outbound",
      provider: "system",
      status: "accepted",
      metaDetails: {
        ...handoffMetadata,
        handoffSide: "target",
        ...(params.targetMetaDetails || {}),
      },
      sentAt: now,
      updatedAt: now,
    },
  ]);

  if (actorOperatorId && transferredDealId) {
    try {
      await recordConversationAction(tx as any, {
        tenantId,
        conversationId: targetConversation.id,
        dealId: transferredDealId,
        operatorId: actorOperatorId,
        messageId: targetSystemMessageId,
        content: targetMsgText,
        type: "system_event",
        metadata: {
          fromConversationId: sourceConversation.id,
          fromConnectionId: sourceConnectionId,
          toConnectionId: normalizedTargetConnectionId,
          fromQueueState: sourceConversation.queueState,
          toQueueState: targetQueueState,
          fromOperatorId: sourceConversation.operatorId,
          toOperatorId: targetConversation.operatorId,
          fromSectorId: sourceConversation.sectorId,
          toSectorId: targetConversation.sectorId,
        },
      });
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
    }
  }

  return {
    redirected: true,
    sourceConversation: closedSource || { ...sourceConversation, queueState: "finalizados" },
    targetConversation,
    targetConnection: targetConnMeta,
    sourceSystemMessageId,
    targetSystemMessageId,
    transferredDealId,
  };
}

/**
 * Quando uma mensagem entra no WhatsApp Oficial (Meta) para um contato cuja carteira
 * pertence a um operador com Baileys dedicado (não-admin):
 * - Mantém a thread corporativa em `finalizados` (preservando o histórico oficial para leitura
 *   no histórico unificado, sem abrir chat Meta em "Meus" e sem acionar Fagner SDR).
 * - Cria ou reabre/sobe a thread Baileys dedicada do operador em `meus` com `unreadCount + 1`
 *   e nota interna curta, para que ele veja a mensagem no histórico unificado e responda
 *   exclusivamente pelo seu número Baileys.
 */
export async function routeMetaInboundToDedicatedBaileys(
  tx: DedicatedDbExecutor,
  params: {
    tenantId: string;
    corporateConversation: typeof conversations.$inferSelect;
    walletOperator: { id: string; name: string; role?: string | null };
    messagePreview: string;
    timestamp: Date;
  },
): Promise<RouteMetaInboundToDedicatedResult> {
  const { tenantId, corporateConversation, walletOperator, messagePreview, timestamp } = params;

  const status = await isStrictDedicatedBaileysOperator(
    tx,
    tenantId,
    walletOperator.id,
    walletOperator.role,
  );
  if (!status.dedicated || !status.connection) {
    return {
      redirected: false,
      corporateConversation,
      dedicatedConversation: null,
      dedicatedConnection: null,
      systemMessageId: null,
    };
  }

  const dedicatedConn = status.connection;
  const now = new Date();
  const effectiveTime = timestamp > now ? timestamp : now;
  const cleanPreview = (messagePreview || "Nova mensagem recebida").trim().slice(0, 130);
  const previewWithTag = `[Recebida no Oficial] ${cleanPreview}`.slice(0, 180);

  // 1. Mantém a thread corporativa fechada (read-only no histórico unificado) com dono rastreável
  const [closedCorp] = await tx
    .update(conversations)
    .set({
      queueState: "finalizados",
      operatorId: walletOperator.id,
      unreadCount: 0,
      version: sql`${conversations.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.id, corporateConversation.id),
        isNull(conversations.whatsappConnectionId),
      ),
    )
    .returning();

  // 2. Busca ou cria/reabre a thread Baileys dedicada do operador
  const existingTargets = await tx
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.contactId, corporateConversation.contactId),
        conversationConnectionCondition(dedicatedConn.id),
      ),
    )
    .orderBy(desc(conversations.lastMessageTime), desc(conversations.id))
    .for("update");

  const existingTarget = existingTargets[0];

  await setAttendanceActor(
    tx as any,
    tenantId,
    `Automação WhatsApp (${walletOperator.name} · Número Dedicado)`,
    walletOperator.id,
  );

  let dedicatedConversation: typeof conversations.$inferSelect;
  if (existingTarget) {
    const [updated] = await tx
      .update(conversations)
      .set({
        queueState: "meus",
        operatorId: walletOperator.id,
        sectorId: existingTarget.sectorId ?? corporateConversation.sectorId ?? null,
        contactPhoneId: existingTarget.contactPhoneId ?? corporateConversation.contactPhoneId ?? null,
        contactPhone: existingTarget.contactPhone ?? corporateConversation.contactPhone ?? null,
        unreadCount: sql`${conversations.unreadCount} + 1`,
        lastMessageText: previewWithTag,
        lastMessageTime: effectiveTime,
        version: sql`${conversations.version} + 1`,
        updatedAt: now,
      })
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, existingTarget.id)))
      .returning();
    dedicatedConversation = updated;
  } else {
    const [inserted] = await tx
      .insert(conversations)
      .values({
        id: `conv-${randomUUID()}`,
        tenantId,
        contactId: corporateConversation.contactId,
        contactPhoneId: corporateConversation.contactPhoneId ?? null,
        contactPhone: corporateConversation.contactPhone ?? null,
        whatsappConnectionId: dedicatedConn.id,
        operatorId: walletOperator.id,
        sectorId: corporateConversation.sectorId ?? null,
        queueState: "meus",
        unreadCount: 1,
        lastMessageText: previewWithTag,
        lastMessageTime: effectiveTime,
        version: 1,
        createdAt: effectiveTime,
        updatedAt: now,
      })
      .returning();
    dedicatedConversation = inserted;
  }

  // 3. Garantir contato selecionado e vínculos CRM
  await tx
    .insert(whatsappConnectionContacts)
    .values({
      id: randomUUID(),
      tenantId,
      connectionId: dedicatedConn.id,
      contactId: corporateConversation.contactId,
    })
    .onConflictDoNothing();

  await copyDealLinksAndContext(tx, {
    tenantId,
    sourceConversationId: corporateConversation.id,
    targetConversationId: dedicatedConversation.id,
    contactId: corporateConversation.contactId,
    actorOperatorId: walletOperator.id,
    now,
  });

  // 4. Nota interna sinalizando que a nova mensagem veio no Oficial (visível no histórico unificado)
  const systemMessageId = `sys-meta-inb-${Date.now()}-${randomUUID().slice(0, 6)}`;
  await tx.insert(messages).values({
    id: systemMessageId,
    tenantId,
    conversationId: dedicatedConversation.id,
    whatsappConnectionId: dedicatedConn.id,
    senderType: "system",
    senderName: "Sistema",
    content: `Cliente enviou mensagem no WhatsApp Oficial (visível acima no histórico unificado). Responda por aqui usando seu WhatsApp dedicado (${dedicatedConn.name}).`,
    isInternalNote: true,
    direction: "outbound",
    provider: "system",
    status: "accepted",
    metaDetails: {
      dedicatedMetaInboundRedirect: true,
      corporateConversationId: corporateConversation.id,
      attendanceSkip: true,
    },
    sentAt: new Date(effectiveTime.getTime() + 1),
    updatedAt: now,
  });

  return {
    redirected: true,
    corporateConversation: closedCorp || { ...corporateConversation, queueState: "finalizados" },
    dedicatedConversation,
    dedicatedConnection: dedicatedConn,
    systemMessageId,
  };
}
