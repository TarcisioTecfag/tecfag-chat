import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Compass,
  Layers,
  Pause,
  CheckCircle2,
} from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useOnboarding } from "@/hooks/useOnboarding";
import type { TourTargetRect } from "@/hooks/useTourTarget";
import { interpolateOnboardingCopy } from "@/lib/onboarding/copy.pt-BR";
import { getAiPersona } from "@/lib/ai-persona";
import { placeTourCard } from "@/lib/onboarding/spotlight-layout";

interface OnboardingSpotlightProps {
  rect: TourTargetRect | null;
  found: boolean;
  avoidRect?: TourTargetRect | null;
}

export function OnboardingSpotlight({ rect, found, avoidRect }: OnboardingSpotlightProps) {
  const {
    isRunnerActive,
    currentStep,
    currentChapter,
    currentStepIndex,
    applicableSteps,
    personaName,
    operatorFirstName,
    eligibilityContext,
    nextStep,
    prevStep,
    pauseTour,
    setIsChapterDrawerOpen,
    interactiveReady,
    isSaving,
    satisfyCurrentInteractiveStep,
    setTargetNotFoundReason,
    progress,
    isCompletionOpen,
  } = useOnboarding();

  const persona = getAiPersona(eligibilityContext.tenantId);

  const interpolated = useMemo(() => {
    if (!currentStep) return { title: "", body: "" };
    return {
      title: interpolateOnboardingCopy(currentStep.title, {
        operatorFirstName,
        personaName,
      }),
      body: interpolateOnboardingCopy(currentStep.body, {
        operatorFirstName,
        personaName,
      }),
    };
  }, [currentStep, operatorFirstName, personaName]);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardHeight, setCardHeight] = useState(280);
  const [viewport, setViewport] = useState({
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    height: typeof window === "undefined" ? 800 : window.innerHeight,
  });

  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useLayoutEffect(() => {
    const element = cardRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      setCardHeight(element.getBoundingClientRect().height),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [isRunnerActive, currentStep?.id]);

  const showSpotlight = Boolean(isRunnerActive && currentStep && !isCompletionOpen);

  const pad = 8;
  const isBoundary = Boolean(
    currentStep && ["X", "informational_boundary"].includes(currentStep.mode),
  );
  const hasRect = Boolean(!isBoundary && found && rect && rect.width > 0 && rect.height > 0);
  const box =
    hasRect && rect
      ? {
          top: Math.max(4, rect.top - pad),
          left: Math.max(4, rect.left - pad),
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
        }
      : null;

  const cardWidth = Math.min(320, viewport.width - 24);
  const selfTarget = Boolean(
    currentStep && ["welcome.controls", "finish.review"].includes(currentStep.id),
  );
  const placement = placeTourCard(
    selfTarget ? null : box,
    viewport,
    { width: cardWidth, height: cardHeight },
    avoidRect,
  );
  const arrow =
    box && !selfTarget
      ? {
          startX: Math.max(
            placement.left + 12,
            Math.min(box.left + box.width / 2, placement.left + placement.width - 12),
          ),
          startY: Math.max(
            placement.top + 12,
            Math.min(box.top + box.height / 2, placement.top + placement.height - 12),
          ),
          endX: Math.max(
            box.left,
            Math.min(placement.left + placement.width / 2, box.left + box.width),
          ),
          endY: Math.max(
            box.top,
            Math.min(placement.top + placement.height / 2, box.top + box.height),
          ),
        }
      : null;

  const progressPct = Math.max(
    5,
    Math.round(((currentStepIndex + 1) / Math.max(1, applicableSteps.length)) * 100),
  );

  return (
    <AnimatePresence>
      {showSpotlight && currentStep && (
        <motion.div
          key="onboarding-spotlight-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-none fixed inset-0 z-[10090]"
          aria-live="polite"
        >
          {/* Highlight frame over the target element with smooth spring glide + sonar pulse */}
          <AnimatePresence>
            {box && (
              <motion.div
                key="onboarding-target-box"
                initial={{
                  opacity: 0,
                  scale: 0.94,
                  top: box.top,
                  left: box.left,
                  width: box.width,
                  height: box.height,
                }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  top: box.top,
                  left: box.left,
                  width: box.width,
                  height: box.height,
                }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 330, damping: 28, mass: 0.85 }}
                className="pointer-events-none fixed z-[10091] rounded-xl border-2 border-primary ring-4 ring-primary/20 shadow-[0_0_24px_rgba(220,38,38,0.28)]"
              >
                {/* Breathing sonar pulse ring around highlighted element */}
                <motion.div
                  animate={{
                    scale: [1, 1.035, 1],
                    opacity: [0.65, 0.15, 0.65],
                  }}
                  transition={{ duration: 1.9, repeat: Infinity, ease: "easeInOut" }}
                  className="pointer-events-none absolute -inset-1.5 rounded-2xl border-2 border-primary/60"
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Animated SVG Connector Arrow */}
          <AnimatePresence>
            {arrow && (
              <motion.svg
                key={`arrow-${currentStep.id}`}
                aria-hidden="true"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="pointer-events-none fixed inset-0 z-[10092] h-full w-full overflow-visible text-primary"
              >
                <defs>
                  <marker
                    id="onboarding-arrow"
                    markerWidth="8"
                    markerHeight="8"
                    refX="6"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M0,0 L8,4 L0,8" fill="currentColor" />
                  </marker>
                </defs>
                <motion.circle
                  cx={arrow.startX}
                  cy={arrow.startY}
                  r="3.5"
                  fill="currentColor"
                  animate={{ r: [3, 4.5, 3], opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.path
                  d={`M${arrow.startX},${arrow.startY} L${arrow.endX},${arrow.endY}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.25"
                  strokeDasharray="6 4"
                  animate={{ strokeDashoffset: [20, 0] }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
                  markerEnd="url(#onboarding-arrow)"
                />
              </motion.svg>
            )}
          </AnimatePresence>

          {/* Floating Fagner/Valentina Assistant Card with smooth spring repositioning */}
          <motion.div
            ref={cardRef}
            data-tour="onboarding.spotlight-card"
            initial={{
              opacity: 0,
              scale: 0.92,
              y: 12,
              top: placement.top,
              left: placement.left,
            }}
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
              top: placement.top,
              left: placement.left,
            }}
            exit={{ opacity: 0, scale: 0.94, y: 8 }}
            transition={{ type: "spring", stiffness: 290, damping: 27, mass: 0.9 }}
            style={{
              width: `${cardWidth}px`,
              maxHeight: "calc(100dvh - 24px)",
              overflowY: "auto",
            }}
            className="pointer-events-auto fixed z-[10095] rounded-2xl border border-border bg-card p-3.5 text-card-foreground shadow-card"
          >
            {/* Top bar: Persona + Chapter + Step counter */}
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="relative h-9 w-9 shrink-0">
                  <motion.span
                    animate={{ scale: [1, 1.14, 1], opacity: [0.55, 0.15, 0.55] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                    className="pointer-events-none absolute -inset-0.5 rounded-full bg-primary/40"
                  />
                  <div className="relative h-9 w-9 overflow-hidden rounded-full border border-primary/60 bg-muted">
                    <img
                      src={persona.avatarHdUrl || persona.avatarUrl}
                      alt={persona.name}
                      decoding="async"
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = persona.avatarUrl;
                      }}
                    />
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-foreground">{persona.name}</span>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {currentChapter
                      ? `${currentChapter.order}. ${currentChapter.title}`
                      : "Tour Guiado"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <SystemTooltip content="Ver capítulos e progresso completo">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.95 }}
                    data-tour="tour.controls finish.review"
                    aria-label="Capítulos e progresso do treinamento"
                    onClick={() => {
                      setIsChapterDrawerOpen(true);
                      if (currentStep.id === "welcome.controls" && progress?.runId) {
                        satisfyCurrentInteractiveStep(currentStep.id, progress.runId);
                      }
                    }}
                    className="flex items-center gap-1 rounded-lg border border-border bg-muted/60 px-2 py-1 text-[11px] font-semibold text-foreground transition hover:bg-muted cursor-pointer"
                  >
                    <Layers className="h-3.5 w-3.5 text-primary" />
                    <span>
                      {currentStepIndex + 1}/{Math.max(1, applicableSteps.length)}
                    </span>
                  </motion.button>
                </SystemTooltip>

                <SystemTooltip content="Pausar e continuar depois">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.06 }}
                    whileTap={{ scale: 0.94 }}
                    aria-label="Pausar treinamento"
                    onClick={() => void pauseTour()}
                    className="rounded-lg border border-border bg-muted/60 p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground cursor-pointer"
                  >
                    <Pause className="h-3.5 w-3.5" />
                  </motion.button>
                </SystemTooltip>
              </div>
            </div>

            {/* Smooth Animated Progress Bar */}
            <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={false}
                animate={{ width: `${progressPct}%` }}
                transition={{ type: "spring", stiffness: 240, damping: 26 }}
              />
            </div>

            {/* Animated Step Title & Body */}
            <div className="mb-3 min-h-[60px]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={currentStep.id}
                  initial={{ opacity: 0, y: 7 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.17, ease: "easeOut" }}
                  className="space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-foreground leading-snug">
                      {interpolated.title}
                    </h3>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {interpolated.body}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Target status indicator when in Demo Fallback */}
            <AnimatePresence>
              {!hasRect && !isBoundary && !interactiveReady && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                  animate={{ opacity: 1, height: "auto", marginBottom: 12 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.2 }}
                  className=" flex items-center gap-2 overflow-hidden rounded-xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-950/40 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-200"
                >
                  <Compass className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400 animate-spin" />
                  <span>
                    O controle ainda não apareceu. Aguarde a preparação da tela ou pause o
                    treinamento.
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Controls Footer */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <motion.button
                type="button"
                whileHover={{ scale: currentStepIndex <= 0 ? 1 : 1.03, x: currentStepIndex <= 0 ? 0 : -1 }}
                whileTap={{ scale: currentStepIndex <= 0 ? 1 : 0.96 }}
                onClick={() => void prevStep()}
                disabled={currentStepIndex <= 0}
                className="flex items-center gap-1 rounded-xl border border-border bg-muted/60 px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Anterior</span>
              </motion.button>

              <div className="flex items-center gap-1.5">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.04, x: 1 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => {
                    if (currentStep && progress?.runId) {
                      satisfyCurrentInteractiveStep(currentStep.id, progress.runId);
                    }
                    setTargetNotFoundReason(null);
                    void nextStep();
                  }}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground shadow-soft transition hover:opacity-95 disabled:opacity-40 cursor-pointer"
                >
                  <span>
                    {currentStepIndex >= applicableSteps.length - 1 ? "Finalizar Tour" : "Próximo"}
                  </span>
                  {currentStepIndex >= applicableSteps.length - 1 ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

