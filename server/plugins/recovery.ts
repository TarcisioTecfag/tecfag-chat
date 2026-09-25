/**
 * Plugin Nitro: Inicialização do WhatsAppRecoveryService.
 * Monitora e recupera mensagens presas em 'sending' ou 'processing' após reinicialização/crash.
 */
export default function recoveryPlugin(nitroApp: any) {
  nitroApp.hooks.hook("listen", async () => {
    try {
      const { whatsAppRecoveryService } = await import("../../src/lib/whatsapp/recovery.js");
      whatsAppRecoveryService.startRecoveryWorker(30000);
    } catch (err: any) {
      console.error("[RecoveryPlugin] Erro ao inicializar WhatsAppRecoveryService:", err?.message || err);
    }
  });
}
