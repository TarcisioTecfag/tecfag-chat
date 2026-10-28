import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PortalScope, usePortalScope } from "@/components/ui/portal-scope";
import { isolateOnboardingDom } from "@/lib/onboarding/dom-isolation";
import { getAiPersona } from "@/lib/ai-persona";
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

  const persona = getAiPersona(onboarding.eligibilityContext.tenantId);
  const mascotSrc =
    onboarding.eligibilityContext.tenantId === "tecfag"
      ? "/fagner-onboarding.png"
      : persona.avatarFullUrl || persona.avatarHdUrl || persona.avatarUrl;

  const moduleTitle =
    onboarding.activeModuleChapter?.shortTitle ||
    onboarding.activeModuleChapter?.title ||
    "Módulo Atual";

  const currentModuleCompleted = Boolean(
    onboarding.activeModuleChapter &&
      onboarding.completedModuleIds.includes(onboarding.activeModuleChapter.id),
  );
  const primaryChapters = onboarding.chapters.filter((ch) => ch.id !== "profile");
  const allModulesCompleted =
    primaryChapters.length > 0 &&
    primaryChapters.every((ch) => onboarding.completedModuleIds.includes(ch.id));

  const showPeekingMascot =
    !onboarding.isRunnerActive &&
    !onboarding.isWelcomeOpen &&
    !onboarding.isCompletionOpen &&
    onboarding.isPeekingMascotVisible &&
    !currentModuleCompleted &&
    !allModulesCompleted;

  return (
    <>
      <OnboardingWelcomeDialog />
      <OnboardingCompletionDialog />
      <OnboardingControls />
      <OnboardingWorkspace onTargetChange={setFrameTarget} />
      <OnboardingSpotlight rect={target.rect} found={target.found} avoidRect={target.avoidRect} />

      {showPeekingMascot && (
        <div className="fixed left-0 top-[56%] -translate-y-1/2 z-[10070] pointer-events-none">
          <SystemTooltip content={`Iniciar tour do módulo ${moduleTitle}`}>
            <button
              type="button"
              data-tour="onboarding.peeking-mascot"
              aria-label={`Iniciar tour do módulo ${moduleTitle} com ${onboarding.personaName}`}
              onClick={() => onboarding.openTourEntryModal()}
              className="group pointer-events-auto relative flex items-center -translate-x-[48%] rotate-[10deg] transition-all duration-300 ease-out hover:translate-x-[-6%] hover:rotate-0 focus:outline-none cursor-pointer"
            >
              <img
                src={mascotSrc}
                alt={onboarding.personaName}
                className="h-24 w-24 md:h-28 md:w-28 object-contain drop-shadow-[0_8px_18px_rgba(0,0,0,0.55)] select-none"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = persona.avatarUrl;
                }}
              />
            </button>
          </SystemTooltip>
        </div>
      )}
    </>
  );
}
