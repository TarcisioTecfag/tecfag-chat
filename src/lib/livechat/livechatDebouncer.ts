// ══════════════════════════════════════════════════════════════════════════════
// 🛑 LIVE CHAT DEBOUNCER & STOP-AND-RESTART (Espelho WhatsApp SDR Engine)
// Acúmulo de mensagens picadas + Cancelamento Imediato via AbortController +
// Despacho fragmentado de balões com digitação humanizada e Multimodalidade
// ══════════════════════════════════════════════════════════════════════════════

import { processVisitorMessage, type AiResponse } from "./livechatAI";
import { saveMessage, updateVisitorData, getOrCreateActiveChat } from "./livechatStorage";
import { searchProducts, extractSearchTermFromUrl } from "./trayCatalogService";
import type { LcVisitor, LcChat } from "../../db/schema";

export interface QueuedLiveChatMessage {
  type: "text" | "media" | "audio";
  content: string;
  mediaUrl?: string;
  fileName?: string;
  fileSize?: number;
  durationSec?: number;
  inlineAttachment?: { mimeType: string; data: string };
  receivedAt: Date;
}

interface VisitorDebounceSession {
  tenantId: string;
  visitorId: string;
  chatId: string;
  visitor: LcVisitor;
  chat: LcChat;
  wsSend: (payload: any) => void;
  broadcastToOps: (payload: any) => void;
  timer: NodeJS.Timeout | null;
  messagesQueue: QueuedLiveChatMessage[];
  abortController: AbortController | null;
  isProcessing: boolean;
}

export class LiveChatDebouncer {
  private static instance: LiveChatDebouncer;
  private sessions: Map<string, VisitorDebounceSession> = new Map();
  private readonly DEBOUNCE_DELAY_MS = 15000; // 15s de silêncio para acúmulo de mensagens picadas

  private constructor() {}

  public static getInstance(): LiveChatDebouncer {
    if (!LiveChatDebouncer.instance) {
      LiveChatDebouncer.instance = new LiveChatDebouncer();
    }
    return LiveChatDebouncer.instance;
  }

  /**
   * Limpa a sessão ao desconectar ou ao operador assumir
   */
  public clearSession(visitorId: string): void {
    const session = this.sessions.get(visitorId);
    if (session) {
      if (session.timer) clearTimeout(session.timer);
      if (session.abortController) session.abortController.abort();
      this.sessions.delete(visitorId);
      console.log(`[LC Debouncer] Sessão limpa para visitante ${visitorId}`);
    }
  }

  /**
   * Recebe nova mensagem do visitante no Live Chat
   */
  public pushIncomingMessage(
    tenantId: string,
    visitor: LcVisitor,
    chat: LcChat,
    messageItem: QueuedLiveChatMessage,
    wsSend: (payload: any) => void,
    broadcastToOps: (payload: any) => void
  ): void {
    let session = this.sessions.get(visitor.id);

    if (!session) {
      session = {
        tenantId,
        visitorId: visitor.id,
        chatId: chat.id,
        visitor,
        chat,
        wsSend,
        broadcastToOps,
        timer: null,
        messagesQueue: [],
        abortController: null,
        isProcessing: false,
      };
      this.sessions.set(visitor.id, session);
    } else {
      session.visitor = visitor;
      session.chat = chat;
      session.wsSend = wsSend;
      session.broadcastToOps = broadcastToOps;
    }

    // ── STOP & RESTART IMEDIATO ─────────────────────────────────────────────
    if (session.isProcessing && session.abortController) {
      console.log(`[LC Debouncer] 🛑 STOP & RESTART acionado para visitante ${visitor.id}! Cancelando processamento anterior.`);
      session.abortController.abort();
      session.abortController = null;
      session.isProcessing = false;
      session.wsSend({ type: "typing", isTyping: false });
    }

    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }

    session.messagesQueue.push(messageItem);

    session.timer = setTimeout(() => {
      this.processDebouncedBatch(visitor.id);
    }, this.DEBOUNCE_DELAY_MS);
  }

  /**
   * Processa o lote acumulado após o silêncio do visitante
   */
  private async processDebouncedBatch(visitorId: string): Promise<void> {
    const session = this.sessions.get(visitorId);
    if (!session || session.messagesQueue.length === 0) return;

    const abortController = new AbortController();
    session.abortController = abortController;
    session.isProcessing = true;
    const signal = abortController.signal;

    // Captura anexo inline mais recente se houver
    const latestInlineAttachment = [...session.messagesQueue]
      .reverse()
      .find(m => m.inlineAttachment)?.inlineAttachment;

    const combinedTexts = session.messagesQueue
      .map(m => m.content.trim())
      .filter(Boolean);

    const consolidatedPrompt = combinedTexts.join("\n");
    session.messagesQueue = [];

    if (!consolidatedPrompt && !latestInlineAttachment) {
      session.isProcessing = false;
      return;
    }

    try {
      session.wsSend({ type: "typing", isTyping: true });

      const aiResponse: AiResponse = await processVisitorMessage(
        session.tenantId,
        session.visitor,
        session.chat,
        consolidatedPrompt || "O cliente enviou um anexo.",
        signal,
        latestInlineAttachment
      );

      if (signal.aborted) {
        session.wsSend({ type: "typing", isTyping: false });
        return;
      }

      if (aiResponse.score !== undefined) {
        await updateVisitorData(session.tenantId, session.visitor.id, {
          intentScore: aiResponse.score,
          ...(aiResponse.stage ? { pipelineStage: aiResponse.stage } : {}),
        });
      }

      if (aiResponse.cnpjToCheck) {
        await updateVisitorData(session.tenantId, session.visitor.id, { cnpj: aiResponse.cnpjToCheck });
      }

      // Envio cadenciado e fragmentado dos balões
      const fragments = aiResponse.messagesToSend && aiResponse.messagesToSend.length > 0
        ? aiResponse.messagesToSend
        : [aiResponse.text];

      for (let i = 0; i < fragments.length; i++) {
        if (signal.aborted) {
          session.wsSend({ type: "typing", isTyping: false });
          return;
        }

        const fragmentText = fragments[i].trim();
        if (!fragmentText) continue;

        session.wsSend({ type: "typing", isTyping: true });

        // Delay humanizado rápido (800ms a 2000ms)
        const typingDelay = Math.min(2000, Math.max(800, fragmentText.length * 28));
        const startTime = Date.now();
        while (Date.now() - startTime < typingDelay) {
          if (signal.aborted) {
            session.wsSend({ type: "typing", isTyping: false });
            return;
          }
          await new Promise(r => setTimeout(r, 80));
        }

        if (signal.aborted) {
          session.wsSend({ type: "typing", isTyping: false });
          return;
        }

        session.wsSend({ type: "typing", isTyping: false });

        const savedMsg = await saveMessage(session.tenantId, session.chat.id, "ai", fragmentText);

        session.wsSend({
          type: "message",
          chatId: session.chat.id,
          messageId: savedMsg.id,
          sender: "ai",
          content: fragmentText,
        });

        session.broadcastToOps({
          type: "new_message",
          chatId: session.chat.id,
          visitorId: session.visitor.id,
          sender: "ai",
          content: fragmentText,
        });

        if (i < fragments.length - 1) {
          await new Promise(r => setTimeout(r, 200));
        }
      }

      session.isProcessing = false;
      session.abortController = null;

    } catch (err: any) {
      if (err?.name !== "AbortError" && !signal.aborted) {
        console.error(`[LC Debouncer] Erro no processamento:`, err);
      }
      session.wsSend({ type: "typing", isTyping: false });
      session.isProcessing = false;
      session.abortController = null;
    }
  }
}
