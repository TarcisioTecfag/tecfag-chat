import React from "react";

export type MessageReactionView = { emoji: string; from?: string; operatorName?: string };

/**
 * Badge de reação sob a bolha da mensagem (estilo WhatsApp). Mostra os emojis das reações
 * recebidas do cliente e enviadas pelo operador; renderiza nada quando não há reação.
 */
export function MessageReactions({
  reactions,
  side,
  onReactionClick,
}: {
  reactions?: MessageReactionView[] | null;
  side: "in" | "out";
  onReactionClick?: (emoji: string) => void;
}) {
  if (!reactions || reactions.length === 0) return null;

  const counts = new Map<string, number>();
  let hasOperatorReaction = false;
  let operatorEmoji: string | null = null;

  for (const r of reactions) {
    if (r?.emoji) {
      counts.set(r.emoji, (counts.get(r.emoji) || 0) + 1);
      if (r.from === "operator") {
        hasOperatorReaction = true;
        operatorEmoji = r.emoji;
      }
    }
  }
  if (counts.size === 0) return null;

  return (
    <div className={`-mt-2 flex select-none ${side === "out" ? "justify-end pr-3" : "justify-start pl-2"}`}>
      <span
        onClick={() => {
          if (onReactionClick && operatorEmoji) {
            onReactionClick(operatorEmoji);
          }
        }}
        className={`relative z-10 inline-flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-0.5 text-sm leading-none shadow-soft transition-transform ${
          onReactionClick && operatorEmoji ? "cursor-pointer hover:scale-105 hover:bg-muted/80" : ""
        } ${hasOperatorReaction ? "border-primary/40" : ""}`}
        title={
          hasOperatorReaction
            ? `Reações da mensagem (clique para remover a sua: ${operatorEmoji})`
            : "Reações da mensagem"
        }
      >
        {[...counts.entries()].map(([emoji, count]) => (
          <span key={emoji} className="inline-flex items-center gap-0.5">
            <span>{emoji}</span>
            {count > 1 && <span className="text-[10px] font-semibold text-muted-foreground">{count}</span>}
          </span>
        ))}
      </span>
    </div>
  );
}
