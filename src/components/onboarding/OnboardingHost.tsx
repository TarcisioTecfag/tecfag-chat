import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PortalScope, usePortalScope } from "@/components/ui/portal-scope";
import { isolateOnboardingDom } from "@/lib/onboarding/dom-isolation";
import { Sparkles } from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useOptionalOnboarding } from "@/hooks/useOnboarding";
import { useTourTarget, type TourTargetState } from "@/hooks/useTourTarget";
import { OnboardingCompletionDialog } from "./OnboardingCompletionDialog";
import { OnboardingControls } from "./OnboardingControls";
import { OnboardingSpotlight } from "./OnboardingSpotlight";
import { OnboardingWelcomeDialog } from "./OnboardingWelcomeDialog";
import { OnboardingWorkspace } from "./OnboardingWorkspace";

export function OnboardingHost() {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const onboarding = useOptionalOnboarding();
  useEffect(() => {
    const element = document.createElement("div");
    element.dataset.onboardingRoot = "true";
    // Application density uses CSS zoom on <html>. A viewport overlay must use
    // physical CSS pixels, otherwise iframe coordinates are clipped and arrows drift.
    const syncScale = () => {
      const htmlZoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const bodyZoom = Number.parseFloat(getComputedStyle(document.body).zoom) || 1;
      element.style.zoom = String(1 / (htmlZoom * bodyZoom));
    };
    syncScale();
    const density = new MutationObserver(syncScale);
    density.observe(document.documentElement, { attributes: true, attributeFilter: ["data-density", "style", "class"] });
    window.addEventListener("resize", syncScale);
    document.body.append(element);
    setRoot(element);
    return () => { density.disconnect(); window.removeEventListener("resize", syncScale); element.remove(); };
  }, []);
  const active = Boolean(
    onboarding?.enabled &&
    (onboarding.isRunnerActive || onboarding.isWelcomeOpen || onboarding.isCompletionOpen),
  );
  useEffect(() => {
    if (root && active) return isolateOnboardingDom(root);
  }, [root, active]);
  return root
    ? createPortal(
        <PortalScope.Provider value={root}>
          <OnboardingHostContent />
        </PortalScope.Provider>,
        root,
      )
    : null;
}

function OnboardingHostContent() {
  const onboarding = useOptionalOnboarding();
  const scope = usePortalScope();

  const [frameTarget, setFrameTarget] = useState<TourTargetState>({ element: null, rect: null, found: false });
  const parentTargets: Record<string, string> = { "welcome.start": "welcome.dialog", "welcome.practice": "welcome.practice", "welcome.controls": "tour.controls", "finish.review": "finish.review", "finish.complete": "onboarding.complete-tour", "finish.return": "onboarding.return-to-operation" };
  const activeSelector = onboarding?.currentStep ? parentTargets[onboarding.currentStep.id] : null;
  const parentTarget = useTourTarget(activeSelector, Boolean(onboarding?.isRunnerActive && activeSelector), scope);
  const target = activeSelector ? parentTarget : frameTarget;
  useEffect(() => { if (onboarding?.isRunnerActive && ["finish.complete", "finish.return"].includes(onboarding.currentStep?.id || "")) onboarding.setIsCompletionOpen(true); }, [onboarding?.currentStep?.id, onboarding?.isRunnerActive]);
  const setMissing = onboarding?.setTargetNotFoundReason;
  useEffect(() => {
    if (!onboarding?.isRunnerActive) return;
    const timer = setTimeout(
      () =>
        setMissing?.(
          target.found || ["X", "informational_boundary"].includes(onboarding.currentStep?.mode || "")
            ? null
            : "O controle deste exercício não está disponível. Volte ou pause o treinamento.",
        ),
      400,
    );
    return () => clearTimeout(timer);
  }, [target.found, onboarding?.currentStep?.id, onboarding?.isRunnerActive, setMissing]);

  if (!onboarding || !onboarding.enabled) {
    return null;
  }

  const showResumePill =
    !onboarding.isRunnerActive &&
    !onboarding.isWelcomeOpen &&
    !onboarding.isCompletionOpen &&
    onboarding.progress &&
    (onboarding.progress.status === "in_progress" || onboarding.progress.status === "paused");

  return (
    <>
      <OnboardingWelcomeDialog />
      <OnboardingCompletionDialog />
      <OnboardingControls />
      <OnboardingWorkspace onTargetChange={setFrameTarget} />
      <OnboardingSpotlight rect={target.rect} found={target.found} avoidRect={target.avoidRect} />

      {showResumePill && (
        <div className="fixed bottom-4 left-20 z-[10070]">
          <SystemTooltip
            content={`Retomar treinamento guiado com ${onboarding.personaName} (${onboarding.coverage.completionPct}%)`}
          >
            <button
              type="button"
              onClick={onboarding.openTourEntryModal}
              className="flex items-center gap-2 rounded-full border border-primary/40 bg-card/95 px-3.5 py-1.5 text-xs font-bold text-foreground shadow-card backdrop-blur-md transition hover:border-primary hover:bg-muted cursor-pointer"
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
