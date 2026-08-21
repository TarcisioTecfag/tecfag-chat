import React from "react";
import { Globe, MousePointerClick, Users2, Clock } from "lucide-react";

interface SiteVisitorsTabProps {
  tenantId: string | null;
}

/**
 * SiteVisitorsTab — Aba de Visitantes do Site em tempo real.
 *
 * Placeholder pronto para integracao futura com dados reais de rastreamento
 * de visitantes (ex: analytics via widget, pixel ou API propria).
 * Recebe `tenantId` para isolamento multi-tenant obrigatorio.
 */
export function SiteVisitorsTab({ tenantId }: SiteVisitorsTabProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header da aba */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-line shrink-0">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-primary-soft text-primary">
            <Globe className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-xs font-extrabold text-foreground">Visitantes do Site</h2>
            <p className="text-[10px] text-muted-foreground">Monitoramento em tempo real</p>
          </div>
        </div>
        {tenantId && (
          <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider border border-border rounded-lg px-2 py-0.5">
            {tenantId}
          </span>
        )}
      </div>

      {/* Cards de metricas — placeholder */}
      <div className="grid grid-cols-3 gap-3 px-5 py-4 shrink-0">
        {[
          { icon: Users2,            label: "Online agora",  value: "—", color: "text-primary" },
          { icon: MousePointerClick, label: "Sessoes hoje",  value: "—", color: "text-violet-500" },
          { icon: Clock,             label: "Tempo medio",   value: "—", color: "text-amber-500" },
        ].map(({ icon: Icon, label, value, color }) => (
          <div
            key={label}
            className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-card py-4 shadow-soft"
          >
            <Icon className={`h-5 w-5 ${color}`} />
            <span className="text-lg font-extrabold text-foreground">{value}</span>
            <span className="text-[10px] text-muted-foreground text-center">{label}</span>
          </div>
        ))}
      </div>

      {/* Estado vazio */}
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <Globe className="h-8 w-8" />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground">Feature em desenvolvimento</p>
          <p className="mt-1 text-xs text-muted-foreground max-w-xs leading-relaxed">
            O rastreamento de visitantes em tempo real sera integrado aqui.
            Quando ativo, voce vera as paginas visitadas, origem do trafego e
            oportunidades de conversao via chat.
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[10px] font-bold text-amber-700">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
          Em breve
        </div>
      </div>
    </div>
  );
}
