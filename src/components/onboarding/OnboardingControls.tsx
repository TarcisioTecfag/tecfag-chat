import React from "react";
import { CheckCircle2, Circle, Layers, Pause, Play, RotateCcw, X } from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useOnboarding } from "@/hooks/useOnboarding";

export function OnboardingControls() {
  const {
    isChapterDrawerOpen,
    setIsChapterDrawerOpen,
    chapters,
    applicableSteps,
    currentStep,
    progress,
    coverage,
    goToChapter,
    goToStep,
    pauseTour,
    restartTour,
    setIsCompletionOpen,
  } = useOnboarding();

  if (!isChapterDrawerOpen) return null;

  const completedSet = new Set(progress?.completedStepIds ?? []);

  return (
    <div className="fixed inset-0 z-[10105] flex justify-end bg-black/50 dark:bg-black/65 backdrop-blur-xs">
      <div className="flex h-full w-full max-w-md flex-col border-l border-border bg-card text-card-foreground shadow-card">
        <div className="flex items-center justify-between border-b border-border bg-muted/25 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Layers className="h-5 w-5 text-primary" />
            <div>
              <h3 className="text-sm font-bold text-foreground">Capítulos & Etapas do Tour</h3>
              <p className="text-[11px] text-muted-foreground">
                {coverage.satisfiedInstructionalStepIds.length} de {coverage.eligibleStepIds.length}{" "}
                etapas concluídas ({coverage.completionPct}%)
              </p>
            </div>
          </div>

          <SystemTooltip content="Fechar índice do tour">
            <button
              type="button"
              aria-label="Fechar índice do tour"
              onClick={() => setIsChapterDrawerOpen(false)}
              className="rounded-xl border border-border bg-card/80 p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </SystemTooltip>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {chapters.map((chapter) => {
            const chapterSteps = applicableSteps.filter((s) => s.chapterId === chapter.id);
            const completedCount = chapterSteps.filter((s) => completedSet.has(s.id)).length;
            const isCurrentChapter = currentStep?.chapterId === chapter.id;

            return (
              <div
                key={chapter.id}
                className={`rounded-2xl border p-3.5 transition ${
                  isCurrentChapter
                    ? "border-primary/50 bg-primary-soft/40 dark:bg-muted/60"
                    : "border-border bg-background/60"
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsChapterDrawerOpen(false);
                      void goToChapter(chapter.id);
                    }}
                    className="text-left cursor-pointer"
                  >
                    <span className="text-xs font-bold text-foreground hover:text-primary transition-colors">
                      {chapter.order}. {chapter.title}
                    </span>
                    <p className="text-[11px] text-muted-foreground">{chapter.subtitle}</p>
                  </button>
                  <span className="shrink-0 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    {completedCount}/{chapterSteps.length}
                  </span>
                </div>

                <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                  {chapterSteps.map((step) => {
                    const done = completedSet.has(step.id);
                    const active = currentStep?.id === step.id;
                    return (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => {
                          setIsChapterDrawerOpen(false);
                          void goToStep(step.id);
                        }}
                        className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition cursor-pointer ${
                          active
                            ? "border border-primary/25 bg-primary-soft font-bold text-primary"
                            : "text-foreground/85 hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {done ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                          )}
                          <span className="truncate">{step.title}</span>
                        </div>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {step.id}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/25 px-4 py-3">
          <button
            type="button"
            onClick={() => {
              setIsChapterDrawerOpen(false);
              void pauseTour();
            }}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted cursor-pointer"
          >
            <Pause className="h-3.5 w-3.5" />
            <span>Pausar</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setIsChapterDrawerOpen(false);
                void restartTour();
              }}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reiniciar</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsChapterDrawerOpen(false);
                setIsCompletionOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground shadow-soft transition hover:opacity-95 cursor-pointer"
            >
              <Play className="h-3.5 w-3.5" />
              <span>Ver Resumo</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
