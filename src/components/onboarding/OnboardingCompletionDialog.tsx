import React from "react";
import { ArrowRight, CheckCircle2, RotateCcw, Sparkles, X } from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useOnboarding } from "@/hooks/useOnboarding";
import { getAiPersona } from "@/lib/ai-persona";

export function OnboardingCompletionDialog() {
  const {
    isCompletionOpen,
    setIsCompletionOpen,
    coverage,
    chapters,
    progress,
    currentStep,
    activeModuleChapter,
    applicableSteps,
    personaName,
    operatorFirstName,
    eligibilityContext,
    completeTour,
    returnToRealOperation,
    startModuleTour,
  } = useOnboarding();

  if (!isCompletionOpen) return null;

  const persona = getAiPersona(eligibilityContext.tenantId);
  const mascotSrc =
    eligibilityContext.tenantId === "tecfag"
      ? "/fagner-onboarding.png"
      : persona.avatarFullUrl || persona.avatarHdUrl || persona.avatarUrl;

  const isCompleted = progress?.status === "completed";
  const moduleTitle = activeModuleChapter?.shortTitle || activeModuleChapter?.title || "Módulo";

  return (
    <div className="fixed inset-0 z-[10110] flex items-center justify-center bg-black/55 dark:bg-black/70 p-4 backdrop-blur-sm">
      <div
        data-tour="onboarding.summary"
        className="relative w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-card"
      >
        <div className="absolute right-4 top-4 z-10">
          <SystemTooltip content="Fechar resumo">
            <button
              type="button"
              onClick={returnToRealOperation}
              className="rounded-xl border border-border bg-card/85 p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </SystemTooltip>
        </div>

        <div className="relative flex flex-col items-center justify-end bg-gradient-to-b from-emerald-500/15 via-muted/35 to-card px-6 pt-6">
          <img
            src={mascotSrc}
            alt={persona.name}
            className="h-44 w-auto object-contain drop-shadow-xl select-none pointer-events-none"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = persona.avatarUrl;
            }}
          />
        </div>

        <div className="space-y-3 px-6 pt-3 pb-5 text-center">
          <div className="flex justify-center">
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 dark:bg-emerald-950/50 px-3 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
              <Sparkles className="h-3 w-3" />
              <span>Módulo {moduleTitle} Concluído</span>
            </span>
          </div>

          <h2 className="text-lg font-bold text-foreground">
            Parabéns, {operatorFirstName}!
          </h2>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Você concluiu as <strong className="text-foreground">{applicableSteps.length} etapas</strong> do módulo{" "}
            <strong className="text-foreground">{moduleTitle}</strong> com {personaName}. Ao entrar nos outros módulos, você poderá fazer o tour de cada um no seu ritmo.
          </p>

          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <div className="rounded-2xl border border-border bg-background/60 p-2.5 text-center">
              <div className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                {applicableSteps.length}/{applicableSteps.length}
              </div>
              <div className="text-[11px] text-muted-foreground">Etapas deste Módulo</div>
            </div>
            <div className="rounded-2xl border border-border bg-background/60 p-2.5 text-center">
              <div className="text-base font-bold text-primary">
                {coverage.completionPct}% ({chapters.length} mód.)
              </div>
              <div className="text-[11px] text-muted-foreground">Cobertura Geral</div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-border bg-muted/25 px-6 py-4">
          <button
            type="button"
            onClick={() => void startModuleTour(activeModuleChapter?.id)}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition hover:bg-muted cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Refazer Módulo</span>
          </button>

          <div className="flex items-center gap-2">
            {!isCompleted && (coverage.canComplete || currentStep?.id === "finish.complete") && (
              <button
                type="button"
                data-tour="onboarding.complete-tour"
                onClick={() => void completeTour()}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 dark:bg-emerald-500 px-3.5 py-2 text-xs font-bold text-white dark:text-slate-950 shadow-soft transition hover:opacity-95 cursor-pointer"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Confirmar 100%</span>
              </button>
            )}

            <button
              type="button"
              data-tour="onboarding.return-to-operation"
              onClick={returnToRealOperation}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-soft transition hover:opacity-95 cursor-pointer"
            >
              <span>Voltar para Minha Operação</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
