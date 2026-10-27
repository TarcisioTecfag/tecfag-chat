import React from "react";
import {
  CheckCircle2,
  Circle,
  Layers,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
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
    <div className="fixed inset-0 z-[10105] flex justify-end bg-slate-950/60 backdrop-blur-xs">
      <div className="flex h-full w-full max-w-md flex-col border-l border-slate-800 bg-slate-900 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Layers className="h-5 w-5 text-primary" />
            <div>
              <h3 className="text-sm font-bold text-white">
                Capítulos & Etapas do Tour
              </h3>
              <p className="text-[11px] text-slate-400">
                {coverage.completedEligibleCount} de {coverage.totalEligibleCount} etapas concluídas ({coverage.completionPct}%)
              </p>
            </div>
          </div>

          <SystemTooltip content="Fechar índice do tour">
            <button
              type="button"
              onClick={() => setIsChapterDrawerOpen(false)}
              className="rounded-xl border border-slate-700 bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </SystemTooltip>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {chapters.map((chapter) => {
            const chapterSteps = applicableSteps.filter(
              (s) => s.chapterId === chapter.id,
            );
            const completedCount = chapterSteps.filter((s) =>
              completedSet.has(s.id),
            ).length;
            const isCurrentChapter = currentStep?.chapterId === chapter.id;

            return (
              <div
                key={chapter.id}
                className={`rounded-2xl border p-3.5 transition ${
                  isCurrentChapter
                    ? "border-primary/60 bg-slate-800/80"
                    : "border-slate-800 bg-slate-950/50"
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsChapterDrawerOpen(false);
                      void goToChapter(chapter.id);
                    }}
                    className="text-left"
                  >
                    <span className="text-xs font-bold text-white hover:text-primary">
                      {chapter.order}. {chapter.title}
                    </span>
                    <p className="text-[11px] text-slate-400">
                      {chapter.subtitle}
                    </p>
                  </button>
                  <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
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
                        className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition ${
                          active
                            ? "bg-primary/20 font-bold text-primary"
                            : "text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {done ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                          ) : (
                            <Circle className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                          )}
                          <span className="truncate">{step.title}</span>
                        </div>
                        <span className="shrink-0 font-mono text-[10px] text-slate-500">
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

        <div className="flex items-center justify-between gap-2 border-t border-slate-800 bg-slate-950/90 px-4 py-3">
          <button
            type="button"
            onClick={() => {
              setIsChapterDrawerOpen(false);
              void pauseTour();
            }}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
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
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
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
              className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground"
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
