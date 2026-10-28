import React from "react";
import { Clock, Play, Sparkles, X } from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useOnboarding } from "@/hooks/useOnboarding";
import { getAiPersona } from "@/lib/ai-persona";

export function OnboardingWelcomeDialog() {
  const {
    isWelcomeOpen,
    activeModuleChapter,
    allApplicableSteps,
    personaName,
    operatorFirstName,
    eligibilityContext,
    startModuleTour,
    deferModuleTour,
  } = useOnboarding();

  if (!isWelcomeOpen) return null;

  const persona = getAiPersona(eligibilityContext.tenantId);
  const mascotSrc =
    eligibilityContext.tenantId === "tecfag"
      ? "/fagner-onboarding.png"
      : persona.avatarFullUrl || persona.avatarHdUrl || persona.avatarUrl;

  const moduleTitle = activeModuleChapter?.shortTitle || activeModuleChapter?.title || "Início";
  const moduleStepCount = activeModuleChapter
    ? allApplicableSteps.filter((s) => s.chapterId === activeModuleChapter.id).length
    : allApplicableSteps.length;

  return (
    <div className="fixed inset-0 z-[10110] flex items-center justify-center bg-black/55 dark:bg-black/70 p-4 backdrop-blur-sm">
      <div
        data-tour="onboarding.welcome-modal"
        className="relative w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-card"
      >
        {/* Botão Fechar */}
        <div className="absolute right-4 top-4 z-10">
          <SystemTooltip content="Fazer mais tarde">
            <button
              type="button"
              onClick={() => void deferModuleTour()}
              className="rounded-xl border border-border bg-card/85 p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </SystemTooltip>
        </div>

        {/* Ilustração do Fagner */}
        <div className="relative flex flex-col items-center justify-end bg-gradient-to-b from-primary/15 via-muted/35 to-card px-6 pt-6">
          <img
            src={mascotSrc}
            alt={persona.name}
            className="h-52 w-auto object-contain drop-shadow-xl select-none pointer-events-none"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = persona.avatarUrl;
            }}
          />
        </div>

        {/* Texto de Boas-vindas Simplificado */}
        <div className="space-y-2.5 px-6 pt-3 pb-5 text-center">
          <div className="flex justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary-soft px-3 py-0.5 text-xs font-bold text-primary">
              <Sparkles className="h-3 w-3" />
              <span>Tour do Módulo: {moduleTitle}</span>
            </span>
          </div>

          <h2 className="text-xl font-bold text-foreground">
            Olá, {operatorFirstName}! Seja bem-vindo!
          </h2>

          <p className="text-sm leading-relaxed text-muted-foreground">
            Eu sou {persona.gender === "female" ? "a" : "o"}{" "}
            <strong className="text-foreground">{personaName}</strong>. Gostaria de fazer o tour
            guiado do módulo <strong className="text-foreground">{moduleTitle}</strong> agora ou
            prefere fazer mais tarde?
          </p>

          <p className="text-[11px] text-muted-foreground/80">
            São apenas {moduleStepCount} etapas rápidas com dados de demonstração, sem afetar seus
            atendimentos reais.
          </p>
        </div>

        {/* Ações: Fazer mais tarde | Fazer agora */}
        <div className="flex items-center gap-3 border-t border-border bg-muted/25 px-6 py-4">
          <button
            type="button"
            data-tour="onboarding.defer-tour"
            onClick={() => void deferModuleTour()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground cursor-pointer"
          >
            <Clock className="h-3.5 w-3.5" />
            <span>Fazer mais tarde</span>
          </button>

          <button
            type="button"
            data-tour="onboarding.start-tour"
            onClick={() => void startModuleTour(activeModuleChapter?.id)}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground shadow-soft transition hover:opacity-95 cursor-pointer"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>Fazer agora</span>
          </button>
        </div>
      </div>
    </div>
  );
}
