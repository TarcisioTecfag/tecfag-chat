import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
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
  const [inverseZoom, setInverseZoom] = useState(1);
  const onboarding = useOptionalOnboarding();

  useEffect(() => {
    const element = document.createElement("div");
    element.dataset.onboardingRoot = "true";
    const syncScale = () => {
      const htmlZoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const bodyZoom = Number.parseFloat(getComputedStyle(document.body).zoom) || 1;
      setInverseZoom(1 / (htmlZoom * bodyZoom));
    };
    syncScale();
    const density = new MutationObserver(syncScale);
    density.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-density", "style", "class"],
    });
    window.addEventListener("resize", syncScale);
    document.body.append(element);
    setRoot(element);
    return () => {
      density.disconnect();
      window.removeEventListener("resize", syncScale);
      element.remove();
    };
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
          <OnboardingHostContent inverseZoom={inverseZoom} />
        </PortalScope.Provider>,
        root,
      )
    : null;
}

function OnboardingHostContent({ inverseZoom }: { inverseZoom: number }) {
  const onboarding = useOptionalOnboarding();
  const scope = usePortalScope();
  const [isMascotHovered, setIsMascotHovered] = useState(false);

  const [frameTarget, setFrameTarget] = useState<TourTargetState>({
    element: null,
    rect: null,
    found: false,
  });
  const parentTargets: Record<string, string> = {
    "welcome.start": "welcome.dialog",
    "welcome.practice": "welcome.practice",
    "welcome.controls": "tour.controls",
    "finish.review": "finish.review",
    "finish.complete": "onboarding.complete-tour",
    "finish.return": "onboarding.return-to-operation",
  };
  const activeSelector = onboarding?.currentStep ? parentTargets[onboarding.currentStep.id] : null;
  const parentTarget = useTourTarget(
    activeSelector,
    Boolean(onboarding?.isRunnerActive && activeSelector),
    scope,
  );
  const target = activeSelector ? parentTarget : frameTarget;

  useEffect(() => {
    if (
      onboarding?.isRunnerActive &&
      ["finish.complete", "finish.return"].includes(onboarding.currentStep?.id || "")
    ) {
      onboarding.setIsCompletionOpen(true);
    }
  }, [onboarding?.currentStep?.id, onboarding?.isRunnerActive]);

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

  const isTecfag = onboarding.eligibilityContext.tenantId === "tecfag";
  const persona = getAiPersona(onboarding.eligibilityContext.tenantId);
  const mascotSrc = isTecfag
    ? "/fagner-onboarding-512.png"
    : persona.avatarFullUrl || persona.avatarHdUrl || persona.avatarUrl;
  const mascotSrcSet = isTecfag
    ? "/fagner-onboarding-384.png 1x, /fagner-onboarding-512.png 1.5x, /fagner-onboarding-768.png 2x, /fagner-onboarding.png 3x"
    : undefined;

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
      {/* Viewport-locked coordinate layer for active tour workspace, spotlight & modals */}
      <div style={{ zoom: String(inverseZoom) }}>
        <OnboardingWelcomeDialog />
        <OnboardingCompletionDialog />
        <OnboardingControls />
        <OnboardingWorkspace onTargetChange={setFrameTarget} />
        <OnboardingSpotlight rect={target.rect} found={target.found} avoidRect={target.avoidRect} />
      </div>

      {/* Peeking Mascot rendered at native DPI so rotation/floating transforms never pixelate */}

      <AnimatePresence>
        {showPeekingMascot && (
          <motion.div
            key="peeking-mascot-host"
            initial={{ x: "-115%", opacity: 0 }}
            animate={{ x: "0%", opacity: 1 }}
            exit={{ x: "-115%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 210, damping: 22 }}
            className="fixed left-0 top-[56%] -translate-y-1/2 z-[10070] pointer-events-none"
          >
            <SystemTooltip content={`Iniciar tour do módulo ${moduleTitle}`}>
              <motion.button
                type="button"
                data-tour="onboarding.peeking-mascot"
                aria-label={`Iniciar tour do módulo ${moduleTitle} com ${onboarding.personaName}`}
                onMouseEnter={() => setIsMascotHovered(true)}
                onMouseLeave={() => setIsMascotHovered(false)}
                onClick={() => onboarding.openTourEntryModal()}
                animate={{
                  x: isMascotHovered ? "-4%" : "-30%",
                  rotate: isMascotHovered ? 0 : 7,
                  scale: isMascotHovered ? 1.07 : 1,
                }}
                whileTap={{ scale: 0.94 }}
                transition={{ type: "spring", stiffness: 280, damping: 20 }}
                className="group pointer-events-auto relative flex items-center focus:outline-none cursor-pointer"
              >
                {/* Soft ambient glow behind mascot (separate from <img> so GPU texture stays razor-sharp) */}
                <motion.div
                  animate={{
                    scale: isMascotHovered ? [1.05, 1.18, 1.05] : [0.95, 1.08, 0.95],
                    opacity: isMascotHovered ? 0.85 : 0.5,
                  }}
                  transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
                  className="pointer-events-none absolute inset-3 rounded-full bg-primary/30 blur-2xl"
                />
                <div className="pointer-events-none absolute inset-4 rounded-full bg-black/55 blur-xl" />

                {/* Continuous living idle float & peek motion */}
                <motion.div
                  animate={
                    isMascotHovered
                      ? { y: -3, rotate: 0 }
                      : {
                          y: [0, -7, 0],
                          rotate: [0, 2.5, -1, 0],
                          x: [0, 4, 0],
                        }
                  }
                  transition={
                    isMascotHovered
                      ? { type: "spring", stiffness: 300, damping: 20 }
                      : { duration: 3.4, repeat: Infinity, ease: "easeInOut" }
                  }
                  className="relative flex items-center"
                >
                  <img
                    src={mascotSrc}
                    srcSet={mascotSrcSet}
                    alt={onboarding.personaName}
                    decoding="async"
                    draggable={false}
                    className="h-32 w-32 md:h-36 md:w-36 object-contain select-none"
                    onError={(e) => {
                      const img = e.currentTarget as HTMLImageElement;
                      img.srcset = "";
                      img.src = persona.avatarUrl;
                    }}
                  />

                  {/* Animated callout pill that invites the operator */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8, x: -8 }}
                    animate={{
                      opacity: 1,
                      scale: isMascotHovered ? 1.04 : [1, 1.05, 1],
                      x: isMascotHovered ? 2 : 0,
                    }}
                    transition={
                      isMascotHovered
                        ? { type: "spring", stiffness: 320, damping: 20 }
                        : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
                    }
                    className="pointer-events-none -ml-4 mb-10 flex items-center gap-1.5 rounded-full border border-primary/40 bg-card/95 px-2.5 py-1 text-[11px] font-bold text-foreground shadow-lg backdrop-blur-md"
                  >
                    <Sparkles className="h-3 w-3 shrink-0 text-primary animate-pulse" />
                    <span className="whitespace-nowrap">
                      {isMascotHovered ? `Iniciar Tour: ${moduleTitle}` : "Tour"}
                    </span>
                  </motion.div>
                </motion.div>
              </motion.button>
            </SystemTooltip>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

