import { createHash } from "node:crypto";
import { z } from "zod";
import { isValidTriageDocument } from "./industrial-policy.ts";

export const INDUSTRIAL_REVIEW_FIELDS = [
  "NOME COMPLETO",
  "EMPRESA",
  "CNPJ OU CPF",
  "CNPJ",
  "CPF",
  "EMAIL",
  "RAMO / O QUE EMBALA",
  "MÁQUINA / PEÇA / INTERESSE",
  "VOLUME / PRODUÇÃO",
  "SOLICITAÇÃO",
  "MODELO DA MÁQUINA",
  "NÚMERO DO PEDIDO",
] as const;
const documents = new Set(["CNPJ OU CPF", "CNPJ", "CPF"]);
const field = z
  .object({ value: z.string().trim().max(2000), status: z.enum(["filled", "pending"]) })
  .strict();
export const industrialReviewInput = z
  .object({
    conversationId: z.string().min(1).max(240),
    cycleId: z.string().min(1).max(600),
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.string().trim().min(5).max(1000),
    fields: z.record(field).superRefine((fields, ctx) => {
      if (Object.keys(fields).length > INDUSTRIAL_REVIEW_FIELDS.length)
        ctx.addIssue({ code: "custom", message: "Campos demais." });
      let documentCount = 0;
      for (const [key, entry] of Object.entries(fields)) {
        if (!(INDUSTRIAL_REVIEW_FIELDS as readonly string[]).includes(key))
          ctx.addIssue({ code: "custom", message: "Campo não editável." });
        if (documents.has(key)) documentCount++;
        if (entry.status === "filled" && !entry.value)
          ctx.addIssue({ code: "custom", message: "Campo preenchido exige valor." });
        if (documents.has(key) && entry.status === "filled" && !isValidTriageDocument(entry.value))
          ctx.addIssue({
            code: "custom",
            message: "Documento inválido; corrija ou deixe pendente.",
          });
      }
      if (documentCount > 1)
        ctx.addIssue({ code: "custom", message: "Informe somente um campo de documento." });
    }),
  })
  .strict();
export type IndustrialReviewInput = z.infer<typeof industrialReviewInput>;
export interface ReviewActor {
  id: string;
  name: string;
  role: string;
  permissions: {
    canView: boolean;
    canViewAll: boolean;
    canEditClientInfo: boolean;
    canSendInternalNotes: boolean;
    canOverrideChat: boolean;
  };
}
export function reviewDataHash(data: unknown) {
  const rows =
    data && typeof data === "object" && !Array.isArray(data)
      ? Object.entries(data)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => {
            const field =
              value && typeof value === "object" ? (value as Record<string, unknown>) : {};
            return [key, field.status, field.value];
          })
      : [];
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
export function readHumanReview(raw: unknown, cycle: string, data: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (
    row.version !== 1 ||
    row.cycle !== cycle ||
    typeof row.operatorId !== "string" ||
    !row.operatorId ||
    typeof row.operatorName !== "string" ||
    typeof row.reason !== "string" ||
    typeof row.reviewedAt !== "string" ||
    !Number.isFinite(Date.parse(row.reviewedAt)) ||
    typeof row.dataHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.dataHash)
  )
    return null;
  return {
    version: 1 as const,
    operatorId: row.operatorId.slice(0, 240),
    operatorName: row.operatorName.slice(0, 200),
    reviewedAt: new Date(row.reviewedAt).toISOString(),
    reason: row.reason.slice(0, 1000),
    dataHash: row.dataHash,
    current: row.dataHash === reviewDataHash(data),
  };
}
export function reviewAccess(
  actor: ReviewActor,
  conversation: { operatorId: string | null; queueState: string },
  flow: { startedAt: Date | string; outcome: string | null; metadata: unknown },
) {
  const admin = actor.role === "admin";
  const owner = conversation.operatorId === actor.id;
  const visible =
    admin ||
    (actor.permissions.canView &&
      (owner || !conversation.operatorId || actor.permissions.canViewAll));
  if (!visible) return { visible: false, editable: false, reason: "Permissão insuficiente." };
  const meta =
    flow.metadata && typeof flow.metadata === "object"
      ? (flow.metadata as Record<string, unknown>)
      : {};
  const request = meta.handoffRequest as { cycle?: unknown } | undefined;
  const receipt = meta.handoffReceipt as { cycle?: unknown } | undefined;
  const cycle = new Date(flow.startedAt).toISOString();
  if (conversation.queueState === "finalizados" || meta.continuedTo)
    return {
      visible,
      editable: false,
      reason: "Este atendimento está encerrado ou continuou em outro canal.",
    };
  if (
    (!conversation.operatorId && flow.outcome === "in_progress") ||
    (flow.outcome === "in_progress" && request?.cycle === cycle && receipt?.cycle !== cycle)
  )
    return {
      visible,
      editable: false,
      reason: "Interrompa a IA ou conclua o encaminhamento antes de revisar os dados.",
    };
  if (
    !admin &&
    (!actor.permissions.canEditClientInfo ||
      !actor.permissions.canSendInternalNotes ||
      (!owner && !actor.permissions.canOverrideChat))
  )
    return {
      visible,
      editable: false,
      reason:
        "A revisão exige permissão de editar dados e notas, além da posse ou permissão de sobrepor o atendimento.",
    };
  return { visible, editable: true, reason: null };
}
