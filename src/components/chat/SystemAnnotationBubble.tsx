import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CircleHelp, X } from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { formatSystemAnnotation } from "@/lib/triage/format-system-annotation";

interface SystemAnnotationBubbleProps {
  text: string;
  time: string;
  gap?: string;
  renderText?: (text: string) => React.ReactNode;
}

export function SystemAnnotationBubble({
  text,
  time,
  gap = "",
  renderText,
}: SystemAnnotationBubbleProps) {
  const [expanded, setExpanded] = useState(false);

  const formatted = useMemo(() => formatSystemAnnotation(text), [text]);

  return (
    <div className={`flex justify-center ${gap} my-1 w-full select-none`}>
      <AnimatePresence mode="wait" initial={false}>
        {!expanded ? (
          <motion.div
            key="collapsed"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.14 }}
          >
            <SystemTooltip
              content={`${formatted.tooltipSummary}${time ? ` — ${time}` : ""} (clique para ver)`}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(true);
                }}
                aria-label={`Expandir anotação: ${formatted.badgeTitle}`}
                className="group/sys inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted/65 hover:bg-muted border border-border/60 hover:border-border text-muted-foreground/65 hover:text-foreground transition-all duration-150 cursor-pointer shadow-2xs"
              >
                <CircleHelp className="h-3.5 w-3.5 transition-transform duration-150 group-hover/sys:scale-110" />
              </button>
            </SystemTooltip>
          </motion.div>
        ) : formatted.isSingleLine ? (
          <motion.button
            key="expanded-single"
            type="button"
            initial={{ opacity: 0, scale: 0.96, y: -2 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -2 }}
            transition={{ duration: 0.16 }}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(false);
            }}
            title="Clique para ocultar"
            className="inline-flex items-center gap-2 rounded-full bg-muted hover:bg-muted/85 px-3.5 py-1 text-[10px] font-semibold text-muted-foreground uppercase border border-border shadow-2xs transition cursor-pointer max-w-[90%]"
          >
            <CircleHelp className="h-3 w-3 text-muted-foreground/80 shrink-0" />
            <span className="truncate">
              {renderText
                ? renderText(formatted.singleLineText || text)
                : formatted.singleLineText || text}
              {time ? ` — ${time}` : ""}
            </span>
            <X className="h-3 w-3 text-muted-foreground/70 hover:text-foreground shrink-0" />
          </motion.button>
        ) : (
          <motion.div
            key="expanded-card"
            initial={{ opacity: 0, scale: 0.97, y: -3 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -3 }}
            transition={{ duration: 0.16 }}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(false);
            }}
            title="Clique para ocultar o relatório"
            className="w-full max-w-lg rounded-2xl bg-muted border border-border px-4 py-2.5 text-left shadow-2xs cursor-pointer transition hover:border-border/90 select-text"
          >
            {/* Cabeçalho objetivo da ação */}
            <div className="flex items-center justify-between gap-3 pb-1.5 mb-2 border-b border-border/70">
              <div className="flex items-center gap-1.5 min-w-0">
                <CircleHelp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-foreground/90 truncate">
                  {formatted.badgeTitle}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {time && (
                  <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">
                    {time}
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

            {/* Dados objetivos da ação (sem redundância) */}
            {formatted.items.length > 0 && (
              <div
                className={`grid gap-x-4 gap-y-1 text-[11px] leading-snug ${
                  formatted.items.length === 1 ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"
                }`}
              >
                {formatted.items.map((item, idx) => (
                  <div
                    key={`${item.label}-${idx}`}
                    className={`flex items-baseline gap-1.5 min-w-0 ${
                      item.fullWidth && formatted.items.length > 1 ? "sm:col-span-2" : ""
                    }`}
                  >
                    <span className="text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground shrink-0">
                      {item.label}:
                    </span>
                    <span className="text-[11px] font-semibold text-foreground/95 break-words min-w-0">
                      {renderText ? renderText(item.value) : item.value}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Avisos complementares (apenas quando existentes) */}
            {formatted.alerts.length > 0 && (
              <div className="mt-2 pt-1.5 border-t border-border/60 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold text-muted-foreground">
                {formatted.alerts.map((alert, idx) => (
                  <span key={idx}>{alert}</span>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
