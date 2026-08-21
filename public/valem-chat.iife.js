(function(){"use strict";function r(a=new Date){return a.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}function m(){const a="valem_visitor_id";try{let e=localStorage.getItem(a);return e||(e=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2,9)}`,localStorage.setItem(a,e)),e}catch{return`${Date.now()}-${Math.random().toString(36).slice(2,9)}`}}class h{constructor(e){this.ws=null,this.messages=[],this.isOpen=!1,this.isPillExpanded=!0,this.isTyping=!1,this.unreadCount=0,this.pillLoopTimer=null,this.isHoveringFab=!1,this.reconnectTimer=null,this.reconnectAttempts=0,this.pageviewInterval=null,this.opts=e,this.cookieId=m()}mount(){this.injectDOM(),this.startPillAnimationLoop(),this.connectWebSocket(),this.startPageviewTracking()}injectDOM(){const e=document.createElement("div");e.id="vlm-chat-root",e.innerHTML=this.renderHTML(),document.body.appendChild(e),this.bindEvents()}renderHTML(){const e=this.opts.avatarUrl;return`
    <!-- BOTÃO FLUTUANTE PILL / ÍCONE -->
    <div id="vlm-fab-wrapper">
      <button id="vlm-fab-button" class="vlm-pill-expanded" aria-label="Falar com Valentina">
        
        <!-- Estado Pill (Expandido) -->
        <div class="vlm-pill-content">
          <div class="vlm-fab-avatar-wrap">
            <img src="${e}" alt="Valentina" class="vlm-fab-avatar-img" />
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
            <img src="${e}" alt="Valentina" class="vlm-header-avatar-img" />
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
    `}bindEvents(){const e=document.getElementById("vlm-fab-button"),t=document.getElementById("vlm-btn-close"),n=document.getElementById("vlm-btn-minimize"),s=document.getElementById("vlm-btn-copy-dialog"),i=document.getElementById("vlm-btn-send"),o=document.getElementById("vlm-chat-textarea");e.addEventListener("mouseenter",()=>{this.isHoveringFab=!0,this.setPillState(!0)}),e.addEventListener("mouseleave",()=>{this.isHoveringFab=!1}),e.addEventListener("click",()=>this.togglePanel()),t.addEventListener("click",()=>this.closePanel()),n.addEventListener("click",()=>this.closePanel()),s.addEventListener("click",()=>this.copyConversation()),i.addEventListener("click",()=>this.handleSendMessage()),o.addEventListener("input",()=>{o.style.height="auto";const l=Math.min(o.scrollHeight,120);o.style.height=`${Math.max(l,22)}px`}),o.addEventListener("keydown",l=>{l.key==="Enter"&&!l.shiftKey&&(l.preventDefault(),this.handleSendMessage())})}startPillAnimationLoop(){let e=0;this.pillLoopTimer=setInterval(()=>{this.isOpen||this.isHoveringFab||(e=(e+1)%2,this.setPillState(e===0))},6e3)}setPillState(e){this.isPillExpanded=e;const t=document.getElementById("vlm-fab-button");t&&(e?(t.classList.remove("vlm-pill-collapsed"),t.classList.add("vlm-pill-expanded")):(t.classList.remove("vlm-pill-expanded"),t.classList.add("vlm-pill-collapsed")))}togglePanel(){this.isOpen?this.closePanel():this.openPanel()}openPanel(){this.isOpen=!0;const e=document.getElementById("vlm-panel"),t=document.getElementById("vlm-fab-wrapper"),n=document.getElementById("vlm-fab-badge");e&&(e.style.display="flex",setTimeout(()=>{e.classList.add("vlm-panel-open"),e.removeAttribute("aria-hidden")},10)),t&&(t.style.display="none"),n&&(n.style.display="none",this.unreadCount=0),this.scrollToBottom(),setTimeout(()=>{document.getElementById("vlm-chat-textarea")?.focus()},200)}closePanel(){this.isOpen=!1;const e=document.getElementById("vlm-panel"),t=document.getElementById("vlm-fab-wrapper");e&&(e.classList.remove("vlm-panel-open"),e.setAttribute("aria-hidden","true"),setTimeout(()=>{this.isOpen||(e.style.display="none")},280)),t&&(t.style.display="block",this.setPillState(!0))}copyConversation(){if(this.messages.length===0)return;const e=this.messages.map(i=>{const o=i.sender==="visitor"?"Você":i.sender==="ai"?"Valentina (Valem)":"Operador";return`[${i.timeStr}] ${o}:
${i.text}
`}).join(`
`),n=`--- Atendimento Valem Pack ---
Data: ${new Date().toLocaleDateString("pt-BR")}

`+e,s=()=>{const i=document.getElementById("vlm-copy-toast");i&&(i.classList.add("vlm-toast-active"),setTimeout(()=>i.classList.remove("vlm-toast-active"),2200))};navigator.clipboard?navigator.clipboard.writeText(n).then(s).catch(()=>this.fallbackCopy(n,s)):this.fallbackCopy(n,s)}fallbackCopy(e,t){const n=document.createElement("textarea");n.value=e,n.style.position="fixed",n.style.opacity="0",document.body.appendChild(n),n.select(),document.execCommand("copy"),document.body.removeChild(n),t()}addMessage(e){if(this.messages.push(e),this.renderSingleMessage(e),!this.isOpen&&e.sender!=="visitor"){this.unreadCount++;const t=document.getElementById("vlm-fab-badge");t&&(t.textContent=String(this.unreadCount),t.style.display="flex")}}renderSingleMessage(e){const t=document.getElementById("vlm-messages-container");if(!t)return;this.hideTypingIndicator();const n=document.createElement("div");n.className=`vlm-message-row vlm-message-row--${e.sender}`,n.innerHTML=`
      <div class="vlm-bubble-box">${this.escapeAndFormat(e.text)}</div>
      <span class="vlm-msg-time">${e.timeStr}</span>
    `,t.appendChild(n),this.scrollToBottom()}showTypingIndicator(){if(this.isTyping)return;this.isTyping=!0;const e=document.getElementById("vlm-messages-container");if(!e)return;const t=document.createElement("div");t.id="vlm-typing-indicator",t.className="vlm-typing-row",t.innerHTML=`
      <img src="${this.opts.avatarUrl}" alt="Valentina" class="vlm-typing-avatar" />
      <div class="vlm-typing-bubble">
        <span class="vlm-typing-dot"></span>
        <span class="vlm-typing-dot"></span>
        <span class="vlm-typing-dot"></span>
      </div>
    `,e.appendChild(t),this.scrollToBottom()}hideTypingIndicator(){this.isTyping=!1,document.getElementById("vlm-typing-indicator")?.remove()}scrollToBottom(){const e=document.getElementById("vlm-messages-container");e&&setTimeout(()=>{e.scrollTop=e.scrollHeight},30)}escapeAndFormat(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>").replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>")}handleSendMessage(){const e=document.getElementById("vlm-chat-textarea");if(!e)return;const t=e.value.trim();if(!t)return;e.value="",e.style.height="22px";const n=crypto.randomUUID?crypto.randomUUID():String(Date.now());if(this.addMessage({id:n,sender:"visitor",text:t,timestamp:new Date().toISOString(),timeStr:r()}),this.opts.mock){this.showTypingIndicator(),setTimeout(()=>{this.addMessage({id:`mock-${Date.now()}`,sender:"ai",text:"Olá! Recebi sua mensagem. Em que posso te ajudar hoje com frascos e válvulas?",timestamp:new Date().toISOString(),timeStr:r()})},1200);return}this.ws&&this.ws.readyState===WebSocket.OPEN?(this.showTypingIndicator(),this.ws.send(JSON.stringify({type:"visitor_message",text:t,messageId:n,url:location.href,title:document.title}))):(this.addMessage({id:`err-${Date.now()}`,sender:"system",text:"Tentando restabelecer conexão... Sua mensagem será enviada em instantes.",timestamp:new Date().toISOString(),timeStr:r()}),this.connectWebSocket())}connectWebSocket(){if(this.opts.mock)return;const t=`${this.opts.wsUrl}?tenantId=${this.opts.tenant}&cookieId=${this.cookieId}&currentUrl=${encodeURIComponent(location.href)}&currentTitle=${encodeURIComponent(document.title)}`;try{this.ws=new WebSocket(t),this.ws.onopen=()=>{console.log("[Valem Chat] ✅ Conectado ao servidor"),this.reconnectAttempts=0},this.ws.onmessage=n=>{try{const s=JSON.parse(n.data);this.handleIncomingPayload(s)}catch(s){console.error("[Valem Chat] Erro ao processar mensagem WS:",s)}},this.ws.onclose=()=>{console.log("[Valem Chat] Conexão WS encerrada. Agendando reconexão..."),this.scheduleReconnect()},this.ws.onerror=n=>{console.warn("[Valem Chat] Aviso WS:",n)}}catch{this.scheduleReconnect()}}handleIncomingPayload(e){const{type:t}=e;(t==="ai_message"||t==="operator_message")&&(this.hideTypingIndicator(),this.addMessage({id:e.messageId||crypto.randomUUID?.()||String(Date.now()),sender:t==="ai_message"?"ai":"operator",text:e.text,timestamp:new Date().toISOString(),timeStr:r()})),t==="typing"&&(e.isTyping?this.showTypingIndicator():this.hideTypingIndicator()),t==="bridge_sent"&&(this.hideTypingIndicator(),this.addMessage({id:`bridge-${Date.now()}`,sender:"system",text:"📱 **Atendimento transferido para o WhatsApp!** Nossa equipe já recebeu todas as suas informações e continuará a conversa por lá. Fique atento ao seu app! 😊",timestamp:new Date().toISOString(),timeStr:r()})),t==="chat_closed"&&(this.hideTypingIndicator(),this.addMessage({id:`closed-${Date.now()}`,sender:"system",text:"Atendimento finalizado. Agradecemos o contato com a Valem Pack!",timestamp:new Date().toISOString(),timeStr:r()}))}scheduleReconnect(){if(this.reconnectTimer)return;const e=Math.min(1500*Math.pow(1.5,this.reconnectAttempts),2e4);this.reconnectAttempts++,this.reconnectTimer=setTimeout(()=>{this.reconnectTimer=null,this.connectWebSocket()},e)}startPageviewTracking(){let e=location.href;this.pageviewInterval=setInterval(()=>{location.href!==e&&(e=location.href,this.ws&&this.ws.readyState===WebSocket.OPEN&&this.ws.send(JSON.stringify({type:"pageview",url:location.href,title:document.title,referrer:document.referrer})))},2e3)}}(function(){const a=document.currentScript;let e="";if(a?.src)try{e=new URL(a.src).origin}catch{}e||(e=location.origin);const t=a?.dataset.tenant||"valem",n=a?.dataset.mock==="true",s=a?.dataset.whatsapp||"5514981468232",i=a?.dataset.avatar||`${e}/valentina-avatar.png`,o=location.protocol==="https:"?"wss:":"ws:",l=e.replace(/^https?:\/\//,""),p=a?.dataset.ws||`${o}//${l}/ws/livechat`;function d(){if(window.__valemChatWidget)return;const c=new h({tenant:t,wsUrl:p,avatarUrl:i,whatsappNumber:s,mock:n});c.mount(),window.__valemChatWidget=c}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",d):d()})()})();
