// ══════════════════════════════════════════════════════════════════════════════
// 🧠 AGENTIC THOUGHT TRACE COMPONENT — Visualização Agêntica Estilo Antigravity
// Exibe em tempo real as etapas de pensamento e consultas do Fagner/Valentina
// e permanece recolhida ("Pensou por Xs • N ações ›") acima da resposta final.
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

  // Quando mudar de live para completed, recolhe suavemente
  useEffect(() => {
    setIsOpen(mode === "live");
  }, [mode]);

  // Cronômetro em tempo real apenas quando mode === "live"
  useEffect(() => {
    if (mode !== "live") return;
    setElapsedMs(0);
    const startedAt = Date.now();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 120);
    return () => clearInterval(interval);
  }, [mode]);

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

  const toggleStepDetail = (stepId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedStepIds((prev) => ({
      ...prev,
      [stepId]: !prev[stepId],
    }));
  };

  // Filtra etapas visíveis: se vier em tempo real via SSE do servidor (isRealTimeStream), exibe imediatamente cada etapa real conforme o backend conclui; caso contrário, usa fallback progressivo
  const visibleSteps: AgenticThoughtStep[] =
    mode === "live"
      ? trace.isRealTimeStream
        ? trace.steps
        : trace.steps.filter((s, idx) => idx === 0 || elapsedMs >= (s.revealAfterMs ?? idx * 700))
      : trace.steps;

  // Auto-scroll progressivo sempre que uma nova linha aparece ou atualiza no modo "live"
  const stepsSignature = visibleSteps.map((s) => `${s.id}:${s.scopeTag || ""}`).join("|");
  useEffect(() => {
    if (mode !== "live" || !isOpen) return;
    const cleanup = triggerFollowScroll();
    return cleanup;
  }, [mode, isOpen, visibleSteps.length, stepsSignature, triggerFollowScroll]);

  const actionStepsCount = trace.steps.filter((s) => s.kind !== "thought").length;
  const liveSeconds = Math.max(1, Math.floor(elapsedMs / 1000));
  const displayDurationSec =
    mode === "live" ? liveSeconds : Math.max(1, trace.totalDurationSeconds || 3);

  const textSize = compact ? "text-[11px]" : "text-xs";
  const subTextSize = compact ? "text-[10.5px]" : "text-[11.5px]";

  // ── MODO CONCLUÍDO (Acima da mensagem da IA — recolhido por padrão) ────────
  if (mode === "completed") {
    return (
      <div
        ref={rootRef}
        className={`select-none mb-2 ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho resumo clicável (Estilo Antigravity: "Pensou por Xs • N ações ›") */}
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className={`group inline-flex items-center gap-1.5 rounded-lg px-2 py-1 -ml-1 ${subTextSize} font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200 cursor-pointer`}
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
              <div className="pt-1.5 pb-2 pl-1">
                <div
                  className={`${subTextSize} font-medium text-foreground/80 mb-1.5 flex items-center gap-1.5`}
                >
                  <span>{trace.taskTitle}</span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground/70" />
                </div>

                {/* Linhas indentadas estilo Antigravity */}
                <div className="ml-2 pl-3.5 border-l border-border/70 space-y-1.5">
                  {trace.steps.map((step, idx) => {
                    const isStepOpen = !!expandedStepIds[step.id];
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
                        className="flex flex-col"
                      >
                        <div
                          onClick={(e) => step.detailText && toggleStepDetail(step.id, e)}
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
                              <span className="font-semibold text-foreground/85 tracking-tight">
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
                              <div className="mt-1 mb-1.5 ml-2 pl-2.5 border-l-2 border-primary/30 text-[10.5px] text-muted-foreground/85 leading-relaxed">
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

                {/* Linha final de conclusão (Estilo "Search ... finished ›") */}
                <div
                  className={`mt-2 flex items-center gap-1.5 ${subTextSize} text-muted-foreground/85`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary/85 shrink-0" />
                  <span className="font-medium text-foreground/80">{trace.finishedTitle}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ── MODO AO VIVO (Enquanto o Fagner está processando a resposta) ───────────
  return (
    <motion.div
      ref={rootRef}
      initial={{ opacity: 0, y: 8, filter: "blur(2px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -4, filter: "blur(2px)" }}
      transition={{ duration: 0.3, ease: SMOOTH_EASE }}
      className={`select-none py-1.5 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Cabeçalho da tarefa atual (Estilo "Viewing ChatPanel component ⌄") */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className={`group flex items-center gap-1.5 ${textSize} font-medium text-foreground/85 hover:text-foreground transition-colors duration-200 cursor-pointer text-left`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse shrink-0" />
        <span>{trace.taskTitle}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground/80 shrink-0 transition-transform duration-300 ease-out ${
            isOpen ? "rotate-0" : "-rotate-90"
          }`}
        />
      </button>

      {/* Árvore indentada de ações acontecendo em tempo real */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: SMOOTH_EASE }}
            className="overflow-hidden"
          >
            <div className="mt-2 ml-2 pl-4 border-l border-border/70 space-y-1">
              <AnimatePresence initial={false}>
                {visibleSteps.map((step, idx) => {
                  const isLatest = idx === visibleSteps.length - 1;
                  const isStepOpen = !!expandedStepIds[step.id];

                  return (
                    <motion.div
                      key={step.id}
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
                        height: { duration: 0.32, ease: SMOOTH_EASE },
                        opacity: { duration: 0.36, ease: SMOOTH_EASE },
                        y: { duration: 0.36, ease: SMOOTH_EASE },
                        filter: { duration: 0.3, ease: "easeOut" },
                      }}
                      className="overflow-hidden flex flex-col"
                    >
                      <div
                        onClick={(e) => step.detailText && toggleStepDetail(step.id, e)}
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
                                isLatest
                                  ? "text-foreground/90 font-medium"
                                  : "text-muted-foreground/85"
                              }`}
                            >
                              {isLatest ? `Pensando há ${liveSeconds}s` : step.actionVerb}
                            </span>
                            <ChevronRight
                              className={`h-3 w-3 text-muted-foreground/65 transition-transform duration-200 ease-out ${
                                isStepOpen
                                  ? "rotate-90 text-primary"
                                  : "group-hover/step:translate-x-0.5"
                              }`}
                            />
                          </>
                        ) : (
                          <>
                            <span className="text-muted-foreground/85">{step.actionVerb}</span>
                            <StepBadgeIcon type={step.badgeType} isActive={isLatest} />
                            <span
                              className={`font-semibold tracking-tight transition-colors duration-300 ${
                                isLatest ? "text-foreground" : "text-foreground/85"
                              }`}
                            >
                              {step.targetLabel}
                            </span>
                            {step.scopeTag && (
                              <span className="text-muted-foreground/70 font-medium text-[11px]">
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
                            <div className="mt-1 mb-1 ml-2 pl-2.5 border-l-2 border-primary/30 text-[11px] text-muted-foreground/85 leading-relaxed">
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

              {/* Indicador "Trabalhando" com shimmer fluido na paleta do sistema */}
              <motion.div
                layout="position"
                transition={{ duration: 0.28, ease: SMOOTH_EASE }}
                className={`flex items-center gap-2 ${textSize} pt-1`}
              >
                <motion.span
                  animate={{
                    backgroundPosition: ["200% 0%", "-200% 0%"],
                  }}
                  transition={{
                    duration: 2.6,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                  style={{
                    backgroundImage:
                      "linear-gradient(90deg, var(--muted-foreground) 0%, var(--foreground) 35%, var(--primary) 50%, var(--foreground) 65%, var(--muted-foreground) 100%)",
                    backgroundSize: "200% 100%",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                  }}
                  className="font-semibold tracking-wide"
                >
                  Trabalhando
                </motion.span>
                <span className="text-[10.5px] font-medium text-muted-foreground/70 tabular-nums">
                  {liveSeconds}s
                </span>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

