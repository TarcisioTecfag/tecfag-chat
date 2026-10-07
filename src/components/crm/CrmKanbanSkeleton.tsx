import React from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function CrmKanbanSkeleton() {
  return (
    <div className="flex h-full w-full gap-3 overflow-x-hidden pr-5 pb-3 animate-in fade-in duration-150 select-none">
      {[1, 2, 3, 4, 5].map((colIndex) => (
        <div
          key={colIndex}
          className="flex h-full w-[290px] shrink-0 flex-col rounded-2xl border border-border/70 bg-muted/20 p-3"
        >
          {/* Cabeçalho da Coluna */}
          <div className="mb-3 flex items-center justify-between pb-2 border-b border-border/60">
            <div className="space-y-1">
              <Skeleton className="h-4 w-28 rounded-md" />
              <Skeleton className="h-2.5 w-16 rounded" />
            </div>
            <Skeleton className="h-5 w-6 rounded-full" />
          </div>

          {/* Cards da Coluna */}
          <div className="flex-1 space-y-2.5 overflow-hidden">
            {[1, 2, 3].map((cardIndex) => (
              <div
                key={cardIndex}
                className="rounded-xl border border-border bg-card p-3.5 space-y-2.5 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3.5 w-16 rounded-md" />
                  <Skeleton className="h-3 w-8 rounded" />
                </div>
                <Skeleton className="h-4 w-4/5 rounded" />
                <Skeleton className="h-3 w-3/5 rounded" />
                <div className="flex items-center justify-between pt-1 border-t border-border/40">
                  <Skeleton className="h-4 w-20 rounded" />
                  <Skeleton className="h-5 w-5 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
