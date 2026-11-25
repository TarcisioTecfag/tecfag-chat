import { registerShutdownTask } from "../../src/lib/graceful-shutdown";

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
      const stopRdCommercial = () => rdCommercialRecovery.stop();
      nitroApp.hooks.hook("close", stopRdCommercial);
      registerShutdownTask("rd-commercial-recovery", "workers", stopRdCommercial);
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
      const stopRecovery = () => {
        clearInterval(timer);
        whatsAppRecoveryService.stopRecoveryWorker();
      };
      nitroApp.hooks.hook("close", stopRecovery);
      registerShutdownTask("whatsapp-and-rd-recovery", "workers", stopRecovery);
      const { SlaEngine } = await import("../../src/lib/sla-engine.js");
      const { AuditService } = await import("../../src/lib/audit-service.js");
      const { SupervisorEngine } = await import("../../src/lib/valentina/supervisor-engine.js");
      const { webhookDeliveryWorker } = await import("../../src/lib/webhooks/dispatcher.js");
      const { SdrFollowupEngine } = await import("../../src/lib/valentina/sdr-followup-engine.js");
      const { flushPendingMcpAuditLogs } = await import("../../src/lib/mcp/mcp-audit-store.js");
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
      const stopEngines = () => {
        SlaEngine.getInstance().stop();
        AuditService.getInstance().stop();
        SupervisorEngine.getInstance().stop();
        webhookDeliveryWorker.stop();
        SdrFollowupEngine.getInstance().stop();
      };
      registerShutdownTask("background-engines", "workers", stopEngines);
      registerShutdownTask("mcp-audit-flush", "services", async () => {
        await Promise.race([
          flushPendingMcpAuditLogs(),
          new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 1_500);
            t.unref();
          }),
        ]);
      });
      nitroApp.hooks.hook("close", async () => {
        stopEngines();
      });
    } catch (err: unknown) {
      console.error(
        "[RecoveryPlugin] Erro ao inicializar WhatsAppRecoveryService:",
        err instanceof Error ? err.message : "Falha não identificada.",
      );
    }
  })();
}
