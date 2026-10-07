import { db } from "../../db";
import { conversations, contacts, operators, messages } from "../../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { outboundQueue } from "./outbound";
import { SessionManager } from "../baileys/session-manager";

export const OPERATOR_PAUSE_AUTO_REPLY_TEXT = "Olá, estou em minha pausa, logo te retorno";

// Cooldown de 20 minutos por conversa para evitar repetições excessivas (anti-spam)
export const AUTO_REPLY_COOLDOWN_MS = 20 * 60 * 1000;

export interface StatusAutoReplyParams {
  tenantId: string;
  conversationId: string;
  contactId?: string;
  incomingMessageTime?: Date;
}

export interface StatusAutoReplyResult {
  triggered: boolean;
  reason?: string;
  messageId?: string;
  operatorId?: string;
  operatorStatus?: string;
}

/**
 * Avalia se o operador responsável por uma conversa está ausente (em pausa ou desconectado)
 * e, se elegível, envia a resposta automática ("Olá, estou em minha pausa, logo te retorno")
 * respeitando janela de atendimento, regras anti-spam e emitindo atualização em tempo real via SSE.
 */
export async function checkAndSendOperatorStatusAutoReply({
  tenantId,
  conversationId,
  contactId,
  incomingMessageTime,
}: StatusAutoReplyParams): Promise<StatusAutoReplyResult> {
  try {
    if (!tenantId || !conversationId) {
      return { triggered: false, reason: "missing_params" };
    }

    // 1. Evitar disparo para mensagens antigas (ex: sincronização de histórico / recovery)
    if (incomingMessageTime) {
      const msgAgeMs = Date.now() - new Date(incomingMessageTime).getTime();
      if (msgAgeMs > 5 * 60 * 1000) {
        return { triggered: false, reason: "stale_incoming_message" };
      }
    }

    // 2. Buscar conversa isolada no tenant
    const [conv] = await db
      .select({
        id: conversations.id,
        tenantId: conversations.tenantId,
        operatorId: conversations.operatorId,
        queueState: conversations.queueState,
        contactId: conversations.contactId,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.tenantId, tenantId)
        )
      )
      .limit(1);

    if (!conv) {
      return { triggered: false, reason: "conversation_not_found" };
    }

    // Se a conversa está na automação (SDR) ou na fila sem responsável, nenhuma auto-resposta de pausa se aplica
    if (conv.queueState === "automacao") {
      return { triggered: false, reason: "handled_by_automation" };
    }

    // 3. Determinar o operador responsável pela conversa
    let targetOperatorId: string | null = conv.operatorId || null;

    if (!targetOperatorId && (conv.contactId || contactId)) {
      const [cont] = await db
        .select({ walletOperatorId: contacts.walletOperatorId })
        .from(contacts)
        .where(
          and(
            eq(contacts.id, conv.contactId || contactId!),
            eq(contacts.tenantId, tenantId)
          )
        )
        .limit(1);

      if (cont?.walletOperatorId) {
        targetOperatorId = cont.walletOperatorId;
      }
    }

    if (!targetOperatorId) {
      return { triggered: false, reason: "no_assigned_operator" };
    }

    // 4. Buscar status do operador
    const [op] = await db
      .select({
        id: operators.id,
        name: operators.name,
        status: operators.status,
      })
      .from(operators)
      .where(
        and(
          eq(operators.id, targetOperatorId),
          eq(operators.tenantId, tenantId)
        )
      )
      .limit(1);

    if (!op) {
      return { triggered: false, reason: "operator_not_found" };
    }

    // Apenas dispara se o status for "pausa" ou "desconectado"
    const isAway = op.status === "pausa" || op.status === "desconectado";
    if (!isAway) {
      return {
        triggered: false,
        reason: "operator_available",
        operatorId: op.id,
        operatorStatus: op.status,
      };
    }

    // 5. Blindagem Anti-Spam: Verificar se já enviamos a mensagem de pausa recentemente
    const [lastAutoReply] = await db
      .select({
        id: messages.id,
        sentAt: messages.sentAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, tenantId),
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "outbound"),
          eq(messages.content, OPERATOR_PAUSE_AUTO_REPLY_TEXT)
        )
      )
      .orderBy(desc(messages.sentAt))
      .limit(1);

    if (lastAutoReply) {
      const elapsedMs = Date.now() - new Date(lastAutoReply.sentAt).getTime();
      if (elapsedMs < AUTO_REPLY_COOLDOWN_MS) {
        return {
          triggered: false,
          reason: "cooldown_active",
          operatorId: op.id,
          operatorStatus: op.status,
        };
      }
    }

    // 6. Buscar dados de envio do contato
    const [contact] = await db
      .select({
        phone: contacts.phone,
        whatsappUserId: contacts.whatsappUserId,
        name: contacts.name,
      })
      .from(contacts)
      .where(
        and(
          eq(contacts.id, conv.contactId),
          eq(contacts.tenantId, tenantId)
        )
      )
      .limit(1);

    if (!contact || (!contact.phone && !contact.whatsappUserId)) {
      return { triggered: false, reason: "contact_missing_phone" };
    }

    // 7. Despachar a resposta automática via OutboundQueue
    const outboundResult = await outboundQueue.enqueueAndSend({
      tenantId,
      conversationId,
      recipientPhone: contact.phone || "",
      recipientUserId: contact.whatsappUserId || undefined,
      text: OPERATOR_PAUSE_AUTO_REPLY_TEXT,
      operatorId: op.id,
      senderName: op.name,
    });

    if (!outboundResult.success) {
      console.warn(`[StatusAutoReply] Envio rejeitado para conversa ${conversationId}:`, outboundResult.error);
      return {
        triggered: false,
        reason: outboundResult.error || "outbound_failed",
        operatorId: op.id,
        operatorStatus: op.status,
      };
    }

    // 8. Notificar atendentes conectados via SSE para renderização imediata na timeline
    try {
      SessionManager.getInstance().notifyPublic(tenantId, {
        type: "message",
        message: {
          id: outboundResult.messageId,
          conversationId,
          senderType: "agent",
          senderName: op.name,
          content: OPERATOR_PAUSE_AUTO_REPLY_TEXT,
          phone: contact.phone || "",
          avatar: null,
          sentAt: new Date(),
          queue: conv.queueState,
          operatorId: op.id,
          walletOperatorId: op.id,
        },
      });
    } catch (sseErr) {
      console.warn("[StatusAutoReply] Erro ao emitir evento SSE:", sseErr);
    }

    console.log(
      `[StatusAutoReply] 🟢 Auto-resposta de pausa enviada com sucesso para conversa ${conversationId} (Operador: ${op.name}, Status: ${op.status})`
    );

    return {
      triggered: true,
      messageId: outboundResult.messageId,
      operatorId: op.id,
      operatorStatus: op.status,
    };
  } catch (err: any) {
    console.error("[StatusAutoReply] Erro inesperado ao processar auto-resposta:", err);
    return { triggered: false, reason: err?.message || "internal_error" };
  }
}
