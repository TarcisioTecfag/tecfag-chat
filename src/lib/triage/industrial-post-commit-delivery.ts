import { deterministicIndustrialHandoffConfirmMessageId } from "./industrial-silence-policy.ts";
import type { createIndustrialHandoffStore, IndustrialFlowKey } from "./industrial-handoff-store";
import type { notifyOperatorLeadTransferred } from "../valentina/operator-notifications";
import type { sendSdrChannelText } from "../valentina/sdr-channel-sender";
import { buildJournalSnapshot } from "./industrial-triage-journal.ts";
import { buildIndustrialBriefing } from "./industrial-briefing.ts";

export type IndustrialPostCommitItem = NonNullable<
  Awaited<ReturnType<ReturnType<typeof createIndustrialHandoffStore>["claimPostCommitOutbox"]>>
> & { key: IndustrialFlowKey };

/** O caminho imediato e o worker usam o mesmo contrato e preservam êxitos parciais. */
export async function deliverIndustrialPostCommit(
  item: IndustrialPostCommitItem,
  dependencies: {
    notifyOperator: typeof notifyOperatorLeadTransferred;
    getContactPhone: (tenantId: string, conversationId: string) => Promise<string>;
    sendText: typeof sendSdrChannelText;
  },
) {
  const { key, receipt, outbox, request } = item;
  const result = receipt.result;
  const data = request?.data || {};
  const operator = async () => {
    if (!item.needOperatorNotification || !result.operator) return false;
    return dependencies.notifyOperator({
      tenantId: key.tenantId,
      conversationId: key.conversationId,
      operatorId: result.operator.id,
      operatorName: result.operator.name,
      clientName: request?.clientName,
      company: request?.companyName,
      interest: data["MÁQUINA / PEÇA / INTERESSE"]?.value || request?.route.targetFunnel || "",
      targetFunnel: request?.route.targetFunnel || null,
      dealId: result.deal?.dealId || null,
      dealTitle: result.deal?.dealTitle || null,
      temperature: "quente",
      transferSource: "sdr_auto",
      cycle: key.cycle,
      triageBriefing: request
        ? "Dados no momento do encaminhamento; consulte revisões posteriores no atendimento.\n\n" +
          buildIndustrialBriefing(
            buildJournalSnapshot({
              id: key.flowId,
              tenantId: key.tenantId,
              conversationId: key.conversationId,
              startedAt: key.cycle,
              lastInteractionAt: receipt.committedAt,
              completedAt: receipt.committedAt,
              outcome: result.status === "transferred" ? "transferred" : "completed",
              currentStep: "Concluído",
              collectedData: request.data,
              metadata: {
                subflow: request.route.subflow,
                targetFunnel: request.route.targetFunnel,
                needsReview: request.route.needsReview,
                machineDecision: request.machineDecision,
                handoffReceipt: receipt,
              },
            }),
          ).text
        : undefined,
    });
  };
  const client = async () => {
    if (!item.needClientConfirmation || !outbox.clientConfirmationText) return false;
    const phone = await dependencies.getContactPhone(key.tenantId, key.conversationId);
    const sent = await dependencies.sendText({
      tenantId: key.tenantId,
      conversationId: key.conversationId,
      phone,
      text: outbox.clientConfirmationText,
      idempotencyMessageId: deterministicIndustrialHandoffConfirmMessageId(
        key.tenantId,
        key.flowId,
        key.cycle,
      ),
      expectedOperatorId: result.operator?.id || null,
      deliveryContext: { flowId: key.flowId, cycle: key.cycle },
    });
    return sent.sent;
  };
  const [operatorResult, clientResult] = await Promise.allSettled([operator(), client()]);
  return {
    operatorNotified: operatorResult.status === "fulfilled" && operatorResult.value === true,
    clientNotified: clientResult.status === "fulfilled" && clientResult.value === true,
  };
}
