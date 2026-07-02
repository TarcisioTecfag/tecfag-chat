import React, { useState, useRef, useEffect, useCallback } from "react";
import { useChat } from "@/hooks/useChatState";
import { WhatsappLogo, InstagramLogo, MessengerLogo } from "./ChatList";
import { EmojiPicker } from "./EmojiPicker";
import {
  Smile,
  Paperclip,
  Send,
  Lock,
  UserPlus,
  CheckCircle,
  Zap,
  Clock,
  ArrowRightLeft,
  ChevronDown,
  ChevronLeft,
  FileText,
  Download,
  X,
  Image,
  Film,
  Music,
  File,
  Search,
  Mic,
  Square,
  Trash2,
  CornerUpLeft,
} from "lucide-react";


const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

// ── Player de áudio customizado ────────────────────────────────────────────
function AudioBubble({ src, fileName }: { src: string; fileName: string }) {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [current, setCurrent] = React.useState(0);
  const [duration, setDuration] = React.useState(0);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play(); setPlaying(true); }
  };

  const fmt = (s: number) => {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const pct = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-card border border-border shadow-soft px-4 py-3 min-w-[260px] max-w-xs">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={() => setCurrent(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
      />
      {/* Play / Pause */}
      <button
        onClick={toggle}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-soft hover:opacity-90 transition"
      >
        {playing ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-1.5 min-w-0">
        {/* Nome do arquivo */}
        <p className="truncate text-[11px] font-semibold text-foreground leading-none">{fileName}</p>

        {/* Barra de progresso */}
        <div className="relative h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all duration-100"
            style={{ width: `${pct}%` }}
          />
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={current}
            onChange={(e) => {
              const v = Number(e.target.value);
              setCurrent(v);
              if (audioRef.current) audioRef.current.currentTime = v;
            }}
            className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
          />
        </div>

        {/* Tempo */}
        <div className="flex justify-between text-[10px] text-muted-foreground font-medium">
          <span>{fmt(current)}</span>
          <span>{fmt(duration)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Card de documento ──────────────────────────────────────────────────────
function DocumentCard({ src, fileName }: { src: string; fileName: string }) {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const isExcel = ["xls", "xlsx", "csv"].includes(ext);
  const isWord  = ["doc", "docx"].includes(ext);
  const isPdf   = ext === "pdf";
  const isPpt   = ["ppt", "pptx"].includes(ext);

  const iconBg    = isPdf ? "bg-red-100 text-red-500"
    : isExcel     ? "bg-emerald-100 text-emerald-600"
    : isWord      ? "bg-blue-100 text-blue-600"
    : isPpt       ? "bg-orange-100 text-orange-500"
    :               "bg-muted text-muted-foreground";

  const typeLabel = isPdf ? "PDF"
    : isExcel     ? "Planilha"
    : isWord      ? "Word"
    : isPpt       ? "Apresentação"
    :               "Documento";

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-card border border-border shadow-soft px-4 py-3 min-w-[240px] max-w-xs">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${iconBg}`}>
        <FileText className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="truncate text-xs font-bold text-foreground">{fileName}</p>
        <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wide mt-0.5">{typeLabel}</p>
      </div>
      <a
        href={src}
        download={fileName}
        onClick={(e) => e.stopPropagation()}
        title="Baixar"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary hover:bg-primary/20 transition border border-primary/20"
      >
        <Download className="h-4 w-4" />
      </a>
    </div>
  );
}

function renderMessageContent(text: string) {
  // ── Preview local de mídia enviada (objectURL temporário) ─────────────────
  if (text.startsWith("[LOCAL_MEDIA:")) {
    // Formato: [LOCAL_MEDIA:type:blobUrl:filename]
    // blobUrl pode conter ':', então capturamos filename do final
    const rest = text.slice("[LOCAL_MEDIA:".length);
    const typeEnd = rest.indexOf(":");
    const type = rest.slice(0, typeEnd);
    const afterType = rest.slice(typeEnd + 1);
    // filename é tudo após o último ':', sem o ']' de fechamento
    const lastColon = afterType.lastIndexOf(":");
    const blobUrl = afterType.slice(0, lastColon);
    const fileName = afterType.slice(lastColon + 1).replace(/\]$/, "");

    if (type === "image") {
      return (
        <div className="relative group max-w-sm rounded-xl overflow-hidden cursor-pointer" onClick={() => window.open(blobUrl, "_blank")}>
          <img src={blobUrl} alt={fileName} className="max-h-60 w-full object-contain rounded-xl" />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition rounded-xl" />
        </div>
      );
    }

    if (type === "video") {
      return (
        <div className="max-w-sm rounded-xl overflow-hidden">
          <video controls src={blobUrl} className="max-h-60 w-full rounded-xl" />
        </div>
      );
    }

    if (type === "audio") {
      return <AudioBubble src={blobUrl} fileName={fileName} />;
    }

    // document
    return <DocumentCard src={blobUrl} fileName={fileName} />;
  }

  if (text.startsWith("[MEDIA:")) {
    const match = text.match(/^\[MEDIA:(image|video|audio|document|sticker)\]([^:]+)(?::(.+))?$/);
    if (match) {
      const [, type, messageId, extra] = match;
      const mediaUrl = `${BACKEND_URL}/api/baileys/media?messageId=${messageId}`;

      if (type === "image") {
        return (
          <div className="relative group max-w-sm rounded-xl overflow-hidden border border-border bg-black/5 hover:opacity-95 transition cursor-pointer">
            <img 
              src={mediaUrl} 
              alt="Imagem" 
              className="max-h-60 w-full object-contain"
              onClick={() => window.open(mediaUrl, "_blank")}
            />
          </div>
        );
      }

      if (type === "video") {
        return (
          <div className="relative max-w-sm rounded-xl overflow-hidden border border-border bg-black/5">
            <video 
              controls 
              src={mediaUrl} 
              className="max-h-60 w-full object-contain"
            />
          </div>
        );
      }

      if (type === "audio") {
        return <AudioBubble src={mediaUrl} fileName="Áudio" />;
      }

      if (type === "document") {
        const fileName = extra || "documento";
        return <DocumentCard src={mediaUrl} fileName={fileName} />;
      }

      if (type === "sticker") {
        return (
          <div className="relative max-w-[120px] overflow-hidden">
            <img 
              src={mediaUrl} 
              alt="Figurinha" 
              className="h-28 w-28 object-contain"
            />
          </div>
        );
      }
    }
  }

  // Fallback para texto plano
  return <p className="whitespace-pre-wrap">{text}</p>;
}

/** Detecta se o texto contém apenas emojis (inclui modificadores e ZWJ sequences) */
function isEmojiOnly(text: string): boolean {
  const stripped = text.replace(/[\u200D\uFE0F\u20E3]/g, "").trim();
  if (!stripped) return false;
  // Regex que cobre emoji base + modificadores
  const emojiRegex = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|[\u{1F1E0}-\u{1F1FF}]|\u{1F3FB}-\u{1F3FF}|\u{1F466}-\u{1F469})+$/u;
  return emojiRegex.test(stripped);
}

export function ChatPanel() {
  const {
    activeChat,
    sendMessage,
    captureChat,
    transferChat,
    finishChat,
    rightSidebarOpen,
    setRightSidebarOpen,
    tenant,
    sectors,
    operators,
    quickResponses,
  } = useChat();

  const [text, setText] = useState("");
  const [replyingTo, setReplyingTo] = useState<any>(null);

  useEffect(() => {
    setReplyingTo(null);
  }, [selectedChatId]);

  const [msgMode, setMsgMode] = useState<"client" | "internal">("client");
  const [showQuickMenu, setShowQuickMenu] = useState(false);
  const [showTransferDropdown, setShowTransferDropdown] = useState(false);
  const [selectedTransferSectorId, setSelectedTransferSectorId] = useState<string | null>(null);

  const closeTransferDropdown = () => {
    setShowTransferDropdown(false);
    setSelectedTransferSectorId(null);
  };
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [msgSearch, setMsgSearch] = useState("");
  const [showMsgSearch, setShowMsgSearch] = useState(false);

  // ── Voice recorder state ────────────────────────────────────────────────────
  const [recordingState, setRecordingState] = React.useState<"idle" | "recording" | "preview">("idle");
  const [audioBlob, setAudioBlob] = React.useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = React.useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = React.useState(0);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  // ── Voice recorder logic ────────────────────────────────────────────────────
  const fmtSec = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioUrl(url);
        setRecordingState("preview");
      };
      mediaRecorderRef.current = mr;
      setRecordingSeconds(0);
      setRecordingState("recording");
      mr.start();
      timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch {
      alert("Não foi possível acessar o microfone. Verifique as permissões do navegador.");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const discardRecording = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingSeconds(0);
    setRecordingState("idle");
  };

  // Auto scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.messages]);

  // ── Drag & Drop ────────────────────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!composerRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) setAttachments((prev) => [...prev, ...files]);
  }, []);

  // ── Ctrl+V para colar arquivos da área de transferência ───────────────────
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items || []);
      const files = items
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter(Boolean) as File[];
      if (files.length > 0) {
        e.preventDefault();
        setAttachments((prev) => [...prev, ...files]);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith("image/")) return <Image className="h-4 w-4" />;
    if (file.type.startsWith("video/")) return <Film className="h-4 w-4" />;
    if (file.type.startsWith("audio/")) return <Music className="h-4 w-4" />;
    return <File className="h-4 w-4" />;
  };

  const getFileColor = (file: File) => {
    if (file.type.startsWith("image/")) return "bg-blue-100 text-blue-600";
    if (file.type.startsWith("video/")) return "bg-purple-100 text-purple-600";
    if (file.type.startsWith("audio/")) return "bg-green-100 text-green-600";
    return "bg-red-100 text-red-600";
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  // Auto scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.messages]);

  if (!activeChat) {
    return (
      <section className="flex h-full min-w-0 flex-1 flex-col items-center justify-center rounded-3xl bg-chat-panel border border-border shadow-soft text-muted-foreground select-none">
        <div className="text-center max-w-sm p-6">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-muted mx-auto mb-4">
            <Zap className="h-8 w-8 text-muted-foreground/30 animate-pulse" />
          </div>
          <h3 className="text-lg font-bold text-foreground">Nenhum Atendimento Ativo</h3>
          <p className="text-sm mt-2">
            Selecione uma conversa na barra lateral esquerda ou capture uma da Fila de Espera para iniciar o atendimento.
          </p>
        </div>
      </section>
    );
  }

  const handleSend = () => {
    const quoted = replyingTo
      ? { id: replyingTo.id, sender: replyingTo.author, content: replyingTo.text }
      : null;

    // Se houver áudio em preview, envia o áudio
    if (recordingState === "preview" && audioBlob) {
      const ext = audioBlob.type.includes("ogg") ? "ogg"
        : audioBlob.type.includes("mp4") ? "mp4"
        : "webm";
      const mimeType = audioBlob.type || "audio/webm";
      // Cria um File real para que o FormData envie o filename corretamente
      const audioFile = new Blob([audioBlob], { type: mimeType }) as any;
      audioFile.name = `audio-${Date.now()}.${ext}`;
      audioFile.lastModified = Date.now();
      const extras = attachments.length > 0 ? [...attachments, audioFile as File] : [audioFile as File];
      sendMessage(text, false, extras, quoted);
      setText("");
      setAttachments([]);
      setReplyingTo(null);
      discardRecording();
      return;
    }
    if (!text.trim() && attachments.length === 0) return;
    sendMessage(text, msgMode === "internal", attachments.length > 0 ? attachments : undefined, quoted);
    setText("");
    setAttachments([]);
    setReplyingTo(null);
    setShowQuickMenu(false);
    setShowEmojiPicker(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setText(val);
    
    // Show quick replies menu if text starts with "/"
    if (val.startsWith("/")) {
      setShowQuickMenu(true);
    } else {
      setShowQuickMenu(false);
    }
  };

  const selectQuickResponse = (response: string) => {
    setText(response);
    setShowQuickMenu(false);
    inputRef.current?.focus();
  };



  return (
    <section className="flex h-full min-w-0 flex-1 flex-col rounded-3xl bg-chat-panel border border-border shadow-soft relative">
      {/* Header — transparente para fundir com o fundo do painel */}
      <header className="flex flex-wrap items-center justify-between px-6 py-4 border-b border-border/60 bg-transparent rounded-t-3xl">
        <div className="flex items-center gap-3">
          {/* Avatar & Channel Badge */}
          <div className="relative">
            {activeChat.avatar ? (
              <img src={activeChat.avatar} alt={activeChat.name} className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div
                className="grid h-10 w-10 place-items-center rounded-full text-xs font-bold text-foreground"
                style={{ background: activeChat.initialsBg || "#eee" }}
              >
                {activeChat.initials || "U"}
              </div>
            )}
            <span className={`absolute -bottom-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full border border-card text-white ${
              activeChat.channel === "whatsapp"
                ? "bg-emerald-500"
                : activeChat.channel === "instagram"
                ? "bg-gradient-to-tr from-yellow-500 to-purple-600"
                : "bg-blue-600"
            }`}>
              {activeChat.channel === "whatsapp" && <WhatsappLogo className="h-2.5 w-2.5" />}
              {activeChat.channel === "instagram" && <InstagramLogo className="h-2.5 w-2.5" />}
              {activeChat.channel === "messenger" && <MessengerLogo className="h-2.5 w-2.5" />}
            </span>
          </div>

          <div>
            <h2 className="text-sm font-bold text-foreground">{activeChat.name}</h2>
            <span className="text-[10px] text-muted-foreground font-semibold uppercase flex items-center gap-1.5 mt-0.5">
              {activeChat.queue === "meus" && (
                <span className="flex items-center gap-1 text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Meus Atendimentos
                </span>
              )}
              {activeChat.queue === "fila" && (
                <span className="flex items-center gap-1 text-amber-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Fila de Espera
                </span>
              )}
              {activeChat.queue === "automacao" && (
                <span className="flex items-center gap-1 text-blue-500 animate-pulse">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> Automação (I.A)
                </span>
              )}
              {activeChat.queue === "finalizados" && (
                <span className="flex items-center gap-1 text-gray-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-400" /> Atendimento Finalizado
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Handover Operations Actions */}
        <div className="flex items-center gap-2 relative">
          {!rightSidebarOpen && (
            <button
              onClick={() => setRightSidebarOpen(true)}
              className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
              title="Mostrar Painel de Informações"
            >
              <ChevronLeft className="h-4.5 w-4.5" strokeWidth={2.5} />
            </button>
          )}
          {activeChat.queue === "meus" ? (
            <>
              {/* Search button */}
              <button
                onClick={() => setShowMsgSearch((v) => !v)}
                className={`grid h-9 w-9 place-items-center rounded-xl border border-border text-xs font-semibold transition cursor-pointer ${
                  showMsgSearch ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
                title="Buscar mensagem"
              >
                <Search className="h-3.5 w-3.5" />
              </button>

              {/* Transfer Menu */}
              <div className="relative">
                <button
                  onClick={() => setShowTransferDropdown(!showTransferDropdown)}
                  className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-4 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  Transferir
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {showTransferDropdown && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={closeTransferDropdown} />
                    <div className="absolute right-0 mt-1.5 z-50 w-52 rounded-xl bg-card p-1 border border-border shadow-card animate-in fade-in duration-100">
                      {!selectedTransferSectorId ? (
                        <>
                          <div className="px-3 py-1.5 text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider border-b border-line mb-1">
                            Escolha o Setor
                          </div>
                          {sectors.map((sec) => (
                            <button
                              key={sec.id}
                              onClick={() => {
                                setSelectedTransferSectorId(sec.id);
                              }}
                              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
                            >
                              <span>{sec.name}</span>
                              <span className="text-[10px] text-muted-foreground font-normal">
                                {sec.operatorIds.length} atendente(s)
                              </span>
                            </button>
                          ))}
                        </>
                      ) : (
                        (() => {
                          const selectedSector = sectors.find(s => s.id === selectedTransferSectorId);
                          const sectorOps = selectedSector 
                            ? operators.filter(op => selectedSector.operatorIds.includes(op.id))
                            : [];
                          
                          return (
                            <>
                              <button 
                                onClick={() => setSelectedTransferSectorId(null)}
                                className="flex w-full items-center gap-1 px-3 py-1.5 text-left text-xs font-bold text-primary hover:bg-muted transition border-b border-line mb-1 cursor-pointer"
                              >
                                <ChevronLeft className="h-3.5 w-3.5" />
                                Voltar para Setores
                              </button>
                              
                              <div className="px-3 py-1 text-[9px] font-extrabold uppercase text-muted-foreground tracking-wider mb-1">
                                Atendentes em {selectedSector?.name}
                              </div>
                              
                              {/* Option to transfer to any agent in sector (general queue) */}
                              <button
                                onClick={() => {
                                  transferChat(activeChat.id, selectedSector?.name || "Sem Nome", null);
                                  closeTransferDropdown();
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-foreground hover:bg-muted transition border-b border-line border-dashed cursor-pointer"
                              >
                                <div className="h-5 w-5 rounded-full bg-primary/10 text-primary grid place-items-center text-[10px] font-black uppercase shrink-0">
                                  F
                                </div>
                                <div className="flex flex-col">
                                  <span>Fila Geral do Setor</span>
                                  <span className="text-[9px] text-muted-foreground font-normal">Qualquer atendente</span>
                                </div>
                              </button>

                              {sectorOps.length === 0 ? (
                                <div className="px-3 py-2 text-xs text-muted-foreground italic">
                                  Nenhum atendente neste setor
                                </div>
                              ) : (
                                sectorOps.map((op) => (
                                  <button
                                    key={op.id}
                                    onClick={() => {
                                      transferChat(activeChat.id, selectedSector?.name || "Sem Nome", op.id);
                                      closeTransferDropdown();
                                    }}
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
                                  >
                                    <img src={op.avatar} alt={op.name} className="h-5 w-5 rounded-full object-cover shrink-0" />
                                    <div className="flex flex-col">
                                      <span>{op.name}</span>
                                      <span className="text-[9px] text-muted-foreground font-normal capitalize">
                                        {op.status === "disponivel" ? "Disponível" : op.status === "pausa" ? "Em Pausa" : "Desconectado"}
                                      </span>
                                    </div>
                                  </button>
                                ))
                              )}
                            </>
                          );
                        })()
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Finish Chat */}
              <button
                onClick={() => finishChat(activeChat.id)}
                className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer"
              >
                <CheckCircle className="h-3.5 w-3.5" />
                Finalizar
              </button>
            </>
          ) : (
            /* Claim Chat */
            activeChat.queue !== "finalizados" && (
              <button
                onClick={() => captureChat(activeChat.id)}
                className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Capturar Atendimento
              </button>
            )
          )}
        </div>
      </header>

      {/* In-chat search bar */}
      {showMsgSearch && (
        <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-6 py-2.5 animate-in slide-in-from-top-2 duration-150">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={msgSearch}
            onChange={(e) => setMsgSearch(e.target.value)}
            placeholder="Buscar mensagem..."
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
          />
          {msgSearch && (
            <button onClick={() => setMsgSearch("")} className="text-muted-foreground hover:text-foreground transition">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => { setShowMsgSearch(false); setMsgSearch(""); }}
            className="text-[10px] font-semibold text-muted-foreground hover:text-foreground transition ml-1"
          >
            Fechar
          </button>
        </div>
      )}
      {/* Messages Window */}
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4 scrollbar-thin">
        {(() => {
          const displayed = msgSearch.trim()
            ? activeChat.messages.filter((m) =>
                m.text.toLowerCase().includes(msgSearch.toLowerCase())
              )
            : activeChat.messages;
          return displayed.length > 0 ? (
            displayed.map((m) => {
            const isMe = m.side === "out";
            const isSystem = m.author === "Sistema";

            if (isSystem) {
              return (
                <div key={m.id} className="flex justify-center my-2">
                  <span className="rounded-full bg-muted px-4 py-1 text-[10px] font-semibold text-muted-foreground uppercase border border-border">
                    {m.text} — {m.time}
                  </span>
                </div>
              );
            }

            if (m.isInternalNote) {
              return (
                <div key={m.id} className="flex flex-col items-center my-3 w-full">
                  <div className="max-w-[85%] rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 shadow-soft text-left">
                    <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase mb-1.5" style={{ color: "hsl(var(--warning, 38 92% 40%))" }}>
                      <Lock className="h-3 w-3 shrink-0" />
                      Anotação Interna — {m.author} às {m.time}
                    </div>
                    <p className="text-xs leading-relaxed font-medium text-amber-900">{m.text}</p>
                  </div>
                </div>
              );
            }

            const isSticker = m.text.startsWith("[MEDIA:sticker]");

            if (isMe) {
              return (
                <div key={m.id} className="flex flex-col items-end group relative w-full">
                  <span className="mb-0.5 text-[10px] text-muted-foreground font-medium mr-1">{m.author}, {m.time}</span>
                  <div className="flex items-center gap-2 max-w-[80%] justify-end">
                    <button
                      onClick={() => setReplyingTo(m)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-all duration-150 cursor-pointer shrink-0"
                      title="Responder"
                    >
                      <CornerUpLeft className="h-3.5 w-3.5" />
                    </button>
                    {isSticker ? (
                      <div className="leading-relaxed">
                        {renderMessageContent(m.text)}
                      </div>
                    ) : m.text.startsWith("[LOCAL_MEDIA:") ? (
                      <div>
                        {renderMessageContent(m.text)}
                      </div>
                    ) : isEmojiOnly(m.text) ? (
                      <div className="text-4xl leading-none select-none py-1">
                        {m.text}
                      </div>
                    ) : (
                      <div
                        className="rounded-2xl rounded-tr-md px-4 py-2.5 text-xs leading-relaxed shadow-soft bg-primary text-primary-foreground text-left"
                      >
                        {m.quotedMessageContent && (
                          <div className="mb-1.5 rounded-lg border-l-4 border-l-white/50 bg-white/10 px-2 py-1 text-[10px] text-white/90 select-none max-w-full">
                            <div className="font-bold mb-0.5">{m.quotedMessageSender || "Mensagem"}</div>
                            <div className="truncate font-medium">{m.quotedMessageContent}</div>
                          </div>
                        )}
                        {renderMessageContent(m.text)}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <div key={m.id} className="flex items-end gap-2.5 group relative w-full">
                {activeChat.avatar ? (
                  <img src={activeChat.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover border border-border" />
                ) : (
                  <div
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold text-foreground"
                    style={{ background: activeChat.initialsBg || "#eee" }}
                  >
                    {activeChat.initials || "U"}
                  </div>
                )}
                <div className="min-w-0 max-w-[80%] flex-1">
                  <span className="mb-0.5 block text-[10px] text-muted-foreground font-medium">{m.author}, {m.time}</span>
                  <div className="flex items-center gap-2">
                    {isSticker ? (
                      <div className="leading-relaxed">
                        {renderMessageContent(m.text)}
                      </div>
                    ) : (
                      <div className="rounded-2xl rounded-tl-md bg-card border border-border px-4 py-2.5 text-xs text-foreground leading-relaxed shadow-soft text-left">
                        {m.quotedMessageContent && (
                          <div className="mb-1.5 rounded-lg border-l-4 border-l-primary bg-muted px-2 py-1 text-[10px] text-muted-foreground select-none max-w-full">
                            <div className="font-bold mb-0.5 text-primary">{m.quotedMessageSender || "Mensagem"}</div>
                            <div className="truncate font-medium">{m.quotedMessageContent}</div>
                          </div>
                        )}
                        {renderMessageContent(m.text)}
                      </div>
                    )}
                    <button
                      onClick={() => setReplyingTo(m)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-all duration-150 cursor-pointer shrink-0"
                      title="Responder"
                    >
                      <CornerUpLeft className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground py-16">
              <Clock className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-xs">Nenhuma mensagem encontrada.</p>
            </div>
          );
        })()}
        <div ref={messagesEndRef} />
      </div>

      {/* Floating Quick Replies Menu */}
      {showQuickMenu && (
        <div className="absolute bottom-20 left-6 right-6 z-50 rounded-2xl bg-card p-2 border border-border shadow-card animate-in slide-in-from-bottom-2 duration-150 max-h-48 overflow-y-auto">
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-line">
            Respostas Rápidas
          </div>
          {quickResponses.map((qr) => (
            <button
              key={qr.id || qr.shortcut}
              onClick={() => selectQuickResponse(qr.text)}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-muted transition cursor-pointer"
            >
              <span className="text-xs font-bold text-primary font-mono">{qr.shortcut}</span>
              <span className="truncate text-xs text-foreground/80 max-w-[280px] font-medium ml-2">{qr.text}</span>
              <span className="text-[10px] text-muted-foreground italic shrink-0">{qr.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* Message Composer */}
      {activeChat.queue !== "finalizados" ? (
        <div
          ref={composerRef}
          className="px-5 pb-5"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Drag overlay */}
          {isDragging && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-3xl bg-primary/10 border-2 border-dashed border-primary pointer-events-none">
              <Paperclip className="h-10 w-10 text-primary mb-2 animate-bounce" />
              <p className="text-sm font-bold text-primary">Solte os arquivos aqui</p>
            </div>
          )}

          {/* Double Mode Selector (Mensagem vs Nota) */}
          <div className="flex gap-2 pl-2 mb-1.5 text-[11px] font-bold">
            <button
              onClick={() => setMsgMode("client")}
              className={`pb-1 border-b-2 px-1 transition ${
                msgMode === "client" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
              }`}
            >
              Enviar Mensagem
            </button>
            <button
              onClick={() => setMsgMode("internal")}
              className={`pb-1 border-b-2 px-1 transition ${
                msgMode === "internal" ? "border-amber-500 text-amber-600" : "border-transparent text-muted-foreground"
              }`}
            >
              Nota Interna
            </button>
          </div>

          {/* Audio preview panel */}
          {recordingState === "preview" && audioUrl && (
            <div className="flex items-center gap-3 mb-3 px-1 animate-in slide-in-from-bottom-2 duration-200">
              <div className="flex-1">
                <AudioBubble src={audioUrl} fileName="Áudio gravado" />
              </div>
              <button
                onClick={discardRecording}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border bg-card text-muted-foreground hover:text-destructive hover:border-destructive transition cursor-pointer"
                title="Descartar gravação"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Attachment Previews */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2 px-1">
              {attachments.map((file, i) => (
                <div
                  key={i}
                  className="relative group flex items-center gap-2 rounded-xl border border-border bg-muted/60 px-3 py-2 max-w-[200px]"
                >
                  {/* Image preview thumbnail */}
                  {file.type.startsWith("image/") ? (
                    <div className="h-10 w-10 shrink-0 rounded-lg overflow-hidden bg-black/5">
                      <img
                        src={URL.createObjectURL(file)}
                        alt={file.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className={`h-9 w-9 shrink-0 grid place-items-center rounded-lg ${getFileColor(file)}`}>
                      {getFileIcon(file)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold text-foreground max-w-[100px]">{file.name}</p>
                    <p className="text-[10px] text-muted-foreground">{formatBytes(file.size)}</p>
                  </div>
                  <button
                    onClick={() => removeAttachment(i)}
                    className="absolute -top-1.5 -right-1.5 h-4.5 w-4.5 grid place-items-center rounded-full bg-destructive text-white opacity-0 group-hover:opacity-100 transition shadow-sm"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Reply preview panel */}
          {replyingTo && (
            <div className="flex items-center justify-between gap-4 mb-2 rounded-xl bg-muted/60 border border-border px-4 py-2 text-xs leading-relaxed animate-in slide-in-from-bottom-2 duration-150 border-l-4 border-l-primary">
              <div className="min-w-0">
                <div className="font-bold text-primary mb-0.5">
                  Respondendo a {replyingTo.author}
                </div>
                <div className="truncate text-muted-foreground font-medium text-[11px]">
                  {replyingTo.text}
                </div>
              </div>
              <button
                onClick={() => setReplyingTo(null)}
                className="p-1 rounded-full hover:bg-muted text-muted-foreground transition shrink-0 cursor-pointer"
                title="Cancelar resposta"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div
            className={`relative flex items-center gap-3 rounded-2xl px-4 py-3 shadow-soft border transition-all duration-200 ${
              recordingState === "recording"
                ? "border-primary/40 bg-primary/5"
                : msgMode === "internal"
                ? "bg-amber-50/70 border-amber-200"
                : isDragging
                ? "border-primary bg-primary/5"
                : "bg-card border-border"
            }`}
          >
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="*/*"
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (files.length > 0) setAttachments((prev) => [...prev, ...files]);
                e.target.value = "";
              }}
            />

            {/* Recording: inline waveform */}
            {recordingState === "recording" ? (
              <>
                <div className="flex items-center gap-[3px] shrink-0">
                  {[0.5, 0.9, 0.65, 1, 0.7, 1.15, 0.55, 0.85, 0.6].map((h, i) => (
                    <div
                      key={i}
                      className="w-[3px] rounded-full bg-primary animate-pulse"
                      style={{
                        height: `${h * 18}px`,
                        animationDelay: `${i * 75}ms`,
                        animationDuration: `${550 + i * 65}ms`,
                      }}
                    />
                  ))}
                </div>
                <span className="text-sm font-bold text-primary tabular-nums flex-1">
                  {fmtSec(recordingSeconds)}
                </span>
                <button
                  onClick={stopRecording}
                  className="grid h-8 w-8 place-items-center rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition shadow-soft cursor-pointer"
                  title="Parar gravação"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              </>
            ) : (
              <>
                <input
                  ref={inputRef}
                  placeholder={
                    msgMode === "internal"
                      ? "Escreva uma nota interna (visível apenas para vendedores)..."
                      : "Escreva sua mensagem... (digite '/' para respostas rápidas)"
                  }
                  value={text}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                {/* Quick Template Icon */}
                <button
                  onClick={() => setShowQuickMenu(!showQuickMenu)}
                  className={`transition cursor-pointer ${
                    msgMode === "internal" ? "text-amber-500 hover:text-amber-700" : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Respostas Rápidas"
                >
                  <Zap className="h-4.5 w-4.5" strokeWidth={2} />
                </button>
                {/* Emoji Picker Trigger */}
                <div className="relative flex items-center">
                  <button
                    onClick={() => setShowEmojiPicker((v) => !v)}
                    className="text-muted-foreground hover:text-foreground cursor-pointer transition"
                    title="Emojis"
                  >
                    <Smile className="h-4.5 w-4.5" strokeWidth={1.75} />
                  </button>
                  {showEmojiPicker && (
                    <EmojiPicker
                      onSelect={(emoji) => {
                        setText((prev) => prev + emoji);
                        inputRef.current?.focus();
                      }}
                      onClose={() => setShowEmojiPicker(false)}
                    />
                  )}
                </div>
                {/* Attachment Button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={`cursor-pointer transition relative ${
                    attachments.length > 0 ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Anexar arquivo"
                >
                  <Paperclip className="h-4.5 w-4.5" strokeWidth={1.75} />
                  {attachments.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 grid place-items-center rounded-full bg-primary text-[8px] font-bold text-white">
                      {attachments.length}
                    </span>
                  )}
                </button>
                {/* Mic button */}
                <button
                  onClick={startRecording}
                  className="text-muted-foreground hover:text-primary transition cursor-pointer"
                  title="Gravar áudio"
                >
                  <Mic className="h-4.5 w-4.5" strokeWidth={1.75} />
                </button>
              </>
            )}

            {/* Send — always visible */}
            <button
              onClick={handleSend}
              className={`grid h-9 w-9 place-items-center rounded-xl transition cursor-pointer text-white hover:opacity-90 ${
                msgMode === "internal" ? "bg-amber-500" : "bg-primary"
              }`}
            >
              {msgMode === "internal" ? <Lock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      ) : (
        <div className="px-5 pb-5 text-center flex flex-col items-center justify-center gap-3 py-6 border-t border-line bg-muted/20 rounded-b-3xl">
          <p className="text-xs text-muted-foreground italic">
            Este atendimento foi encerrado. Reative-o para iniciar uma nova conversa com o cliente.
          </p>
          <button
            onClick={() => captureChat(activeChat.id)}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-xs font-bold text-white shadow-soft transition hover:opacity-90 active:scale-98 cursor-pointer"
          >
            <CheckCircle className="h-4 w-4" />
            Reativar Atendimento
          </button>
        </div>
      )}
    </section>
  );
}
