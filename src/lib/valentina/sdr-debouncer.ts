import { SdrEngine } from "./sdr-engine";
import { SessionManager, resolveRealJid } from "../baileys/session-manager";

export interface QueuedMessageItem {
  messageId?: string;
  text: string;
  mediaType?: "text" | "image" | "audio" | "document";
  mimeType?: string;
  mediaBase64?: string;
  receivedAt: Date;
  rawMsg?: any;
}

interface DebounceSession {
  tenantId: string;
  conversationId: string;
  phone: string;
  timer: NodeJS.Timeout | null;
  messagesQueue: QueuedMessageItem[];
  abortController: AbortController | null;
  isProcessing: boolean;
}

export class SdrDebouncer {
  private static instance: SdrDebouncer;
  private sessions: Map<string, DebounceSession> = new Map();
  private readonly DEBOUNCE_DELAY_MS = 15000; // 15 segundos

  private constructor() {}

  public static getInstance(): SdrDebouncer {
    if (!SdrDebouncer.instance) {
      SdrDebouncer.instance = new SdrDebouncer();
    }
    return SdrDebouncer.instance;
  }

  /**
   * Limpa e cancela completamente o estado de debounce de uma conversa (!reset)
   */
  public clearSession(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (session) {
      if (session.timer) clearTimeout(session.timer);
      if (session.abortController) session.abortController.abort();
      this.sessions.delete(conversationId);
      console.log(`[SdrDebouncer] Sessão zerada com sucesso para conversa ${conversationId} via !reset`);
    }
  }

  /**
   * Recebe uma nova mensagem do cliente (texto, áudio ou imagem)
   * Aplica 15s de debounce e Stop & Restart imediato se Valentina estiver processando!
   */
  public pushIncomingMessage(
    tenantId: string,
    conversationId: string,
    phone: string,
    messageItem: QueuedMessageItem
  ): void {
    let session = this.sessions.get(conversationId);

    if (!session) {
      session = {
        tenantId,
        conversationId,
        phone,
        timer: null,
        messagesQueue: [],
        abortController: null,
        isProcessing: false,
      };
      this.sessions.set(conversationId, session);
    }

    // Regra 3: STOP & RESTART
    // Se Valentina já estiver pensando/processando a chamada com Gemini, aborta o AbortController!
    if (session.isProcessing && session.abortController) {
      console.log(`[SdrDebouncer] 🛑 STOP & RESTART acionado para conversa ${conversationId}! Cancelando resposta em andamento...`);
      session.abortController.abort();
      session.abortController = null;
      session.isProcessing = false;
    }

    // Cancelar timer de 15s existente
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
      console.log(`[SdrDebouncer] 🔄 Nova mensagem recebida dentro da janela de 15s. Timer de 15s zerado! Total no lote: ${session.messagesQueue.length + 1}`);
    }

    // Adicionar mensagem à fila do lote
    session.messagesQueue.push(messageItem);

    // Regra 2: Aguarda 15 segundos sem NENHUMA nova mensagem do cliente antes de disparar
    session.timer = setTimeout(() => {
      this.processDebouncedBatch(conversationId);
    }, this.DEBOUNCE_DELAY_MS);

    console.log(`[SdrDebouncer] ⏳ Mensagem enfileirada. Valentina aguardará 15s de silêncio para a conversa ${conversationId}...`);
  }

  /**
   * Executa o lote consolidado acumulado após 15s de silêncio do cliente
   */
  private async processDebouncedBatch(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (!session || session.messagesQueue.length === 0) return;

    // Criar novo AbortController para essa execução
    const abortController = new AbortController();
    session.abortController = abortController;
    session.isProcessing = true;

    // 1. Mostrar caixinha de "digitando..." no WhatsApp imediatamente ao iniciar raciocínio
    try {
      const sock = SessionManager.getInstance().getSession(session.tenantId);
      if (sock) {
        const realJid = await resolveRealJid(sock, session.phone);
        await sock.sendPresenceUpdate("composing", realJid);
      }
    } catch { /* silencia */ }

    // Extrair lote atual e esvaziar a fila
    const batchToProcess = [...session.messagesQueue];
    session.messagesQueue = [];
    session.timer = null;

    console.log(`[SdrDebouncer] 🚀 15 segundos se passaram sem novas mensagens. Iniciando raciocínio do Gemini 2.5 Pro para lote de ${batchToProcess.length} mensagem(ns)...`);

    try {
      const success = await SdrEngine.getInstance().processBatchMessages(
        session.tenantId,
        session.conversationId,
        session.phone,
        batchToProcess,
        abortController.signal
      );

      if (success) {
        console.log(`[SdrDebouncer] ✅ Lote de mensagens processado com sucesso para conversa ${conversationId}!`);
      }
    } catch (err: any) {
      if (err.name === "AbortError" || abortController.signal.aborted) {
        console.log(`[SdrDebouncer] Processamento cancelado gracioso para conversa ${conversationId} (Stop & Restart)`);
      } else {
        console.error(`[SdrDebouncer] Erro ao processar lote:`, err?.message || err);
      }
    } finally {
      if (this.sessions.get(conversationId)?.abortController === abortController) {
        session.isProcessing = false;
        session.abortController = null;
      }
    }
  }
}
