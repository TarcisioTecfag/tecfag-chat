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
  } = useChat();
  const [progress, setProgress] = useState<OnboardingProgressDTO | null>(null);
  const [isLoading, setIsLoading] = useState(false),
    [isSaving, setIsSaving] = useState(false);
  const [isRunnerActive, setIsRunnerActive] = useState(false),
    [isWelcomeOpen, setIsWelcomeOpen] = useState(false);
  const [isCompletionOpen, setIsCompletionOpen] = useState(false),
    [isChapterDrawerOpen, setIsChapterDrawerOpen] = useState(false);
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
  const prompted = useRef<string | null>(null);
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
    readyRef.current = null;
    setReadyInteraction(null);
    setIsLoading(false);
    if (!isAuthenticated || isRestoringSession || !tenant || !currentOperatorId) return;
    const controller = new AbortController();
    setIsLoading(true);
    void fetch("/api/operators/onboarding", { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const dto: OnboardingProgressDTO = await res.json();
        if (controller.signal.aborted || identity !== identityRef.current) return;
        updateProgress(dto);
        if (
          dto.enabled &&
          prompted.current !== identity &&
          (!dto.deferredUntil || Date.parse(dto.deferredUntil) <= Date.now()) &&
          dto.status !== "completed"
        ) {
          prompted.current = identity;
          setIsWelcomeOpen(true);
        }
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
  const applicableSteps = useMemo(
    () =>
      ONBOARDING_STEPS.filter((step) => evaluateStepEligibility(step, eligibilityContext).eligible),
    [eligibilityContext],
  );
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
  const startTour = useCallback(() => activate("start"), [activate]);
  const resumeTour = useCallback(() => activate("resume"), [activate]);
  const restartTour = useCallback(() => activate("restart"), [activate]);
  const pauseTour = useCallback(async () => {
    const dto = await sendPatch({ action: "pause", currentStepId: currentStep?.id });
    if (dto) {
      setIsRunnerActive(false);
      setIsChapterDrawerOpen(false);
      resetExercise();
    }
  }, [sendPatch, currentStep?.id, resetExercise]);
  const deferTour = useCallback(
    async (minutes = 240) => {
      if (await sendPatch({ action: "defer", deferMinutes: minutes })) {
        setIsRunnerActive(false);
        setIsWelcomeOpen(false);
        resetExercise();
      }
    },
    [sendPatch, resetExercise],
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
      const step = applicableSteps.find((s) => s.chapterId === id);
      if (step) await goToStep(step.id);
    },
    [goToStep, applicableSteps],
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
    chapters: ONBOARDING_CHAPTERS,
    applicableSteps,
    currentStep,
    currentStepIndex,
    currentChapter,
    demoState,
    personaName: persona.name,
    operatorFirstName: operatorProfile?.name?.split(/\s+/)[0] || "Operador",
    targetNotFoundReason,
    setTargetNotFoundReason,
    interactiveReady: readyInteraction === JSON.stringify([progress?.runId, currentStep?.id]),
    startTour,
    resumeTour,
    pauseTour,
    deferTour,
    restartTour,
    completeTour,
    returnToRealOperation,
    openTourEntryModal: () => setIsWelcomeOpen(true),
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
