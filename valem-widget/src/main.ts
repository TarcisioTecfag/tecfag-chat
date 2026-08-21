// ══════════════════════════════════════════════════════════════════════════════
// 💬 VALEM CHAT WIDGET — Valentina Live Chat (IIFE Entrypoint)
// ══════════════════════════════════════════════════════════════════════════════

import "./styles.css";
import { ValemChatWidget } from "./widget";

(function () {
  const scriptTag = document.currentScript as HTMLScriptElement | null;
  
  // Resolve a URL base de onde o script foi carregado
  let scriptOrigin = "";
  if (scriptTag?.src) {
    try {
      scriptOrigin = new URL(scriptTag.src).origin;
    } catch {}
  }
  if (!scriptOrigin) {
    scriptOrigin = location.origin;
  }

  const tenant = scriptTag?.dataset.tenant || "valem";
  const mock = scriptTag?.dataset.mock === "true";
  const whatsappNumber = scriptTag?.dataset.whatsapp || "5514981468232";
  const avatarUrl = scriptTag?.dataset.avatar || `${scriptOrigin}/valentina-avatar.png`;
  
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const defaultWsHost = scriptOrigin.replace(/^https?:\/\//, "");
  const wsUrl = scriptTag?.dataset.ws || `${proto}//${defaultWsHost}/ws/livechat`;

  function init() {
    if ((window as any).__valemChatWidget) return;
    try {
      const widget = new ValemChatWidget({
        tenant,
        wsUrl,
        avatarUrl,
        whatsappNumber,
        mock,
      });
      if (typeof (widget as any).mount === "function") {
        (widget as any).mount();
      }
      (window as any).__valemChatWidget = widget;
      console.log("[ValemChatWidget] Inicializado com sucesso!");
    } catch (e) {
      console.error("[ValemChatWidget] Erro ao inicializar:", e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();