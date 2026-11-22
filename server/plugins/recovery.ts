/**
 * Plugin Nitro: Inicialização do WhatsAppRecoveryService.
 * Monitora e recupera mensagens presas em 'sending' ou 'processing' após reinicialização/crash.
 */
export default function recoveryPlugin(nitroApp: {
  hooks: { hook: (name: string, handler: () => void | Promise<void>) => void };
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
      const { webhookDeliveryWorker } = await import("../../src/lib/webhooks/dispatcher.js");
      const { ensureTecfagManualsKnowledgePopulated } = await import(
        "../../src/lib/valentina/knowledge-service.js"
      );
      void ensureTecfagManualsKnowledgePopulated("tecfag").catch((err) =>
        console.warn("[RecoveryPlugin] Aviso ao sincronizar manuais RAG da Tecfag:", err?.message),
      );
      SlaEngine.getInstance().start();
      AuditService.getInstance().start();
      SupervisorEngine.getInstance().start();
      webhookDeliveryWorker.start(15_000);
      nitroApp.hooks.hook("close", async () => {
        SlaEngine.getInstance().stop();
        AuditService.getInstance().stop();
        SupervisorEngine.getInstance().stop();
        webhookDeliveryWorker.stop();
        try {
          const { SessionManager } = await import("../../src/lib/baileys/session-manager.js");
          await Promise.race([
            SessionManager.shutdownIfInitialized(),
            new Promise<void>((resolve) => setTimeout(resolve, 4000)),
          ]);
        } catch (err: unknown) {
          console.warn(
            "[RecoveryPlugin] Aviso ao encerrar SessionManager no hook close:",
            err instanceof Error ? err.message : String(err ?? ""),
          );
        }
      });
    } catch (err: unknown) {
      console.error(
        "[RecoveryPlugin] Erro ao inicializar WhatsAppRecoveryService:",
        err instanceof Error ? err.message : "Falha não identificada.",
      );
    }
  })();
}
