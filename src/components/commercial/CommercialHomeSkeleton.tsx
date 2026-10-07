import React from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function CommercialHomeSkeleton() {
  return (
    <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(380px,1fr)] 2xl:grid-cols-[minmax(0,1.65fr)_minmax(420px,1fr)] items-start animate-in fade-in duration-150 select-none">
      {/* Coluna Esquerda: Cockpit & Diretrizes */}
      <div className="space-y-4">
        {/* Bloco 1: 3 Cards de Topo */}
        <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr_1fr]">
          <div className="rounded-[4px] border border-primary/20 bg-card p-5 space-y-4">
            <div className="flex justify-between items-start">
              <Skeleton className="h-3.5 w-24 rounded" />
              <Skeleton className="h-7 w-12 rounded" />
            </div>
            <Skeleton className="h-7 w-3/4 rounded" />
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
          <div className="rounded-[4px] border border-border bg-card p-5 space-y-3">
            <Skeleton className="h-3 w-28 rounded" />
            <Skeleton className="h-7 w-36 rounded" />
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
          <div className="rounded-[4px] border border-border bg-card p-5 space-y-3">
            <Skeleton className="h-3 w-28 rounded" />
            <Skeleton className="h-7 w-32 rounded" />
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        </div>

        {/* Bloco 2: Meta & Agenda */}
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-[4px] border border-border bg-card p-5 space-y-4">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-32 rounded" />
              <Skeleton className="h-4 w-16 rounded" />
            </div>
            <Skeleton className="h-8 w-44 rounded" />
            <Skeleton className="h-2.5 w-full rounded-full" />
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/50">
              <Skeleton className="h-6 w-full rounded" />
              <Skeleton className="h-6 w-full rounded" />
              <Skeleton className="h-6 w-full rounded" />
            </div>
          </div>

          <div className="rounded-[4px] border border-border bg-card p-5 space-y-3">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-28 rounded" />
              <Skeleton className="h-4 w-8 rounded" />
            </div>
            <div className="space-y-2 pt-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded bg-muted/30">
                  <Skeleton className="h-5 w-12 rounded" />
                  <Skeleton className="h-4 w-32 rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bloco 3: Diretrizes do Gestor */}
        <div className="rounded-[4px] border border-border bg-card p-5 space-y-4">
          <div className="flex justify-between items-center pb-2 border-b border-border/60">
            <Skeleton className="h-5 w-48 rounded" />
            <div className="flex gap-1.5">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-7 w-16 rounded" />
              ))}
            </div>
          </div>
          <div className="space-y-2.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 rounded border border-border/60 bg-muted/10 space-y-2">
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-52 rounded" />
                  <Skeleton className="h-5 w-16 rounded" />
                </div>
                <Skeleton className="h-3 w-3/4 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Coluna Direita: Calendário Comercial & Dossiê */}
      <div className="space-y-4">
        <div className="rounded-[4px] border border-border bg-card p-5 space-y-4">
          <div className="flex justify-between items-center">
            <Skeleton className="h-5 w-36 rounded" />
            <Skeleton className="h-7 w-20 rounded" />
          </div>
          {/* Grade de Dias */}
          <div className="grid grid-cols-7 gap-1.5 pt-2">
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded" />
            ))}
          </div>
        </div>

        {/* Dossiê do Dia Selecionado */}
        <div className="rounded-[4px] border border-border bg-card p-5 space-y-3">
          <Skeleton className="h-4 w-40 rounded" />
          <Skeleton className="h-16 w-full rounded bg-muted/20" />
        </div>
      </div>
    </div>
  );
}
