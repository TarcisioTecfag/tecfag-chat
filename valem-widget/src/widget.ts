// ══════════════════════════════════════════════════════════════════════════════
// 💬 VALEM CHAT WIDGET — Valentina Live Chat Engine (v3.2)
// Waveform Real-Time · Draggable · Ícones Vetoriais SVG (Sem Emojis) · Player Dourado
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
  contentType?: "text" | "audio" | "image" | "video" | "document";
  mediaUrl?: string;
  fileName?: string;
  fileSize?: number;
  durationSec?: number;
  timestamp: string;
  timeStr: string;
  fullDateStr: string;
}

// ── Helpers de Formatação e Validação ──────────────────────────────────────────

function formatTime(d = new Date()): string {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatFullDate(d = new Date()): string {
  const date = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${date} às ${time}`;
}

function formatFileSize(bytes = 0): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(sec = 0): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

// ── Validação e Máscara Adaptativa CPF / CNPJ ──────────────────────────────────

function isValidCPF(cpf: string): boolean {
  const clean = cpf.replace(/\D/g, "");
  if (clean.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(clean)) return false;
  let sum = 0, rest = 0;
  for (let i = 1; i <= 9; i++) sum += parseInt(clean[i - 1]) * (11 - i);
  rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) rest = 0;
  if (rest !== parseInt(clean[9])) return false;
  sum = 0;
  for (let i = 1; i <= 10; i++) sum += parseInt(clean[i - 1]) * (12 - i);
  rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) rest = 0;
  if (rest !== parseInt(clean[10])) return false;
  return true;
}

function isValidCNPJ(cnpj: string): boolean {
  const clean = cnpj.replace(/\D/g, "");
  if (clean.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(clean)) return false;
  let length = clean.length - 2;
  let numbers = clean.substring(0, length);
  const digits = clean.substring(length);
  let sum = 0;
  let pos = length - 7;
  for (let i = length; i >= 1; i--) {
    sum += parseInt(numbers.charAt(length - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (result !== parseInt(digits.charAt(0))) return false;
  length += 1;
  numbers = clean.substring(0, length);
  sum = 0;
  pos = length - 7;
  for (let i = length; i >= 1; i--) {
    sum += parseInt(numbers.charAt(length - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (result !== parseInt(digits.charAt(1))) return false;
  return true;
}

function formatCpfCnpj(val: string): string {
  const clean = val.replace(/\D/g, "").slice(0, 14);
  if (clean.length <= 11) {
    return clean
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
  }
  return clean
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3/$4")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, "$1.$2.$3/$4-$5");
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

// ── Ícones Vetoriais SVG (Substituindo Emojis) ──────────────────────────────────

function getFileSvgIcon(name: string): string {
  const ext = (name.split(".").pop() || "").toLowerCase();
  
  // Planilhas (Excel, CSV)
  if (["xlsx", "xls", "csv"].includes(ext)) {
    return `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="8" y1="13" x2="16" y2="13"/>
        <line x1="8" y1="17" x2="16" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    `;
  }
  // PDF
  if (["pdf"].includes(ext)) {
    return `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <path d="M9 15h6"/>
        <path d="M9 11h6"/>
      </svg>
    `;
  }
  // Documentos de Texto (Word, TXT)
  if (["doc", "docx", "txt", "rtf"].includes(ext)) {
    return `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    `;
  }
  // Arquivos compactados (Zip, Rar)
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
    return `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        <line x1="12" y1="11" x2="12" y2="17"/>
        <line x1="9" y1="14" x2="15" y2="14"/>
      </svg>
    `;
  }
  // Padrão
  return `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  `;
}

export class ValemChatWidget {
  private opts: WidgetOptions;
  private cookieId: string;
  private ws: WebSocket | null = null;
  private messages: ChatMessage[] = [];
  private isOpen = false;
  private isPillExpanded = true;
  private unreadCount = 0;
  private isTyping = false;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  private pageviewInterval: any = null;
  private pillLoopTimer: any = null;
  private isHoveringFab = false;
  private pendingFile: File | null = null;
  
  // Visitante Onboarding
  private visitorName = "";
  private visitorDoc = ""; // CPF ou CNPJ
  private hasCompletedPrechat = false;
  private hasSentWelcomeSequence = false;

  // Gravação de áudio & Waveform
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private recordStartTime = 0;
  private recordTimer: any = null;
  private recordingDurationSec = 0;
  private recordedAudioBlob: Blob | null = null;
  private recordedAudioDataUrl = "";
  private previewAudioElem: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private waveformAnimFrame: number | null = null;

  // Draggable State
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private panelInitialLeft = 0;
  private panelInitialTop = 0;

  constructor(options: Partial<WidgetOptions> = {}) {
    const scriptTag = document.currentScript as HTMLScriptElement | null;
    const dataset = scriptTag ? scriptTag.dataset : {};

    this.opts = {
      tenant: options.tenant || dataset.tenant || "valem",
      wsUrl: options.wsUrl || dataset.ws || `ws://${location.host}/ws/livechat`,
      avatarUrl: options.avatarUrl || dataset.avatar || "/valentina-avatar.png",
      whatsappNumber: options.whatsappNumber || dataset.whatsapp || "5514981468232",
      mock: options.mock !== undefined ? options.mock : dataset.mock === "true",
    };

    this.cookieId = getOrCreateCookieId();
    this.loadSavedVisitorData();
    this.init();
  }

  private loadSavedVisitorData() {
    try {
      this.visitorName = localStorage.getItem("valem_visitor_name") || "";
      this.visitorDoc = localStorage.getItem("valem_visitor_doc") || "";
      if (this.visitorName && this.visitorDoc) {
        this.hasCompletedPrechat = true;
      }
    } catch {}
  }

  private saveVisitorData(name: string, doc: string) {
    this.visitorName = name.trim();
    this.visitorDoc = doc.trim();
    this.hasCompletedPrechat = true;
    try {
      localStorage.setItem("valem_visitor_name", this.visitorName);
      localStorage.setItem("valem_visitor_doc", this.visitorDoc);
    } catch {}
  }

  private init() {
    this.injectDOM();
    this.connectWebSocket();
    this.startPageviewTracking();
    this.startPillAnimationLoop();
  }

  private injectDOM() {
    const root = document.createElement("div");
    root.id = "vlm-chat-root";
    root.innerHTML = this.renderHTML();
    document.body.appendChild(root);
    this.bindEvents();
    this.initDraggable();
  }

  private renderHTML(): string {
    const avatar = this.opts.avatarUrl;
    return `
    <!-- BOTÃO FLUTUANTE PILL -->
    <div id="vlm-fab-wrapper">
      <button id="vlm-fab-button" class="vlm-pill-expanded" aria-label="Falar com Valentina">
        <div class="vlm-pill-content">
          <div class="vlm-fab-avatar-wrap">
            <img src="${avatar}" alt="Valentina" class="vlm-fab-avatar-img" />
          </div>
          <div class="vlm-fab-text-block">
            <span class="vlm-fab-title">Falar com atendente</span>
            <span class="vlm-fab-subtitle"><span class="vlm-online-dot"></span>Valentina • Online agora</span>
          </div>
        </div>
        <div class="vlm-icon-content">
          <svg class="vlm-icon-bubble-svg" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        </div>
      </button>
      <div id="vlm-fab-badge">0</div>
    </div>

    <!-- LIGHTBOX FOTO EM TELA CHEIA -->
    <div id="vlm-avatar-lightbox">
      <div class="vlm-lightbox-content">
        <button id="vlm-btn-close-lightbox" class="vlm-lightbox-close-btn" title="Fechar">✕</button>
        <img src="${avatar}" alt="Valentina" class="vlm-lightbox-img" />
        <span class="vlm-lightbox-name">Valentina</span>
        <span class="vlm-lightbox-role">Consultora Comercial • Valem Pack</span>
      </div>
    </div>

    <!-- PAINEL PRINCIPAL DO CHAT (DRAGGABLE) -->
    <div id="vlm-panel" aria-hidden="true">

      <!-- TELA 1: PRE-CHAT ONBOARDING (NOME + CPF/CNPJ) -->
      <div id="vlm-prechat-view" class="${this.hasCompletedPrechat ? "vlm-prechat-hidden" : ""}">
        <button id="vlm-btn-prechat-close" class="vlm-prechat-header-close" title="Fechar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>

        <div class="vlm-prechat-body">
          <div class="vlm-prechat-icon-circle">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          </div>
          <h2 class="vlm-prechat-title">Bem-vindo à Valem!</h2>
          <p class="vlm-prechat-subtitle">Valentina está pronta para te atender. Como podemos te chamar?</p>

          <form id="vlm-prechat-form" class="vlm-prechat-form">
            <div class="vlm-prechat-field">
              <label class="vlm-prechat-label">Seu Nome</label>
              <input type="text" id="vlm-input-name" class="vlm-prechat-input" placeholder="Digite seu nome..." autocomplete="name" required />
            </div>

            <div class="vlm-prechat-field">
              <label class="vlm-prechat-label">CPF ou CNPJ</label>
              <input type="text" id="vlm-input-doc" class="vlm-prechat-input" placeholder="Digite seu CPF ou CNPJ..." maxlength="18" autocomplete="off" required />
              <span id="vlm-doc-error" class="vlm-prechat-error-msg">Informe um CPF ou CNPJ válido</span>
            </div>

            <button type="submit" id="vlm-btn-start-chat" class="vlm-prechat-submit-btn" disabled>
              <span>Iniciar Atendimento</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </form>
        </div>

        <div style="font-size:11px; opacity:0.65; text-align:center; padding-top:12px;">
          Valem Válvulas e Embalagens • Loja Oficial
        </div>
      </div>

      <!-- TELA 2: INTERFACE DE CONVERSA COM VALENTINA -->
      <div id="vlm-header" title="Clique e arraste para reposicionar">
        <div id="vlm-header-left">
          <div class="vlm-header-avatar-wrap" id="vlm-header-avatar-btn" title="Ver foto em tela cheia">
            <img src="${avatar}" alt="Valentina" class="vlm-header-avatar-img" />
            <span class="vlm-header-status-badge"></span>
          </div>
          <div class="vlm-header-info">
            <span class="vlm-header-name">Valentina</span>
            <div class="vlm-header-subrow">
              <span class="vlm-header-role">Comercial</span>
              <span class="vlm-header-sep">·</span>
              <div class="vlm-header-actions-inline">
                <a href="https://wa.me/${this.opts.whatsappNumber}?text=Ol%C3%A1%2C%20estou%20no%20site%20da%20Valem%20e%20gostaria%20de%20um%20atendimento." target="_blank" rel="noopener noreferrer" class="vlm-header-btn-action" title="Continuar no WhatsApp" aria-label="Abrir WhatsApp">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                </a>
                <button id="vlm-btn-copy-dialog" class="vlm-header-btn-action" title="Copiar conversa" aria-label="Copiar conversa">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div id="vlm-header-right">
          <button id="vlm-btn-close" class="vlm-header-ctrl-btn" title="Fechar chat" aria-label="Fechar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div id="vlm-copy-toast">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Conversa copiada!
        </div>
      </div>

      <div id="vlm-messages-container"></div>

      <!-- INPUT ZONE -->
      <div id="vlm-input-zone">
        <!-- Barra de Prévia de Arquivo -->
        <div id="vlm-attachment-preview-bar">
          <div class="vlm-preview-chip">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span id="vlm-preview-filename">arquivo.pdf</span>
          </div>
          <button id="vlm-btn-remove-attachment" class="vlm-preview-remove-btn" title="Remover anexo">✕</button>
        </div>

        <!-- 1) Linha Padrão de Input (Clipe + Textarea + Botão Unificado Mic/Enviar) -->
        <div id="vlm-standard-input-row" class="vlm-input-row">
          <input type="file" id="vlm-file-input" style="display:none" accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.csv,.txt" />
          <button id="vlm-btn-attach" class="vlm-btn-clip" title="Anexar foto, vídeo, documento ou planilha" aria-label="Anexar arquivo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          </button>
          <div class="vlm-textarea-wrap">
            <textarea id="vlm-chat-textarea" rows="1" placeholder="Digite sua mensagem..." autocomplete="off" maxlength="1500"></textarea>
          </div>
          <!-- Botão Unificado: Mic quando vazio, Enviar quando preenchido -->
          <button id="vlm-btn-action-main" class="vlm-btn-action-circle" title="Gravar áudio" aria-label="Ação">
            <svg id="vlm-icon-mic" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            <svg id="vlm-icon-send" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:none"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>

        <!-- 2) Linha de Gravação de Áudio Ativa com Waveform Dourado -->
        <div id="vlm-audio-record-row" class="vlm-audio-record-zone">
          <div class="vlm-rec-indicator">
            <span class="vlm-rec-dot"></span>
            <span id="vlm-rec-timer">00:00</span>
          </div>

          <!-- Waveform Visualizer -->
          <div class="vlm-rec-waveform" id="vlm-rec-waveform">
            ${Array.from({ length: 18 }).map(() => `<span class="vlm-wave-bar"></span>`).join("")}
          </div>

          <div class="vlm-rec-actions">
            <button id="vlm-btn-rec-cancel" class="vlm-btn-rec-cancel" title="Cancelar gravação">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
            <button id="vlm-btn-rec-finish" class="vlm-btn-rec-stop" title="Concluir gravação para pré-escuta">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
          </div>
        </div>

        <!-- 3) Linha de Pré-Escuta do Áudio Gravado (Preview Dourado) -->
        <div id="vlm-audio-preview-row" class="vlm-audio-preview-zone">
          <div class="vlm-preview-player-left">
            <button id="vlm-btn-preview-play" class="vlm-btn-preview-play" title="Tocar prévia">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </button>
            <div class="vlm-preview-track">
              <div id="vlm-preview-progressbar-bg" class="vlm-preview-progressbar-bg">
                <div id="vlm-preview-progressbar-fill" class="vlm-preview-progressbar-fill"></div>
              </div>
              <span id="vlm-preview-duration" class="vlm-preview-time">0:00</span>
            </div>
          </div>
          <div class="vlm-preview-actions">
            <button id="vlm-btn-preview-trash" class="vlm-btn-preview-trash" title="Descartar áudio">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
            <button id="vlm-btn-preview-send" class="vlm-btn-preview-send" title="Enviar áudio gravado">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>

      </div>

      <div id="vlm-footer">Valem Pack</div>
    </div>
    `;
  }

  private bindEvents() {
    const fabButton = document.getElementById("vlm-fab-button")!;
    const btnClose = document.getElementById("vlm-btn-close")!;
    const btnCopy = document.getElementById("vlm-btn-copy-dialog")!;
    const btnActionMain = document.getElementById("vlm-btn-action-main")!;
    const btnAttach = document.getElementById("vlm-btn-attach")!;
    const fileInput = document.getElementById("vlm-file-input") as HTMLInputElement;
    const btnRemoveAtt = document.getElementById("vlm-btn-remove-attachment")!;
    const btnRecCancel = document.getElementById("vlm-btn-rec-cancel")!;
    const btnRecFinish = document.getElementById("vlm-btn-rec-finish")!;
    const textarea = document.getElementById("vlm-chat-textarea") as HTMLTextAreaElement;

    // Pre-chat form events
    const prechatForm = document.getElementById("vlm-prechat-form") as HTMLFormElement;
    const inputName = document.getElementById("vlm-input-name") as HTMLInputElement;
    const inputDoc = document.getElementById("vlm-input-doc") as HTMLInputElement;
    const docError = document.getElementById("vlm-doc-error")!;
    const btnStartChat = document.getElementById("vlm-btn-start-chat") as HTMLButtonElement;
    const btnPrechatClose = document.getElementById("vlm-btn-prechat-close")!;

    // Lightbox events
    const headerAvatarBtn = document.getElementById("vlm-header-avatar-btn")!;
    const lightbox = document.getElementById("vlm-avatar-lightbox")!;
    const btnCloseLightbox = document.getElementById("vlm-btn-close-lightbox")!;

    // Audio Preview events
    const btnPrevPlay = document.getElementById("vlm-btn-preview-play")!;
    const btnPrevTrash = document.getElementById("vlm-btn-preview-trash")!;
    const btnPrevSend = document.getElementById("vlm-btn-preview-send")!;

    // ── Pre-Chat Input Validation & Masking ──────────────────────────────────
    const checkPrechatValidity = () => {
      const nameVal = inputName.value.trim();
      const rawDoc = inputDoc.value.replace(/\D/g, "");
      const isDocValid = rawDoc.length === 11 ? isValidCPF(rawDoc) : rawDoc.length === 14 ? isValidCNPJ(rawDoc) : false;

      if (rawDoc.length > 0 && !isDocValid && (rawDoc.length === 11 || rawDoc.length === 14)) {
        inputDoc.classList.add("vlm-input-error");
        docError.classList.add("vlm-show-error");
      } else {
        inputDoc.classList.remove("vlm-input-error");
        docError.classList.remove("vlm-show-error");
      }

      if (nameVal.length >= 2 && isDocValid) {
        btnStartChat.removeAttribute("disabled");
      } else {
        btnStartChat.setAttribute("disabled", "true");
      }
    };

    inputName.addEventListener("input", checkPrechatValidity);
    inputDoc.addEventListener("input", () => {
      inputDoc.value = formatCpfCnpj(inputDoc.value);
      checkPrechatValidity();
    });

    prechatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = inputName.value.trim();
      const doc = inputDoc.value.trim();
      if (!name || !doc) return;
      this.saveVisitorData(name, doc);
      document.getElementById("vlm-prechat-view")?.classList.add("vlm-prechat-hidden");
      this.notifyVisitorDataToBackend();
      this.triggerWelcomeSequence();
    });

    btnPrechatClose.addEventListener("click", () => this.closePanel());

    // ── Lightbox Valentina ──────────────────────────────────────────────────
    const openLightbox = () => { lightbox.classList.add("vlm-lightbox-open"); };
    const closeLightbox = () => { lightbox.classList.remove("vlm-lightbox-open"); };

    headerAvatarBtn.addEventListener("click", (e) => { e.stopPropagation(); openLightbox(); });
    btnCloseLightbox.addEventListener("click", (e) => { e.stopPropagation(); closeLightbox(); });
    lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });

    // ── Fab & Chat Panel Events ─────────────────────────────────────────────
    fabButton.addEventListener("mouseenter", () => { this.isHoveringFab = true; this.setPillState(true); });
    fabButton.addEventListener("mouseleave", () => { this.isHoveringFab = false; });
    fabButton.addEventListener("click", () => this.togglePanel());
    btnClose.addEventListener("click", (e) => { e.stopPropagation(); this.closePanel(); });
    btnCopy.addEventListener("click", (e) => { e.stopPropagation(); this.copyConversation(); });

    // Botão de Ação Unificado (Mic quando vazio, Send quando preenchido)
    btnActionMain.addEventListener("click", () => {
      const hasText = textarea.value.trim().length > 0;
      const hasFile = this.pendingFile !== null;
      if (hasText || hasFile) {
        this.handleSendMessage();
      } else {
        this.startAudioRecording();
      }
    });

    textarea.addEventListener("input", () => {
      textarea.style.height = "20px";
      const nextH = Math.min(Math.max(textarea.scrollHeight, 20), 100);
      textarea.style.height = `${nextH}px`;
      this.updateButtonsState();
    });

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.handleSendMessage(); }
    });

    // Gravação de Áudio
    btnRecCancel.addEventListener("click", () => this.cancelAudioRecording());
    btnRecFinish.addEventListener("click", () => this.finishRecordingForPreview());

    // Preview do Áudio
    btnPrevPlay.addEventListener("click", () => this.togglePreviewAudioPlay());
    btnPrevTrash.addEventListener("click", () => this.discardAudioPreview());
    btnPrevSend.addEventListener("click", () => this.sendRecordedAudioFromPreview());

    // Anexos
    btnAttach.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => { if (fileInput.files && fileInput.files[0]) this.handleFileSelected(fileInput.files[0]); });
    btnRemoveAtt.addEventListener("click", () => this.clearPendingFile());
  }

  // ── Drag and Drop do Widget ───────────────────────────────────────────────
  private initDraggable() {
    const header = document.getElementById("vlm-header");
    const panel = document.getElementById("vlm-panel");
    if (!header || !panel) return;

    const startDrag = (clientX: number, clientY: number, target: EventTarget | null) => {
      // Ignorar cliques em botões, links ou avatares dentro do header
      if ((target as HTMLElement)?.closest("button, a, input, textarea, .vlm-header-avatar-wrap")) {
        return;
      }
      this.isDragging = true;
      this.dragStartX = clientX;
      this.dragStartY = clientY;

      const rect = panel.getBoundingClientRect();
      this.panelInitialLeft = rect.left;
      this.panelInitialTop = rect.top;

      panel.style.bottom = "auto";
      panel.style.right = "auto";
      panel.style.left = `${this.panelInitialLeft}px`;
      panel.style.top = `${this.panelInitialTop}px`;
      panel.classList.add("vlm-is-dragging");
    };

    const doDrag = (clientX: number, clientY: number) => {
      if (!this.isDragging) return;
      const deltaX = clientX - this.dragStartX;
      const deltaY = clientY - this.dragStartY;

      let newLeft = this.panelInitialLeft + deltaX;
      let newTop = this.panelInitialTop + deltaY;

      const minLeft = 10;
      const maxLeft = window.innerWidth - panel.offsetWidth - 10;
      const minTop = 10;
      const maxTop = window.innerHeight - panel.offsetHeight - 10;

      newLeft = Math.max(minLeft, Math.min(maxLeft, newLeft));
      newTop = Math.max(minTop, Math.min(maxTop, newTop));

      panel.style.left = `${newLeft}px`;
      panel.style.top = `${newTop}px`;
    };

    const stopDrag = () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      panel.classList.remove("vlm-is-dragging");
    };

    // Mouse Events
    header.addEventListener("mousedown", (e) => startDrag(e.clientX, e.clientY, e.target));
    window.addEventListener("mousemove", (e) => doDrag(e.clientX, e.clientY));
    window.addEventListener("mouseup", stopDrag);

    // Touch Events
    header.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) startDrag(e.touches[0].clientX, e.touches[0].clientY, e.target);
    }, { passive: true });

    window.addEventListener("touchmove", (e) => {
      if (this.isDragging && e.touches.length === 1) doDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    window.addEventListener("touchend", stopDrag);
  }

  private startPillAnimationLoop() {
    let phase = 0;
    this.pillLoopTimer = setInterval(() => {
      if (this.isOpen || this.isHoveringFab) return;
      phase = (phase + 1) % 2;
      this.setPillState(phase === 0);
    }, 6000);
  }

  private setPillState(expand: boolean) {
    this.isPillExpanded = expand;
    const btn = document.getElementById("vlm-fab-button");
    if (!btn) return;
    if (expand) { btn.classList.remove("vlm-pill-collapsed"); btn.classList.add("vlm-pill-expanded"); }
    else { btn.classList.remove("vlm-pill-expanded"); btn.classList.add("vlm-pill-collapsed"); }
  }

  private togglePanel() { this.isOpen ? this.closePanel() : this.openPanel(); }

  private openPanel() {
    this.isOpen = true;
    const panel = document.getElementById("vlm-panel");
    const fabWrapper = document.getElementById("vlm-fab-wrapper");
    const badge = document.getElementById("vlm-fab-badge");
    if (panel) {
      panel.style.display = "flex";
      setTimeout(() => { panel.classList.add("vlm-panel-open"); panel.removeAttribute("aria-hidden"); }, 10);
    }
    if (fabWrapper) fabWrapper.style.display = "none";
    if (badge) { badge.style.display = "none"; this.unreadCount = 0; }
    
    if (this.hasCompletedPrechat) {
      document.getElementById("vlm-prechat-view")?.classList.add("vlm-prechat-hidden");
      this.triggerWelcomeSequence();
      setTimeout(() => { (document.getElementById("vlm-chat-textarea") as HTMLTextAreaElement)?.focus(); }, 200);
    } else {
      document.getElementById("vlm-prechat-view")?.classList.remove("vlm-prechat-hidden");
      setTimeout(() => { (document.getElementById("vlm-input-name") as HTMLInputElement)?.focus(); }, 200);
    }
    this.scrollToBottom();
  }

  private closePanel() {
    this.isOpen = false;
    const panel = document.getElementById("vlm-panel");
    const fabWrapper = document.getElementById("vlm-fab-wrapper");
    if (panel) {
      panel.classList.remove("vlm-panel-open");
      panel.setAttribute("aria-hidden", "true");
      setTimeout(() => { if (!this.isOpen) panel.style.display = "none"; }, 280);
    }
    if (fabWrapper) { fabWrapper.style.display = "block"; this.setPillState(true); }
  }

  // ── 3 Mensagens Fragmentadas da Valentina ─────────────────────────────────
  private triggerWelcomeSequence() {
    if (this.hasSentWelcomeSequence || this.messages.length > 0) return;
    this.hasSentWelcomeSequence = true;

    const name = this.visitorName ? this.visitorName.split(" ")[0] : "";
    const greeting = getGreeting();
    const msg1Text = name ? `${greeting}, ${name}!` : `${greeting}!`;
    const msg2Text = "Eu sou a Valentina, da Valem Válvulas e Embalagens.";
    const msg3Text = "Como posso te ajudar hoje?";

    setTimeout(() => {
      this.addMessage({
        id: `welcome-1-${Date.now()}`,
        sender: "ai",
        text: msg1Text,
        contentType: "text",
        timestamp: new Date().toISOString(),
        timeStr: formatTime(),
        fullDateStr: formatFullDate(),
      });

      setTimeout(() => {
        this.showTypingIndicator();
        setTimeout(() => {
          this.hideTypingIndicator();
          this.addMessage({
            id: `welcome-2-${Date.now()}`,
            sender: "ai",
            text: msg2Text,
            contentType: "text",
            timestamp: new Date().toISOString(),
            timeStr: formatTime(),
            fullDateStr: formatFullDate(),
          });

          setTimeout(() => {
            this.showTypingIndicator();
            setTimeout(() => {
              this.hideTypingIndicator();
              this.addMessage({
                id: `welcome-3-${Date.now()}`,
                sender: "ai",
                text: msg3Text,
                contentType: "text",
                timestamp: new Date().toISOString(),
                timeStr: formatTime(),
                fullDateStr: formatFullDate(),
              });
            }, 800);
          }, 400);

        }, 800);
      }, 400);

    }, 300);
  }

  private notifyVisitorDataToBackend() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "visitor_identify",
        name: this.visitorName,
        doc: this.visitorDoc,
        url: location.href,
        title: document.title,
      }));
    }
  }

  private copyConversation() {
    if (this.messages.length === 0) return;
    const transcript = this.messages.map(m => {
      const sender = m.sender === "visitor" ? (this.visitorName || "Você") : m.sender === "ai" ? "Valentina (Valem)" : "Operador";
      const content = m.text || (m.fileName ? `[Arquivo: ${m.fileName}]` : "[Áudio]");
      return `[${m.timeStr}] ${sender}:\n${content}\n`;
    }).join("\n");
    const header = `--- Atendimento Valem Pack ---\nData: ${new Date().toLocaleDateString("pt-BR")}\nCliente: ${this.visitorName || "Visitante"} (${this.visitorDoc || "Não informado"})\n\n`;
    const fullText = header + transcript;
    const showToast = () => {
      const toast = document.getElementById("vlm-copy-toast");
      if (toast) { toast.classList.add("vlm-toast-active"); setTimeout(() => toast.classList.remove("vlm-toast-active"), 2200); }
    };
    if (navigator.clipboard) navigator.clipboard.writeText(fullText).then(showToast).catch(() => this.fallbackCopy(fullText, showToast));
    else this.fallbackCopy(fullText, showToast);
  }

  private fallbackCopy(text: string, cb: () => void) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
    cb();
  }

  // ── Gravação de Áudio com Waveform em Tempo Real ──────────────────────────

  private async startAudioRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];
      let mimeType = "audio/webm";
      if (!MediaRecorder.isTypeSupported("audio/webm")) {
        if (MediaRecorder.isTypeSupported("audio/mp4")) mimeType = "audio/mp4";
        else mimeType = "";
      }
      this.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.audioChunks.push(e.data); };
      this.mediaRecorder.start(200);
      this.recordStartTime = Date.now();
      this.recordingDurationSec = 0;

      // Iniciar Web Audio API Analyser para o Waveform em tempo real
      this.initWaveformVisualizer(stream);

      document.getElementById("vlm-standard-input-row")!.style.display = "none";
      document.getElementById("vlm-audio-preview-row")!.classList.remove("vlm-preview-active");
      const recZone = document.getElementById("vlm-audio-record-row")!;
      recZone.classList.add("vlm-recording-active");

      const timerElem = document.getElementById("vlm-rec-timer")!;
      timerElem.textContent = "00:00";
      this.recordTimer = setInterval(() => {
        this.recordingDurationSec = Math.floor((Date.now() - this.recordStartTime) / 1000);
        const m = Math.floor(this.recordingDurationSec / 60);
        const s = this.recordingDurationSec % 60;
        timerElem.textContent = `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
      }, 1000);
    } catch (err) { alert("Permissão de microfone negada ou microfone indisponível."); }
  }

  private initWaveformVisualizer(stream: MediaStream) {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 64;
      source.connect(this.analyserNode);

      const bufferLength = this.analyserNode.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const bars = document.querySelectorAll(".vlm-wave-bar");

      const updateWave = () => {
        if (!this.analyserNode) return;
        this.analyserNode.getByteFrequencyData(dataArray);

        bars.forEach((bar, index) => {
          const sampleIdx = Math.floor((index / bars.length) * (bufferLength / 2));
          const val = dataArray[sampleIdx] || 0;
          // Escala de altura de 4px a 24px com sensibilidade natural
          const h = Math.max(4, Math.min(24, Math.floor((val / 255) * 24 * 1.5)));
          (bar as HTMLElement).style.height = `${h}px`;
        });

        this.waveformAnimFrame = requestAnimationFrame(updateWave);
      };

      updateWave();
    } catch (e) {
      console.warn("Waveform visualizer não inicializado:", e);
    }
  }

  private stopWaveformVisualizer() {
    if (this.waveformAnimFrame) {
      cancelAnimationFrame(this.waveformAnimFrame);
      this.waveformAnimFrame = null;
    }
    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.analyserNode = null;
  }

  private cancelAudioRecording() {
    if (this.recordTimer) clearInterval(this.recordTimer);
    this.stopWaveformVisualizer();
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    this.audioChunks = [];
    this.resetAudioUI();
  }

  private finishRecordingForPreview() {
    if (this.recordTimer) clearInterval(this.recordTimer);
    this.stopWaveformVisualizer();
    if (!this.mediaRecorder) return;

    this.mediaRecorder.onstop = () => {
      this.mediaRecorder?.stream.getTracks().forEach(t => t.stop());
      const mimeType = this.mediaRecorder?.mimeType || "audio/webm";
      this.recordedAudioBlob = new Blob(this.audioChunks, { type: mimeType });
      if (this.recordedAudioBlob.size < 500) {
        this.resetAudioUI();
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        this.recordedAudioDataUrl = (reader.result as string) || "";
        this.showAudioPreviewUI(this.recordedAudioDataUrl, this.recordingDurationSec);
      };
      reader.readAsDataURL(this.recordedAudioBlob);
    };

    if (this.mediaRecorder.state !== "inactive") this.mediaRecorder.stop();
  }

  private showAudioPreviewUI(dataUrl: string, durationSec: number) {
    document.getElementById("vlm-standard-input-row")!.style.display = "none";
    document.getElementById("vlm-audio-record-row")!.classList.remove("vlm-recording-active");
    const previewZone = document.getElementById("vlm-audio-preview-row")!;
    previewZone.classList.add("vlm-preview-active");

    const durElem = document.getElementById("vlm-preview-duration")!;
    durElem.textContent = formatDuration(durationSec);

    if (this.previewAudioElem) {
      this.previewAudioElem.pause();
    }
    this.previewAudioElem = new Audio(dataUrl);
    const fill = document.getElementById("vlm-preview-progressbar-fill")!;
    const playBtn = document.getElementById("vlm-btn-preview-play")!;

    fill.style.width = "0%";
    playBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

    this.previewAudioElem.addEventListener("timeupdate", () => {
      const dur = durationSec > 0 ? durationSec : (this.previewAudioElem?.duration || 1);
      const pct = Math.min(((this.previewAudioElem?.currentTime || 0) / dur) * 100, 100);
      fill.style.width = `${pct}%`;
    });

    this.previewAudioElem.addEventListener("ended", () => {
      playBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      fill.style.width = "0%";
    });
  }

  private togglePreviewAudioPlay() {
    if (!this.previewAudioElem) return;
    const playBtn = document.getElementById("vlm-btn-preview-play")!;
    if (this.previewAudioElem.paused) {
      this.previewAudioElem.play();
      playBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    } else {
      this.previewAudioElem.pause();
      playBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    }
  }

  private discardAudioPreview() {
    if (this.previewAudioElem) {
      this.previewAudioElem.pause();
      this.previewAudioElem = null;
    }
    this.recordedAudioBlob = null;
    this.recordedAudioDataUrl = "";
    this.resetAudioUI();
  }

  private sendRecordedAudioFromPreview() {
    if (!this.recordedAudioDataUrl) {
      this.resetAudioUI();
      return;
    }
    if (this.previewAudioElem) {
      this.previewAudioElem.pause();
      this.previewAudioElem = null;
    }
    const mimeType = this.recordedAudioBlob?.type || "audio/webm";
    const duration = this.recordingDurationSec;
    const dataUrl = this.recordedAudioDataUrl;

    this.resetAudioUI();
    this.sendAudioMessage(dataUrl, mimeType, duration);
  }

  private resetAudioUI() {
    document.getElementById("vlm-standard-input-row")!.style.display = "flex";
    document.getElementById("vlm-audio-record-row")!.classList.remove("vlm-recording-active");
    document.getElementById("vlm-audio-preview-row")!.classList.remove("vlm-preview-active");
    this.updateButtonsState();
  }

  private sendAudioMessage(dataUrl: string, mimeType: string, durationSec: number) {
    const msgId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    this.addMessage({
      id: msgId,
      sender: "visitor",
      text: "",
      contentType: "audio",
      mediaUrl: dataUrl,
      durationSec,
      timestamp: new Date().toISOString(),
      timeStr: formatTime(),
      fullDateStr: formatFullDate(),
    });

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.showTypingIndicator();
      this.ws.send(JSON.stringify({
        type: "visitor_audio",
        audioBase64: dataUrl,
        mimeType,
        durationSec,
        visitorName: this.visitorName,
        visitorDoc: this.visitorDoc,
        url: location.href,
        title: document.title,
      }));
    }
  }

  // ── Mídia & Anexos ────────────────────────────────────────────────────────

  private handleFileSelected(file: File) {
    if (file.size > 20 * 1024 * 1024) { alert("Arquivo muito grande. Limite máximo: 20MB."); return; }
    this.pendingFile = file;
    const bar = document.getElementById("vlm-attachment-preview-bar")!;
    const nameElem = document.getElementById("vlm-preview-filename")!;
    nameElem.textContent = `${file.name} (${formatFileSize(file.size)})`;
    bar.classList.add("vlm-preview-active");
    this.updateButtonsState();
  }

  private clearPendingFile() {
    this.pendingFile = null;
    const bar = document.getElementById("vlm-attachment-preview-bar")!;
    bar.classList.remove("vlm-preview-active");
    (document.getElementById("vlm-file-input") as HTMLInputElement).value = "";
    this.updateButtonsState();
  }

  private addMessage(msg: ChatMessage) {
    this.messages.push(msg);
    this.renderSingleMessage(msg);
    if (!this.isOpen && msg.sender !== "visitor") {
      this.unreadCount++;
      const badge = document.getElementById("vlm-fab-badge");
      if (badge) { badge.textContent = String(this.unreadCount); badge.style.display = "flex"; }
    }
  }

  private renderSingleMessage(msg: ChatMessage) {
    const container = document.getElementById("vlm-messages-container");
    if (!container) return;
    this.hideTypingIndicator();

    const prevMsg = this.messages[this.messages.length - 2];
    const isSameSenderAsPrev = prevMsg && prevMsg.sender === msg.sender;

    const row = document.createElement("div");
    row.className = `vlm-message-row vlm-message-row--${msg.sender} ${isSameSenderAsPrev ? "vlm-msg-consecutive" : "vlm-msg-first-in-group"}`;
    row.addEventListener("click", () => row.classList.toggle("vlm-details-visible"));
    
    let innerContent = "";
    if (msg.contentType === "audio" && msg.mediaUrl) {
      innerContent = this.renderAudioPlayer(msg.mediaUrl, msg.durationSec || 0);
    } else if (msg.contentType === "image" && msg.mediaUrl) {
      innerContent = `
        <img src="${msg.mediaUrl}" alt="${this.escapeHtml(msg.fileName || "Foto")}" class="vlm-media-image" onclick="window.open('${msg.mediaUrl}', '_blank')" />
        ${msg.text ? `<div style="margin-top:6px">${this.escapeAndFormat(msg.text)}</div>` : ""}
      `;
    } else if (msg.contentType === "video" && msg.mediaUrl) {
      innerContent = `
        <video src="${msg.mediaUrl}" controls playsinline class="vlm-media-video"></video>
        ${msg.text ? `<div style="margin-top:6px">${this.escapeAndFormat(msg.text)}</div>` : ""}
      `;
    } else if (msg.contentType === "document" && msg.mediaUrl) {
      const icon = getFileSvgIcon(msg.fileName || "");
      innerContent = `
        <a href="${msg.mediaUrl}" download="${this.escapeHtml(msg.fileName || "arquivo")}" class="vlm-media-file-card" target="_blank">
          <span class="vlm-media-file-icon">${icon}</span>
          <div class="vlm-media-file-info">
            <span class="vlm-media-file-name" title="${this.escapeHtml(msg.fileName || "Download")}">${this.escapeHtml(msg.fileName || "Download")}</span>
            <span class="vlm-media-file-size">${formatFileSize(msg.fileSize)} • Baixar</span>
          </div>
        </a>
        ${msg.text ? `<div style="margin-top:6px">${this.escapeAndFormat(msg.text)}</div>` : ""}
      `;
    } else {
      innerContent = this.escapeAndFormat(msg.text);
    }

    row.innerHTML = `<div class="vlm-bubble-box">${innerContent}</div><span class="vlm-msg-details">Enviado em ${msg.fullDateStr}</span>`;
    container.appendChild(row);
    if (msg.contentType === "audio") this.attachAudioPlayerEvents(row);
    this.scrollToBottom();
  }

  private renderAudioPlayer(src: string, durationSec: number): string {
    const durStr = durationSec > 0 ? formatDuration(durationSec) : "0:05";
    return `
      <div class="vlm-audio-player" data-audio-src="${src}" data-fallback-sec="${durationSec || 5}">
        <button class="vlm-audio-btn-play" aria-label="Tocar áudio">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </button>
        <div class="vlm-audio-track">
          <div class="vlm-audio-progressbar-bg">
            <div class="vlm-audio-progressbar-fill"></div>
          </div>
          <div class="vlm-audio-time-row">
            <span class="vlm-audio-time-curr">0:00</span>
            <span class="vlm-audio-time-total">${durStr}</span>
          </div>
        </div>
        <button class="vlm-audio-speed-btn">1x</button>
        <audio src="${src}" preload="metadata" style="display:none"></audio>
      </div>
    `;
  }

  private attachAudioPlayerEvents(row: HTMLElement) {
    const player = row.querySelector(".vlm-audio-player") as HTMLElement;
    if (!player) return;
    const audio = player.querySelector("audio") as HTMLAudioElement;
    const playBtn = player.querySelector(".vlm-audio-btn-play") as HTMLButtonElement;
    const fill = player.querySelector(".vlm-audio-progressbar-fill") as HTMLElement;
    const currTime = player.querySelector(".vlm-audio-time-curr") as HTMLElement;
    const totalTime = player.querySelector(".vlm-audio-time-total") as HTMLElement;
    const speedBtn = player.querySelector(".vlm-audio-speed-btn") as HTMLButtonElement;
    const progressBg = player.querySelector(".vlm-audio-progressbar-bg") as HTMLElement;
    const fallbackSec = parseFloat(player.getAttribute("data-fallback-sec") || "5");

    const getRealDuration = () => {
      if (audio.duration && isFinite(audio.duration) && !isNaN(audio.duration) && audio.duration > 0) {
        return audio.duration;
      }
      return fallbackSec > 0 ? fallbackSec : 5;
    };

    audio.addEventListener("loadedmetadata", () => {
      const dur = getRealDuration();
      totalTime.textContent = formatDuration(dur);
    });

    audio.addEventListener("durationchange", () => {
      const dur = getRealDuration();
      totalTime.textContent = formatDuration(dur);
    });

    playBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (audio.paused) {
        document.querySelectorAll("audio").forEach(a => { if (a !== audio) a.pause(); });
        audio.play().then(() => {
          playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
        }).catch(() => {});
      } else {
        audio.pause();
        playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      }
    });

    audio.addEventListener("timeupdate", () => {
      const dur = getRealDuration();
      const pct = Math.min((audio.currentTime / dur) * 100, 100);
      fill.style.width = `${pct}%`;
      currTime.textContent = formatDuration(audio.currentTime);
    });

    audio.addEventListener("ended", () => {
      playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      fill.style.width = "0%";
      currTime.textContent = "0:00";
    });

    progressBg.addEventListener("click", (e) => {
      e.stopPropagation();
      const rect = progressBg.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      const dur = getRealDuration();
      audio.currentTime = pct * dur;
    });

    let currentSpeed = 1;
    speedBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (currentSpeed === 1) currentSpeed = 1.5;
      else if (currentSpeed === 1.5) currentSpeed = 2;
      else currentSpeed = 1;
      audio.playbackRate = currentSpeed;
      speedBtn.textContent = `${currentSpeed}x`;
    });
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
      <img src="${this.opts.avatarUrl}" alt="Valentina" class="vlm-typing-avatar" id="vlm-typing-avatar-btn" />
      <div class="vlm-typing-bubble">
        <span class="vlm-typing-dot"></span>
        <span class="vlm-typing-dot"></span>
        <span class="vlm-typing-dot"></span>
      </div>
    `;
    container.appendChild(row);
    row.querySelector("#vlm-typing-avatar-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      document.getElementById("vlm-avatar-lightbox")?.classList.add("vlm-lightbox-open");
    });
    this.scrollToBottom();
  }

  private hideTypingIndicator() {
    this.isTyping = false;
    document.getElementById("vlm-typing-indicator")?.remove();
  }

  private scrollToBottom() {
    const container = document.getElementById("vlm-messages-container");
    if (container) {
      setTimeout(() => { container.scrollTop = container.scrollHeight; }, 30);
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private escapeAndFormat(text: string): string {
    if (!text) return "";
    const cleanText = text
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "")
      .trim();
    return this.escapeHtml(cleanText)
      .replace(/\n/g, "<br>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  }

  private handleSendMessage() {
    const textarea = document.getElementById("vlm-chat-textarea") as HTMLTextAreaElement;
    const text = textarea ? textarea.value.trim() : "";
    const file = this.pendingFile;

    if (!text && !file) return;

    if (textarea) {
      textarea.value = "";
      textarea.style.height = "20px";
    }

    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Data = (reader.result as string) || "";
        const isImg = file.type.startsWith("image/");
        const isVid = file.type.startsWith("video/");
        const contentType = isImg ? "image" : isVid ? "video" : "document";
        const msgId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());

        this.addMessage({
          id: msgId,
          sender: "visitor",
          text,
          contentType,
          mediaUrl: base64Data,
          fileName: file.name,
          fileSize: file.size,
          timestamp: new Date().toISOString(),
          timeStr: formatTime(),
          fullDateStr: formatFullDate(),
        });

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.showTypingIndicator();
          this.ws.send(JSON.stringify({
            type: "visitor_media",
            fileBase64: base64Data,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            text,
            visitorName: this.visitorName,
            visitorDoc: this.visitorDoc,
            url: location.href,
            title: document.title,
          }));
        }

        this.clearPendingFile();
        this.updateButtonsState();
      };
      reader.readAsDataURL(file);
      return;
    }

    const msgId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    this.addMessage({
      id: msgId,
      sender: "visitor",
      text,
      contentType: "text",
      timestamp: new Date().toISOString(),
      timeStr: formatTime(),
      fullDateStr: formatFullDate(),
    });

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.showTypingIndicator();
      this.ws.send(JSON.stringify({
        type: "visitor_message",
        text,
        messageId: msgId,
        visitorName: this.visitorName,
        visitorDoc: this.visitorDoc,
        url: location.href,
        title: document.title,
      }));
    } else {
      this.addMessage({
        id: `err-${Date.now()}`,
        sender: "system",
        text: "Conexão perdida. Tentando restabelecer...",
        timestamp: new Date().toISOString(),
        timeStr: formatTime(),
        fullDateStr: formatFullDate(),
      });
      this.connectWebSocket();
    }

    this.updateButtonsState();
  }

  private updateButtonsState() {
    const textarea = document.getElementById("vlm-chat-textarea") as HTMLTextAreaElement;
    const iconMic = document.getElementById("vlm-icon-mic");
    const iconSend = document.getElementById("vlm-icon-send");
    const btnAction = document.getElementById("vlm-btn-action-main");
    if (!iconMic || !iconSend || !btnAction) return;

    const hasText = textarea ? textarea.value.trim().length > 0 : false;
    const hasFile = this.pendingFile !== null;

    if (hasText || hasFile) {
      iconMic.style.display = "none";
      iconSend.style.display = "block";
      btnAction.setAttribute("title", "Enviar mensagem");
    } else {
      iconMic.style.display = "block";
      iconSend.style.display = "none";
      btnAction.setAttribute("title", "Gravar áudio");
    }
  }

  private connectWebSocket() {
    if (this.opts.mock) return;
    const url = `${this.opts.wsUrl}?tenantId=${this.opts.tenant}&cookieId=${this.cookieId}&name=${encodeURIComponent(this.visitorName)}&doc=${encodeURIComponent(this.visitorDoc)}&currentUrl=${encodeURIComponent(location.href)}&currentTitle=${encodeURIComponent(document.title)}`;
    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        if (this.hasCompletedPrechat) this.notifyVisitorDataToBackend();
      };
      this.ws.onmessage = (event) => { try { this.handleIncomingPayload(JSON.parse(event.data)); } catch (e) {} };
      this.ws.onclose = () => this.scheduleReconnect();
    } catch (e) { this.scheduleReconnect(); }
  }

  private handleIncomingPayload(payload: any) {
    const { type } = payload;
    if (type === "message" || type === "ai_message" || type === "operator_message") {
      this.hideTypingIndicator();
      this.addMessage({
        id: payload.messageId || crypto.randomUUID?.() || String(Date.now()),
        sender: (payload.sender === "operator" || type === "operator_message") ? "operator" : "ai",
        text: payload.content || payload.text || "",
        contentType: payload.contentType || "text",
        mediaUrl: payload.mediaUrl,
        fileName: payload.fileName,
        timestamp: new Date().toISOString(),
        timeStr: formatTime(),
        fullDateStr: formatFullDate(),
      });
    }
    if (type === "typing") payload.isTyping ? this.showTypingIndicator() : this.hideTypingIndicator();
    if (type === "bridge_initiated" || type === "bridge_sent") {
      this.hideTypingIndicator();
      this.addMessage({ id: `bridge-${Date.now()}`, sender: "system", text: "📱 **Atendimento transferido para o WhatsApp!** Nossa equipe comercial já recebeu suas informações e responderá por lá. Fique de olho no seu app!", timestamp: new Date().toISOString(), timeStr: formatTime(), fullDateStr: formatFullDate() });
    }
    if (type === "chat_closed") {
      this.hideTypingIndicator();
      this.addMessage({
        id: `closed-${Date.now()}`,
        sender: "system",
        text: "Atendimento finalizado. Agradecemos o contato com a Valem Pack!",
        timestamp: new Date().toISOString(),
        timeStr: formatTime(),
        fullDateStr: formatFullDate(),
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