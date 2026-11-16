import React, { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  EyeOff,
  MessageSquareReply,
} from "lucide-react";
import { toast } from "sonner";
import { SystemTooltip } from "@/components/ui/tooltip";
import type { MetaUnsupportedExplanation } from "@/lib/whatsapp/meta-message-text";

export interface MetaUnsupportedNoticeCardProps {
  info: MetaUnsupportedExplanation;
  onUseSuggestedReply?: (replyText: string) => void;
  compact?: boolean;
}

/**
 * Aviso interno (visível apenas para o atendente no painel) exibido quando a Meta Cloud API
 * entrega uma mensagem `unsupported` sem o conteúdo original. Explica os motivos prováveis
 * e oferece uma resposta pronta para orientar o cliente.
 */
export function MetaUnsupportedNoticeCard({
  info,
  onUseSuggestedReply,
  compact = false,
}: MetaUnsupportedNoticeCardProps) {
  const [copied, setCopied] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(info.suggestedClientReply).catch(() => {});
    setCopied(true);
    toast.success("Aviso copiado! Cole no chat para enviar ao cliente.");
    setTimeout(() => setCopied(false), 2200);
  };

  const handleUseReply = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onUseSuggestedReply) return;
    onUseSuggestedReply(info.suggestedClientReply);
    toast.success("Sugestão inserida no campo de resposta. Revise e envie ao cliente.");
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`w-full ${
        compact ? "max-w-[330px] space-y-2 text-[11px]" : "max-w-[430px] space-y-2.5 text-xs"
      } text-left cursor-default select-text`}
    >
      {/* Faixa superior identificando que o aviso é exclusivo do funcionário */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[9.5px] font-bold text-primary">
          <EyeOff className="h-3 w-3 shrink-0" />
          <span>Aviso interno · só você vê</span>
        </span>
        <span className="rounded-md border border-border/80 bg-muted/70 px-1.5 py-0.5 text-[9.5px] font-semibold text-muted-foreground">
          {info.badgeLabel}
        </span>
      </div>

      {/* Cabeçalho direto do que ocorreu */}
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
          <AlertTriangle className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold leading-snug text-foreground">{info.headline}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {info.summary}
          </p>
        </div>
      </div>

      {/* Lista do que pode ter sido */}
      <div className="rounded-xl border border-border/75 bg-muted/45 px-2.5 py-2 space-y-1">
        <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/85">
          O que pode ter sido
        </p>
        <ul className="space-y-0.5 text-[11px] leading-relaxed text-muted-foreground">
          {info.possibleCauses.map((cause, idx) => (
            <li key={idx} className="flex items-start gap-1.5">
              <span className="mt-1.5 h-1 w-1 rounded-full bg-primary shrink-0" />
              <span>{cause}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Orientação e sugestão pronta para responder o cliente */}
      <div className="rounded-xl border border-primary/20 bg-primary/[0.04] dark:bg-primary/[0.08] p-2.5 space-y-2">
        <div className="space-y-0.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
            Como avisar o cliente
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {info.clientInstruction}
          </p>
        </div>

        <div className="rounded-lg border border-border/75 bg-background/90 dark:bg-background/60 px-2.5 py-2 text-[11px] leading-relaxed text-foreground">
          “{info.suggestedClientReply}”
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {onUseSuggestedReply && (
            <SystemTooltip content="Preenche a caixa de mensagem sem enviar automaticamente para você revisar">
              <button
                type="button"
                onClick={handleUseReply}
                className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary hover:bg-primary/90 active:scale-[0.99] text-primary-foreground px-2.5 py-1.5 text-[11px] font-bold shadow-2xs transition cursor-pointer"
              >
                <MessageSquareReply className="h-3.5 w-3.5 shrink-0" />
                <span>Preencher resposta</span>
              </button>
            </SystemTooltip>
          )}

          <SystemTooltip content="Copia a sugestão de aviso para você colar onde preferir">
            <button
              type="button"
              onClick={handleCopy}
              className={`${
                onUseSuggestedReply ? "" : "flex-1 "
              }inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/80 bg-background hover:bg-muted px-2.5 py-1.5 text-[11px] font-semibold text-foreground transition cursor-pointer shrink-0`}
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <span>Copiado</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span>Copiar aviso</span>
                </>
              )}
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* Detalhe técnico recolhido por padrão */}
      <div className="pt-0.5">
        <button
          type="button"
          onClick={() => setShowTechnical((prev) => !prev)}
          className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition cursor-pointer"
        >
          <span>{showTechnical ? "Ocultar detalhe técnico" : "Ver detalhe técnico"}</span>
          <ChevronDown
            className={`h-3 w-3 transition-transform duration-150 ${
              showTechnical ? "rotate-180" : ""
            }`}
          />
        </button>
        {showTechnical && (
          <p className="mt-1 rounded-lg border border-border/60 bg-muted/40 px-2 py-1 text-[10px] font-mono text-muted-foreground break-words">
            {info.technicalSummary}
          </p>
        )}
      </div>
    </div>
  );
}
