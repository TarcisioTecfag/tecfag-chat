import type { ViewId } from "@/lib/rbac";
import { ONBOARDING_CHAPTERS, ONBOARDING_STEPS, ONBOARDING_STEPS_BY_ID } from "./manifest";
import {
  FORBIDDEN_SECONDARY_VIEWS,
  PRIMARY_OPERATOR_VIEWS,
  type OnboardingEligibilityContext,
  type OperatorTourView,
  type TourCapabilityKey,
  type TourChapterId,
  type TourStep,
  type UnavailableReason,
  type UnavailableStepRecord,
} from "./types";

export type { OnboardingEligibilityContext };

export function isOnboardingEnabledForTenant(
  tenantId: string | null | undefined,
  envOverride?: string,
): boolean {
  if (!tenantId) return false;
  const raw =
    envOverride !== undefined
      ? envOverride
      : typeof process !== "undefined" &&
          process.env &&
          process.env.OPERATOR_ONBOARDING_TENANTS !== undefined
        ? process.env.OPERATOR_ONBOARDING_TENANTS
        : "tecfag";
  const allowed = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(tenantId.trim().toLowerCase());
}

export function isOperatorTourView(viewId: string | null | undefined): viewId is OperatorTourView {
  if (!viewId) return false;
  return (PRIMARY_OPERATOR_VIEWS as readonly string[]).includes(viewId);
}

export function isForbiddenSecondaryView(viewId: string | null | undefined): boolean {
  if (!viewId) return false;
  return (FORBIDDEN_SECONDARY_VIEWS as readonly string[]).includes(viewId);
}

export function isPrimaryViewAuthorized(
  viewId: OperatorTourView,
  ctx: Pick<
    OnboardingEligibilityContext,
    "tenantId" | "isCommercialConsultant" | "permissions"
  >,
): boolean {
  if (!isOperatorTourView(viewId)) return false;
  if (viewId === "commercialHome") {
    const isConsultant = ctx.isCommercialConsultant ?? true;
    return Boolean(isConsultant) && Boolean(ctx.permissions?.views?.commercialHome);
  }
  return Boolean(ctx.permissions?.views?.[viewId]);
}

export function resolveEligiblePrimaryViews(
  ctxOrAllowedModules:
    | Pick<OnboardingEligibilityContext, "tenantId" | "isCommercialConsultant" | "permissions">
    | readonly string[]
    | null
    | undefined,
): OperatorTourView[] {
  if (!ctxOrAllowedModules) return [...PRIMARY_OPERATOR_VIEWS];
  if (Array.isArray(ctxOrAllowedModules)) {
    const allowedSet = new Set(ctxOrAllowedModules);
    return PRIMARY_OPERATOR_VIEWS.filter((v) => allowedSet.has(v));
  }
  const ctx = ctxOrAllowedModules as Pick<
    OnboardingEligibilityContext,
    "tenantId" | "isCommercialConsultant" | "permissions"
  >;
  if (!ctx.permissions?.views) {
    return [...PRIMARY_OPERATOR_VIEWS];
  }
  return PRIMARY_OPERATOR_VIEWS.filter((viewId) => isPrimaryViewAuthorized(viewId, ctx));
}

export function resolveFirstEligiblePrimaryView(
  ctx: Pick<
    OnboardingEligibilityContext,
    "tenantId" | "isCommercialConsultant" | "permissions"
  >,
): OperatorTourView | null {
  const views = resolveEligiblePrimaryViews(ctx);
  return views[0] ?? null;
}

export function hasTourCapability(
  capability: TourCapabilityKey,
  ctx: OnboardingEligibilityContext,
): { allowed: boolean; reason?: UnavailableReason } {
  const permissions = ctx.permissions;
  if (!permissions || !permissions.views) {
    return { allowed: true };
  }
  switch (capability) {
    case "view:commercialHome":
      return permissions.views?.commercialHome
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "consultant:commercialHome":
      return (ctx.isCommercialConsultant ?? true)
        ? { allowed: true }
        : { allowed: false, reason: "not_commercial_consultant" };
    case "view:chat":
      return permissions.views?.chat
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "view:crm":
      return permissions.views?.crm && permissions.crm?.canViewCrm !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "view:tasks":
      return permissions.views?.tasks
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "view:contacts":
      return permissions.views?.contacts
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "view:wallet":
      return permissions.views?.wallet
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "chat:queueMine":
      return permissions.chat?.canViewQueueMine !== false
        ? { allowed: true }
        : { allowed: false, reason: "queue_not_allowed" };
    case "chat:queueAll":
      return permissions.chat?.canViewAllChats && !permissions.chat?.restrictToOwnChats
        ? { allowed: true }
        : { allowed: false, reason: "queue_not_allowed" };
    case "chat:queueWaiting":
      return permissions.chat?.canViewQueueWaiting !== false
        ? { allowed: true }
        : { allowed: false, reason: "queue_not_allowed" };
    case "chat:queueBot":
      return permissions.chat?.canViewQueueBot !== false
        ? { allowed: true }
        : { allowed: false, reason: "queue_not_allowed" };
    case "chat:queueClosed":
      return permissions.chat?.canViewQueueClosed !== false
        ? { allowed: true }
        : { allowed: false, reason: "queue_not_allowed" };
    case "chat:capture":
      return permissions.chat?.canCaptureChat !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "chat:transfer":
      return permissions.chat?.canTransferChat !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "chat:finish":
      return permissions.chat?.canFinishChat !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "chat:override":
      return permissions.chat?.canOverrideChat !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "chat:internalNotes":
      return permissions.chat?.canSendInternalNotes !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "chat:editClientInfo":
      return permissions.chat?.canEditClientInfo !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "chat:manageTags":
      return permissions.chat?.canManageTags !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "chat:manageRdCrm":
      return permissions.chat?.canManageRdCrm !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "chat:inlineAssistant":
      return permissions.valentina?.canAccessChat !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "chat:globalTemplates":
      return permissions.security?.canManageGlobalTemplates !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "whatsapp:personalConnection":
      return (ctx.hasPersonalWhatsappConnection ?? ctx.hasPersonalWhatsappConnections) !== false
        ? { allowed: true }
        : { allowed: false, reason: "capability_disabled" };
    case "whatsapp:personalPair":
      return ctx.canPairPersonalWhatsapp !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "crm:createDeals":
      return permissions.crm?.canCreateDeals !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "crm:editDeals":
      return permissions.crm?.canEditDeals !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "crm:moveStages":
      return permissions.crm?.canMoveStages !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "crm:closeDeals":
      return permissions.crm?.canCloseDeals !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "crm:exportDeals":
      return permissions.crm?.canExportDeals !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "crm:deleteDeals":
      return permissions.crm?.canDeleteDeals !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "contacts:create":
      return permissions.contacts?.canCreateContact !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "contacts:edit":
      return permissions.contacts?.canEditContact !== false
        ? { allowed: true }
        : { allowed: false, reason: "permission_denied" };
    case "device:mobile":
      return ctx.isMobile
        ? { allowed: true }
        : { allowed: false, reason: "mobile_only" };
    case "device:desktop":
      return !ctx.isMobile
        ? { allowed: true }
        : { allowed: false, reason: "desktop_only" };
    default:
      return { allowed: false, reason: "capability_disabled" };
  }
}

export function evaluateStepEligibility(
  step: TourStep,
  ctx: OnboardingEligibilityContext,
): { eligible: boolean; reason?: UnavailableReason } {
  const eligibleViews = resolveEligiblePrimaryViews(ctx);
  if (eligibleViews.length === 0) {
    return { eligible: false, reason: "permission_denied" };
  }
  if (!eligibleViews.includes(step.view)) {
    return { eligible: false, reason: "permission_denied" };
  }

  for (const cap of step.requiredCapabilities) {
    const check = hasTourCapability(cap, ctx);
    if (!check.allowed) {
      return { eligible: false, reason: check.reason ?? "permission_denied" };
    }
  }

  return { eligible: true };
}

export interface OnboardingCoverageSummary {
  applicableInstructionalStepIds: string[];
  applicableAllStepIds: string[];
  satisfiedInstructionalStepIds: string[];
  missingInstructionalStepIds: string[];
  unavailableSteps: UnavailableStepRecord[];
  completedChapterIds: TourChapterId[];
  canCompleteTour: boolean;
  progressPercent: number;
  eligibleStepIds: string[];
  missingStepIds: string[];
  canComplete: boolean;
  completionPct: number;
}

export type OnboardingCoverageReport = OnboardingCoverageSummary;

export function computeOnboardingCoverage(
  ctx: OnboardingEligibilityContext,
  completedStepIds: Iterable<string>,
  visitedOrUnavailable: Iterable<string | UnavailableStepRecord> = [],
  recordedAtISO = new Date().toISOString(),
): OnboardingCoverageSummary {
  const completedSet = new Set(completedStepIds);
  const visitedSet = new Set<string>();
  const explicitUnavailableMap = new Map<string, UnavailableStepRecord>();

  for (const item of visitedOrUnavailable) {
    if (typeof item === "string") {
      visitedSet.add(item);
    } else if (item && typeof item === "object" && "stepId" in item) {
      explicitUnavailableMap.set(item.stepId, item);
    }
  }

  const applicableInstructionalStepIds: string[] = [];
  const applicableAllStepIds: string[] = [];
  const satisfiedInstructionalStepIds: string[] = [];
  const missingInstructionalStepIds: string[] = [];
  const unavailableSteps: UnavailableStepRecord[] = [];

  for (const step of ONBOARDING_STEPS) {
    const evaluation = evaluateStepEligibility(step, ctx);
    if (!evaluation.eligible) {
      unavailableSteps.push({
        stepId: step.id,
        reason: evaluation.reason ?? "permission_denied",
        recordedAt: recordedAtISO,
      });
      continue;
    }

    applicableAllStepIds.push(step.id);

    if (step.isControlStep) {
      continue;
    }

    applicableInstructionalStepIds.push(step.id);
    const isExplicitlyUnavailable = explicitUnavailableMap.has(step.id);
    if (isExplicitlyUnavailable) {
      unavailableSteps.push(explicitUnavailableMap.get(step.id)!);
    }

    const isSatisfied =
      completedSet.has(step.id) ||
      isExplicitlyUnavailable ||
      (step.mode === "O" || step.mode === "X" || step.mode === "D"
        ? visitedSet.has(step.id) || completedSet.has(step.id)
        : completedSet.has(step.id));

    if (isSatisfied) {
      satisfiedInstructionalStepIds.push(step.id);
    } else {
      missingInstructionalStepIds.push(step.id);
    }
  }

  const completedChapterIds: TourChapterId[] = [];
  for (const chapter of ONBOARDING_CHAPTERS) {
    const chapterInstructionalSteps = chapter.stepIds.filter((stepId) => {
      const step = ONBOARDING_STEPS_BY_ID.get(stepId);
      if (!step || step.isControlStep) return false;
      return applicableInstructionalStepIds.includes(stepId);
    });
    if (
      chapterInstructionalSteps.length > 0 &&
      chapterInstructionalSteps.every((stepId) =>
        satisfiedInstructionalStepIds.includes(stepId),
      )
    ) {
      completedChapterIds.push(chapter.id);
    }
  }

  const totalApplicable = applicableInstructionalStepIds.length;
  const progressPercent =
    totalApplicable === 0
      ? 0
      : Math.min(
          100,
          Math.round((satisfiedInstructionalStepIds.length / totalApplicable) * 100),
        );

  const canCompleteTour =
    totalApplicable > 0 && missingInstructionalStepIds.length === 0;

  return {
    applicableInstructionalStepIds,
    applicableAllStepIds,
    satisfiedInstructionalStepIds,
    missingInstructionalStepIds,
    unavailableSteps,
    completedChapterIds,
    canCompleteTour,
    progressPercent,
    eligibleStepIds: applicableInstructionalStepIds,
    missingStepIds: missingInstructionalStepIds,
    canComplete: canCompleteTour,
    completionPct: progressPercent,
  };
}

export function resolveNextApplicableStepId(
  firstArg: string | null | undefined | OnboardingEligibilityContext,
  secondArg?: OnboardingEligibilityContext | Iterable<string>,
  thirdArg?: "forward" | "backward" | Iterable<UnavailableStepRecord>,
): string | null {
  if (firstArg && typeof firstArg === "object" && "tenantId" in firstArg) {
    const ctx = firstArg;
    const completedSet = new Set((secondArg as Iterable<string>) ?? []);
    const unavailableList = Array.isArray(thirdArg) ? thirdArg : [];
    const unavailSet = new Set(unavailableList.map((u) => u.stepId));
    const eligibleSteps = ONBOARDING_STEPS.filter(
      (step) => evaluateStepEligibility(step, ctx).eligible,
    );
    if (eligibleSteps.length === 0) return null;
    const nextUnfinished = eligibleSteps.find(
      (step) => !completedSet.has(step.id) && !unavailSet.has(step.id),
    );
    return nextUnfinished?.id ?? eligibleSteps[0].id;
  }

  const currentStepId = firstArg as string | null | undefined;
  const ctx = secondArg as OnboardingEligibilityContext;
  const direction: "forward" | "backward" =
    thirdArg === "backward" ? "backward" : "forward";

  const eligibleSteps = ONBOARDING_STEPS.filter(
    (step) => evaluateStepEligibility(step, ctx).eligible,
  );
  if (eligibleSteps.length === 0) return null;

  if (!currentStepId) {
    return eligibleSteps[0].id;
  }

  const currentIdx = eligibleSteps.findIndex((s) => s.id === currentStepId);
  if (currentIdx === -1) {
    const rawStep = ONBOARDING_STEPS_BY_ID.get(currentStepId);
    if (!rawStep) return eligibleSteps[0].id;
    if (direction === "forward") {
      const nextAfter = eligibleSteps.find((s) => s.orderIndex > rawStep.orderIndex);
      return nextAfter?.id ?? eligibleSteps[eligibleSteps.length - 1].id;
    }
    const prevBefore = [...eligibleSteps]
      .reverse()
      .find((s) => s.orderIndex < rawStep.orderIndex);
    return prevBefore?.id ?? eligibleSteps[0].id;
  }

  if (direction === "forward") {
    return eligibleSteps[currentIdx + 1]?.id ?? null;
  }
  return eligibleSteps[currentIdx - 1]?.id ?? null;
}

export function sanitizeTourActiveView(
  requestedView: ViewId | string | null | undefined,
  ctxOrFallback?:
    | Pick<OnboardingEligibilityContext, "tenantId" | "isCommercialConsultant" | "permissions">
    | OperatorTourView,
): OperatorTourView {
  if (typeof ctxOrFallback === "string" || ctxOrFallback === undefined) {
    const fallback: OperatorTourView = ctxOrFallback ?? "commercialHome";
    return isOperatorTourView(requestedView) ? requestedView : fallback;
  }
  if (
    requestedView &&
    isOperatorTourView(requestedView) &&
    isPrimaryViewAuthorized(requestedView, ctxOrFallback)
  ) {
    return requestedView;
  }
  return resolveFirstEligiblePrimaryView(ctxOrFallback) ?? "commercialHome";
}
