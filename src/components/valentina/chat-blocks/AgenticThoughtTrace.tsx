// ══════════════════════════════════════════════════════════════════════════════
// 🧠 AGENTIC THOUGHT TRACE COMPONENT — Visualização Agêntica Estilo Antigravity
// 1. Durante o tempo de espera inicial (ou em conversas casuais/simples),
//    exibe apenas o texto "Trabalhando" com gradiente shimmer suave (idêntico ao Antigravity).
// 2. Quando há pesquisa/coleta real de dados, transiciona suavemente para a
//    árvore de ações executadas e depois permanece recolhida acima da resposta final.
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Clock,
  Briefcase,
  Bot,
  MessageSquare,
  Sparkles,
  Users,
  FileText,
  BookOpen,
  CheckCircle2,
} from "lucide-react";
import type {
  AgenticThoughtTraceData,
  AgenticThoughtStep,
  AgenticBadgeType,
} from "@/lib/valentina/agentic-thought-trace";

const SMOOTH_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * Animação minimalista "Trabalhando" com passagem suave de gradiente/sombra nas letras,
 * fiel à referência visual do Antigravity ("Working").
 */
export function WorkingShimmerLabel({
  text = "Trabalhando",
  className = "",
}: {
  text?: string;
  className?: string;
}) {
  return (
    <motion.span
      animate={{
        backgroundPosition: ["100% 0%", "-100% 0%"],
      }}
      transition={{
        duration: 2.1,
        repeat: Infinity,
        ease: "linear",
      }}
      style={{
        backgroundImage:
          "linear-gradient(110deg, color-mix(in srgb, var(--muted-foreground) 58%, transparent) 0%, color-mix(in srgb, var(--muted-foreground) 58%, transparent) 38%, var(--foreground) 50%, color-mix(in srgb, var(--muted-foreground) 58%, transparent) 62%, color-mix(in srgb, var(--muted-foreground) 58%, transparent) 100%)",
        backgroundSize: "220% 100%",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
      }}
      className={`inline-block font-medium tracking-tight select-none ${className}`}
    >
      {text}
    </motion.span>
  );
}

/**
 * Ícones e badges 100% harmonizados com os tokens semânticos nativos do sistema
 * (`primary`, `foreground`, `muted-foreground`, `muted`, `border`).
 */
function StepBadgeIcon({
  type,
  isActive = false,
}: {
  type?: AgenticBadgeType;
  isActive?: boolean;
}) {
  if (type === "sql") {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[9px] font-extrabold tracking-tight leading-none shrink-0 border transition-colors duration-300 ${
          isActive
            ? "bg-primary/15 text-primary border-primary/35 shadow-2xs"
            : "bg-primary/10 text-primary/90 border-primary/20"
        }`}
      >
        SQL
      </span>
    );
  }

  const iconClass = `h-3 w-3 shrink-0 transition-colors duration-300 ${
    isActive || type === "ai" ? "text-primary" : "text-primary/85"
  }`;

  const renderIcon = () => {
    switch (type) {
      case "sla":
        return <Clock className={iconClass} />;
      case "crm":
        return <Briefcase className={iconClass} />;
      case "sdr":
        return <Bot className={iconClass} />;
      case "chat":
        return <MessageSquare className={iconClass} />;
      case "team":
        return <Users className={iconClass} />;
      case "file":
      case "vision":
        return <FileText className={iconClass} />;
      case "kb":
        return <BookOpen className={iconClass} />;
      case "ai":
        return <Sparkles className={iconClass} />;
      default:
        return <Database className={iconClass} />;
    }
  };

  return (
    <span
      className={`inline-flex h-4.5 w-4.5 items-center justify-center rounded-md border shrink-0 transition-all duration-300 ${
        isActive || type === "ai"
          ? "bg-primary/12 border-primary/30 shadow-2xs"
          : "bg-muted/70 border-border/70"
      }`}
    >
      {renderIcon()}
    </span>
  );
}

/**
 * Localiza o ancestral rolável mais próximo e faz scroll suave até o final
 * caso o usuário esteja acompanhando o final da conversa.
 */
function scrollNearestScrollableToBottom(node: HTMLElement | null) {
  if (!node || typeof window === "undefined") return;
  let parent: HTMLElement | null = node.parentElement;
  while (parent) {
    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      parent.scrollHeight > parent.clientHeight
    ) {
      const distanceFromBottom =
        parent.scrollHeight - parent.scrollTop - parent.clientHeight;
      if (distanceFromBottom <= 340) {
        parent.scrollTo({
          top: parent.scrollHeight,
          behavior: "smooth",
        });
      }
      return;
    }
    parent = parent.parentElement;
  }
}

export interface AgenticThoughtTraceProps {
  trace: AgenticThoughtTraceData;
  /** "live" = executando agora (aberto por padrão com timer ao vivo); "completed" = finalizado acima da resposta (recolhido por padrão) */
  mode: "live" | "completed";
  /** Compacto para balões menores (ex: Mini Chat CRM) */
  compact?: boolean;
  className?: string;
  /** Callback disparado sempre que uma nova linha/etapa aparece ou expande em tempo real */
  onStepReveal?: () => void;
}

// Cadência progressiva da animação ao vivo:
// Cada etapa aparece recolhida (Em execução / Gerúndio ›), processa por 2.0s,
// expande suavemente seus detalhes (Concluída ⌄) e aguarda mais 2.2s antes da próxima etapa surgir.
const LIVE_STEP_CYCLE_MS = 4200;
const LIVE_STEP_EXPAND_OFFSET_MS = 2000;

function toActiveGerundVerb(verb: string): string {
  const clean = (verb || "").trim();
  const map: Record<string, string> = {
    Analisou: "Analisando",
    Consultou: "Consultando",
    Verificou: "Verificando",
    Inspecionou: "Inspecionando",
    Buscou: "Buscando",
    Vasculhou: "Vasculhando",
    Cruzou: "Cruzando",
    Extraiu: "Extraindo",
    Leu: "Lendo",
    Gerou: "Gerando",
    Sintetizou: "Sintetizando",
    Respondeu: "Respondendo",
  };
  return map[clean] || clean;
}

function formatLiveScopeTag(scopeTag: string | undefined, isAutoExpanded: boolean): string | undefined {
  if (!scopeTag) return undefined;
  if (isAutoExpanded) return scopeTag;
  return scopeTag.replace(/•\s*\d+\s*ms\b/i, "• em execução");
}

export function AgenticThoughtTrace({
  trace,
  mode,
  compact = false,
  className = "",
  onStepReveal,
}: AgenticThoughtTraceProps) {
  const [isOpen, setIsOpen] = useState<boolean>(mode === "live");
  const [expandedStepIds, setExpandedStepIds] = useState<Record<string, boolean>>({});
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const onStepRevealRef = useRef(onStepReveal);
  onStepRevealRef.current = onStepReveal;

  // Sanitização defensiva para garantir que nunca ocorra React Error #31
  const safeTaskTitle =
    typeof trace?.taskTitle === "string" && trace.taskTitle.trim()
      ? trace.taskTitle
      : "Consultando dados da operação";
  const safeFinishedTitle =
    typeof trace?.finishedTitle === "string" && trace.finishedTitle.trim()
      ? trace.finishedTitle
      : "Consulta concluída";
  const safeSteps: AgenticThoughtStep[] = Array.isArray(trace?.steps)
    ? trace.steps
        .filter((s): s is AgenticThoughtStep => Boolean(s && typeof s === "object" && typeof s.id === "string"))
        .map((s) => ({
          ...s,
          actionVerb: typeof s.actionVerb === "string" ? s.actionVerb : String(s.actionVerb ?? "Executou"),
          targetLabel: typeof s.targetLabel === "string" ? s.targetLabel : String(s.targetLabel ?? ""),
          scopeTag: typeof s.scopeTag === "string" ? s.scopeTag : undefined,
          detailText: typeof s.detailText === "string" ? s.detailText : undefined,
        }))
    : [];

  const isSimpleWorkingOnly =
    Boolean(trace?.isWaitingPhase) ||
    Boolean(trace?.isMinimalWorking) ||
    safeSteps.length === 0;

  // Quando mudar de live para completed, recolhe suavemente e limpa overrides manuais
  useEffect(() => {
    setIsOpen(mode === "live");
    if (mode !== "live") {
      setExpandedStepIds({});
    }
  }, [mode]);

  // Cronômetro em tempo real apenas quando mode === "live" e já saiu da fase inicial de espera
  useEffect(() => {
    if (mode !== "live" || isSimpleWorkingOnly) {
      setElapsedMs(0);
      return;
    }
    setElapsedMs(0);
    const startedAt = Date.now();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 120);
    return () => clearInterval(interval);
  }, [mode, isSimpleWorkingOnly]);

  const triggerFollowScroll = useCallback(() => {
    onStepRevealRef.current?.();
    scrollNearestScrollableToBottom(rootRef.current);
    const t1 = window.setTimeout(() => {
      onStepRevealRef.current?.();
      scrollNearestScrollableToBottom(rootRef.current);
    }, 140);
    const t2 = window.setTimeout(() => {
      onStepRevealRef.current?.();
      scrollNearestScrollableToBottom(rootRef.current);
    }, 320);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  // No modo "live", revela cada etapa sequencialmente a cada LIVE_STEP_CYCLE_MS (0s, 4.2s, 8.4s, 12.6s, 16.8s)
  const visibleSteps: AgenticThoughtStep[] =
    mode === "live"
      ? safeSteps.filter((_, idx) => idx === 0 || elapsedMs >= idx * LIVE_STEP_CYCLE_MS)
      : safeSteps;

  const isStepExpandedAt = useCallback(
    (step: AgenticThoughtStep, idx: number): boolean => {
      const manual = expandedStepIds[step.id];
      if (typeof manual === "boolean") return manual;
      if (mode !== "live") return true;
      const expandThresholdMs = idx * LIVE_STEP_CYCLE_MS + LIVE_STEP_EXPAND_OFFSET_MS;
      return elapsedMs >= expandThresholdMs;
    },
    [expandedStepIds, mode, elapsedMs]
  );

  const toggleStepDetail = (step: AgenticThoughtStep, idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const currentlyOpen = isStepExpandedAt(step, idx);
    setExpandedStepIds((prev) => ({
      ...prev,
      [step.id]: !currentlyOpen,
    }));
  };

  // Auto-scroll progressivo sempre que uma nova etapa aparece OU expande seus detalhes no modo "live"
  const stepsSignature = visibleSteps
    .map((s, idx) => `${s.id}:${isStepExpandedAt(s, idx) ? "open" : "closed"}:${s.scopeTag || ""}:${s.detailText || ""}`)
    .join("|");
  useEffect(() => {
    if (mode !== "live") return;
    const cleanup = triggerFollowScroll();
    return cleanup;
  }, [mode, isOpen, isSimpleWorkingOnly, visibleSteps.length, stepsSignature, triggerFollowScroll]);

  const actionStepsCount = safeSteps.filter((s) => s.kind !== "thought").length;
  const liveSeconds = Math.max(1, Math.floor(elapsedMs / 1000));
  const displayDurationSec =
    mode === "live" ? liveSeconds : Math.max(1, Number(trace?.totalDurationSeconds) || 3);

  const textSize = compact ? "text-[11px]" : "text-xs";
  const subTextSize = compact ? "text-[10.5px]" : "text-[11.5px]";

  // ── MODO CONCLUÍDO (Acima da mensagem da IA — recolhido por padrão) ────────
  if (mode === "completed") {
    // Se foi apenas uma mensagem casual/simples ("Boa tarde", "Valeu", etc.), não exibe trilha acima da resposta
    if (isSimpleWorkingOnly) {
      return null;
    }

    return (
      <div
        ref={rootRef}
        className={`select-none mb-2 min-w-0 max-w-full overflow-hidden ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho resumo clicável (Estilo Antigravity: "Pensou por Xs • N ações ›") */}
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className={`group inline-flex items-center gap-1.5 rounded-lg px-2 py-1 -ml-1 max-w-full flex-wrap ${subTextSize} font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200 cursor-pointer`}
        >
          <Sparkles className="h-3 w-3 text-primary/85 shrink-0 group-hover:text-primary transition-colors duration-200" />
          <span>
            Pensou por{" "}
            <strong className="font-semibold text-foreground/85 tabular-nums">
              {displayDurationSec}s
            </strong>
          </span>
          <span className="text-muted-foreground/45">•</span>
          <span>
            {actionStepsCount} {actionStepsCount === 1 ? "ação executada" : "ações executadas"}
          </span>
          <ChevronRight
            className={`h-3.5 w-3.5 text-muted-foreground/75 transition-transform duration-300 ease-out ${
              isOpen ? "rotate-90 text-primary" : "group-hover:translate-x-0.5"
            }`}
          />
        </button>

        {/* Árvore expandida sob demanda */}
        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.28, ease: SMOOTH_EASE }}
              className="overflow-hidden"
            >
              <div className="pt-1.5 pb-2 pl-1 min-w-0 max-w-full">
                <div
                  className={`${subTextSize} font-medium text-foreground/80 mb-1.5 flex items-center gap-1.5`}
                >
                  <span className="min-w-0 break-words">{safeTaskTitle}</span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                </div>

                {/* Linhas indentadas estilo Antigravity */}
                <div className="ml-2 pl-3.5 border-l border-border/70 space-y-1.5 min-w-0 max-w-full">
                  {safeSteps.map((step, idx) => {
                    const isStepOpen = isStepExpandedAt(step, idx);
                    return (
                      <motion.div
                        key={step.id}
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          duration: 0.22,
                          delay: idx * 0.03,
                          ease: SMOOTH_EASE,
                        }}
                        className="flex flex-col min-w-0 max-w-full"
                      >
                        <div
                          onClick={(e) => step.detailText && toggleStepDetail(step, idx, e)}
                          className={`group/step flex items-center gap-1.5 flex-wrap ${subTextSize} text-muted-foreground ${
                            step.detailText ? "hover:text-foreground cursor-pointer" : ""
                          } transition-colors duration-200 py-0.5`}
                        >
                          {step.kind === "thought" ? (
                            <>
                              <span className="text-muted-foreground/90">{step.actionVerb}</span>
                              <ChevronRight
                                className={`h-3 w-3 text-muted-foreground/65 transition-transform duration-200 ease-out ${
                                  isStepOpen ? "rotate-90 text-primary" : "group-hover/step:translate-x-0.5"
                                }`}
                              />
                            </>
                          ) : (
                            <>
                              <span className="text-muted-foreground/85">{step.actionVerb}</span>
                              <StepBadgeIcon type={step.badgeType} />
                              <span className="font-semibold text-foreground/85 tracking-tight break-words">
                                {step.targetLabel}
                              </span>
                              {step.scopeTag && (
                                <span className="text-muted-foreground/65 font-medium text-[10.5px]">
                                  {step.scopeTag}
                                </span>
                              )}
                              {step.detailText && (
                                <ChevronRight
                                  className={`h-3 w-3 text-muted-foreground/60 transition-transform duration-200 ease-out ${
                                    isStepOpen
                                      ? "rotate-90 text-primary"
                                      : "group-hover/step:translate-x-0.5"
                                  }`}
                                />
                              )}
                            </>
                          )}
                        </div>

                        <AnimatePresence initial={false}>
                          {isStepOpen && step.detailText && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.22, ease: SMOOTH_EASE }}
                              className="overflow-hidden"
                            >
                              <div className="mt-1 mb-1.5 ml-2 pl-2.5 border-l-2 border-primary/30 text-[10.5px] text-muted-foreground/85 leading-relaxed break-words">
                                {step.kind === "thought" && (
                                  <div className="font-semibold text-foreground/80 mb-0.5">
                                    {step.targetLabel}
                                  </div>
                                )}
                                {step.detailText}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </div>

                {/* Linha final de conclusão */}
                <div
                  className={`mt-2 flex items-center gap-1.5 ${subTextSize} text-muted-foreground/85`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary/85 shrink-0" />
                  <span className="font-medium text-foreground/80">{safeFinishedTitle}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ── MODO AO VIVO (Enquanto o Fagner está aguardando ou processando a resposta) ──
  return (
    <motion.div
      ref={rootRef}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.24, ease: SMOOTH_EASE }}
      className={`select-none py-1 min-w-0 max-w-full overflow-hidden ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isSimpleWorkingOnly ? (
          /* Estado 1: Tempo de espera inicial OU mensagem casual/simples -> apenas "Trabalhando" shimmer */
          <motion.div
            key="working-minimal"
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.2, ease: SMOOTH_EASE }}
            className="flex items-center py-0.5"
          >
            <WorkingShimmerLabel
              text="Trabalhando"
              className={compact ? "text-xs" : "text-[13px]"}
            />
          </motion.div>
        ) : (
          /* Estado 2: Pesquisa e coleta real de dados em andamento */
          <motion.div
            key="working-research-tree"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.26, ease: SMOOTH_EASE }}
          >
            <button
              type="button"
              onClick={() => setIsOpen((v) => !v)}
              className={`group flex items-center gap-1.5 ${textSize} font-medium text-foreground/85 hover:text-foreground transition-colors duration-200 cursor-pointer text-left max-w-full`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse shrink-0" />
              <span className="min-w-0 break-words">{safeTaskTitle}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-muted-foreground/80 shrink-0 transition-transform duration-300 ease-out ${
                  isOpen ? "rotate-0" : "-rotate-90"
                }`}
              />
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.28, ease: SMOOTH_EASE }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 ml-2 pl-4 border-l border-border/70 space-y-1.5 min-w-0 max-w-full">
                    <AnimatePresence initial={false}>
                      {visibleSteps.map((step, idx) => {
                        const isLatest = idx === visibleSteps.length - 1;
                        const autoExpanded =
                          elapsedMs >= idx * LIVE_STEP_CYCLE_MS + LIVE_STEP_EXPAND_OFFSET_MS;
                        const isStepOpen = isStepExpandedAt(step, idx);
                        const stepKey =
                          idx === 0 && step.kind === "thought" ? "step-thought-0" : step.id;
                        const thoughtSec = Math.max(1, Math.min(2, liveSeconds));
                        const liveVerb =
                          step.kind === "thought"
                            ? autoExpanded
                              ? step.actionVerb === "Pensou por 1s"
                                ? "Pensou por 2s"
                                : step.actionVerb
                              : `Pensando há ${thoughtSec}s`
                            : autoExpanded
                            ? step.actionVerb
                            : toActiveGerundVerb(step.actionVerb);
                        const liveScope = formatLiveScopeTag(step.scopeTag, autoExpanded);

                        return (
                          <motion.div
                            key={stepKey}
                            initial={{
                              height: 0,
                              opacity: 0,
                              y: 6,
                              filter: "blur(3px)",
                            }}
                            animate={{
                              height: "auto",
                              opacity: 1,
                              y: 0,
                              filter: "blur(0px)",
                            }}
                            transition={{
                              height: { duration: 0.38, ease: SMOOTH_EASE },
                              opacity: { duration: 0.42, ease: SMOOTH_EASE },
                              y: { duration: 0.42, ease: SMOOTH_EASE },
                              filter: { duration: 0.34, ease: "easeOut" },
                            }}
                            className="overflow-hidden flex flex-col min-w-0 max-w-full"
                          >
                            <div
                              onClick={(e) => step.detailText && toggleStepDetail(step, idx, e)}
                              className={`group/step flex items-center gap-1.5 flex-wrap py-0.5 ${textSize} ${
                                isLatest ? "text-foreground/95" : "text-muted-foreground"
                              } ${
                                step.detailText ? "hover:text-foreground cursor-pointer" : ""
                              } transition-colors duration-300`}
                            >
                              {step.kind === "thought" ? (
                                <>
                                  <span
                                    className={`transition-colors duration-300 ${
                                      !autoExpanded || isLatest
                                        ? "text-foreground/90 font-medium"
                                        : "text-muted-foreground/85"
                                    }`}
                                  >
                                    {liveVerb}
                                  </span>
                                  <ChevronRight
                                    className={`h-3 w-3 text-muted-foreground/65 transition-transform duration-300 ease-out ${
                                      isStepOpen
                                        ? "rotate-90 text-primary"
                                        : "group-hover/step:translate-x-0.5"
                                    }`}
                                  />
                                </>
                              ) : (
                                <>
                                  <span
                                    className={`transition-colors duration-300 ${
                                      !autoExpanded
                                        ? "text-foreground/90 font-medium"
                                        : "text-muted-foreground/85"
                                    }`}
                                  >
                                    {liveVerb}
                                  </span>
                                  <StepBadgeIcon
                                    type={step.badgeType}
                                    isActive={!autoExpanded || isLatest}
                                  />
                                  <span
                                    className={`font-semibold tracking-tight break-words transition-colors duration-300 ${
                                      isLatest ? "text-foreground" : "text-foreground/85"
                                    }`}
                                  >
                                    {step.targetLabel}
                                  </span>
                                  {liveScope && (
                                    <span className="text-muted-foreground/70 font-medium text-[11px]">
                                      {liveScope}
                                    </span>
                                  )}
                                  {step.detailText && (
                                    <ChevronRight
                                      className={`h-3 w-3 text-muted-foreground/60 transition-transform duration-300 ease-out ${
                                        isStepOpen
                                          ? "rotate-90 text-primary"
                                          : "group-hover/step:translate-x-0.5"
                                      }`}
                                    />
                                  )}
                                </>
                              )}
                            </div>

                            <AnimatePresence initial={false}>
                              {isStepOpen && step.detailText && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0, y: -2 }}
                                  animate={{ height: "auto", opacity: 1, y: 0 }}
                                  exit={{ height: 0, opacity: 0, y: -2 }}
                                  transition={{ duration: 0.36, ease: SMOOTH_EASE }}
                                  className="overflow-hidden"
                                >
                                  <div className="mt-1 mb-1 ml-2 pl-2.5 border-l-2 border-primary/30 text-[11px] text-muted-foreground/85 leading-relaxed break-words">
                                    {step.kind === "thought" && (
                                      <div className="font-semibold text-foreground/80 mb-0.5">
                                        {step.targetLabel}
                                      </div>
                                    )}
                                    {step.detailText}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>

                    {/* Indicador "Trabalhando" com shimmer fluido */}
                    <motion.div
                      layout="position"
                      transition={{ duration: 0.28, ease: SMOOTH_EASE }}
                      className={`flex items-center gap-2 ${textSize} pt-1`}
                    >
                      <WorkingShimmerLabel text="Trabalhando" />
                      <span className="text-[10.5px] font-medium text-muted-foreground/70 tabular-nums">
                        {liveSeconds}s
                      </span>
                    </motion.div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
