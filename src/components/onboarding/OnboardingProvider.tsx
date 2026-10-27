import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useChat } from "@/hooks/useChatState";
import {
  OnboardingContext,
  setGlobalTourRunnerActive,
  type OnboardingContextValue,
  type OnboardingPreTourSnapshot,
} from "@/hooks/useOnboarding";
import { getAiPersona } from "@/lib/ai-persona";
import {
  applyTourCommandToDemoState,
  createInitialDemoRuntimeState,
  type OnboardingDemoRuntimeState,
} from "@/lib/onboarding/demo-runtime";
import {
  ONBOARDING_CHAPTERS,
  ONBOARDING_STEPS,
  ONBOARDING_STEPS_BY_ID,
} from "@/lib/onboarding/manifest";
import {
  computeOnboardingCoverage,
  evaluateStepEligibility,
  resolveNextApplicableStepId,
  sanitizeTourActiveView,
  type OnboardingEligibilityContext,
} from "@/lib/onboarding/policy";
import { onboardingRegistry } from "@/lib/onboarding/registry";
import type {
  OnboardingPatchInput,
  OnboardingProgressDTO,
  OnboardingUnavailableStepRecord,
  TourChapterId,
  TourCommand,
  TourStep,
} from "@/lib/onboarding/types";

export function OnboardingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    isAuthenticated,
    isRestoringSession,
    tenant,
    currentOperatorId,
    operatorProfile,
    sessionRole,
    sessionPermissions,
    activeView,
    setActiveView,
    selectedChatId,
    setSelectedChatId,
    activeQueue,
    setActiveQueue,
    channelFilter,
    setChannelFilter,
    searchQuery,
    setSearchQuery,
    rightSidebarOpen,
    setRightSidebarOpen,
    isProfileModalOpen,
    setIsProfileModalOpen,
  } = useChat();

  const [progress, setProgress] = useState<OnboardingProgressDTO | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunnerActive, setIsRunnerActive] = useState(false);
  const [isWelcomeOpen, setIsWelcomeOpen] = useState(false);
  const [isCompletionOpen, setIsCompletionOpen] = useState(false);
  const [isChapterDrawerOpen, setIsChapterDrawerOpen] = useState(false);
  const [demoState, setDemoState] = useState<OnboardingDemoRuntimeState>(() =>
    createInitialDemoRuntimeState(),
  );

  const preTourSnapshotRef = useRef<OnboardingPreTourSnapshot | null>(null);
  const autoPromptedForOperatorRef = useRef<string | null>(null);
  const progressRef = useRef<OnboardingProgressDTO | null>(null);
  progressRef.current = progress;

  useEffect(() => {
    setGlobalTourRunnerActive(isRunnerActive);
    return () => {
      setGlobalTourRunnerActive(false);
    };
  }, [isRunnerActive]);

  const eligibilityContext = useMemo<OnboardingEligibilityContext>(
    () => ({
      tenantId: tenant || "tecfag",
      operatorId: currentOperatorId || "operator",
      role: sessionRole,
      permissions: sessionPermissions,
      hasPersonalWhatsappConnections: true,
      canPairPersonalWhatsapp: true,
    }),
    [tenant, currentOperatorId, sessionRole, sessionPermissions],
  );

  const coverage = useMemo(
    () =>
      computeOnboardingCoverage(
        eligibilityContext,
        progress?.completedStepIds ?? [],
        progress?.unavailableSteps ?? [],
      ),
    [
      eligibilityContext,
      progress?.completedStepIds,
      progress?.unavailableSteps,
    ],
  );

  const applicableSteps = useMemo<TourStep[]>(() => {
    return ONBOARDING_STEPS.filter(
      (step) => evaluateStepEligibility(step, eligibilityContext).eligible,
    );
  }, [eligibilityContext]);

  const currentStep = useMemo<TourStep | null>(() => {
    const stepId = progress?.currentStepId;
    if (stepId) {
      const candidate = ONBOARDING_STEPS_BY_ID.get(stepId);
      if (candidate && evaluateStepEligibility(candidate, eligibilityContext).eligible) {
        return candidate;
      }
    }
    return applicableSteps[0] ?? null;
  }, [progress?.currentStepId, eligibilityContext, applicableSteps]);

  const currentStepIndex = useMemo(() => {
    if (!currentStep) return 0;
    const idx = applicableSteps.findIndex((s) => s.id === currentStep.id);
    return idx >= 0 ? idx : 0;
  }, [applicableSteps, currentStep]);

  const currentChapter = useMemo(() => {
    if (!currentStep) return ONBOARDING_CHAPTERS[0] ?? null;
    return (
      ONBOARDING_CHAPTERS.find((c) => c.id === currentStep.chapterId) ?? null
    );
  }, [currentStep]);

  const persona = useMemo(() => getAiPersona(tenant || "tecfag"), [tenant]);
  const operatorFirstName = useMemo(() => {
    const raw = operatorProfile?.name?.trim() || "Operador";
    return raw.split(/\s+/)[0] || "Operador";
  }, [operatorProfile?.name]);

  const capturePreTourSnapshot = useCallback(() => {
    if (preTourSnapshotRef.current) return;
    const isLight =
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("light");
    preTourSnapshotRef.current = {
      activeView: sanitizeTourActiveView(activeView, "commercialHome"),
      selectedChatId,
      activeQueue,
      channelFilter,
      searchQuery,
      rightSidebarOpen,
      isProfileModalOpen,
      themeClass: isLight ? "light" : "dark",
      urlHref: typeof window !== "undefined" ? window.location.href : "/",
    };
  }, [
    activeView,
    selectedChatId,
    activeQueue,
    channelFilter,
    searchQuery,
    rightSidebarOpen,
    isProfileModalOpen,
  ]);

  const restorePreTourSnapshot = useCallback(() => {
    const snap = preTourSnapshotRef.current;
    if (!snap) return;
    preTourSnapshotRef.current = null;
    setActiveView(snap.activeView);
    setSelectedChatId(snap.selectedChatId);
    setActiveQueue(snap.activeQueue as any);
    setChannelFilter(snap.channelFilter as any);
    setSearchQuery(snap.searchQuery);
    setRightSidebarOpen(snap.rightSidebarOpen);
    setIsProfileModalOpen(snap.isProfileModalOpen);
  }, [
    setActiveView,
    setSelectedChatId,
    setActiveQueue,
    setChannelFilter,
    setSearchQuery,
    setRightSidebarOpen,
    setIsProfileModalOpen,
  ]);

  const sendPatch = useCallback(
    async (input: OnboardingPatchInput): Promise<OnboardingProgressDTO | null> => {
      setIsSaving(true);
      try {
        const res = await fetch("/api/operators/onboarding", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            runId: input.runId ?? progressRef.current?.runId,
            revision: input.revision ?? progressRef.current?.revision,
          }),
        });
        const data = await res.json();
        if (res.status === 409 && data?.state) {
          setProgress(data.state);
          return data.state as OnboardingProgressDTO;
        }
        if (res.status === 422) {
          if (data?.state) setProgress(data.state);
          toast.error(data?.error || "Ainda há etapas pendentes no tour.");
          return null;
        }
        if (!res.ok) {
          return null;
        }
        setProgress(data as OnboardingProgressDTO);
        return data as OnboardingProgressDTO;
      } catch (err) {
        console.warn("[onboarding] Falha ao sincronizar progresso:", err);
        return null;
      } finally {
        setIsSaving(false);
      }
    },
    [],
  );

  // Initial load on operator session ready
  useEffect(() => {
    if (!isAuthenticated || isRestoringSession || !currentOperatorId) {
      setProgress(null);
      setIsRunnerActive(false);
      setIsWelcomeOpen(false);
      setIsCompletionOpen(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    fetch("/api/operators/onboarding", {
      method: "GET",
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as OnboardingProgressDTO;
      })
      .then((dto) => {
        if (cancelled || !dto) return;
        setProgress(dto);

        const operatorKey = `${dto.tenantId}::${dto.operatorId}`;
        if (
          dto.enabled &&
          autoPromptedForOperatorRef.current !== operatorKey
        ) {
          autoPromptedForOperatorRef.current = operatorKey;
          const deferredUntilMs = dto.deferredUntil
            ? new Date(dto.deferredUntil).getTime()
            : 0;
          const isDeferredActive = deferredUntilMs > Date.now();

          if (
            !isDeferredActive &&
            (dto.status === "not_started" || dto.status === "in_progress")
          ) {
            setIsWelcomeOpen(true);
          }
        }
      })
      .catch((err) => {
        console.warn("[onboarding] Erro ao carregar onboarding:", err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isRestoringSession, currentOperatorId, tenant]);

  const dispatchCommand = useCallback(
    async (command: TourCommand) => {
      setDemoState((prev) => applyTourCommandToDemoState(prev, command));
      const p = progressRef.current;
      if (p) {
        await onboardingRegistry.dispatch(
          {
            tenantId: p.tenantId,
            operatorId: p.operatorId,
            runId: p.runId,
          },
          command,
        );
      }
    },
    [],
  );

  // Synchronize view & run enterCommands when active step changes
  useEffect(() => {
    if (!isRunnerActive || !currentStep) return;

    const safeView = sanitizeTourActiveView(currentStep.view, "commercialHome");
    if (activeView !== safeView) {
      setActiveView(safeView);
    }

    // Open or close real ProfileModal when entering/leaving profile steps
    if (
      (currentStep.surface === "profileModal" ||
        currentStep.surface === "profile.modal") &&
      currentStep.id !== "profile.entry"
    ) {
      if (!isProfileModalOpen) {
        setIsProfileModalOpen(true);
      }
    } else if (isProfileModalOpen && currentStep.chapterId !== "profile") {
      setIsProfileModalOpen(false);
    }

    if (currentStep.enterCommands && currentStep.enterCommands.length > 0) {
      for (const cmd of currentStep.enterCommands) {
        void dispatchCommand(cmd);
      }
    }
  }, [
    isRunnerActive,
    currentStep,
    activeView,
    setActiveView,
    isProfileModalOpen,
    setIsProfileModalOpen,
    dispatchCommand,
  ]);

  const buildUnavailableIneligibleRecords = useCallback((): OnboardingUnavailableStepRecord[] => {
    const nowIso = new Date().toISOString();
    const list: OnboardingUnavailableStepRecord[] = [];
    for (const step of ONBOARDING_STEPS) {
      const ev = evaluateStepEligibility(step, eligibilityContext);
      if (!ev.eligible && ev.reason) {
        list.push({
          stepId: step.id,
          reason: ev.reason,
          recordedAt: nowIso,
        });
      }
    }
    return list;
  }, [eligibilityContext]);

  const startTour = useCallback(async () => {
    capturePreTourSnapshot();
    setDemoState(createInitialDemoRuntimeState());
    setIsWelcomeOpen(false);
    setIsCompletionOpen(false);

    const firstStep = applicableSteps[0]?.id ?? "welcome.start";
    const unavailable = buildUnavailableIneligibleRecords();

    setProgress((prev) =>
      prev
        ? {
            ...prev,
            status: "in_progress",
            currentStepId: firstStep,
            visitedStepIds: Array.from(
              new Set([...prev.visitedStepIds, "welcome.start", firstStep]),
            ),
            completedStepIds: Array.from(
              new Set([
                ...prev.completedStepIds,
                "welcome.start",
              ]),
            ),
            unavailableSteps: unavailable,
          }
        : prev,
    );
    setIsRunnerActive(true);

    await sendPatch({
      action: "start",
      currentStepId: firstStep,
      visitedStepIds: [
        "welcome.start",
        firstStep,
      ],
      completedStepIds: [
        "welcome.start",
      ],
      unavailableSteps: unavailable,
    });
  }, [
    applicableSteps,
    buildUnavailableIneligibleRecords,
    capturePreTourSnapshot,
    sendPatch,
  ]);

  const resumeTour = useCallback(async () => {
    capturePreTourSnapshot();
    setIsWelcomeOpen(false);
    setIsCompletionOpen(false);
    const unavailable = buildUnavailableIneligibleRecords();
    const nextStepId =
      progressRef.current?.currentStepId ??
      resolveNextApplicableStepId(
        eligibilityContext,
        progressRef.current?.completedStepIds ?? [],
        unavailable,
      ) ??
      "welcome.start";

    setProgress((prev) =>
      prev
        ? {
            ...prev,
            status: "in_progress",
            currentStepId: nextStepId,
            unavailableSteps: unavailable,
          }
        : prev,
    );
    setIsRunnerActive(true);

    await sendPatch({
      action: "resume",
      currentStepId: nextStepId,
      unavailableSteps: unavailable,
    });
  }, [
    buildUnavailableIneligibleRecords,
    capturePreTourSnapshot,
    eligibilityContext,
    sendPatch,
  ]);

  const pauseTour = useCallback(async () => {
    setIsRunnerActive(false);
    setIsChapterDrawerOpen(false);
    restorePreTourSnapshot();
    await sendPatch({
      action: "pause",
      currentStepId: currentStep?.id ?? null,
    });
    toast.info("Tour pausado. Você pode retomar a qualquer momento.");
  }, [currentStep?.id, restorePreTourSnapshot, sendPatch]);

  const deferTour = useCallback(
    async (minutes = 240) => {
      setIsWelcomeOpen(false);
      setIsRunnerActive(false);
      await sendPatch({
        action: "defer",
        deferMinutes: minutes,
      });
    },
    [sendPatch],
  );

  const restartTour = useCallback(async () => {
    capturePreTourSnapshot();
    setDemoState(createInitialDemoRuntimeState());
    setIsWelcomeOpen(false);
    setIsCompletionOpen(false);
    setIsChapterDrawerOpen(false);
    const unavailable = buildUnavailableIneligibleRecords();
    const firstStep = applicableSteps[0]?.id ?? "welcome.start";

    setIsRunnerActive(true);
    await sendPatch({
      action: "restart",
      currentStepId: firstStep,
      visitedStepIds: ["welcome.start", firstStep],
      completedStepIds: ["welcome.start"],
      unavailableSteps: unavailable,
    });
  }, [
    applicableSteps,
    buildUnavailableIneligibleRecords,
    capturePreTourSnapshot,
    sendPatch,
  ]);

  const satisfyCurrentInteractiveStep = useCallback(() => {
    if (!currentStep) return;
    setProgress((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        visitedStepIds: Array.from(new Set([...prev.visitedStepIds, currentStep.id])),
        completedStepIds: Array.from(
          new Set([...prev.completedStepIds, currentStep.id]),
        ),
      };
    });
  }, [currentStep]);

  const goToStep = useCallback(
    async (stepId: string) => {
      const targetStep = ONBOARDING_STEPS_BY_ID.get(stepId);
      if (!targetStep) return;

      if (!isRunnerActive) {
        capturePreTourSnapshot();
        setIsRunnerActive(true);
      }

      const newlyCompleted = currentStep ? [currentStep.id] : [];
      const visited = Array.from(
        new Set([
          ...(progressRef.current?.visitedStepIds ?? []),
          ...newlyCompleted,
          stepId,
        ]),
      );
      const completed = Array.from(
        new Set([
          ...(progressRef.current?.completedStepIds ?? []),
          ...newlyCompleted,
        ]),
      );

      setProgress((prev) =>
        prev
          ? {
              ...prev,
              currentStepId: stepId,
              visitedStepIds: visited,
              completedStepIds: completed,
            }
          : prev,
      );

      await sendPatch({
        action: "checkpoint",
        currentStepId: stepId,
        visitedStepIds: visited,
        completedStepIds: completed,
      });
    },
    [capturePreTourSnapshot, currentStep, isRunnerActive, sendPatch],
  );

  const nextStep = useCallback(async () => {
    if (!currentStep) return;

    if (
      currentStep.completion.type === "demo_interaction" &&
      currentStep.completion.demoAction
    ) {
      await dispatchCommand({
        surface: currentStep.surface,
        name: currentStep.completion.demoAction,
        command: currentStep.completion.demoAction,
        params: currentStep.completion.demoPayload ?? { stepId: currentStep.id },
      });
    }

    const nextIdx = currentStepIndex + 1;
    const completed = Array.from(
      new Set([
        ...(progressRef.current?.completedStepIds ?? []),
        currentStep.id,
      ]),
    );

    if (nextIdx >= applicableSteps.length) {
      const visited = Array.from(
        new Set([
          ...(progressRef.current?.visitedStepIds ?? []),
          currentStep.id,
          "finish.complete",
        ]),
      );
      const allCompleted = Array.from(
        new Set([...completed, "finish.complete"]),
      );
      setProgress((prev) =>
        prev
          ? {
              ...prev,
              visitedStepIds: visited,
              completedStepIds: allCompleted,
              currentStepId: "finish.complete",
            }
          : prev,
      );
      await sendPatch({
        action: "checkpoint",
        currentStepId: "finish.complete",
        visitedStepIds: visited,
        completedStepIds: allCompleted,
      });
      setIsCompletionOpen(true);
      return;
    }

    const nextTarget = applicableSteps[nextIdx];
    const visited = Array.from(
      new Set([
        ...(progressRef.current?.visitedStepIds ?? []),
        currentStep.id,
        nextTarget.id,
      ]),
    );

    setProgress((prev) =>
      prev
        ? {
            ...prev,
            currentStepId: nextTarget.id,
            visitedStepIds: visited,
            completedStepIds: completed,
          }
        : prev,
    );

    await sendPatch({
      action: "checkpoint",
      currentStepId: nextTarget.id,
      visitedStepIds: visited,
      completedStepIds: completed,
    });
  }, [
    applicableSteps,
    currentStep,
    currentStepIndex,
    dispatchCommand,
    sendPatch,
  ]);

  const prevStep = useCallback(async () => {
    if (currentStepIndex <= 0) return;
    const prevTarget = applicableSteps[currentStepIndex - 1];
    if (!prevTarget) return;
    await goToStep(prevTarget.id);
  }, [applicableSteps, currentStepIndex, goToStep]);

  const goToChapter = useCallback(
    async (chapterId: TourChapterId) => {
      const firstInChapter = applicableSteps.find(
        (s) => s.chapterId === chapterId,
      );
      if (firstInChapter) {
        await goToStep(firstInChapter.id);
      }
    },
    [applicableSteps, goToStep],
  );

  const completeTour = useCallback(async (): Promise<boolean> => {
    const unavailable = buildUnavailableIneligibleRecords();
    const updated = await sendPatch({
      action: "complete",
      visitedStepIds: [
        ...(progressRef.current?.visitedStepIds ?? []),
        "finish.complete",
        "finish.return",
      ],
      completedStepIds: [
        ...(progressRef.current?.completedStepIds ?? []),
        "finish.complete",
      ],
      unavailableSteps: unavailable,
    });

    if (!updated || updated.status !== "completed") {
      return false;
    }

    toast.success(`Treinamento com ${persona.name} concluído com sucesso!`);
    return true;
  }, [buildUnavailableIneligibleRecords, persona.name, sendPatch]);

  const returnToRealOperation = useCallback(() => {
    setIsCompletionOpen(false);
    setIsRunnerActive(false);
    setIsChapterDrawerOpen(false);
    restorePreTourSnapshot();
  }, [restorePreTourSnapshot]);

  const openTourEntryModal = useCallback(() => {
    setIsWelcomeOpen(true);
  }, []);

  const value = useMemo<OnboardingContextValue>(
    () => ({
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
      chapters: ONBOARDING_CHAPTERS,
      applicableSteps,
      currentStep,
      currentStepIndex,
      currentChapter,
      demoState,
      personaName: persona.name,
      operatorFirstName,
      targetNotFoundReason: null,
      startTour,
      resumeTour,
      pauseTour,
      deferTour,
      restartTour,
      completeTour,
      returnToRealOperation,
      openTourEntryModal,
      nextStep,
      prevStep,
      goToStep,
      goToChapter,
      dispatchCommand,
      satisfyCurrentInteractiveStep,
    }),
    [
      progress,
      isLoading,
      isSaving,
      isRunnerActive,
      isWelcomeOpen,
      isCompletionOpen,
      isChapterDrawerOpen,
      eligibilityContext,
      coverage,
      applicableSteps,
      currentStep,
      currentStepIndex,
      currentChapter,
      demoState,
      persona.name,
      operatorFirstName,
      startTour,
      resumeTour,
      pauseTour,
      deferTour,
      restartTour,
      completeTour,
      returnToRealOperation,
      openTourEntryModal,
      nextStep,
      prevStep,
      goToStep,
      goToChapter,
      dispatchCommand,
      satisfyCurrentInteractiveStep,
    ],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}
