import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  operatorOnboarding,
  whatsappConnections,
  commercialConsultantProfiles,
} from "../../db/schema";
import type { AuthSessionContext } from "../auth-session";
import { whatsappConnectionAccessCondition } from "../access-control/conversation-access";
import { canManageWhatsappConnection } from "../access-control/channel-permissions";
import { multiConnectionEnabled } from "../whatsapp/connection-policy";
import { ONBOARDING_STEPS_BY_ID, ONBOARDING_CHAPTERS_BY_ID } from "./manifest";
import {
  computeOnboardingCoverage,
  isOnboardingEnabledForTenant,
  resolveEligiblePrimaryViews,
  resolveNextApplicableStepId,
  type OnboardingEligibilityContext,
} from "./policy";
import {
  OPERATOR_TOUR_CONTENT_VERSION,
  OPERATOR_TOUR_KEY,
  PRIMARY_OPERATOR_VIEWS,
  type OnboardingAction,
  type OnboardingPatchInput,
  type OnboardingProgressDTO,
  type OnboardingStatus,
  type OnboardingUnavailableStepRecord,
  type OperatorTourView,
} from "./types";

export interface OnboardingRecordSnapshot {
  id: string;
  tenantId: string;
  operatorId: string;
  tourKey: string;
  contentVersion: number;
  runId: string;
  status: OnboardingStatus;
  currentStepId: string | null;
  visitedStepIds: string[];
  completedStepIds: string[];
  completedSteps: string[];
  unavailableSteps: OnboardingUnavailableStepRecord[];
  startedAt: Date | null;
  pausedAt: Date | null;
  updatedAt: Date;
  completedAt: Date | null;
  lastCompletedVersion: number | null;
  lastCompletedAt: Date | null;
  deferredUntil: Date | null;
  revision: number;
}

export type OnboardingMutationOutcome =
  | {
      ok: true;
      record: OnboardingRecordSnapshot;
      dto: OnboardingProgressDTO;
    }
  | {
      ok: false;
      status: 400 | 409 | 422;
      code:
        | "INVALID_PAYLOAD"
        | "UNKNOWN_FIELD"
        | "INVALID_STEP_ID"
        | "REVISION_CONFLICT"
        | "RUN_ID_CONFLICT"
        | "INCOMPLETE_TOUR_COVERAGE";
      error: string;
      missingStepIds?: string[];
      dto?: OnboardingProgressDTO;
    };

const ALLOWED_PATCH_KEYS = new Set([
  "action",
  "contentVersion",
  "runId",
  "revision",
  "expectedRevision",
  "currentStepId",
  "stepId",
  "chapterId",
  "viewport",
  "visitedStepIds",
  "completedStepIds",
  "unavailableSteps",
  "deferMinutes",
  "deferHours",
]);

const ALLOWED_ACTIONS = new Set<OnboardingAction>([
  "start",
  "checkpoint",
  "pause",
  "defer",
  "resume",
  "restart",
  "complete_chapter",
  "complete",
]);

const MAX_STEP_ID_LIST = 512;

function sanitizeStepIdList(
  raw: unknown,
):
  | { ok: true; ids: string[] }
  | { ok: false; code: "INVALID_PAYLOAD" | "INVALID_STEP_ID"; error: string } {
  if (raw === undefined) return { ok: true, ids: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, code: "INVALID_PAYLOAD", error: "Lista de etapas deve ser um array." };
  }
  if (raw.length > MAX_STEP_ID_LIST) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      error: "Lista de etapas excede o limite permitido.",
    };
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !ONBOARDING_STEPS_BY_ID.has(item)) {
      return {
        ok: false,
        code: "INVALID_STEP_ID",
        error: `Etapa inválida ou desconhecida: ${String(item)}`,
      };
    }
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return { ok: true, ids: result };
}

function sanitizeUnavailableSteps(
  raw: unknown,
):
  | { ok: true; items: OnboardingUnavailableStepRecord[] }
  | { ok: false; code: "INVALID_PAYLOAD" | "INVALID_STEP_ID"; error: string } {
  if (raw === undefined) return { ok: true, items: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, code: "INVALID_PAYLOAD", error: "unavailableSteps deve ser um array." };
  }
  if (raw.length > MAX_STEP_ID_LIST) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      error: "unavailableSteps excede o limite permitido.",
    };
  }
  const byStep = new Map<string, OnboardingUnavailableStepRecord>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      return { ok: false, code: "INVALID_PAYLOAD", error: "Item inválido em unavailableSteps." };
    }
    const rec = entry as Record<string, unknown>;
    const stepId = rec.stepId;
    const reason = rec.reason;
    const recordedAt =
      typeof rec.recordedAt === "string" && rec.recordedAt.trim()
        ? rec.recordedAt
        : new Date().toISOString();
    if (typeof stepId !== "string" || !ONBOARDING_STEPS_BY_ID.has(stepId)) {
      return {
        ok: false,
        code: "INVALID_STEP_ID",
        error: `stepId inválido em unavailableSteps: ${String(stepId)}`,
      };
    }
    if (typeof reason !== "string" || !reason.trim() || reason.length > 160) {
      return { ok: false, code: "INVALID_PAYLOAD", error: "reason inválido em unavailableSteps." };
    }
    byStep.set(stepId, {
      stepId,
      reason: reason.trim(),
      recordedAt,
    });
  }
  return { ok: true, items: Array.from(byStep.values()) };
}

export function validateOnboardingPatchPayload(
  rawBody: unknown,
):
  | { ok: true; input: OnboardingPatchInput }
  | { ok: false; code: "INVALID_PAYLOAD" | "UNKNOWN_FIELD" | "INVALID_STEP_ID"; error: string } {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return { ok: false, code: "INVALID_PAYLOAD", error: "Payload deve ser um objeto JSON." };
  }
  const obj = rawBody as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_PATCH_KEYS.has(key)) {
      return { ok: false, code: "UNKNOWN_FIELD", error: `Campo não permitido no payload: ${key}` };
    }
  }

  const action = obj.action;
  if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action as OnboardingAction)) {
    return { ok: false, code: "INVALID_PAYLOAD", error: "Ação de onboarding inválida." };
  }
  if (
    action === "complete_chapter" &&
    (typeof obj.chapterId !== "string" || !ONBOARDING_CHAPTERS_BY_ID.has(obj.chapterId as any))
  ) {
    return { ok: false, code: "INVALID_PAYLOAD", error: "Capítulo inválido." };
  }

  if (
    obj.runId !== undefined &&
    obj.runId !== null &&
    (typeof obj.runId !== "string" || !obj.runId.trim() || obj.runId.length > 120)
  ) {
    return { ok: false, code: "INVALID_PAYLOAD", error: "runId inválido." };
  }

  const rawRevision = obj.revision ?? obj.expectedRevision;
  if (
    rawRevision !== undefined &&
    (typeof rawRevision !== "number" || !Number.isInteger(rawRevision) || rawRevision < 0)
  ) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      error: "revision deve ser um inteiro não-negativo.",
    };
  }

  const rawStepId = obj.currentStepId !== undefined ? obj.currentStepId : obj.stepId;
  if (rawStepId !== undefined && rawStepId !== null) {
    if (typeof rawStepId !== "string" || !ONBOARDING_STEPS_BY_ID.has(rawStepId)) {
      return { ok: false, code: "INVALID_STEP_ID", error: "currentStepId inválido." };
    }
  }

  const visitedRes = sanitizeStepIdList(obj.visitedStepIds);
  if (!visitedRes.ok) return visitedRes;

  const completedRes = sanitizeStepIdList(obj.completedStepIds);
  if (!completedRes.ok) return completedRes;

  const unavailableRes = sanitizeUnavailableSteps(obj.unavailableSteps);
  if (!unavailableRes.ok) return unavailableRes;

  let deferMinutes: number | undefined;
  const rawDeferMinutes =
    obj.deferMinutes !== undefined
      ? obj.deferMinutes
      : typeof obj.deferHours === "number"
        ? obj.deferHours * 60
        : undefined;
  if (rawDeferMinutes !== undefined) {
    if (
      typeof rawDeferMinutes !== "number" ||
      !Number.isFinite(rawDeferMinutes) ||
      rawDeferMinutes < 1 ||
      rawDeferMinutes > 10080
    ) {
      return {
        ok: false,
        code: "INVALID_PAYLOAD",
        error: "deferMinutes deve estar entre 1 e 10080 minutos.",
      };
    }
    deferMinutes = Math.round(rawDeferMinutes);
  }

  return {
    ok: true,
    input: {
      action: action as OnboardingAction,
      chapterId:
        action === "complete_chapter"
          ? (obj.chapterId as OnboardingPatchInput["chapterId"])
          : undefined,
      runId: typeof obj.runId === "string" ? obj.runId.trim() : undefined,
      revision: typeof rawRevision === "number" ? rawRevision : undefined,
      currentStepId: rawStepId === undefined ? undefined : (rawStepId as string | null),
      visitedStepIds: obj.visitedStepIds !== undefined ? visitedRes.ids : undefined,
      completedStepIds: obj.completedStepIds !== undefined ? completedRes.ids : undefined,
      unavailableSteps: obj.unavailableSteps !== undefined ? unavailableRes.items : undefined,
      deferMinutes,
    },
  };
}

export function createDefaultOnboardingRecord(
  tenantId: string,
  operatorId: string,
  now: Date = new Date(),
): OnboardingRecordSnapshot {
  return {
    id: `onb_${tenantId}_${operatorId}`,
    tenantId,
    operatorId,
    tourKey: OPERATOR_TOUR_KEY,
    contentVersion: OPERATOR_TOUR_CONTENT_VERSION,
    runId: `run_${randomUUID()}`,
    status: "not_started",
    currentStepId: null,
    visitedStepIds: [],
    completedStepIds: [],
    completedSteps: [],
    unavailableSteps: [],
    startedAt: null,
    pausedAt: null,
    updatedAt: now,
    completedAt: null,
    lastCompletedVersion: null,
    lastCompletedAt: null,
    deferredUntil: null,
    revision: 0,
  };
}

export function buildOnboardingProgressDto(
  record: OnboardingRecordSnapshot,
  context: OnboardingEligibilityContext,
  enabledOverride?: boolean,
): OnboardingProgressDTO {
  const currentContent = record.contentVersion === OPERATOR_TOUR_CONTENT_VERSION;
  const enabled =
    enabledOverride !== undefined ? enabledOverride : isOnboardingEnabledForTenant(record.tenantId);

  const coverage = computeOnboardingCoverage(
    context,
    currentContent ? record.completedStepIds : [],
    currentContent ? record.unavailableSteps : [],
  );

  return {
    enabled,
    tenantId: record.tenantId,
    operatorId: record.operatorId,
    tourKey: OPERATOR_TOUR_KEY,
    contentVersion: OPERATOR_TOUR_CONTENT_VERSION,
    runId: record.runId,
    status: currentContent ? record.status : "not_started",
    currentStepId: currentContent
      ? record.currentStepId
      : resolveNextApplicableStepId(context, [], []),
    visitedStepIds: currentContent ? [...record.visitedStepIds] : [],
    completedStepIds: currentContent ? [...record.completedStepIds] : [],
    completedChapterIds: coverage.completedChapterIds,
    unavailableSteps: record.unavailableSteps.map((u) => ({ ...u })),
    startedAt: record.startedAt ? record.startedAt.toISOString() : null,
    pausedAt: record.pausedAt ? record.pausedAt.toISOString() : null,
    updatedAt: record.updatedAt.toISOString(),
    completedAt: record.completedAt ? record.completedAt.toISOString() : null,
    lastCompletedVersion: record.lastCompletedVersion,
    lastCompletedAt: record.lastCompletedAt ? record.lastCompletedAt.toISOString() : null,
    deferredUntil: record.deferredUntil ? record.deferredUntil.toISOString() : null,
    revision: record.revision,
    eligibleViews: resolveEligiblePrimaryViews(context),
    eligibleStepIds: coverage.eligibleStepIds,
    completionPct: coverage.completionPct,
    capabilities: {
      isCommercialConsultant: context.isCommercialConsultant === true,
      allowedChannels: context.allowedChannels,
      hasPersonalWhatsappConnection: context.hasPersonalWhatsappConnection === true,
      canPairPersonalWhatsapp: context.canPairPersonalWhatsapp === true,
    },
  };
}

function mergeStepIds(existing: string[], incoming?: string[]): string[] {
  const set = new Set<string>(existing);
  if (incoming) {
    for (const id of incoming) {
      if (ONBOARDING_STEPS_BY_ID.has(id)) {
        set.add(id);
      }
    }
  }
  return Array.from(set);
}

function mergeUnavailable(
  existing: OnboardingUnavailableStepRecord[],
  incoming?: OnboardingUnavailableStepRecord[],
): OnboardingUnavailableStepRecord[] {
  const map = new Map<string, OnboardingUnavailableStepRecord>();
  for (const item of existing) {
    map.set(item.stepId, item);
  }
  if (incoming) {
    for (const item of incoming) {
      if (ONBOARDING_STEPS_BY_ID.has(item.stepId)) {
        map.set(item.stepId, item);
      }
    }
  }
  return Array.from(map.values());
}

function buildContextFromEligibleViews(
  tenantId: string,
  operatorId: string,
  eligibleViews?: readonly string[],
  capabilities?: { canConfigurePersonalWhatsapp?: boolean },
): OnboardingEligibilityContext {
  const viewSet = new Set(eligibleViews ?? PRIMARY_OPERATOR_VIEWS);
  const viewsObj: Record<string, boolean> = {};
  for (const v of PRIMARY_OPERATOR_VIEWS) {
    viewsObj[v] = viewSet.has(v);
  }
  return {
    tenantId,
    operatorId,
    isCommercialConsultant: viewSet.has("commercialHome"),
    hasPersonalWhatsappConnection: capabilities?.canConfigurePersonalWhatsapp ?? true,
    canPairPersonalWhatsapp: capabilities?.canConfigurePersonalWhatsapp ?? true,
    permissions: {
      views: viewsObj as any,
      chat: {
        canViewAllChats: true,
        restrictToOwnChats: false,
        canViewQueueMine: true,
        canViewQueueWaiting: true,
        canViewQueueBot: true,
        canViewQueueClosed: true,
        canCaptureChat: true,
        canTransferChat: true,
        canFinishChat: true,
        canOverrideChat: true,
        canSendInternalNotes: true,
        canEditClientInfo: true,
        canManageTags: true,
        canManageRdCrm: true,
      } as any,
      crm: {
        canViewCrm: viewSet.has("crm"),
        canCreateDeals: true,
        canEditDeals: true,
        canMoveStages: true,
        canCloseDeals: true,
        canExportDeals: true,
        canDeleteDeals: true,
      } as any,
      contacts: {
        canCreateContact: true,
        canEditContact: true,
      } as any,
      valentina: {
        canAccessChat: true,
      } as any,
      security: {
        canManageGlobalTemplates: true,
      } as any,
    } as any,
  };
}

/**
 * Pure state transition function for operator onboarding progress.
 * Supports both positional `(current, input, context, now)` and object `{ record, payload, eligibleViews, capabilities, now }` invocation.
 */
export function applyOnboardingPatchToRecord(
  firstArg:
    | OnboardingRecordSnapshot
    | null
    | {
        record: OnboardingRecordSnapshot | null;
        payload: OnboardingPatchInput & { stepId?: string; chapterId?: string; viewport?: string };
        eligibleViews?: readonly OperatorTourView[] | readonly string[];
        capabilities?: { canConfigurePersonalWhatsapp?: boolean };
        context?: OnboardingEligibilityContext;
        now?: Date;
      },
  secondArg?: OnboardingPatchInput,
  thirdArg?: OnboardingEligibilityContext,
  fourthArg?: Date,
): OnboardingMutationOutcome {
  let current: OnboardingRecordSnapshot | null;
  let input: OnboardingPatchInput;
  let context: OnboardingEligibilityContext;
  let now: Date;

  if (
    firstArg &&
    typeof firstArg === "object" &&
    "payload" in firstArg &&
    !("tourKey" in firstArg)
  ) {
    current = firstArg.record;
    const p = firstArg.payload;
    input = {
      ...p,
      currentStepId: p.currentStepId !== undefined ? p.currentStepId : p.stepId,
      completedStepIds:
        p.completedStepIds ?? (p.action === "checkpoint" && p.stepId ? [p.stepId] : undefined),
      visitedStepIds: p.visitedStepIds ?? (p.stepId ? [p.stepId] : undefined),
    };
    const tId = current?.tenantId ?? "tecfag";
    const oId = current?.operatorId ?? "op_1";
    context =
      firstArg.context ??
      buildContextFromEligibleViews(tId, oId, firstArg.eligibleViews, firstArg.capabilities);
    now = firstArg.now ?? new Date();
  } else {
    current = (firstArg as OnboardingRecordSnapshot | null) ?? null;
    input = secondArg!;
    context = thirdArg!;
    now = fourthArg ?? new Date();
  }

  const base = current ?? createDefaultOnboardingRecord(context.tenantId, context.operatorId, now);

  const effectiveRevision = input.revision ?? input.expectedRevision;

  // Optimistic concurrency check when an existing persisted record has revision > 0
  if (current && current.revision > 0 && effectiveRevision !== current.revision) {
    return {
      ok: false,
      status: 409,
      code: "REVISION_CONFLICT",
      error: "O progresso do treinamento foi atualizado em outra aba ou sessão.",
      dto: buildOnboardingProgressDto(current, context),
    };
  }

  if (current && current.revision > 0 && input.runId !== current.runId) {
    return {
      ok: false,
      status: 409,
      code: "RUN_ID_CONFLICT",
      error: "A execução atual do tour mudou. Sincronizando com a sessão mais recente.",
      dto: buildOnboardingProgressDto(current, context),
    };
  }

  const next: OnboardingRecordSnapshot = {
    ...base,
    contentVersion: OPERATOR_TOUR_CONTENT_VERSION,
    visitedStepIds: [...base.visitedStepIds],
    completedStepIds: [...base.completedStepIds],
    completedSteps: [...base.completedStepIds],
    unavailableSteps: base.unavailableSteps.map((u) => ({ ...u })),
    updatedAt: now,
    revision: base.revision + 1,
  };
  if (base.contentVersion !== OPERATOR_TOUR_CONTENT_VERSION) {
    if (input.action !== "start" && input.action !== "restart")
      return {
        ok: false,
        status: 409,
        code: "REVISION_CONFLICT",
        error: "O conteúdo do treinamento mudou. Inicie a versão atual.",
        dto: buildOnboardingProgressDto(base, context),
      };
    next.completedStepIds = [];
    next.completedSteps = [];
    next.visitedStepIds = [];
    next.unavailableSteps = [];
    next.currentStepId = input.currentStepId || resolveNextApplicableStepId(context, [], []);
    next.runId = `run_${randomUUID()}`;
  }

  switch (input.action) {
    case "start": {
      if (base.status === "not_started" || !current) {
        next.runId = input.runId || base.runId || `run_${randomUUID()}`;
        next.startedAt = base.startedAt ?? now;
      }
      next.status = "in_progress";
      next.pausedAt = null;
      next.deferredUntil = null;
      next.visitedStepIds = mergeStepIds(next.visitedStepIds, [
        "welcome.start",
        ...(input.visitedStepIds ?? []),
      ]);
      next.completedStepIds = mergeStepIds(next.completedStepIds, input.completedStepIds);
      next.unavailableSteps = mergeUnavailable(next.unavailableSteps, input.unavailableSteps);
      next.currentStepId =
        input.currentStepId ??
        next.currentStepId ??
        resolveNextApplicableStepId(context, next.completedStepIds, next.unavailableSteps) ??
        "welcome.start";
      break;
    }

    case "restart": {
      next.runId = `run_${randomUUID()}`;
      next.status = "in_progress";
      next.startedAt = now;
      next.pausedAt = null;
      next.completedAt = null;
      next.deferredUntil = null;
      next.visitedStepIds = mergeStepIds(["welcome.start"], input.visitedStepIds);
      next.completedStepIds = mergeStepIds([], input.completedStepIds);
      next.completedSteps = [...next.completedStepIds];
      next.unavailableSteps = mergeUnavailable([], input.unavailableSteps);
      next.currentStepId = input.currentStepId ?? "welcome.start";
      break;
    }

    case "checkpoint": {
      next.visitedStepIds = mergeStepIds(next.visitedStepIds, input.visitedStepIds);
      next.completedStepIds = mergeStepIds(next.completedStepIds, input.completedStepIds);
      next.unavailableSteps = mergeUnavailable(next.unavailableSteps, input.unavailableSteps);
      if (input.currentStepId !== undefined) {
        next.currentStepId = input.currentStepId;
        if (input.currentStepId) {
          next.visitedStepIds = mergeStepIds(next.visitedStepIds, [input.currentStepId]);
        }
      }
      if (next.status === "not_started") {
        next.status = "in_progress";
        next.startedAt = next.startedAt ?? now;
      }
      break;
    }

    case "pause": {
      next.visitedStepIds = mergeStepIds(next.visitedStepIds, input.visitedStepIds);
      next.completedStepIds = mergeStepIds(next.completedStepIds, input.completedStepIds);
      next.unavailableSteps = mergeUnavailable(next.unavailableSteps, input.unavailableSteps);
      if (input.currentStepId !== undefined) {
        next.currentStepId = input.currentStepId;
      }
      next.status = "paused";
      next.pausedAt = now;
      break;
    }

    case "defer": {
      const minutes = input.deferMinutes ?? 240;
      next.deferredUntil = new Date(now.getTime() + minutes * 60_000);
      if (input.currentStepId !== undefined) {
        next.currentStepId = input.currentStepId;
      }
      if (next.status === "in_progress") {
        next.status = "paused";
        next.pausedAt = now;
      }
      break;
    }

    case "resume": {
      next.visitedStepIds = mergeStepIds(next.visitedStepIds, input.visitedStepIds);
      next.completedStepIds = mergeStepIds(next.completedStepIds, input.completedStepIds);
      next.unavailableSteps = mergeUnavailable(next.unavailableSteps, input.unavailableSteps);
      next.status = "in_progress";
      next.pausedAt = null;
      next.deferredUntil = null;
      next.startedAt = next.startedAt ?? now;
      next.currentStepId =
        input.currentStepId ??
        next.currentStepId ??
        resolveNextApplicableStepId(context, next.completedStepIds, next.unavailableSteps) ??
        "welcome.start";
      break;
    }

    case "complete_chapter": {
      const chapter = input.chapterId && ONBOARDING_CHAPTERS_BY_ID.get(input.chapterId);
      if (!chapter)
        return { ok: false, status: 400, code: "INVALID_PAYLOAD", error: "Capítulo inválido." };
      const coverage = computeOnboardingCoverage(context, next.completedStepIds);
      const missing = chapter.stepIds.filter((id) => coverage.missingStepIds.includes(id));
      if (missing.length)
        return {
          ok: false,
          status: 422,
          code: "INCOMPLETE_TOUR_COVERAGE",
          error: "Conclua os exercícios do capítulo antes de confirmá-lo.",
          missingStepIds: missing,
          dto: buildOnboardingProgressDto(next, context),
        };
      break;
    }
    case "complete": {
      next.visitedStepIds = mergeStepIds(next.visitedStepIds, [
        "welcome.start",
        "finish.summary",
        "finish.complete",
        ...(input.visitedStepIds ?? []),
      ]);
      next.completedStepIds = mergeStepIds(next.completedStepIds, [
        "welcome.start",
        ...(input.completedStepIds ?? []),
      ]);
      next.unavailableSteps = mergeUnavailable(next.unavailableSteps, input.unavailableSteps);

      const coverage = computeOnboardingCoverage(
        context,
        next.completedStepIds,
        next.unavailableSteps,
      );

      if (!coverage.canComplete) {
        next.completedSteps = [...next.completedStepIds];
        return {
          ok: false,
          status: 422,
          code: "INCOMPLETE_TOUR_COVERAGE",
          error: `Ainda restam ${coverage.missingStepIds.length} etapa(s) aplicável(is) para concluir o tour com 100% de cobertura.`,
          missingStepIds: coverage.missingStepIds,
          dto: buildOnboardingProgressDto(next, context),
        };
      }

      next.completedStepIds = mergeStepIds(next.completedStepIds, ["finish.complete"]);
      next.status = "completed";
      next.currentStepId = "finish.complete";
      next.pausedAt = null;
      next.deferredUntil = null;
      next.startedAt = next.startedAt ?? now;
      next.completedAt = now;
      next.lastCompletedVersion = OPERATOR_TOUR_CONTENT_VERSION;
      next.lastCompletedAt = now;
      break;
    }
  }

  next.completedSteps = [...next.completedStepIds];

  return {
    ok: true,
    record: next,
    dto: buildOnboardingProgressDto(next, context),
  };
}

function rowToSnapshot(row: typeof operatorOnboarding.$inferSelect): OnboardingRecordSnapshot {
  const completedStepIds = Array.isArray(row.completedStepIds) ? row.completedStepIds : [];
  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorId: row.operatorId,
    tourKey: row.tourKey,
    contentVersion: row.contentVersion,
    runId: row.runId,
    status: (row.status as OnboardingStatus) || "not_started",
    currentStepId: row.currentStepId ?? null,
    visitedStepIds: Array.isArray(row.visitedStepIds) ? row.visitedStepIds : [],
    completedStepIds,
    completedSteps: [...completedStepIds],
    unavailableSteps: Array.isArray(row.unavailableSteps) ? row.unavailableSteps : [],
    startedAt: row.startedAt ?? null,
    pausedAt: row.pausedAt ?? null,
    updatedAt: row.updatedAt ?? new Date(),
    completedAt: row.completedAt ?? null,
    lastCompletedVersion: row.lastCompletedVersion ?? null,
    lastCompletedAt: row.lastCompletedAt ?? null,
    deferredUntil: row.deferredUntil ?? null,
    revision: typeof row.revision === "number" ? row.revision : 1,
  };
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; message?: string };
  return (
    err.code === "42P01" || Boolean(err.message && err.message.includes("operator_onboarding"))
  );
}

export async function resolveSessionEligibilityContext(
  session: AuthSessionContext,
): Promise<OnboardingEligibilityContext> {
  const tenantId = session.tenantId;
  const operatorId = session.operator.id;
  let hasPersonalWhatsappConnections = false;
  let canPairPersonalWhatsapp = false;
  let isCommercialConsultant = false;
  try {
    const [profile] = await db
      .select({ division: commercialConsultantProfiles.division })
      .from(commercialConsultantProfiles)
      .where(
        and(
          eq(commercialConsultantProfiles.tenantId, tenantId),
          eq(commercialConsultantProfiles.operatorId, operatorId),
        ),
      )
      .limit(1);
    isCommercialConsultant = Boolean(profile?.division?.trim());
  } catch {
    /* Missing capability is unavailable, never an implicit grant. */
  }

  try {
    if (multiConnectionEnabled(tenantId)) {
      const rows = await db
        .select({
          id: whatsappConnections.id,
          ownerOperatorId: whatsappConnections.ownerOperatorId,
        })
        .from(whatsappConnections)
        .where(
          and(
            eq(whatsappConnections.tenantId, tenantId),
            eq(whatsappConnections.enabled, true),
            eq(whatsappConnections.provider, "baileys"),
            whatsappConnectionAccessCondition(session, "send"),
          ),
        );
      const canManage = session.operator.role === "admin" && canManageWhatsappConnection(session);
      const pairable = rows.some((r) => r.ownerOperatorId === operatorId || canManage);
      hasPersonalWhatsappConnections = rows.length > 0;
      canPairPersonalWhatsapp = pairable;
    }
  } catch {
    hasPersonalWhatsappConnections = false;
    canPairPersonalWhatsapp = false;
  }

  return {
    tenantId,
    operatorId,
    operatorName: session.operator.name,
    operatorRole: session.operator.role,
    role: session.operator.role,
    isCommercialConsultant,
    permissions: session.permissions,
    allowedChannels: session.accessGroup?.allowedChannels ?? [],
    hasPersonalWhatsappConnection: hasPersonalWhatsappConnections,
    hasPersonalWhatsappConnections,
    canPairPersonalWhatsapp,
  };
}

export async function getOperatorOnboardingState(
  session: AuthSessionContext,
): Promise<OnboardingProgressDTO> {
  const tenantId = session.tenantId;
  const operatorId = session.operator.id;
  const enabled = isOnboardingEnabledForTenant(tenantId);
  const context = enabled
    ? await resolveSessionEligibilityContext(session)
    : { tenantId, operatorId, permissions: session.permissions };

  if (!enabled) {
    const empty = createDefaultOnboardingRecord(tenantId, operatorId);
    return buildOnboardingProgressDto(empty, context, false);
  }

  try {
    const [row] = await db
      .select()
      .from(operatorOnboarding)
      .where(
        and(
          eq(operatorOnboarding.tenantId, tenantId),
          eq(operatorOnboarding.operatorId, operatorId),
          eq(operatorOnboarding.tourKey, OPERATOR_TOUR_KEY),
        ),
      )
      .limit(1);

    if (!row) {
      const empty = createDefaultOnboardingRecord(tenantId, operatorId);
      return buildOnboardingProgressDto(empty, context, true);
    }

    return buildOnboardingProgressDto(rowToSnapshot(row), context, true);
  } catch (error) {
    if (isMissingTableError(error)) {
      console.warn(
        "[onboarding] Tabela operator_onboarding ainda não migrada; degradando para desabilitado.",
      );
      const empty = createDefaultOnboardingRecord(tenantId, operatorId);
      return buildOnboardingProgressDto(empty, context, false);
    }
    throw error;
  }
}

export async function applyOperatorOnboardingAction(
  session: AuthSessionContext,
  input: OnboardingPatchInput,
): Promise<OnboardingMutationOutcome> {
  const tenantId = session.tenantId;
  const operatorId = session.operator.id;
  const context = isOnboardingEnabledForTenant(tenantId)
    ? await resolveSessionEligibilityContext(session)
    : { tenantId, operatorId, permissions: session.permissions };

  if (!isOnboardingEnabledForTenant(tenantId)) {
    const empty = createDefaultOnboardingRecord(tenantId, operatorId);
    return {
      ok: true,
      record: empty,
      dto: buildOnboardingProgressDto(empty, context, false),
    };
  }

  const [existingRow] = await db
    .select()
    .from(operatorOnboarding)
    .where(
      and(
        eq(operatorOnboarding.tenantId, tenantId),
        eq(operatorOnboarding.operatorId, operatorId),
        eq(operatorOnboarding.tourKey, OPERATOR_TOUR_KEY),
      ),
    )
    .limit(1);

  const currentSnapshot = existingRow ? rowToSnapshot(existingRow) : null;
  const outcome = applyOnboardingPatchToRecord(currentSnapshot, input, context, new Date());

  if (!outcome.ok) {
    return outcome;
  }

  const next = outcome.record;

  if (!existingRow) {
    const [inserted] = await db
      .insert(operatorOnboarding)
      .values({
        id: next.id,
        tenantId: next.tenantId,
        operatorId: next.operatorId,
        tourKey: next.tourKey,
        contentVersion: next.contentVersion,
        runId: next.runId,
        status: next.status,
        currentStepId: next.currentStepId,
        visitedStepIds: next.visitedStepIds,
        completedStepIds: next.completedStepIds,
        unavailableSteps: next.unavailableSteps,
        startedAt: next.startedAt,
        pausedAt: next.pausedAt,
        updatedAt: next.updatedAt,
        completedAt: next.completedAt,
        lastCompletedVersion: next.lastCompletedVersion,
        lastCompletedAt: next.lastCompletedAt,
        deferredUntil: next.deferredUntil,
        revision: next.revision,
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted) {
      const latest = await getOperatorOnboardingState(session);
      return {
        ok: false,
        status: 409,
        code: "REVISION_CONFLICT",
        error: "Outra aba iniciou o treinamento. Atualize o progresso.",
        dto: latest,
      };
    }
    const saved = rowToSnapshot(inserted);
    return {
      ok: true,
      record: saved,
      dto: buildOnboardingProgressDto(saved, context, true),
    };
  }

  const [updated] = await db
    .update(operatorOnboarding)
    .set({
      contentVersion: next.contentVersion,
      runId: next.runId,
      status: next.status,
      currentStepId: next.currentStepId,
      visitedStepIds: next.visitedStepIds,
      completedStepIds: next.completedStepIds,
      unavailableSteps: next.unavailableSteps,
      startedAt: next.startedAt,
      pausedAt: next.pausedAt,
      updatedAt: next.updatedAt,
      completedAt: next.completedAt,
      lastCompletedVersion: next.lastCompletedVersion,
      lastCompletedAt: next.lastCompletedAt,
      deferredUntil: next.deferredUntil,
      revision: next.revision,
    })
    .where(
      and(
        eq(operatorOnboarding.id, existingRow.id),
        eq(operatorOnboarding.tenantId, tenantId),
        eq(operatorOnboarding.operatorId, operatorId),
        eq(operatorOnboarding.revision, existingRow.revision),
      ),
    )
    .returning();

  if (!updated) {
    const [latestRow] = await db
      .select()
      .from(operatorOnboarding)
      .where(
        and(
          eq(operatorOnboarding.tenantId, tenantId),
          eq(operatorOnboarding.operatorId, operatorId),
          eq(operatorOnboarding.tourKey, OPERATOR_TOUR_KEY),
        ),
      )
      .limit(1);

    const latestSnapshot = latestRow
      ? rowToSnapshot(latestRow)
      : createDefaultOnboardingRecord(tenantId, operatorId);

    return {
      ok: false,
      status: 409,
      code: "REVISION_CONFLICT",
      error: "Conflito de concorrência ao salvar progresso do tour.",
      dto: buildOnboardingProgressDto(latestSnapshot, context, true),
    };
  }

  const saved = rowToSnapshot(updated);
  return {
    ok: true,
    record: saved,
    dto: buildOnboardingProgressDto(saved, context, true),
  };
}
