import React, { useState, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { EmojiPicker } from "./EmojiPicker";

const DEFAULT_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const RECENT_REACTIONS_KEY = "whatsapp_recent_reactions";

function getRecentReactions(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_REACTIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.slice(0, 6);
      }
    }
  } catch {}
  return DEFAULT_REACTIONS;
}

function saveRecentReaction(emoji: string) {
  try {
    const current = getRecentReactions();
    const updated = [emoji, ...current.filter((e) => e !== emoji)].slice(0, 6);
    localStorage.setItem(RECENT_REACTIONS_KEY, JSON.stringify(updated));
  } catch {}
}

export function MessageReactionPicker({
  activeEmoji,
  side,
  onSelectEmoji,
  onClose,
}: {
  activeEmoji?: string | null;
  side: "in" | "out";
  onSelectEmoji: (emoji: string) => void;
  onClose: () => void;
}) {
  const [showFullPicker, setShowFullPicker] = useState(false);
  const [quickEmojis, setQuickEmojis] = useState<string[]>(DEFAULT_REACTIONS);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuickEmojis(getRecentReactions());
  }, []);

  // Fecha ao clicar fora ou apertar Escape
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const handleChoose = (emoji: string) => {
    if (activeEmoji === emoji) {
      // Toggle: se clicou no mesmo emoji, remove a reação
      onSelectEmoji("");
    } else {
      saveRecentReaction(emoji);
      onSelectEmoji(emoji);
    }
    onClose();
  };

  return (
    <div
      ref={containerRef}
      className={`absolute -top-11 z-50 flex items-center select-none ${
        side === "out" ? "right-2" : "left-2"
      }`}
    >
      {/* Barra de Reações Rápidas (estilo WhatsApp) */}
      <div className="flex items-center gap-1 rounded-full border border-border/80 bg-card/95 px-2 py-1 shadow-lg backdrop-blur-md animate-in fade-in zoom-in-95 duration-150">
        {quickEmojis.map((emoji) => {
          const isActive = activeEmoji === emoji;
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => handleChoose(emoji)}
              className={`h-7 w-7 flex items-center justify-center rounded-full text-base transition-all cursor-pointer hover:scale-125 ${
                isActive
                  ? "bg-primary/20 ring-1 ring-primary/60 scale-110 shadow-xs"
                  : "hover:bg-muted"
              }`}
              title={isActive ? "Remover sua reação" : `Reagir com ${emoji}`}
            >
              <span>{emoji}</span>
            </button>
          );
        })}

        {/* Botão '+' para abrir seletor completo */}
        <button
          type="button"
          onClick={() => setShowFullPicker((prev) => !prev)}
          className={`h-6 w-6 flex items-center justify-center rounded-full transition-all cursor-pointer ${
            showFullPicker
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
          title="Mais reações"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Popover completo de Emojis */}
      {showFullPicker && (
        <div
          className={`absolute top-10 z-50 ${
            side === "out" ? "right-0" : "left-0"
          }`}
        >
          <EmojiPicker
            onSelect={(emoji) => handleChoose(emoji)}
            onClose={() => setShowFullPicker(false)}
          />
        </div>
      )}
    </div>
  );
}
