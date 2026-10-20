export default function industrialTriageRecoveryPlugin(nitroApp: {
  hooks: { hook: (name: string, handler: () => void) => void };
}) {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  nitroApp.hooks.hook("close", () => {
    stopped = true;
    if (timer) clearInterval(timer);
  });
  void (async () => {
    const { db } = await import("../../src/db/index");
    const { getAiPersona } = await import("../../src/lib/ai-persona");
    const { ensureLocalCrmDealBeforeTransfer } =
      await import("../../src/lib/valentina/sdr-crm-local");
    const { createIndustrialHandoffStore } =
      await import("../../src/lib/triage/industrial-handoff-store");
    const { recoverIndustrialHandoffs } =
      await import("../../src/lib/triage/industrial-handoff-recovery");
    const { SessionManager } = await import("../../src/lib/baileys/session-manager");
    const { notifyOperatorLeadTransferred } =
      await import("../../src/lib/valentina/operator-notifications");
    if (stopped) return;
    const store = createIndustrialHandoffStore(db, ensureLocalCrmDealBeforeTransfer);
    let running = false;
    const run = async () => {
      if (stopped || running) return;
      running = true;
      try {
        await recoverIndustrialHandoffs({
          database: db,
          store,
          isIndustrialTenant: (id) => getAiPersona(id).triagePolicy === "industrial",
          onCommitted: async (key, result) => {
            const manager = SessionManager.getInstance();
            if (result.operator) {
              manager.notifyPublic(key.tenantId, {
                type: "chat_updated",
                chat: {
                  id: key.conversationId,
                  queue: "meus",
                  operatorId: result.operator.id,
                  walletOperatorId: result.operator.id,
                  responsibleName: result.operator.name,
                },
              });
              await notifyOperatorLeadTransferred({
                tenantId: key.tenantId,
                conversationId: key.conversationId,
                operatorId: result.operator.id,
                operatorName: result.operator.name,
                dealId: result.deal?.dealId || null,
                dealTitle: result.deal?.dealTitle || null,
                temperature: "quente",
                transferSource: "sdr_auto",
              });
            }
            manager.notifyPublic(key.tenantId, {
              type: "sdr_flow_updated",
              conversationId: key.conversationId,
              outcome: result.status === "resolved" ? "completed" : "transferred",
              handoffStatus: result.status,
            });
          },
        });
      } catch {
        console.error(
          "[IndustrialRecovery] Falha ao recuperar encaminhamentos; checkpoints preservados.",
        );
      } finally {
        running = false;
      }
    };
    void run();
    timer = setInterval(() => void run(), 30_000);
    timer.unref();
  })().catch(() =>
    console.error("[IndustrialRecovery] Falha ao iniciar recuperação de encaminhamentos."),
  );
}
