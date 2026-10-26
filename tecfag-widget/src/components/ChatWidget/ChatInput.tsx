import React, { useState, useRef, useEffect } from "react";
import { Send, Paperclip, X, FileText } from "lucide-react";

interface ChatInputProps {
  onSendMessage: (message: string, file?: File) => void;
  disabled?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSendMessage, disabled }) => {
  const [message, setMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((message.trim() || selectedFile) && !disabled) {
      onSendMessage(message.trim(), selectedFile || undefined);
      setMessage("");
      clearSelectedFile();
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      alert("O arquivo selecionado é muito grande. O limite máximo é de 15MB.");
      return;
    }

    setSelectedFile(file);

    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  };

  const clearSelectedFile = () => {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [message]);

  return (
    <div className="p-3 bg-white border-t border-slate-100 rounded-b-2xl">
      {selectedFile && (
        <div className="mb-2 p-2 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center gap-2.5 overflow-hidden">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Preview"
                className="w-10 h-10 object-cover rounded-lg border border-slate-200 flex-shrink-0"
              />
            ) : (
              <div className="w-10 h-10 bg-red-50 text-[#E50914] rounded-lg flex items-center justify-center flex-shrink-0 border border-red-100">
                <FileText className="w-5 h-5" />
              </div>
            )}
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-medium text-slate-700 truncate">
                {selectedFile.name}
              </span>
              <span className="text-[10px] text-slate-400">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={clearSelectedFile}
            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors ml-2 flex-shrink-0"
            title="Remover arquivo"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className={`flex items-end gap-2 bg-slate-50 p-1.5 rounded-2xl border transition-all duration-200 ${
          disabled
            ? "border-slate-100 opacity-60"
            : "border-slate-200/80 focus-within:border-[#E50914] focus-within:bg-white focus-within:shadow-sm"
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
          className="hidden"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="p-2.5 text-slate-400 hover:text-slate-600 transition-colors rounded-xl hover:bg-slate-200/50 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Anexar imagem ou PDF"
        >
          <Paperclip className="w-5 h-5" />
        </button>

        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Digite sua dúvida sobre equipamentos..."
          disabled={disabled}
          rows={1}
          className="w-full bg-transparent text-slate-800 placeholder-slate-400 text-[14px] resize-none focus:outline-none py-2 px-1 max-h-[120px] custom-scrollbar leading-relaxed"
        />

        <button
          type="submit"
          disabled={(!message.trim() && !selectedFile) || disabled}
          className={`p-2.5 rounded-xl flex items-center justify-center transition-all duration-200 flex-shrink-0 ${
            (message.trim() || selectedFile) && !disabled
              ? "text-white shadow-md hover:shadow-lg active:scale-95"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
          style={
            (message.trim() || selectedFile) && !disabled
              ? { background: "linear-gradient(135deg, #E50914 0%, #b8070f 100%)" }
              : undefined
          }
          aria-label="Enviar mensagem"
        >
          <Send className="w-4 h-4 ml-0.5" />
        </button>
      </form>
      <div className="text-center mt-2 flex items-center justify-center gap-1.5">
        <span className="text-[10px] font-medium text-slate-400 tracking-wide">
          Atendimento inteligente por <span className="font-bold text-slate-500">Tecfag IA</span>
        </span>
      </div>
    </div>
  );
};
