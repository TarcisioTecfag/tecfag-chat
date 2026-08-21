(function(){"use strict";function f(s=new Date){return s.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}function y(s=new Date){const e=s.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric"}),t=s.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",second:"2-digit"});return`${e} às ${t}`}function S(s=0){return s<1024?`${s} B`:s<1024*1024?`${(s/1024).toFixed(1)} KB`:`${(s/(1024*1024)).toFixed(1)} MB`}function b(s=0){const e=Math.floor(s/60),t=Math.floor(s%60);return`${e}:${t<10?"0":""}${t}`}function T(){const s=new Date().getHours();return s>=5&&s<12?"Bom dia":s>=12&&s<18?"Boa tarde":"Boa noite"}function A(s){const e=s.replace(/\D/g,"");if(e.length!==11||/^(\d)\1{10}$/.test(e))return!1;let t=0,i=0;for(let n=1;n<=9;n++)t+=parseInt(e[n-1])*(11-n);if(i=t*10%11,(i===10||i===11)&&(i=0),i!==parseInt(e[9]))return!1;t=0;for(let n=1;n<=10;n++)t+=parseInt(e[n-1])*(12-n);return i=t*10%11,(i===10||i===11)&&(i=0),i===parseInt(e[10])}function C(s){const e=s.replace(/\D/g,"");if(e.length!==14||/^(\d)\1{13}$/.test(e))return!1;let t=e.length-2,i=e.substring(0,t);const n=e.substring(t);let o=0,a=t-7;for(let r=t;r>=1;r--)o+=parseInt(i.charAt(t-r))*a--,a<2&&(a=9);let l=o%11<2?0:11-o%11;if(l!==parseInt(n.charAt(0)))return!1;t+=1,i=e.substring(0,t),o=0,a=t-7;for(let r=t;r>=1;r--)o+=parseInt(i.charAt(t-r))*a--,a<2&&(a=9);return l=o%11<2?0:11-o%11,l===parseInt(n.charAt(1))}function D(s){const e=s.replace(/\D/g,"").slice(0,14);return e.length<=11?e.replace(/^(\d{3})(\d)/,"$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/,"$1.$2.$3").replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/,"$1.$2.$3-$4"):e.replace(/^(\d{2})(\d)/,"$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/,"$1.$2.$3").replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/,"$1.$2.$3/$4").replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/,"$1.$2.$3/$4-$5")}function L(){const s="valem_visitor_id";try{let e=localStorage.getItem(s);return e||(e=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2,9)}`,localStorage.setItem(s,e)),e}catch{return`${Date.now()}-${Math.random().toString(36).slice(2,9)}`}}function $(s){const e=(s.split(".").pop()||"").toLowerCase();return["xlsx","xls","csv"].includes(e)?`
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="8" y1="13" x2="16" y2="13"/>
        <line x1="8" y1="17" x2="16" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    `:["pdf"].includes(e)?`
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <path d="M9 15h6"/>
        <path d="M9 11h6"/>
      </svg>
    `:["doc","docx","txt","rtf"].includes(e)?`
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    `:["zip","rar","7z","tar","gz"].includes(e)?`
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        <line x1="12" y1="11" x2="12" y2="17"/>
        <line x1="9" y1="14" x2="15" y2="14"/>
      </svg>
    `:`
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  `}class P{constructor(e={}){this.ws=null,this.messages=[],this.isOpen=!1,this.isPillExpanded=!0,this.unreadCount=0,this.isTyping=!1,this.reconnectAttempts=0,this.reconnectTimer=null,this.pageviewInterval=null,this.pillLoopTimer=null,this.isHoveringFab=!1,this.pendingFile=null,this.visitorName="",this.visitorDoc="",this.hasCompletedPrechat=!1,this.hasSentWelcomeSequence=!1,this.mediaRecorder=null,this.audioChunks=[],this.recordStartTime=0,this.recordTimer=null,this.recordingDurationSec=0,this.recordedAudioBlob=null,this.recordedAudioDataUrl="",this.previewAudioElem=null,this.audioContext=null,this.analyserNode=null,this.waveformAnimFrame=null,this.isDragging=!1,this.dragStartX=0,this.dragStartY=0,this.panelInitialLeft=0,this.panelInitialTop=0;const t=document.currentScript,i=t?t.dataset:{};this.opts={tenant:e.tenant||i.tenant||"valem",wsUrl:e.wsUrl||i.ws||`ws://${location.host}/ws/livechat`,avatarUrl:e.avatarUrl||i.avatar||"/valentina-avatar.png",whatsappNumber:e.whatsappNumber||i.whatsapp||"5514981468232",mock:e.mock!==void 0?e.mock:i.mock==="true"},this.cookieId=L(),this.loadSavedVisitorData(),this.init()}loadSavedVisitorData(){try{this.visitorName=localStorage.getItem("valem_visitor_name")||"",this.visitorDoc=localStorage.getItem("valem_visitor_doc")||"",this.visitorName&&this.visitorDoc&&(this.hasCompletedPrechat=!0)}catch{}}saveVisitorData(e,t){this.visitorName=e.trim(),this.visitorDoc=t.trim(),this.hasCompletedPrechat=!0;try{localStorage.setItem("valem_visitor_name",this.visitorName),localStorage.setItem("valem_visitor_doc",this.visitorDoc)}catch{}}init(){this.injectDOM(),this.connectWebSocket(),this.startPageviewTracking(),this.startPillAnimationLoop()}injectDOM(){const e=document.createElement("div");e.id="vlm-chat-root",e.innerHTML=this.renderHTML(),document.body.appendChild(e),this.bindEvents(),this.initDraggable()}renderHTML(){const e=this.opts.avatarUrl;return`
    <!-- BOTÃO FLUTUANTE PILL -->
    <div id="vlm-fab-wrapper">
      <button id="vlm-fab-button" class="vlm-pill-expanded" aria-label="Falar com Valentina">
        <div class="vlm-pill-content">
          <div class="vlm-fab-avatar-wrap">
            <img src="${e}" alt="Valentina" class="vlm-fab-avatar-img" />
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
        <img src="${e}" alt="Valentina" class="vlm-lightbox-img" />
        <span class="vlm-lightbox-name">Valentina</span>
        <span class="vlm-lightbox-role">Consultora Comercial • Valem Pack</span>
      </div>
    </div>

    <!-- PAINEL PRINCIPAL DO CHAT (DRAGGABLE) -->
    <div id="vlm-panel" aria-hidden="true">

      <!-- TELA 1: PRE-CHAT ONBOARDING (NOME + CPF/CNPJ) -->
      <div id="vlm-prechat-view" class="${this.hasCompletedPrechat?"vlm-prechat-hidden":""}">
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
            <img src="${e}" alt="Valentina" class="vlm-header-avatar-img" />
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
            ${Array.from({length:18}).map(()=>'<span class="vlm-wave-bar"></span>').join("")}
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
    `}bindEvents(){const e=document.getElementById("vlm-fab-button"),t=document.getElementById("vlm-btn-close"),i=document.getElementById("vlm-btn-copy-dialog"),n=document.getElementById("vlm-btn-action-main"),o=document.getElementById("vlm-btn-attach"),a=document.getElementById("vlm-file-input"),l=document.getElementById("vlm-btn-remove-attachment"),r=document.getElementById("vlm-btn-rec-cancel"),v=document.getElementById("vlm-btn-rec-finish"),m=document.getElementById("vlm-chat-textarea"),u=document.getElementById("vlm-prechat-form"),h=document.getElementById("vlm-input-name"),d=document.getElementById("vlm-input-doc"),p=document.getElementById("vlm-doc-error"),w=document.getElementById("vlm-btn-start-chat"),I=document.getElementById("vlm-btn-prechat-close"),M=document.getElementById("vlm-header-avatar-btn"),E=document.getElementById("vlm-avatar-lightbox"),N=document.getElementById("vlm-btn-close-lightbox"),U=document.getElementById("vlm-btn-preview-play"),F=document.getElementById("vlm-btn-preview-trash"),V=document.getElementById("vlm-btn-preview-send"),B=()=>{const c=h.value.trim(),g=d.value.replace(/\D/g,""),x=g.length===11?A(g):g.length===14?C(g):!1;g.length>0&&!x&&(g.length===11||g.length===14)?(d.classList.add("vlm-input-error"),p.classList.add("vlm-show-error")):(d.classList.remove("vlm-input-error"),p.classList.remove("vlm-show-error")),c.length>=2&&x?w.removeAttribute("disabled"):w.setAttribute("disabled","true")};h.addEventListener("input",B),d.addEventListener("input",()=>{d.value=D(d.value),B()}),u.addEventListener("submit",c=>{c.preventDefault();const g=h.value.trim(),x=d.value.trim();!g||!x||(this.saveVisitorData(g,x),document.getElementById("vlm-prechat-view")?.classList.add("vlm-prechat-hidden"),this.notifyVisitorDataToBackend(),this.triggerWelcomeSequence())}),I.addEventListener("click",()=>this.closePanel());const R=()=>{E.classList.add("vlm-lightbox-open")},k=()=>{E.classList.remove("vlm-lightbox-open")};M.addEventListener("click",c=>{c.stopPropagation(),R()}),N.addEventListener("click",c=>{c.stopPropagation(),k()}),E.addEventListener("click",c=>{c.target===E&&k()}),e.addEventListener("mouseenter",()=>{this.isHoveringFab=!0,this.setPillState(!0)}),e.addEventListener("mouseleave",()=>{this.isHoveringFab=!1}),e.addEventListener("click",()=>this.togglePanel()),t.addEventListener("click",c=>{c.stopPropagation(),this.closePanel()}),i.addEventListener("click",c=>{c.stopPropagation(),this.copyConversation()}),n.addEventListener("click",()=>{const c=m.value.trim().length>0,g=this.pendingFile!==null;c||g?this.handleSendMessage():this.startAudioRecording()}),m.addEventListener("input",()=>{m.style.height="20px";const c=Math.min(Math.max(m.scrollHeight,20),100);m.style.height=`${c}px`,this.updateButtonsState()}),m.addEventListener("keydown",c=>{c.key==="Enter"&&!c.shiftKey&&(c.preventDefault(),this.handleSendMessage())}),r.addEventListener("click",()=>this.cancelAudioRecording()),v.addEventListener("click",()=>this.finishRecordingForPreview()),U.addEventListener("click",()=>this.togglePreviewAudioPlay()),F.addEventListener("click",()=>this.discardAudioPreview()),V.addEventListener("click",()=>this.sendRecordedAudioFromPreview()),o.addEventListener("click",()=>a.click()),a.addEventListener("change",()=>{a.files&&a.files[0]&&this.handleFileSelected(a.files[0])}),l.addEventListener("click",()=>this.clearPendingFile())}initDraggable(){const e=document.getElementById("vlm-header"),t=document.getElementById("vlm-panel");if(!e||!t)return;const i=(a,l,r)=>{if(r?.closest("button, a, input, textarea, .vlm-header-avatar-wrap"))return;this.isDragging=!0,this.dragStartX=a,this.dragStartY=l;const v=t.getBoundingClientRect();this.panelInitialLeft=v.left,this.panelInitialTop=v.top,t.style.bottom="auto",t.style.right="auto",t.style.left=`${this.panelInitialLeft}px`,t.style.top=`${this.panelInitialTop}px`,t.classList.add("vlm-is-dragging")},n=(a,l)=>{if(!this.isDragging)return;const r=a-this.dragStartX,v=l-this.dragStartY;let m=this.panelInitialLeft+r,u=this.panelInitialTop+v;const h=10,d=window.innerWidth-t.offsetWidth-10,p=10,w=window.innerHeight-t.offsetHeight-10;m=Math.max(h,Math.min(d,m)),u=Math.max(p,Math.min(w,u)),t.style.left=`${m}px`,t.style.top=`${u}px`},o=()=>{this.isDragging&&(this.isDragging=!1,t.classList.remove("vlm-is-dragging"))};e.addEventListener("mousedown",a=>i(a.clientX,a.clientY,a.target)),window.addEventListener("mousemove",a=>n(a.clientX,a.clientY)),window.addEventListener("mouseup",o),e.addEventListener("touchstart",a=>{a.touches.length===1&&i(a.touches[0].clientX,a.touches[0].clientY,a.target)},{passive:!0}),window.addEventListener("touchmove",a=>{this.isDragging&&a.touches.length===1&&n(a.touches[0].clientX,a.touches[0].clientY)},{passive:!0}),window.addEventListener("touchend",o)}startPillAnimationLoop(){let e=0;this.pillLoopTimer=setInterval(()=>{this.isOpen||this.isHoveringFab||(e=(e+1)%2,this.setPillState(e===0))},6e3)}setPillState(e){this.isPillExpanded=e;const t=document.getElementById("vlm-fab-button");t&&(e?(t.classList.remove("vlm-pill-collapsed"),t.classList.add("vlm-pill-expanded")):(t.classList.remove("vlm-pill-expanded"),t.classList.add("vlm-pill-collapsed")))}togglePanel(){this.isOpen?this.closePanel():this.openPanel()}openPanel(){this.isOpen=!0;const e=document.getElementById("vlm-panel"),t=document.getElementById("vlm-fab-wrapper"),i=document.getElementById("vlm-fab-badge");e&&(e.style.display="flex",setTimeout(()=>{e.classList.add("vlm-panel-open"),e.removeAttribute("aria-hidden")},10)),t&&(t.style.display="none"),i&&(i.style.display="none",this.unreadCount=0),this.hasCompletedPrechat?(document.getElementById("vlm-prechat-view")?.classList.add("vlm-prechat-hidden"),this.triggerWelcomeSequence(),setTimeout(()=>{document.getElementById("vlm-chat-textarea")?.focus()},200)):(document.getElementById("vlm-prechat-view")?.classList.remove("vlm-prechat-hidden"),setTimeout(()=>{document.getElementById("vlm-input-name")?.focus()},200)),this.scrollToBottom()}closePanel(){this.isOpen=!1;const e=document.getElementById("vlm-panel"),t=document.getElementById("vlm-fab-wrapper");e&&(e.classList.remove("vlm-panel-open"),e.setAttribute("aria-hidden","true"),setTimeout(()=>{this.isOpen||(e.style.display="none")},280)),t&&(t.style.display="block",this.setPillState(!0))}triggerWelcomeSequence(){if(this.hasSentWelcomeSequence||this.messages.length>0)return;this.hasSentWelcomeSequence=!0;const e=this.visitorName?this.visitorName.split(" ")[0]:"",t=T(),i=e?`${t}, ${e}!`:`${t}!`,n="Eu sou a Valentina, da Valem Válvulas e Embalagens.",o="Como posso te ajudar hoje?";setTimeout(()=>{this.addMessage({id:`welcome-1-${Date.now()}`,sender:"ai",text:i,contentType:"text",timestamp:new Date().toISOString(),timeStr:f(),fullDateStr:y()}),setTimeout(()=>{this.showTypingIndicator(),setTimeout(()=>{this.hideTypingIndicator(),this.addMessage({id:`welcome-2-${Date.now()}`,sender:"ai",text:n,contentType:"text",timestamp:new Date().toISOString(),timeStr:f(),fullDateStr:y()}),setTimeout(()=>{this.showTypingIndicator(),setTimeout(()=>{this.hideTypingIndicator(),this.addMessage({id:`welcome-3-${Date.now()}`,sender:"ai",text:o,contentType:"text",timestamp:new Date().toISOString(),timeStr:f(),fullDateStr:y()})},800)},400)},800)},400)},300)}notifyVisitorDataToBackend(){this.ws&&this.ws.readyState===WebSocket.OPEN&&this.ws.send(JSON.stringify({type:"visitor_identify",name:this.visitorName,doc:this.visitorDoc,url:location.href,title:document.title}))}copyConversation(){if(this.messages.length===0)return;const e=this.messages.map(o=>{const a=o.sender==="visitor"?this.visitorName||"Você":o.sender==="ai"?"Valentina (Valem)":"Operador",l=o.text||(o.fileName?`[Arquivo: ${o.fileName}]`:"[Áudio]");return`[${o.timeStr}] ${a}:
${l}
`}).join(`
`),i=`--- Atendimento Valem Pack ---
Data: ${new Date().toLocaleDateString("pt-BR")}
Cliente: ${this.visitorName||"Visitante"} (${this.visitorDoc||"Não informado"})

`+e,n=()=>{const o=document.getElementById("vlm-copy-toast");o&&(o.classList.add("vlm-toast-active"),setTimeout(()=>o.classList.remove("vlm-toast-active"),2200))};navigator.clipboard?navigator.clipboard.writeText(i).then(n).catch(()=>this.fallbackCopy(i,n)):this.fallbackCopy(i,n)}fallbackCopy(e,t){const i=document.createElement("textarea");i.value=e,i.style.position="fixed",i.style.opacity="0",document.body.appendChild(i),i.select(),document.execCommand("copy"),document.body.removeChild(i),t()}async startAudioRecording(){try{const e=await navigator.mediaDevices.getUserMedia({audio:!0});this.audioChunks=[];let t="audio/webm";MediaRecorder.isTypeSupported("audio/webm")||(MediaRecorder.isTypeSupported("audio/mp4")?t="audio/mp4":t=""),this.mediaRecorder=new MediaRecorder(e,t?{mimeType:t}:void 0),this.mediaRecorder.ondataavailable=o=>{o.data.size>0&&this.audioChunks.push(o.data)},this.mediaRecorder.start(200),this.recordStartTime=Date.now(),this.recordingDurationSec=0,this.initWaveformVisualizer(e),document.getElementById("vlm-standard-input-row").style.display="none",document.getElementById("vlm-audio-preview-row").classList.remove("vlm-preview-active"),document.getElementById("vlm-audio-record-row").classList.add("vlm-recording-active");const n=document.getElementById("vlm-rec-timer");n.textContent="00:00",this.recordTimer=setInterval(()=>{this.recordingDurationSec=Math.floor((Date.now()-this.recordStartTime)/1e3);const o=Math.floor(this.recordingDurationSec/60),a=this.recordingDurationSec%60;n.textContent=`${o<10?"0":""}${o}:${a<10?"0":""}${a}`},1e3)}catch{alert("Permissão de microfone negada ou microfone indisponível.")}}initWaveformVisualizer(e){try{const t=window.AudioContext||window.webkitAudioContext;this.audioContext=new t;const i=this.audioContext.createMediaStreamSource(e);this.analyserNode=this.audioContext.createAnalyser(),this.analyserNode.fftSize=64,i.connect(this.analyserNode);const n=this.analyserNode.frequencyBinCount,o=new Uint8Array(n),a=document.querySelectorAll(".vlm-wave-bar"),l=()=>{this.analyserNode&&(this.analyserNode.getByteFrequencyData(o),a.forEach((r,v)=>{const m=Math.floor(v/a.length*(n/2)),u=o[m]||0,h=Math.max(4,Math.min(24,Math.floor(u/255*24*1.5)));r.style.height=`${h}px`}),this.waveformAnimFrame=requestAnimationFrame(l))};l()}catch(t){console.warn("Waveform visualizer não inicializado:",t)}}stopWaveformVisualizer(){this.waveformAnimFrame&&(cancelAnimationFrame(this.waveformAnimFrame),this.waveformAnimFrame=null),this.audioContext&&this.audioContext.state!=="closed"&&(this.audioContext.close().catch(()=>{}),this.audioContext=null),this.analyserNode=null}cancelAudioRecording(){this.recordTimer&&clearInterval(this.recordTimer),this.stopWaveformVisualizer(),this.mediaRecorder&&this.mediaRecorder.state!=="inactive"&&(this.mediaRecorder.stop(),this.mediaRecorder.stream.getTracks().forEach(e=>e.stop())),this.audioChunks=[],this.resetAudioUI()}finishRecordingForPreview(){this.recordTimer&&clearInterval(this.recordTimer),this.stopWaveformVisualizer(),this.mediaRecorder&&(this.mediaRecorder.onstop=()=>{this.mediaRecorder?.stream.getTracks().forEach(i=>i.stop());const e=this.mediaRecorder?.mimeType||"audio/webm";if(this.recordedAudioBlob=new Blob(this.audioChunks,{type:e}),this.recordedAudioBlob.size<500){this.resetAudioUI();return}const t=new FileReader;t.onloadend=()=>{this.recordedAudioDataUrl=t.result||"",this.showAudioPreviewUI(this.recordedAudioDataUrl,this.recordingDurationSec)},t.readAsDataURL(this.recordedAudioBlob)},this.mediaRecorder.state!=="inactive"&&this.mediaRecorder.stop())}showAudioPreviewUI(e,t){document.getElementById("vlm-standard-input-row").style.display="none",document.getElementById("vlm-audio-record-row").classList.remove("vlm-recording-active"),document.getElementById("vlm-audio-preview-row").classList.add("vlm-preview-active");const n=document.getElementById("vlm-preview-duration");n.textContent=b(t),this.previewAudioElem&&this.previewAudioElem.pause(),this.previewAudioElem=new Audio(e);const o=document.getElementById("vlm-preview-progressbar-fill"),a=document.getElementById("vlm-btn-preview-play");o.style.width="0%",a.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>',this.previewAudioElem.addEventListener("timeupdate",()=>{const l=t>0?t:this.previewAudioElem?.duration||1,r=Math.min((this.previewAudioElem?.currentTime||0)/l*100,100);o.style.width=`${r}%`}),this.previewAudioElem.addEventListener("ended",()=>{a.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>',o.style.width="0%"})}togglePreviewAudioPlay(){if(!this.previewAudioElem)return;const e=document.getElementById("vlm-btn-preview-play");this.previewAudioElem.paused?(this.previewAudioElem.play(),e.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'):(this.previewAudioElem.pause(),e.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>')}discardAudioPreview(){this.previewAudioElem&&(this.previewAudioElem.pause(),this.previewAudioElem=null),this.recordedAudioBlob=null,this.recordedAudioDataUrl="",this.resetAudioUI()}sendRecordedAudioFromPreview(){if(!this.recordedAudioDataUrl){this.resetAudioUI();return}this.previewAudioElem&&(this.previewAudioElem.pause(),this.previewAudioElem=null);const e=this.recordedAudioBlob?.type||"audio/webm",t=this.recordingDurationSec,i=this.recordedAudioDataUrl;this.resetAudioUI(),this.sendAudioMessage(i,e,t)}resetAudioUI(){document.getElementById("vlm-standard-input-row").style.display="flex",document.getElementById("vlm-audio-record-row").classList.remove("vlm-recording-active"),document.getElementById("vlm-audio-preview-row").classList.remove("vlm-preview-active"),this.updateButtonsState()}sendAudioMessage(e,t,i){const n=crypto.randomUUID?crypto.randomUUID():String(Date.now());this.addMessage({id:n,sender:"visitor",text:"",contentType:"audio",mediaUrl:e,durationSec:i,timestamp:new Date().toISOString(),timeStr:f(),fullDateStr:y()}),this.ws&&this.ws.readyState===WebSocket.OPEN&&(this.showTypingIndicator(),this.ws.send(JSON.stringify({type:"visitor_audio",audioBase64:e,mimeType:t,durationSec:i,visitorName:this.visitorName,visitorDoc:this.visitorDoc,url:location.href,title:document.title})))}handleFileSelected(e){if(e.size>20*1024*1024){alert("Arquivo muito grande. Limite máximo: 20MB.");return}this.pendingFile=e;const t=document.getElementById("vlm-attachment-preview-bar"),i=document.getElementById("vlm-preview-filename");i.textContent=`${e.name} (${S(e.size)})`,t.classList.add("vlm-preview-active"),this.updateButtonsState()}clearPendingFile(){this.pendingFile=null,document.getElementById("vlm-attachment-preview-bar").classList.remove("vlm-preview-active"),document.getElementById("vlm-file-input").value="",this.updateButtonsState()}addMessage(e){if(this.messages.push(e),this.renderSingleMessage(e),!this.isOpen&&e.sender!=="visitor"){this.unreadCount++;const t=document.getElementById("vlm-fab-badge");t&&(t.textContent=String(this.unreadCount),t.style.display="flex")}}renderSingleMessage(e){const t=document.getElementById("vlm-messages-container");if(!t)return;this.hideTypingIndicator();const i=document.createElement("div");i.className=`vlm-message-row vlm-message-row--${e.sender}`,i.addEventListener("click",()=>i.classList.toggle("vlm-details-visible"));let n="";if(e.contentType==="audio"&&e.mediaUrl)n=this.renderAudioPlayer(e.mediaUrl,e.durationSec||0);else if(e.contentType==="image"&&e.mediaUrl)n=`
        <img src="${e.mediaUrl}" alt="${this.escapeHtml(e.fileName||"Foto")}" class="vlm-media-image" onclick="window.open('${e.mediaUrl}', '_blank')" />
        ${e.text?`<div style="margin-top:6px">${this.escapeAndFormat(e.text)}</div>`:""}
      `;else if(e.contentType==="video"&&e.mediaUrl)n=`
        <video src="${e.mediaUrl}" controls playsinline class="vlm-media-video"></video>
        ${e.text?`<div style="margin-top:6px">${this.escapeAndFormat(e.text)}</div>`:""}
      `;else if(e.contentType==="document"&&e.mediaUrl){const o=$(e.fileName||"");n=`
        <a href="${e.mediaUrl}" download="${this.escapeHtml(e.fileName||"arquivo")}" class="vlm-media-file-card" target="_blank">
          <span class="vlm-media-file-icon">${o}</span>
          <div class="vlm-media-file-info">
            <span class="vlm-media-file-name" title="${this.escapeHtml(e.fileName||"Download")}">${this.escapeHtml(e.fileName||"Download")}</span>
            <span class="vlm-media-file-size">${S(e.fileSize)} • Baixar</span>
          </div>
        </a>
        ${e.text?`<div style="margin-top:6px">${this.escapeAndFormat(e.text)}</div>`:""}
      `}else n=this.escapeAndFormat(e.text);i.innerHTML=`<div class="vlm-bubble-box">${n}</div><span class="vlm-msg-details">Enviado em ${e.fullDateStr}</span>`,t.appendChild(i),e.contentType==="audio"&&this.attachAudioPlayerEvents(i),this.scrollToBottom()}renderAudioPlayer(e,t){const i=t>0?b(t):"0:05";return`
      <div class="vlm-audio-player" data-audio-src="${e}" data-fallback-sec="${t||5}">
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
            <span class="vlm-audio-time-total">${i}</span>
          </div>
        </div>
        <button class="vlm-audio-speed-btn">1x</button>
        <audio src="${e}" preload="metadata" style="display:none"></audio>
      </div>
    `}attachAudioPlayerEvents(e){const t=e.querySelector(".vlm-audio-player");if(!t)return;const i=t.querySelector("audio"),n=t.querySelector(".vlm-audio-btn-play"),o=t.querySelector(".vlm-audio-progressbar-fill"),a=t.querySelector(".vlm-audio-time-curr"),l=t.querySelector(".vlm-audio-time-total"),r=t.querySelector(".vlm-audio-speed-btn"),v=t.querySelector(".vlm-audio-progressbar-bg"),m=parseFloat(t.getAttribute("data-fallback-sec")||"5"),u=()=>i.duration&&isFinite(i.duration)&&!isNaN(i.duration)&&i.duration>0?i.duration:m>0?m:5;i.addEventListener("loadedmetadata",()=>{const d=u();l.textContent=b(d)}),i.addEventListener("durationchange",()=>{const d=u();l.textContent=b(d)}),n.addEventListener("click",d=>{d.stopPropagation(),i.paused?(document.querySelectorAll("audio").forEach(p=>{p!==i&&p.pause()}),i.play().then(()=>{n.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'}).catch(()=>{})):(i.pause(),n.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>')}),i.addEventListener("timeupdate",()=>{const d=u(),p=Math.min(i.currentTime/d*100,100);o.style.width=`${p}%`,a.textContent=b(i.currentTime)}),i.addEventListener("ended",()=>{n.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>',o.style.width="0%",a.textContent="0:00"}),v.addEventListener("click",d=>{d.stopPropagation();const p=v.getBoundingClientRect(),w=(d.clientX-p.left)/p.width,I=u();i.currentTime=w*I});let h=1;r.addEventListener("click",d=>{d.stopPropagation(),h===1?h=1.5:h===1.5?h=2:h=1,i.playbackRate=h,r.textContent=`${h}x`})}showTypingIndicator(){if(this.isTyping)return;this.isTyping=!0;const e=document.getElementById("vlm-messages-container");if(!e)return;const t=document.createElement("div");t.id="vlm-typing-indicator",t.className="vlm-typing-row",t.innerHTML=`
      <img src="${this.opts.avatarUrl}" alt="Valentina" class="vlm-typing-avatar" id="vlm-typing-avatar-btn" />
      <div class="vlm-typing-bubble">
        <span class="vlm-typing-dot"></span>
        <span class="vlm-typing-dot"></span>
        <span class="vlm-typing-dot"></span>
      </div>
    `,e.appendChild(t),t.querySelector("#vlm-typing-avatar-btn")?.addEventListener("click",i=>{i.stopPropagation(),document.getElementById("vlm-avatar-lightbox")?.classList.add("vlm-lightbox-open")}),this.scrollToBottom()}hideTypingIndicator(){this.isTyping=!1,document.getElementById("vlm-typing-indicator")?.remove()}scrollToBottom(){const e=document.getElementById("vlm-messages-container");e&&setTimeout(()=>{e.scrollTop=e.scrollHeight},30)}escapeHtml(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}escapeAndFormat(e){if(!e)return"";const t=e.replace(/\\"/g,'"').replace(/\\\\/g,"").trim();return this.escapeHtml(t).replace(/\n/g,"<br>").replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>")}handleSendMessage(){const e=document.getElementById("vlm-chat-textarea"),t=e?e.value.trim():"",i=this.pendingFile;if(!t&&!i)return;if(e&&(e.value="",e.style.height="20px"),i){const o=new FileReader;o.onloadend=()=>{const a=o.result||"",l=i.type.startsWith("image/"),r=i.type.startsWith("video/"),v=l?"image":r?"video":"document",m=crypto.randomUUID?crypto.randomUUID():String(Date.now());this.addMessage({id:m,sender:"visitor",text:t,contentType:v,mediaUrl:a,fileName:i.name,fileSize:i.size,timestamp:new Date().toISOString(),timeStr:f(),fullDateStr:y()}),this.ws&&this.ws.readyState===WebSocket.OPEN&&(this.showTypingIndicator(),this.ws.send(JSON.stringify({type:"visitor_media",fileBase64:a,fileName:i.name,fileType:i.type,fileSize:i.size,text:t,visitorName:this.visitorName,visitorDoc:this.visitorDoc,url:location.href,title:document.title}))),this.clearPendingFile(),this.updateButtonsState()},o.readAsDataURL(i);return}const n=crypto.randomUUID?crypto.randomUUID():String(Date.now());this.addMessage({id:n,sender:"visitor",text:t,contentType:"text",timestamp:new Date().toISOString(),timeStr:f(),fullDateStr:y()}),this.ws&&this.ws.readyState===WebSocket.OPEN?(this.showTypingIndicator(),this.ws.send(JSON.stringify({type:"visitor_message",text:t,messageId:n,visitorName:this.visitorName,visitorDoc:this.visitorDoc,url:location.href,title:document.title}))):(this.addMessage({id:`err-${Date.now()}`,sender:"system",text:"Conexão perdida. Tentando restabelecer...",timestamp:new Date().toISOString(),timeStr:f(),fullDateStr:y()}),this.connectWebSocket()),this.updateButtonsState()}updateButtonsState(){const e=document.getElementById("vlm-chat-textarea"),t=document.getElementById("vlm-icon-mic"),i=document.getElementById("vlm-icon-send"),n=document.getElementById("vlm-btn-action-main");if(!t||!i||!n)return;const o=e?e.value.trim().length>0:!1,a=this.pendingFile!==null;o||a?(t.style.display="none",i.style.display="block",n.setAttribute("title","Enviar mensagem")):(t.style.display="block",i.style.display="none",n.setAttribute("title","Gravar áudio"))}connectWebSocket(){if(this.opts.mock)return;const e=`${this.opts.wsUrl}?tenantId=${this.opts.tenant}&cookieId=${this.cookieId}&name=${encodeURIComponent(this.visitorName)}&doc=${encodeURIComponent(this.visitorDoc)}&currentUrl=${encodeURIComponent(location.href)}&currentTitle=${encodeURIComponent(document.title)}`;try{this.ws=new WebSocket(e),this.ws.onopen=()=>{this.reconnectAttempts=0,this.hasCompletedPrechat&&this.notifyVisitorDataToBackend()},this.ws.onmessage=t=>{try{this.handleIncomingPayload(JSON.parse(t.data))}catch{}},this.ws.onclose=()=>this.scheduleReconnect()}catch{this.scheduleReconnect()}}handleIncomingPayload(e){const{type:t}=e;(t==="message"||t==="ai_message"||t==="operator_message")&&(this.hideTypingIndicator(),this.addMessage({id:e.messageId||crypto.randomUUID?.()||String(Date.now()),sender:e.sender==="operator"||t==="operator_message"?"operator":"ai",text:e.content||e.text||"",contentType:e.contentType||"text",mediaUrl:e.mediaUrl,fileName:e.fileName,timestamp:new Date().toISOString(),timeStr:f(),fullDateStr:y()})),t==="typing"&&(e.isTyping?this.showTypingIndicator():this.hideTypingIndicator()),(t==="bridge_initiated"||t==="bridge_sent")&&(this.hideTypingIndicator(),this.addMessage({id:`bridge-${Date.now()}`,sender:"system",text:"📱 **Atendimento transferido para o WhatsApp!** Nossa equipe comercial já recebeu suas informações e responderá por lá. Fique de olho no seu app!",timestamp:new Date().toISOString(),timeStr:f(),fullDateStr:y()})),t==="chat_closed"&&(this.hideTypingIndicator(),this.addMessage({id:`closed-${Date.now()}`,sender:"system",text:"Atendimento finalizado. Agradecemos o contato com a Valem Pack!",timestamp:new Date().toISOString(),timeStr:f(),fullDateStr:y()}))}scheduleReconnect(){if(this.reconnectTimer)return;const e=Math.min(1500*Math.pow(1.5,this.reconnectAttempts),2e4);this.reconnectAttempts++,this.reconnectTimer=setTimeout(()=>{this.reconnectTimer=null,this.connectWebSocket()},e)}startPageviewTracking(){let e=location.href;this.pageviewInterval=setInterval(()=>{location.href!==e&&(e=location.href,this.ws&&this.ws.readyState===WebSocket.OPEN&&this.ws.send(JSON.stringify({type:"pageview",url:location.href,title:document.title,referrer:document.referrer})))},2e3)}}(function(){const s=document.currentScript;let e="";if(s?.src)try{e=new URL(s.src).origin}catch{}e||(e=location.origin);const t=s?.dataset.tenant||"valem",i=s?.dataset.mock==="true",n=s?.dataset.whatsapp||"5514981468232",o=s?.dataset.avatar||`${e}/valentina-avatar.png`,a=location.protocol==="https:"?"wss:":"ws:",l=e.replace(/^https?:\/\//,""),r=s?.dataset.ws||`${a}//${l}/ws/livechat`;function v(){if(window.__valemChatWidget)return;const m=new P({tenant:t,wsUrl:r,avatarUrl:o,whatsappNumber:n,mock:i});m.mount(),window.__valemChatWidget=m}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",v):v()})()})();
