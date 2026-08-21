// ══════════════════════════════════════════════════════════════════════════════
// 💬 VALEM CHAT WIDGET — Core Engine (Valentina)
// Animações Pill Loop · Avatar HD · Textarea Expansivo · WhatsApp & Copy
// ══════════════════════════════════════════════════════════════════════════════

export interface WidgetOptions {
  tenant: string;
  wsUrl: string;
  avatarUrl: string;
  whatsappNumber: string;
  mock: boolean;
}

interface ChatMessage {
  id: string;
  sender: "visitor" | "ai" | "operator" | "system";
  text: string;
  timestamp: string;
  timeStr: string;
}

function formatTime(d = new Date()): string {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function getOrCreateCookieId(): string {
  const KEY = "valem_visitor_id";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

export class ValemChatWidget {
  private opts: WidgetOptions;
  private cookieId: string;
  private ws: WebSocket | null = null;
  private messages: ChatMessage[] = [];
  private isOpen = false;
  private isPillExpanded = true;
  private isTyping = false;
  private unreadCount = 0;
  
  // Timers
  private pillLoopTimer: ReturnType<typeof setInterval> | null = null;
  private isHoveringFab = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private pageviewInterval: ReturnType<typeof setInterval> | null = null;

  constructor(opts: WidgetOptions) {
    this.opts = opts;
    this.cookieId = getOrCreateCookieId();
  }

  // ── Inicialização ─────────────────────────────────────────────────────────

  mount() {
    this.injectDOM();
    this.startPillAnimationLoop();
    this.connectWebSocket();
    this.startPageviewTracking();
  }

  // ── Injeção de DOM ────────────────────────────────────────────────────────

  private injectDOM() {
    const root = document.createElement("div");
    root.id = "vlm-chat-root";
    root.innerHTML = this.renderHTML();
    document.body.appendChild(root);

    this.bindEvents();
  }

  private renderHTML(): string {
    const avatar = this.opts.avatarUrl;

    return `
    <!-- BOTÃO FLUTUANTE PILL / ÍCONE -->
    <div id="vlm-fab-wrapper">
      <button id="vlm-fab-button" class="vlm-pill-expanded" aria-label="Falar com Valentina">
        
        <!-- Estado Pill (Expandido) -->
        <div class="vlm-pill-content">
          <div class="vlm-fab-avatar-wrap">
            <img src="${avatar}" alt="Valentina" class="vlm-fab-avatar-img" />
          </div>
          <div class="vlm-fab-text-block">
            <span class="vlm-fab-title">Falar com atendente</span>
            <span class="vlm-fab-subtitle">
              <span class="vlm-online-dot"></span>
              Valentina • Online agora
            </span>
          </div>
        </div>

        <!-- Estado Ícone (Encolhido) -->
        <div class="vlm-icon-content">
          <svg class="vlm-icon-bubble-svg" viewBox="0 0 24 24">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
        </div>

      </button>
      <div id="vlm-fab-badge">0</div>
    </div>

    <!-- JANELA DO CHAT -->
    <div id="vlm-panel" aria-hidden="true">
      
      <!-- HEADER -->
      <div id="vlm-header">
        <div id="vlm-header-left">
          <div class="vlm-header-avatar-wrap">
            <img src="${avatar}" alt="Valentina" class="vlm-header-avatar-img" />
            <span class="vlm-header-status-badge"></span>
          </div>
          <div class="vlm-header-info">
            <span class="vlm-header-name">Valentina</span>
            <div class="vlm-header-subrow">
              <span class="vlm-header-role">Comercial</span>
              <span class="vlm-header-sep">·</span>
              <div class="vlm-header-actions-inline">
                <!-- WhatsApp Icon -->
                <a href="https://wa.me/${this.opts.whatsappNumber}?text=Ol%C3%A1%2C%20estou%20no%20site%20da%20Valem%20e%20gostaria%20de%20um%20atendimento." target="_blank" rel="noopener noreferrer" class="vlm-header-btn-action" title="Continuar no WhatsApp" aria-label="Abrir WhatsApp">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                </a>
                <!-- Copy Dialog Icon -->
                <button id="vlm-btn-copy-dialog" class="vlm-header-btn-action" title="Copiar conversa" aria-label="Copiar conversa">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div id="vlm-header-right">
          <!-- Minimize -->
          <button id="vlm-btn-minimize" class="vlm-header-ctrl-btn" title="Minimizar" aria-label="Minimizar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <!-- Close -->
          <button id="vlm-btn-close" class="vlm-header-ctrl-btn" title="Fechar" aria-label="Fechar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <!-- Toast de Cópia -->
        <div id="vlm-copy-toast">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Conversa copiada!
        </div>

      </div>

      <!-- CONTAINER DE MENSAGENS -->
      <div id="vlm-messages-container"></div>

      <!-- ÁREA DE INPUT EXPANSIVO (Auto-resize textarea) -->
      <div id="vlm-input-zone">
        <div class="vlm-textarea-wrap">
          <textarea id="vlm-chat-textarea" rows="1" placeholder="Digite sua mensagem..." autocomplete="off" maxlength="1000"></textarea>
        </div>
        <button id="vlm-btn-send" aria-label="Enviar mensagem">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>

      <!-- RODAPÉ LIMPO -->
      <div id="vlm-footer">Valem Pack</div>

    </div>
    `;
  }

  // ── Eventos ───────────────────────────────────────────────────────────────

  private bindEvents() {
    const fabButton = document.getElementById("vlm-fab-button")!;
    const btnClose = document.getElementById("vlm-btn-close")!;
    const btnMinimize = document.getElementById("vlm-btn-minimize")!;
    const btnCopy = document.getElementById("vlm-btn-copy-dialog")!;
    const btnSend = document.getElementById("vlm-btn-send")!;
    const textarea = document.getElementById("vlm-chat-textarea") as HTMLTextAreaElement;

    // Hover na Pill pausa a animação de encolher para não frustrar o clique
    fabButton.addEventListener("mouseenter", () => {
      this.isHoveringFab = true;
      this.setPillState(true);
    });
    fabButton.addEventListener("mouseleave", () => {
      this.isHoveringFab = false;
    });

    fabButton.addEventListener("click", () => this.togglePanel());
    btnClose.addEventListener("click", () => this.closePanel());
    btnMinimize.addEventListener("click", () => this.closePanel());
    btnCopy.addEventListener("click", () => this.copyConversation());

    btnSend.addEventListener("click", () => this.handleSendMessage());

    // Auto-resize do Textarea (como no WhatsApp)
    textarea.addEventListener("input", () => {
      textarea.style.height = "auto";
      const nextH = Math.min(textarea.scrollHeight, 120);
      textarea.style.height = `${Math.max(nextH, 22)}px`;
    });

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSendMessage();
      }
    });
  }

  // ── Animação em Loop do Botão (Pill ↔ Ícone) ──────────────────────────────

  private startPillAnimationLoop() {
    let phase = 0;
    this.pillLoopTimer = setInterval(() => {
      if (this.isOpen || this.isHoveringFab) return;
      phase = (phase + 1) % 2;
      this.setPillState(phase === 0);
    }, 6000); // Alterna a cada 6 segundos
  }

  private setPillState(expand: boolean) {
    this.isPillExpanded = expand;
    const btn = document.getElementById("vlm-fab-button");
    if (!btn) return;
    if (expand) {
      btn.classList.remove("vlm-pill-collapsed");
      btn.classList.add("vlm-pill-expanded");
    } else {
      btn.classList.remove("vlm-pill-expanded");
      btn.classList.add("vlm-pill-collapsed");
    }
  }

  // ── Painel Abre / Fecha ───────────────────────────────────────────────────

  private togglePanel() {
    if (this.isOpen) {
      this.closePanel();
    } else {
      this.openPanel();
    }
  }

  private openPanel() {
    this.isOpen = true;
    const panel = document.getElementById("vlm-panel");
    const fabWrapper = document.getElementById("vlm-fab-wrapper");
    const badge = document.getElementById("vlm-fab-badge");

    if (panel) {
      panel.style.display = "flex";
      // Trigger animation
      setTimeout(() => {
        panel.classList.add("vlm-panel-open");
        panel.removeAttribute("aria-hidden");
      }, 10);
    }

    if (fabWrapper) fabWrapper.style.display = "none";
    if (badge) {
      badge.style.display = "none";
      this.unreadCount = 0;
    }

    // Scroll para o fim
    this.scrollToBottom();

    // Focus no textarea
    setTimeout(() => {
      const ta = document.getElementById("vlm-chat-textarea") as HTMLTextAreaElement;
      ta?.focus();
    }, 200);
  }

  private closePanel() {
    this.isOpen = false;
    const panel = document.getElementById("vlm-panel");
    const fabWrapper = document.getElementById("vlm-fab-wrapper");

    if (panel) {
      panel.classList.remove("vlm-panel-open");
      panel.setAttribute("aria-hidden", "true");
      setTimeout(() => {
        if (!this.isOpen) panel.style.display = "none";
      }, 280);
    }

    if (fabWrapper) {
      fabWrapper.style.display = "block";
      this.setPillState(true);
    }
  }

  // ── Copiar Diálogo ────────────────────────────────────────────────────────

  private copyConversation() {
    if (this.messages.length === 0) return;

    const transcript = this.messages
      .map((m) => {
        const sender = m.sender === "visitor" ? "Você" : m.sender === "ai" ? "Valentina (Valem)" : "Operador";
        return `[${m.timeStr}] ${sender}:\n${m.text}\n`;
      })
      .join("\n");

    const header = `--- Atendimento Valem Pack ---\nData: ${new Date().toLocaleDateString("pt-BR")}\n\n`;
    const fullText = header + transcript;

    const showToast = () => {
      const toast = document.getElementById("vlm-copy-toast");
      if (toast) {
        toast.classList.add("vlm-toast-active");
        setTimeout(() => toast.classList.remove("vlm-toast-active"), 2200);
      }
    };

    if (navigator.clipboard) {
      navigator.clipboard.writeText(fullText).then(showToast).catch(() => this.fallbackCopy(fullText, showToast));
    } else {
      this.fallbackCopy(fullText, showToast);
    }
  }

  private fallbackCopy(text: string, cb: () => void) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    cb();
  }

  // ── Render de Mensagens ───────────────────────────────────────────────────

  private addMessage(msg: ChatMessage) {
    this.messages.push(msg);
    this.renderSingleMessage(msg);

    if (!this.isOpen && msg.sender !== "visitor") {
      this.unreadCount++;
      const badge = document.getElementById("vlm-fab-badge");
      if (badge) {
        badge.textContent = String(this.unreadCount);
        badge.style.display = "flex";
      }
    }
  }

  private renderSingleMessage(msg: ChatMessage) {
    const container = document.getElementById("vlm-messages-container");
    if (!container) return;

    // Remove indicador de digitação antes de renderizar a mensagem nova
    this.hideTypingIndicator();

    const row = document.createElement("div");
    row.className = `vlm-message-row vlm-message-row--${msg.sender}`;
    row.innerHTML = `
      <div class="vlm-bubble-box">${this.escapeAndFormat(msg.text)}</div>
      <span class="vlm-msg-time">${msg.timeStr}</span>
    `;

    container.appendChild(row);
    this.scrollToBottom();
  }

  private showTypingIndicator() {
    if (this.isTyping) return;
    this.isTyping = true;

    const container = document.getElementById("vlm-messages-container");
    if (!container) return;

    const row = document.createElement("div");
    row.id = "vlm-typing-indicator";
    row.className = "vlm-typing-row";
    row.innerHTML = `
      <img src="${this.opts.avatarUrl}" alt="Valentina" class="vlm-typing-avatar" />
      <div class="vlm-typing-bubble">
        <span class="vlm-typing-dot"></span>
        <span class="vlm-typing-dot"></span>
        <span class="vlm-typing-dot"></span>
      </div>
    `;

    container.appendChild(row);
    this.scrollToBottom();
  }

  private hideTypingIndicator() {
    this.isTyping = false;
    const elem = document.getElementById("vlm-typing-indicator");
    elem?.remove();
  }

  private scrollToBottom() {
    const container = document.getElementById("vlm-messages-container");
    if (container) {
      setTimeout(() => {
        container.scrollTop = container.scrollHeight;
      }, 30);
    }
  }

  private escapeAndFormat(text: string): string {
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Formata links e quebras de linha
    const withBreaks = escaped.replace(/\n/g, "<br>");
    
    // Markdown básico de negrito **texto**
    return withBreaks.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  }

  // ── Envio de Mensagens ────────────────────────────────────────────────────

  private handleSendMessage() {
    const textarea = document.getElementById("vlm-chat-textarea") as HTMLTextAreaElement;
    if (!textarea) return;

    const text = textarea.value.trim();
    if (!text) return;

    // Reset textarea
    textarea.value = "";
    textarea.style.height = "22px";

    const msgId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    this.addMessage({
      id: msgId,
      sender: "visitor",
      text,
      timestamp: new Date().toISOString(),
      timeStr: formatTime(),
    });

    if (this.opts.mock) {
      this.showTypingIndicator();
      setTimeout(() => {
        this.addMessage({
          id: `mock-${Date.now()}`,
          sender: "ai",
          text: "Olá! Recebi sua mensagem. Em que posso te ajudar hoje com frascos e válvulas?",
          timestamp: new Date().toISOString(),
          timeStr: formatTime(),
        });
      }, 1200);
      return;
    }

    // Envio Real via WebSocket
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.showTypingIndicator();
      this.ws.send(JSON.stringify({
        type: "visitor_message",
        text,
        messageId: msgId,
        url: location.href,
        title: document.title,
      }));
    } else {
      this.addMessage({
        id: `err-${Date.now()}`,
        sender: "system",
        text: "Tentando restabelecer conexão... Sua mensagem será enviada em instantes.",
        timestamp: new Date().toISOString(),
        timeStr: formatTime(),
      });
      this.connectWebSocket();
    }
  }

  // ── WebSocket Real ────────────────────────────────────────────────────────

  private connectWebSocket() {
    if (this.opts.mock) return;

    const cleanWsUrl = this.opts.wsUrl;
    const url = `${cleanWsUrl}?tenantId=${this.opts.tenant}&cookieId=${this.cookieId}&currentUrl=${encodeURIComponent(location.href)}&currentTitle=${encodeURIComponent(document.title)}`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log("[Valem Chat] ✅ Conectado ao servidor");
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          this.handleIncomingPayload(payload);
        } catch (e) {
          console.error("[Valem Chat] Erro ao processar mensagem WS:", e);
        }
      };

      this.ws.onclose = () => {
        console.log("[Valem Chat] Conexão WS encerrada. Agendando reconexão...");
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.warn("[Valem Chat] Aviso WS:", err);
      };
    } catch (e) {
      this.scheduleReconnect();
    }
  }

  private handleIncomingPayload(payload: any) {
    const { type } = payload;

    if (type === "ai_message" || type === "operator_message") {
      this.hideTypingIndicator();
      this.addMessage({
        id: payload.messageId || crypto.randomUUID?.() || String(Date.now()),
        sender: type === "ai_message" ? "ai" : "operator",
        text: payload.text,
        timestamp: new Date().toISOString(),
        timeStr: formatTime(),
      });
    }

    if (type === "typing") {
      if (payload.isTyping) {
        this.showTypingIndicator();
      } else {
        this.hideTypingIndicator();
      }
    }

    if (type === "bridge_sent") {
      this.hideTypingIndicator();
      this.addMessage({
        id: `bridge-${Date.now()}`,
        sender: "system",
        text: "📱 **Atendimento transferido para o WhatsApp!** Nossa equipe já recebeu todas as suas informações e continuará a conversa por lá. Fique atento ao seu app! 😊",
        timestamp: new Date().toISOString(),
        timeStr: formatTime(),
      });
    }

    if (type === "chat_closed") {
      this.hideTypingIndicator();
      this.addMessage({
        id: `closed-${Date.now()}`,
        sender: "system",
        text: "Atendimento finalizado. Agradecemos o contato com a Valem Pack!",
        timestamp: new Date().toISOString(),
        timeStr: formatTime(),
      });
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(1500 * Math.pow(1.5, this.reconnectAttempts), 20000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, delay);
  }

  // ── Rastreamento de Pageviews ─────────────────────────────────────────────

  private startPageviewTracking() {
    let lastUrl = location.href;

    this.pageviewInterval = setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: "pageview",
            url: location.href,
            title: document.title,
            referrer: document.referrer,
          }));
        }
      }
    }, 2000);
  }
}