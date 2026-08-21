// ══════════════════════════════════════════════════════════════════════════════
// 💬 VALEM CHAT WIDGET — Valentina Live Chat (IIFE Bundle)
// Injeção: <script src="/valem-chat.iife.js" data-tenant="valem" defer></script>
// ══════════════════════════════════════════════════════════════════════════════

import "./styles.css";
import { ValemChatWidget } from "./widget";

// Auto-inicializa quando o script é carregado
(function () {
  const scriptTag = document.currentScript as HTMLScriptElement | null;

  const tenant   = scriptTag?.dataset.tenant   || "valem";
  const mock     = scriptTag?.dataset.mock     === "true";
  const wsUrl    = scriptTag?.dataset.ws       || buildWsUrl();

  function buildWsUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws/livechat`;
  }

  function init() {
    if ((window as any).__valemChatWidget) return; // evita dupla instância
    const widget = new ValemChatWidget({ tenant, wsUrl, mock });
    widget.mount();
    (window as any).__valemChatWidget = widget;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();