import React from "react";
import { createRoot } from "react-dom/client";
import { ChatWidget } from "./components/ChatWidget/ChatWidget";
import { ensureWidgetStylesheetLoaded } from "./config";
import "./index.css";

function initTecfagWidget() {
  if (document.getElementById("tecfag-chat-root")) return;

  ensureWidgetStylesheetLoaded();

  const container = document.createElement("div");
  container.id = "tecfag-chat-root";
  document.body.appendChild(container);

  if (!document.getElementById("tecfag-vtex-override-styles")) {
    const style = document.createElement("style");
    style.id = "tecfag-vtex-override-styles";
    style.textContent = `
      /* Reset e isolamento total contra CSS global da VTEX */
      #tecfag-chat-root {
        position: static !important;
        width: 0 !important;
        height: 0 !important;
        overflow: visible !important;
        z-index: 2147483647 !important;
        font-family: 'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        line-height: 1.5 !important;
        -webkit-font-smoothing: antialiased !important;
      }
      #tecfag-chat-root *, #tecfag-chat-root *::before, #tecfag-chat-root *::after {
        box-sizing: border-box !important;
      }

      /* Força posicionamento fixo do botão FAB (2 IDs = especificidade 0,2,0 > qualquer classe VTEX) */
      #tecfag-chat-root #tecfag-fab-button {
        position: fixed !important;
        bottom: 24px !important;
        left: 24px !important;
        right: auto !important;
        top: auto !important;
        z-index: 2147483647 !important;
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        gap: 12px !important;
        width: auto !important;
        max-width: 240px !important;
        height: auto !important;
        max-height: 68px !important;
        padding: 8px 20px 8px 8px !important;
        margin: 0 !important;
        border-radius: 9999px !important;
        border: 2px solid rgba(229, 9, 20, 0.6) !important;
        background: linear-gradient(135deg, #0d0d0d 0%, #1a1a1a 40%, #E50914 100%) !important;
        color: #ffffff !important;
        cursor: pointer !important;
        box-shadow: 0 10px 30px rgba(229, 9, 20, 0.4), 0 4px 12px rgba(0, 0, 0, 0.3) !important;
        text-decoration: none !important;
        transform: none !important;
      }

      /* Força tamanho da foto do Fagner dentro do botão FAB */
      #tecfag-chat-root #tecfag-fab-button img {
        width: 48px !important;
        height: 48px !important;
        max-width: 48px !important;
        max-height: 48px !important;
        min-width: 48px !important;
        min-height: 48px !important;
        object-fit: cover !important;
        border-radius: 9999px !important;
        display: block !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      /* Força janela principal do chat */
      #tecfag-chat-root #tecfag-chat-window {
        position: fixed !important;
        z-index: 2147483647 !important;
        width: 390px !important;
        max-width: calc(100vw - 32px) !important;
        height: 600px !important;
        max-height: calc(100vh - 48px) !important;
        display: flex !important;
        flex-direction: column !important;
        border-radius: 16px !important;
        overflow: hidden !important;
        background-color: #f8fafc !important;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35) !important;
      }

      /* Impede que a VTEX estique avatares dentro do chat */
      #tecfag-chat-root #tecfag-chat-window img {
        max-width: 100% !important;
        display: block !important;
      }
    `;
    document.head.appendChild(style);
  }

  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <ChatWidget />
    </React.StrictMode>,
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTecfagWidget);
} else {
  initTecfagWidget();
}
