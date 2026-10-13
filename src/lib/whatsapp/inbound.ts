import { runtimeSingleton } from "../runtime-singleton";
import { db } from "../../db";
import {
  pendingInbounds,
  contacts,
  conversations,
  messages,
  mediaFiles,
  operators,
} from "../../db/schema";
import { eq, and, desc, sql, or, like } from "drizzle-orm";
import { UniversalInboundMessage } from "./types";
import { getAiPersona } from "../ai-persona";
import { SessionManager } from "../baileys/session-manager";
import { normalizeCanonicalPhone, buildPhoneSearchTerms } from "../utils";
import { sendPushToOperator } from "../push-notifications";
import { checkAndSendOperatorStatusAutoReply } from "./status-auto-reply";
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
            and(eq(conversations.tenantId, tenantId), eq(conversations.id, result.conversationId)),
          );
        SessionManager.getInstance().notifyPublic(tenantId, {
          type: "message",
          message: {
            ...msg,
            phone: inbound.fromPhone,
            queue: conv.queueState,
            operatorId: conv.operatorId,
          },
        });
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
      } catch {
        console.error("[Inbound] Mensagem persistida; notificação indisponível.");
      }
    }
    return result;
  }

  private async processInTransaction(
    inbound: UniversalInboundMessage,
    db: Transaction,
  ): Promise<{
    success: boolean;
    duplicate?: boolean;
    messageId?: string;
    conversationId?: string;
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

      // 3. Resolução da Conversa Ativa (conversations)
      let [activeConv] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, contact.id)))
        .orderBy(desc(conversations.lastMessageTime))
        .limit(1);

      if (activeConv) {
        const [locked] = await db
          .select()
          .from(conversations)
          .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, activeConv.id)))
          .for("update");
        activeConv = locked;
      }
      const aiPersona = getAiPersona(tenantId);
      const lastTextPreview = text || (media ? `[Mídia: ${media.fileName || media.mimeType}]` : "");
      const normalizedContactPhone = (cleanPhone || contact.phone || "").replace(/\D/g, "");
      let createdConversation = false;

      if (!activeConv) {
        // 3a. Criação da primeira conversa para o contato
        const convId = `conv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const contactId = contact.id;
        let initialOperatorId: string | null = null;
        let initialQueueState = "fila";

        // Na Meta, carteira não equivale a captura de atendimento.
        if (contact.walletOperatorId && provider !== "meta") {
          const [walletOp] = await db
            .select({ id: operators.id, name: operators.name })
            .from(operators)
            .where(
              and(eq(operators.id, contact.walletOperatorId), eq(operators.tenantId, tenantId)),
            );

          if (walletOp) {
            initialOperatorId = walletOp.id;
            initialQueueState = "meus";
          }
        }

        // Se não tem carteira e a empresa usa IA SDR
        if (!initialOperatorId) {
          if (tenantId === "valem") {
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
                  eq(conversations.tenantId, tenantId),
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
              and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, contactId)),
            )
            .orderBy(desc(conversations.lastMessageTime))
            .limit(1);
          if (existing) return existing;
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

      if (!createdConversation && activeConv.queueState === "finalizados") {
        // 3b. Reabertura consistente: reutiliza a mesma conversa preservando histórico
        let reOpenOperatorId: string | null =
          provider === "meta" ? null : activeConv.operatorId || null;
        let reOpenQueueState = "fila";

        if (contact.walletOperatorId && provider !== "meta") {
          const [walletOp] = await db
            .select({ id: operators.id, name: operators.name })
            .from(operators)
            .where(
              and(eq(operators.id, contact.walletOperatorId), eq(operators.tenantId, tenantId)),
            );

          if (walletOp) {
            reOpenOperatorId = walletOp.id;
            reOpenQueueState = "meus";
          }
        }

        if (!reOpenOperatorId) {
          if (tenantId === "valem") {
            reOpenQueueState = "automacao";
          } else {
            reOpenQueueState = "fila";
          }
        }

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
          .where(and(eq(conversations.id, activeConv.id), eq(conversations.tenantId, tenantId)))
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
          .where(and(eq(conversations.id, activeConv.id), eq(conversations.tenantId, tenantId)));
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
      };
    } catch (err) {
      throw err; // rollback de contato, conversa, mídia, mensagem e conclusão do evento
    }
  }
}

export const inboundProcessor = InboundProcessor.getInstance();
