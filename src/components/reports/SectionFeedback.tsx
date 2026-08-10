import { useState } from "react";
import { Check, MessageSquare, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type FeedbackValue = { vote: "up" | "down" | null; comment: string };

export function SectionFeedback({
  sectionId,
  label,
  value,
  onChange,
}: {
  sectionId: string;
  label: string;
  value: FeedbackValue;
  onChange: (id: string, next: FeedbackValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value.comment);

  const vote = (v: "up" | "down") =>
    onChange(sectionId, { ...value, vote: value.vote === v ? null : v });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 hidden text-[10px] uppercase tracking-wider text-muted-foreground xl:inline">
        Esta seção foi útil?
      </span>
      <button
        type="button"
        aria-label={`Marcar ${label} como útil`}
        onClick={() => vote("up")}
        className={cn(
          "grid size-7 place-items-center rounded-lg border transition-colors",
          value.vote === "up"
            ? "border-positive/40 bg-positive/12 text-positive"
            : "border-border text-muted-foreground hover:text-foreground",
        )}
      >
        <ThumbsUp className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={`Marcar ${label} como não útil`}
        onClick={() => vote("down")}
        className={cn(
          "grid size-7 place-items-center rounded-lg border transition-colors",
          value.vote === "down"
            ? "border-critical/40 bg-critical/12 text-critical"
            : "border-border text-muted-foreground hover:text-foreground",
        )}
      >
        <ThumbsDown className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={`Comentar em ${label}`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] transition-colors",
          value.comment
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border text-muted-foreground hover:text-foreground",
        )}
      >
        <MessageSquare className="size-3.5" />
        {value.comment ? "1" : ""}
      </button>

      {open ? (
        <div className="mt-2 w-full rounded-xl border border-border bg-card/70 p-3">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Comentário para treinar as próximas recomendações
          </label>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 500))}
            rows={3}
            placeholder={`O que faltou em "${label}"?`}
            className="mt-2 w-full resize-none rounded-lg border border-border bg-background/60 p-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">{draft.length}/500</span>
            <button
              type="button"
              onClick={() => {
                onChange(sectionId, { ...value, comment: draft.trim() });
                setOpen(false);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              <Check className="size-3.5" /> Salvar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
