// ══════════════════════════════════════════════════════════════════════════════
// 🛑 LIVE CHAT DEBOUNCER & STOP-AND-RESTART (Espelho WhatsApp SDR Engine)
// Acúmulo de mensagens picadas + Cancelamento Imediato via AbortController +
// Despacho fragmentado de balões com digitação humanizada
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
  private readonly DEBOUNCE_DELAY_MS = 4500; // 4.5 segundos de silêncio para Live Chat Web

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
   * 1) Acúmulo de mensagens picadas
   * 2) Stop & Restart imediato se Valentina estiver processando ou digitando
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
      // Atualizar referências vivas
      session.visitor = visitor;
      session.chat = chat;
      session.wsSend = wsSend;
      session.broadcastToOps = broadcastToOps;
    }

    // ── REGRA STOP & RESTART ────────────────────────────────────────────────
    // Se Valentina já estiver pensando ou digitando balões, aborta na hora!
    if (session.isProcessing && session.abortController) {
      console.log(`[LC Debouncer] 🛑 STOP & RESTART acionado para visitante ${visitor.id}! Cancelando resposta em andamento...`);
      session.abortController.abort();
      session.abortController = null;
      session.isProcessing = false;
      // Desativa digitação imediatamente na UI
      session.wsSend({ type: "typing", isTyping: false });
    }

    // Cancelar timer de debounce anterior
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
      console.log(`[LC Debouncer] 🔄 Nova mensagem recebida dentro da janela. Timer zerado! Total no lote: ${session.messagesQueue.length + 1}`);
    }

    // Adicionar mensagem à fila do lote
    session.messagesQueue.push(messageItem);

    // Iniciar contagem de silêncio de 4.5 segundos
    session.timer = setTimeout(() => {
      this.processDebouncedBatch(visitor.id);
    }, this.DEBOUNCE_DELAY_MS);

    console.log(`[LC Debouncer] ⏳ Mensagem enfileirada. Valentina aguardará 4.5s de silêncio para visitante ${visitor.id}...`);
  }

  /**
   * Processa o lote acumulado após o silêncio do visitante
   */
  private async processDebouncedBatch(visitorId: string): Promise<void> {
    const session = this.sessions.get(visitorId);
    if (!session || session.messagesQueue.length === 0) return;

    // Criar novo AbortController para essa execução
    const abortController = new AbortController();
    session.abortController = abortController;
    session.isProcessing = true;
    const signal = abortController.signal;

    // Consolidar mensagens do lote
    const combinedTexts = session.messagesQueue
      .map(m => m.content.trim())
      .filter(Boolean);

    const consolidatedPrompt = combinedTexts.join("\n");
    session.messagesQueue = []; // Limpa a fila após capturar

    if (!consolidatedPrompt) {
      session.isProcessing = false;
      return;
    }

    try {
      // 1. Mostrar digitação imediatamente ao começar o raciocínio
      session.wsSend({ type: "typing", isTyping: true });

      // 2. Chamar o motor de IA com histórico do banco e prompt do sistema
      const aiResponse: AiResponse = await processVisitorMessage(
        session.tenantId,
        session.visitor,
        session.chat,
        consolidatedPrompt,
        signal
      );

      if (signal.aborted) {
        console.log(`[LC Debouncer] Execução abortada por nova mensagem.`);
        session.wsSend({ type: "typing", isTyping: false });
        return;
      }

      // 3. Atualizar dados extraídos do visitante (score, stage, etc.)
      if (aiResponse.score !== undefined) {
        await updateVisitorData(session.tenantId, session.visitor.id, {
          intentScore: aiResponse.score,
          ...(aiResponse.stage ? { pipelineStage: aiResponse.stage } : {}),
        });
      }

      if (aiResponse.cnpjToCheck) {
        await updateVisitorData(session.tenantId, session.visitor.id, { cnpj: aiResponse.cnpjToCheck });
      }

      // 4. Envio Fragmentado dos Balões (messagesToSend) com Typing Delay Realista
      const fragments = aiResponse.messagesToSend && aiResponse.messagesToSend.length > 0
        ? aiResponse.messagesToSend
        : [aiResponse.text];

      for (let i = 0; i < fragments.length; i++) {
        if (signal.aborted) {
          console.log(`[LC Debouncer] Envio de balões interrompido por Stop & Restart.`);
          session.wsSend({ type: "typing", isTyping: false });
          return;
        }

        const fragmentText = fragments[i].trim();
        if (!fragmentText) continue;

        // Efeito de digitação visível na tela
        session.wsSend({ type: "typing", isTyping: true });

        // Delay humanizado proporcional ao tamanho do balão (entre 1.2s e 2.8s)
        const typingDelay = Math.min(2800, Math.max(1200, fragmentText.length * 35));
        const startTime = Date.now();
        while (Date.now() - startTime < typingDelay) {
          if (signal.aborted) {
            session.wsSend({ type: "typing", isTyping: false });
            return;
          }
          await new Promise(r => setTimeout(r, 100));
        }

        if (signal.aborted) {
          session.wsSend({ type: "typing", isTyping: false });
          return;
        }

        // Desliga digitação temporariamente para entregar o balão
        session.wsSend({ type: "typing", isTyping: false });

        // Salva no banco de dados (persistência anti-amnésia)
        const savedMsg = await saveMessage(session.tenantId, session.chat.id, "ai", fragmentText);

        // Envia ao cliente no WebSocket
        session.wsSend({
          type: "message",
          chatId: session.chat.id,
          messageId: savedMsg.id,
          sender: "ai",
          content: fragmentText,
        });

        // Transmite para operadores em tempo real
        session.broadcastToOps({
          type: "new_message",
          chatId: session.chat.id,
          visitorId: session.visitor.id,
          sender: "ai",
          content: fragmentText,
        });

        // Pequeno respiro entre balões (300ms)
        if (i < fragments.length - 1) {
          await new Promise(r => setTimeout(r, 300));
        }
      }

      // 5. Se houver recomendação de produto Tray ou página atual
      if (aiResponse.trayProductId || session.visitor.currentUrl) {
        try {
          const searchTerm = session.visitor.currentUrl
            ? extractSearchTermFromUrl(session.visitor.currentUrl)
            : consolidatedPrompt;
          const products = await searchProducts(session.tenantId, searchTerm, 1);
          if (products[0]) {
            session.wsSend({
              type: "tray_product_card",
              chatId: session.chat.id,
              product: products[0],
            });
          }
        } catch (e) {
          console.warn("[LC Debouncer] Falha na busca de produtos Tray:", e);
        }
      }

      session.isProcessing = false;
      session.abortController = null;

    } catch (err: any) {
      if (err?.name === "AbortError" || signal.aborted) {
        console.log(`[LC Debouncer] Chamada Vertex AI abortada por nova mensagem (Stop & Restart).`);
      } else {
        console.error(`[LC Debouncer] Erro ao processar mensagem do visitante:`, err);
      }
      session.wsSend({ type: "typing", isTyping: false });
      session.isProcessing = false;
      session.abortController = null;
    }
  }
}
