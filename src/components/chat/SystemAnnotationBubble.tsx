import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CircleHelp, X } from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { formatSystemAnnotation } from "@/lib/triage/format-system-annotation";
import { SiteChannelIcon } from "./ChannelOriginIndicators";

export interface SystemAnnotationItem {
  id?: string;
  text: string;
  time: string;
}

interface SystemAnnotationBubbleProps {
  text: string;
  time: string;
  items?: SystemAnnotationItem[];
  gap?: string;
  renderText?: (text: string) => React.ReactNode;
}

export function SystemAnnotationBubble({
  text,
  time,
  items,
  gap = "",
  renderText,
}: SystemAnnotationBubbleProps) {
  const [expanded, setExpanded] = useState(false);

  const resolvedItems = useMemo(() => {
    const base = items && items.length > 0 ? items : [{ text, time }];
    return base.map((item, idx) => ({
      id: item.id || `sys-${idx}`,
      text: item.text,
      time: item.time,
      formatted: formatSystemAnnotation(item.text),
    }));
  }, [items, text, time]);

  const count = resolvedItems.length;
  const first = resolvedItems[0];
  const hasSiteHandoff = resolvedItems.some((it) => it.formatted.variant === "site_handoff");

  const collapsedTooltip = useMemo(() => {
    if (count === 1) {
      return `${first.formatted.tooltipSummary}${first.time ? ` — ${first.time}` : ""} (clique para ver)`;
    }
    const summaries = resolvedItems
      .map((it) => `${it.formatted.badgeTitle}${it.time ? ` (${it.time})` : ""}`)
      .join(" · ");
    return `${count} informações em sequência: ${summaries} (clique para abrir todas)`;
  }, [count, first, resolvedItems]);

  return (
    <div data-tour="message.system-details" className={`flex justify-center ${gap} my-1 w-full select-none`}>
      <AnimatePresence mode="wait" initial={false}>
        {!expanded ? (
          <motion.div
            key="collapsed"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.14 }}
          >
            <SystemTooltip content={collapsedTooltip}>
              {hasSiteHandoff ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(true);
                  }}
                  aria-label={`Expandir resumo da triagem do site`}
                  className="group/sys inline-flex h-6 items-center justify-center gap-1.5 rounded-full bg-sky-500/12 hover:bg-sky-500/20 border border-sky-500/35 hover:border-sky-500/55 px-2.5 text-sky-700 dark:text-sky-300 transition-all duration-150 cursor-pointer shadow-2xs"
                >
                  <SiteChannelIcon className="h-3 w-3 shrink-0 transition-transform duration-150 group-hover/sys:scale-110" />
                  <span className="text-[10px] font-extrabold uppercase tracking-wider leading-none">
                    Resumo da Triagem (Site)
                  </span>
                  {count > 1 && (
                    <span className="text-[9.5px] font-extrabold tabular-nums leading-none opacity-80">
                      +{count - 1}
                    </span>
                  )}
                </button>
              ) : count === 1 ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(true);
                  }}
                  aria-label={`Expandir anotação: ${first.formatted.badgeTitle}`}
                  className="group/sys inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted/65 hover:bg-muted border border-border/60 hover:border-border text-muted-foreground/65 hover:text-foreground transition-all duration-150 cursor-pointer shadow-2xs"
                >
                  <CircleHelp className="h-3.5 w-3.5 transition-transform duration-150 group-hover/sys:scale-110" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(true);
                  }}
                  aria-label={`Expandir ${count} anotações do sistema`}
                  className="group/sys inline-flex h-5 items-center justify-center gap-1 rounded-full bg-muted/65 hover:bg-muted border border-border/60 hover:border-border px-2 text-muted-foreground/75 hover:text-foreground transition-all duration-150 cursor-pointer shadow-2xs"
                >
                  <CircleHelp className="h-3.5 w-3.5 transition-transform duration-150 group-hover/sys:scale-110 shrink-0" />
                  <span className="text-[10px] font-extrabold tabular-nums leading-none">
                    {count}
                  </span>
                </button>
              )}
            </SystemTooltip>
          </motion.div>
        ) : (
          <motion.div
            key="expanded-group"
            initial={{ opacity: 0, scale: 0.97, y: -3 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -3 }}
            transition={{ duration: 0.16 }}
            className="flex flex-col items-center gap-1.5 w-full"
          >
            {resolvedItems.map((entry) => {
              const { formatted: fmt, text: itemText, time: itemTime, id: itemId } = entry;
              const isSiteHandoffItem = fmt.variant === "site_handoff";

              if (fmt.isSingleLine) {
                return (
                  <button
                    key={itemId}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpanded(false);
                    }}
                    aria-label="Clique para ocultar"
                    className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1 text-[10px] font-semibold uppercase border shadow-2xs transition cursor-pointer max-w-[92%] ${
                      isSiteHandoffItem
                        ? "bg-sky-500/12 hover:bg-sky-500/20 text-sky-700 dark:text-sky-300 border-sky-500/35"
                        : "bg-muted hover:bg-muted/85 text-muted-foreground border-border"
                    }`}
                  >
                    {isSiteHandoffItem ? (
                      <SiteChannelIcon className="h-3 w-3 shrink-0" />
                    ) : (
                      <CircleHelp className="h-3 w-3 text-muted-foreground/80 shrink-0" />
                    )}
                    <span className="truncate">
                      {renderText
                        ? renderText(fmt.singleLineText || itemText)
                        : fmt.singleLineText || itemText}
                      {itemTime ? ` — ${itemTime}` : ""}
                    </span>
                    <X className="h-3 w-3 opacity-70 hover:opacity-100 shrink-0" />
                  </button>
                );
              }

              return (
                <div
                  key={itemId}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(false);
                  }}
                  className={`w-full max-w-xl rounded-2xl border px-4 py-3 text-left shadow-2xs cursor-pointer transition select-text ${
                    isSiteHandoffItem
                      ? "bg-muted/95 border-sky-500/35 hover:border-sky-500/55"
                      : "bg-muted border-border hover:border-border/90"
                  }`}
                >
                  {/* Cabeçalho objetivo da ação */}
                  <div className="flex items-center justify-between gap-3 pb-2 mb-2.5 border-b border-border/70">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isSiteHandoffItem ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30 shrink-0">
                          <SiteChannelIcon className="h-3 w-3" />
                        </span>
                      ) : (
                        <CircleHelp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-foreground/95 truncate">
                        {fmt.badgeTitle}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {itemTime && (
                        <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">
                          {itemTime}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpanded(false);
                        }}
                        aria-label="Ocultar relatório"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-background/60 text-muted-foreground hover:text-foreground transition cursor-pointer"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  {/* Dados objetivos da ação em layout empilhado (sem espremer nem quebrar palavras) */}
                  {fmt.items.length > 0 && (
                    <div
                      className={`grid gap-2 text-[11px] leading-snug ${
                        fmt.items.length === 1 ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"
                      }`}
                    >
                      {fmt.items.map((item, idx) => (
                        <div
                          key={`${item.label}-${idx}`}
                          className={`flex flex-col gap-0.5 min-w-0 rounded-xl bg-background/50 border border-border/50 px-2.5 py-1.5 ${
                            item.fullWidth && fmt.items.length > 1 ? "sm:col-span-2" : ""
                          }`}
                        >
                          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground leading-tight">
                            {item.label}
                          </span>
                          {item.isCode ? (
                            <span className="inline-flex w-fit max-w-full items-center rounded-md bg-muted/90 border border-border/70 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-foreground/95 break-words">
                              {item.value}
                            </span>
                          ) : (
                            <span className="text-[11.5px] font-semibold text-foreground/95 leading-snug break-words min-w-0">
                              {renderText ? renderText(item.value) : item.value}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Avisos complementares (apenas quando existentes) */}
                  {fmt.alerts.length > 0 && (
                    <div className="mt-2.5 pt-2 border-t border-border/60 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold text-muted-foreground">
                      {fmt.alerts.map((alert, idx) => (
                        <span key={idx}>{alert}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

