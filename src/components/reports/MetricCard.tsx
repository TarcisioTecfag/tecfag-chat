import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { Metric } from "@/data/reports";
import { cn } from "@/lib/utils";

export function MetricCard({ metric }: { metric: Metric }) {
  const delta = metric.delta;
  const good =
    delta === undefined
      ? null
      : metric.goodWhen === "down"
        ? delta <= 0
        : delta >= 0;

  return (
    <div className="panel rounded-xl p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {metric.label}
      </p>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="font-display text-3xl font-semibold text-foreground">{metric.value}</span>
        {metric.unit ? (
          <span className="text-sm font-medium text-muted-foreground">{metric.unit}</span>
        ) : null}
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs">
        {delta === undefined ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Minus className="size-3" /> estável
          </span>
        ) : (
          <span
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium",
              good ? "border-positive/30 bg-positive/10 text-positive" : "border-critical/30 bg-critical/10 text-critical",
            )}
          >
            {delta >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {Math.abs(delta).toLocaleString("pt-BR")}%
          </span>
        )}
        <span className="truncate text-muted-foreground">{metric.deltaLabel ?? metric.target}</span>
      </div>

      {metric.progress !== undefined ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all duration-700"
            style={{ width: `${metric.progress}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}