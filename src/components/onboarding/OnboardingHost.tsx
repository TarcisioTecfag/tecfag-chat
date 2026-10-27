import React from "react";
import { Sparkles } from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useOptionalOnboarding } from "@/hooks/useOnboarding";
import { useTourTarget } from "@/hooks/useTourTarget";
import { OnboardingCompletionDialog } from "./OnboardingCompletionDialog";
import { OnboardingControls } from "./OnboardingControls";
import { OnboardingSpotlight } from "./OnboardingSpotlight";
import { OnboardingWelcomeDialog } from "./OnboardingWelcomeDialog";
import { OnboardingWorkspace } from "./OnboardingWorkspace";

export function OnboardingHost() {
  const onboarding = useOptionalOnboarding();

  const activeSelector =
    onboarding?.isRunnerActive && onboarding.currentStep
      ? onboarding.currentStep.targetSelector
      : null;

  const target = useTourTarget(
    activeSelector,
    Boolean(onboarding?.isRunnerActive),
  );

  if (!onboarding || !onboarding.enabled) {
    return null;
  }

  const showResumePill =
    !onboarding.isRunnerActive &&
    !onboarding.isWelcomeOpen &&
    !onboarding.isCompletionOpen &&
    onboarding.progress &&
    (onboarding.progress.status === "in_progress" ||
      onboarding.progress.status === "paused");

  return (
    <>
      <OnboardingWelcomeDialog />
      <OnboardingCompletionDialog />
      <OnboardingControls />
      <OnboardingWorkspace />
      <OnboardingSpotlight rect={target.rect} found={target.found} />

      {showResumePill && (
        <div className="fixed bottom-4 left-20 z-[10070]">
          <SystemTooltip
            content={`Retomar treinamento guiado com ${onboarding.personaName} (${onboarding.coverage.completionPct}%)`}
          >
            <button
              type="button"
              onClick={onboarding.openTourEntryModal}
              className="flex items-center gap-2 rounded-full border border-primary/50 bg-slate-900/95 px-3.5 py-1.5 text-xs font-bold text-white shadow-xl backdrop-blur-md transition hover:border-primary hover:bg-slate-800"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>
                Continuar Tour do {onboarding.personaName} ({onboarding.coverage.completionPct}%)
              </span>
            </button>
          </SystemTooltip>
        </div>
      )}
    </>
  );
}
