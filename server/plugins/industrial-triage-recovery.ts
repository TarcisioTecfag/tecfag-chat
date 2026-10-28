export default function industrialTriageRecoveryPlugin(nitroApp: {
  hooks: { hook: (name: string, handler: () => void) => void };
}) {
  let stopped = false;
  let stopWorker: (() => void) | undefined;
  nitroApp.hooks.hook("close", () => {
    stopped = true;
    stopWorker?.();
  });
  void (async () => {
    const { db } = await import("../../src/db/index");
    const { agentFlowStates, conversations, contacts } = await import("../../src/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const { getAiPersona } = await import("../../src/lib/ai-persona");
    const { ensureLocalCrmDealBeforeTransfer } =
      await import("../../src/lib/valentina/sdr-crm-local");
    const { createIndustrialHandoffStore } =
      await import("../../src/lib/triage/industrial-handoff-store");
    const { recoverIndustrialHandoffs, recoverIndustrialPostCommitOutbox } =
      await import("../../src/lib/triage/industrial-handoff-recovery");
    const { deliverIndustrialPostCommit } =
      await import("../../src/lib/triage/industrial-post-commit-delivery");
    const { sendSdrChannelText } = await import("../../src/lib/valentina/sdr-channel-sender");
    const { recoverIndustrialInterruptedTurns } =
      await import("../../src/lib/valentina/sdr-recovery");
    const { SessionManager } = await import("../../src/lib/baileys/session-manager");
    const { SdrFollowupEngine } = await import("../../src/lib/valentina/sdr-followup-engine");
    const { recoverIndustrialBotOutbounds } = await import("../../src/lib/valentina/industrial-outbound");
    const { startPeriodicWorker } = await import("../../src/lib/periodic-worker");
    const { notifyOperatorLeadTransferred } =
      await import("../../src/lib/valentina/operator-notifications");
    if (stopped) return;
    const store = createIndustrialHandoffStore(db, ensureLocalCrmDealBeforeTransfer);
    const run = async () => {
      if (stopped) return;
      try {
        await recoverIndustrialHandoffs({
          database: db,
          store,
          isIndustrialTenant: (id) => getAiPersona(id).triagePolicy === "industrial",
          onCommitted: async (key, result) => {
            const [flow] = await db
              .select({ metadata: agentFlowStates.metadata })
              .from(agentFlowStates)
              .where(
                and(eq(agentFlowStates.tenantId, key.tenantId), eq(agentFlowStates.id, key.flowId)),
              );
            const metadata = (flow?.metadata || {}) as Record<string, unknown>;
            const manager = SessionManager.getInstance();
            if (result.operator)
              manager.notifyPublic(key.tenantId, {
                type: "chat_updated",
                chat: {
                  id: key.conversationId,
                  queue: "meus",
                  operatorId: result.operator.id,
                  walletOperatorId: result.operator.id,
                  responsibleName: result.operator.name,
                  version: result.conversationVersion,
                  sectorId: result.sectorId,
                },
              });
            manager.notifyPublic(key.tenantId, {
              type: "sdr_flow_updated",
              conversationId: key.conversationId,
              funnelStage:
                typeof metadata.funnelStage === "string" ? metadata.funnelStage : "triagem",
              targetFunnel:
                typeof metadata.targetFunnel === "string" ? metadata.targetFunnel : null,
              outcome: result.status === "resolved" ? "completed" : "transferred",
              handoffStatus: result.status,
            });
          },
        });
        await recoverIndustrialPostCommitOutbox({
          database: db,
          store,
          isIndustrialTenant: (id) => getAiPersona(id).triagePolicy === "industrial",
          deliverOutbox: (item) =>
            deliverIndustrialPostCommit(item, {
              notifyOperator: notifyOperatorLeadTransferred,
              sendText: sendSdrChannelText,
              getContactPhone: async (tenantId, conversationId) => {
                const [conv] = await db
                  .select({ contactId: conversations.contactId })
                  .from(conversations)
                  .where(
                    and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)),
                  )
                  .limit(1);
                if (!conv) return "";
                const [contact] = await db
                  .select({ phone: contacts.phone })
                  .from(contacts)
                  .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, conv.contactId)))
                  .limit(1);
                return contact?.phone || "";
              },
            }),
        });
        await recoverIndustrialBotOutbounds();
        await recoverIndustrialInterruptedTurns();
        await SdrFollowupEngine.getInstance().runIndustrialFollowupCycle();
      } catch {
        console.error(
          "[IndustrialRecovery] Falha ao recuperar encaminhamentos; checkpoints preservados.",
        );
        throw new Error("Recuperação industrial incompleta.");
      }
    };
    stopWorker = startPeriodicWorker("industrial-triage-recovery", run, 30_000);
  })().catch(() =>
    console.error("[IndustrialRecovery] Falha ao iniciar recuperação de encaminhamentos."),
  );
}
