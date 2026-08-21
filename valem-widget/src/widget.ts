// ══════════════════════════════════════════════════════════════════════════════
// 💬 VALEM CHAT WIDGET — Valentina Live Chat (Valempack Store Engine)
// Áudio · Anexos · Player Custom · Timestamps ao Clicar · Paleta Oficial
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
  
  // Mídia & Áudio
  private pendingFile: File | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private recordStartTime = 0;
  private recordTimer: ReturnType<typeof setInterval> | null = null;
  private recordingDurationSec = 0;

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

  mount() {
    this.injectDOM();
    this.startPillAnimationLoop();
    this.connectWebSocket();
    this.startPageviewTracking();
  }

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

    <div id="vlm-panel" aria-hidden="true">
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
      <div id="vlm-input-zone">
        <div id="vlm-attachment-preview-bar">
          <div class="vlm-preview-chip">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span id="vlm-preview-filename">arquivo.pdf</span>
          </div>
          <button id="vlm-btn-remove-attachment" class="vlm-preview-remove-btn" title="Remover anexo">✕</button>
        </div>
        <div id="vlm-standard-input-row" class="vlm-input-row">
          <input type="file" id="vlm-file-input" style="display:none" accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.csv,.txt" />
          <button id="vlm-btn-attach" class="vlm-btn-clip" title="Anexar foto, vídeo, documento ou planilha" aria-label="Anexar arquivo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          </button>
          <div class="vlm-textarea-wrap">
            <textarea id="vlm-chat-textarea" rows="1" placeholder="Digite sua mensagem..." autocomplete="off" maxlength="1500"></textarea>
          </div>
          <button id="vlm-btn-mic" class="vlm-btn-action-circle" title="Gravar áudio" aria-label="Gravar áudio">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          </button>
          <button id="vlm-btn-send" class="vlm-btn-action-circle" style="display:none" title="Enviar mensagem" aria-label="Enviar mensagem">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
        <div id="vlm-audio-record-row" class="vlm-audio-record-zone">
          <div class="vlm-rec-indicator">
            <span class="vlm-rec-dot"></span>
            <span id="vlm-rec-timer">00:00</span>
          </div>
          <div class="vlm-rec-actions">
            <button id="vlm-btn-rec-cancel" class="vlm-btn-rec-cancel" title="Cancelar gravação"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            <button id="vlm-btn-rec-send" class="vlm-btn-rec-send" title="Enviar áudio"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></button>
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
    const btnSend = document.getElementById("vlm-btn-send")!;
    const btnMic = document.getElementById("vlm-btn-mic")!;
    const btnAttach = document.getElementById("vlm-btn-attach")!;
    const fileInput = document.getElementById("vlm-file-input") as HTMLInputElement;
    const btnRemoveAtt = document.getElementById("vlm-btn-remove-attachment")!;
    const btnRecCancel = document.getElementById("vlm-btn-rec-cancel")!;
    const btnRecSend = document.getElementById("vlm-btn-rec-send")!;
    const textarea = document.getElementById("vlm-chat-textarea") as HTMLTextAreaElement;

    fabButton.addEventListener("mouseenter", () => { this.isHoveringFab = true; this.setPillState(true); });
    fabButton.addEventListener("mouseleave", () => { this.isHoveringFab = false; });
    fabButton.addEventListener("click", () => this.togglePanel());
    btnClose.addEventListener("click", () => this.closePanel());
    btnCopy.addEventListener("click", () => this.copyConversation());
    btnSend.addEventListener("click", () => this.handleSendMessage());

    textarea.addEventListener("input", () => {
      textarea.style.height = "auto";
      const nextH = Math.min(textarea.scrollHeight, 110);
      textarea.style.height = `${Math.max(nextH, 22)}px`;
      this.updateButtonsState();
    });

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.handleSendMessage(); }
    });

    btnMic.addEventListener("click", () => this.startAudioRecording());
    btnRecCancel.addEventListener("click", () => this.cancelAudioRecording());
    btnRecSend.addEventListener("click", () => this.stopAndSendAudioRecording());
    btnAttach.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => { if (fileInput.files && fileInput.files[0]) this.handleFileSelected(fileInput.files[0]); });
    btnRemoveAtt.addEventListener("click", () => this.clearPendingFile());
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
    this.scrollToBottom();
    setTimeout(() => { (document.getElementById("vlm-chat-textarea") as HTMLTextAreaElement)?.focus(); }, 200);
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

  private copyConversation() {
    if (this.messages.length === 0) return;
    const transcript = this.messages.map(m => {
      const sender = m.sender === "visitor" ? "Você" : m.sender === "ai" ? "Valentina (Valem)" : "Operador";
      const content = m.text || (m.fileName ? `[Arquivo: ${m.fileName}]` : "[Áudio]");
      return `[${m.timeStr}] ${sender}:\n${content}\n`;
    }).join("\n");
    const header = `--- Atendimento Valem Pack ---\nData: ${new Date().toLocaleDateString("pt-BR")}\n\n`;
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
      document.getElementById("vlm-standard-input-row")!.style.display = "none";
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
    } catch (err) { alert("Permissão de microfone negada ou indisponível."); }
  }

  private cancelAudioRecording() {
    if (this.recordTimer) clearInterval(this.recordTimer);
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    this.audioChunks = [];
    this.resetAudioRecordUI();
  }

  private stopAndSendAudioRecording() {
    if (this.recordTimer) clearInterval(this.recordTimer);
    if (!this.mediaRecorder) return;
    this.mediaRecorder.onstop = async () => {
      this.mediaRecorder?.stream.getTracks().forEach(t => t.stop());
      const mimeType = this.mediaRecorder?.mimeType || "audio/webm";
      const audioBlob = new Blob(this.audioChunks, { type: mimeType });
      if (audioBlob.size < 1000) { this.resetAudioRecordUI(); return; }
      const reader = new FileReader();
      reader.onloadend = () => { this.sendAudioMessage((reader.result as string) || "", mimeType, this.recordingDurationSec); };
      reader.readAsDataURL(audioBlob);
      this.resetAudioRecordUI();
    };
    if (this.mediaRecorder.state !== "inactive") this.mediaRecorder.stop();
  }

  private resetAudioRecordUI() {
    document.getElementById("vlm-standard-input-row")!.style.display = "flex";
    const recZone = document.getElementById("vlm-audio-record-row")!;
    recZone.classList.remove("vlm-recording-active");
  }

  private sendAudioMessage(dataUrl: string, mimeType: string, durationSec: number) {
    const msgId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    this.addMessage({ id: msgId, sender: "visitor", text: "", contentType: "audio", mediaUrl: dataUrl, durationSec, timestamp: new Date().toISOString(), timeStr: formatTime(), fullDateStr: formatFullDate() });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.showTypingIndicator();
      this.ws.send(JSON.stringify({ type: "visitor_audio", audioBase64: dataUrl, mimeType, durationSec, url: location.href, title: document.title }));
    }
  }

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
    const row = document.createElement("div");
    row.className = `vlm-message-row vlm-message-row--${msg.sender}`;
    row.addEventListener("click", () => row.classList.toggle("vlm-details-visible"));
    let innerContent = "";
    if (msg.contentType === "audio" && msg.mediaUrl) innerContent = this.renderAudioPlayer(msg.mediaUrl, msg.durationSec || 0);
    else if (msg.contentType === "image" && msg.mediaUrl) innerContent = `<img src="${msg.mediaUrl}" alt="${msg.fileName || "Foto"}" class="vlm-media-image" />${msg.text ? `<div style="margin-top:6px">${this.escapeAndFormat(msg.text)}</div>` : ""}`;
    else if (msg.contentType === "document" && msg.mediaUrl) innerContent = `<a href="${msg.mediaUrl}" download="${msg.fileName || "arquivo"}" class="vlm-media-file-card" target="_blank"><div class="vlm-media-file-icon">📁</div><div class="vlm-media-file-info"><span class="vlm-media-file-name">${this.escapeHtml(msg.fileName || "Download")}</span><span class="vlm-media-file-size">${formatFileSize(msg.fileSize)} • Baixar</span></div></a>`;
    else innerContent = this.escapeAndFormat(msg.text);
    row.innerHTML = `<div class="vlm-bubble-box">${innerContent}</div><span class="vlm-msg-details">Enviado em ${msg.fullDateStr}</span>`;
    container.appendChild(row);
    if (msg.contentType === "audio") this.attachAudioPlayerEvents(row);
    this.scrollToBottom();
  }

  private renderAudioPlayer(src: string, durationSec: number): string {
    const durStr = formatDuration(durationSec);
    return `<div class="vlm-audio-player" data-audio-src="${src}"><button class="vlm-audio-btn-play" aria-label="Tocar áudio"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></button><div class="vlm-audio-track"><div class="vlm-audio-progressbar-bg"><div class="vlm-audio-progressbar-fill"></div></div><div class="vlm-audio-time-row"><span class="vlm-audio-time-curr">0:00</span><span class="vlm-audio-time-total">${durStr}</span></div></div><button class="vlm-audio-speed-btn">1x</button><audio src="${src}" preload="metadata" style="display:none"></audio></div>`;
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
    audio.addEventListener("loadedmetadata", () => { if (audio.duration && !isNaN(audio.duration)) totalTime.textContent = formatDuration(audio.duration); });
    playBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (audio.paused) { document.querySelectorAll("audio").forEach(a => { if (a !== audio) a.pause(); }); audio.play(); playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`; }
      else { audio.pause(); playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`; }
    });
    audio.addEventListener("timeupdate", () => { const pct = (audio.currentTime / (audio.duration || 1)) * 100; fill.style.width = `${pct}%`; currTime.textContent = formatDuration(audio.currentTime); });
    audio.addEventListener("ended", () => { playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`; fill.style.width = "0%"; currTime.textContent = "0:00"; });
    progressBg.addEventListener("click", (e) => { e.stopPropagation(); const rect = progressBg.getBoundingClientRect(); const pct = (e.clientX - rect.left) / rect.width; audio.currentTime = pct * (audio.duration || 1); });
    let currentSpeed = 1;
    speedBtn.addEventListener("click", (e) => { e.stopPropagation(); if (currentSpeed === 1) currentSpeed = 1.5; else if (currentSpeed === 1.5) currentSpeed = 2; else currentSpeed = 1; audio.playbackRate = currentSpeed; speedBtn.textContent = `${currentSpeed}x`; });
  }

  private showTypingIndicator() {
    if (this.isTyping) return;
    this.isTyping = true;
    const container = document.getElementById("vlm-messages-container");
    if (!container) return;
    const row = document.createElement("div"); row.id = "vlm-typing-indicator"; row.className = "vlm-typing-row";
    row.innerHTML = `<img src="${this.opts.avatarUrl}" alt="Valentina" class="vlm-typing-avatar" /><div class="vlm-typing-bubble"><span class="vlm-typing-dot"></span><span class="vlm-typing-dot"></span><span class="vlm-typing-dot"></span></div>`;
    container.appendChild(row); this.scrollToBottom();
  }

  private hideTypingIndicator() { this.isTyping = false; document.getElementById("vlm-typing-indicator")?.remove(); }

  private scrollToBottom() {
    const container = document.getElementById("vlm-messages-container");
    if (container) setTimeout(() => { container.scrollTop = container.scrollHeight; }, 30);
  }

  private escapeHtml(str: string): string { return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  private escapeAndFormat(text: string): string { return this.escapeHtml(text).replace(/\n/g, "<br>").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"); }

  private handleSendMessage() {
    const textarea = document.getElementById("vlm-chat-textarea") as HTMLTextAreaElement;
    const text = textarea ? textarea.value.trim() : "";
    const file = this.pendingFile;
    if (!text && !file) return;
    if (textarea) { textarea.value = ""; textarea.style.height = "22px"; }
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Data = (reader.result as string) || "";
        const isImg = file.type.startsWith("image/");
        const isVid = file.type.startsWith("video/");
        const contentType = isImg ? "image" : isVid ? "video" : "document";
        const msgId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
        this.addMessage({ id: msgId, sender: "visitor", text, contentType, mediaUrl: base64Data, fileName: file.name, fileSize: file.size, timestamp: new Date().toISOString(), timeStr: formatTime(), fullDateStr: formatFullDate() });
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.showTypingIndicator();
          this.ws.send(JSON.stringify({ type: "visitor_media", fileBase64: base64Data, fileName: file.name, fileType: file.type, fileSize: file.size, text, url: location.href, title: document.title }));
        }
        this.clearPendingFile(); this.updateButtonsState();
      };
      reader.readAsDataURL(file); return;
    }
    const msgId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    this.addMessage({ id: msgId, sender: "visitor", text, contentType: "text", timestamp: new Date().toISOString(), timeStr: formatTime(), fullDateStr: formatFullDate() });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.showTypingIndicator();
      this.ws.send(JSON.stringify({ type: "visitor_message", text, messageId: msgId, url: location.href, title: document.title }));
    } else {
      this.addMessage({ id: `err-${Date.now()}`, sender: "system", text: "Conexão perdida. Tentando restabelecer...", timestamp: new Date().toISOString(), timeStr: formatTime(), fullDateStr: formatFullDate() });
      this.connectWebSocket();
    }
    this.updateButtonsState();
  }

  private updateButtonsState() {
    const textarea = document.getElementById("vlm-chat-textarea") as HTMLTextAreaElement;
    const btnMic = document.getElementById("vlm-btn-mic");
    const btnSend = document.getElementById("vlm-btn-send");
    if (!btnMic || !btnSend) return;
    const hasText = textarea ? textarea.value.trim().length > 0 : false;
    const hasFile = this.pendingFile !== null;
    if (hasText || hasFile) { btnMic.style.display = "none"; btnSend.style.display = "flex"; }
    else { btnMic.style.display = "flex"; btnSend.style.display = "none"; }
  }

  private connectWebSocket() {
    if (this.opts.mock) return;
    const url = `${this.opts.wsUrl}?tenantId=${this.opts.tenant}&cookieId=${this.cookieId}&currentUrl=${encodeURIComponent(location.href)}&currentTitle=${encodeURIComponent(document.title)}`;
    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => { this.reconnectAttempts = 0; };
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
      this.addMessage({ id: `bridge-${Date.now()}`, sender: "system", text: "📱 **Atendimento transferido para o WhatsApp!** Nossa equipe comercial já recebeu suas informações e responderá por lá. Fique de olho no seu app! 😊", timestamp: new Date().toISOString(), timeStr: formatTime(), fullDateStr: formatFullDate() });
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