import makeWASocket, { 
  DisconnectReason, 
  WASocket, 
  initAuthCreds,
  downloadMediaMessage,
  proto,
  Browsers,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
} from "@whiskeysockets/baileys";
import NodeCache from "node-cache";
import pino from "pino";
import fs from "fs";
import path from "path";
import { useDrizzleAuthState } from "./drizzle-auth";
import { db } from "../../db";
import { channelConfigs, contacts, conversations, messages, mediaFiles, responseTimeLogs, agentFlowStates } from "../../db/schema";
import { eq, isNull, and, or, inArray, desc, sql } from "drizzle-orm";
import { SlaEngine } from "../sla-engine";
import { SdrEngine } from "../valentina/sdr-engine";
import { SdrDebouncer } from "../valentina/sdr-debouncer";
import { urlToBase64 } from "../utils";
import { sendPushToOperator } from "../push-notifications";
import { shouldIgnoreJid, ignoreReason } from "./jid-validator";
import { getAiPersona } from "../ai-persona";

export type SessionStatus = "disconnected" | "qr_ready" | "connecting" | "connected" | "switching";

export type SessionEvent =
  | { type: "qr"; qr: string }
  | { type: "status"; status: SessionStatus; phone?: string }
  | { type: "message"; message: any }
  | { type: "contact_avatar"; contactId: string; phone: string; avatar: string }
  | {
      type: "queue_update";
      conversationId: string;
      queueState: string;
      operatorId: string | null;
      sectorId: string | null;
      responsibleName?: string;
      version?: number;
    }
  | { type: "contact_updated"; contactId?: string; contact?: any; updates?: any }
  | { type: "chat_updated"; chat: any }
  | { type: "presence_update"; id: string; presences: Record<string, any> };

export type SessionListener = (event: SessionEvent) => void;

function phoneIdentityVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return [];
  const variants = new Set([digits]);
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    variants.add(digits.slice(2));
  }
  return [...variants];
}

export class SessionManager {
  private static instance: SessionManager;
  private sessions = new Map<string, WASocket>();
  private sessionStatuses = new Map<string, SessionStatus>();
  private sessionQrs = new Map<string, string>();
  private listeners = new Map<string, Set<SessionListener>>();
  // Cache de mensagens para permitir retransmissão (obrigatório para evitar timeouts no sendMessage)
  private msgRetryCounterCaches = new Map<string, NodeCache>();
  // Mutex por tenant: evita duas inicializações simultâneas de sessão
  private initMutex = new Map<string, Promise<WASocket>>();
  // Flag para evitar boot duplo
  private booted = false;
  // Flag de encerramento do processo (Railway deploy/restart)
  private isShuttingDown = false;
  // Cache global de versão WA Web — evita bater no servidor a cada reconexão
  // Compartilhado entre todos os tenants; TTL de 4 horas (14400000 ms)
  private static waVersionCache: {
    version: [number, number, number];
    fetchedAt: number;
  } | null = null;
  private static readonly WA_VERSION_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4h
  // Versão de fallback conhecida — atualizar se o Baileys publicar uma mais recente
  private static readonly WA_VERSION_FALLBACK: [number, number, number] = [2, 3000, 1049075336];
  // Contadores de retry por tenant — usados para backoff exponencial
  private reconnectAttempts = new Map<string, number>();

  private constructor() {}

  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    console.log("[SessionManager] Recebido sinal de encerramento do processo (SIGTERM/SIGINT). Fechando sockets Baileys com segurança...");

    for (const [tenantId, sock] of this.sessions.entries()) {
      try {
        console.log(`[SessionManager] Encerrando socket para tenant ${tenantId}...`);
        sock.end(undefined);
      } catch (err) {
        console.warn(`[SessionManager] Erro ao fechar socket tenant ${tenantId}:`, err);
      }
    }
    this.sessions.clear();
    console.log("[SessionManager] Sockets Baileys encerrados com segurança.");
  }

  public static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
      // Auto-boot: reconectar sessões persistidas no banco ao iniciar o servidor
      SessionManager.instance.autoBootFromDB().catch((err) =>
        console.error("[SessionManager] Erro no auto-boot:", err)
      );
    }
    return SessionManager.instance;
  }

  /**
   * Ao iniciar o servidor, busca todos os tenants que possuem
   * credenciais Baileys salvas no banco e tenta reconectar automaticamente.
   * Isso garante que após restart do Railway (deploy/crash), a sessão
   * volta sozinha sem necessidade de gerar novo QR Code.
   */
  private async autoBootFromDB(): Promise<void> {
    if (this.booted) return;
    this.booted = true;

    try {
      // Aguarda 2s para o banco estar disponível após o boot
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const configs = await db.query.channelConfigs.findMany();
      const tenantsWithKeys = configs.filter(
        (c) => c.baileysAuthKeys !== null && c.baileysAuthKeys !== undefined
      );

      if (tenantsWithKeys.length === 0) {
        console.log("[SessionManager] Auto-boot: nenhum tenant com credenciais salvas — aguardando QR manual.");
        return;
      }

      console.log(`[SessionManager] Auto-boot: reconectando ${tenantsWithKeys.length} tenant(s) com credenciais salvas: ${tenantsWithKeys.map((c) => c.tenantId).join(", ")}`);

      for (const config of tenantsWithKeys) {
        console.log(`[SessionManager] Auto-boot: iniciando sessão para tenant ${config.tenantId}...`);
        this.initSession(config.tenantId).catch((err) =>
          console.error(`[SessionManager] Auto-boot: erro ao reconectar tenant ${config.tenantId}:`, err)
        );
        // Pequeno intervalo entre tenants para não sobrecarregar
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (err) {
      console.error("[SessionManager] Auto-boot: erro ao buscar configs no banco:", err);
    }
  }

  public registerListener(tenantId: string, listener: SessionListener, replayCurrent = true) {
    if (!this.listeners.has(tenantId)) {
      this.listeners.set(tenantId, new Set());
    }
    this.listeners.get(tenantId)!.add(listener);

    if (!replayCurrent) return;

    // Enviar status atual imediatamente
    const status = this.sessionStatuses.get(tenantId) || "disconnected";
    listener({ type: "status", status, phone: undefined });
    
    // Se tiver QR code guardado, enviar imediatamente
    const qr = this.sessionQrs.get(tenantId);
    if (qr && status === "qr_ready") {
      listener({ type: "qr", qr });
    }
  }

  public unregisterListener(tenantId: string, listener: SessionListener) {
    const tenantListeners = this.listeners.get(tenantId);
    if (tenantListeners) {
      tenantListeners.delete(listener);
    }
  }

  private notify(tenantId: string, event: SessionEvent) {
    const tenantListeners = this.listeners.get(tenantId);
    if (tenantListeners) {
      for (const listener of tenantListeners) {
        try {
          listener(event);
        } catch (e) {
          console.error(`Erro no listener do tenant ${tenantId}:`, e);
        }
      }
    }
  }

  /** Expõe o notify para uso externo (ex: endpoints de sync) */
  public notifyPublic(tenantId: string, event: SessionEvent) {
    this.notify(tenantId, event);
  }

  public getStatus(tenantId: string): SessionStatus {
    return this.sessionStatuses.get(tenantId) || "disconnected";
  }

  public getQr(tenantId: string): string | undefined {
    return this.sessionQrs.get(tenantId);
  }

  public getSession(tenantId: string): WASocket | undefined {
    return this.sessions.get(tenantId);
  }

  /** Subscreve presença para um JID de cliente (para capturar digitando/gravando) */
  public async subscribePresence(tenantId: string, jid: string) {
    const sock = this.sessions.get(tenantId);
    if (!sock || !jid) return;

    try {
      const jidsToSubscribe: string[] = [];

      if (jid.includes("@")) {
        // Validar que o número antes do @ não está vazio (ex: "@s.whatsapp.net" é inválido)
        const numberPart = jid.split("@")[0];
        if (!numberPart || numberPart.length < 5) {
          console.warn(`[Baileys Presence] JID inválido ignorado para tenant ${tenantId}: "${jid}"`);
          return;
        }
        jidsToSubscribe.push(jid);
      } else {
        let digits = jid.replace(/\D/g, "");
        if (!digits) {
          console.warn(`[Baileys Presence] Número vazio ignorado para tenant ${tenantId}`);
          return;
        }
        // Se o número não tem o código do país '55' (tem 10 ou 11 dígitos, ex: 14981123456)
        if (digits.length === 10 || digits.length === 11) {
          digits = `55${digits}`;
        }

        jidsToSubscribe.push(`${digits}@s.whatsapp.net`);

        // Se for um celular brasileiro de 13 dígitos (55 + DDD + 9 + 8 dígitos)
        // ex: 5514981123456 -> também subscreve sem o 9 (551481123456)
        if (digits.startsWith("55") && digits.length === 13 && digits[4] === "9") {
          const withoutNine = `${digits.substring(0, 4)}${digits.substring(5)}`;
          jidsToSubscribe.push(`${withoutNine}@s.whatsapp.net`);
        }
      }

      console.log(`[Baileys Presence] Subscribing presence para tenant ${tenantId}:`, jidsToSubscribe);
      for (const targetJid of jidsToSubscribe) {
        await sock.presenceSubscribe(targetJid).catch(() => {});
      }
    } catch (e) {
      console.error(`[Baileys Presence] Erro ao subscrever presença de ${jid}:`, e);
    }
  }


  /**
   * Força uma sessão completamente limpa: encerra o socket atual, apaga as chaves
   * do banco e inicia uma nova sessão (vai gerar novo QR Code).
   */
  public async resetAndInitSession(tenantId: string): Promise<WASocket> {
    console.log(`[SessionManager] Resetando sessão para forçar novo QR Code — tenant: ${tenantId}`);

    // Aguarda a inicialização anterior para não deixar um socket antigo nascer após o reset.
    const pendingInit = this.initMutex.get(tenantId);
    if (pendingInit) await pendingInit.catch(() => undefined);
    this.initMutex.delete(tenantId);

    // Encerrar socket existente
    const existingSock = this.sessions.get(tenantId);
    if (existingSock) {
      this.sessions.delete(tenantId);
      try { existingSock.end(undefined); } catch (_) {}
    }
    this.sessionStatuses.set(tenantId, "disconnected");
    this.sessionQrs.delete(tenantId);

    // Limpar chaves do banco — sessão completamente nova
    try {
      await db
        .update(channelConfigs)
        .set({ baileysSessionStatus: "disconnected", baileysPairedPhone: null, baileysAuthKeys: null, updatedAt: new Date() })
        .where(eq(channelConfigs.tenantId, tenantId));
      console.log(`[SessionManager] Chaves do banco limpas para tenant ${tenantId}`);
    } catch (e) {
      console.error(`[SessionManager] Erro ao limpar chaves no DB:`, e);
    }

    return this.initSession(tenantId);
  }

  /**
   * Inicia (ou reutiliza) a sessão Baileys de um tenant.
   * Usa mutex por tenant para evitar inicializações concorrentes.
   */
  public async initSession(tenantId: string): Promise<WASocket> {
    // Se já há uma sessão ativa (conectada ou aguardando QR), reutilizar
    const existingStatus = this.sessionStatuses.get(tenantId);
    if (this.sessions.has(tenantId) && existingStatus && existingStatus !== "disconnected") {
      console.log(`[SessionManager] Sessão já ativa (status: ${existingStatus}) para tenant ${tenantId} — reutilizando`);
      return this.sessions.get(tenantId)!;
    }

    // Mutex: evitar duas inicializações simultâneas para o mesmo tenant
    const existingMutex = this.initMutex.get(tenantId);
    if (existingMutex) {
      console.log(`[SessionManager] Inicialização já em progresso para tenant ${tenantId} — aguardando`);
      return existingMutex;
    }

    const initPromise = this._doInitSession(tenantId);
    this.initMutex.set(tenantId, initPromise);
    const clearInitMutex = () => {
      if (this.initMutex.get(tenantId) === initPromise) this.initMutex.delete(tenantId);
    };
    void initPromise.then(clearInitMutex, clearInitMutex);
    return initPromise;
  }

  private async _doInitSession(tenantId: string): Promise<WASocket> {
    // Encerrar socket antigo se existir
    const oldSock = this.sessions.get(tenantId);
    if (oldSock) {
      this.sessions.delete(tenantId);
      try { oldSock.end(undefined); } catch (_) {}
    }

    console.log(`[SessionManager] Iniciando sessão Baileys para tenant: ${tenantId}`);

    // Logger silencioso — logs do Baileys são muito verbosos e poluem o output
    const logger = pino({ level: "silent" });

    // Carregar estado de autenticação do banco
    const { state, saveCreds } = await useDrizzleAuthState(tenantId);
    console.log(`[SessionManager] Estado de autenticação carregado para tenant ${tenantId}`);

    // ── Versão do protocolo WhatsApp Web ────────────────────────────────────────
    // Estratégia em 3 camadas para evitar "Too Many Requests" do servidor WA:
    //   1. Cache em memória (TTL 4h) — reutiliza a última versão buscada com sucesso
    //   2. Fetch dinâmico — só acontece se o cache estiver vazio ou expirado
    //   3. Fallback hardcoded — garante que o socket NUNCA falhe por rate-limiting
    //
    // Sessões já pareadas (state.creds.registered=true) aceitam qualquer versão.
    // Sessões novas (QR) precisam da versão mais recente do WA Web, mas preferimos
    // usar o fallback a deixar o tenant sem serviço.
    let version: [number, number, number] = SessionManager.WA_VERSION_FALLBACK;
    const now = Date.now();
    const cached = SessionManager.waVersionCache;
    const cacheValid = cached && (now - cached.fetchedAt) < SessionManager.WA_VERSION_CACHE_TTL_MS;

    if (cacheValid) {
      version = cached!.version;
      console.log(`[SessionManager] Versão WA obtida do cache para tenant ${tenantId}: ${version.join(".")}`);
    } else {
      try {
        const isNewPairing = !state.creds.registered;
        const fetchVersion = isNewPairing ? fetchLatestWaWebVersion : fetchLatestBaileysVersion;
        const result = await Promise.race([
          fetchVersion({ signal: AbortSignal.timeout(5000) }),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))
        ]) as { version: [number, number, number]; isLatest: boolean; error?: unknown } | null;

        if (result?.version) {
          version = result.version;
          // Salvar no cache global (compartilhado entre todos os tenants)
          SessionManager.waVersionCache = { version, fetchedAt: now };
          console.log(`[SessionManager] Versão ${isNewPairing ? "WhatsApp Web" : "WA"} obtida dinamicamente para tenant ${tenantId}: ${version.join(".")}`);
        } else {
          throw new Error(`Versão atual indisponível: ${String(result?.error ?? "resposta vazia")}`);
        }
      } catch (e) {
        // Em caso de erro (rate-limit, rede, timeout), usar fallback sem travar
        console.warn(`[SessionManager] Não foi possível buscar a versão atual do WhatsApp Web para tenant ${tenantId}:`, e);
        console.warn(`[SessionManager] Usando versão de fallback ${version.join(".")} para tenant ${tenantId} — sessão continuará normalmente.`);
        // Registrar no cache com TTL menor (30min) para tentar novamente em breve
        SessionManager.waVersionCache = { version: SessionManager.WA_VERSION_FALLBACK, fetchedAt: now - (SessionManager.WA_VERSION_CACHE_TTL_MS - 30 * 60 * 1000) };
      }
    }
    // ── Fim: versão do protocolo ─────────────────────────────────────────────


    // Cache de retry de mensagens
    const msgRetryCounterCache = new NodeCache({ stdTTL: 60, useClones: false });
    this.msgRetryCounterCaches.set(tenantId, msgRetryCounterCache);

    const makeSocketFn = (makeWASocket as any).default || makeWASocket;
    const sock = makeSocketFn({
      version,
      browser: Browsers.ubuntu("Chrome"),
      auth: state,
      logger,
      printQRInTerminal: false,
      msgRetryCounterCache,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      getMessage: async (key: proto.IMessageKey) => {
        try {
          const stored = await db.query.messages.findFirst({
            where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, key.id ?? ""), dEq(t.tenantId, tenantId)),
          });
          if (stored?.content) return { conversation: stored.content } as proto.IMessage;
        } catch (_) {}
        return undefined;
      },
    });

    this.sessions.set(tenantId, sock);
    console.log(`[SessionManager] Socket criado e registrado para tenant ${tenantId}`);

    // Persistir credenciais ao serem atualizadas pelo handshake
    sock.ev.on("creds.update", () => {
      if (this.sessions.get(tenantId) === sock) void saveCreds();
    });

    // Handler principal de mudanças de estado da conexão
    sock.ev.on("connection.update", async (update: any) => {
      if (this.sessions.get(tenantId) !== sock) return;
      const { connection, lastDisconnect, qr } = update;
      console.log(`[SessionManager][${tenantId}] connection.update:`, JSON.stringify({ connection, qr: !!qr, statusCode: (lastDisconnect?.error as any)?.output?.statusCode }));

      if (qr) {
        console.log(`[SessionManager] ✅ QR Code gerado para tenant ${tenantId}`);
        this.sessionStatuses.set(tenantId, "qr_ready");
        this.sessionQrs.set(tenantId, qr);
        this.notify(tenantId, { type: "status", status: "qr_ready" });
        this.notify(tenantId, { type: "qr", qr });
        try {
          await db.update(channelConfigs)
            .set({ baileysSessionStatus: "qr_ready", updatedAt: new Date() })
            .where(eq(channelConfigs.tenantId, tenantId));
        } catch (e) { console.error("Erro ao salvar status qr_ready:", e); }
      }

      if (connection === "open") {
        const phone = sock.user?.id?.split(":")[0];
        console.log(`[SessionManager] ✅ Conexão estabelecida para tenant ${tenantId} — telefone: ${phone}`);
        this.sessionStatuses.set(tenantId, "connected");
        this.sessionQrs.delete(tenantId);
        // Resetar contador de retry ao conectar com sucesso
        this.reconnectAttempts.delete(tenantId);
        this.notify(tenantId, { type: "status", status: "connected", phone });
        try {
          await db.update(channelConfigs)
            .set({ baileysSessionStatus: "connected", baileysPairedPhone: phone, updatedAt: new Date() })
            .where(eq(channelConfigs.tenantId, tenantId));
        } catch (e) { console.error("Erro ao salvar status connected:", e); }

        // ── Recovery de conversas interrompidas por deploy ──────────────────────────
        // Aguarda 5s para o socket estabilizar antes de reiniciar processamentos pendentes.
        // Janela: apenas conversas interrompidas nos últimos 30 minutos serão reativadas.
        setTimeout(() => {
          import("../valentina/sdr-recovery").then(({ recoverInterruptedConversations }) => {
            recoverInterruptedConversations(tenantId).catch((err: any) => {
              console.error(`[SessionManager] Erro no SDR Recovery para tenant ${tenantId}:`, err?.message);
            });
          });
        }, 5000);
        // ── Fim recovery ────────────────────────────────────────────────────────────
      }

      if (connection === "close") {
        if (this.isShuttingDown) {
          console.log(`[SessionManager] Conexão fechada para tenant ${tenantId} durante encerramento do processo — ignorando persistência no banco.`);
          return;
        }

        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const disconnectMessage = lastDisconnect?.error?.message;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        // ATENÇÃO: NÃO usar sock.user?.id para decidir se reconectar.
        // Quando o QR é escaneado, o Baileys fecha a conexão QR (código 515 ou similar)
        // e reabre como autenticada — mas sock.user ainda é null nesse momento.
        // Verificar se há credenciais salvas em banco é a forma correta.
        //
        // Regras de reconexão:
        //   401 = loggedOut → NÃO reconectar (sessão expirada/revogada)
        //   440 = connectionReplaced → NÃO reconectar (outra instância assumiu)
        //         Reconectar aqui criaria loop infinito onde as instâncias se matam mutuamente.
        //   515 = restartRequired → reconectar (normal após scan do QR)
        //   Demais → reconectar (queda de rede, timeout, etc.)
        const connectionReplaced = statusCode === 440;
        const shouldReconnect = !loggedOut && !connectionReplaced;

        if (connectionReplaced) {
          console.warn(`[SessionManager] Conexão substituída (440) para tenant ${tenantId} — NÃO reconectando para evitar loop.`);
        }

        console.log(`[SessionManager] Conexão fechada para tenant ${tenantId} — statusCode: ${statusCode}, motivo: ${disconnectMessage || "não informado"}, loggedOut: ${loggedOut}, sock.user: ${sock.user?.id || "null"}, reconectar: ${shouldReconnect}`);

        this.sessions.delete(tenantId);
        this.sessionStatuses.set(tenantId, "disconnected");
        this.sessionQrs.delete(tenantId);
        this.notify(tenantId, { type: "status", status: "disconnected" });

        try {
          await db.update(channelConfigs)
            .set({
              baileysSessionStatus: "disconnected",
              // NUNCA apagar baileysAuthKeys nem baileysPairedPhone em eventos de socket close!
              // Durante deploys no Railway ou trocas de rede, o container antigo ou quedas temporárias
              // não podem destruir as credenciais salvas no PostgreSQL.
              // A limpeza das chaves é reservada exclusivamente para ações intencionais de admin
              // via disconnectSession() ou resetAndInitSession().
              updatedAt: new Date(),
            })
            .where(eq(channelConfigs.tenantId, tenantId));
        } catch (e) { console.error("Erro ao salvar status disconnected:", e); }

        if (shouldReconnect) {
          // Checar se o provedor ativo do tenant ainda é Baileys antes de reconectar!
          // Se o tenant foi alternado para Meta, NÃO deve restabelecer socket do Baileys.
          try {
            const [cfg] = await db
              .select({ activeProvider: channelConfigs.activeProvider })
              .from(channelConfigs)
              .where(eq(channelConfigs.tenantId, tenantId));
            if (cfg?.activeProvider === "meta") {
              console.log(`[SessionManager] Tenant '${tenantId}' configurado para Meta API — auto-reconexão Baileys cancelada.`);
            } else {
              // Backoff exponencial: 3s → 10s → 30s → 60s → 120s (máximo)
              // Evita tempestade de reconexões que causa rate-limit do WhatsApp (sw.js Too Many Requests)
              const attempt = (this.reconnectAttempts.get(tenantId) ?? 0) + 1;
              this.reconnectAttempts.set(tenantId, attempt);
              const backoffMs = Math.min(3000 * Math.pow(3, attempt - 1), 120000);
              console.log(`[SessionManager] Reconectando tenant ${tenantId} em ${Math.round(backoffMs / 1000)}s (tentativa ${attempt})...`);
              setTimeout(() => this.initSession(tenantId), backoffMs);
            }
          } catch (cfgErr) {
            console.warn(`[SessionManager] Falha ao verificar activeProvider do tenant ${tenantId}, agendando reconexão padrão:`, cfgErr);
            const attempt = (this.reconnectAttempts.get(tenantId) ?? 0) + 1;
            this.reconnectAttempts.set(tenantId, attempt);
            const backoffMs = Math.min(3000 * Math.pow(3, attempt - 1), 120000);
            setTimeout(() => this.initSession(tenantId), backoffMs);
          }
        } else {
          console.log(`[SessionManager] Logout explícito detectado para tenant ${tenantId} — não reconectando.`);
        }
      }
    });

    // Tratar eventos de mensagens recebidas
    sock.ev.on("messages.upsert", async (m: any) => {
      if (m.type === "notify") {
        for (const msg of m.messages) {
          if (!msg.key.fromMe && msg.message) {
            // Processar a mensagem recebida e salvar no banco
            await this.handleIncomingMessage(tenantId, msg);
          }
        }
      }
    });

    // Tratar eventos de atualização de presença (cliente digitando / gravando áudio)
    sock.ev.on("presence.update", (data: any) => {
      if (data && data.id) {
        console.log(`[Baileys Presence Event] id: ${data.id}, presences:`, JSON.stringify(data.presences));
        this.notify(tenantId, {
          type: "presence_update",
          id: data.id,
          presences: data.presences || {},
        });
      }
    });

    // Tratar eventos de contatos sincronizados ou atualizados (mapeia LIDs para telefones reais)
    const handleContactsSync = async (contactsList: any[]) => {
      console.log(`[Baileys Contacts] Sincronizando/Atualizando ${contactsList.length} contatos para o tenant ${tenantId}`);
      for (const rawContact of contactsList) {
        const jid = rawContact.id;
        if (!jid) continue;

        // ── FILTRO DE GRUPOS / STATUS / BROADCAST ──────────────────────────────
        // Ignorar grupos (@g.us), status (status@broadcast), listas de transmissão
        // e canais (@newsletter). NÃO usar o número para detectar grupos — números
        // americanos também começam com '1' e são clientes legítimos.
        if (shouldIgnoreJid(jid)) {
          console.log(`[Baileys Contacts] JID ignorado (${ignoreReason(jid)}): ${jid}`);
          continue;
        }
        // ── FIM FILTRO ─────────────────────────────────────────────────────────

        // Extrai o nome de exibição
        const name = rawContact.name || rawContact.verifiedName || rawContact.notify || `Contato (${jid.split("@")[0]})`;
        
        // Verifica se há JID alternativo ou número de telefone explícito
        let phoneJid = jid;
        if (jid.endsWith("@lid")) {
          if (rawContact.phoneNumber) {
            phoneJid = `${rawContact.phoneNumber}@s.whatsapp.net`;
          } else if (rawContact.pnJid) {
            phoneJid = rawContact.pnJid;
          } else if (rawContact.jidAlt) {
            phoneJid = rawContact.jidAlt;
          }
        }

        const isResolved = !phoneJid.endsWith("@lid");

        // Extrai o número limpo
        let phone = phoneJid.split("@")[0];
        if (phone.includes("-")) phone = phone.split("-")[0];
        if (phone.includes(":")) phone = phone.split(":")[0];

        try {
          // Busca se o contato já existe no banco — PRIMEIRO pelo JID, depois pelo phone.
          // A busca por phone é o fallback crítico para evitar duplicação quando o JID
          // muda (reinstalação do WhatsApp, troca de dispositivo, @lid → @s.whatsapp.net).
          let contact = await db.query.contacts.findFirst({
            where: (contactsTable, { eq: dEq, and: dAnd, or: dOr }) =>
              dAnd(
                dEq(contactsTable.tenantId, tenantId),
                dOr(
                  dEq(contactsTable.whatsappJid, jid),
                  dEq(contactsTable.phone, phone)
                )
              )
          });

          if (!contact && phone.length >= 8) {
            [contact] = await db.select().from(contacts)
              .where(and(eq(contacts.tenantId, tenantId), sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${phone}`))
              .limit(1);
          }

          if (!contact) {
            const contactId = `c-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            await db.insert(contacts).values({
              id: contactId,
              tenantId,
              name,
              phone,
              whatsappJid: jid,
              mainChannel: "whatsapp",
              avatar: rawContact.imgUrl || null,
              tags: [],
              createdAt: new Date(),
            });
          } else {
            // Contato existe — atualizar JID e/ou phone se estiverem desatualizados
            const updates: any = {};

            // Atualiza o JID se o contato existia mas foi encontrado pelo phone
            // (o JID pode ter mudado por reinstalação ou troca de dispositivo)
            if (contact.whatsappJid !== jid && isResolved) {
              updates.whatsappJid = jid;
            }

            // Atualiza telefone se o anterior era LID e agora resolvemos o número real
            if (contact.phone !== phone && isResolved) {
              updates.phone = phone;
            }

            if (Object.keys(updates).length > 0) {
              await db.update(contacts)
                .set(updates)
                .where(and(eq(contacts.id, contact.id), eq(contacts.tenantId, tenantId)));
            }
          }
        } catch (e: any) {
          console.error(`[Baileys Contacts] Erro ao sincronizar contato ${jid}:`, e.message);
        }
      }
    };

    sock.ev.on("contacts.upsert", handleContactsSync);
    sock.ev.on("contacts.update", handleContactsSync);

    return sock;
  }

  /**
   * Pausa a sessão Baileys (fecha socket) SEM dar logout e SEM limpar as credenciais/chaves do banco.
   * Usado na troca de canal para Meta, permitindo retorno posterior a Baileys sem re-leitura de QR Code.
   */
  public async pauseSession(tenantId: string) {
    const sock = this.sessions.get(tenantId);
    if (sock) {
      this.sessions.delete(tenantId);
      try {
        sock.end(undefined);
      } catch (e) {
        console.error(`[SessionManager] Erro ao fechar conexão socket para pausa no tenant '${tenantId}':`, e);
      }
    }

    this.sessionStatuses.set(tenantId, "disconnected");
    this.sessionQrs.delete(tenantId);
    this.notify(tenantId, { type: "status", status: "disconnected" });

    try {
      await db
        .update(channelConfigs)
        .set({ 
          baileysSessionStatus: "disconnected", 
          updatedAt: new Date() 
        })
        .where(eq(channelConfigs.tenantId, tenantId));
    } catch (e) {
      console.error(`[SessionManager] Erro ao atualizar status para disconnected no DB (pausa) no tenant '${tenantId}':`, e);
    }
  }

  public async disconnectSession(tenantId: string) {
    const sock = this.sessions.get(tenantId);
    if (sock) {
      this.sessions.delete(tenantId);
      try {
        await sock.logout();
      } catch (e) {
        console.error("Erro ao dar logout no socket:", e);
      }
      try {
        sock.end(undefined);
      } catch (e) {
        console.error("Erro ao fechar conexão:", e);
      }
    }

    this.sessionStatuses.set(tenantId, "disconnected");
    this.sessionQrs.delete(tenantId);
    this.notify(tenantId, { type: "status", status: "disconnected" });

    // Atualizar no banco e deletar chaves
    try {
      await db
        .update(channelConfigs)
        .set({ 
          baileysSessionStatus: "disconnected", 
          baileysPairedPhone: null,
          baileysAuthKeys: null,
          updatedAt: new Date() 
        })
        .where(eq(channelConfigs.tenantId, tenantId));
    } catch (e) {
      console.error("Erro ao limpar dados de sessão no DB:", e);
    }
  }



  private async handleIncomingMessage(tenantId: string, rawMsg: any) {
    const jid = rawMsg.key.remoteJid;
    if (!jid) return;

    // ── FILTRO DE GRUPOS / STATUS / BROADCAST (primeira checagem — antes de qualquer I/O) ──
    // Rejeita grupos (@g.us), status do WhatsApp, listas de transmissão e canais.
    // Este return precisa ser o PRIMEIRO para evitar download de mídia, criação de
    // contato/conversa, disparo do SLA engine e ativação da Valentina SDR desnecessariamente.
    if (shouldIgnoreJid(jid)) {
      console.log(`[Baileys] Mensagem ignorada — ${ignoreReason(jid)} — JID: ${jid}`);
      return;
    }
    // ── FIM FILTRO ───────────────────────────────────────────────────────────────────────────
    
    const sock = this.sessions.get(tenantId);

    // O WhatsApp pode entregar o cliente pelo LID mesmo quando a conversa foi criada pelo telefone.
    let resolvedPhoneJid = jid;
    if (jid.endsWith("@lid")) {
      if (rawMsg.key?.remoteJidAlt && typeof rawMsg.key.remoteJidAlt === "string" && rawMsg.key.remoteJidAlt.endsWith("@s.whatsapp.net")) {
        resolvedPhoneJid = rawMsg.key.remoteJidAlt;
      } else if (rawMsg.pnJid && typeof rawMsg.pnJid === "string" && rawMsg.pnJid.endsWith("@s.whatsapp.net")) {
        resolvedPhoneJid = rawMsg.pnJid;
      } else if (rawMsg.senderPn && typeof rawMsg.senderPn === "string" && rawMsg.senderPn.endsWith("@s.whatsapp.net")) {
        resolvedPhoneJid = rawMsg.senderPn;
      } else if (sock) {
        try {
          const mappedPhoneJid = await sock.signalRepository.lidMapping.getPNForLID(jid);
          if (mappedPhoneJid?.endsWith("@s.whatsapp.net")) resolvedPhoneJid = mappedPhoneJid;
        } catch (error) {
          console.warn(`[Baileys] Não foi possível resolver LID para tenant ${tenantId}:`, error);
        }
      }
    }

    // Extrai o número de telefone limpo (removendo sufixos de grupo e multi-device)
    let phone = resolvedPhoneJid.split("@")[0];
    if (phone.includes("-")) {
      phone = phone.split("-")[0];
    }
    if (phone.includes(":")) {
      phone = phone.split(":")[0];
    }
    
    const name = rawMsg.pushName || `Cliente (${phone})`;
    const messageId = rawMsg.key.id || `msg-${Date.now()}`;

    // Criar a pasta media se não existir
    const mediaDir = path.join(process.cwd(), "media");
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
    }

    const messageType = Object.keys(rawMsg.message || {})[0];
    const isMedia = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"].includes(messageType) ||
                    rawMsg.message?.viewOnceMessage?.message?.imageMessage ||
                    rawMsg.message?.viewOnceMessage?.message?.videoMessage ||
                    rawMsg.message?.viewOnceMessageV2?.message?.imageMessage ||
                    rawMsg.message?.viewOnceMessageV2?.message?.videoMessage;

    // Obter texto representativo da mensagem (incluindo tratamento de mídias como áudio, imagem e vídeo)
    let text = "[Mídia/Outro]";
    if (rawMsg.message) {
      if (rawMsg.message.conversation) {
        text = rawMsg.message.conversation;
      } else if (rawMsg.message.extendedTextMessage?.text) {
        text = rawMsg.message.extendedTextMessage.text;
      } else if (rawMsg.message.imageMessage) {
        text = "📷 Foto";
      } else if (rawMsg.message.videoMessage) {
        text = "🎥 Vídeo";
      } else if (rawMsg.message.audioMessage) {
        text = "🎵 Áudio/Mensagem de voz";
      } else if (rawMsg.message.documentMessage) {
        const docTitle = rawMsg.message.documentMessage.fileName || rawMsg.message.documentMessage.title || "Documento";
        text = `📄 Documento: ${docTitle}`;
      } else if (rawMsg.message.stickerMessage) {
        text = "💟 Figurinha";
      } else if (rawMsg.message.viewOnceMessage?.message?.imageMessage || rawMsg.message.viewOnceMessageV2?.message?.imageMessage) {
        text = "📷 Foto (Visualização única)";
      } else if (rawMsg.message.viewOnceMessage?.message?.videoMessage || rawMsg.message.viewOnceMessageV2?.message?.videoMessage) {
        text = "🎥 Vídeo (Visualização única)";
      }
    }

    // Extrair informações de resposta (quoted/citar)
    const contextInfo = rawMsg.message?.extendedTextMessage?.contextInfo ||
                        rawMsg.message?.imageMessage?.contextInfo ||
                        rawMsg.message?.videoMessage?.contextInfo ||
                        rawMsg.message?.audioMessage?.contextInfo ||
                        rawMsg.message?.documentMessage?.contextInfo ||
                        rawMsg.message?.stickerMessage?.contextInfo;

    let quotedMessageId: string | null = null;
    let quotedMessageSender: string | null = null;
    let quotedMessageContent: string | null = null;

    if (contextInfo?.quotedMessage) {
      quotedMessageId = contextInfo.stanzaId || null;
      
      const qMsg = contextInfo.quotedMessage;
      quotedMessageContent = qMsg.conversation ||
                             qMsg.extendedTextMessage?.text ||
                             qMsg.imageMessage?.caption ||
                             qMsg.videoMessage?.caption ||
                             (qMsg.imageMessage ? "📷 Foto" : null) ||
                             (qMsg.videoMessage ? "🎥 Vídeo" : null) ||
                             (qMsg.audioMessage ? "🎵 Áudio/Mensagem de voz" : null) ||
                             (qMsg.documentMessage ? "📄 Documento" : null) ||
                             (qMsg.stickerMessage ? "💟 Figurinha" : null) ||
                             "Mensagem";

      // 1. Tentar buscar a mensagem no banco pelo ID para descobrir o autor real
      let foundQuotedMsg = null;
      if (quotedMessageId) {
        try {
          foundQuotedMsg = await db.query.messages.findFirst({
            where: (t, { eq: dEq, and: dAnd }) =>
              dAnd(dEq(t.id, quotedMessageId as string), dEq(t.tenantId, tenantId))
          });
        } catch (e) {
          console.error("Erro ao buscar mensagem citada no DB:", e);
        }
      }

      if (foundQuotedMsg) {
        if (foundQuotedMsg.senderType === "agent") {
          quotedMessageSender = "Você";
        } else {
          // É do cliente, usar o nome da conversa/contato salvo
          quotedMessageSender = foundQuotedMsg.senderName || "Contato";
        }
      } else {
        // Fallback: usar o participante do contextInfo
        if (contextInfo.participant) {
          const cleanParticipant = contextInfo.participant.split("@")[0].split(":")[0];
          const cleanBot = sock?.user?.id ? sock.user.id.split("@")[0].split(":")[0] : null;
          if (cleanBot && cleanParticipant === cleanBot) {
            quotedMessageSender = "Você";
          } else {
            try {
              const quotedContact = await db.query.contacts.findFirst({
                where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.tenantId, tenantId), dEq(t.phone, cleanParticipant))
              });
              quotedMessageSender = quotedContact ? quotedContact.name : `+${cleanParticipant}`;
            } catch {
              quotedMessageSender = `+${cleanParticipant}`;
            }
          }
        } else {
          quotedMessageSender = "Você"; // Se não especificado, geralmente é do bot
        }
      }
    }

    // Se for mídia, tentar fazer o download físico
    if (isMedia) {
      try {
        console.log(`Baixando mídia para a mensagem ${messageId}...`);
        if (sock) {
          const buffer = await downloadMediaMessage(
            rawMsg,
            "buffer",
            {},
            { 
              logger: pino({ level: "silent" }), 
              reuploadRequest: sock.updateMediaMessage 
            }
          );

          if (buffer) {
            // Salvar os bytes da mídia
            fs.writeFileSync(path.join(mediaDir, messageId), buffer);

            // Identificar mimetype e formatar tag de mídia
            // Extrair legenda da mídia se houver
            const rawCaption = (
              rawMsg.message?.imageMessage?.caption ||
              rawMsg.message?.videoMessage?.caption ||
              rawMsg.message?.documentMessage?.caption ||
              rawMsg.message?.viewOnceMessage?.message?.imageMessage?.caption ||
              rawMsg.message?.viewOnceMessage?.message?.videoMessage?.caption ||
              rawMsg.message?.viewOnceMessageV2?.message?.imageMessage?.caption ||
              rawMsg.message?.viewOnceMessageV2?.message?.videoMessage?.caption ||
              ""
            ).trim();

            let mime = "application/octet-stream";
            let fileName: string | undefined = undefined;
            if (rawMsg.message.imageMessage) {
              mime = rawMsg.message.imageMessage.mimetype || "image/jpeg";
              text = `[MEDIA:image]${messageId}` + (rawCaption ? `\n${rawCaption}` : "");
            } else if (rawMsg.message.videoMessage) {
              mime = rawMsg.message.videoMessage.mimetype || "video/mp4";
              text = `[MEDIA:video]${messageId}` + (rawCaption ? `\n${rawCaption}` : "");
            } else if (rawMsg.message.audioMessage) {
              mime = rawMsg.message.audioMessage.mimetype || "audio/ogg";
              text = `[MEDIA:audio]${messageId}` + (rawCaption ? `\n${rawCaption}` : "");
            } else if (rawMsg.message.documentMessage) {
              mime = rawMsg.message.documentMessage.mimetype || "application/octet-stream";
              fileName = rawMsg.message.documentMessage.fileName || rawMsg.message.documentMessage.title || "documento";
              text = `[MEDIA:document]${messageId}:${fileName}` + (rawCaption ? `\n${rawCaption}` : "");
            } else if (rawMsg.message.stickerMessage) {
              mime = rawMsg.message.stickerMessage.mimetype || "image/webp";
              text = `[MEDIA:sticker]${messageId}`;
            } else {
              const viewOnceMsg = rawMsg.message.viewOnceMessage?.message || rawMsg.message.viewOnceMessageV2?.message;
              if (viewOnceMsg?.imageMessage) {
                mime = viewOnceMsg.imageMessage.mimetype || "image/jpeg";
                text = `[MEDIA:image]${messageId}` + (rawCaption ? `\n${rawCaption}` : "");
              } else if (viewOnceMsg?.videoMessage) {
                mime = viewOnceMsg.videoMessage.mimetype || "video/mp4";
                text = `[MEDIA:video]${messageId}` + (rawCaption ? `\n${rawCaption}` : "");
              }
            }

            // Salvar arquivo de mimetype no cache local
            fs.writeFileSync(path.join(mediaDir, `${messageId}.mime`), mime);

            // Persistir a mídia permanentemente no banco de dados (Base64)
            try {
              const base64Data = buffer.toString("base64");
              await db.insert(mediaFiles).values({
                id: messageId,
                tenantId,
                fileName: fileName || null,
                mimeType: mime,
                base64Data,
                createdAt: new Date(),
              }).onConflictDoNothing();
              console.log(`Mídia ${messageId} persistida no banco com sucesso!`);
            } catch (dbErr) {
              console.error(`Erro ao salvar mídia no banco ${messageId}:`, dbErr);
            }
            console.log(`Mídia ${messageId} salva com sucesso no disco! Mime: ${mime}`);
          }
        }
      } catch (err) {
        console.error(`Erro ao processar download de mídia da mensagem ${messageId}:`, err);
      }
    }

    console.log(`Mensagem recebida do tenant ${tenantId} de ${name}: ${text}`);

    try {
      // 1. Garantir que o contato existe no banco
      // Com PN resolvido, prioriza o contato da conversa já aberta. O mesmo número
      // pode estar salvo com ou sem DDI; buscar primeiro pelo LID criaria outra conversa.
      let contact: typeof contacts.$inferSelect | undefined;
      if (!jid.endsWith("@lid")) {
        contact = await db.query.contacts.findFirst({
          where: (table, { eq: dEq, and: dAnd }) =>
            dAnd(dEq(table.tenantId, tenantId), dEq(table.whatsappJid, jid))
        });
      }
      const phoneVariants = resolvedPhoneJid.endsWith("@s.whatsapp.net")
        ? phoneIdentityVariants(phone)
        : [];
      if (!contact && phoneVariants.length > 0) {
        const matchingContacts = await db.select().from(contacts)
          .where(and(
            eq(contacts.tenantId, tenantId),
            or(...phoneVariants.map((candidate) =>
              sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${candidate}`
            ))
          ));
        if (matchingContacts.length > 0) {
          const [activeConversation] = await db.select({ contactId: conversations.contactId })
            .from(conversations)
            .where(and(
              eq(conversations.tenantId, tenantId),
              inArray(conversations.contactId, matchingContacts.map((item) => item.id))
            ))
            .orderBy(desc(conversations.lastMessageTime))
            .limit(1);
          contact = matchingContacts.find((item) => item.id === activeConversation?.contactId)
            || matchingContacts.find((item) => item.whatsappJid === jid)
            || matchingContacts[0];
        }
      }

      if (!contact) {
        contact = await db.query.contacts.findFirst({
          where: (table, { eq: dEq, and: dAnd }) =>
            dAnd(dEq(table.tenantId, tenantId), dEq(table.whatsappJid, jid))
        });
      }

      const contactId = contact?.id || `c-${Date.now()}`;
      const profilePicUrl = contact?.avatar || "";
      console.log(`[Baileys Inbound] tenant=${tenantId} jidType=${jid.endsWith("@lid") ? "lid" : "phone"} pnResolved=${resolvedPhoneJid !== jid} contactId=${contactId} existing=${!!contact}`);

      if (!contact) {
        // Criar contato se não existir (inicialmente sem foto para velocidade máxima)
        await db.insert(contacts).values({
          id: contactId,
          tenantId,
          name,
          phone,
          whatsappJid: jid, // Salva o JID real para envio confiável
          mainChannel: "whatsapp",
          avatar: null,
          tags: [],
          createdAt: new Date(),
        });
      } else {
        const updates: any = {};
        if (!contact.whatsappJid) {
          updates.whatsappJid = jid;
        }

        // Se o telefone salvo era o LID (que não foi resolvido) e agora conseguimos resolver o número real
        const isResolved = !resolvedPhoneJid.endsWith("@lid");
        if (contact.phone !== phone && isResolved) {
          updates.phone = phone;
        }

        if (Object.keys(updates).length > 0) {
          await db.update(contacts)
            .set(updates)
            .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)));
        }
      }

      // Buscar foto de perfil em background (sem await para não atrasar o processamento de mensagens!)
      if (jid && (!contact || !contact.avatar)) {
        const sock = this.sessions.get(tenantId);
        if (sock) {
          // Monta lista de JIDs a tentar em ordem de preferência
          const cleanPhone = phone.replace(/\D/g, "");
          const jidsToTry: string[] = [
            jid,                                          // JID real (pode ser @lid ou @s.whatsapp.net)
            `${cleanPhone}@s.whatsapp.net`,               // phone direto
          ];
          // Se o phone não começa com 55, tenta com DDI
          if (!cleanPhone.startsWith("55") && cleanPhone.length <= 11) {
            jidsToTry.push(`55${cleanPhone}@s.whatsapp.net`);
          }
          // Se começa com 55 (Brasil), tenta a variação com ou sem o 9º dígito
          if (cleanPhone.startsWith("55")) {
            const ddd = cleanPhone.slice(2, 4);
            const rest = cleanPhone.slice(4);
            if (rest.length === 9 && rest.startsWith("9")) {
              // 9-digit -> tenta também o de 8 dígitos
              jidsToTry.push(`55${ddd}${rest.slice(1)}@s.whatsapp.net`);
            } else if (rest.length === 8) {
              // 8-digit -> tenta também o de 9 dígitos
              jidsToTry.push(`55${ddd}9${rest}@s.whatsapp.net`);
            }
          }

          const tryGetPic = async (): Promise<string | undefined> => {
            for (const tryJid of jidsToTry) {
              try {
                const url = await sock.profilePictureUrl(tryJid, "preview")
                  .catch(() => sock.profilePictureUrl(tryJid, "image"));
                if (url) {
                  console.log(`[Baileys] Foto obtida para ${phone} via JID: ${tryJid}`);
                  return url;
                }
              } catch { /* tenta próximo */ }
            }
            return undefined;
          };

          tryGetPic().then(async (picUrl) => {
            if (picUrl) {
              const base64Avatar = await urlToBase64(picUrl);
              const avatarToSave = base64Avatar || picUrl;
              db.update(contacts)
                .set({ avatar: avatarToSave })
                .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)))
                .then(() => {
                  this.notify(tenantId, {
                    type: "contact_avatar",
                    contactId: contactId,
                    phone: phone,
                    avatar: avatarToSave,
                  });
                })
                .catch((err) => console.error("Erro ao salvar foto de perfil no DB:", err));
            } else {
              console.log(`[Baileys] Foto não disponível para ${phone} (todos os JIDs tentados)`);
            }
          }).catch(() => {});

        }
      }

      // 2. Garantir que a conversa existe no banco
      let conversation = await db.query.conversations.findFirst({
        where: (convsTable, { eq: dEq, and: dAnd }) => 
          dAnd(dEq(convsTable.tenantId, tenantId), dEq(convsTable.contactId, contactId))
      });

      // IMPORTANTE: convId DEVE ser determinístico quando a conversa ainda não existe.
      // Se usarmos conv-${Date.now()}, duas mensagens rápidas do mesmo contato geram
      // IDs diferentes → duas sessões no debouncer → saudação duplicada.
      const convId = conversation?.id || `conv-${tenantId}-${contactId}`;
      console.log(`[Baileys Inbound] tenant=${tenantId} messageId=${messageId} conversationId=${convId} existingConversation=${!!conversation}`);
      const isFromMe = !!rawMsg.key.fromMe;

      // ── Comando !reset: Reinicia a triagem da IA SEM apagar o histórico de mensagens ──
      if (text.trim().toLowerCase() === "!reset") {
        console.log(`[Baileys/Reset] Comando !reset acionado para a conversa ${convId} (${phone}) — reiniciando fluxo de triagem sem apagar mensagens.`);

        // 1. Limpar sessão de debounce ativa
        SdrDebouncer.getInstance().clearSession(convId);

        // 2. Apagar apenas o estado de fluxo da triagem anterior (preserva mensagens e contatos)
        await db
          .delete(agentFlowStates)
          .where(and(eq(agentFlowStates.conversationId, convId), eq(agentFlowStates.tenantId, tenantId)));

        // 3. Resetar status da conversa no DB para 'automacao' sem operador
        if (conversation) {
          await db
            .update(conversations)
            .set({
              queueState: "automacao",
              operatorId: null,
              unreadCount: 0,
              lastMessageText: "🔄 Fluxo de triagem reiniciado via !reset",
              lastMessageTime: new Date(),
              updatedAt: new Date(),
            })
            .where(and(eq(conversations.id, convId), eq(conversations.tenantId, tenantId)));
        }

        // 4. Criar novo agentFlowState limpo
        const newFlowId = `fs-sdr-${Date.now()}`;
        await db.insert(agentFlowStates).values({
          id: newFlowId,
          tenantId,
          conversationId: convId,
          agentType: "sdr",
          currentStep: "Em Qualificação",
          collectedData: {},
          metadata: { stepNumber: 1, totalSteps: 7 },
          startedAt: new Date(),
          lastInteractionAt: new Date(),
          outcome: "in_progress",
        });

        // 5. Notificar a UI via SSE
        this.notify(tenantId, {
          type: "queue_update",
          conversationId: convId,
          queueState: "automacao",
          operatorId: null,
          sectorId: null,
          responsibleName: `${getAiPersona(tenantId).name} IA`,
        });

        // 6. Responder no WhatsApp confirmando o reinício da triagem
        const sock = this.getSession(tenantId);
        if (sock) {
          try {
            const realJid = await resolveRealJid(sock, phone);
            await sock.sendMessage(realJid, {
              text: `🔄 Fluxo de triagem reiniciado com sucesso! A persona ${getAiPersona(tenantId).name} está pronta para um novo atendimento.`,
            });
          } catch (err: any) {
            console.error("[Baileys/Reset] Erro ao enviar resposta no WA:", err?.message);
          }
        }

        return;
      }

      // Se a mensagem veio do próprio operador/WhatsApp conectado (fromMe), zera as mensagens não lidas.
      // Se veio do cliente, incrementa as não lidas.
      const unreadCount = isFromMe ? 0 : (conversation ? conversation.unreadCount + 1 : 1);

      // Regra de reabertura e carteirização automática de filas:
      let targetQueue = conversation?.queueState || "fila";
      let targetOperatorId = conversation?.operatorId || null;

      if (!isFromMe) {
        if (contact?.walletOperatorId) {
          // Se o cliente tem dono de carteira, atribui diretamente a ele e abre em "Meus"
          targetQueue = "meus";
          targetOperatorId = contact.walletOperatorId;
        } else if (conversation?.queueState === "finalizados") {
          // Sem dono e finalizada: reabre na fila geral
          targetQueue = "fila";
          targetOperatorId = null;
        }
      } else {
        // Se a mensagem veio do operador (WhatsApp Web conectado ou painel)
        if (conversation?.queueState === "fila") {
          targetQueue = "meus";
        }
      }

      if (!conversation) {
        // Criar conversa
        await db.insert(conversations).values({
          id: convId,
          tenantId,
          contactId,
          queueState: isFromMe ? "meus" : (contact?.walletOperatorId ? "meus" : "fila"),
          operatorId: (!isFromMe && contact?.walletOperatorId) ? contact.walletOperatorId : null,
          unreadCount,
          lastMessageText: text,
          lastMessageTime: new Date(),
          createdAt: new Date(),
        });
      } else {
        // Atualizar conversa
        await db
          .update(conversations)
          .set({
            unreadCount,
            lastMessageText: text,
            lastMessageTime: new Date(),
            queueState: targetQueue,
            operatorId: targetOperatorId,
          })
          .where(and(eq(conversations.id, convId), eq(conversations.tenantId, tenantId)));
      }

      const finalSenderType = isFromMe ? "agent" : "client";
      const finalSenderName = isFromMe ? "Operador" : name;

      // 3. Salvar a mensagem (onConflictDoNothing evita erro de chave duplicada
      // quando o WA entrega a mesma mensagem mais de uma vez)
      await db.insert(messages).values({
        id: messageId,
        tenantId,
        conversationId: convId,
        senderType: finalSenderType,
        senderName: finalSenderName,
        content: text,
        isInternalNote: false,
        quotedMessageId,
        quotedMessageSender,
        quotedMessageContent,
        sentAt: new Date(),
      }).onConflictDoNothing();

      // ── SLA Engine & Web Push Notification ─────────
      try {
        const now = new Date();
        if (finalSenderType === "client") {
          // Disparar Web Push Notification EXCLUSIVAMENTE para o operador atribuído à conversa (se houver)
          if (targetOperatorId) {
            sendPushToOperator(tenantId, targetOperatorId, {
              title: name || "Nova Mensagem",
              body: text || "Mensagem no WhatsApp",
              conversationId: convId,
              tenantId,
              icon: tenantId === "valem" ? "/logo_valem.jpg" : "/logo_tecfag.png",
              url: `/?chatId=${convId}`,
            }).catch((err) => console.error("[Push] Erro ao enviar notificação no Baileys:", err));
          }

          // Cliente enviou: abre um novo ciclo de SLA
          await db.insert(responseTimeLogs).values({
            id: `sla-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            tenantId,
            conversationId: convId,
            operatorId: null,
            clientMessageId: messageId,
            clientMessageAt: now,
            overdueThresholdSeconds: 900, // 15 minutos
          });
        } else if (finalSenderType === "agent") {
          // Operador respondeu: fecha o ciclo SLA mais recente pendente
          const openLog = await db
            .select()
            .from(responseTimeLogs)
            .where(
              and(
                eq(responseTimeLogs.tenantId, tenantId),
                eq(responseTimeLogs.conversationId, convId),
                isNull(responseTimeLogs.agentResponseId)
              )
            )
            .orderBy(desc(responseTimeLogs.clientMessageAt))
            .limit(1);

          if (openLog.length > 0) {
            const log = openLog[0];
            const deltaSeconds = Math.floor((now.getTime() - new Date(log.clientMessageAt).getTime()) / 1000);
            await db
              .update(responseTimeLogs)
              .set({ agentResponseId: messageId, agentResponseAt: now, responseTimeSeconds: deltaSeconds })
              .where(
                and(
                  eq(responseTimeLogs.id, log.id),
                  eq(responseTimeLogs.tenantId, tenantId)
                )
              );

            // Atualiza métricas diárias do operador associado à conversa
            const convRow = await db
              .select({ operatorId: conversations.operatorId })
              .from(conversations)
              .where(
                and(
                  eq(conversations.id, convId),
                  eq(conversations.tenantId, tenantId)
                )
              )
              .limit(1);

            if (convRow[0]?.operatorId) {
              SlaEngine.getInstance().updateResponseMetrics(
                tenantId, convRow[0].operatorId, deltaSeconds
              ).catch((e: any) => console.warn("[SlaEngine/Baileys] Erro ao atualizar métricas:", e?.message));
            }
          }
        }
      } catch (slaErr: any) {
        // SLA não é crítico — falha silenciosamente para não bloquear mensagens
        console.warn("[SlaEngine/Baileys] Erro ao registrar ciclo SLA:", slaErr?.message);
      }
      // ── Fim SLA Engine ──────────────────────────────────────────────────────

      // ── Sentiment Analyzer: análise de sentimento em mensagens de clientes ──
      if (finalSenderType === "client" && text && text.trim().length > 5) {
        try {
          const { analyzeSentiment } = await import("../valentina/sentiment-analyzer");
          analyzeSentiment(text, convId, tenantId, { contactName: finalSenderName })
            .catch((e: any) => console.warn("[SentimentAnalyzer] Erro:", e?.message));
        } catch (e: any) {
          console.warn("[SentimentAnalyzer] Import falhou:", e?.message);
        }
      }
      // ── Fim Sentiment Analyzer ────────────────────────────────────────────

      // 4. Notificar a UI via evento SSE
      this.notify(tenantId, {
        type: "message",
        message: {
          id: messageId,
          conversationId: convId,
          senderType: finalSenderType,
          senderName: finalSenderName,
          content: text,
          phone: phone, // Enviar o telefone real extraído do JID para o frontend
          avatar: isFromMe ? null : (profilePicUrl || null), // O avatar no SSE é do contato se for do cliente
          sentAt: new Date(),
          quotedMessageId,
          quotedMessageSender,
          quotedMessageContent,
          queue: !conversation ? (isFromMe ? "meus" : (contact?.walletOperatorId ? "meus" : "fila")) : targetQueue,
          operatorId: !conversation ? ((!isFromMe && contact?.walletOperatorId) ? contact.walletOperatorId : null) : targetOperatorId,
          walletOperatorId: contact?.walletOperatorId || (conversation as any)?.walletOperatorId || null,
        }
      });

      // ── Processar mensagem no SdrDebouncer (Valentina SDR / 15s Debounce & Multimodal) ─────
      // 🛑 TRAVA DE OPERADOR: Valentina só atende clientes não captados por operadores humanos
      const currentFlow = await db.query.agentFlowStates.findFirst({
        where: (t, { eq: dEq, and: dAnd }) =>
          dAnd(dEq(t.conversationId, convId), dEq(t.tenantId, tenantId))
      });

      const isHandledByOperator = Boolean(
        targetOperatorId !== null ||
        targetQueue === "meus" ||
        targetQueue === "finalizados" ||
        contact?.walletOperatorId ||
        currentFlow?.outcome === "completed" ||
        currentFlow?.outcome === "transferred" ||
        currentFlow?.outcome === "stopped"
      );

      // 🛑 REGRA ARQUITETURAL (AGENTS.md): SDR ativo exclusivamente para valem até go-live do tecfag
      if (tenantId === "valem" && finalSenderType === "client" && !isHandledByOperator) {
        let mediaType: "text" | "image" | "audio" | "document" = "text";
        let mediaBase64: string | undefined = undefined;
        let mimeType: string | undefined = undefined;

        const msgObj = rawMsg.message;
        if (msgObj) {
          if (msgObj.imageMessage) {
            mediaType = "image";
            mimeType = msgObj.imageMessage.mimetype || "image/jpeg";
            try {
              const buffer = await downloadMediaMessage(rawMsg, "buffer", {});
              mediaBase64 = buffer.toString("base64");
            } catch (e: any) {
              console.error("[Baileys/Media] Erro ao baixar imagem do WhatsApp:", e?.message);
            }
          } else if (msgObj.audioMessage) {
            mediaType = "audio";
            mimeType = msgObj.audioMessage.mimetype || "audio/ogg";
            try {
              const buffer = await downloadMediaMessage(rawMsg, "buffer", {});
              mediaBase64 = buffer.toString("base64");
            } catch (e: any) {
              console.error("[Baileys/Media] Erro ao baixar áudio do WhatsApp:", e?.message);
            }
          } else if (msgObj.documentMessage) {
            mediaType = "document";
            mimeType = msgObj.documentMessage.mimetype || "application/pdf";
            try {
              const buffer = await downloadMediaMessage(rawMsg, "buffer", {});
              mediaBase64 = buffer.toString("base64");
              console.log(`[Baileys/Media] Documento PDF baixado com sucesso do WhatsApp! Mime: ${mimeType}`);
            } catch (e: any) {
              console.error("[Baileys/Media] Erro ao baixar documento/PDF do WhatsApp:", e?.message);
            }
          }
        }

        SdrDebouncer.getInstance().pushIncomingMessage(tenantId, convId, phone, {
          messageId,
          text,
          mediaType,
          mimeType,
          mediaBase64,
          receivedAt: new Date(),
          rawMsg,
        });
      } else if (isHandledByOperator) {
        console.log(`[Baileys/SDR] 🛑 TRAVA DE OPERADOR ATIVA: Cliente ${phone} em atendimento humano ou triagem finalizada. Valentina silenciada.`);
      }

    } catch (e) {
      console.error(`Erro ao salvar mensagem recebida do Baileys no DB:`, e);
    }
  }
}

/**
 * Cache em memória de JIDs já resolvidos via onWhatsApp.
 * Evita chamar sock.onWhatsApp repetidamente para o mesmo número
 * e previne erros de rate-overlimit.
 * TTL: 24 horas (86.400.000 ms).
 */
const jidCache = new Map<string, { jid: string; expiresAt: number }>();
const JID_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Resolve o JID real registrado no WhatsApp para um dado telefone.
 * Lida com o problema de 8 vs 9 dígitos no Brasil usando o método sock.onWhatsApp.
 * Utiliza cache em memória (TTL 24h) para evitar chamadas desnecessarias ao WA.
 */
export async function resolveRealJid(sock: any, phone: string, fallbackJid?: string): Promise<string> {
  const cleanPhone = phone.replace(/\D/g, "");
  if (!cleanPhone) return fallbackJid || `${phone}@s.whatsapp.net`;

  // Verificar cache antes de qualquer chamada de rede
  const cached = jidCache.get(cleanPhone);
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[JID Resolver] Cache hit para ${cleanPhone}: ${cached.jid}`);
    return cached.jid;
  }

  const numbersToTry: string[] = [];

  // Se já tiver um fallbackJid, tenta extrair o número
  if (fallbackJid) {
    const fallbackNum = fallbackJid.split("@")[0];
    if (fallbackNum) numbersToTry.push(fallbackNum);
  }

  // Adiciona o telefone limpo
  numbersToTry.push(cleanPhone);

  // Tratamento específico para números do Brasil (DDI 55)
  if (cleanPhone.startsWith("55")) {
    const ddd = cleanPhone.slice(2, 4);
    const rest = cleanPhone.slice(4);

    if (rest.length === 9 && rest.startsWith("9")) {
      // É formato de 9 dígitos. Tenta também o de 8 dígitos.
      const eightDigit = `55${ddd}${rest.slice(1)}`;
      numbersToTry.push(eightDigit);
    } else if (rest.length === 8) {
      // É formato de 8 dígitos. Tenta também o de 9 dígitos.
      const nineDigit = `55${ddd}9${rest}`;
      numbersToTry.push(nineDigit);
    }
  } else {
    // Se não tem DDI 55, mas parece brasileiro (10 ou 11 dígitos)
    if (cleanPhone.length === 11 && cleanPhone.startsWith("9")) {
      const withDdi = `55${cleanPhone}`;
      numbersToTry.push(withDdi);
      const ddd = cleanPhone.slice(0, 2);
      const rest = cleanPhone.slice(2);
      const eightDigit = `55${ddd}${rest.slice(1)}`;
      numbersToTry.push(eightDigit);
    } else if (cleanPhone.length === 10) {
      const withDdi = `55${cleanPhone}`;
      numbersToTry.push(withDdi);
      const ddd = cleanPhone.slice(0, 2);
      const rest = cleanPhone.slice(2);
      const nineDigit = `55${ddd}9${rest}`;
      numbersToTry.push(nineDigit);
    } else if (cleanPhone.length === 11) {
      numbersToTry.push(`55${cleanPhone}`);
    }
  }

  // Remove duplicados mantendo a ordem
  const uniqueNumbers = Array.from(new Set(numbersToTry));

  // Tenta consultar no WhatsApp qual número existe e obter seu JID correto
  for (const num of uniqueNumbers) {
    try {
      const results = await sock.onWhatsApp(num);
      if (results && results.length > 0) {
        const res = results[0];
        if (res && res.exists && res.jid) {
          console.log(`[JID Resolver] JID real resolvido para ${phone}: ${res.jid}`);
          // Salvar no cache para evitar chamadas repetidas ao WA
          jidCache.set(cleanPhone, { jid: res.jid, expiresAt: Date.now() + JID_CACHE_TTL_MS });
          return res.jid;
        }
      }
    } catch (err: any) {
      console.log(`[JID Resolver] Falha ao consultar onWhatsApp para ${num}:`, err.message);
    }
  }

  // Se nada funcionou, retorna o fallback ou constrói o JID padrão
  if (fallbackJid) return fallbackJid;
  return cleanPhone.startsWith("55") ? `${cleanPhone}@s.whatsapp.net` : `55${cleanPhone}@s.whatsapp.net`;
}

// Registrar desligamento gracioso para containers (Railway SIGTERM / SIGINT)
if (typeof process !== "undefined" && typeof process.on === "function") {
  const handleSignal = () => {
    SessionManager.getInstance().shutdown().catch((err) => {
      console.error("[SessionManager] Erro durante encerramento gracioso:", err);
    });
  };
  process.once("SIGTERM", handleSignal);
  process.once("SIGINT", handleSignal);
}

