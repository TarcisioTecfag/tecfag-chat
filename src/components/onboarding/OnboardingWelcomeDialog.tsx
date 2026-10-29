import React from "react";
import { AnimatePresence, motion } from "framer-motion";
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

  const isTecfag = eligibilityContext.tenantId === "tecfag";
  const persona = getAiPersona(eligibilityContext.tenantId);
  const mascotSrc = isTecfag
    ? "/fagner-onboarding-768.png"
    : persona.avatarFullUrl || persona.avatarHdUrl || persona.avatarUrl;
  const mascotSrcSet = isTecfag
    ? "/fagner-onboarding-512.png 1x, /fagner-onboarding-768.png 1.5x, /fagner-onboarding.png 2x"
    : undefined;

  const moduleTitle = activeModuleChapter?.shortTitle || activeModuleChapter?.title || "Início";
  const moduleStepCount = activeModuleChapter
    ? allApplicableSteps.filter((s) => s.chapterId === activeModuleChapter.id).length
    : allApplicableSteps.length;

  React.useEffect(() => {
    if (!isWelcomeOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void deferModuleTour();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isWelcomeOpen, deferModuleTour]);

  return (
    <AnimatePresence>
      {isWelcomeOpen && (
        <motion.div
          key="onboarding-welcome-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          onClick={() => void deferModuleTour()}
          className="fixed inset-0 z-[10110] flex items-center justify-center bg-black/60 dark:bg-black/75 p-4 backdrop-blur-sm"
        >
          <motion.div
            key={`onboarding-welcome-card-${activeModuleChapter?.id || "default"}`}
            data-tour="onboarding.welcome-modal"
            initial={{ opacity: 0, scale: 0.86, y: 28 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 18 }}
            transition={{ type: "spring", stiffness: 320, damping: 25 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-card"
          >
            {/* Botão Fechar */}
            <div className="absolute right-4 top-4 z-20">
              <SystemTooltip content="Fazer mais tarde">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.08, rotate: 90 }}
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: "spring", stiffness: 360, damping: 20 }}
                  onClick={() => void deferModuleTour()}
                  className="rounded-xl border border-border bg-card/85 p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </motion.button>
              </SystemTooltip>
            </div>

            {/* Ilustração Animada do Fagner */}
            <div className="relative flex flex-col items-center justify-end overflow-hidden bg-gradient-to-b from-primary/20 via-muted/35 to-card px-6 pt-6">
              {/* Brilho radial vivo ao fundo */}
              <motion.div
                animate={{
                  scale: [1, 1.15, 1],
                  opacity: [0.45, 0.75, 0.45],
                }}
                transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
                className="pointer-events-none absolute top-6 h-40 w-40 rounded-full bg-primary/25 blur-3xl"
              />

              {/* Partículas flutuantes sutis */}
              <motion.div
                animate={{ y: [0, -8, 0], opacity: [0.4, 0.95, 0.4], rotate: [0, 12, 0] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
                className="pointer-events-none absolute left-10 top-8 text-primary/70"
              >
                <Sparkles className="h-4 w-4" />
              </motion.div>
              <motion.div
                animate={{ y: [0, -10, 0], opacity: [0.35, 0.85, 0.35], rotate: [0, -15, 0] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: 0.7 }}
                className="pointer-events-none absolute right-12 top-12 text-primary/60"
              >
                <Sparkles className="h-3.5 w-3.5" />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 36, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.05 }}
                className="relative z-10"
              >
                <motion.img
                  src={mascotSrc}
                  srcSet={mascotSrcSet}
                  alt={persona.name}
                  decoding="async"
                  draggable={false}
                  animate={{ y: [0, -5, 0] }}
                  transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
                  className="h-52 w-auto object-contain select-none pointer-events-none"
                  onError={(e) => {
                    const img = e.currentTarget as HTMLImageElement;
                    img.srcset = "";
                    img.src = persona.avatarUrl;
                  }}
                />
              </motion.div>
            </div>

            {/* Texto de Boas-vindas com Stagger Suave */}
            <div className="space-y-2.5 px-6 pt-3 pb-5 text-center">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.1 }}
                className="flex justify-center"
              >
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary-soft px-3 py-0.5 text-xs font-bold text-primary">
                  <Sparkles className="h-3 w-3 animate-pulse" />
                  <span>Tour do Módulo: {moduleTitle}</span>
                </span>
              </motion.div>

              <motion.h2
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.15 }}
                className="text-xl font-bold text-foreground"
              >
                Olá, {operatorFirstName}! Seja bem-vindo!
              </motion.h2>

              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.2 }}
                className="text-sm leading-relaxed text-muted-foreground"
              >
                Eu sou {persona.gender === "female" ? "a" : "o"}{" "}
                <strong className="text-foreground">{personaName}</strong>. Gostaria de fazer o tour
                guiado do módulo <strong className="text-foreground">{moduleTitle}</strong> agora ou
                prefere fazer mais tarde?
              </motion.p>

              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.24 }}
                className="text-[11px] text-muted-foreground/80"
              >
                São apenas {moduleStepCount} etapas rápidas com dados de demonstração, sem afetar
                seus atendimentos reais.
              </motion.p>
            </div>

            {/* Ações: Fazer mais tarde | Fazer agora */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.28 }}
              className="flex items-center gap-3 border-t border-border bg-muted/25 px-6 py-4"
            >
              <motion.button
                type="button"
                data-tour="onboarding.defer-tour"
                whileHover={{ scale: 1.02, y: -1 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => void deferModuleTour()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground cursor-pointer"
              >
                <Clock className="h-3.5 w-3.5" />
                <span>Fazer mais tarde</span>
              </motion.button>

              <motion.button
                type="button"
                data-tour="onboarding.start-tour"
                whileHover={{ scale: 1.03, y: -1 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => void startModuleTour(activeModuleChapter?.id)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground shadow-soft transition hover:opacity-95 cursor-pointer"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Fazer agora</span>
              </motion.button>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

