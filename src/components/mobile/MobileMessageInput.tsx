import React, { useState, useRef, useEffect } from "react";
import { useChat } from "@/hooks/useChatState";
import {
  Zap,
  Smile,
  Paperclip,
  Mic,
  Send,
  Lock,
  X,
  Trash2,
  Square,
  FileText,
  Image as ImageIcon,
  Film,
  Sparkles,
  Package,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ValentinaAssistantModal } from "../chat/ValentinaAssistantModal";
import { ProductCatalogPicker } from "../chat/ProductCatalogPicker";
import { getAiPersona } from "@/lib/ai-persona";

interface MobileMessageInputProps {
  onSendMessage?: (text: string, isInternalNote: boolean) => void;
}

const COMMON_EMOJIS = [
  "😊", "👍", "🙏", "🟢", "📞", "📄", "📍", "🤝",
  "✅", "🚀", "💼", "📊", "🔥", "⭐", "❤️", "🎯",
  "👋", "💡", "⚠️", "⏳", "💬", "🏢", "💰", "✨"
];

export const MobileMessageInput: React.FC<MobileMessageInputProps> = ({
  onSendMessage,
}) => {
  const { sendMessage, templates, selectedChatId, conversations, tenant, operatorProfile } = useChat();
  const aiPersona = getAiPersona(tenant || "valem");

  const [activeTab, setActiveTab] = useState<"message" | "internal_note">("message");
  const [text, setText] = useState("");
  const [showValentinaModal, setShowValentinaModal] = useState(false);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);

  const activeChat = conversations.find((c) => c.id === selectedChatId);

  const handleApplyValentinaText = (newText: string, asInternalNote: boolean = false) => {
    if (asInternalNote) {
      setActiveTab("internal_note");
      setText(newText);
    } else {
      setActiveTab("message");
      setText(newText);
    }
    setIsCatalogOpen(false);
  };

  const handleAttachCatalogFiles = (newFiles: File[]) => {
    setAttachments((prev) => [...prev, ...newFiles]);
    setIsCatalogOpen(false);
    setActiveTab("message");
  };
  
  // Modais e Popovers
  const [showQuickTemplates, setShowQuickTemplates] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Anexos
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Gravação de Áudio
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Formatar Segundos para 00:00
  const fmtSec = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Enviar Mensagem com Texto e/ou Anexos
  const handleSend = async () => {
    if (!text.trim() && attachments.length === 0) return;

    if (onSendMessage) {
      onSendMessage(text, activeTab === "internal_note");
    } else {
      await sendMessage(text, activeTab === "internal_note", attachments);
    }

    setText("");
    setAttachments([]);
    setShowQuickTemplates(false);
    setShowEmojiPicker(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Seleção de Arquivos
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setAttachments((prev) => [...prev, ...files]);
    }
    e.target.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Gravação de Áudio Nativa
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);

      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch {
      alert("Não foi possível acessar o microfone. Verifique a permissão do seu dispositivo.");
    }
  };

  const stopAndSendRecording = () => {
    if (!mediaRecorderRef.current) return;

    mediaRecorderRef.current.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const audioFile = new File([audioBlob], `audio_${Date.now()}.webm`, { type: "audio/webm" });
      
      await sendMessage("", false, [audioFile]);

      // Limpar Stream de áudio
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
      setRecordingSeconds(0);
      if (timerRef.current) clearInterval(timerRef.current);
    };

    mediaRecorderRef.current.stop();
  };

  const discardRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }
    setIsRecording(false);
    setRecordingSeconds(0);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border/80 shadow-2xl transition-all pb-[max(12px,env(safe-area-inset-bottom))]">
      {/* Input de arquivo invisível */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,application/pdf,audio/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="max-w-lg mx-auto px-3.5 pt-2 pb-1.5 flex flex-col gap-2 relative">
        
        {/* ── POPUP: RESPOSTAS RÁPIDAS (⚡) ── */}
        <AnimatePresence>
          {showQuickTemplates && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute bottom-full left-3.5 right-3.5 mb-2 bg-card border border-border rounded-2xl p-3 shadow-2xl z-50 max-h-56 overflow-y-auto flex flex-col gap-1.5"
            >
              <div className="flex items-center justify-between pb-1.5 border-b border-border text-xs font-bold text-foreground">
                <span className="flex items-center gap-1.5 text-primary">
                  <Zap className="w-3.5 h-3.5" />
                  <span>Respostas Rápidas</span>
                </span>
                <button
                  onClick={() => setShowQuickTemplates(false)}
                  className="p-1 rounded-full text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {templates.length > 0 ? (
                templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => {
                      setText((prev) => (prev ? `${prev} ${tpl.text}` : tpl.text));
                      setShowQuickTemplates(false);
                    }}
                    className="text-left p-2 rounded-xl bg-muted/50 hover:bg-primary-soft transition flex flex-col gap-0.5"
                  >
                    <span className="text-xs font-bold text-foreground">{tpl.title}</span>
                    <span className="text-[11px] text-muted-foreground line-clamp-1">{tpl.text}</span>
                  </button>
                ))
              ) : (
                <div className="py-4 text-center text-xs text-muted-foreground font-medium">
                  Nenhum template cadastrado.
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── POPUP: EMOJI PICKER (😊) ── */}
        <AnimatePresence>
          {showEmojiPicker && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute bottom-full left-3.5 right-3.5 mb-2 bg-card border border-border rounded-2xl p-3 shadow-2xl z-50 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between pb-1 border-b border-border text-xs font-bold text-foreground">
                <span className="flex items-center gap-1.5 text-primary">
                  <Smile className="w-3.5 h-3.5" />
                  <span>Selecione um Emoji</span>
                </span>
                <button
                  onClick={() => setShowEmojiPicker(false)}
                  className="p-1 rounded-full text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-8 gap-2 max-h-40 overflow-y-auto py-1">
                {COMMON_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      setText((prev) => prev + emoji);
                      setShowEmojiPicker(false);
                    }}
                    className="text-lg p-1.5 rounded-xl hover:bg-muted text-center transition cursor-pointer active:scale-90"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── PREVIEW DE ANEXOS ── */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1 py-1 bg-muted/40 rounded-xl border border-border/60">
            {attachments.map((file, i) => (
              <div
                key={i}
                className="relative group flex items-center gap-2 rounded-lg bg-card border border-border px-2.5 py-1.5 text-xs shadow-2xs"
              >
                {file.type.startsWith("image/") ? (
                  <ImageIcon className="w-4 h-4 text-emerald-500 shrink-0" />
                ) : file.type.startsWith("video/") ? (
                  <Film className="w-4 h-4 text-blue-500 shrink-0" />
                ) : (
                  <FileText className="w-4 h-4 text-primary shrink-0" />
                )}
                <span className="truncate max-w-[120px] font-semibold text-[11px]">{file.name}</span>
                <button
                  onClick={() => removeAttachment(i)}
                  className="p-0.5 rounded-full bg-destructive text-white ml-1 hover:opacity-90"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── MODO GRAVAÇÃO DE ÁUDIO ── */}
        {isRecording ? (
          <div className="flex items-center justify-between gap-3 bg-primary/10 border border-primary/30 rounded-full px-4 py-2 shadow-soft animate-pulse">
            <div className="flex items-center gap-2 text-primary font-bold text-xs">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
              <span>Gravando Áudio...</span>
              <span className="font-mono text-foreground text-sm ml-2">{fmtSec(recordingSeconds)}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={discardRecording}
                className="p-2 rounded-full bg-card border border-border text-destructive hover:bg-destructive hover:text-white transition"
                title="Cancelar Gravação"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                onClick={stopAndSendRecording}
                className="p-2 rounded-full bg-primary text-white hover:opacity-90 transition shadow-soft"
                title="Enviar Áudio"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Abas Superiores: Enviar Mensagem | Nota Interna | Valentina | Válvulas */}
            <div className="flex items-center justify-between px-2 pb-1 border-b border-border/40 text-xs font-bold select-none overflow-x-auto scrollbar-none">
              <div className="flex items-center gap-3 shrink-0">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    setActiveTab("message");
                    setIsCatalogOpen(false);
                  }}
                  className={`relative pb-1 transition-colors cursor-pointer text-xs ${
                    !isCatalogOpen && activeTab === "message"
                      ? "text-primary font-extrabold"
                      : "text-muted-foreground hover:text-foreground font-medium"
                  }`}
                >
                  Enviar Mensagem
                  {!isCatalogOpen && activeTab === "message" && (
                    <motion.span
                      layoutId="mobileInputActiveTab"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full"
                    />
                  )}
                </motion.button>

                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowValentinaModal(true)}
                  className="relative pb-1 transition-colors cursor-pointer flex items-center gap-1 text-xs text-primary hover:opacity-85 font-bold"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{aiPersona.name}</span>
                </motion.button>

                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    setActiveTab("internal_note");
                    setIsCatalogOpen(false);
                  }}
                  className={`relative pb-1 transition-colors cursor-pointer flex items-center gap-1 text-xs ${
                    !isCatalogOpen && activeTab === "internal_note"
                      ? "text-amber-600 dark:text-amber-400 font-extrabold"
                      : "text-muted-foreground hover:text-foreground font-medium"
                  }`}
                >
                  <Lock className="w-3 h-3 text-amber-500" />
                  <span>Nota Interna</span>
                  {!isCatalogOpen && activeTab === "internal_note" && (
                    <motion.span
                      layoutId="mobileInputActiveTab"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full"
                    />
                  )}
                </motion.button>

                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setIsCatalogOpen((v) => !v)}
                  className={`relative pb-1 transition-colors cursor-pointer flex items-center gap-1 text-xs ${
                    isCatalogOpen
                      ? "text-primary font-extrabold"
                      : "text-muted-foreground hover:text-foreground font-medium"
                  }`}
                >
                  <Package className="w-3 h-3" />
                  <span>{tenant === "tecfag" ? "Catálogo" : "Válvulas"}</span>
                  {isCatalogOpen && (
                    <motion.span
                      layoutId="mobileInputActiveTab"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full"
                    />
                  )}
                </motion.button>
              </div>

              {activeTab === "internal_note" && !isCatalogOpen && (
                <span className="text-[9px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-1.5 py-0.2 rounded-full shrink-0">
                  Equipe
                </span>
              )}
            </div>

            {isCatalogOpen ? (
              <ProductCatalogPicker
                tenantId={tenant}
                onAttachFiles={handleAttachCatalogFiles}
                onClose={() => setIsCatalogOpen(false)}
              />
            ) : (
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
                {/* 1. Respostas Rápidas (⚡) */}
                <motion.button
                  whileTap={{ scale: 0.88 }}
                  type="button"
                  onClick={() => {
                    setShowQuickTemplates((prev) => !prev);
                    setShowEmojiPicker(false);
                  }}
                  className={`transition-colors p-1 cursor-pointer ${
                    showQuickTemplates ? "text-primary font-bold" : "hover:text-primary"
                  }`}
                  title="Respostas Rápidas"
                >
                  <Zap className="w-4 h-4 stroke-[2]" />
                </motion.button>

                {/* 2. Emojis (😊) */}
                <motion.button
                  whileTap={{ scale: 0.88 }}
                  type="button"
                  onClick={() => {
                    setShowEmojiPicker((prev) => !prev);
                    setShowQuickTemplates(false);
                  }}
                  className={`transition-colors p-1 cursor-pointer ${
                    showEmojiPicker ? "text-primary font-bold" : "hover:text-primary"
                  }`}
                  title="Emojis"
                >
                  <Smile className="w-4 h-4 stroke-[2]" />
                </motion.button>

                {/* 3. Anexar Arquivo (📎) */}
                <motion.button
                  whileTap={{ scale: 0.88 }}
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="hover:text-primary transition-colors p-1 cursor-pointer"
                  title="Anexar arquivo"
                >
                  <Paperclip className="w-4 h-4 stroke-[2]" />
                </motion.button>

                {/* 4. Gravador de Voz (🎙️) */}
                <motion.button
                  whileTap={{ scale: 0.88 }}
                  type="button"
                  onClick={startRecording}
                  className="hover:text-primary transition-colors p-1 cursor-pointer"
                  title="Gravador de Voz"
                >
                  <Mic className="w-4 h-4 stroke-[2]" />
                </motion.button>

                {/* Botão Enviar */}
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
            )}
          </>
        )}
      </div>

      {/* Valentina Assistant Modal */}
      <ValentinaAssistantModal
        isOpen={showValentinaModal}
        onClose={() => setShowValentinaModal(false)}
        conversationId={selectedChatId || ""}
        contactName={activeChat?.name}
        currentDraftText={text}
        recentMessages={activeChat?.messages}
        tenantId={tenant}
        operatorName={operatorProfile?.name || "Vendedor"}
        onApplyText={handleApplyValentinaText}
      />
    </div>
  );
};
