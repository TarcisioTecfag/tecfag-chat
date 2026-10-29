import React, { useEffect, useRef, useState } from "react";
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

const MASCOT_POS_STORAGE_KEY = "onboarding:v1:mascot-pos";

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

  const active = Boolean(onboarding?.enabled && onboarding.isRunnerActive);
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
  const [isDragging, setIsDragging] = useState(false);
  const [mascotPos, setMascotPos] = useState<{ x: number; y: number } | null>(null);

  const dragStateRef = useRef<{
    active: boolean;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    moved: boolean;
  }>({
    active: false,
    pointerId: -1,
    startClientX: 0,
    startClientY: 0,
    originX: 0,
    originY: 0,
    moved: false,
  });

  // Restore saved mascot position from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(MASCOT_POS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
          const maxW = window.innerWidth * inverseZoom - 80;
          const maxH = window.innerHeight * inverseZoom - 80;
          setMascotPos({
            x: Math.max(-44, Math.min(parsed.x, maxW)),
            y: Math.max(8, Math.min(parsed.y, maxH)),
          });
        }
      }
    } catch {
      // ignore storage errors
    }
  }, [inverseZoom]);

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

  const isTourFullyCompleted =
    onboarding.progress?.status === "completed" ||
    (onboarding.progress?.completionPct ?? 0) >= 100;

  const showPeekingMascot =
    !onboarding.isRunnerActive &&
    !onboarding.isWelcomeOpen &&
    !onboarding.isCompletionOpen &&
    onboarding.isPeekingMascotVisible &&
    !currentModuleCompleted &&
    !allModulesCompleted &&
    !isTourFullyCompleted;

  const viewportW = (typeof window !== "undefined" ? window.innerWidth : 1280) * inverseZoom;
  const viewportH = (typeof window !== "undefined" ? window.innerHeight : 800) * inverseZoom;
  const defaultX = -38;
  const defaultY = Math.round(viewportH * 0.62 - 64);

  const effectiveX = mascotPos ? mascotPos.x : defaultX;
  const effectiveY = mascotPos ? mascotPos.y : defaultY;
  const isNearLeftWall = effectiveX <= 10;
  const isOnRightHalf = effectiveX > viewportW * 0.55;

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      active: true,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: effectiveX,
      originY: effectiveY,
      moved: false,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const st = dragStateRef.current;
    if (!st.active || st.pointerId !== e.pointerId) return;
    const rawDx = e.clientX - st.startClientX;
    const rawDy = e.clientY - st.startClientY;
    if (!st.moved && Math.hypot(rawDx, rawDy) > 5) {
      st.moved = true;
    }
    if (st.moved) {
      const nextX = Math.max(-44, Math.min(st.originX + rawDx * inverseZoom, viewportW - 88));
      const nextY = Math.max(8, Math.min(st.originY + rawDy * inverseZoom, viewportH - 110));
      setMascotPos({ x: Math.round(nextX), y: Math.round(nextY) });
    }
  };

  const finishDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const st = dragStateRef.current;
    if (!st.active || st.pointerId !== e.pointerId) return;
    st.active = false;
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (st.moved && mascotPos && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(MASCOT_POS_STORAGE_KEY, JSON.stringify(mascotPos));
      } catch {
        // ignore
      }
    }
  };

  const handleMascotClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (dragStateRef.current.moved) {
      dragStateRef.current.moved = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onboarding.openTourEntryModal();
  };

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

      {/* Peeking & Draggable Mascot rendered at native DPI without polluting shadows */}
      <AnimatePresence>
        {showPeekingMascot && (
          <motion.div
            key="peeking-mascot-host"
            initial={{ x: -120, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -120, opacity: 0 }}
            transition={{ type: "spring", stiffness: 210, damping: 22 }}
            style={{
              left: `${effectiveX}px`,
              top: `${effectiveY}px`,
            }}
            className="fixed z-[10070] pointer-events-none select-none"
          >
            <SystemTooltip
              content={`Clique para iniciar o tour de ${moduleTitle} • Arraste para mover`}
            >
              <motion.button
                type="button"
                data-tour="onboarding.peeking-mascot"
                aria-label={`Iniciar tour do módulo ${moduleTitle} com ${onboarding.personaName}`}
                onMouseEnter={() => setIsMascotHovered(true)}
                onMouseLeave={() => setIsMascotHovered(false)}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
                onClick={handleMascotClick}
                animate={{
                  x: !isDragging && isNearLeftWall && isMascotHovered ? 18 : 0,
                  rotate: isDragging ? 0 : isNearLeftWall ? (isMascotHovered ? 0 : 6) : 0,
                  scale: isDragging ? 1.08 : isMascotHovered ? 1.05 : 1,
                }}
                transition={
                  isDragging
                    ? { duration: 0.05 }
                    : { type: "spring", stiffness: 280, damping: 20 }
                }
                className={`group pointer-events-auto relative flex items-center focus:outline-none touch-none ${
                  isDragging ? "cursor-grabbing" : "cursor-grab"
                }`}
              >
                {/* Continuous living idle float & peek motion */}
                <motion.div
                  animate={
                    isDragging || isMascotHovered
                      ? { y: 0, rotate: 0 }
                      : {
                          y: [0, -6, 0],
                          rotate: [0, 2, -1, 0],
                        }
                  }
                  transition={
                    isDragging || isMascotHovered
                      ? { type: "spring", stiffness: 300, damping: 20 }
                      : { duration: 3.4, repeat: Infinity, ease: "easeInOut" }
                  }
                  className={`relative flex items-center ${
                    isOnRightHalf ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  <img
                    src={mascotSrc}
                    srcSet={mascotSrcSet}
                    alt={onboarding.personaName}
                    decoding="async"
                    draggable={false}
                    className="h-28 w-28 md:h-32 md:w-32 object-contain select-none pointer-events-none [mask-image:linear-gradient(to_bottom,black_84%,transparent_100%)]"
                    onError={(e) => {
                      const img = e.currentTarget as HTMLImageElement;
                      img.srcset = "";
                      img.src = persona.avatarUrl;
                    }}
                  />

                  {/* Animated callout pill that invites the operator */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{
                      opacity: 1,
                      scale: isMascotHovered ? 1.04 : [1, 1.04, 1],
                    }}
                    transition={
                      isMascotHovered
                        ? { type: "spring", stiffness: 320, damping: 20 }
                        : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
                    }
                    className={`pointer-events-none mb-8 flex items-center gap-1.5 rounded-full border border-primary/35 bg-card/95 px-2.5 py-1 text-[11px] font-bold text-foreground shadow-soft backdrop-blur-md ${
                      isOnRightHalf ? "-mr-3" : "-ml-3"
                    }`}
                  >
                    <Sparkles className="h-3 w-3 shrink-0 text-primary animate-pulse" />
                    <span className="whitespace-nowrap">
                      {isMascotHovered ? `Tour: ${moduleTitle}` : "Tour"}
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


