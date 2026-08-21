// ══════════════════════════════════════════════════════════════════════════════
// 💬 VALEM CHAT WIDGET — Core (sem framework, Vanilla TS)
// Gerencia: conexão WS, UI flutuante, estados, envio/recebimento de mensagens
// ══════════════════════════════════════════════════════════════════════════════

export interface WidgetOptions {
  tenant: string;
  wsUrl: string;
  mock: boolean;
}

interface Message {
  id: string;
  sender: "visitor" | "ai" | "operator" | "system";
  text: string;
  ts: number;
}

type WidgetState = "idle" | "open" | "minimized";

// Cookie persistente para identificar o visitante
function getCookieId(): string {
  const key = "_vlm_vid";
  const existing = document.cookie.split("; ").find((c) => c.startsWith(key + "="));
  if (existing) return existing.split("=")[1];
  const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  document.cookie = `${key}=${id};max-age=${60 * 60 * 24 * 365};path=/;SameSite=Lax`;
  return id;
}

export class ValemChatWidget {
  private opts: WidgetOptions;
  private cookieId: string;
  private ws: WebSocket | null = null;
  private messages: Message[] = [];
  private state: WidgetState = "idle";
  private container: HTMLElement | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private pageviewTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: WidgetOptions) {
    this.opts = opts;
    this.cookieId = getCookieId();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  mount() {
    this.injectDOM();
    if (this.opts.mock) {
      this.addMessage({ id: "mock-1", sender: "ai", text: "Olá! 😊 Sou a Valentina da Valem Válvulas e Embalagens. Posso te ajudar?", ts: Date.now() });
    } else {
      this.connectWS();
      this.trackPageview();
    }
  }

  // ── DOM ─────────────────────────────────────────────────────────────────────

  private injectDOM() {
    this.container = document.createElement("div");
    this.container.id = "vlm-chat-root";
    this.container.innerHTML = this.buildHTML();
    document.body.appendChild(this.container);
    this.bindEvents();
    this.renderMessages();
  }

  private buildHTML(): string {
    return `
    <div id="vlm-bubble" aria-label="Abrir chat com Valentina" role="button" tabindex="0">
      <div id="vlm-avatar">💬</div>
      <div id="vlm-badge" style="display:none">1</div>
    </div>

    <div id="vlm-panel" aria-hidden="true">
      <div id="vlm-header">
        <div id="vlm-header-info">
          <div id="vlm-header-avatar">V</div>
          <div>
            <div id="vlm-header-name">Valentina</div>
            <div id="vlm-header-status">Online • Valem Válvulas</div>
          </div>
        </div>
        <button id="vlm-close" aria-label="Fechar chat">✕</button>
      </div>

      <div id="vlm-messages" role="log" aria-live="polite"></div>

      <div id="vlm-input-area">
        <input id="vlm-input" type="text" placeholder="Digite sua mensagem..." autocomplete="off" maxlength="500" />
        <button id="vlm-send" aria-label="Enviar">➤</button>
      </div>

      <div id="vlm-footer">Atendimento via IA • Valem Pack</div>
    </div>
    `;
  }

  private bindEvents() {
    const bubble = document.getElementById("vlm-bubble")!;
    const closeBtn = document.getElementById("vlm-close")!;
    const sendBtn = document.getElementById("vlm-send")!;
    const input = document.getElementById("vlm-input") as HTMLInputElement;

    bubble.addEventListener("click", () => this.toggle());
    bubble.addEventListener("keydown", (e) => { if (e.key === "Enter") this.toggle(); });
    closeBtn.addEventListener("click", () => this.close());
    sendBtn.addEventListener("click", () => this.send());
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) this.send(); });
  }

  private renderMessages() {
    const container = document.getElementById("vlm-messages");
    if (!container) return;
    container.innerHTML = this.messages.map((m) => `
      <div class="vlm-msg vlm-msg--${m.sender}">
        <div class="vlm-msg-bubble">${this.escapeHtml(m.text)}</div>
      </div>
    `).join("");
    container.scrollTop = container.scrollHeight;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  }

  private addMessage(msg: Message) {
    this.messages.push(msg);
    this.renderMessages();

    // Badge de notificação quando o painel está fechado
    if (this.state !== "open" && msg.sender !== "visitor") {
      const badge = document.getElementById("vlm-badge");
      if (badge) {
        const count = parseInt(badge.textContent || "0") + 1;
        badge.textContent = String(count);
        badge.style.display = "flex";
      }
    }
  }

  // ── State ───────────────────────────────────────────────────────────────────

  private toggle() {
    if (this.state === "open") {
      this.close();
    } else {
      this.open();
    }
  }

  private open() {
    this.state = "open";
    const panel = document.getElementById("vlm-panel");
    if (panel) { panel.style.display = "flex"; panel.removeAttribute("aria-hidden"); }
    // Limpa badge
    const badge = document.getElementById("vlm-badge");
    if (badge) badge.style.display = "none";
    // Foca input
    setTimeout(() => (document.getElementById("vlm-input") as HTMLInputElement)?.focus(), 100);
  }

  private close() {
    this.state = "minimized";
    const panel = document.getElementById("vlm-panel");
    if (panel) { panel.style.display = "none"; panel.setAttribute("aria-hidden", "true"); }
  }

  // ── WebSocket ───────────────────────────────────────────────────────────────

  private connectWS() {
    const url = `${this.opts.wsUrl}?tenantId=${this.opts.tenant}&cookieId=${this.cookieId}&currentUrl=${encodeURIComponent(location.href)}&currentTitle=${encodeURIComponent(document.title)}`;
    console.log(`[Valentina Widget] Conectando ao WS: ${url}`);

    this.ws = new WebSocket(url);

    this.ws.addEventListener("open", () => {
      console.log("[Valentina Widget] ✅ WS conectado");
      this.reconnectAttempts = 0;
    });

    this.ws.addEventListener("message", (ev) => {
      try {
        const event = JSON.parse(ev.data as string);
        this.handleServerEvent(event);
      } catch (e) {
        console.error("[Valentina Widget] Erro ao parsear evento WS:", e);
      }
    });

    this.ws.addEventListener("close", () => {
      console.log("[Valentina Widget] WS fechado — tentando reconectar...");
      this.scheduleReconnect();
    });

    this.ws.addEventListener("error", (e) => {
      console.error("[Valentina Widget] Erro WS:", e);
    });
  }

  private handleServerEvent(event: any) {
    const { type } = event;

    if (type === "ai_message" || type === "operator_message") {
      this.addMessage({
        id: event.messageId || crypto.randomUUID?.() || String(Date.now()),
        sender: type === "ai_message" ? "ai" : "operator",
        text: event.text,
        ts: Date.now(),
      });
    }

    if (type === "bridge_sent") {
      this.addMessage({
        id: "bridge-" + Date.now(),
        sender: "system",
        text: "✅ Perfeito! Vou te contactar agora pelo WhatsApp para continuar o atendimento. Fique de olho nas mensagens! 📱",
        ts: Date.now(),
      });
    }

    if (type === "chat_closed") {
      this.addMessage({
        id: "closed-" + Date.now(),
        sender: "system",
        text: "Atendimento encerrado. Obrigado! 😊",
        ts: Date.now(),
      });
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    console.log(`[Valentina Widget] Reconectando em ${delay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWS();
    }, delay);
  }

  // ── Send ────────────────────────────────────────────────────────────────────

  private send() {
    const input = document.getElementById("vlm-input") as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";

    const msgId = crypto.randomUUID?.() || String(Date.now());
    this.addMessage({ id: msgId, sender: "visitor", text, ts: Date.now() });

    if (this.opts.mock) {
      // Mock: resposta simulada após 800ms
      setTimeout(() => {
        this.addMessage({
          id: "mock-reply-" + Date.now(),
          sender: "ai",
          text: "Entendi! Qual a quantidade que você precisa? Para atacado (CNPJ) fazemos a partir de 1.000 unidades. 😊",
          ts: Date.now(),
        });
      }, 800);
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "visitor_message", text, messageId: msgId }));
    } else {
      this.addMessage({ id: "err-" + Date.now(), sender: "system", text: "Você está offline. Reconectando...", ts: Date.now() });
    }
  }

  // ── Pageview Tracking ───────────────────────────────────────────────────────

  private trackPageview() {
    // Envia pageview ao conectar e a cada 30s (SPA support)
    let lastUrl = location.href;

    const sendPageview = () => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: "pageview",
          url: location.href,
          title: document.title,
          referrer: document.referrer,
        }));
      }
    };

    // Polling de URL para SPAs
    this.pageviewTimer = setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        sendPageview();
      }
    }, 2000);

    // WS aberto → envia imediatamente
    if (this.ws) {
      this.ws.addEventListener("open", sendPageview);
    }
  }
}