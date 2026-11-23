/**
 * Widget Entry Point — Self-initializing IIFE
 *
 * Cria seu próprio container DOM e monta o ChatWidget.
 * Projetado para ser incluído em qualquer site via <script>.
 *
 * ⚠️ VTEX IO / SPA Guard:
 * O GTM re-executa tags a cada troca de rota no SPA do VTEX IO.
 * A variável _reactRoot garante que createRoot() seja chamado UMA ÚNICA VEZ,
 * evitando a corrupção do React e a quebra do WebSocket na navegação.
 */
import { createRoot } from "react-dom/client";
import { createElement } from "react";
import ChatWidget from "./components/ChatWidget/ChatWidget";
import { ensureWidgetStylesheetLoaded } from "./config";
import "./index.css";
import inlineWidgetCss from "./index.css?inline";

// Root persistente — sobrevive à re-execução pelo GTM em SPAs
let _reactRoot: ReturnType<typeof createRoot> | null = null;

function mount() {
  // Se o root já existe, o widget já está montado — não recriar
  if (_reactRoot) {
    console.log("[TecfagChat] Root já existe, ignorando chamada duplicada (SPA navigation).");
    return;
  }

  console.log("[TecfagChat] mount() — primeira execução, readyState:", document.readyState);
  try {
    ensureWidgetStylesheetLoaded();

    if (!document.getElementById("tecfag-widget-inline-css") && typeof inlineWidgetCss === "string" && inlineWidgetCss.trim()) {
      const baseStyle = document.createElement("style");
      baseStyle.id = "tecfag-widget-inline-css";
      baseStyle.textContent = inlineWidgetCss;
      document.head.appendChild(baseStyle);
    }

    // ── Injeta CSS de override com especificidade máxima (duplo-ID) ──────────
    // Motivo: VTEX IO usa !important em bottom/left/transform em todos os divs.
    // Solução: injetar <style> com seletores de especificidade (2,0,0) que superam
    // qualquer regra de stylesheet, incluindo !important com seletores simples.
    if (!document.getElementById("tecfag-widget-overrides")) {
      const overrideStyle = document.createElement("style");
      overrideStyle.id = "tecfag-widget-overrides";
      overrideStyle.textContent = `
        /* ── Botão flutuante ── */
        #tecfag-chat-root #tecfag-fab-button {
          position: fixed !important;
          bottom: 24px !important;
          left: 24px !important;
          z-index: 2147483647 !important;
          transform: none !important;
          display: block !important;
          visibility: visible !important;
          opacity: 1 !important;
          pointer-events: auto !important;
        }
        /* ── Posicionamento fixo da janela de chat (imune ao VTEX IO sem travar animação interna) ── */
        #tecfag-chat-root #tecfag-chat-window-shell {
          position: fixed !important;
          z-index: 2147483646 !important;
          transform: none !important;
          display: block !important;
          visibility: visible !important;
          opacity: 1 !important;
          pointer-events: auto !important;
          box-sizing: border-box !important;
        }
        /* ── Janela de chat animada (Framer Motion anima opacity/scale/y sem !important) ── */
        #tecfag-chat-root #tecfag-chat-window {
          display: flex !important;
          flex-direction: column !important;
          visibility: visible !important;
          pointer-events: auto !important;
          overflow: hidden !important;
          box-sizing: border-box !important;
        }
        /* ── Proteção do layout interno (VTEX IO sobrescreve flex-shrink, padding, height) ── */
        #tecfag-chat-root #tecfag-chat-window * {
          box-sizing: border-box !important;
        }
        #tecfag-chat-root #tecfag-chat-window #tecfag-input-area {
          flex-shrink: 0 !important;
          display: block !important;
          height: auto !important;
          min-height: 56px !important;
          overflow: visible !important;
          padding-bottom: env(safe-area-inset-bottom, 0px) !important;
        }
        #tecfag-chat-root #tecfag-chat-window #tecfag-input-row {
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          flex-wrap: nowrap !important;
          padding: 10px 16px !important;
          height: auto !important;
        }
        #tecfag-chat-root #tecfag-chat-window #tecfag-input-row input[type="text"] {
          flex: 1 1 0% !important;
          min-width: 0 !important;
          height: auto !important;
          padding: 0 !important;
          border: none !important;
          outline: none !important;
          background: transparent !important;
          font-size: 14px !important;
          line-height: 1.5 !important;
        }
        #tecfag-chat-root #tecfag-chat-window #tecfag-send-btn {
          flex-shrink: 0 !important;
          width: 36px !important;
          height: 36px !important;
          min-width: 36px !important;
          min-height: 36px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          border-radius: 12px !important;
          padding: 0 !important;
          cursor: pointer !important;
          border: none !important;
        }
        #tecfag-chat-root #tecfag-chat-window #tecfag-attach-btn {
          flex-shrink: 0 !important;
          width: 36px !important;
          height: 36px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          padding: 0 !important;
          cursor: pointer !important;
          border: none !important;
          background: transparent !important;
        }
        #tecfag-chat-root #tecfag-chat-window svg {
          flex-shrink: 0 !important;
          overflow: visible !important;
        }
        #tecfag-chat-root #tecfag-chat-window #tecfag-messages-area {
          flex: 1 1 0% !important;
          overflow-y: auto !important;
          min-height: 0 !important;
          overscroll-behavior: contain !important;
          -webkit-overflow-scrolling: touch !important;
        }
        /* ── Mobile responsivo (< 640px): tela cheia sincronizada + anti-zoom iOS (16px) ── */
        @media (max-width: 639px) {
          #tecfag-chat-root #tecfag-fab-button {
            bottom: 16px !important;
            left: 16px !important;
            max-width: calc(100vw - 32px) !important;
            touch-action: manipulation !important;
          }
          #tecfag-chat-root #tecfag-chat-window-shell {
            left: 0 !important;
            right: 0 !important;
            width: 100% !important;
            max-width: 100vw !important;
            z-index: 2147483647 !important;
            touch-action: manipulation !important;
          }
          #tecfag-chat-root #tecfag-chat-window {
            border-radius: 0 !important;
            border-width: 0 !important;
          }
          #tecfag-chat-root #tecfag-chat-window #tecfag-input-area {
            border-radius: 0 !important;
          }
          #tecfag-chat-root #tecfag-chat-window input,
          #tecfag-chat-root #tecfag-chat-window textarea,
          #tecfag-chat-root #tecfag-chat-window #tecfag-input-row input[type="text"] {
            font-size: 16px !important;
          }
        }
      `;
      document.head.appendChild(overrideStyle);
      console.log("[TecfagChat] 💉 CSS overrides injetados com especificidade duplo-ID.");
    }

    let container = document.getElementById("tecfag-chat-root");
    if (!container) {
      container = document.createElement("div");
      container.id = "tecfag-chat-root";
      // setProperty com important para o container também
      container.style.setProperty("position", "fixed", "important");
      container.style.setProperty("bottom", "0", "important");
      container.style.setProperty("left", "0", "important");
      container.style.setProperty("z-index", "99999", "important");
      document.body.appendChild(container);
      console.log("[TecfagChat] Container criado e anexado ao body.");
    }

    _reactRoot = createRoot(container);
    _reactRoot.render(createElement(ChatWidget));
    console.log("[TecfagChat] ✅ Render chamado com sucesso!");
  } catch (err) {
    console.error("[TecfagChat] ❌ Erro ao montar:", err);
    _reactRoot = null; // Permite retry em caso de erro real
  }
}

// Mount quando o DOM estiver pronto
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
