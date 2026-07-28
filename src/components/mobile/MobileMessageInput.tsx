import React, { useState } from "react";
import { Zap, Smile, Paperclip, Mic, Send, Lock } from "lucide-react";
import { motion } from "framer-motion";

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
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border/80 shadow-2xl transition-all pb-[max(12px,env(safe-area-inset-bottom))]">
      <div className="max-w-lg mx-auto px-3.5 pt-2 pb-1.5 flex flex-col gap-2">
        
        {/* Abas Superiores: Enviar Mensagem | Nota Interna */}
        <div className="flex items-center justify-between px-2 pb-1 border-b border-border/40 text-xs font-bold select-none">
          <div className="flex items-center gap-4">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setActiveTab("message")}
              className={`relative pb-1 transition-colors cursor-pointer ${
                activeTab === "message"
                  ? "text-primary font-extrabold"
                  : "text-muted-foreground hover:text-foreground font-medium"
              }`}
            >
              Enviar Mensagem
              {activeTab === "message" && (
                <motion.span
                  layoutId="mobileInputActiveTab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full"
                />
              )}
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setActiveTab("internal_note")}
              className={`relative pb-1 transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === "internal_note"
                  ? "text-amber-600 dark:text-amber-400 font-extrabold"
                  : "text-muted-foreground hover:text-foreground font-medium"
              }`}
            >
              <Lock className="w-3 h-3 text-amber-500" />
              <span>Nota Interna</span>
              {activeTab === "internal_note" && (
                <motion.span
                  layoutId="mobileInputActiveTab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full"
                />
              )}
            </motion.button>
          </div>

          {activeTab === "internal_note" && (
            <span className="text-[10px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-full">
              Privado (Equipe)
            </span>
          )}
        </div>

        {/* Caixa de Digitação Mobile Centralizada e Ajustada */}
        <div
          className={`flex items-center gap-2 rounded-full px-3.5 py-1 shadow-2xs border transition-all ${
            activeTab === "internal_note"
              ? "bg-amber-500/10 border-amber-400/50 focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-200"
              : "bg-muted/70 border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
          }`}
        >
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
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none py-1.5 min-w-0"
          />

          <div className="flex items-center gap-1.5 text-muted-foreground shrink-0 pl-1">
            <motion.button
              whileTap={{ scale: 0.88 }}
              type="button"
              onClick={onOpenQuickResponses}
              className="hover:text-primary transition-colors p-1 cursor-pointer"
              title="Respostas Rápidas"
            >
              <Zap className="w-4 h-4 stroke-[2]" />
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.88 }}
              type="button"
              onClick={onOpenEmojiPicker}
              className="hover:text-primary transition-colors p-1 cursor-pointer"
              title="Emojis"
            >
              <Smile className="w-4 h-4 stroke-[2]" />
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.88 }}
              type="button"
              className="hover:text-primary transition-colors p-1 cursor-pointer"
              title="Anexar arquivo"
            >
              <Paperclip className="w-4 h-4 stroke-[2]" />
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.88 }}
              type="button"
              className="hover:text-primary transition-colors p-1 cursor-pointer"
              title="Gravador de Voz"
            >
              <Mic className="w-4 h-4 stroke-[2]" />
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.90 }}
              type="button"
              onClick={handleSend}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-soft ml-0.5 cursor-pointer ${
                activeTab === "internal_note"
                  ? "bg-amber-500 hover:bg-amber-600 text-white"
                  : "bg-primary hover:opacity-90 text-primary-foreground"
              }`}
              title="Enviar"
            >
              <Send className="w-4 h-4 stroke-[2.5]" />
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
};
