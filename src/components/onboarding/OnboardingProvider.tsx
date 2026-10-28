import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useChat } from "@/hooks/useChatState";
import {
  OnboardingContext,
  setGlobalTourRunnerActive,
  type OnboardingContextValue,
} from "@/hooks/useOnboarding";
import { getAiPersona } from "@/lib/ai-persona";
import {
  applyTourCommandToDemoState,
  createInitialDemoRuntimeState,
} from "@/lib/onboarding/demo-runtime";
import { ONBOARDING_CHAPTERS, ONBOARDING_STEPS } from "@/lib/onboarding/manifest";
import {
  computeOnboardingCoverage,
  evaluateStepEligibility,
  type OnboardingEligibilityContext,
} from "@/lib/onboarding/policy";
import { onboardingRegistry } from "@/lib/onboarding/registry";
import { SUPPORTED_TOUR_COMMANDS } from "@/lib/onboarding/command-names";
import type {
  OnboardingPatchInput,
  OnboardingProgressDTO,
  TourChapterId,
  TourCommand,
} from "@/lib/onboarding/types";

const VIEW_TO_CHAPTER_ID: Partial<Record<string, TourChapterId>> = {
  commercialHome: "home",
  chat: "chat",
  crm: "crm",
  tasks: "tasks",
  contacts: "contacts",
  wallet: "wallet",
};

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const {
    isAuthenticated,
    isRestoringSession,
    tenant,
    currentOperatorId,
    operatorProfile,
    sessionRole,
    sessionPermissions,
    isCommercialConsultant,
    activeView,
  } = useChat();
  const [progress, setProgress] = useState<OnboardingProgressDTO | null>(null);
  const [isLoading, setIsLoading] = useState(false),
    [isSaving, setIsSaving] = useState(false);
  const [isRunnerActive, setIsRunnerActive] = useState(false),
    [isWelcomeOpen, setIsWelcomeOpen] = useState(false);
  const [isCompletionOpen, setIsCompletionOpen] = useState(false),
    [isChapterDrawerOpen, setIsChapterDrawerOpen] = useState(false);
  const [scopedChapterId, setScopedChapterId] = useState<TourChapterId | null>(null);
  const [isPeekingMascotVisible, setIsPeekingMascotVisible] = useState(false);
  const [completedModuleIds, setCompletedModuleIds] = useState<TourChapterId[]>([]);
  const [demoState, setDemoState] = useState(() =>
    createInitialDemoRuntimeState(tenant, operatorProfile?.name),
  );
  const [readyInteraction, setReadyInteraction] = useState<string | null>(null);
  const [targetNotFoundReason, setTargetNotFoundReason] = useState<string | null>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const readyRef = useRef<string | null>(null),
    savingRef = useRef(false);
  const identity = JSON.stringify([tenant, currentOperatorId]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const promptedModulesRef = useRef<Set<TourChapterId>>(new Set());
  const storageReadyRef = useRef(false);

  const storagePrefix = useMemo(
    () => (tenant && currentOperatorId ? `fagner_mod_tour_v2:${tenant}:${currentOperatorId}` : null),
    [tenant, currentOperatorId],
  );

  const updateProgress = useCallback((dto: OnboardingProgressDTO) => {
    if (JSON.stringify([dto.tenantId, dto.operatorId]) !== identityRef.current) return;
    progressRef.current = dto;
    setProgress(dto);
  }, []);

  useEffect(() => {
    setGlobalTourRunnerActive(isRunnerActive);
    return () => setGlobalTourRunnerActive(false);
  }, [isRunnerActive]);

  useEffect(() => {
    setIsRunnerActive(false);
    setProgress(null);
    progressRef.current = null;
    setIsWelcomeOpen(false);
    setIsCompletionOpen(false);
    setScopedChapterId(null);
    setIsPeekingMascotVisible(false);
    setCompletedModuleIds([]);
    promptedModulesRef.current = new Set();
    storageReadyRef.current = false;
    readyRef.current = null;
    setReadyInteraction(null);
    setIsLoading(false);
    if (!isAuthenticated || isRestoringSession || !tenant || !currentOperatorId) return;

    try {
      const prefix = `fagner_mod_tour_v2:${tenant}:${currentOperatorId}`;
      const rawPrompted = localStorage.getItem(`${prefix}:prompted`);
      if (rawPrompted) {
        const parsed = JSON.parse(rawPrompted);
        if (Array.isArray(parsed)) promptedModulesRef.current = new Set(parsed);
      }
      const rawCompleted = localStorage.getItem(`${prefix}:completed`);
      if (rawCompleted) {
        const parsed = JSON.parse(rawCompleted);
        if (Array.isArray(parsed)) setCompletedModuleIds(parsed);
      }
      const rawPeeking = localStorage.getItem(`${prefix}:peeking`);
      if (rawPeeking === "1") {
        setIsPeekingMascotVisible(true);
      }
    } catch {}
    storageReadyRef.current = true;

    const controller = new AbortController();
    setIsLoading(true);
    void fetch("/api/operators/onboarding", { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const dto: OnboardingProgressDTO = await res.json();
        if (controller.signal.aborted || identity !== identityRef.current) return;
        updateProgress(dto);
      })
      .catch(() => {
        if (!controller.signal.aborted) toast.error("Não foi possível carregar o treinamento.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [identity, isAuthenticated, isRestoringSession, tenant, currentOperatorId, updateProgress]);

  const eligibilityContext = useMemo<OnboardingEligibilityContext>(
    () => ({
      tenantId: tenant || "",
      operatorId: currentOperatorId || "",
      role: sessionRole || undefined,
      permissions:
        sessionPermissions ?? ({ views: {} } as OnboardingEligibilityContext["permissions"]),
      isCommercialConsultant:
        progress?.capabilities?.isCommercialConsultant ?? isCommercialConsultant,
      allowedChannels: progress?.capabilities?.allowedChannels ?? [],
      hasPersonalWhatsappConnection: progress?.capabilities?.hasPersonalWhatsappConnection ?? false,
      canPairPersonalWhatsapp: progress?.capabilities?.canPairPersonalWhatsapp ?? false,
    }),
    [
      tenant,
      currentOperatorId,
      sessionRole,
      sessionPermissions,
      progress?.capabilities,
      isCommercialConsultant,
    ],
  );

  const allApplicableSteps = useMemo(
    () =>
      ONBOARDING_STEPS.filter((step) => evaluateStepEligibility(step, eligibilityContext).eligible),
    [eligibilityContext],
  );

  const eligibleChapters = useMemo(
    () =>
       ONBOARDING_CHAPTERS.filter(
        (ch) =>
          ch.id !== "welcome" &&
          allApplicableSteps.some((step) => step.chapterId === ch.id),
      ),
    [allApplicableSteps],
  );

  const currentViewChapterId = useMemo<TourChapterId>(() => {
    const mapped = VIEW_TO_CHAPTER_ID[activeView];
    if (mapped && eligibleChapters.some((ch) => ch.id === mapped)) {
      return mapped;
    }
    return eligibleChapters[0]?.id ?? "chat";
  }, [activeView, eligibleChapters]);

  // First-time module visit detector: when the operator clicks a module for the first time,
  // Fagner pops up asking if they want to do the tour of THAT module now or later.
  useEffect(() => {
    if (!progress?.enabled || !storageReadyRef.current) return;
    if (isRunnerActive || isCompletionOpen) return;

    // Only auto-prompt on primary operator module views that exist in VIEW_TO_CHAPTER_ID
    const mappedChapter = VIEW_TO_CHAPTER_ID[activeView];
    if (!mappedChapter || !eligibleChapters.some((ch) => ch.id === mappedChapter)) return;

    if (!isWelcomeOpen) {
      setScopedChapterId(mappedChapter);
    }

    if (
      !promptedModulesRef.current.has(mappedChapter) &&
      !completedModuleIds.includes(mappedChapter)
    ) {
      promptedModulesRef.current.add(mappedChapter);
      if (storagePrefix) {
        try {
          localStorage.setItem(
            `${storagePrefix}:prompted`,
            JSON.stringify(Array.from(promptedModulesRef.current)),
          );
        } catch {}
      }
      setScopedChapterId(mappedChapter);
      setIsWelcomeOpen(true);
    }
  }, [
    progress?.enabled,
    activeView,
    eligibleChapters,
    isRunnerActive,
    isCompletionOpen,
    isWelcomeOpen,
    completedModuleIds,
    storagePrefix,
  ]);

  const activeModuleChapterId = scopedChapterId ?? currentViewChapterId;
  const activeModuleChapter = useMemo(
    () =>
      ONBOARDING_CHAPTERS.find((ch) => ch.id === activeModuleChapterId) ??
      eligibleChapters[0] ??
      ONBOARDING_CHAPTERS[0] ??
      null,
    [activeModuleChapterId, eligibleChapters],
  );

  const applicableSteps = useMemo(() => {
    if (!scopedChapterId) return allApplicableSteps;
    const filtered = allApplicableSteps.filter((step) => step.chapterId === scopedChapterId);
    return filtered.length > 0 ? filtered : allApplicableSteps;
  }, [allApplicableSteps, scopedChapterId]);

  const currentStep =
    applicableSteps.find((step) => step.id === progress?.currentStepId) ??
    applicableSteps[0] ??
    null;
  const currentStepIndex = currentStep ? applicableSteps.indexOf(currentStep) : 0;
  const currentChapter =
    ONBOARDING_CHAPTERS.find((chapter) => chapter.id === currentStep?.chapterId) ?? null;
  const coverage = useMemo(
    () => computeOnboardingCoverage(eligibilityContext, progress?.completedStepIds ?? []),
    [eligibilityContext, progress?.completedStepIds],
  );

  // Record module completion when completion dialog opens for a scoped module
  useEffect(() => {
    if (!isCompletionOpen || !scopedChapterId) return;
    setCompletedModuleIds((prev) => {
      if (prev.includes(scopedChapterId)) return prev;
      const next = [...prev, scopedChapterId];
      if (storagePrefix) {
        try {
          localStorage.setItem(`${storagePrefix}:completed`, JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  }, [isCompletionOpen, scopedChapterId, storagePrefix]);

  const persona = tenant ? getAiPersona(tenant) : { name: "Assistente" };
  const sendPatch = useCallback(
    async (input: OnboardingPatchInput) => {
      if (savingRef.current || !progressRef.current || identityRef.current !== identity)
        return null;
      const previous = progressRef.current;
      savingRef.current = true;
      setIsSaving(true);
      try {
        const response = await fetch("/api/operators/onboarding", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, revision: previous.revision, runId: previous.runId }),
        });
        const data = await response.json();
        if (identityRef.current !== identity) return null;
        if (!response.ok) {
          if (data.state) updateProgress(data.state);
          if (response.status === 409) {
            readyRef.current = null;
            setReadyInteraction(null);
          }
          toast.error(data.error || "Não foi possível salvar o progresso. Tente novamente.");
          return null;
        }
        updateProgress(data);
        return data as OnboardingProgressDTO;
      } catch {
        toast.error("Progresso não salvo. Verifique a conexão e tente novamente.");
        return null;
      } finally {
        savingRef.current = false;
        setIsSaving(false);
      }
    },
    [identity, updateProgress],
  );
  const resetExercise = useCallback(() => {
    readyRef.current = null;
    setReadyInteraction(null);
    setTargetNotFoundReason(null);
  }, []);
  const startModuleTour = useCallback(
    async (chapterId?: TourChapterId) => {
      if (!progressRef.current?.enabled || !allApplicableSteps.length) return;
      const targetChapter = chapterId ?? scopedChapterId ?? currentViewChapterId;
      setScopedChapterId(targetChapter);
      const moduleSteps = allApplicableSteps.filter((step) => step.chapterId === targetChapter);
      const stepsToUse = moduleSteps.length > 0 ? moduleSteps : allApplicableSteps;
      const firstStep = stepsToUse[0];
      if (!firstStep) return;

      const welcomeIds = allApplicableSteps
        .filter((s) => s.chapterId === "welcome" && !s.isControlStep)
        .map((s) => s.id);

      const dto = await sendPatch({
        action: "start",
        currentStepId: firstStep.id,
        visitedStepIds: [firstStep.id, ...welcomeIds],
        completedStepIds: welcomeIds,
      });
      if (!dto) return;
      resetExercise();
      setDemoState(createInitialDemoRuntimeState(tenant, operatorProfile?.name));
      setIsWelcomeOpen(false);
      setIsCompletionOpen(false);
      setIsChapterDrawerOpen(false);
      setIsRunnerActive(true);
    },
    [
      allApplicableSteps,
      scopedChapterId,
      currentViewChapterId,
      sendPatch,
      resetExercise,
      tenant,
      operatorProfile?.name,
    ],
  );
  const activate = useCallback(
    async (action: "start" | "resume" | "restart") => {
      if (!progressRef.current?.enabled || !applicableSteps.length) return;
      const dto = await sendPatch({
        action,
        ...(action === "restart" || progressRef.current.status === "not_started"
          ? { currentStepId: applicableSteps[0]?.id }
          : {}),
      });
      if (!dto) return;
      resetExercise();
      setDemoState(createInitialDemoRuntimeState(tenant, operatorProfile?.name));
      setIsWelcomeOpen(false);
      setIsCompletionOpen(false);
      setIsChapterDrawerOpen(false);
      setIsRunnerActive(true);
    },
    [sendPatch, applicableSteps, resetExercise, tenant, operatorProfile?.name],
  );
  const startTour = useCallback(() => startModuleTour(), [startModuleTour]);
  const resumeTour = useCallback(() => startModuleTour(), [startModuleTour]);
  const restartTour = useCallback(() => startModuleTour(), [startModuleTour]);
  const pauseTour = useCallback(async () => {
    const dto = await sendPatch({ action: "pause", currentStepId: currentStep?.id });
    if (dto) {
      setIsRunnerActive(false);
      setIsChapterDrawerOpen(false);
      setIsPeekingMascotVisible(true);
      if (storagePrefix) {
        try {
          localStorage.setItem(`${storagePrefix}:peeking`, "1");
        } catch {}
      }
      resetExercise();
    }
  }, [sendPatch, currentStep?.id, resetExercise, storagePrefix]);
  const deferModuleTour = useCallback(async () => {
    setIsRunnerActive(false);
    setIsWelcomeOpen(false);
    setIsPeekingMascotVisible(true);
    if (storagePrefix) {
      try {
        localStorage.setItem(`${storagePrefix}:peeking`, "1");
      } catch {}
    }
    resetExercise();
    if (progressRef.current?.enabled) {
      void sendPatch({ action: "defer", deferMinutes: 240 });
    }
  }, [resetExercise, sendPatch, storagePrefix]);
  const deferTour = useCallback(
    async (minutes = 240) => {
      setIsPeekingMascotVisible(true);
      if (storagePrefix) {
        try {
          localStorage.setItem(`${storagePrefix}:peeking`, "1");
        } catch {}
      }
      if (await sendPatch({ action: "defer", deferMinutes: minutes })) {
        setIsRunnerActive(false);
        setIsWelcomeOpen(false);
        resetExercise();
      } else {
        setIsWelcomeOpen(false);
      }
    },
    [sendPatch, resetExercise, storagePrefix],
  );
  const dispatchCommand = useCallback(async (command: TourCommand) => {
    const p = progressRef.current;
    if (!p?.runId) return false;
    return onboardingRegistry.dispatch(
      { tenantId: p.tenantId, operatorId: p.operatorId, runId: p.runId },
      command,
    );
  }, []);
  const applyDemoCommand = useCallback((command: TourCommand) => {
    if (!SUPPORTED_TOUR_COMMANDS.has(command.name ?? command.type ?? command.command ?? ""))
      throw Error("Comando de demonstração não implementado.");
    setDemoState((state) => applyTourCommandToDemoState(state, command));
  }, []);
  const satisfyCurrentInteractiveStep = useCallback(
    (stepId: string, runId: string) => {
      const p = progressRef.current;
      if (!isRunnerActive || !currentStep || currentStep.id !== stepId || p?.runId !== runId)
        return;
      readyRef.current = JSON.stringify([runId, stepId]);
      setReadyInteraction(readyRef.current);
    },
    [isRunnerActive, currentStep],
  );
  const goToStep = useCallback(
    async (stepId: string) => {
      if (!applicableSteps.some((step) => step.id === stepId)) return;
      const dto = await sendPatch({
        action: "checkpoint",
        currentStepId: stepId,
        visitedStepIds: [stepId],
      });
      if (dto) {
        resetExercise();
        setIsRunnerActive(true);
      }
    },
    [sendPatch, applicableSteps, resetExercise],
  );
  const nextStep = useCallback(async () => {
    const p = progressRef.current;
    if (!currentStep || !p) return;
    if (
      (currentStep.mode === "I" || currentStep.mode === "interactive_demo") &&
      readyRef.current !== JSON.stringify([p.runId, currentStep.id])
    ) {
      toast.info("Execute o exercício antes de avançar.");
      return;
    }
    if (targetNotFoundReason && !["X", "informational_boundary"].includes(currentStep.mode) && readyRef.current !== JSON.stringify([p.runId, currentStep.id])) {
      toast.error(targetNotFoundReason);
      return;
    }
    const next = applicableSteps[currentStepIndex + 1];
    const dto = await sendPatch({
      action: "checkpoint",
      currentStepId: next?.id ?? currentStep.id,
      visitedStepIds: [currentStep.id, ...(next ? [next.id] : [])],
      completedStepIds: [currentStep.id],
    });
    if (!dto) return;
    resetExercise();
    if (!next) setIsCompletionOpen(true);
  }, [
    currentStep,
    currentStepIndex,
    applicableSteps,
    sendPatch,
    resetExercise,
    targetNotFoundReason,
  ]);
  const prevStep = useCallback(async () => {
    if (currentStepIndex > 0) await goToStep(applicableSteps[currentStepIndex - 1].id);
  }, [currentStepIndex, goToStep, applicableSteps]);
  const goToChapter = useCallback(
    async (id: TourChapterId) => {
      setScopedChapterId(id);
      const step = allApplicableSteps.find((s) => s.chapterId === id);
      if (step) {
        const dto = await sendPatch({
          action: "checkpoint",
          currentStepId: step.id,
          visitedStepIds: [step.id],
        });
        if (dto) {
          resetExercise();
          setIsRunnerActive(true);
        }
      }
    },
    [allApplicableSteps, sendPatch, resetExercise],
  );
  const completeTour = useCallback(async () => {
    if (!coverage.canComplete) {
      toast.error("Conclua todos os exercícios aplicáveis.");
      return false;
    }
    const dto = await sendPatch({ action: "complete" });
    if (dto && currentStep?.id === "finish.complete") {
      readyRef.current = JSON.stringify([dto.runId, currentStep.id]); setReadyInteraction(readyRef.current);
    }
    return Boolean(dto);
  }, [coverage.canComplete, sendPatch, currentStep]);
  const returnToRealOperation = useCallback(() => {
    setIsRunnerActive(false);
    setIsCompletionOpen(false);
    setIsChapterDrawerOpen(false);
    resetExercise();
  }, [resetExercise]);
  const openTourEntryModal = useCallback(
    (chapterId?: TourChapterId) => {
      setScopedChapterId(chapterId ?? currentViewChapterId);
      setIsWelcomeOpen(true);
    },
    [currentViewChapterId],
  );
  const value: OnboardingContextValue = {
    enabled: Boolean(progress?.enabled),
    isLoading,
    isSaving,
    isRunnerActive,
    isDemoMode: isRunnerActive,
    isWelcomeOpen,
    setIsWelcomeOpen,
    isCompletionOpen,
    setIsCompletionOpen,
    isChapterDrawerOpen,
    setIsChapterDrawerOpen,
    progress,
    eligibilityContext,
    coverage,
    chapters: eligibleChapters,
    applicableSteps,
    allApplicableSteps,
    currentStep,
    currentStepIndex,
    currentChapter,
    activeModuleChapter,
    scopedChapterId,
    setScopedChapterId,
    isPeekingMascotVisible,
    completedModuleIds,
    demoState,
    personaName: persona.name,
    operatorFirstName: operatorProfile?.name?.split(/\s+/)[0] || "Operador",
    targetNotFoundReason,
    setTargetNotFoundReason,
    interactiveReady: readyInteraction === JSON.stringify([progress?.runId, currentStep?.id]),
    startTour,
    startModuleTour,
    resumeTour,
    pauseTour,
    deferTour,
    deferModuleTour,
    restartTour,
    completeTour,
    returnToRealOperation,
    openTourEntryModal,
    nextStep,
    prevStep,
    goToStep,
    goToChapter,
    dispatchCommand,
    applyDemoCommand,
    satisfyCurrentInteractiveStep,
  };
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}
