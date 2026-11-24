import React from "react";
import { Mail, Plus, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SystemTooltip } from "@/components/ui/tooltip";

interface ContactEmailsEditorProps {
  emails: string[];
  onChange: (nextEmails: string[]) => void;
  disabled?: boolean;
  compact?: boolean;
  placeholder?: string;
}

export function ContactEmailsEditor({
  emails,
  onChange,
  disabled = false,
  compact = false,
  placeholder = "contato@empresa.com.br",
}: ContactEmailsEditorProps) {
  const rows = emails.length > 0 ? emails : [""];

  const handleValueChange = (index: number, value: string) => {
    const next = [...rows];
    next[index] = value;
    onChange(next);
  };

  const handleSetPrimary = (index: number) => {
    if (index === 0 || index >= rows.length) return;
    const next = [...rows];
    const [picked] = next.splice(index, 1);
    next.unshift(picked);
    onChange(next);
  };

  const handleRemove = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [""]);
  };

  const handleAdd = () => {
    onChange([...rows, ""]);
  };

  return (
    <div className="space-y-2">
      {rows.map((value, index) => {
        const isPrimary = index === 0;
        return (
          <div key={index} className="flex items-center gap-1.5">
            <div className="relative flex-1 min-w-0">
              <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="email"
                value={value}
                disabled={disabled}
                onChange={(e) => handleValueChange(index, e.target.value)}
                placeholder={isPrimary ? placeholder : "E-mail adicional..."}
                className={cn(
                  "w-full rounded-xl border border-border bg-background pl-9 pr-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25 transition-all",
                  compact ? "h-8 text-xs" : "h-9 text-xs",
                  isPrimary && rows.length > 1 && "border-primary/40",
                )}
              />
            </div>

            {rows.length > 1 && (
              <SystemTooltip
                content={
                  isPrimary
                    ? "E-mail principal do contato"
                    : "Definir como e-mail principal"
                }
              >
                <button
                  type="button"
                  disabled={disabled || isPrimary}
                  onClick={() => handleSetPrimary(index)}
                  className={cn(
                    "inline-flex items-center justify-center rounded-xl border transition-colors shrink-0",
                    compact ? "h-8 w-8" : "h-9 w-9",
                    isPrimary
                      ? "border-primary/30 bg-primary/10 text-primary cursor-default"
                      : "border-border bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer",
                  )}
                >
                  <Star className={cn("h-3.5 w-3.5", isPrimary && "fill-current")} />
                </button>
              </SystemTooltip>
            )}

            {(rows.length > 1 || value.trim().length > 0) && (
              <SystemTooltip content="Remover este e-mail">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => handleRemove(index)}
                  className={cn(
                    "inline-flex items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground hover:text-destructive hover:border-destructive/40 hover:bg-destructive/10 transition-colors cursor-pointer shrink-0",
                    compact ? "h-8 w-8" : "h-9 w-9",
                  )}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </SystemTooltip>
            )}
          </div>
        );
      })}

      <SystemTooltip content="Adicionar outro endereço de e-mail para este contato">
        <button
          type="button"
          disabled={disabled}
          onClick={handleAdd}
          className="inline-flex items-center gap-1.5 text-[11px] font-bold text-primary hover:underline cursor-pointer disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar e-mail
        </button>
      </SystemTooltip>
    </div>
  );
}
