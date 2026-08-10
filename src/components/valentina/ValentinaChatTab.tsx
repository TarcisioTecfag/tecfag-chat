// ══════════════════════════════════════════════════════════════════════════════
// 💬 VALENTINA CHAT TAB — Chat interativo com a assistente IA (Valentina/Fagner)
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Sparkles, ArrowRight, AlertTriangle, Clock, Users, Award,
  ChevronDown, RefreshCw, X, FileText, FileSpreadsheet, File as FileIcon,
  Image as ImageIcon, Paperclip, Check, ZoomIn,
} from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { getAiPersona } from "@/lib/ai-persona";
import { ValentinaChatMessage, VALENTINA_WELCOME_MESSAGES } from "./valentina-mock-data";

// ── Types ─────────────────────────────────────────────────────────────────────

type KnowledgeBase = "valem" | "tecfag" | "all";

interface AttachedFile {
  name: string;
  mimeType: string;
  base64: string; // raw base64, sem prefixo data:...
}

interface AttachedImage {
  name: string;
  dataUrl: string; // data:image/...;base64,... (para preview)
}

type ChatMsg = ValentinaChatMessage & {
  attachedFileInfo?: { name: string; mimeType: string };
  attachedImageInfo?: { dataUrl: string; name: string };
};

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCEPTED_FILE_TYPES = ".pdf,.txt,.doc,.docx,.xls,.xlsx";
const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/gif,image/webp,image/avif";

const BASE_OPTIONS: { value: KnowledgeBase; label: string; emoji: string }[] = [
  { value: "valem",  label: "Valem",       emoji: "💜" },
  { value: "tecfag", label: "Tecfag",      emoji: "🤖" },
  { value: "all",    label: "Toda a Base", emoji: "🌍" },
];

const DEBOUNCE_SEC = 15;

// ── Helper Components ─────────────────────────────────────────────────────────

function FileTypeIcon({ mimeType, name }: { mimeType: string; name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mimeType.includes("pdf") || ext === "pdf")
    return <FileIcon className="h-4 w-4 text-red-500 shrink-0" />;
  if (mimeType.includes("word") || ext === "doc" || ext === "docx")
    return <FileText className="h-4 w-4 text-blue-500 shrink-0" />;
  if (mimeType.includes("sheet") || mimeType.includes("excel") || ext === "xls" || ext === "xlsx")
    return <FileSpreadsheet className="h-4 w-4 text-green-600 shrink-0" />;
  return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function LeadCard({ data }: { data: Record<string, any> }) {
  return (
    <div className="mt-2 rounded-xl border border-primary/20 bg-primary-soft p-3 text-xs">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="font-extrabold text-primary">Lead Qualificado</span>
      </div>
      <div className="space-y-1 text-foreground/80">
        <p><span className="font-semibold">Nome:</span> {data.name || "—"}</p>
        <p><span className="font-semibold">Empresa:</span> {data.company || "—"}</p>
        <p><span className="font-semibold">Score:</span> {data.score || "—"}/100</p>
      </div>
      <button className="mt-2 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90 transition cursor-pointer">
        <ArrowRight className="h-3 w-3" />
        Ver Detalhes
      </button>
    </div>
  );
}

function SlaAlertCard({ data }: { data: Record<string, any> }) {
  return (
    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs">
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
        <span className="font-extrabold text-amber-700">Alerta SLA</span>
      </div>
      <p className="text-amber-900/80">{data.description || "SLA em risco."}</p>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ValentinaChatTab() {
  const { operatorProfile, currentOperatorId, tenant } = useChat();
  const persona = getAiPersona(tenant);

  const [messages, setMessages]         = useState<ChatMsg[]>([]);
  const [input, setInput]               = useState("");
  const [isTyping, setIsTyping]         = useState(false);
  const [waitSecondsLeft, setWaitSecondsLeft] = useState<number | null>(null);

  // Attachments
  const [attachedFile, setAttachedFile]   = useState<AttachedFile | null>(null);
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null);
  const [fullscreenSrc, setFullscreenSrc] = useState<string | null>(null);

  // Base selector
  const [selectedBase, setSelectedBase]         = useState<KnowledgeBase>(tenant as KnowledgeBase);
  const [showBaseDropdown, setShowBaseDropdown] = useState(false);
  const baseDropdownRef = useRef<HTMLDivElement>(null);

  // Refs
  const scrollRef    = useRef<HTMLDivElement>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const abortCtrl    = useRef<AbortController | null>(null);
  const pendingMsgs  = useRef<string[]>([]);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const operatorFirstName = operatorProfile?.name?.split(" ")[0] || "Operador";
  const operatorInitial   = operatorFirstName[0]?.toUpperCase() || "O";

  const suggestions = [
    { text: "Como está o tempo médio de atendimento (TMA) geral?", icon: Clock, iconColor: "text-primary" },
    { text: "Quem são os operadores com mais gargalo de fila?", icon: Users, iconColor: "text-blue-500" },
    { text: "Qual é a taxa de conversão do SDR de hoje?", icon: Award, iconColor: "text-amber-500" },
    { text: "Quantos alertas de estouro de SLA tivemos hoje?", icon: AlertTriangle, iconColor: "text-red-500" },
  ];

  // ── Sync base com tenant ────────────────────────────────────────────────────
  useEffect(() => { setSelectedBase(tenant as KnowledgeBase); }, [tenant]);

  // ── Fechar dropdown ao clicar fora ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (baseDropdownRef.current && !baseDropdownRef.current.contains(e.target as Node)) {
        setShowBaseDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Auto-resize textarea ────────────────────────────────────────────────────
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 144) + "px";
  }, [input]);

  // ── Carregar histórico ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentOperatorId) return;
    (async () => {
      try {
        const res = await fetch(`/api/valentina/messages?tenantId=${tenant}&operatorId=${currentOperatorId}&scope=admin`);
        if (!res.ok) throw new Error("fetch failed");
        const rows: any[] = await res.json();
        if (rows.length > 0) {
          setMessages(rows.map((r): ChatMsg => ({
            id: r.id,
            sender: r.direction === "to_agent" ? "operator" : "valentina",
            content: r.content,
            timestamp: r.createdAt || new Date().toISOString(),
            type: (r.metadata?.type as any) || "text",
            cardData: r.metadata?.cardData,
            attachedFileInfo: r.metadata?.attachedFileInfo,
            attachedImageInfo: r.metadata?.attachedImageInfo,
          })));
        } else {
          setMessages([...VALENTINA_WELCOME_MESSAGES] as ChatMsg[]);
        }
      } catch {
        setMessages([...VALENTINA_WELCOME_MESSAGES] as ChatMsg[]);
      }
    })();
  }, [currentOperatorId, tenant]);

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping]);

  // ── Leitura de arquivo ──────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      // Remove prefixo data:...;base64,
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

  // ── Flush para a IA ─────────────────────────────────────────────────────────
  const flushToAI = async (
    batch: string[],
    file: AttachedFile | null,
    image: AttachedImage | null,
  ) => {
    abortCtrl.current?.abort();
    const ctrl = new AbortController();
    abortCtrl.current = ctrl;
    setIsTyping(true);
    setWaitSecondsLeft(null);

    try {
      const res = await fetch("/api/valentina/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          tenantId: tenant,
          operatorId: currentOperatorId || "system",
          content: batch.join("\n"),
          scope: "admin",
          knowledgeBase: selectedBase,
          ...(file ? { attachment: { name: file.name, mimeType: file.mimeType, base64: file.base64 } } : {}),
          ...(image ? { imageBase64: image.dataUrl } : {}),
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const fragments: any[] = data.fragments || [];

      for (let i = 0; i < fragments.length; i++) {
        if (i > 0) setIsTyping(true);
        await new Promise((r) => setTimeout(r, Math.max(fragments[i].delay ?? i * 800, 400)));
        setMessages((prev) => [...prev, {
          id: fragments[i].id || `val-${Date.now()}-${i}`,
          sender: "valentina",
          content: fragments[i].content || fragments[i].text || "",
          timestamp: new Date().toISOString(),
          type: "text",
        } as ChatMsg]);
      }

      for (const alert of data.alerts || []) {
        setMessages((prev) => [...prev, {
          id: `val-alert-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          sender: "valentina",
          content: `${alert.clientName || "Cliente"} está aguardando há ${alert.waitMinutes || "?"} minutos`,
          timestamp: new Date().toISOString(),
          type: "sla_card",
          cardData: { description: `${alert.clientName || "Cliente"} aguardando há ${alert.waitMinutes || "?"} minutos. ${alert.lastMessage || ""}` },
        } as ChatMsg]);
      }

      if (fragments.length === 0 && (data.alerts || []).length === 0) throw new Error("Sem resposta");
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setMessages((prev) => [...prev, {
        id: `val-err-${Date.now()}`,
        sender: "valentina",
        content: "Ops, tive um problema pra processar. Pode tentar de novo? 😅",
        timestamp: new Date().toISOString(),
        type: "text",
      } as ChatMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  // ── Enviar mensagem ─────────────────────────────────────────────────────────
  const triggerSend = (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text && !attachedFile && !attachedImage) return;

    if (isTyping) { abortCtrl.current?.abort(); setIsTyping(false); }

    const fileSnap  = attachedFile;
    const imageSnap = attachedImage;

    // Texto visível na bolha
    const displayText = text || (fileSnap ? `📎 ${fileSnap.name}` : `🖼️ ${imageSnap?.name}`);

    setMessages((prev) => [...prev, {
      id: `op-${Date.now()}`,
      sender: "operator",
      content: displayText,
      timestamp: new Date().toISOString(),
      type: "text",
      attachedFileInfo: fileSnap ? { name: fileSnap.name, mimeType: fileSnap.mimeType } : undefined,
      attachedImageInfo: imageSnap ? { dataUrl: imageSnap.dataUrl, name: imageSnap.name } : undefined,
    } as ChatMsg]);

    setInput("");
    setAttachedFile(null);
    setAttachedImage(null);

    // Attachment → envia imediatamente (sem debounce)
    if (fileSnap || imageSnap) {
      if (debounceRef.current)  clearTimeout(debounceRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      pendingMsgs.current = [];
      setWaitSecondsLeft(null);
      flushToAI(text ? [text] : ["[veja o arquivo/imagem anexada]"], fileSnap, imageSnap);
      return;
    }

    // Só texto → debounce 15s
    pendingMsgs.current.push(text);
    if (debounceRef.current)  clearTimeout(debounceRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    let remaining = DEBOUNCE_SEC;
    setWaitSecondsLeft(remaining);
    countdownRef.current = setInterval(() => {
      remaining -= 1;
      setWaitSecondsLeft(remaining > 0 ? remaining : null);
      if (remaining <= 0 && countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    }, 1000);

    debounceRef.current = setTimeout(() => {
      const batch = [...pendingMsgs.current];
      pendingMsgs.current = [];
      setWaitSecondsLeft(null);
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      flushToAI(batch, null, null);
    }, DEBOUNCE_SEC * 1000);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); triggerSend(); }
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const hasChatted  = messages.some((m) => m.sender === "operator");
  const selectedOpt = BASE_OPTIONS.find((o) => o.value === selectedBase) ?? BASE_OPTIONS[2];

  // ── Barra de Input (render function, não componente) ──────────────────────
  const renderInputBar = (placeholder: string) => (
    <div className="flex flex-col rounded-2xl bg-card border border-border shadow-soft focus-within:border-primary/60 transition-colors duration-150">

      {/* Previews de anexo */}
      {(attachedFile || attachedImage) && (
        <div className="flex flex-wrap items-center gap-2.5 px-4 pt-3 pb-1">
          {attachedFile && (
            <div className="flex items-center gap-2 bg-muted/60 border border-border/60 rounded-xl px-2.5 py-1.5">
              <FileTypeIcon mimeType={attachedFile.mimeType} name={attachedFile.name} />
              <span className="text-[11px] font-semibold text-foreground max-w-[180px] truncate">
                {attachedFile.name}
              </span>
              <button
                onClick={() => setAttachedFile(null)}
                className="grid h-4 w-4 place-items-center rounded-full hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition cursor-pointer"
              >
                <X className="h-2.5 w-2.5" />
              </button>
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
              <button
                onClick={() => setAttachedImage(null)}
                className="absolute -top-1.5 -right-1.5 h-5 w-5 bg-background border border-border rounded-full grid place-items-center shadow-soft hover:text-destructive text-muted-foreground transition cursor-pointer z-10"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Linha da textarea + seletor de base */}
      <div className="flex items-start gap-2 px-4 pt-3">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none resize-none leading-relaxed py-0.5"
          style={{ minHeight: "24px", maxHeight: "144px", overflowY: "auto" }}
        />

        {/* Seletor de base */}
        <div className="relative shrink-0" ref={baseDropdownRef}>
          <button
            onClick={() => setShowBaseDropdown((v) => !v)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-muted text-muted-foreground text-[10px] font-bold cursor-pointer hover:bg-muted/80 transition-colors whitespace-nowrap mt-0.5"
          >
            <span>{selectedOpt.emoji}</span>
            <span>{selectedOpt.label}</span>
            <ChevronDown className={`h-2.5 w-2.5 transition-transform duration-150 ${showBaseDropdown ? "rotate-180" : ""}`} />
          </button>

          <AnimatePresence>
            {showBaseDropdown && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.95 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 top-full mt-1.5 z-50 min-w-[148px] rounded-xl bg-card border border-border shadow-card py-1.5 overflow-hidden"
              >
                {BASE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setSelectedBase(opt.value); setShowBaseDropdown(false); }}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[11px] font-semibold hover:bg-muted/60 transition cursor-pointer"
                  >
                    <span>{opt.emoji}</span>
                    <span className="flex-1 text-left text-foreground">{opt.label}</span>
                    {selectedBase === opt.value && <Check className="h-3 w-3 text-primary shrink-0" />}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Rodapé de ações */}
      <div className="flex items-center justify-between px-4 pt-2 pb-3 mt-1 border-t border-line">
        <div className="flex items-center gap-0.5">
          <input ref={fileInputRef} type="file" accept={ACCEPTED_FILE_TYPES} className="hidden" onChange={handleFileChange} />
          <input ref={imageInputRef} type="file" accept={ACCEPTED_IMAGE_TYPES} className="hidden" onChange={handleImageChange} />

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          >
            <Paperclip className="h-3.5 w-3.5 text-primary" />
            Anexar arquivo
          </button>

          <button
            onClick={() => imageInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          >
            <ImageIcon className="h-3.5 w-3.5 text-primary" />
            Usar imagem
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] font-medium text-muted-foreground/60">{input.length}/1000</span>
          <button
            onClick={() => triggerSend()}
            disabled={(!input.trim() && !attachedFile && !attachedImage) || isTyping}
            className={`grid h-8 w-8 place-items-center rounded-xl transition-all cursor-pointer ${
              (input.trim() || attachedFile || attachedImage) && !isTyping
                ? "bg-primary text-primary-foreground hover:opacity-90 shadow-soft active:scale-95"
                : "bg-muted text-muted-foreground cursor-not-allowed opacity-50"
            }`}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );

  // ── Tela inicial (sem mensagem do operador ainda) ──────────────────────────
  if (!hasChatted) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 px-4 py-8 overflow-y-auto scrollbar-thin select-none">
        <motion.div
          variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.1 } } }}
          initial="hidden"
          animate="visible"
          className="text-center max-w-2xl w-full flex flex-col items-center"
        >
          <motion.div variants={{ hidden: { opacity: 0, y: 15 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35 } } }}>
            <h2 className="text-3xl font-extrabold text-foreground leading-tight">
              Olá, <span className="text-primary">{operatorFirstName}</span>
            </h2>
            <h3 className="text-2xl font-bold text-foreground/80 mt-1">
              O que você gostaria de saber hoje?
            </h3>
            <p className="text-xs text-muted-foreground mt-3">
              Use uma das sugestões abaixo ou faça sua própria pergunta para iniciar
            </p>
          </motion.div>

          <motion.div
            variants={{ hidden: { opacity: 0, y: 15 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35 } } }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-8 w-full"
          >
            {suggestions.map((sug, idx) => {
              const SugIcon = sug.icon;
              return (
                <motion.button
                  key={idx}
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => triggerSend(sug.text)}
                  className="flex flex-col justify-between items-start text-left p-4 rounded-2xl border border-border bg-card hover:bg-muted/40 hover:border-primary/30 transition-colors duration-150 cursor-pointer shadow-soft group min-h-[120px]"
                >
                  <span className="text-xs font-semibold text-foreground leading-snug group-hover:text-primary transition-colors">
                    {sug.text}
                  </span>
                  <div className="mt-4 p-2 rounded-xl bg-muted group-hover:bg-primary-soft transition-colors">
                    <SugIcon className={`h-4 w-4 ${sug.iconColor}`} />
                  </div>
                </motion.button>
              );
            })}
          </motion.div>

          <motion.button
            variants={{ hidden: { opacity: 0, y: 15 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35 } } }}
            whileHover={{ scale: 1.05 }}
            className="mt-4 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition cursor-pointer"
          >
            <RefreshCw className="h-3 w-3" />
            Atualizar Sugestões
          </motion.button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.5 }}
          className="mt-12 w-full max-w-2xl"
        >
          {renderInputBar("Pergunte o que quiser...")}
        </motion.div>
      </div>
    );
  }

  // ── Tela de chat ativo ─────────────────────────────────────────────────────
  return (
    <>
      {/* Modal fullscreen de imagem */}
      {fullscreenSrc && createPortal(
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[600] flex items-center justify-center bg-background/80 backdrop-blur-md"
          onClick={() => setFullscreenSrc(null)}
        >
          <button
            onClick={() => setFullscreenSrc(null)}
            className="absolute top-5 right-5 grid h-10 w-10 place-items-center rounded-2xl bg-card border border-border shadow-card text-foreground hover:bg-muted transition cursor-pointer z-10"
          >
            <X className="h-5 w-5" />
          </button>
          <motion.img
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            src={fullscreenSrc}
            alt="Imagem ampliada"
            className="max-h-[88vh] max-w-[88vw] rounded-2xl shadow-card object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </motion.div>,
        document.body,
      )}

      <div className="flex flex-col h-full overflow-hidden">
        {/* Área de mensagens */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8 scrollbar-thin bg-chat-panel">
          <div className="max-w-2xl mx-auto w-full space-y-5">
            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                  className={`flex gap-3 items-end ${m.sender === "operator" ? "justify-end" : "justify-start"}`}
                >
                  {/* Avatar da IA */}
                  {m.sender === "valentina" && (
                    <img
                      src="/valentina.png"
                      alt={persona.name}
                      className="h-8 w-8 rounded-full object-cover border border-border shrink-0 shadow-soft mb-0.5"
                    />
                  )}

                  {/* Conteúdo da mensagem */}
                  <div className={`flex flex-col max-w-[75%] ${m.sender === "operator" ? "items-end" : "items-start"}`}>
                    {m.sender === "valentina" ? (
                      <div className="bg-card border border-border/70 rounded-2xl rounded-tl-[4px] px-4 py-3 shadow-soft text-xs text-foreground leading-relaxed">
                        {m.content}
                        {m.type === "lead_card" && m.cardData && <LeadCard data={m.cardData} />}
                        {m.type === "sla_card" && m.cardData && <SlaAlertCard data={m.cardData} />}
                      </div>
                    ) : (
                      <div className="flex flex-col items-end gap-1.5">
                        {/* Preview de imagem na bolha */}
                        {m.attachedImageInfo && (
                          <div className="relative group cursor-zoom-in" onClick={() => setFullscreenSrc(m.attachedImageInfo!.dataUrl)}>
                            <img
                              src={m.attachedImageInfo.dataUrl}
                              alt={m.attachedImageInfo.name}
                              className="max-h-48 max-w-[260px] rounded-2xl border border-border shadow-soft object-cover"
                            />
                            <div className="absolute inset-0 rounded-2xl bg-black/0 group-hover:bg-black/25 flex items-center justify-center transition-colors">
                              <ZoomIn className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </div>
                        )}
                        {/* Preview de arquivo na bolha */}
                        {m.attachedFileInfo && (
                          <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-xl px-3 py-2">
                            <FileTypeIcon mimeType={m.attachedFileInfo.mimeType} name={m.attachedFileInfo.name} />
                            <span className="text-[11px] font-semibold text-primary max-w-[200px] truncate">
                              {m.attachedFileInfo.name}
                            </span>
                          </div>
                        )}
                        {/* Texto da bolha */}
                        {m.content && !m.content.startsWith("📎") && !m.content.startsWith("🖼️") && (
                          <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-[4px] px-4 py-3 shadow-soft text-xs leading-relaxed">
                            {m.content}
                          </div>
                        )}
                        {/* Caso só tenha attachment (sem texto digitado) */}
                        {(m.content.startsWith("📎") || m.content.startsWith("🖼️")) && !m.attachedFileInfo && !m.attachedImageInfo && (
                          <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-[4px] px-4 py-3 shadow-soft text-xs leading-relaxed">
                            {m.content}
                          </div>
                        )}
                      </div>
                    )}

                    <span className={`text-[9px] text-muted-foreground/50 font-semibold mt-1.5 ${m.sender === "operator" ? "pr-0.5" : "pl-0.5"}`}>
                      {formatTime(m.timestamp)}
                    </span>
                  </div>

                  {/* Avatar do operador */}
                  {m.sender === "operator" && (
                    operatorProfile?.avatar ? (
                      <img
                        src={operatorProfile.avatar}
                        alt={operatorFirstName}
                        className="h-8 w-8 rounded-full object-cover border border-border shrink-0 shadow-soft mb-0.5"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-primary/15 text-primary text-xs font-extrabold flex items-center justify-center shrink-0 shadow-soft mb-0.5 border border-primary/20">
                        {operatorInitial}
                      </div>
                    )
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Indicador: IA digitando */}
            <AnimatePresence>
              {isTyping && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex gap-3 items-end"
                >
                  <img src="/valentina.png" alt={persona.name} className="h-8 w-8 rounded-full object-cover border border-border shrink-0 shadow-soft mb-0.5" />
                  <div className="bg-card border border-border/70 rounded-2xl rounded-tl-[4px] px-4 py-3 shadow-soft text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      {persona.name} está digitando
                      <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }}>
                        ...
                      </motion.span>
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Indicador: aguardando debounce */}
            <AnimatePresence>
              {waitSecondsLeft !== null && !isTyping && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="flex gap-3 items-center"
                >
                  <img src="/valentina.png" alt={persona.name} className="h-8 w-8 rounded-full object-cover border border-border shrink-0 shadow-soft opacity-60" />
                  <div className="flex items-center gap-2 rounded-2xl rounded-tl-[4px] bg-card border border-border/70 px-4 py-2.5 text-xs text-muted-foreground shadow-soft">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}>
                      <Clock className="h-3 w-3 text-primary" />
                    </motion.div>
                    <span>
                      {persona.name} aguardando mais mensagens
                      <span className="font-black text-primary ml-1">{waitSecondsLeft}s</span>
                      <span className="text-[10px] ml-1 text-muted-foreground/60">— envie mais ou aguarde</span>
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Input no rodapé */}
        <div className="shrink-0 px-6 pb-5 pt-3 bg-card border-t border-line">
          <div className="max-w-2xl mx-auto w-full">
            {renderInputBar(`Pergunte algo à ${persona.name}...`)}
          </div>
        </div>
      </div>
    </>
  );
}
