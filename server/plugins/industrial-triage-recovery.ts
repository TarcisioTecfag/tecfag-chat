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
    const { agentFlowStates, conversations, contacts } = await import("../../src/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const { getAiPersona } = await import("../../src/lib/ai-persona");
    const { ensureLocalCrmDealBeforeTransfer } =
      await import("../../src/lib/valentina/sdr-crm-local");
    const { createIndustrialHandoffStore } =
      await import("../../src/lib/triage/industrial-handoff-store");
    const { recoverIndustrialHandoffs, recoverIndustrialPostCommitOutbox } =
      await import("../../src/lib/triage/industrial-handoff-recovery");
    const { industrialClientMessages } =
      await import("../../src/lib/triage/industrial-handoff");
    const { resolveIndustrialRoute } =
      await import("../../src/lib/triage/industrial-policy");
    const { deterministicIndustrialHandoffConfirmMessageId } =
      await import("../../src/lib/triage/industrial-silence-policy");
    const { sendSdrChannelText } =
      await import("../../src/lib/valentina/sdr-channel-sender");
    const { recoverIndustrialInterruptedTurns } =
      await import("../../src/lib/valentina/sdr-recovery");
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
            const [flow] = await db
              .select({ metadata: agentFlowStates.metadata })
              .from(agentFlowStates)
              .where(
                and(eq(agentFlowStates.tenantId, key.tenantId), eq(agentFlowStates.id, key.flowId)),
              );
            const metadata = (flow?.metadata || {}) as Record<string, unknown>;
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
                  version: result.conversationVersion,
                  sectorId: result.sectorId,
                },
              });
              const opNotified = await notifyOperatorLeadTransferred({
                tenantId: key.tenantId,
                conversationId: key.conversationId,
                operatorId: result.operator.id,
                operatorName: result.operator.name,
                dealId: result.deal?.dealId || null,
                dealTitle: result.deal?.dealTitle || null,
                temperature: "quente",
                transferSource: "sdr_auto",
                cycle: key.cycle,
              });
              if (opNotified) {
                await store.ackPostCommit(key, { operatorNotified: true });
              }
            }
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
          deliverPostCommit: async ({ key, receipt, outbox, request, collectedData, metadata }) => {
            let operatorNotified = outbox.operatorNotified;
            let clientNotified = outbox.clientNotified;

            if (!operatorNotified) {
              if (!receipt.operator) {
                operatorNotified = true;
              } else {
                const clientName =
                  String((collectedData["NOME COMPLETO"] as any)?.value || "").trim() ||
                  request?.clientName ||
                  "Cliente";
                const company =
                  String((collectedData["EMPRESA"] as any)?.value || "").trim() ||
                  request?.companyName ||
                  "Empresa não informada";
                const interest =
                  String(
                    (collectedData["MÁQUINA / PEÇA / INTERESSE"] as any)?.value ||
                      (collectedData["PRODUTO DE INTERESSE"] as any)?.value ||
                      "",
                  ).trim() ||
                  request?.route?.targetFunnel ||
                  "";
                operatorNotified = await notifyOperatorLeadTransferred({
                  tenantId: key.tenantId,
                  conversationId: key.conversationId,
                  operatorId: receipt.operator.id,
                  operatorName: receipt.operator.name,
                  clientName,
                  company,
                  interest,
                  targetFunnel:
                    request?.route?.targetFunnel ||
                    (typeof metadata.targetFunnel === "string" ? metadata.targetFunnel : null),
                  dealId: receipt.deal?.dealId || null,
                  dealTitle: receipt.deal?.dealTitle || null,
                  temperature: "quente",
                  transferSource: "sdr_auto",
                  cycle: key.cycle,
                });
              }
            }

            if (!clientNotified) {
              const route =
                request?.route ||
                resolveIndustrialRoute({
                  text: "",
                  collectedData: collectedData as any,
                  existingStage:
                    typeof metadata.funnelStage === "string" ? metadata.funnelStage : "triagem",
                  existingFunnel:
                    typeof metadata.targetFunnel === "string" ? metadata.targetFunnel : null,
                  existingSubflow:
                    typeof metadata.subflow === "string" ? (metadata.subflow as any) : null,
                });
              const confirmBubbles = industrialClientMessages({
                result: {
                  status: receipt.status,
                  operator: receipt.operator,
                  deal: receipt.deal,
                  sectorId: receipt.sectorId,
                  conversationVersion: receipt.conversationVersion,
                },
                route,
                data: collectedData as any,
                messages: [],
              });

              let contactPhone = "";
              const [conv] = await db
                .select({ contactId: conversations.contactId })
                .from(conversations)
                .where(
                  and(
                    eq(conversations.id, key.conversationId),
                    eq(conversations.tenantId, key.tenantId),
                  ),
                )
                .limit(1);
              if (conv?.contactId) {
                const [cnt] = await db
                  .select({ phone: contacts.phone })
                  .from(contacts)
                  .where(
                    and(eq(contacts.id, conv.contactId), eq(contacts.tenantId, key.tenantId)),
                  )
                  .limit(1);
                contactPhone = cnt?.phone || conv.contactId.replace(/^c-/, "");
              }

              const baseMsgId = deterministicIndustrialHandoffConfirmMessageId(
                key.tenantId,
                key.flowId,
                key.cycle,
              );
              let allSent = true;
              for (let i = 0; i < confirmBubbles.length; i++) {
                const bubble = confirmBubbles[i];
                const msgId = i === 0 ? baseMsgId : `${baseMsgId}-${i}`;
                const sendRes = await sendSdrChannelText({
                  tenantId: key.tenantId,
                  conversationId: key.conversationId,
                  phone: contactPhone,
                  text: bubble,
                  idempotencyMessageId: msgId,
                  expectedOperatorId: receipt.operator?.id || null,
                });
                if (!sendRes.sent) {
                  allSent = false;
                  break;
                }
              }
              clientNotified = allSent;
            }

            return { operatorNotified, clientNotified };
          },
        });

        await recoverIndustrialInterruptedTurns();
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
