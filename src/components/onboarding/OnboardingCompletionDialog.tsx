import React from "react";
import {
  AlertCircle,
  ArrowRight,
  Award,
  CheckCircle2,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useOnboarding } from "@/hooks/useOnboarding";
import { ONBOARDING_STEPS_BY_ID } from "@/lib/onboarding/manifest";

export function OnboardingCompletionDialog() {
  const {
    isCompletionOpen,
    setIsCompletionOpen,
    coverage,
    chapters,
    progress,
    personaName,
    operatorFirstName,
    completeTour,
    returnToRealOperation,
    goToStep,
    restartTour,
  } = useOnboarding();

  if (!isCompletionOpen) return null;

  const isCompleted = progress?.status === "completed";
  const missingSteps = coverage.missingStepIds
    .map((id: string) => ONBOARDING_STEPS_BY_ID.get(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  return (
    <div className="fixed inset-0 z-[10110] flex items-center justify-center bg-black/55 dark:bg-black/70 p-4 backdrop-blur-sm">
      <div
        data-tour="onboarding.summary"
        className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-card"
      >
        <div className="border-b border-border bg-muted/30 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/15 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                <Award className="h-6 w-6" />
              </div>
              <div>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 dark:bg-emerald-950/50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                  <Sparkles className="h-3 w-3" />
                  Resumo do Treinamento
                </span>
                <h2 className="mt-1 text-lg font-bold text-foreground">
                  {coverage.canComplete || isCompleted
                    ? `Parabéns, ${operatorFirstName}! Cobertura 100% concluída.`
                    : `Quase lá, ${operatorFirstName}! (${coverage.completionPct}%)`}
                </h2>
              </div>
            </div>

            <SystemTooltip content="Fechar resumo">
              <button
                type="button"
                onClick={() => setIsCompletionOpen(false)}
                className="rounded-xl border border-border bg-card/80 p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </SystemTooltip>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {coverage.canComplete || isCompleted
              ? `Você percorreu todos os ${chapters.length} capítulos da operação com ${personaName}: Início, Chat, Negociações (CRM), Mini Chat, Tarefas, Base de Clientes, Minha Carteira e Configurações Pessoais.`
              : `Para registrar a conclusão oficial com 100% de cobertura, conclua as etapas pendentes listadas abaixo.`}
          </p>

          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-2xl border border-border bg-background/60 p-3 text-center">
              <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                {coverage.completionPct}%
              </div>
              <div className="text-[11px] text-muted-foreground">Cobertura</div>
            </div>
            <div className="rounded-2xl border border-border bg-background/60 p-3 text-center">
              <div className="text-lg font-bold text-foreground">
                {coverage.satisfiedInstructionalStepIds.length}/{coverage.applicableInstructionalStepIds.length}
              </div>
              <div className="text-[11px] text-muted-foreground">Etapas Aplicáveis</div>
            </div>
            <div className="rounded-2xl border border-border bg-background/60 p-3 text-center">
              <div className="text-lg font-bold text-primary">
                {chapters.length}
              </div>
              <div className="text-[11px] text-muted-foreground">Capítulos</div>
            </div>
          </div>

          {missingSteps.length > 0 && !isCompleted && (
            <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-2xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-950/40 p-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-200">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>Etapas pendentes ({missingSteps.length}):</span>
              </div>
              {missingSteps.slice(0, 8).map((step) => (
                  <div
                    key={step.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-card px-2.5 py-1.5 text-xs"
                  >
                    <span className="truncate text-foreground">{step.title}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCompletionOpen(false);
                        void goToStep(step.id);
                      }}
                      className="shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/15 dark:bg-amber-950/60 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300 transition hover:bg-amber-500/25 cursor-pointer"
                    >
                      Ir para etapa
                    </button>
                  </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/25 px-6 py-4">
          <button
            type="button"
            onClick={() => void restartTour()}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition hover:bg-muted cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reiniciar Tour</span>
          </button>

          <div className="flex items-center gap-2">
            {!isCompleted && coverage.canComplete && (
              <button
                type="button"
                data-tour="onboarding.complete-tour"
                onClick={() => void completeTour()}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 dark:bg-emerald-500 px-4 py-2 text-xs font-bold text-white dark:text-slate-950 shadow-soft transition hover:opacity-95 cursor-pointer"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Confirmar Conclusão</span>
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
