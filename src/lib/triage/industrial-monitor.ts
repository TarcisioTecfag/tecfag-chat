/** Projeção do estado persistido, sem expor prompts ou checkpoints brutos. */
import { describeHandoffIssue } from "./industrial-handoff-issues.ts";
import { readSiteContext } from "../livechat/site-context.ts";
import { readVtexEvidence } from "../vtex/contract.ts";
type Json = Record<string, unknown>;
const object = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.slice(0, 500) : null;
const iso = (value: unknown): string | null => {
  if (!(typeof value === "string" || value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isFinite(+date) ? date.toISOString() : null;
};
export function projectIndustrialMonitoring(
  flow: {
    startedAt: Date | string;
    outcome: string | null;
    metadata: unknown;
  },
  conversation: { operatorId: string | null; queueState: string } | null,
) {
  const meta = object(flow.metadata);
  const cycle = iso(flow.startedAt);
  const request = object(meta.handoffRequest);
  const receipt = object(meta.handoffReceipt);
  const result = object(receipt.result);
  const receiptOperator = object(result.operator);
  const validReceipt = Boolean(cycle && receipt.cycle === cycle && iso(receipt.committedAt));
  const validRequest = Boolean(cycle && request.cycle === cycle);
  const human = Boolean(conversation?.operatorId || conversation?.queueState === "meus");
  const confirmed =
    validReceipt &&
    result.status === "transferred" &&
    Boolean(conversation?.operatorId) &&
    receiptOperator.id === conversation?.operatorId &&
    conversation?.queueState === "meus";
  const link = (raw: unknown) => {
    const value = object(raw);
    return text(value.conversationId)
      ? { conversationId: text(value.conversationId)!, channel: text(value.channel) }
      : null;
  };
  const pendingApproval = object(meta.pendingApproval);
  const validPendingApproval = Boolean(
    meta.handoffStatus === "awaiting_approval" ||
      (Object.keys(pendingApproval).length > 0 && (!cycle || !pendingApproval.cycle || pendingApproval.cycle === cycle)),
  );
  const continuedTo = link(meta.continuedTo);
  const subflowText = text(meta.subflow);
  const isInformativeSubflow =
    subflowText === "5B_CURRICULO" || subflowText === "5C_COMPRAS";
  const informativeAutoClosed = Boolean(
    meta.informativeAutoClosed === true ||
      (isInformativeSubflow &&
        (flow.outcome === "completed" || meta.handoffStatus === "resolved")),
  );
  const dismissedByObj = object(meta.dismissedBy);
  const rawSdrHiddenByObj = object(meta.sdrHiddenBy);
  const sdrHiddenByObj =
    Object.keys(rawSdrHiddenByObj).length > 0 ? rawSdrHiddenByObj : dismissedByObj;
  const sdrHidden = Boolean(meta.sdrHidden === true || meta.dismissedBy);
  const informativeCloseLabel =
    subflowText === "5B_CURRICULO"
      ? "Encerrado · Currículos (Sólides)"
      : subflowText === "5C_COMPRAS"
        ? "Encerrado · Fornecedores / Parcerias"
        : "Ciclo encerrado";
  let state = "collecting",
    label = "Em triagem";
  if (continuedTo) {
    state = "continued";
    label = "Continuado em outro canal";
  } else if (conversation?.queueState === "finalizados") {
    state = "closed";
    label = informativeAutoClosed ? informativeCloseLabel : "Ciclo encerrado";
  } else if (human) {
    state = confirmed ? "transferred" : "manual";
    label = confirmed ? "Transferência confirmada" : "Atendimento humano";
  } else if (flow.outcome === "stopped" || flow.outcome === "escalated") {
    state = "stopped";
    label = "Automação interrompida";
  } else if (flow.outcome === "abandoned" || meta.funnelStage === "sem_resposta") {
    state = "no_response";
    label = "Sem resposta";
  } else if (validReceipt && result.status === "resolved") {
    state = "resolved";
    label = informativeAutoClosed ? informativeCloseLabel : "Resolvido pela automação";
  } else if (
    flow.outcome === "completed" ||
    flow.outcome === "transferred" ||
    conversation?.queueState === "finalizados"
  ) {
    state = "closed";
    label = informativeAutoClosed ? informativeCloseLabel : "Ciclo encerrado";
  } else if (validPendingApproval) {
    state = "awaiting_approval";
    label = "Aguardando aprovação SDR";
  } else if (conversation && conversation.queueState !== "automacao") {
    state = "manual_queue";
    label = "Aguardando atendimento humano";
  } else if (validRequest) {
    state = meta.handoffStatus === "waiting_for_team" ? "waiting_for_team" : "handoff_pending";
    label =
      state === "waiting_for_team" ? "Aguardando equipe disponível" : "Encaminhamento pendente";
  } else if (meta.readyForHandoff === true) {
    state = "ready";
    label = "Coleta pronta para encaminhamento";
  }
  const outbox = object(meta.handoffOutbox);
  const validOutbox = validReceipt && outbox.cycle === cycle;
  const assignmentChanged =
    validReceipt &&
    result.status === "transferred" &&
    (conversation?.queueState !== "meus" || conversation?.operatorId !== receiptOperator.id);
  const delivery = (required: unknown, acknowledged: unknown, cancelled: unknown) =>
    !validOutbox
      ? "unknown"
      : required === false
        ? "not_required"
        : iso(acknowledged)
          ? "sent"
          : iso(cancelled) || assignmentChanged
            ? "cancelled"
            : typeof outbox.attempts === "number" && outbox.attempts >= 6
              ? "failed"
              : "pending";
  const clientConfirmation = delivery(
    outbox.clientConfirmationRequired,
    outbox.clientNotifiedAt,
    outbox.clientCancelledAt,
  );
  const operatorNotification = delivery(
    outbox.operatorNotificationRequired,
    outbox.operatorNotifiedAt,
    outbox.operatorCancelledAt,
  );
  const machine = object(meta.machineDecision);
  return {
    state,
    label,
    subflow: text(meta.subflow),
    siteContext: readSiteContext(meta.siteContext),
    vtexLookup: readVtexEvidence(meta.vtexLookup),
    targetFunnel: text(meta.targetFunnel),
    reason: text(meta.routeReason),
    needsReview: meta.needsReview === true,
    missingFields: Array.isArray(meta.missingFields)
      ? meta.missingFields.filter((v): v is string => typeof v === "string").slice(0, 20)
      : [],
    machine: Object.keys(machine).length
      ? {
          status: text(machine.status),
          machineId: text(machine.machineId),
          line: text(machine.line),
          reason: text(machine.reason),
        }
      : null,
    operatorId: conversation?.operatorId || null,
    sectorId: validReceipt ? text(result.sectorId) : null,
    committedAt: validReceipt ? iso(receipt.committedAt) : null,
    clientConfirmation,
    operatorNotification,
    issue:
      validRequest &&
      !validReceipt &&
      ["handoff_pending", "waiting_for_team", "ready"].includes(state)
        ? describeHandoffIssue(meta.handoffIssue, cycle!)
        : null,
    clientIssue:
      validOutbox && ["pending", "failed"].includes(clientConfirmation)
        ? describeHandoffIssue(outbox.clientIssue, cycle!)
        : null,
    operatorIssue:
      validOutbox && ["pending", "failed"].includes(operatorNotification)
        ? describeHandoffIssue(outbox.operatorIssue, cycle!)
        : null,
    notificationAttempts:
      validOutbox && typeof outbox.attempts === "number" && Number.isSafeInteger(outbox.attempts)
        ? Math.max(0, outbox.attempts)
        : 0,
    notificationNextAttemptAt:
      validOutbox &&
      [clientConfirmation, operatorNotification].includes("pending") &&
      typeof outbox.attempts === "number" &&
      outbox.attempts < 6
        ? iso(outbox.nextAttemptAt)
        : null,
    attempts:
      typeof meta.handoffAttempts === "number" && Number.isFinite(meta.handoffAttempts)
        ? Math.max(0, meta.handoffAttempts)
        : 0,
    nextAttemptAt: validRequest && !validReceipt && !human ? iso(meta.handoffNextAttemptAt) : null,
    continuedFrom: link(meta.continuedFrom),
    continuedTo,
    informativeAutoClosed,
    sdrHidden,
    sdrHiddenAt: iso(sdrHiddenByObj.at),
    sdrHiddenByName: text(sdrHiddenByObj.operatorName),
    dismissedReason: text(dismissedByObj.reason),
    pendingApproval:
      state === "awaiting_approval" && Object.keys(pendingApproval).length > 0
        ? {
            preparedAt: iso(pendingApproval.preparedAt),
            subflow: text(pendingApproval.subflow),
            targetFunnel: text(pendingApproval.targetFunnel),
            destinationKey: text(pendingApproval.destinationKey),
            suggestedSectorId: text(pendingApproval.suggestedSectorId),
            suggestedSectorName: text(pendingApproval.suggestedSectorName),
            suggestedOperatorId: text(pendingApproval.suggestedOperatorId),
            suggestedOperatorName: text(pendingApproval.suggestedOperatorName),
            suggestedOperatorIsAbsent: pendingApproval.suggestedOperatorIsAbsent === true,
            suggestedBySectorFallback: pendingApproval.suggestedBySectorFallback === true,
            suggestedPipelineId: text(pendingApproval.suggestedPipelineId),
            suggestedPipelineName: text(pendingApproval.suggestedPipelineName),
            suggestedStageId: text(pendingApproval.suggestedStageId),
            suggestedStageName: text(pendingApproval.suggestedStageName),
            reason: text(pendingApproval.reason),
            needsReview: pendingApproval.needsReview === true,
            highCapitalSocialAlert: pendingApproval.highCapitalSocialAlert === true,
            capitalSocial:
              typeof pendingApproval.capitalSocial === "number" &&
              Number.isFinite(pendingApproval.capitalSocial)
                ? pendingApproval.capitalSocial
                : null,
            modelSelectionPending: pendingApproval.modelSelectionPending === true,
            dealId: text(pendingApproval.dealId),
          }
        : null,
    triageAccuracy:
      meta.triageAccuracy && typeof meta.triageAccuracy === "object" && !Array.isArray(meta.triageAccuracy)
        ? (meta.triageAccuracy as Record<string, unknown>)
        : null,
  };
}
export type IndustrialMonitoring = ReturnType<typeof projectIndustrialMonitoring>;
