import React, { useState } from "react";
import { Zap, Smile, Paperclip, Mic, Send } from "lucide-react";

interface MobileMessageInputProps {
  onSendMessage?: (text: string, isInternalNote: boolean) => void;
  onOpenQuickResponses?: () => void;
  onOpenEmojiPicker?: () => void;
}

export const MobileMessageInput: React.FC<MobileMessageInputProps> = ({
  onSendMessage,
  onOpenQuickResponses,
  onOpenEmojiPicker,
}) => {
  const [activeTab, setActiveTab] = useState<"message" | "internal_note">(
    "message"
  );
  const [text, setText] = useState("");

  const handleSend = () => {
    if (!text.trim()) return;
    if (onSendMessage) {
      onSendMessage(text, activeTab === "internal_note");
    }
    setText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="fixed bottom-14 left-0 right-0 z-40 bg-card/95 backdrop-blur-md px-3 pt-2 pb-2.5 border-t border-border shadow-soft flex flex-col gap-2 transition-colors">
      {/* Abas Superiores: Enviar Mensagem | Nota Interna */}
      <div className="flex items-center gap-6 px-3 border-b border-border/60 pb-1.5 text-xs font-bold">
        <button
          onClick={() => setActiveTab("message")}
          className={`relative pb-1 transition-colors cursor-pointer ${
            activeTab === "message"
              ? "text-primary font-extrabold"
              : "text-muted-foreground hover:text-foreground font-medium"
          }`}
        >
          Enviar Mensagem
          {activeTab === "message" && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
          )}
        </button>

        <button
          onClick={() => setActiveTab("internal_note")}
          className={`relative pb-1 transition-colors cursor-pointer ${
            activeTab === "internal_note"
              ? "text-primary font-extrabold"
              : "text-muted-foreground hover:text-foreground font-medium"
          }`}
        >
          Nota Interna
          {activeTab === "internal_note" && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
          )}
        </button>
      </div>

      {/* Container da caixa de digitação */}
      <div className="flex items-center gap-2 bg-muted/60 border border-border rounded-full px-3.5 py-1.5 shadow-2xs focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            activeTab === "message"
              ? "Escreva sua mensagem..."
              : "Escreva uma nota interna (apenas sua equipe verá)..."
          }
          className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none py-1.5"
        />

        <div className="flex items-center gap-2.5 text-muted-foreground shrink-0">
          <button
            type="button"
            onClick={onOpenQuickResponses}
            className="hover:text-primary transition-colors p-1 cursor-pointer"
            title="Respostas Rápidas"
          >
            <Zap className="w-4 h-4 stroke-[2]" />
          </button>

          <button
            type="button"
            onClick={onOpenEmojiPicker}
            className="hover:text-primary transition-colors p-1 cursor-pointer"
            title="Emojis"
          >
            <Smile className="w-4 h-4 stroke-[2]" />
          </button>

          <button
            type="button"
            className="hover:text-primary transition-colors p-1 cursor-pointer"
            title="Anexar arquivo"
          >
            <Paperclip className="w-4 h-4 stroke-[2]" />
          </button>

          <button
            type="button"
            className="hover:text-primary transition-colors p-1 cursor-pointer"
            title="Gravador de Voz"
          >
            <Mic className="w-4 h-4 stroke-[2]" />
          </button>

          <button
            type="button"
            onClick={handleSend}
            className="w-8 h-8 rounded-full bg-primary hover:opacity-90 active:scale-95 text-primary-foreground flex items-center justify-center transition-all shadow-soft ml-0.5 cursor-pointer"
            title="Enviar"
          >
            <Send className="w-3.5 h-3.5 stroke-[2.5] translate-x-0.5 -translate-y-0.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
