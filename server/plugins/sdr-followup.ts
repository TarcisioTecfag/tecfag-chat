// server/plugins/sdr-followup.ts
//
// Plugin Nitro que inicializa o Motor de Follow-ups SDR no startup da aplicação.
// Garante que o engine começa a rodar assim que o servidor HTTP estiver ouvindo.

import { startSdrFollowupEngine } from "../../src/lib/valentina/sdr-followup-engine";

export default function sdrFollowupPlugin(nitroApp: any) {
  nitroApp.hooks.hook("listen", (_server: any) => {
    console.log("[Nitro Plugin] ?? Inicializando Motor de Follow-ups SDR Valentina...");
    try {
      startSdrFollowupEngine();
    } catch (err: any) {
      console.error("[Nitro Plugin] ? Falha ao iniciar SdrFollowupEngine:", err?.message || err);
    }
  });
}
