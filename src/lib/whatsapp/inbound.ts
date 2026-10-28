import { syncConversationDeals, lockContactDeals } from "../crm/deal-associations";
import { runtimeSingleton } from "../runtime-singleton";
import { db } from "../../db";
import {
  pendingInbounds,
  contacts,
  conversations,
  messages,
  mediaFiles,
  operators,
  agentFlowStates,
  agentConfigs,
} from "../../db/schema";
import { isNull, eq, and, desc, sql, or, like } from "drizzle-orm";
import { UniversalInboundMessage } from "./types";
import { getAiPersona, isSdrTenant } from "../ai-persona";
import { SessionManager } from "../baileys/session-manager";
import { SdrDebouncer } from "../valentina/sdr-debouncer";
import { restartIndustrialCycle } from "../triage/industrial-cycle-restart";
import { normalizeCanonicalPhone, buildPhoneSearchTerms } from "../utils";
import { sendPushToOperator } from "../push-notifications";
import { checkAndSendOperatorStatusAutoReply } from "./status-auto-reply";
import { setAttendanceActor } from "../attendance-events";
import crypto from "node:crypto";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class InboundProcessor {
  private static instance: InboundProcessor;

  private constructor() {}

  static getInstance(): InboundProcessor {
    if (!InboundProcessor.instance) {
      InboundProcessor.instance = runtimeSingleton("InboundProcessor", () => new InboundProcessor());
    }
    return InboundProcessor.instance;
  }

  /**
   * Processa evento de entrada de mensagem (Baileys ou Meta) de forma resiliente,
   * garantindo deduplicação, criação de contato/conversa, persistência e notificação.
   */
  async process(inbound: UniversalInboundMessage) {
    const { tenantId, externalEventId } = inbound;
    const id =
      "inb_" +
      crypto
        .createHash("sha256")
        .update(tenantId + ":" + externalEventId)
        .digest("hex");
    await db
      .insert(pendingInbounds)
      .values({
        id,
        tenantId,
        provider: inbound.provider,
        externalEventId,
        status: "pending",
        attempts: 0,
        nextRetryAt: new Date(),
        payload: {
          ...(inbound.rawPayload || {}),
          fromPhone: inbound.fromPhone,
          fromUserId: inbound.fromUserId,
          senderName: inbound.senderName,
          whatsappUsername: inbound.whatsappUsername,
          text: inbound.rawPayload?.text || inbound.text,
          timestamp: inbound.rawPayload?.timestamp || String(inbound.timestamp.getTime() / 1000),
        },
      })
      .onConflictDoNothing();
    let result;
    try {
      result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${externalEventId}))`,
        );
        return this.processInTransaction(inbound, tx);
      });
    } catch (error: any) {
      await db
        .update(pendingInbounds)
        .set({
          status: "failed",
          attempts: sql`${pendingInbounds.attempts} + 1`,
          errorMessage: "Falha no processamento; evento preservado.",
          nextRetryAt: new Date(Date.now() + 60_000),
        })
        .where(
          and(
            eq(pendingInbounds.tenantId, tenantId),
            eq(pendingInbounds.externalEventId, externalEventId),
            sql`${pendingInbounds.status} != 'processed'`,
          ),
        );
      return { success: false, error: "Falha no processamento; evento preservado." };
    }
    if (result.success && !result.duplicate && result.messageId && result.conversationId) {
      try {
        const [msg] = await db
          .select()
          .from(messages)
          .where(and(eq(messages.tenantId, tenantId), eq(messages.id, result.messageId)));
        const [conv] = await db
          .select()
          .from(conversations)
          .where(
            and(eq(conversations.tenantId, tenantId), isNull(conversations.whatsappConnectionId), eq(conversations.id, result.conversationId)),
          );
        const [contactRow] = conv?.contactId
          ? await db
              .select({
                walletOperatorId: contacts.walletOperatorId,
                avatar: contacts.avatar,
                responsibleName: contacts.responsibleName,
              })
              .from(contacts)
              .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, conv.contactId)))
          : [];
        SessionManager.getInstance().notifyPublic(tenantId, {
          type: "message",
          message: {
            ...msg,
            contactId: conv.contactId,
            phone: inbound.fromPhone,
            avatar: contactRow?.avatar || null,
            queue: conv.queueState,
            operatorId: conv.operatorId,
            walletOperatorId: contactRow?.walletOperatorId ?? null,
          },
        });
        if ((result as any).reopened) {
          SessionManager.getInstance().notifyPublic(tenantId, {
            type: "queue_update",
            conversationId: conv.id,
            contactId: conv.contactId,
            queueState: conv.queueState,
            operatorId: conv.operatorId,
            walletOperatorId: contactRow?.walletOperatorId ?? null,
            sectorId: conv.sectorId,
            version: conv.version,
            responsibleName: contactRow?.responsibleName || undefined,
          });
        }
        if (conv.operatorId)
          void sendPushToOperator(tenantId, conv.operatorId, {
            title: msg.senderName,
            body: msg.content,
            conversationId: conv.id,
            tenantId,
            url: "/?chatId=" + conv.id,
          }).catch(() => {});
        void checkAndSendOperatorStatusAutoReply({
          tenantId,
          conversationId: conv.id,
          contactId: conv.contactId,
          incomingMessageTime: inbound.timestamp,
        }).catch(() => {});

        // ── Acionamento do SDR (Fagner / Valentina) para mensagens da Meta Cloud API ──
        if (inbound.provider === "meta" && isSdrTenant(tenantId) && conv) {
          void this.handleMetaSdrIntegration(inbound, conv, result.messageId, Boolean((result as any).reopened)).catch(
            (sdrErr) => console.error("[Inbound/SDR] Erro ao acionar SDR via Meta:", sdrErr)
          );
        }
      } catch {
        console.error("[Inbound] Mensagem persistida; notificação indisponível.");
      }
    }
    return result;
  }

  private async handleMetaSdrIntegration(
    inbound: UniversalInboundMessage,
    conv: typeof conversations.$inferSelect,
    messageId: string,
    reopened: boolean
  ): Promise<void> {
    const { tenantId, fromPhone, text, media } = inbound;
    const convId = conv.id;
    const cleanText = (text || "").trim();

    // Helper para arquivar o ciclo de triagem anterior sem perder o histórico compilado
    const archivePreviousFlowState = async (reason: string) => {
      const existingFlows = await db
        .select()
        .from(agentFlowStates)
        .where(and(eq(agentFlowStates.conversationId, convId), eq(agentFlowStates.tenantId, tenantId)));

      const prevList: any[] = [];
      for (const ef of existingFlows) {
        const efMeta = (ef.metadata as Record<string, any>) || {};
        if (Array.isArray(efMeta.previousTriages)) {
          for (const pt of efMeta.previousTriages) {
            prevList.push(pt);
          }
        }
        prevList.push({
          id: ef.id,
          startedAt: ef.startedAt ? new Date(ef.startedAt).toISOString() : null,
          completedAt: (ef.completedAt || ef.lastInteractionAt || new Date()).toISOString(),
          outcome: ef.outcome && ef.outcome !== "in_progress" ? ef.outcome : reason,
          targetFunnel: efMeta.targetFunnel || null,
          responsibleName: efMeta.allocatedOperatorName || null,
        });
      }

      await db
        .delete(agentFlowStates)
        .where(and(eq(agentFlowStates.conversationId, convId), eq(agentFlowStates.tenantId, tenantId)));

      return prevList.slice(-20);
    };

    // 1. Comando !reset: Reinicia a triagem da IA sem apagar mensagens
    if (cleanText.toLowerCase() === "!reset") {
      console.log(`[Meta/Reset] Comando !reset acionado para a conversa ${convId} (${fromPhone}) no tenant ${tenantId}.`);
      SdrDebouncer.getInstance().clearSession(convId);

      if (getAiPersona(tenantId).triagePolicy === "industrial") {
        const restarted = await restartIndustrialCycle(db, tenantId, convId, { reason: "reset", sourceKey: messageId, receivedAt: inbound.timestamp });
        if (!restarted || restarted.replayed) return;
      } else {
      const previousTriages = await archivePreviousFlowState("reset");

      await db
        .update(conversations)
        .set({
          queueState: "automacao",
          operatorId: null,
          unreadCount: 0,
          lastMessageText: "Fluxo de triagem reiniciado via !reset",
          lastMessageTime: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(conversations.id, convId), eq(conversations.tenantId, tenantId), isNull(conversations.whatsappConnectionId)));

      await db.insert(agentFlowStates).values({
        id: `fs-sdr-${Date.now()}`,
        tenantId,
        conversationId: convId,
        agentType: "sdr",
        currentStep: "Em Qualificação",
        collectedData: {},
        metadata: { stepNumber: 1, totalSteps: 7, funnelStage: "triagem", previousTriages },
        startedAt: new Date(),
        lastInteractionAt: new Date(),
        outcome: "in_progress",
      });

      // Registrar marcador de sistema no histórico para separar a triagem anterior da nova
      await db
        .insert(messages)
        .values({
          id: `sys-reset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          tenantId,
          conversationId: convId,
          senderType: "system",
          senderName: "Sistema",
          content: "Triagem anterior encerrada — Novo ciclo de triagem iniciado",
          isInternalNote: true,
          direction: "outbound",
          provider: "system",
          status: "accepted",
          sentAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing();

      }
      SessionManager.getInstance().notifyPublic(tenantId, {
        type: "queue_update",
        conversationId: convId,
        queueState: "automacao",
        operatorId: null,
        sectorId: null,
        responsibleName: `${getAiPersona(tenantId).name} IA`,
      });

      // Enviar confirmação visual no WhatsApp do cliente (igual ao Baileys)
      try {
        const { metaAdapter } = await import("./adapters/meta");
        const { sendMetaConversationPresence, resetMetaTypingThrottle } = await import("./meta-presence");
        await sendMetaConversationPresence(tenantId, convId, "read").catch(() => {});
        await metaAdapter.send(tenantId, {
          tenantId,
          conversationId: convId,
          recipientPhone: fromPhone || "",
          recipientUserId: inbound.fromUserId,
          text: `🔄 Fluxo de triagem reiniciado com sucesso! A persona ${getAiPersona(tenantId).name} está pronta para um novo atendimento.`,
        });
        resetMetaTypingThrottle(tenantId, convId);
      } catch (err: any) {
        console.error("[Meta/Reset] Erro ao enviar confirmação de !reset no WhatsApp:", err?.message);
      }
      return;
    }

    // 2. Se a conversa estava finalizada e foi reaberta sem operador de carteira, arquiva a triagem anterior e inicia novo ciclo
    if (reopened && !conv.operatorId && conv.queueState !== "meus") {
      if (getAiPersona(tenantId).triagePolicy === "industrial") {
        const restarted = await restartIndustrialCycle(db, tenantId, convId, { reason: "reopened", sourceKey: messageId, receivedAt: inbound.timestamp });
        if (!restarted) return;
      } else {
      const previousTriages = await archivePreviousFlowState("completed");
      await db.insert(agentFlowStates).values({
        id: `fs-sdr-${Date.now()}`,
        tenantId,
        conversationId: convId,
        agentType: "sdr",
        currentStep: "Em Qualificação",
        collectedData: {},
        metadata: {
          stepNumber: 1,
          totalSteps: 7,
          followUpStage: 0,
          funnelStage: "triagem",
          targetFunnel: "Máquinas",
          previousTriages,
        },
        startedAt: new Date(Date.now() - 2000),
        lastInteractionAt: new Date(),
        outcome: "in_progress",
      });
      }
    }

    // 2b. Continuidade site → WhatsApp (perfil industrial): código de uso único enviado pelo cliente.
    if (getAiPersona(tenantId).triagePolicy === "industrial") {
      const { linkSiteContinuity } = await import("../livechat/site-continuity");
      const link = await linkSiteContinuity(tenantId, convId, cleanText).catch((err: any) => {
        console.error("[Meta/Continuidade] Falha ao vincular atendimento do site:", err?.message);
        return null;
      });
      if (link?.linked && link.mode === "operator") return;
    }

    // 3. Verificar se o SDR está habilitado no tenant
    const sdrConfig = await db.query.agentConfigs.findFirst({
      where: (t, { eq: dEq, and: dAnd }) =>
        dAnd(dEq(t.tenantId, tenantId), dEq(t.agentType, "sdr")),
    });
    if (sdrConfig && sdrConfig.enabled === 0) {
      return;
    }

    // 4. Trava de Operador: só aciona o SDR se a conversa não estiver com vendedor humano
    const currentFlow = await db.query.agentFlowStates.findFirst({
      where: (t, { eq: dEq, and: dAnd }) =>
        dAnd(dEq(t.conversationId, convId), dEq(t.tenantId, tenantId)),
    });

    const isHandledByOperator = Boolean(
      conv.operatorId !== null ||
      conv.queueState === "meus" ||
      conv.queueState === "finalizados" ||
      currentFlow?.outcome === "completed" ||
      currentFlow?.outcome === "transferred" ||
      currentFlow?.outcome === "stopped"
    );

    if (isHandledByOperator) {
      console.log(`[Meta/SDR] 🛑 Trava de Operador ativa para conversa ${convId} (${fromPhone}). ${getAiPersona(tenantId).name} silenciado.`);
      return;
    }

    // 5. Dar sinal imediato de leitura (✓✓ azul) no WhatsApp do cliente assim que entra na fila do SDR
    try {
      const { sendMetaConversationPresence } = await import("./meta-presence");
      void sendMetaConversationPresence(tenantId, convId, "read").catch(() => {});
    } catch {}

    // 6. Preparar item multimodal (texto, foto, áudio ou PDF) para o SdrDebouncer
    let mediaType: "text" | "image" | "audio" | "document" = "text";
    let mediaBase64: string | undefined;
    let mimeType: string | undefined;

    if (media && media.dataBuffer) {
      mimeType = media.mimeType;
      mediaBase64 = media.dataBuffer.toString("base64");
      if (media.mediaType === "image" || media.mediaType === "sticker") {
        mediaType = "image";
      } else if (media.mediaType === "audio") {
        mediaType = "audio";
      } else if (media.mediaType === "document") {
        mediaType = "document";
      }
    }

    SdrDebouncer.getInstance().pushIncomingMessage(tenantId, convId, fromPhone || "", {
      messageId,
      text: cleanText,
      mediaType,
      mimeType,
      mediaBase64,
      receivedAt: new Date(),
    });
  }

  private async processInTransaction(
    inbound: UniversalInboundMessage,
    db: Transaction,
  ): Promise<{
    success: boolean;
    duplicate?: boolean;
    messageId?: string;
    conversationId?: string;
    reopened?: boolean;
    error?: string;
  }> {
    const {
      externalEventId,
      tenantId,
      provider,
      fromPhone,
      fromUserId,
      whatsappUsername,
      senderName,
      text,
      media,
      quotedExternalId,
      timestamp,
      rawPayload,
    } = inbound;

    const cleanPhone = fromPhone.replace(/\D/g, "");
    const userId = provider === "meta" ? fromUserId?.trim() : undefined;
    if (!cleanPhone && !userId) {
      console.warn(`[InboundProcessor] Identidade de origem vazia no tenant '${tenantId}'`);
      return { success: false, error: "Identidade de origem inválida" };
    }

    const [event] = await db
      .select()
      .from(pendingInbounds)
      .where(
        and(
          eq(pendingInbounds.tenantId, tenantId),
          eq(pendingInbounds.externalEventId, externalEventId),
        ),
      );
    if (!event) throw new Error("Evento durável ausente.");
    const targetInboundId = event.id;
    if (event.status === "processed") return { success: true, duplicate: true };
    const [persisted] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, tenantId),
          eq(messages.direction, "inbound"),
          eq(messages.externalId, externalEventId),
        ),
      )
      .limit(1);
    if (persisted) {
      await db
        .update(pendingInbounds)
        .set({ status: "processed", processedAt: new Date() })
        .where(
          and(eq(pendingInbounds.tenantId, tenantId), eq(pendingInbounds.id, targetInboundId)),
        );
      return {
        success: true,
        duplicate: true,
        messageId: persisted.id,
        conversationId: persisted.conversationId,
      };
    }
    await db
      .update(pendingInbounds)
      .set({ status: "processing", attempts: sql`${pendingInbounds.attempts} + 1` })
      .where(and(eq(pendingInbounds.tenantId, tenantId), eq(pendingInbounds.id, targetInboundId)));

    try {
      // 2. Resolução do Contato (contacts)
      let contact = userId
        ? (
            await db
              .select()
              .from(contacts)
              .where(and(eq(contacts.tenantId, tenantId), eq(contacts.whatsappUserId, userId)))
              .limit(1)
          )[0]
        : undefined;

      const canonicalPhone = normalizeCanonicalPhone(cleanPhone);
      const phoneTerms = buildPhoneSearchTerms(canonicalPhone || cleanPhone);

      if (!contact && phoneTerms.length > 0) {
        const matching = await db
          .select()
          .from(contacts)
          .where(
            and(
              eq(contacts.tenantId, tenantId),
              or(
                ...phoneTerms.map(
                  (term) => sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${term}`,
                ),
              ),
            ),
          )
          .limit(1);
        if (matching.length > 0) {
          contact = matching[0];
        }
      }

      if (contact && userId && contact.whatsappUserId && contact.whatsappUserId !== userId) {
        throw new Error("Telefone já vinculado a outro BSUID; associação manual necessária");
      }

      if (!contact) {
        const contactId = `cont-${crypto.randomUUID()}`;
        const newContactName =
          senderName?.trim() ||
          (whatsappUsername
            ? `@${whatsappUsername}`
            : canonicalPhone || cleanPhone || "Contato WhatsApp");

        const [createdContact] = await db
          .insert(contacts)
          .values({
            id: contactId,
            tenantId,
            name: newContactName,
            phone: canonicalPhone || cleanPhone || null,
            whatsappUserId: userId || null,
            whatsappUsername: whatsappUsername || null,
            mainChannel: "whatsapp",
            responsibleName: "Na Fila",
            createdAt: timestamp,
          })
          .returning();

        contact = createdContact;
      } else {
        const identityUpdates: Partial<typeof contacts.$inferInsert> = {};
        if (userId && !contact.whatsappUserId) identityUpdates.whatsappUserId = userId;
        // Auto-cura: se o contato estava sem phone ou com phone não canônico (ex: sem 55), atualiza para o canonicalPhone
        if (canonicalPhone && (!contact.phone || contact.phone !== canonicalPhone)) {
          const [phoneOwner] = await db
            .select({ id: contacts.id })
            .from(contacts)
            .where(and(eq(contacts.tenantId, tenantId), eq(contacts.phone, canonicalPhone)))
            .limit(1);
          if (!phoneOwner || phoneOwner.id === contact.id) identityUpdates.phone = canonicalPhone;
        }
        if (
          userId &&
          whatsappUsername !== undefined &&
          contact.whatsappUsername !== whatsappUsername
        ) {
          identityUpdates.whatsappUsername = whatsappUsername;
        }
        if (
          senderName &&
          (contact.name === contact.phone ||
            contact.name === "Contato WhatsApp" ||
            (contact.phone && contact.name === `+${contact.phone}`))
        ) {
          identityUpdates.name = senderName.trim();
        } else if (
          whatsappUsername !== undefined &&
          contact.whatsappUsername &&
          contact.name === `@${contact.whatsappUsername}`
        ) {
          identityUpdates.name = whatsappUsername
            ? `@${whatsappUsername}`
            : contact.phone || "Contato WhatsApp";
        }
        if (Object.keys(identityUpdates).length) {
          await db
            .update(contacts)
            .set(identityUpdates)
            .where(and(eq(contacts.id, contact.id), eq(contacts.tenantId, tenantId)));
          contact = { ...contact, ...identityUpdates };
        }
      }

      await lockContactDeals(db, tenantId, contact.id);
      // 3. Resolução da Conversa Ativa (conversations)
      let [activeConv] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.tenantId, tenantId), isNull(conversations.whatsappConnectionId), eq(conversations.contactId, contact.id)))
        .orderBy(desc(conversations.lastMessageTime))
        .limit(1);

      if (activeConv) {
        const [locked] = await db
          .select()
          .from(conversations)
          .where(and(eq(conversations.tenantId, tenantId), isNull(conversations.whatsappConnectionId), eq(conversations.id, activeConv.id)))
          .for("update");
        activeConv = locked;
      }
      const aiPersona = getAiPersona(tenantId);
      const lastTextPreview = text || (media ? `[Mídia: ${media.fileName || media.mimeType}]` : "");
      const normalizedContactPhone = (cleanPhone || contact.phone || "").replace(/\D/g, "");
      let createdConversation = false;
      let reopened = false;

      if (!activeConv) {
        // 3a. Criação da primeira conversa para o contato
        const convId = `conv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const contactId = contact.id;
        let initialOperatorId: string | null = null;
        let initialQueueState = "fila";
        let initialResponsibleName: string | null = null;

        // Se o cliente tem carteira fixa, roteia diretamente para o operador da carteira ("Meus")
        if (contact.walletOperatorId) {
          const [walletOp] = await db
            .select({ id: operators.id, name: operators.name })
            .from(operators)
            .where(
              and(eq(operators.id, contact.walletOperatorId), eq(operators.tenantId, tenantId)),
            );

          if (walletOp) {
            initialOperatorId = walletOp.id;
            initialQueueState = "meus";
            initialResponsibleName = walletOp.name;
          }
        }

        // Se não tem carteira e a empresa usa IA SDR
        if (!initialOperatorId) {
          if (isSdrTenant(tenantId)) {
            initialQueueState = "automacao";
          } else {
            initialQueueState = "fila";
          }
        }

        activeConv = await db.transaction(async (tx) => {
          // A mesma chave é usada na criação manual. Evita dois históricos quando
          // mensagens simultâneas chegam antes de qualquer conversa existir.
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${contactId}))`,
          );
          if (normalizedContactPhone.length >= 8) {
            await tx.execute(
              sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${normalizedContactPhone}))`,
            );
            const convPhoneTerms = buildPhoneSearchTerms(normalizedContactPhone);
            const matchingHistories = await tx
              .select({ conversation: conversations })
              .from(conversations)
              .innerJoin(
                contacts,
                and(eq(conversations.contactId, contacts.id), eq(contacts.tenantId, tenantId)),
              )
              .where(
                and(
                  eq(conversations.tenantId, tenantId), isNull(conversations.whatsappConnectionId),
                  or(
                    ...convPhoneTerms.map(
                      (term) => sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${term}`,
                    ),
                  ),
                ),
              )
              .orderBy(desc(conversations.lastMessageTime))
              .limit(1);
            if (matchingHistories.length) return matchingHistories[0].conversation;
          }
          const [existing] = await tx
            .select()
            .from(conversations)
            .where(
              and(eq(conversations.tenantId, tenantId), isNull(conversations.whatsappConnectionId), eq(conversations.contactId, contactId)),
            )
            .orderBy(desc(conversations.lastMessageTime))
            .limit(1);
          if (existing) return existing;
          await setAttendanceActor(
            tx,
            tenantId,
            initialOperatorId
              ? `Automação WhatsApp (${initialResponsibleName || "Carteira"})`
              : "Automação WhatsApp",
            initialOperatorId,
          );
          if (initialResponsibleName && contact.responsibleName !== initialResponsibleName) {
            await tx
              .update(contacts)
              .set({ responsibleName: initialResponsibleName })
              .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)));
          }
          const [created] = await tx
            .insert(conversations)
            .values({
              id: convId,
              tenantId,
              contactId,
              operatorId: initialOperatorId,
              queueState: initialQueueState,
              unreadCount: 1,
              lastMessageText: lastTextPreview,
              version: 1,
              lastMessageTime: timestamp,
              createdAt: timestamp,
              updatedAt: timestamp,
            })
            .returning();
          createdConversation = true;
          return created;
        });
        if (activeConv.contactId !== contact.id) {
          const [canonicalContact] = await db
            .select()
            .from(contacts)
            .where(and(eq(contacts.id, activeConv.contactId), eq(contacts.tenantId, tenantId)))
            .limit(1);
          if (
            !canonicalContact ||
            (userId &&
              canonicalContact.whatsappUserId &&
              canonicalContact.whatsappUserId !== userId)
          ) {
            throw new Error("Identidade WhatsApp conflitante para o histórico deste telefone");
          }
          if (userId && !canonicalContact.whatsappUserId) {
            await db
              .update(contacts)
              .set({ whatsappUserId: userId })
              .where(and(eq(contacts.id, canonicalContact.id), eq(contacts.tenantId, tenantId)));
            canonicalContact.whatsappUserId = userId;
          }
          contact = canonicalContact;
        }
      }

      await syncConversationDeals(db, tenantId, activeConv.id, contact.id);

      if (!createdConversation && activeConv.queueState === "finalizados") {
        // 3b. Reabertura consistente: reutiliza a mesma conversa preservando histórico.
        // Se o cliente possui dono de carteira (walletOperatorId), pula a triagem da IA e a fila geral,
        // entrando diretamente em "Meus" do operador responsável.
        reopened = true;
        let reOpenOperatorId: string | null = null;
        let reOpenQueueState = "fila";
        let reOpenResponsibleName: string | null = null;

        if (contact.walletOperatorId) {
          const [walletOp] = await db
            .select({ id: operators.id, name: operators.name })
            .from(operators)
            .where(
              and(eq(operators.id, contact.walletOperatorId), eq(operators.tenantId, tenantId)),
            );

          if (walletOp) {
            reOpenOperatorId = walletOp.id;
            reOpenQueueState = "meus";
            reOpenResponsibleName = walletOp.name;
          }
        }

        if (!reOpenOperatorId) {
          if (isSdrTenant(tenantId)) {
            reOpenQueueState = "automacao";
          } else {
            reOpenQueueState = "fila";
          }
        }

        if (reOpenResponsibleName && contact.responsibleName !== reOpenResponsibleName) {
          await db
            .update(contacts)
            .set({ responsibleName: reOpenResponsibleName })
            .where(and(eq(contacts.id, contact.id), eq(contacts.tenantId, tenantId)));
          contact = { ...contact, responsibleName: reOpenResponsibleName };
        }

        await setAttendanceActor(
          db,
          tenantId,
          reOpenOperatorId
            ? `Automação WhatsApp (${reOpenResponsibleName || "Carteira"})`
            : "Automação WhatsApp",
          reOpenOperatorId,
        );

        const [reopenedConv] = await db
          .update(conversations)
          .set({
            operatorId: reOpenOperatorId,
            queueState: reOpenQueueState,
            unreadCount: sql`${conversations.unreadCount} + 1`,
            lastMessageText:
              activeConv.lastMessageTime > timestamp ? activeConv.lastMessageText : lastTextPreview,
            lastMessageTime:
              activeConv.lastMessageTime > timestamp ? activeConv.lastMessageTime : timestamp,
            updatedAt: new Date(),
            version: (activeConv.version || 1) + 1,
          })
          .where(and(eq(conversations.id, activeConv.id), eq(conversations.tenantId, tenantId), isNull(conversations.whatsappConnectionId)))
          .returning();

        activeConv = reopenedConv || {
          ...activeConv,
          operatorId: reOpenOperatorId,
          queueState: reOpenQueueState,
          unreadCount: (activeConv.unreadCount || 0) + 1,
          lastMessageText: lastTextPreview,
          lastMessageTime: timestamp,
        };
      } else if (!createdConversation) {
        // 3c. Conversa já ativa: incrementa contador de não lidas e atualiza preview
        await db
          .update(conversations)
          .set({
            unreadCount: sql`${conversations.unreadCount} + 1`,
            lastMessageText:
              activeConv.lastMessageTime > timestamp ? activeConv.lastMessageText : lastTextPreview,
            lastMessageTime:
              activeConv.lastMessageTime > timestamp ? activeConv.lastMessageTime : timestamp,
            updatedAt: new Date(),
          })
          .where(and(eq(conversations.id, activeConv.id), eq(conversations.tenantId, tenantId), isNull(conversations.whatsappConnectionId)));
      }

      // 4. Persistir bytes da mídia recebida antes de confirmar o webhook.
      let mediaFileId: string | null = null;
      if (media?.dataBuffer) {
        mediaFileId = `med_${crypto.createHash("sha256").update(`${tenantId}:${externalEventId}`).digest("hex").slice(0, 32)}`;
        await db
          .insert(mediaFiles)
          .values({
            id: mediaFileId,
            tenantId,
            conversationId: activeConv.id,
            fileName: media.fileName || "arquivo",
            mimeType: media.mimeType,
            fileSize: media.dataBuffer.length,
            base64Data: media.dataBuffer.toString("base64"),
            createdAt: timestamp,
          })
          .onConflictDoNothing();
      }

      // 5. Inserção da Mensagem Recebida (messages)
      const messageId =
        "msg_in_" +
        crypto
          .createHash("sha256")
          .update(tenantId + ":" + externalEventId)
          .digest("hex");
      const safeFileName = (media?.fileName || "arquivo").replace(/:/g, "_");
      const messageContent =
        mediaFileId && media?.mediaType
          ? `[MEDIA:${media.mediaType}]${mediaFileId}${media.mediaType === "document" ? `:${safeFileName}` : ""}${text ? `\n${text}` : ""}`
          : text || (media ? `[Mídia: ${safeFileName}]` : "");

      // Resolução da mensagem citada (Reply / Quote do WhatsApp)
      let resolvedQuotedId: string | null = quotedExternalId || null;
      let quotedMessageSender: string | null = null;
      let quotedMessageContent: string | null = null;

      if (quotedExternalId) {
        try {
          const [foundQuoted] = await db
            .select({
              id: messages.id,
              senderType: messages.senderType,
              senderName: messages.senderName,
              content: messages.content,
            })
            .from(messages)
            .where(
              and(
                eq(messages.tenantId, tenantId),
                or(
                  eq(messages.externalId, quotedExternalId),
                  eq(messages.id, quotedExternalId),
                  like(messages.externalId, `%${quotedExternalId}%`),
                ),
              ),
            )
            .limit(1);

          if (foundQuoted) {
            resolvedQuotedId = foundQuoted.id;
            quotedMessageSender =
              foundQuoted.senderType === "agent"
                ? "Você"
                : foundQuoted.senderName || contact.name || "Cliente";
            quotedMessageContent = foundQuoted.content;
          } else {
            quotedMessageSender = "Mensagem";
            quotedMessageContent = "Mensagem citada";
          }
        } catch (qErr) {
          console.error("[InboundProcessor] Erro ao buscar mensagem citada:", qErr);
        }
      }

      await db.insert(messages).values({
        id: messageId,
        tenantId,
        conversationId: activeConv.id,
        senderType: "client",
        senderName: contact.name,
        content: messageContent,
        quotedMessageId: resolvedQuotedId,
        quotedMessageSender,
        quotedMessageContent,
        isInternalNote: false,
        direction: "inbound",
        provider,
        externalId: externalEventId || null,
        status: "accepted",
        sentAt: timestamp,
        updatedAt: timestamp,
      });

      // 7. Conclusão do registro em pending_inbounds
      await db
        .update(pendingInbounds)
        .set({ status: "processed", processedAt: new Date() })
        .where(
          and(eq(pendingInbounds.id, targetInboundId), eq(pendingInbounds.tenantId, tenantId)),
        );

      return {
        success: true,
        messageId,
        conversationId: activeConv.id,
        reopened,
      };
    } catch (err) {
      throw err; // rollback de contato, conversa, mídia, mensagem e conclusão do evento
    }
  }
}

export const inboundProcessor = InboundProcessor.getInstance();
