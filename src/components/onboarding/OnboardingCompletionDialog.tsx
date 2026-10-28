import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CheckCircle2, RotateCcw, Sparkles, X } from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useOnboarding } from "@/hooks/useOnboarding";
import { getAiPersona } from "@/lib/ai-persona";

export function OnboardingCompletionDialog() {
  const {
    isCompletionOpen,
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

  const isTecfag = eligibilityContext.tenantId === "tecfag";
  const persona = getAiPersona(eligibilityContext.tenantId);
  const mascotSrc = isTecfag
    ? "/fagner-onboarding-768.png"
    : persona.avatarFullUrl || persona.avatarHdUrl || persona.avatarUrl;
  const mascotSrcSet = isTecfag
    ? "/fagner-onboarding-512.png 1x, /fagner-onboarding-768.png 1.5x, /fagner-onboarding.png 2x"
    : undefined;

  const isCompleted = progress?.status === "completed";
  const moduleTitle = activeModuleChapter?.shortTitle || activeModuleChapter?.title || "Módulo";

  return (
    <AnimatePresence>
      {isCompletionOpen && (
        <motion.div
          key="onboarding-completion-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="fixed inset-0 z-[10110] flex items-center justify-center bg-black/60 dark:bg-black/75 p-4 backdrop-blur-sm"
        >
          <motion.div
            key={`onboarding-completion-card-${activeModuleChapter?.id || "default"}`}
            data-tour="onboarding.summary"
            initial={{ opacity: 0, scale: 0.84, y: 32 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 18 }}
            transition={{ type: "spring", stiffness: 310, damping: 24 }}
            className="relative w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-card"
          >
            <div className="absolute right-4 top-4 z-20">
              <SystemTooltip content="Fechar resumo">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.08, rotate: 90 }}
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: "spring", stiffness: 360, damping: 20 }}
                  onClick={returnToRealOperation}
                  className="rounded-xl border border-border bg-card/85 p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </motion.button>
              </SystemTooltip>
            </div>

            <div className="relative flex flex-col items-center justify-end overflow-hidden bg-gradient-to-b from-emerald-500/20 via-muted/35 to-card px-6 pt-6">
              {/* Brilho esmeralda celebratório */}
              <motion.div
                animate={{
                  scale: [1, 1.18, 1],
                  opacity: [0.45, 0.8, 0.45],
                }}
                transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
                className="pointer-events-none absolute top-4 h-40 w-40 rounded-full bg-emerald-500/25 blur-3xl"
              />

              <motion.div
                animate={{ y: [0, -10, 0], opacity: [0.45, 1, 0.45], rotate: [0, 18, 0] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                className="pointer-events-none absolute left-10 top-8 text-emerald-500"
              >
                <Sparkles className="h-4 w-4" />
              </motion.div>
              <motion.div
                animate={{ y: [0, -12, 0], opacity: [0.4, 0.95, 0.4], rotate: [0, -18, 0] }}
                transition={{ duration: 2.9, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
                className="pointer-events-none absolute right-12 top-10 text-primary"
              >
                <Sparkles className="h-4 w-4" />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 36, scale: 0.88 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 270, damping: 18, delay: 0.05 }}
                className="relative z-10"
              >
                <motion.img
                  src={mascotSrc}
                  srcSet={mascotSrcSet}
                  alt={persona.name}
                  decoding="async"
                  draggable={false}
                  animate={{ y: [0, -5, 0] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  className="h-44 w-auto object-contain select-none pointer-events-none"
                  onError={(e) => {
                    const img = e.currentTarget as HTMLImageElement;
                    img.srcset = "";
                    img.src = persona.avatarUrl;
                  }}
                />
              </motion.div>
            </div>

            <div className="space-y-3 px-6 pt-3 pb-5 text-center">
              <motion.div
                initial={{ opacity: 0, scale: 0.85, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 22, delay: 0.1 }}
                className="flex justify-center"
              >
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 dark:bg-emerald-950/50 px-3 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                  <Sparkles className="h-3 w-3 animate-pulse" />
                  <span>Módulo {moduleTitle} Concluído</span>
                </span>
              </motion.div>

              <motion.h2
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.14 }}
                className="text-lg font-bold text-foreground"
              >
                Parabéns, {operatorFirstName}!
              </motion.h2>

              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.18 }}
                className="text-xs leading-relaxed text-muted-foreground"
              >
                Você concluiu as{" "}
                <strong className="text-foreground">{applicableSteps.length} etapas</strong> do
                módulo <strong className="text-foreground">{moduleTitle}</strong> com {personaName}.
                Ao entrar nos outros módulos, você poderá fazer o tour de cada um no seu ritmo.
              </motion.p>

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <motion.div
                  initial={{ opacity: 0, y: 12, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 22, delay: 0.22 }}
                  className="rounded-2xl border border-border bg-background/60 p-2.5 text-center"
                >
                  <div className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                    {applicableSteps.length}/{applicableSteps.length}
                  </div>
                  <div className="text-[11px] text-muted-foreground">Etapas deste Módulo</div>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, y: 12, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 22, delay: 0.27 }}
                  className="rounded-2xl border border-border bg-background/60 p-2.5 text-center"
                >
                  <div className="text-base font-bold text-primary">
                    {coverage.completionPct}% ({chapters.length} mód.)
                  </div>
                  <div className="text-[11px] text-muted-foreground">Cobertura Geral</div>
                </motion.div>
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.3 }}
              className="flex flex-wrap items-center justify-between gap-2.5 border-t border-border bg-muted/25 px-6 py-4"
            >
              <motion.button
                type="button"
                whileHover={{ scale: 1.03, y: -1 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => void startModuleTour(activeModuleChapter?.id)}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition hover:bg-muted cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Refazer Módulo</span>
              </motion.button>

              <div className="flex items-center gap-2">
                {!isCompleted &&
                  (coverage.canComplete || currentStep?.id === "finish.complete") && (
                    <motion.button
                      type="button"
                      data-tour="onboarding.complete-tour"
                      whileHover={{ scale: 1.03, y: -1 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => void completeTour()}
                      className="flex items-center gap-1.5 rounded-xl bg-emerald-600 dark:bg-emerald-500 px-3.5 py-2 text-xs font-bold text-white dark:text-slate-950 shadow-soft transition hover:opacity-95 cursor-pointer"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Confirmar 100%</span>
                    </motion.button>
                  )}

                <motion.button
                  type="button"
                  data-tour="onboarding.return-to-operation"
                  whileHover={{ scale: 1.03, y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={returnToRealOperation}
                  className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-soft transition hover:opacity-95 cursor-pointer"
                >
                  <span>Voltar para Minha Operação</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

