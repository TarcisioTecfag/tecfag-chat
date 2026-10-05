import React from "react";

export type MessageReactionView = { emoji: string; from?: string };

/**
 * Badge de reação sob a bolha da mensagem (estilo WhatsApp). Mostra os emojis das reações
 * recebidas do cliente; renderiza nada quando não há reação.
 */
export function MessageReactions({
  reactions,
  side,
}: {
  reactions?: MessageReactionView[] | null;
  side: "in" | "out";
}) {
  if (!reactions || reactions.length === 0) return null;

  const counts = new Map<string, number>();
  for (const r of reactions) {
    if (r?.emoji) counts.set(r.emoji, (counts.get(r.emoji) || 0) + 1);
  }
  if (counts.size === 0) return null;

  return (
    <div className={`-mt-2 flex select-none ${side === "out" ? "justify-end pr-3" : "justify-start pl-2"}`}>
      <span
        className="relative z-10 inline-flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-0.5 text-sm leading-none shadow-soft"
        title="Reação do cliente"
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
