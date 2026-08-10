import { AlertTriangle, ShieldAlert, Sparkles } from "lucide-react";
import type { Finding } from "@/data/reports";
import { signalStyles } from "./signal";
import { cn } from "@/lib/utils";

const icons = {
  positive: Sparkles,
  warning: AlertTriangle,
  critical: ShieldAlert,
  info: Sparkles,
} as const;

export function FindingCard({ finding }: { finding: Finding }) {
  const style = signalStyles[finding.signal];
  const Icon = icons[finding.signal];

  return (
    <article className="group relative overflow-hidden rounded-xl border border-border bg-card/60 p-4 transition-colors hover:border-primary/40">
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", style.bar)} />
      <div className="flex items-start gap-3 pl-2">
        <span className={cn("mt-0.5 rounded-lg border p-1.5", style.chip)}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-foreground">{finding.title}</h4>
            <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {finding.tag}
            </span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{finding.detail}</p>
          {finding.impact ? (
            <p className={cn("mt-2 font-mono text-xs", style.text)}>{finding.impact}</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}