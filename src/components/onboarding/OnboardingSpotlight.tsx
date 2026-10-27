import React, { useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Compass,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useOnboarding } from "@/hooks/useOnboarding";
import type { TourTargetRect } from "@/hooks/useTourTarget";
import { interpolateOnboardingCopy } from "@/lib/onboarding/copy.pt-BR";
import { getAiPersona } from "@/lib/ai-persona";

interface OnboardingSpotlightProps {
  rect: TourTargetRect | null;
  found: boolean;
}

export function OnboardingSpotlight({ rect, found }: OnboardingSpotlightProps) {
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
    satisfyCurrentInteractiveStep,
    dispatchCommand,
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

  if (!isRunnerActive || !currentStep) return null;

  const pad = 8;
  const hasRect = Boolean(found && rect && rect.width > 0 && rect.height > 0);
  const box = hasRect && rect
    ? {
        top: Math.max(4, rect.top - pad),
        left: Math.max(4, rect.left - pad),
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1280;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;

  // Position speech card near the target when possible, or dock cleanly at bottom-right
  const cardWidth = Math.min(440, viewportW - 24);
  let cardTop = Math.max(16, viewportH - 310);
  let cardLeft = Math.max(12, viewportW - cardWidth - 20);

  if (box) {
    const spaceBelow = viewportH - (box.top + box.height);
    const spaceAbove = box.top;
    if (spaceBelow >= 275) {
      cardTop = Math.min(viewportH - 270, box.top + box.height + 14);
      cardLeft = Math.min(
        Math.max(12, box.left),
        Math.max(12, viewportW - cardWidth - 16),
      );
    } else if (spaceAbove >= 275) {
      cardTop = Math.max(12, box.top - 260);
      cardLeft = Math.min(
        Math.max(12, box.left),
        Math.max(12, viewportW - cardWidth - 16),
      );
    }
  }

  const isInteractive =
    currentStep.mode === "I" || currentStep.mode === "interactive_demo";
  const isSimulated =
    currentStep.mode === "D" || currentStep.mode === "simulated";

  const modeBadge = isInteractive
    ? { label: "Exercício Guiado", color: "bg-amber-500/20 text-amber-300 border-amber-500/40" }
    : isSimulated
      ? { label: "Simulação Segura", color: "bg-purple-500/20 text-purple-300 border-purple-500/40" }
      : { label: "Explicação Guiada", color: "bg-sky-500/20 text-sky-300 border-sky-500/40" };

  const handleSimulateExercise = async () => {
    if (currentStep.completion.demoAction) {
      await dispatchCommand({
        surface: currentStep.surface,
        name: currentStep.completion.demoAction,
        command: currentStep.completion.demoAction,
        params: currentStep.completion.demoPayload ?? { stepId: currentStep.id },
      });
    }
    satisfyCurrentInteractiveStep();
    await nextStep();
  };

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[10090]"
      aria-live="polite"
    >
      {/* Highlight frame over the target element */}
      {box && (
        <div
          style={{
            top: `${box.top}px`,
            left: `${box.left}px`,
            width: `${box.width}px`,
            height: `${box.height}px`,
          }}
          className="pointer-events-none fixed z-[10091] rounded-2xl border-2 border-primary ring-4 ring-primary/30 transition-all duration-200 ease-out shadow-[0_0_0_9999px_rgba(2,6,23,0.58)]"
        />
      )}

      {!box && (
        <div className="pointer-events-none fixed inset-0 z-[10091] bg-slate-950/45 backdrop-blur-[1px]" />
      )}

      {/* Floating Fagner/Valentina Assistant Card */}
      <div
        data-tour="onboarding.spotlight-card"
        style={{
          top: `${cardTop}px`,
          left: `${cardLeft}px`,
          width: `${cardWidth}px`,
        }}
        className="pointer-events-auto fixed z-[10095] rounded-2xl border border-slate-700/80 bg-slate-900/95 p-4 text-slate-100 shadow-2xl backdrop-blur-xl transition-all duration-200"
      >
        {/* Top bar: Persona + Chapter + Step counter */}
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-primary/50 bg-slate-800">
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
                <span className="text-xs font-bold text-white">{persona.name}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${modeBadge.color}`}
                >
                  {modeBadge.label}
                </span>
              </div>
              <p className="truncate text-[11px] text-slate-400">
                {currentChapter ? `${currentChapter.order}. ${currentChapter.title}` : "Tour Guiado"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <SystemTooltip content="Ver capítulos e progresso completo">
              <button
                type="button"
                onClick={() => setIsChapterDrawerOpen(true)}
                className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/90 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
              >
                <Layers className="h-3.5 w-3.5 text-primary" />
                <span>
                  {currentStepIndex + 1}/{ Math.max(1, applicableSteps.length) }
                </span>
              </button>
            </SystemTooltip>

            <SystemTooltip content="Pausar e continuar depois">
              <button
                type="button"
                onClick={() => void pauseTour()}
                className="rounded-lg border border-slate-700 bg-slate-800/90 p-1.5 text-slate-300 hover:bg-slate-700 hover:text-white"
              >
                <Pause className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-400 transition-all duration-300"
            style={{ width: `${Math.max(3, coverage.completionPct)}%` }}
          />
        </div>

        {/* Step Title & Body */}
        <div className="mb-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-white leading-snug">
              {interpolated.title}
            </h3>
            <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
              {currentStep.id}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-slate-300">
            {interpolated.body}
          </p>
        </div>

        {/* Target status indicator when in Demo Fallback */}
        {!hasRect && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-200">
            <Compass className="h-3.5 w-3.5 shrink-0 text-sky-400" />
            <span>
              Superfície demonstrativa sincronizada no painel de treino abaixo.
            </span>
          </div>
        )}

        {/* Controls Footer */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={() => void prevStep()}
            disabled={currentStepIndex <= 0}
            className="flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Anterior</span>
          </button>

          <div className="flex items-center gap-1.5">
            {isInteractive && (
              <SystemTooltip content="Executar demonstração guiada deste comando e avançar">
                <button
                  type="button"
                  onClick={() => void handleSimulateExercise()}
                  className="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/30"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Praticar Ação</span>
                </button>
              </SystemTooltip>
            )}

            <button
              type="button"
              onClick={() => void nextStep()}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground shadow-lg transition hover:opacity-95"
            >
              <span>
                {currentStepIndex >= applicableSteps.length - 1
                  ? "Finalizar Tour"
                  : "Próximo"}
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
