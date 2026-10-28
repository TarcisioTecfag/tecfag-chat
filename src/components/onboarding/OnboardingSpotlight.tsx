import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Compass,
  Layers,
  Pause,
  RotateCcw,
  Sparkles,
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
    coverage,
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
    progress,
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
  const [viewport, setViewport] = useState({ width: typeof window === "undefined" ? 1280 : window.innerWidth, height: typeof window === "undefined" ? 800 : window.innerHeight });
  useEffect(() => { const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight }); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);
  useLayoutEffect(() => {
    const element = cardRef.current; if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setCardHeight(element.getBoundingClientRect().height)); observer.observe(element); return () => observer.disconnect();
  }, [isRunnerActive, currentStep?.id]);

  if (!isRunnerActive || !currentStep) return null;

  const pad = 8;
  const isBoundary = ["X", "informational_boundary"].includes(currentStep.mode);
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
  const selfTarget = ["welcome.controls", "finish.review"].includes(currentStep.id);
  const placement = placeTourCard(selfTarget ? null : box, viewport, { width: cardWidth, height: cardHeight }, avoidRect);
  const arrow = box && !selfTarget ? {
    startX: Math.max(placement.left + 12, Math.min(box.left + box.width / 2, placement.left + placement.width - 12)),
    startY: Math.max(placement.top + 12, Math.min(box.top + box.height / 2, placement.top + placement.height - 12)),
    endX: Math.max(box.left, Math.min(placement.left + placement.width / 2, box.left + box.width)),
    endY: Math.max(box.top, Math.min(placement.top + placement.height / 2, box.top + box.height)),
  } : null;

  const isInteractive = currentStep.mode === "I" || currentStep.mode === "interactive_demo";

  return (
    <div className="pointer-events-none fixed inset-0 z-[10090]" aria-live="polite">
      {/* Highlight frame over the target element */}
      {box && (
        <div
          style={{
            top: `${box.top}px`,
            left: `${box.left}px`,
            width: `${box.width}px`,
            height: `${box.height}px`,
          }}
          className="pointer-events-none fixed z-[10091] rounded-xl border-2 border-primary ring-4 ring-primary/20 transition-all duration-150"
        />
      )}

      {arrow && <svg aria-hidden="true" className="pointer-events-none fixed inset-0 z-[10092] h-full w-full overflow-visible text-primary"><defs><marker id="onboarding-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="currentColor" /></marker></defs><path d={`M${arrow.startX},${arrow.startY} L${arrow.endX},${arrow.endY}`} fill="none" stroke="currentColor" strokeWidth="2" markerEnd="url(#onboarding-arrow)" /></svg>}

      {/* Floating Fagner/Valentina Assistant Card */}
      <div
        ref={cardRef}
        data-tour="onboarding.spotlight-card"
        style={{
          top: placement.top,
          left: placement.left,
          width: `${cardWidth}px`,
          maxHeight: "calc(100dvh - 24px)",
          overflowY: "auto",
        }}
        className="pointer-events-auto fixed z-[10095] rounded-2xl border border-border bg-card p-3.5 text-card-foreground shadow-card"
      >
        {/* Top bar: Persona + Chapter + Step counter */}
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-primary/50 bg-muted">
              <img
                src={persona.avatarUrl}
                alt={persona.name}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-foreground">{persona.name}</span>
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
              <button
                type="button"
                data-tour="tour.controls finish.review"
                aria-label="Capítulos e progresso do treinamento"
                onClick={() => { setIsChapterDrawerOpen(true); if (currentStep.id === "welcome.controls" && progress?.runId) satisfyCurrentInteractiveStep(currentStep.id, progress.runId); }}
                className="flex items-center gap-1 rounded-lg border border-border bg-muted/60 px-2 py-1 text-[11px] font-semibold text-foreground transition hover:bg-muted cursor-pointer"
              >
                <Layers className="h-3.5 w-3.5 text-primary" />
                <span>
                  {currentStepIndex + 1}/{Math.max(1, applicableSteps.length)}
                </span>
              </button>
            </SystemTooltip>

            <SystemTooltip content="Pausar e continuar depois">
              <button
                type="button"
                aria-label="Pausar treinamento"
                onClick={() => void pauseTour()}
                className="rounded-lg border border-border bg-muted/60 p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground cursor-pointer"
              >
                <Pause className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${Math.max(3, coverage.completionPct)}%` }}
          />
        </div>

        {/* Step Title & Body */}
        <div className="mb-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-foreground leading-snug">{interpolated.title}</h3>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{interpolated.body}</p>
        </div>

        {/* Target status indicator when in Demo Fallback */}
        {!hasRect && !isBoundary && !interactiveReady && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-950/40 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-200">
            <Compass className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>O controle ainda não apareceu. Aguarde a preparação da tela ou pause o treinamento.</span>
          </div>
        )}

        {/* Controls Footer */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={() => void prevStep()}
            disabled={currentStepIndex <= 0}
            className="flex items-center gap-1 rounded-xl border border-border bg-muted/60 px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-40 cursor-pointer"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Anterior</span>
          </button>

          <div className="flex items-center gap-1.5">
            {isInteractive && (
              <span
                role="status"
                className={`text-xs font-medium ${
                  interactiveReady
                    ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                    : "text-muted-foreground"
                }`}
              >
                {interactiveReady ? "Exercício validado" : "Pratique no painel"}
              </span>
            )}

            <button
              type="button"
              onClick={() => void nextStep()}
              disabled={isSaving || (!isBoundary && !found && !interactiveReady) || (isInteractive && !interactiveReady)}
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
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
