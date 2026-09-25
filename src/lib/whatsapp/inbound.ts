import { db } from "../../db";
import {
  pendingInbounds,
  contacts,
  conversations,
  messages,
  mediaFiles,
  operators,
} from "../../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { UniversalInboundMessage } from "./types";
import { getAiPersona } from "../ai-persona";
import { SessionManager } from "../baileys/session-manager";

export class InboundProcessor {
  private static instance: InboundProcessor;

  private constructor() {}

  static getInstance(): InboundProcessor {
    if (!InboundProcessor.instance) {
      InboundProcessor.instance = new InboundProcessor();
    }
    return InboundProcessor.instance;
  }

  /**
   * Processa evento de entrada de mensagem (Baileys ou Meta) de forma resiliente,
   * garantindo deduplicação, criação de contato/conversa, persistência e notificação.
   */
  async process(inbound: UniversalInboundMessage): Promise<{
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
      senderName,
      text,
      media,
      quotedExternalId,
      timestamp,
      rawPayload,
    } = inbound;

    const cleanPhone = fromPhone.replace(/\D/g, "");
    if (!cleanPhone) {
      console.warn(`[InboundProcessor] Telefone vazio ignorado no tenant '${tenantId}'`);
      return { success: false, error: "Telefone de origem inválido" };
    }

    // 1. Deduplicação durável em pending_inbounds
    if (externalEventId) {
      const [existingEvent] = await db
        .select({ id: pendingInbounds.id, status: pendingInbounds.status })
        .from(pendingInbounds)
        .where(
          and(
            eq(pendingInbounds.tenantId, tenantId),
            eq(pendingInbounds.externalEventId, externalEventId)
          )
        );

      if (existingEvent) {
        if (existingEvent.status === "processed") {
          console.log(`[InboundProcessor] Evento duplicado descartado: ${externalEventId}`);
          return { success: true, duplicate: true };
        }
      }
    }

    const inboundId = `inb-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    try {
      await db.insert(pendingInbounds).values({
        id: inboundId,
        tenantId,
        provider,
        externalEventId: externalEventId || inboundId,
        payload: rawPayload || { text, fromPhone },
        status: "processing",
        attempts: 1,
        createdAt: new Date(),
      });
    } catch (insertErr: any) {
      const code = insertErr?.code || insertErr?.cause?.code;
      const constraint = insertErr?.constraint || insertErr?.cause?.constraint_name || insertErr?.cause?.constraint;
      const msg = `${insertErr?.message || ""} ${insertErr?.cause?.message || ""} ${insertErr?.detail || ""} ${insertErr?.cause?.detail || ""}`;
      const isDuplicate =
        code === "23505" ||
        constraint === "idx_pending_inbounds_tenant_event_uniq" ||
        msg.includes("idx_pending_inbounds_tenant_event_uniq") ||
        msg.includes("restrição de unicidade") ||
        msg.includes("unique constraint");

      if (externalEventId && isDuplicate) {
        console.log(
          `[InboundProcessor] Evento duplicado concorrente descartado (23505): ${externalEventId}`
        );
        return { success: true, duplicate: true };
      }
      throw insertErr;
    }

    try {
      // 2. Resolução do Contato (contacts)
      let [contact] = await db
        .select()
        .from(contacts)
        .where(
          and(
            eq(contacts.tenantId, tenantId),
            eq(contacts.phone, cleanPhone)
          )
        );

      if (!contact) {
        const contactId = `cont-${Date.now()}`;
        const newContactName = senderName?.trim() || cleanPhone;

        const [createdContact] = await db
          .insert(contacts)
          .values({
            id: contactId,
            tenantId,
            name: newContactName,
            phone: cleanPhone,
            mainChannel: "whatsapp",
            responsibleName: "Na Fila",
            createdAt: timestamp,
          })
          .returning();

        contact = createdContact;
      } else if (senderName && contact.name === cleanPhone) {
        // Se antes tínhamos apenas o número e agora recebemos o nome de perfil do WhatsApp
        await db
          .update(contacts)
          .set({ name: senderName.trim() })
          .where(and(eq(contacts.id, contact.id), eq(contacts.tenantId, tenantId)));
        contact.name = senderName.trim();
      }

      // 3. Resolução da Conversa Ativa (conversations)
      let [activeConv] = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.tenantId, tenantId),
            eq(conversations.contactId, contact.id)
          )
        )
        .orderBy(desc(conversations.lastMessageTime))
        .limit(1);

      const aiPersona = getAiPersona(tenantId);
      const isReopening = !activeConv || activeConv.queueState === "finalizados";

      if (isReopening) {
        const convId = `conv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        let initialOperatorId: string | null = null;
        let initialQueueState = "fila";

        // Se o cliente tem carteira fixa, roteia para o operador
        if (contact.walletOperatorId) {
          const [walletOp] = await db
            .select({ id: operators.id, name: operators.name })
            .from(operators)
            .where(
              and(
                eq(operators.id, contact.walletOperatorId),
                eq(operators.tenantId, tenantId)
              )
            );

          if (walletOp) {
            initialOperatorId = walletOp.id;
            initialQueueState = "meus";
          }
        }

        // Se não tem carteira e a empresa usa IA SDR (ex: Valem usa Valentina; Tecfag em MVP usa Fagner ou fila)
        if (!initialOperatorId) {
          if (tenantId === "valem") {
            initialQueueState = "automacao";
          } else {
            initialQueueState = "fila";
          }
        }

        const [createdConv] = await db
          .insert(conversations)
          .values({
            id: convId,
            tenantId,
            contactId: contact.id,
            operatorId: initialOperatorId,
            queueState: initialQueueState,
            unreadCount: 1,
            version: 1,
            lastMessageTime: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .returning();

        activeConv = createdConv;
      } else {
        // Incrementa não lidas e atualiza timestamp
        await db
          .update(conversations)
          .set({
            unreadCount: (activeConv.unreadCount || 0) + 1,
            lastMessageTime: timestamp,
            updatedAt: new Date(),
          })
          .where(and(eq(conversations.id, activeConv.id), eq(conversations.tenantId, tenantId)));
      }

      // 4. Registro de Mídia (se houver)
      if (media && (media.url || media.localPath)) {
        await db.insert(mediaFiles).values({
          id: `med-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          tenantId,
          conversationId: activeConv.id,
          fileName: media.fileName || "arquivo",
          mimeType: media.mimeType,
          fileSize: media.fileSize || 0,
          base64Data: media.url || media.localPath || "",
          createdAt: timestamp,
        });
      }

      // 5. Inserção da Mensagem Recebida (messages)
      const messageId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      await db.insert(messages).values({
        id: messageId,
        tenantId,
        conversationId: activeConv.id,
        senderType: "client",
        senderName: contact.name,
        content: text || (media ? `[Mídia: ${media.fileName || media.mimeType}]` : ""),
        quotedMessageId: quotedExternalId || null,
        isInternalNote: false,
        direction: "inbound",
        provider,
        externalId: externalEventId || null,
        status: "accepted",
        sentAt: timestamp,
        updatedAt: timestamp,
      });

      // 6. Notificação via SSE em tempo real para os atendentes conectados
      SessionManager.getInstance().notifyPublic(tenantId, {
        type: "message",
        message: {
          id: messageId,
          conversationId: activeConv.id,
          author: contact.name,
          text: text || "",
          time: timestamp.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
          side: "in",
        },
      });

      // 7. Conclusão do registro em pending_inbounds
      await db
        .update(pendingInbounds)
        .set({ status: "processed", processedAt: new Date() })
        .where(eq(pendingInbounds.id, inboundId));

      return {
        success: true,
        messageId,
        conversationId: activeConv.id,
      };

    } catch (err: any) {
      console.error(`[InboundProcessor] Erro ao processar inbound ${inboundId}:`, err);

      await db
        .update(pendingInbounds)
        .set({
          status: "failed",
          errorMessage: err.message || "Erro desconhecido",
        })
        .where(eq(pendingInbounds.id, inboundId));

      return {
        success: false,
        error: err.message,
      };
    }
  }
}

export const inboundProcessor = InboundProcessor.getInstance();
