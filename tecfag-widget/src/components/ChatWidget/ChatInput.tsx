import React, { useState, useRef } from "react";
import { Paperclip, Send, X, FileText } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Attachment } from "./ChatBubble";

export interface ChatInputProps {
  onSend?: (message: string, attachments: Attachment[]) => void;
  onSendMessage?: (message: string, attachments?: Attachment[]) => void;
  isBlackNovember?: boolean;
  disabled?: boolean;
}

let attachmentIdCounter = 0;

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  onSendMessage,
  isBlackNovember = false,
  disabled = false,
}) => {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasContent = text.trim().length > 0 || attachments.length > 0;

  const handleFiles = (files: FileList | null) => {
    if (!files) return;

    let oversized = false;
    const validFiles = Array.from(files).filter((file) => {
      if (file.size > 5 * 1024 * 1024) {
        oversized = true;
        return false;
      }
      return true;
    });

    if (oversized) {
      alert(
        "O limite para anexos é de 5MB por imagem. Por favor, compacte a foto ou envie uma menor!",
      );
    }

    const newAttachments: Attachment[] = validFiles.map((file) => {
      const isImage = file.type.startsWith("image/");
      return {
        id: `att-${++attachmentIdCounter}`,
        file,
        previewUrl: isImage ? URL.createObjectURL(file) : null,
        type: isImage ? "image" : "file",
      };
    });
    setAttachments((prev) => [...prev, ...newAttachments]);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

  const handleSend = () => {
    if (!hasContent || disabled) return;
    const trimmed = text.trim();
    if (onSend) {
      onSend(trimmed, attachments);
    } else if (onSendMessage) {
      onSendMessage(trimmed, attachments);
    }
    setText("");
    setAttachments([]);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      handleFiles(e.clipboardData.files);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      id="tecfag-input-area"
      className={`border-t border-border bg-card rounded-b-2xl transition-colors ${isDragging ? "bg-accent/50 border-primary" : ""}`}
      style={{
        borderTop: "1px solid hsl(0 10% 90%)",
        background: "hsl(0 0% 100%)",
        borderRadius: "0 0 16px 16px",
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Attachment previews */}
      <AnimatePresence>
        {attachments.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pt-3 flex gap-2 flex-wrap" style={{ display: "flex", gap: 8, padding: "12px 16px 0", flexWrap: "wrap" }}>
              {attachments.map((att) => (
                <motion.div
                  key={att.id}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  className="relative group"
                  style={{ position: "relative" }}
                >
                  {att.type === "image" && att.previewUrl ? (
                    <div
                      className="w-16 h-16 rounded-lg overflow-hidden border border-border"
                      style={{ width: 64, height: 64, borderRadius: 8, overflow: "hidden", border: "1px solid hsl(0 10% 90%)" }}
                    >
                      <img
                        src={att.previewUrl}
                        alt={att.file.name}
                        className="w-full h-full object-cover"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    </div>
                  ) : (
                    <div
                      className="w-16 h-16 rounded-lg border border-border bg-muted flex flex-col items-center justify-center gap-1 px-1"
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 8,
                        border: "1px solid hsl(0 10% 90%)",
                        background: "hsl(0 5% 94%)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        padding: "0 4px",
                      }}
                    >
                      <FileText size={16} className="text-muted-foreground" />
                      <span
                        className="text-[8px] text-muted-foreground truncate w-full text-center"
                        style={{ fontSize: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%", textAlign: "center" }}
                      >
                        {att.file.name.split(".").pop()?.toUpperCase()}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                    style={{
                      position: "absolute",
                      top: -6,
                      right: -6,
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: "hsl(0 84% 60%)",
                      color: "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    <X size={10} />
                  </button>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input row */}
      <div id="tecfag-input-row" className="px-4 py-3 flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.txt,.csv,.xlsx"
          className="hidden"
          style={{ display: "none" }}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          id="tecfag-attach-btn"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-2 rounded-lg text-muted-foreground hover:text-accent-foreground hover:bg-accent transition-colors duration-200 flex-shrink-0"
          style={{ color: "hsl(215 16% 47%)" }}
        >
          <Paperclip size={18} />
        </button>

        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={isDragging ? "Solte as imagens aqui..." : "Escreva sua mensagem..."}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          style={{ color: "hsl(222 47% 6%)" }}
        />

        <button
          id="tecfag-send-btn"
          type="button"
          onClick={handleSend}
          disabled={!hasContent || disabled}
          className={`p-2 rounded-xl flex-shrink-0 transition-all duration-300 ${
            hasContent
              ? "bg-primary text-primary-foreground shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          }`}
          style={
            hasContent
              ? {
                  background: isBlackNovember
                    ? "linear-gradient(135deg, #09090b 0%, #27272a 100%)"
                    : "hsl(0 100% 27%)",
                  color: "white",
                  border: "none",
                  width: 36,
                  height: 36,
                  minWidth: 36,
                  minHeight: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }
              : {
                  background: "hsl(0 5% 90%)",
                  color: "hsl(0 0% 55%)",
                  border: "none",
                  width: 36,
                  height: 36,
                  minWidth: 36,
                  minHeight: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }
          }
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
};

export default ChatInput;
