import React from "react";
import {
  CheckCircle2,
  Clock,
  Compass,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useOnboarding } from "@/hooks/useOnboarding";
import { getAiPersona } from "@/lib/ai-persona";

export function OnboardingWelcomeDialog() {
  const {
    isWelcomeOpen,
    setIsWelcomeOpen,
    progress,
    chapters,
    coverage,
    personaName,
    operatorFirstName,
    eligibilityContext,
    startTour,
    resumeTour,
    deferTour,
    restartTour,
  } = useOnboarding();

  if (!isWelcomeOpen) return null;

  const persona = getAiPersona(eligibilityContext.tenantId);
  const status = progress?.status ?? "not_started";
  const hasProgress =
    status === "in_progress" || status === "paused" || (progress?.completedStepIds.length ?? 0) > 0;

  return (
    <div className="fixed inset-0 z-[10110] flex items-center justify-center bg-black/55 dark:bg-black/70 p-4 backdrop-blur-sm">
      <div
        data-tour="onboarding.welcome-modal"
        className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-card"
      >
        {/* Header Banner */}
        <div className="relative border-b border-border bg-muted/30 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl border-2 border-primary/60 bg-muted shadow-soft">
                <img
                  src={persona.avatarHdUrl || persona.avatarUrl}
                  alt={persona.name}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary-soft px-2.5 py-0.5 text-xs font-bold text-primary">
                    <Sparkles className="h-3 w-3" />
                    Wizard de Onboarding Guiado
                  </span>
                  {status === "completed" && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 dark:bg-emerald-950/50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" />
                      Concluído ({coverage.completionPct}%)
                    </span>
                  )}
                </div>
                <h2 className="mt-1 text-xl font-bold text-foreground">
                  Olá, {operatorFirstName}! Eu sou {persona.gender === "female" ? "a" : "o"}{" "}
                  {personaName}.
                </h2>
                <p className="text-xs text-muted-foreground">
                  Vamos praticar sua rotina comercial e de atendimento em exercícios separados, com
                  dados fictícios.
                </p>
              </div>
            </div>

            <SystemTooltip content="Fechar janela">
              <button
                type="button"
                onClick={() => setIsWelcomeOpen(false)}
                className="rounded-xl border border-border bg-card/80 p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </SystemTooltip>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          {/* Scope Summary */}
          <div
            data-tour="onboarding.scope-summary"
            className="rounded-2xl border border-border bg-background/60 p-4"
          >
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-foreground">
                <Compass className="h-4 w-4 text-primary" />
                <span>Mapa dos {chapters.length} Capítulos da Sua Rotina</span>
              </div>
              <span className="text-xs font-semibold text-muted-foreground">
                {coverage.satisfiedInstructionalStepIds.length}/{coverage.eligibleStepIds.length}{" "}
                etapas ({coverage.completionPct}%)
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {chapters.map((chapter) => (
                <div
                  key={chapter.id}
                  className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-2.5 shadow-2xs"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary-soft text-xs font-bold text-primary">
                    {chapter.order}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-foreground">{chapter.title}</p>
                    <p className="line-clamp-1 text-[11px] text-muted-foreground">{chapter.subtitle}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Demo Safety Guarantee */}
          <div
            data-tour="onboarding.demo-safety"
            className="flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-950/30 p-3.5 text-xs"
          >
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="space-y-1">
              <p className="font-bold text-foreground">
                Ambiente de Demonstração 100% Seguro e Isolado
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Durante o treinamento, todas as interações acontecem em dados de demonstração em
                memória. Nenhuma mensagem real será enviada para clientes, nenhum negócio ou tarefa
                real será sujado no banco de dados e seu atendimento atual será restaurado
                exatamente onde estava ao finalizar ou pausar.
              </p>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/25 px-6 py-4">
          <button
            type="button"
            data-tour="onboarding.defer-tour"
            onClick={() => void deferTour(240)}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground cursor-pointer"
          >
            <Clock className="h-3.5 w-3.5" />
            <span>Lembrar mais tarde</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {hasProgress && (
              <button
                type="button"
                onClick={() => void restartTour()}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition hover:bg-muted cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reiniciar do início</span>
              </button>
            )}

            {hasProgress && status !== "completed" ? (
              <button
                type="button"
                data-tour="onboarding.start-tour"
                onClick={() => void resumeTour()}
                className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-xs font-bold text-primary-foreground shadow-soft transition hover:opacity-95 cursor-pointer"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Retomar de onde parei ({coverage.completionPct}%)</span>
              </button>
            ) : (
              <button
                type="button"
                data-tour="onboarding.start-tour"
                onClick={() => void startTour()}
                className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-xs font-bold text-primary-foreground shadow-soft transition hover:opacity-95 cursor-pointer"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>{status === "completed" ? "Refazer Tour Guiado" : "Iniciar Tour Agora"}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
