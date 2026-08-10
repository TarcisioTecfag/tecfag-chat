import { ArrowRight, Check, CircleDashed, Loader2, RotateCcw, Send } from "lucide-react";
import type { ApprovalStage, Report } from "@/data/reports";
import { stageMeta, stageOrder } from "@/data/reports";
import { signalStyles } from "./signal";
import { cn } from "@/lib/utils";

const nextLabel: Record<ApprovalStage, string | null> = {
  rascunho: "Enviar para revisão",
  revisao: "Aprovar relatório",
  aprovado: "Enviar à diretoria",
  enviado: null,
};

export function ApprovalPanel({
  report,
  stage,
  onAdvance,
  onReject,
}: {
  report: Report;
  stage: ApprovalStage;
  onAdvance: () => void;
  onReject: () => void;
}) {
  const currentIndex = stageOrder.indexOf(stage);
  const meta = stageMeta[stage];
  const advance = nextLabel[stage];

  return (
    <section className="panel rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Fluxo de aprovação
        </h3>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
            signalStyles[meta.signal].chip,
          )}
        >
          {meta.label}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{meta.description}</p>

      <ol className="mt-4 space-y-3">
        {report.review.map((step) => {
          const idx = stageOrder.indexOf(step.stage);
          const done = idx < currentIndex || (idx === currentIndex && stage === "enviado");
          const active = idx === currentIndex;
          return (
            <li key={step.role} className="flex gap-2.5">
              <span
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
                  done
                    ? "border-positive/40 bg-positive/15 text-positive"
                    : active
                      ? "border-primary/50 bg-primary/15 text-primary"
                      : "border-border text-muted-foreground",
                )}
              >
                {done ? (
                  <Check className="size-3" />
                ) : active ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <CircleDashed className="size-3" />
                )}
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-xs font-semibold",
                    done || active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {step.role}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{step.name}</p>
                {step.at ? (
                  <p className="font-mono text-[10px] text-muted-foreground">{step.at}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 space-y-2">
        {advance ? (
          <button
            onClick={onAdvance}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            {stage === "aprovado" ? <Send className="size-3.5" /> : <ArrowRight className="size-3.5" />}
            {advance}
          </button>
        ) : (
          <p className="rounded-lg border border-positive/30 bg-positive/10 px-3 py-2 text-center text-xs font-medium text-positive">
            Relatório distribuído à diretoria
          </p>
        )}
        {currentIndex > 0 ? (
          <button
            onClick={onReject}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-critical/40 hover:text-critical"
          >
            <RotateCcw className="size-3.5" /> Devolver para ajustes
          </button>
        ) : null}
      </div>
    </section>
  );
}