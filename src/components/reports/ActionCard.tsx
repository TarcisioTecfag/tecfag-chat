import { ArrowRight, Target, User2 } from "lucide-react";
import type { Action } from "@/data/reports";
import { cn } from "@/lib/utils";

const priorityStyles: Record<Action["priority"], string> = {
  Crítica: "border-critical/40 bg-critical/12 text-critical",
  Alta: "border-warning/40 bg-warning/12 text-warning",
  Média: "border-info/40 bg-info/12 text-info",
};

export function ActionCard({ action, index }: { action: Action; index: number }) {
  return (
    <article className="panel rounded-xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-muted-foreground">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h4 className="text-sm font-semibold text-foreground">{action.title}</h4>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
            priorityStyles[action.priority],
          )}
        >
          {action.priority}
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{action.detail}</p>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <User2 className="size-3.5" /> {action.owner}
        </span>
        <span className="flex items-center gap-1.5">
          <Target className="size-3.5" /> {action.horizon}
        </span>
        <span className="ml-auto flex items-center gap-1.5 font-medium text-primary">
          <ArrowRight className="size-3.5" /> {action.expected}
        </span>
      </div>
    </article>
  );
}