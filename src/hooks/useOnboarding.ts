import { createContext, useContext } from "react";
import type { OnboardingDemoRuntimeState } from "@/lib/onboarding/demo-runtime";
import type {
  OnboardingCoverageReport,
  OnboardingEligibilityContext,
} from "@/lib/onboarding/policy";
import type {
  OnboardingProgressDTO,
  OperatorTourView,
  TourChapter,
  TourChapterId,
  TourCommand,
  TourStep,
} from "@/lib/onboarding/types";

export interface OnboardingPreTourSnapshot {
  activeView: OperatorTourView;
  selectedChatId: string | null;
  activeQueue: string;
  channelFilter: string;
  searchQuery: string;
  rightSidebarOpen: boolean;
  isProfileModalOpen: boolean;
  themeClass: "dark" | "light";
  urlHref: string;
}

export interface OnboardingContextValue {
  enabled: boolean;
  isLoading: boolean;
  isSaving: boolean;
  isRunnerActive: boolean;
  isDemoMode: boolean;
  isWelcomeOpen: boolean;
  setIsWelcomeOpen: (open: boolean) => void;
  isCompletionOpen: boolean;
  setIsCompletionOpen: (open: boolean) => void;
  isChapterDrawerOpen: boolean;
  setIsChapterDrawerOpen: (open: boolean) => void;
  progress: OnboardingProgressDTO | null;
  eligibilityContext: OnboardingEligibilityContext;
  coverage: OnboardingCoverageReport;
  chapters: readonly TourChapter[];
  applicableSteps: TourStep[];
  currentStep: TourStep | null;
  currentStepIndex: number;
  currentChapter: TourChapter | null;
  demoState: OnboardingDemoRuntimeState;
  personaName: string;
  operatorFirstName: string;
  targetNotFoundReason: string | null;
  setTargetNotFoundReason: (reason: string | null) => void;
  interactiveReady: boolean;
  startTour: () => Promise<void>;
  resumeTour: () => Promise<void>;
  pauseTour: () => Promise<void>;
  deferTour: (minutes?: number) => Promise<void>;
  restartTour: () => Promise<void>;
  completeTour: () => Promise<boolean>;
  returnToRealOperation: () => void;
  openTourEntryModal: () => void;
  nextStep: () => Promise<void>;
  prevStep: () => Promise<void>;
  goToStep: (stepId: string) => Promise<void>;
  goToChapter: (chapterId: TourChapterId) => Promise<void>;
  dispatchCommand: (command: TourCommand) => Promise<boolean>;
  applyDemoCommand: (command: TourCommand) => void;
  satisfyCurrentInteractiveStep: (stepId: string, runId: string) => void;
}

export const OnboardingContext = createContext<OnboardingContextValue | null>(null);

let globalTourRunnerActive = false;

export function setGlobalTourRunnerActive(active: boolean): void {
  globalTourRunnerActive = active;
}

export function isGlobalTourRunnerActive(): boolean {
  return globalTourRunnerActive;
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding deve ser usado dentro de <OnboardingProvider>.");
  }
  return ctx;
}

export function useOptionalOnboarding(): OnboardingContextValue | null {
  return useContext(OnboardingContext);
}
