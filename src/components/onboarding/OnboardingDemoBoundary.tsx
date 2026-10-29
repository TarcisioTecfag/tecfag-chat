import React from "react";
import { ShieldCheck } from "lucide-react";

interface OnboardingDemoBoundaryProps {
  active: boolean;
  children: React.ReactNode;
}

/**
 * Isolates the interactive demo workspace during the onboarding tour.
 * Blocks accidental native form submissions and external link navigations
 * while keeping synthetic tour interactions and `data-tour` targets active.
 */
export function OnboardingDemoBoundary({
  active,
  children,
}: OnboardingDemoBoundaryProps) {
  if (!active) {
    return <>{children}</>;
  }

  return (
    <div
      data-tour-boundary="demo-sandbox"
      className="relative w-full"
      onSubmitCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs text-foreground">
        <div className="flex items-center gap-2 font-medium">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
          <span>
            Ambiente de Demonstração Segura Ativo — Nenhuma mensagem real, negócio, tarefa ou configuração de produção será alterada.
          </span>
        </div>
        <span className="rounded-full border border-primary/25 bg-primary-soft px-2 py-0.5 text-[10px] font-bold text-primary uppercase tracking-wider">
          Demo Isolada
        </span>
      </div>
      {children}
    </div>
  );
}
