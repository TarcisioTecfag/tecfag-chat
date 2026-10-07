import React from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function ModuleSkeleton({ variant = "dashboard" }: { variant?: "dashboard" | "chat" | "table" }) {
  if (variant === "chat") {
    return (
      <div className="flex flex-1 gap-5 h-full w-full overflow-hidden animate-in fade-in duration-150">
        {/* Esqueleto da Lista de Conversas */}
        <div className="flex h-full w-[260px] shrink-0 flex-col rounded-3xl bg-card p-4 border border-border space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-28 rounded-lg" />
            <Skeleton className="h-6 w-6 rounded-md" />
          </div>
          <div className="flex flex-col items-center gap-2 py-2">
            <Skeleton className="h-16 w-16 rounded-full" />
            <Skeleton className="h-4 w-24 rounded-md" />
            <Skeleton className="h-3 w-16 rounded-full" />
          </div>
          <Skeleton className="h-9 w-full rounded-xl" />
          <div className="space-y-2 pt-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-2.5 p-2 rounded-2xl bg-muted/30">
                <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-3/4 rounded" />
                  <Skeleton className="h-2.5 w-1/2 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Esqueleto do Painel Principal */}
        <div className="flex h-full min-w-0 flex-1 flex-col rounded-3xl bg-chat-panel border border-border p-6 justify-between">
          <div className="flex items-center justify-between pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-32 rounded" />
                <Skeleton className="h-3 w-20 rounded" />
              </div>
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <Skeleton className="h-8 w-8 rounded-lg" />
            </div>
          </div>
          <div className="space-y-4 my-auto max-w-xl w-full mx-auto opacity-40">
            <Skeleton className="h-12 w-3/4 rounded-2xl" />
            <Skeleton className="h-12 w-2/3 rounded-2xl ml-auto" />
            <Skeleton className="h-16 w-4/5 rounded-2xl" />
          </div>
          <Skeleton className="h-12 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 h-full w-full flex-col rounded-3xl bg-card border border-border p-6 space-y-6 overflow-hidden animate-in fade-in duration-150">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-border/80">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32 rounded" />
          <Skeleton className="h-7 w-64 rounded-lg" />
          <Skeleton className="h-3 w-80 rounded" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24 rounded-xl" />
          <Skeleton className="h-9 w-28 rounded-xl" />
        </div>
      </div>

      {/* Cards Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="p-5 rounded-2xl border border-border bg-muted/20 space-y-3">
            <div className="flex justify-between">
              <Skeleton className="h-3 w-20 rounded" />
              <Skeleton className="h-4 w-4 rounded" />
            </div>
            <Skeleton className="h-8 w-36 rounded-lg" />
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        ))}
      </div>

      {/* Content Area Skeleton */}
      <div className="flex-1 rounded-2xl border border-border bg-muted/10 p-5 space-y-3">
        <div className="flex justify-between items-center pb-2">
          <Skeleton className="h-4 w-40 rounded" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
        <div className="space-y-2.5 pt-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-card border border-border/60">
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-48 rounded" />
                  <Skeleton className="h-2.5 w-28 rounded" />
                </div>
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
