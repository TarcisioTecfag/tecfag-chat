// ══════════════════════════════════════════════════════════════════════════════
// ✨ SDR SKELETONS — Estados de carregamento harmoniosos com shimmer GPU-only
// ══════════════════════════════════════════════════════════════════════════════

import React from "react";
import { KANBAN_COLUMNS } from "./sdr-kanban-data";

const KANBAN_SKELETON_CARD_COUNTS = [3, 2, 1, 2, 3, 1, 3, 2, 2];

export const SdrKanbanSkeleton = React.memo(function SdrKanbanSkeleton() {
  return (
    <div
      className="relative flex flex-col flex-1 h-full min-h-0 shrink-0 sdr-enter select-none"
      role="status"
      aria-label="Carregando quadro Kanban SDR"
    >
      <div className="w-full flex-1 min-h-0 flex flex-col overflow-x-auto overflow-y-hidden pb-2 pt-0.5">
        <div className="flex items-stretch gap-2.5 sm:gap-3 min-w-max flex-1 min-h-0 h-full">
          {KANBAN_COLUMNS.map((column, colIdx) => {
            const ColumnIcon = column.icon;
            const cardCount = KANBAN_SKELETON_CARD_COUNTS[colIdx] ?? 2;

            return (
              <div
                key={column.key}
                className="w-[82vw] max-w-[290px] sm:w-[260px] shrink-0 h-full min-h-0 flex flex-col bg-muted/15 dark:bg-zinc-900/30 rounded-2xl border border-border/80 overflow-hidden shadow-xs"
              >
                {/* Cabeçalho fiel da coluna */}
                <div
                  className={`flex items-center justify-between px-3 py-2.5 border-b border-border/80 shrink-0 ${column.headerBg}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ColumnIcon
                      className="h-3.5 w-3.5 shrink-0 opacity-75"
                      style={{ color: column.accentColor }}
                    />
                    <span className="text-[11px] font-extrabold uppercase tracking-wide truncate text-foreground/80">
                      {column.label}
                    </span>
                  </div>
                  <div className="sdr-skeleton h-4 w-7 rounded-full shrink-0" />
                </div>

                {/* Cards skeleton com a mesma anatomia real do SdrKanbanCard */}
                <div className="p-2.5 flex flex-col gap-2 flex-1 min-h-0 overflow-hidden">
                  {Array.from({ length: cardCount }).map((_, cardIdx) => (
                    <div
                      key={cardIdx}
                      style={{ animationDelay: `${Math.min((colIdx * 2 + cardIdx) * 35, 280)}ms` }}
                      className="sdr-card-enter p-2.5 rounded-xl border border-border/75 bg-card shadow-xs space-y-2.5"
                    >
                      {/* Avatar + Nome/Empresa + Unread */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0 flex-1">
                          <div className="sdr-skeleton h-7 w-7 rounded-full shrink-0" />
                          <div className="space-y-1.5 flex-1 min-w-0 pt-0.5">
                            <div className="sdr-skeleton h-2.5 w-3/4 rounded-md" />
                            <div className="sdr-skeleton h-2 w-1/2 rounded-md" />
                          </div>
                        </div>
                        <div className="sdr-skeleton h-4 w-5 rounded-full shrink-0" />
                      </div>

                      {/* Progresso Campos X/Y */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="sdr-skeleton h-2 w-14 rounded-md" />
                          <div className="sdr-skeleton h-2 w-7 rounded-md" />
                        </div>
                        <div className="sdr-skeleton h-1 w-full rounded-full" />
                      </div>

                      {/* Pill de Status + Tempo */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="sdr-skeleton h-4 w-24 rounded-md" />
                        <div className="sdr-skeleton h-2 w-10 rounded-md" />
                      </div>

                      {/* Rodapé Bot */}
                      <div className="pt-1.5 border-t border-border/50 flex items-center justify-between">
                        <div className="sdr-skeleton h-2 w-20 rounded-md" />
                        <div className="sdr-skeleton h-2 w-12 rounded-md" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

export const SdrLiveListSkeleton = React.memo(function SdrLiveListSkeleton() {
  return (
    <div
      className="divide-y divide-line sdr-enter select-none"
      role="status"
      aria-label="Carregando lista de triagens ao vivo"
    >
      {Array.from({ length: 6 }).map((_, idx) => (
        <div
          key={idx}
          style={{ animationDelay: `${idx * 40}ms` }}
          className="sdr-card-enter px-4 py-3 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="sdr-skeleton h-3 w-32 rounded-md" />
            <div className="sdr-skeleton h-4 w-20 rounded-lg shrink-0" />
          </div>
          <div className="sdr-skeleton h-2.5 w-44 rounded-md" />
          <div className="space-y-1.5 pt-0.5">
            <div className="flex items-center justify-between">
              <div className="sdr-skeleton h-2 w-16 rounded-md" />
              <div className="sdr-skeleton h-2 w-7 rounded-md" />
            </div>
            <div className="sdr-skeleton h-1 w-full rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
});

const CHAT_BUBBLE_SHAPES: Array<{ outbound: boolean; widthClass: string; lines: number }> = [
  { outbound: false, widthClass: "w-[58%]", lines: 2 },
  { outbound: true, widthClass: "w-[68%]", lines: 3 },
  { outbound: false, widthClass: "w-[46%]", lines: 1 },
  { outbound: true, widthClass: "w-[62%]", lines: 2 },
  { outbound: false, widthClass: "w-[52%]", lines: 2 },
  { outbound: true, widthClass: "w-[55%]", lines: 2 },
];

export const SdrChatMessagesSkeleton = React.memo(function SdrChatMessagesSkeleton() {
  return (
    <div
      className="flex flex-col gap-3 py-2 sdr-enter select-none"
      role="status"
      aria-label="Carregando histórico da conversa"
    >
      {/* Separador de data */}
      <div className="flex items-center gap-3 my-1">
        <div className="h-px flex-1 bg-border/60" />
        <div className="sdr-skeleton h-4 w-24 rounded-full" />
        <div className="h-px flex-1 bg-border/60" />
      </div>

      {/* Bolhas alternadas cliente / IA */}
      {CHAT_BUBBLE_SHAPES.map((shape, idx) => (
        <div
          key={idx}
          style={{ animationDelay: `${idx * 45}ms` }}
          className={`sdr-card-enter flex items-end gap-2 ${
            shape.outbound ? "justify-end" : "justify-start"
          }`}
        >
          {!shape.outbound && <div className="sdr-skeleton h-7 w-7 rounded-full shrink-0" />}

          <div
            className={`${shape.widthClass} max-w-[75%] rounded-2xl px-3 py-2.5 border space-y-1.5 ${
              shape.outbound
                ? "bg-primary/10 border-primary/20 rounded-br-[5px]"
                : "bg-muted/60 border-border/80 rounded-bl-[5px]"
            }`}
          >
            {shape.outbound && <div className="sdr-skeleton h-2 w-16 rounded-md opacity-80" />}
            <div className="sdr-skeleton h-2.5 w-full rounded-md" />
            {shape.lines >= 2 && <div className="sdr-skeleton h-2.5 w-4/5 rounded-md" />}
            {shape.lines >= 3 && <div className="sdr-skeleton h-2.5 w-3/5 rounded-md" />}
            <div className="sdr-skeleton h-2 w-9 rounded-md mt-1 opacity-70" />
          </div>

          {shape.outbound && <div className="sdr-skeleton h-7 w-7 rounded-full shrink-0" />}
        </div>
      ))}
    </div>
  );
});

export const SdrRightPanelSkeleton = React.memo(function SdrRightPanelSkeleton() {
  return (
    <div
      className="flex flex-col h-full sdr-enter select-none"
      role="status"
      aria-label="Carregando dados coletados da triagem"
    >
      <div className="px-4 py-3 border-b border-line shrink-0 flex items-center justify-between gap-2">
        <div className="space-y-1.5">
          <div className="sdr-skeleton h-3 w-28 rounded-md" />
          <div className="sdr-skeleton h-2 w-24 rounded-md" />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="sdr-skeleton h-6 w-16 rounded-lg" />
          <div className="sdr-skeleton h-6 w-14 rounded-lg" />
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-3 sm:px-4 py-3 space-y-2.5">
        {Array.from({ length: 5 }).map((_, idx) => (
          <div
            key={idx}
            style={{ animationDelay: `${idx * 45}ms` }}
            className="sdr-card-enter rounded-xl border border-border/80 bg-muted/25 p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="sdr-skeleton h-2 w-24 rounded-md" />
              <div className="sdr-skeleton h-3 w-3 rounded-full" />
            </div>
            <div className="sdr-skeleton h-3 w-3/4 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
});

export const SdrApprovalOptionsSkeleton = React.memo(function SdrApprovalOptionsSkeleton() {
  return (
    <div
      className="space-y-2.5 py-1 sdr-enter select-none"
      role="status"
      aria-label="Carregando setores, operadores e funis"
    >
      {Array.from({ length: 4 }).map((_, idx) => (
        <div key={idx} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="sdr-skeleton h-2 w-24 rounded-md" />
            <div className="sdr-skeleton h-2 w-16 rounded-md" />
          </div>
          <div className="sdr-skeleton h-9 sm:h-8.5 w-full rounded-xl" />
        </div>
      ))}
      <div className="pt-1 flex gap-2">
        <div className="sdr-skeleton h-9 flex-1 rounded-xl" />
        <div className="sdr-skeleton h-9 w-20 rounded-xl" />
      </div>
    </div>
  );
});
