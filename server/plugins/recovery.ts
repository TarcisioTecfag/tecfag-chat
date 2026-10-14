/**
 * Plugin Nitro: Inicialização do WhatsAppRecoveryService.
 * Monitora e recupera mensagens presas em 'sending' ou 'processing' após reinicialização/crash.
 */
export default function recoveryPlugin(nitroApp: {
  hooks: { hook: (name: string, handler: () => void) => void };
}) {
  // Commercial delivery must start even if WhatsApp/inbox initialization fails or is busy.
  void import("../../src/lib/rd-marketing/commercial-recovery.js")
    .then(({ rdCommercialRecovery }) => {
      rdCommercialRecovery.start();
      nitroApp.hooks.hook("close", () => rdCommercialRecovery.stop());
    })
    .catch(() => console.error("[RecoveryPlugin] Falha ao iniciar o processador comercial RD."));
  // Nitro 3 não emite listen no runtime Node. Iniciar no carregamento do plugin.
  void (async () => {
    try {
      const { whatsAppRecoveryService } = await import("../../src/lib/whatsapp/recovery.js");
      whatsAppRecoveryService.startRecoveryWorker(30000);
      const { runRdMarketingRecovery } = await import("../../src/lib/rd-marketing/inbox.js");
      const run = () =>
        runRdMarketingRecovery().catch(() =>
          console.error("[RecoveryPlugin] Falha na recuperação RD; eventos preservados."),
        );
      void run();
      const timer = setInterval(run, 15_000);
      timer.unref();
      nitroApp.hooks.hook("close", () => {
        clearInterval(timer);
        whatsAppRecoveryService.stopRecoveryWorker();
      });
      const { SlaEngine } = await import("../../src/lib/sla-engine.js");
      const { AuditService } = await import("../../src/lib/audit-service.js");
      const { SupervisorEngine } = await import("../../src/lib/valentina/supervisor-engine.js");
      SlaEngine.getInstance().start();
      AuditService.getInstance().start();
      SupervisorEngine.getInstance().start();
      nitroApp.hooks.hook("close", () => {
        SlaEngine.getInstance().stop();
        AuditService.getInstance().stop();
        SupervisorEngine.getInstance().stop();
      });
    } catch (err: unknown) {
      console.error(
        "[RecoveryPlugin] Erro ao inicializar WhatsAppRecoveryService:",
        err instanceof Error ? err.message : "Falha não identificada.",
      );
    }
  })();
}
