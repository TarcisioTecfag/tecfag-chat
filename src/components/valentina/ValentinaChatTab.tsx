// ══════════════════════════════════════════════════════════════════════════════
// 💬 VALENTINA CHAT TAB — Redesign Premium com Avatares de Valentina e Operador
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Sparkles, AlertTriangle, Clock, Users, Award, ChevronDown, RefreshCw, X,
  FileText, FileSpreadsheet, File as FileIcon, Paperclip, Check, ZoomIn, Image as ImageIcon,
  History, PanelRightOpen, Bot, Building2, Globe, Database,
} from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { getAiPersona } from "@/lib/ai-persona";
import { ValentinaBlockRenderer } from "./chat-blocks/ValentinaBlockRenderer";
import { ValentinaThreadRail } from "./chat-blocks/ValentinaThreadRail";
import type {
  ValentinaChatMessage, ValentinaThread, ValentinaFolder,
} from "./chat-blocks/valentina-chat-types";

type KnowledgeBase = "valem" | "tecfag" | "all";

interface AttachedFile {
  name: string;
  mimeType: string;
  base64: string;
}

interface AttachedImage {
  name: string;
  dataUrl: string;
}

const ACCEPTED_FILE_TYPES = ".pdf,.txt,.doc,.docx,.xls,.xlsx";
const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/gif,image/webp,image/avif";

const BASE_OPTIONS: { value: KnowledgeBase; label: string; icon: React.ElementType; iconColor: string }[] = [
  { value: "valem",  label: "Valem",       icon: Building2, iconColor: "text-primary" },
  { value: "tecfag", label: "Tecfag",      icon: Bot,       iconColor: "text-blue-500" },
  { value: "all",    label: "Toda a Base", icon: Globe,     iconColor: "text-purple-500" },
];

const INITIAL_SUGGESTIONS = [
  { text: "Como está o tempo médio de atendimento (TMA) geral?", icon: Clock, iconColor: "text-primary" },
  { text: "Quem são os operadores com mais gargalo de fila?", icon: Users, iconColor: "text-blue-500" },
  { text: "Qual é a taxa de conversão do SDR de hoje?", icon: Award, iconColor: "text-amber-500" },
  { text: "Quantos alertas de estouro de SLA tivemos hoje?", icon: AlertTriangle, iconColor: "text-rose-500" },
];

const SECONDARY_SUGGESTIONS = [
  { text: "Gere um gráfico do funil de vendas desta semana", icon: Sparkles, iconColor: "text-primary" },
  { text: "Puxe um relatório detalhado por vendedor", icon: FileSpreadsheet, iconColor: "text-blue-500" },
  { text: "Quais objeções mais aparecem nas conversas dos leads?", icon: Bot, iconColor: "text-purple-500" },
  { text: "Quais são os 5 principais alertas da operação hoje?", icon: AlertTriangle, iconColor: "text-amber-500" },
];

/**
 * Avatar Oficial Padrão da Valentina (Renderiza a imagem oficial do sistema com fallback vetorizado)
 */
function ValentinaAvatar({ className = "h-8 w-8" }: { className?: string }) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div className={`relative flex items-center justify-center rounded-full bg-[#dcfce7] border border-[#bbf7d0] shrink-0 overflow-hidden shadow-xs ${className}`}>
        <svg className="h-full w-full p-1" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="18" cy="18" r="18" fill="#dcfce7" />
          <path d="M18 9C14.6863 9 12 11.6863 12 15C12 17.2 13.18 19.12 14.95 20.15C12.02 21.42 10 24.32 10 27.75C10 28.16 10.34 28.5 11.75 28.5C11.16 28.5 14.41 21.25 18 21.25C21.59 21.25 24.5 24.16 24.5 27.75C24.5 28.16 24.84 28.5 25.25 28.5C25.66 28.5 26 28.16 26 27.75C26 24.32 23.98 21.42 21.05 20.15C22.82 19.12 24 17.2 24 15C24 11.6863 21.3137 9 18 9Z" fill="#059669" />
          <circle cx="15" cy="16" r="1" fill="#047857" />
          <circle cx="21" cy="16" r="1" fill="#047857" />
          <circle cx="14" cy="17.5" r="1.2" fill="#f87171" opacity="0.7" />
          <circle cx="22" cy="17.5" r="1.2" fill="#f87171" opacity="0.7" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src="/valentina.png"
      alt="Valentina"
      onError={() => setHasError(true)}
      className={`rounded-full object-cover border border-[#bbf7d0] bg-[#dcfce7] shrink-0 ${className}`}
    />
  );
}

/**
 * Avatar do Operador / Usuário Logado nas Mensagens
 */
function OperatorAvatar({ name, avatar, className = "h-7 w-7" }: { name?: string; avatar?: string; className?: string }) {
  const [hasError, setHasError] = useState(false);
  const initials = name
    ? name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((n) => n[0])
        .join("")
        .toUpperCase()
    : "OP";

  if (avatar && !hasError) {
    return (
      <img
        src={avatar}
        alt={name || "Operador"}
        onError={() => setHasError(true)}
        className={`rounded-full object-cover border border-border/80 shrink-0 ${className}`}
      />
    );
  }

  return (
    <div
      className={`flex items-center justify-center rounded-full bg-primary/10 text-primary border border-primary/20 font-bold text-[10px] shrink-0 ${className}`}
    >
      {initials}
    </div>
  );
}

function FileTypeIcon({ mimeType, name }: { mimeType: string; name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mimeType.includes("pdf") || ext === "pdf")
    return <FileIcon className="h-4 w-4 text-rose-500 shrink-0" />;
  if (mimeType.includes("word") || ext === "doc" || ext === "docx")
    return <FileText className="h-4 w-4 text-blue-500 shrink-0" />;
  if (mimeType.includes("sheet") || mimeType.includes("excel") || ext === "xls" || ext === "xlsx")
    return <FileSpreadsheet className="h-4 w-4 text-emerald-600 shrink-0" />;
  return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />;
}

export function ValentinaChatTab() {
  const { operatorProfile, currentOperatorId, tenant } = useChat();
  const persona = getAiPersona(tenant);

  // Storage key por operador e tenant
  const storageKey = `valentina_threads_${tenant}_${currentOperatorId || "default"}`;

  // Estado de Threads e Pastas
  const [threads, setThreads] = useState<ValentinaThread[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [folders, setFolders] = useState<ValentinaFolder[]>(() => {
    try {
      const saved = localStorage.getItem(`${storageKey}_folders`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  // Barra Lateral Retrátil (Minimizada por padrão)
  const [isRailOpen, setIsRailOpen] = useState(false);

  // Sugestões ativas na tela inicial + Estado de Animação de Troca
  const [currentSuggestions, setCurrentSuggestions] = useState(INITIAL_SUGGESTIONS);
  const [suggestionsKey, setSuggestionsKey] = useState("set1");
  const [isRefreshingSuggestions, setIsRefreshingSuggestions] = useState(false);

  // Anexos e Input
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null);
  const [fullscreenSrc, setFullscreenSrc] = useState<string | null>(null);

  // Seletor de Base
  const [selectedBase, setSelectedBase] = useState<KnowledgeBase>(tenant as KnowledgeBase);
  const [showBaseDropdown, setShowBaseDropdown] = useState(false);
  const baseDropdownRef = useRef<HTMLDivElement>(null);

  // Refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const abortCtrl = useRef<AbortController | null>(null);

  const operatorFirstName = operatorProfile?.name?.split(" ")[0] || "Operador";

  // Persistir threads no localStorage
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(threads));
    } catch {}
  }, [threads, storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(`${storageKey}_folders`, JSON.stringify(folders));
    } catch {}
  }, [folders, storageKey]);

  // Sync seletor de base com o tenant ativo
  useEffect(() => {
    setSelectedBase(tenant as KnowledgeBase);
  }, [tenant]);

  // Fechar dropdown de base ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (baseDropdownRef.current && !baseDropdownRef.current.contains(e.target as Node)) {
        setShowBaseDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Auto-resize da textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 144)}px`;
  }, [input]);

  // Obter ou criar Thread ativo
  const activeThread = useMemo(() => {
    if (!activeThreadId) return null;
    return threads.find((t) => t.id === activeThreadId) || null;
  }, [threads, activeThreadId]);

  const activeMessages = activeThread?.messages || [];

  // Auto-scroll nas mensagens
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [activeMessages, isTyping]);

  // Manipulação de Threads
  const createNewThread = (folderId: string | null = null): string => {
    const newId = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newThread: ValentinaThread = {
      id: newId,
      title: "Nova conversa",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      folderId,
    };
    setThreads((prev) => [newThread, ...prev]);
    setActiveThreadId(newId);
    return newId;
  };

  const deleteThread = (id: string) => {
    setThreads((prev) => prev.filter((t) => t.id !== id));
    if (activeThreadId === id) setActiveThreadId(null);
  };

  const renameThread = (id: string, newTitle: string) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? { ...t, title: newTitle, updatedAt: Date.now() } : t))
    );
  };

  const moveThread = (id: string, folderId: string | null) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? { ...t, folderId, updatedAt: Date.now() } : t))
    );
  };

  const createFolder = (name: string) => {
    const newFolder: ValentinaFolder = {
      id: `folder_${Date.now()}`,
      name,
    };
    setFolders((prev) => [...prev, newFolder]);
  };

  const renameFolder = (folderId: string, newName: string) => {
    setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name: newName } : f)));
  };

  const deleteFolder = (folderId: string) => {
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    setThreads((prev) => prev.map((t) => (t.folderId === folderId ? { ...t, folderId: null } : t)));
  };

  // Tratar arquivos anexados
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const fullB64 = reader.result as string;
      const base64 = fullB64.split(",")[1] ?? fullB64;
      setAttachedFile({ name: file.name, mimeType: file.type || "application/octet-stream", base64 });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith("video/")) {
      alert("Vídeos não são suportados. Apenas imagens.");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setAttachedImage({ name: file.name, dataUrl: reader.result as string });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // Alternar sugestões com animação fluída de rotação e fade/scale
  const toggleSuggestions = () => {
    if (isRefreshingSuggestions) return;
    setIsRefreshingSuggestions(true);
    setTimeout(() => {
      setCurrentSuggestions((prev) =>
        prev === INITIAL_SUGGESTIONS ? SECONDARY_SUGGESTIONS : INITIAL_SUGGESTIONS
      );
      setSuggestionsKey((prev) => (prev === "set1" ? "set2" : "set1"));
      setIsRefreshingSuggestions(false);
    }, 200);
  };

  // Envio de mensagem
  const handleSendMessage = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text && !attachedFile && !attachedImage) return;

    let targetThreadId = activeThreadId;
    if (!targetThreadId) {
      targetThreadId = createNewThread();
    }

    const fileSnap = attachedFile;
    const imageSnap = attachedImage;

    const userMessageText = text || (fileSnap ? `📎 ${fileSnap.name}` : `🖼️ ${imageSnap?.name}`);

    const userMsg: ValentinaChatMessage = {
      id: `op-${Date.now()}`,
      sender: "operator",
      content: userMessageText,
      timestamp: new Date().toISOString(),
      attachedFileInfo: fileSnap ? { name: fileSnap.name, mimeType: fileSnap.mimeType } : undefined,
      attachedImageInfo: imageSnap ? { dataUrl: imageSnap.dataUrl, name: imageSnap.name } : undefined,
    };

    setThreads((prev) =>
      prev.map((t) => {
        if (t.id === targetThreadId) {
          const isFirst = t.messages.length === 0;
          const newTitle = isFirst ? (text.length > 32 ? `${text.slice(0, 32)}…` : text) : t.title;
          return {
            ...t,
            title: newTitle,
            updatedAt: Date.now(),
            messages: [...t.messages, userMsg],
          };
        }
        return t;
      })
    );

    setInput("");
    setAttachedFile(null);
    setAttachedImage(null);
    setIsTyping(true);

    abortCtrl.current?.abort();
    const ctrl = new AbortController();
    abortCtrl.current = ctrl;

    try {
      const res = await fetch("/api/valentina/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          tenantId: tenant,
          operatorId: currentOperatorId || "system",
          content: text || "[veja o arquivo/imagem anexada]",
          scope: "admin",
          knowledgeBase: selectedBase,
          ...(fileSnap ? { attachment: { name: fileSnap.name, mimeType: fileSnap.mimeType, base64: fileSnap.base64 } } : {}),
          ...(imageSnap ? { imageBase64: imageSnap.dataUrl } : {}),
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const fragments: any[] = data.fragments || [];

      for (let i = 0; i < fragments.length; i++) {
        if (i > 0) setIsTyping(true);
        await new Promise((r) => setTimeout(r, Math.max(fragments[i].delay ?? 600, 300)));

        const botMsg: ValentinaChatMessage = {
          id: fragments[i].id || `val-${Date.now()}-${i}`,
          sender: "valentina",
          content: fragments[i].content || fragments[i].text || "",
          timestamp: new Date().toISOString(),
          blocks: fragments[i].blocks || (fragments[i].content ? [{ type: "text", text: fragments[i].content }] : undefined),
        };

        setThreads((prev) =>
          prev.map((t) =>
            t.id === targetThreadId
              ? { ...t, updatedAt: Date.now(), messages: [...t.messages, botMsg] }
              : t
          )
        );
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      const errorMsg: ValentinaChatMessage = {
        id: `val-err-${Date.now()}`,
        sender: "valentina",
        content: "Ops, tive um problema para processar sua solicitação. Pode tentar novamente? 😅",
        timestamp: new Date().toISOString(),
        blocks: [{ type: "text", text: "Ops, tive um problema para processar sua solicitação. Pode tentar novamente? 😅" }],
      };

      setThreads((prev) =>
        prev.map((t) =>
          t.id === targetThreadId
            ? { ...t, updatedAt: Date.now(), messages: [...t.messages, errorMsg] }
            : t
        )
      );
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const selectedOpt = BASE_OPTIONS.find((o) => o.value === selectedBase) ?? BASE_OPTIONS[0];
  const BaseIcon = selectedOpt.icon;

  // ── Render da Barra de Input ──────────────────────────────────────────────
  const renderInputBar = (placeholder: string) => (
    <div className="flex flex-col rounded-2xl bg-card border border-border/80 shadow-soft focus-within:border-primary/60 transition-all duration-200">
      {/* Previews de Anexo */}
      {(attachedFile || attachedImage) && (
        <div className="flex flex-wrap items-center gap-2.5 px-4 pt-3 pb-1">
          {attachedFile && (
            <div className="flex items-center gap-2 bg-muted/70 border border-border/60 rounded-xl px-3 py-1.5">
              <FileTypeIcon mimeType={attachedFile.mimeType} name={attachedFile.name} />
              <span className="text-[11px] font-bold text-foreground max-w-[200px] truncate">
                {attachedFile.name}
              </span>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setAttachedFile(null)}
                className="grid h-4 w-4 place-items-center rounded-full hover:bg-rose-500/10 hover:text-rose-500 text-muted-foreground transition cursor-pointer"
              >
                <X className="h-3 w-3" />
              </motion.button>
            </div>
          )}
          {attachedImage && (
            <div className="relative group">
              <img
                src={attachedImage.dataUrl}
                alt={attachedImage.name}
                onClick={() => setFullscreenSrc(attachedImage.dataUrl)}
                className="h-16 w-24 object-cover rounded-xl border border-border cursor-zoom-in"
              />
              <div className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-colors pointer-events-none">
                <ZoomIn className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setAttachedImage(null)}
                className="absolute -top-1.5 -right-1.5 h-5 w-5 bg-background border border-border rounded-full grid place-items-center shadow-soft hover:text-rose-500 text-muted-foreground transition cursor-pointer z-10"
              >
                <X className="h-3 w-3" />
              </motion.button>
            </div>
          )}
        </div>
      )}

      {/* Linha Textarea + Seletor de Base (Abre para CIMA) */}
      <div className="flex items-start gap-2 px-4 pt-3">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="flex-1 bg-transparent text-xs sm:text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none leading-relaxed py-0.5"
          style={{ minHeight: "28px", maxHeight: "144px", overflowY: "auto" }}
        />

        {/* Seletor de Base de Conhecimento */}
        <div className="relative shrink-0" ref={baseDropdownRef}>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowBaseDropdown((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-muted/60 text-muted-foreground text-[11px] font-bold cursor-pointer hover:bg-muted hover:text-foreground transition-all whitespace-nowrap mt-0.5"
          >
            <BaseIcon className={`h-3.5 w-3.5 ${selectedOpt.iconColor}`} />
            <span>{selectedOpt.label}</span>
            <ChevronDown className={`h-3 w-3 transition-transform duration-150 ${showBaseDropdown ? "rotate-180" : ""}`} />
          </motion.button>

          <AnimatePresence>
            {showBaseDropdown && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="absolute right-0 bottom-full mb-2 z-50 min-w-[160px] rounded-2xl bg-card border border-border shadow-card py-1.5 overflow-hidden"
              >
                {BASE_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => { setSelectedBase(opt.value); setShowBaseDropdown(false); }}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-xs font-semibold hover:bg-muted/60 transition cursor-pointer"
                    >
                      <Icon className={`h-4 w-4 ${opt.iconColor}`} />
                      <span className="flex-1 text-left text-foreground">{opt.label}</span>
                      {selectedBase === opt.value && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Footer da Barra com Cores da Marca (text-primary) */}
      <div className="flex items-center justify-between px-4 pb-3 pt-2 border-t border-border/40">
        <div className="flex items-center gap-4">
          <input ref={fileInputRef} type="file" accept={ACCEPTED_FILE_TYPES} onChange={handleFileChange} className="hidden" />
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 text-xs font-bold text-primary hover:text-primary/80 transition cursor-pointer"
          >
            <Paperclip className="h-3.5 w-3.5" /> Anexar arquivo
          </motion.button>

          <input ref={imageInputRef} type="file" accept={ACCEPTED_IMAGE_TYPES} onChange={handleImageChange} className="hidden" />
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="flex items-center gap-1.5 text-xs font-bold text-primary hover:text-primary/80 transition cursor-pointer"
          >
            <ImageIcon className="h-3.5 w-3.5" /> Usar imagem
          </motion.button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">
            {input.length}/1000
          </span>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => handleSendMessage()}
            disabled={!input.trim() && !attachedFile && !attachedImage}
            className="grid h-8 w-8 place-items-center rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm cursor-pointer"
          >
            <Send className="h-4 w-4" />
          </motion.button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full w-full gap-3 overflow-hidden bg-background p-2">
      {/* Visualizador Fullscreen de Imagem */}
      {fullscreenSrc && (
        <div
          onClick={() => setFullscreenSrc(null)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-zoom-out"
        >
          <img src={fullscreenSrc} alt="Preview" className="max-h-[90vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl" />
        </div>
      )}

      {/* Coluna Central do Chat */}
      <div className="flex min-w-0 flex-1 flex-col h-full rounded-2xl border border-border/80 bg-card shadow-card overflow-hidden">
        {/* Header do Chat */}
        <header className="flex items-center justify-between border-b border-border/80 bg-card px-5 py-3 shrink-0">
          <div className="flex items-center gap-3">
            <ValentinaAvatar className="h-9 w-9" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-extrabold text-foreground">{persona.name}</h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Online
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Assistente de BI e análise de gestão em tempo real
              </p>
            </div>
          </div>

          {/* Botão de Histórico (se colapsado) */}
          {!isRailOpen && (
            <ValentinaThreadRail
              threads={threads}
              folders={folders}
              activeThreadId={activeThreadId}
              isOpen={false}
              onToggleOpen={() => setIsRailOpen(true)}
              onSelectThread={(id) => setActiveThreadId(id)}
              onNewThread={createNewThread}
              onDeleteThread={deleteThread}
              onRenameThread={renameThread}
              onMoveThread={moveThread}
              onCreateFolder={createFolder}
              onRenameFolder={renameFolder}
              onDeleteFolder={deleteFolder}
            />
          )}
        </header>

        {/* Conteúdo Principal do Chat */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 flex flex-col">
          <AnimatePresence mode="wait">
            {activeMessages.length === 0 ? (
              /* ESTADO 1: TELA DE BOAS-VINDAS (Centralizada, Fontes e Balões Ampliados) */
              <motion.div
                key="welcome-screen"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col items-center justify-center flex-1 h-full min-h-[460px] py-6 text-center max-w-3xl sm:max-w-4xl mx-auto my-auto w-full"
              >
                {/* Frase Inicial com Tipografia e Fontes de Destaque Maior */}
                <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight">
                  Olá, <span className="text-primary font-black">{operatorFirstName}</span>
                </h1>
                <h2 className="text-lg sm:text-xl font-bold text-foreground/90 mt-2">
                  O que você gostaria de saber hoje?
                </h2>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 max-w-lg">
                  Use uma das sugestões abaixo ou faça sua própria pergunta para iniciar
                </p>

                {/* Grid de Cards de Sugestões Ampliados com Transição Animada */}
                <div className="mt-8 w-full">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={suggestionsKey}
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      transition={{ duration: 0.2 }}
                      className="grid w-full gap-4 sm:gap-5 sm:grid-cols-2"
                    >
                      {currentSuggestions.map((sug, idx) => (
                        <motion.button
                          key={idx}
                          type="button"
                          whileHover={{ scale: 1.02, y: -2 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => handleSendMessage(sug.text)}
                          className="flex flex-col justify-between rounded-3xl border border-border/80 bg-card p-5 sm:p-6 text-left shadow-soft hover:border-primary/50 hover:shadow-card hover:bg-primary-soft/20 transition-all cursor-pointer group min-h-[120px] sm:min-h-[135px]"
                        >
                          <span className="text-xs sm:text-sm font-semibold text-foreground/95 leading-relaxed group-hover:text-primary transition-colors">
                            {sug.text}
                          </span>
                          <div className="mt-4 flex items-center justify-between">
                            <div className="grid h-8 w-8 place-items-center rounded-2xl bg-muted/60 group-hover:bg-primary-soft transition-colors">
                              <sug.icon className={`h-4.5 w-4.5 ${sug.iconColor}`} />
                            </div>
                          </div>
                        </motion.button>
                      ))}
                    </motion.div>
                  </AnimatePresence>
                </div>

                {/* Botão de Atualizar Sugestões com Animação de Rotação 360° no Ícone */}
                <motion.button
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  type="button"
                  onClick={toggleSuggestions}
                  className="mt-8 flex items-center gap-2 text-xs sm:text-sm font-bold text-muted-foreground hover:text-foreground transition cursor-pointer"
                >
                  <motion.div
                    animate={{ rotate: isRefreshingSuggestions ? 360 : 0 }}
                    transition={{ duration: 0.4, ease: "easeInOut" }}
                  >
                    <RefreshCw className="h-4 w-4 text-primary" />
                  </motion.div>
                  <span>Atualizar Sugestões</span>
                </motion.button>
              </motion.div>
            ) : (
              /* ESTADO 2: MENSAGENS DA CONVERSA */
              <motion.div
                key="conversation-screen"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="max-w-3xl mx-auto space-y-4 w-full"
              >
                {activeMessages.map((msg) =>
                  msg.sender === "operator" ? (
                    /* Mensagem do Usuário / Operador com Foto de Perfil */
                    <div key={msg.id} className="flex gap-3 justify-end items-start">
                      <div className="max-w-[80%] flex flex-col items-end">
                        <div className="flex items-baseline gap-2 mb-1 justify-end">
                          <span className="text-[10px] text-muted-foreground">{formatTime(msg.timestamp)}</span>
                          <span className="text-xs font-bold text-foreground">{operatorProfile?.name || "Você"}</span>
                        </div>
                        <div className="rounded-2xl rounded-tr-xs bg-primary px-4 py-2.5 text-xs sm:text-sm text-primary-foreground shadow-xs">
                          {msg.attachedImageInfo && (
                            <img
                              src={msg.attachedImageInfo.dataUrl}
                              alt=""
                              className="mb-2 max-h-48 rounded-xl object-cover border border-white/20"
                            />
                          )}
                          {msg.attachedFileInfo && (
                            <div className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-black/10 px-2.5 py-1 text-[11px] font-bold">
                              <Paperclip className="h-3 w-3" /> {msg.attachedFileInfo.name}
                            </div>
                          )}
                          <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                        </div>
                      </div>
                      <OperatorAvatar name={operatorProfile?.name} avatar={operatorProfile?.avatar} className="h-7 w-7 mt-0.5" />
                    </div>
                  ) : (
                    /* Mensagem da Valentina */
                    <div key={msg.id} className="flex gap-3 items-start">
                      <ValentinaAvatar className="h-7 w-7 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-xs font-bold text-foreground">{persona.name}</span>
                          <span className="text-[10px] text-muted-foreground">{formatTime(msg.timestamp)}</span>
                        </div>

                        <div className="rounded-2xl rounded-tl-xs bg-muted/40 border border-border/60 p-3.5 text-xs sm:text-sm text-foreground space-y-2">
                          {msg.content && <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>}
                          {msg.blocks?.map((block, bIdx) => (
                            <ValentinaBlockRenderer key={bIdx} block={block} />
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                )}

                {/* Indicador de Digitação da Valentina */}
                {isTyping && (
                  <div className="flex gap-3 items-center">
                    <ValentinaAvatar className="h-7 w-7" />
                    <div className="rounded-2xl bg-muted/40 border border-border/60 px-4 py-2.5 text-xs text-muted-foreground flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-primary animate-spin" />
                      <span>Analisando dados do sistema...</span>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer com Barra de Input */}
        <div className="p-3 bg-card border-t border-border/60 shrink-0">
          <div className="max-w-3xl mx-auto">
            {renderInputBar("Pergunte algo à Valentina sobre leads, métricas, relatórios ou conversas...")}
          </div>
        </div>
      </div>

      {/* Coluna Direita: ThreadRail Retrátil */}
      <AnimatePresence>
        {isRailOpen && (
          <motion.div
            initial={{ x: 280, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 280, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="h-full shrink-0"
          >
            <ValentinaThreadRail
              threads={threads}
              folders={folders}
              activeThreadId={activeThreadId}
              isOpen={true}
              onToggleOpen={() => setIsRailOpen(false)}
              onSelectThread={(id) => setActiveThreadId(id)}
              onNewThread={createNewThread}
              onDeleteThread={deleteThread}
              onRenameThread={renameThread}
              onMoveThread={moveThread}
              onCreateFolder={createFolder}
              onRenameFolder={renameFolder}
              onDeleteFolder={deleteFolder}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
