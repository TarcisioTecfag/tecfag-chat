// ══════════════════════════════════════════════════════════════════════════════
// 🧠 AGENTIC THOUGHT TRACE COMPONENT — Visualização Agêntica Estilo Antigravity
// Exibe em tempo real as etapas de pensamento e consultas do Fagner/Valentina
// e permanece recolhida ("Pensou por Xs • N ações ›") acima da resposta final.
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect } from "react";
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

function StepBadgeIcon({ type }: { type?: AgenticBadgeType }) {
  switch (type) {
    case "sql":
      return (
        <span className="inline-flex items-center justify-center rounded px-1 py-0.5 bg-sky-500/15 text-sky-400 border border-sky-500/25 text-[9px] font-mono font-extrabold leading-none shrink-0">
          SQL
        </span>
      );
    case "sla":
      return <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
    case "crm":
      return <Briefcase className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
    case "sdr":
      return <Bot className="h-3.5 w-3.5 text-cyan-400 shrink-0" />;
    case "chat":
      return <MessageSquare className="h-3.5 w-3.5 text-indigo-400 shrink-0" />;
    case "team":
      return <Users className="h-3.5 w-3.5 text-violet-400 shrink-0" />;
    case "file":
      return <FileText className="h-3.5 w-3.5 text-amber-300 shrink-0" />;
    case "kb":
      return <BookOpen className="h-3.5 w-3.5 text-teal-400 shrink-0" />;
    case "ai":
      return <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />;
    default:
      return <Database className="h-3.5 w-3.5 text-sky-400 shrink-0" />;
  }
}

interface AgenticThoughtTraceProps {
  trace: AgenticThoughtTraceData;
  /** "live" = executando agora (aberto por padrão com timer ao vivo); "completed" = finalizado acima da resposta (recolhido por padrão) */
  mode: "live" | "completed";
  /** Compacto para balões menores (ex: Mini Chat CRM) */
  compact?: boolean;
  className?: string;
}

export function AgenticThoughtTrace({
  trace,
  mode,
  compact = false,
  className = "",
}: AgenticThoughtTraceProps) {
  const [isOpen, setIsOpen] = useState<boolean>(mode === "live");
  const [expandedStepIds, setExpandedStepIds] = useState<Record<string, boolean>>({});
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  // Quando mudar de live para completed, recolhe suavemente
  useEffect(() => {
    setIsOpen(mode === "live");
  }, [mode]);

  // Cronômetro em tempo real apenas quando mode === "live"
  useEffect(() => {
    if (mode !== "live") return;
    const startedAt = Date.now();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 150);
    return () => clearInterval(interval);
  }, [mode, trace.taskTitle]);

  const toggleStepDetail = (stepId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedStepIds((prev) => ({
      ...prev,
      [stepId]: !prev[stepId],
    }));
  };

  // Filtra etapas visíveis de acordo com o progresso ao vivo
  const visibleSteps: AgenticThoughtStep[] =
    mode === "live"
      ? trace.steps.filter((s, idx) => idx === 0 || elapsedMs >= (s.revealAfterMs ?? idx * 650))
      : trace.steps;

  const actionStepsCount = trace.steps.filter((s) => s.kind !== "thought").length;
  const liveSeconds = Math.max(1, Math.floor(elapsedMs / 1000));
  const displayDurationSec =
    mode === "live" ? liveSeconds : Math.max(1, trace.totalDurationSeconds || 3);

  const textSize = compact ? "text-[11px]" : "text-xs";
  const subTextSize = compact ? "text-[10px]" : "text-[11px]";

  // ── MODO CONCLUÍDO (Acima da mensagem da IA — recolhido por padrão) ────────
  if (mode === "completed") {
    return (
      <div
        className={`select-none mb-2 ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho resumo clicável (Estilo Antigravity: "Pensou por Xs • N ações ›") */}
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className={`group inline-flex items-center gap-1.5 rounded-lg px-2 py-1 -ml-1 ${subTextSize} font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer`}
        >
          <Sparkles className="h-3 w-3 text-primary/80 shrink-0 group-hover:text-primary transition-colors" />
          <span>
            Pensou por <strong className="font-semibold text-foreground/85">{displayDurationSec}s</strong>
          </span>
          <span className="text-muted-foreground/50">•</span>
          <span>
            {actionStepsCount} {actionStepsCount === 1 ? "ação executada" : "ações executadas"}
          </span>
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/80 transition-transform" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/80 transition-transform group-hover:translate-x-0.5" />
          )}
        </button>

        {/* Árvore expandida sob demanda */}
        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div className="pt-1.5 pb-2 pl-1">
                <div className={`${subTextSize} font-medium text-muted-foreground/90 mb-1.5 flex items-center gap-1.5`}>
                  <span>{trace.taskTitle}</span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground/70" />
                </div>

                {/* Linhas indentadas estilo Antigravity */}
                <div className="ml-2 pl-3.5 border-l border-border/60 space-y-1.5">
                  {trace.steps.map((step) => {
                    const isStepOpen = !!expandedStepIds[step.id];
                    return (
                      <div key={step.id} className="flex flex-col">
                        <div
                          onClick={(e) => step.detailText && toggleStepDetail(step.id, e)}
                          className={`flex items-center gap-1.5 flex-wrap ${subTextSize} text-muted-foreground ${
                            step.detailText ? "hover:text-foreground cursor-pointer" : ""
                          } transition-colors py-0.5`}
                        >
                          {step.kind === "thought" ? (
                            <>
                              <span className="text-muted-foreground/90">{step.actionVerb}</span>
                              <ChevronRight
                                className={`h-3 w-3 text-muted-foreground/70 transition-transform ${
                                  isStepOpen ? "rotate-90" : ""
                                }`}
                              />
                            </>
                          ) : (
                            <>
                              <span className="text-muted-foreground/85">{step.actionVerb}</span>
                              <StepBadgeIcon type={step.badgeType} />
                              <span className="font-semibold text-foreground/85 font-mono text-[11px]">
                                {step.targetLabel}
                              </span>
                              {step.scopeTag && (
                                <span className="text-muted-foreground/70 font-mono text-[10.5px]">
                                  {step.scopeTag}
                                </span>
                              )}
                              {step.detailText && (
                                <ChevronRight
                                  className={`h-3 w-3 text-muted-foreground/60 transition-transform ${
                                    isStepOpen ? "rotate-90" : ""
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
                              transition={{ duration: 0.14 }}
                              className="overflow-hidden"
                            >
                              <div className="mt-1 mb-1.5 ml-2 pl-2.5 border-l border-primary/30 text-[10.5px] text-muted-foreground/85 leading-relaxed">
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
                      </div>
                    );
                  })}
                </div>

                {/* Linha final de conclusão (Estilo "Search ... finished ›") */}
                <div className={`mt-1.5 flex items-center gap-1.5 ${subTextSize} text-muted-foreground/85`}>
                  <CheckCircle2 className="h-3 w-3 text-emerald-500/80 shrink-0" />
                  <span>{trace.finishedTitle}</span>
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
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2 }}
      className={`select-none py-1.5 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Cabeçalho da tarefa atual (Estilo "Viewing ChatPanel component ⌄") */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className={`flex items-center gap-1.5 ${textSize} font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer text-left`}
      >
        <span>{trace.taskTitle}</span>
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/80 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/80 shrink-0" />
        )}
      </button>

      {/* Árvore indentada de ações acontecendo em tempo real */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-2 ml-2 pl-4 border-l border-border/60 space-y-2">
              {visibleSteps.map((step, idx) => {
                const isLatest = idx === visibleSteps.length - 1;
                const isStepOpen = !!expandedStepIds[step.id];

                return (
                  <motion.div
                    key={step.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex flex-col"
                  >
                    <div
                      onClick={(e) => step.detailText && toggleStepDetail(step.id, e)}
                      className={`flex items-center gap-1.5 flex-wrap ${textSize} text-muted-foreground ${
                        step.detailText ? "hover:text-foreground cursor-pointer" : ""
                      } transition-colors`}
                    >
                      {step.kind === "thought" ? (
                        <>
                          <span className="text-muted-foreground/90">
                            {isLatest
                              ? `Pensando há ${liveSeconds}s`
                              : step.actionVerb}
                          </span>
                          <ChevronRight
                            className={`h-3 w-3 text-muted-foreground/70 transition-transform ${
                              isStepOpen ? "rotate-90" : ""
                            }`}
                          />
                        </>
                      ) : (
                        <>
                          <span className="text-muted-foreground/90">{step.actionVerb}</span>
                          <StepBadgeIcon type={step.badgeType} />
                          <span className="font-semibold text-foreground/90 font-mono text-[11.5px]">
                            {step.targetLabel}
                          </span>
                          {step.scopeTag && (
                            <span className="text-muted-foreground/75 font-mono text-[11px]">
                              {step.scopeTag}
                            </span>
                          )}
                          {step.detailText && (
                            <ChevronRight
                              className={`h-3 w-3 text-muted-foreground/60 transition-transform ${
                                isStepOpen ? "rotate-90" : ""
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
                          transition={{ duration: 0.14 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-1 mb-1 ml-2 pl-2.5 border-l border-primary/30 text-[11px] text-muted-foreground/85 leading-relaxed">
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

              {/* Indicador "Working / Trabalhando" igual ao Antigravity */}
              <div className={`flex items-center gap-2 ${textSize} pt-0.5`}>
                <motion.span
                  animate={{ opacity: [0.45, 1, 0.45] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                  className="font-semibold text-foreground/80 tracking-wide"
                >
                  Trabalhando
                </motion.span>
                <span className="text-[10.5px] font-mono text-muted-foreground/65 tabular-nums">
                  {liveSeconds}s
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
