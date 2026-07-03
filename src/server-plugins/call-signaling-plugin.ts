/**
 * Nitro plugin para inicializar o servidor Socket.io de signaling WebRTC.
 * Este plugin é carregado automaticamente pelo Nitro na inicialização do servidor.
 * Referência: https://nitro.build/guide/plugins
 */

import { defineNitroPlugin } from "nitropack/runtime/plugin";
import { initCallSignaling } from "../lib/call-signaling";

export default defineNitroPlugin((nitroApp) => {
  // Acessar o servidor HTTP nativo do Nitro
  const httpServer = (nitroApp as any)._server ?? (nitroApp as any).server ?? null;

  if (httpServer) {
    console.log("[Calls] Inicializando Socket.io signaling server...");
    initCallSignaling(httpServer);
    console.log("[Calls] Socket.io pronto em /socket.io/");
  } else {
    // Em algumas versões do Nitro, o servidor HTTP fica disponível via hook
    nitroApp.hooks.hook("listen", (server: any) => {
      console.log("[Calls] Inicializando Socket.io via hook listen...");
      initCallSignaling(server);
      console.log("[Calls] Socket.io pronto em /socket.io/");
    });
  }
});
