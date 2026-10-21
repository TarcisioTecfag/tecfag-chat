import { createHash } from "node:crypto";
import { readHandoffIssue } from "./industrial-handoff-issues.ts";
import { readHumanReview } from "./industrial-review-contract.ts";
import { readSiteContext } from "../livechat/site-context.ts";
export type TriageJournalKind =
  | "collection"
  | "handoff"
  | "archive"
  | "continuity"
  | "manual_stop"
  | "legacy_summary"
  | "human_review"
  | "status";
export interface JournalFlow {
  id: string;
  conversationId: string;
  tenantId: string;
  startedAt: Date | string;
  lastInteractionAt: Date | string;
  completedAt?: Date | string | null;
  outcome?: string | null;
  currentStep: string;
  collectedData: unknown;
  metadata: unknown;
}
const object = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
const text = (raw: unknown, limit = 500): string | null =>
  typeof raw === "string" && raw.trim() ? raw.slice(0, limit) : null;
export const journalIso = (raw: unknown): string | null => {
  if (!(typeof raw === "string" || raw instanceof Date)) return null;
  const value = new Date(raw);
  return Number.isFinite(+value) ? value.toISOString() : null;
};
export function normalizeJournalData(raw: unknown) {
  const output: Record<string, { value: string; status: "filled" | "pending" }> = {};
  for (const [key, rawField] of Object.entries(object(raw))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 30)) {
    if (!key.trim() || key.length > 120 || ["__proto__", "constructor", "prototype"].includes(key))
      continue;
    const field = object(rawField);
    if (field.status !== "filled" && field.status !== "pending") continue;
    output[key] = { value: text(field.value, 2000) || "", status: field.status };
  }
  return output;
}
export function buildJournalSnapshot(flow: JournalFlow) {
  const startedAt = journalIso(flow.startedAt);
  if (!startedAt) throw new Error("Início do ciclo inválido");
  const meta = object(flow.metadata);
  const receipt = object(meta.handoffReceipt);
  const result = receipt.cycle === startedAt ? object(receipt.result) : {};
  const operator = object(result.operator);
  const machine = object(meta.machineDecision);
  return {
    cycleId: `${flow.id}:${startedAt}`,
    flowId: flow.id,
    startedAt,
    lastInteractionAt: journalIso(flow.lastInteractionAt),
    completedAt: journalIso(flow.completedAt),
    outcome: text(flow.outcome, 80),
    currentStep: text(flow.currentStep, 200),
    collectedData: normalizeJournalData(flow.collectedData),
    siteContext: readSiteContext(meta.siteContext),
    humanReview: readHumanReview(
      meta.humanReview,
      startedAt,
      normalizeJournalData(flow.collectedData),
    ),
    subflow: text(meta.subflow, 100),
    targetFunnel: text(meta.targetFunnel, 200),
    needsReview: meta.needsReview === true,
    issueCode: readHandoffIssue(meta.handoffIssue, startedAt)?.code || null,
    missingFields: Array.isArray(meta.missingFields)
      ? meta.missingFields.filter((v): v is string => typeof v === "string").slice(0, 20)
      : [],
    machine: Object.keys(machine).length
      ? {
          machineId: text(machine.machineId),
          line: text(machine.line, 80),
          status: text(machine.status, 80),
        }
      : null,
    responsible:
      result.status === "transferred" && text(operator.id)
        ? { id: text(operator.id)!, name: text(operator.name) }
        : null,
    dealId: text(object(result.deal).dealId),
  };
}
export type JournalSnapshot = ReturnType<typeof buildJournalSnapshot>;
export function readJournalSnapshot(raw: unknown): JournalSnapshot | null {
  const row = object(raw);
  const startedAt = journalIso(row.startedAt);
  const flowId = text(row.flowId, 240);
  if (!startedAt || !flowId || row.cycleId !== `${flowId}:${startedAt}`) return null;
  const responsible = object(row.responsible);
  const normalized = buildJournalSnapshot({
    id: flowId,
    tenantId: "",
    conversationId: "",
    startedAt,
    lastInteractionAt: journalIso(row.lastInteractionAt) || startedAt,
    completedAt: journalIso(row.completedAt),
    outcome: text(row.outcome),
    currentStep: text(row.currentStep, 200) || "",
    collectedData: row.collectedData,
    metadata: {
      subflow: row.subflow,
      siteContext: row.siteContext,
      targetFunnel: row.targetFunnel,
      needsReview: row.needsReview,
      missingFields: row.missingFields,
      machineDecision: row.machine,
      humanReview:
        row.humanReview && typeof row.humanReview === "object"
          ? { ...row.humanReview, cycle: startedAt }
          : null,
    },
  });
  return {
    ...normalized,
    responsible: text(responsible.id)
      ? { id: text(responsible.id)!, name: text(responsible.name) }
      : null,
    dealId: text(row.dealId),
    issueCode:
      typeof row.issueCode === "string"
        ? readHandoffIssue(
            { version: 1, cycle: startedAt, code: row.issueCode, occurredAt: startedAt },
            startedAt,
          )?.code || null
        : null,
  };
}
function comparable(snapshot: JournalSnapshot) {
  const { lastInteractionAt: _interaction, ...rest } = snapshot;
  void _interaction;
  return JSON.stringify(rest);
}
export function buildJournalEntry(
  before: JournalFlow | null,
  after: JournalFlow,
  kind: TriageJournalKind,
  sourceKey: string,
) {
  const snapshot = buildJournalSnapshot(after);
  const prior = before ? buildJournalSnapshot(before) : null;
  if (kind !== "archive" && prior && comparable(prior) === comparable(snapshot)) return null;
  const changedFields = [
    ...new Set([
      ...Object.keys(prior?.collectedData || {}),
      ...Object.keys(snapshot.collectedData),
    ]),
  ].filter(
    (key) =>
      JSON.stringify(prior?.collectedData[key]) !== JSON.stringify(snapshot.collectedData[key]),
  );
  const labels = {
    legacy_summary: "Resumo legado preservado (coleta e notas originais indisponíveis)",
    collection: "Coleta atualizada",
    handoff: "Situação do encaminhamento atualizada",
    archive: "Ciclo de triagem arquivado",
    continuity: "Continuidade entre canais registrada",
    manual_stop: "Triagem interrompida pelo operador",
    human_review: "Dados revisados por operador",
    status: "Situação do ciclo atualizada",
  };
  const content = [
    labels[kind],
    ...changedFields.map(
      (key) =>
        `${key}: ${!snapshot.collectedData[key] ? "Dado removido" : snapshot.collectedData[key].status === "filled" ? snapshot.collectedData[key].value : "Aguardando confirmação"}`,
    ),
    snapshot.targetFunnel ? `Destino: ${snapshot.targetFunnel}` : "",
    snapshot.needsReview ? "Revisão humana necessária." : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 12_000);
  const id = `triage-note-${createHash("sha256")
    .update(
      JSON.stringify([
        after.tenantId,
        after.conversationId,
        snapshot.cycleId,
        kind,
        sourceKey,
        prior && comparable(prior),
        comparable(snapshot),
      ]),
    )
    .digest("hex")
    .slice(0, 40)}`;
  return {
    id,
    content,
    metadata: { version: 1 as const, kind, cycleId: snapshot.cycleId, snapshot, changedFields },
  };
}
