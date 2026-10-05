import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { MessageReactions } from "./MessageReactions";
import { MessageStatusTicks } from "./MessageStatusTicks";
import { useChat } from "@/hooks/useChatState";
import type { Message } from "@/lib/mockData";
import { WhatsappLogo, InstagramLogo, MessengerLogo } from "./ChatList";
import { EmojiPicker } from "./EmojiPicker";
import { motion, AnimatePresence } from "framer-motion";
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
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Download,
  X,
  Image,
  Film,
  Music,
  File as FileIcon,
  Search,
  Mic,
  Square,
  Trash2,
  CornerUpLeft,
  Play,
  Phone,
  PhoneOff,
  PhoneCall,
  AlertCircle,
  MessageSquare,
  Star,
  Sparkles,
  Package,
  Bookmark,
} from "lucide-react";
import { ValentinaAssistantModal } from "./ValentinaAssistantModal";
import { ProductCatalogPicker } from "./ProductCatalogPicker";
import { MarkEvidenceModal } from "@/components/crm/MarkEvidenceModal";
import { io as socketIO, type Socket } from "socket.io-client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  SystemTooltip,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { getAiPersona } from "@/lib/ai-persona";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

function appendUniqueFiles(previous: File[], incoming: File[]): File[] {
  const seen = new Set(previous.map((file) => `${file.name}:${file.size}:${file.lastModified}:${file.type}`));
  const result = [...previous];
  for (const file of incoming) {
    const key = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(file);
  }
  return result;
}

// ── Formatação padronizada do título do áudio ───────────────────────────────
export function getAudioLabel(authorName?: string, isMe?: boolean, clientName?: string): string {
  const name = isMe
    ? (authorName && authorName !== "Você" ? authorName : null)
    : (authorName || clientName || null);

  if (name) {
    return `Áudio de ${name}`;
  }
  return isMe ? "Áudio do operador" : "Áudio do cliente";
}

// ── Player de áudio customizado ────────────────────────────────────────────
function AudioBubble({ src, fileName, isMe }: { src: string; fileName: string; isMe?: boolean }) {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [current, setCurrent] = React.useState(0);
  const [duration, setDuration] = React.useState(0);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      a.play();
      setPlaying(true);
    }
  };

  const fmt = (s: number) => {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const pct = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-card border border-border/80 shadow-soft px-4 py-3 w-[280px] sm:w-[320px] max-w-full">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={() => setCurrent(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
      />
      {/* Play / Pause */}
      <button
        onClick={toggle}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-soft hover:opacity-90 transition cursor-pointer"
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
        {/* Nome do arquivo padronizado */}
        <p className="truncate text-xs font-bold text-foreground leading-none">
          {fileName}
        </p>

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
  const isWord = ["doc", "docx"].includes(ext);
  const isPdf = ext === "pdf";
  const isPpt = ["ppt", "pptx"].includes(ext);

  const iconBg = isPdf
    ? "bg-red-100 text-red-500"
    : isExcel
      ? "bg-emerald-100 text-emerald-600"
      : isWord
        ? "bg-blue-100 text-blue-600"
        : isPpt
          ? "bg-orange-100 text-orange-500"
          : "bg-muted text-muted-foreground";

  const typeLabel = isPdf
    ? "PDF"
    : isExcel
      ? "Planilha"
      : isWord
        ? "Word"
        : isPpt
          ? "Apresentação"
          : "Documento";

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-card border border-border shadow-soft px-4 py-3 min-w-[240px] max-w-xs">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${iconBg}`}>
        <FileText className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="truncate text-xs font-bold text-foreground">{fileName}</p>
        <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wide mt-0.5">
          {typeLabel}
        </p>
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

function renderTextWithLinks(text: string, isMe?: boolean, isInternalNote?: boolean) {
  if (!text) return "";

  // Regular expression to match URLs starting with http://, https://, or www.
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

  const parts = text.split(urlRegex);
  if (parts.length === 1) {
    return text;
  }

  return parts.map((part, index) => {
    const isUrl = part.match(/^https?:\/\//i) || part.match(/^www\./i);
    if (isUrl) {
      let url = part;
      let trailing = "";

      const commonTrailing = url.match(/[.,?!;:()]+$/);
      if (commonTrailing) {
        const count = commonTrailing[0].length;
        url = url.slice(0, -count);
        trailing = commonTrailing[0];
      }

      let href = url;
      if (url.toLowerCase().startsWith("www.")) {
        href = `https://${url}`;
      }

      let linkClass = "underline font-semibold break-all transition-all";
      if (isMe) {
        linkClass += " text-white hover:text-white/80 decoration-white/70";
      } else if (isInternalNote) {
        linkClass += " text-amber-800 hover:text-amber-950 decoration-amber-800/70";
      } else {
        linkClass += " text-primary hover:opacity-85 decoration-primary/70";
      }

      return (
        <span key={index}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
            onClick={(e) => e.stopPropagation()}
          >
            {url}
          </a>
          {trailing}
        </span>
      );
    }

    return part;
  });
}

function renderMessageContent(
  text: string,
  onMediaClick?: (type: "image" | "video", url: string) => void,
  isMe?: boolean,
  onSaveSticker?: (messageId: string, url: string) => void,
  authorName?: string,
  clientName?: string,
) {
  // Separar a tag de mídia da legenda (se enviada com a mídia)
  const newlineIndex = text.indexOf("\n");
  const mediaTag = newlineIndex !== -1 ? text.slice(0, newlineIndex).trim() : text.trim();
  const captionText = newlineIndex !== -1 ? text.slice(newlineIndex + 1).trim() : "";

  const wrapMediaWithCaption = (mediaNode: React.ReactNode) => {
    if (!captionText) return mediaNode;
    return (
      <div className="flex flex-col gap-1.5 max-w-sm sm:max-w-md">
        {mediaNode}
        <p className="whitespace-pre-wrap text-sm leading-relaxed px-0.5 pt-0.5 font-medium select-text">
          {renderTextWithLinks(captionText, isMe)}
        </p>
      </div>
    );
  };

  // ── Preview local de mídia enviada (objectURL temporário) ─────────────────
  if (mediaTag.startsWith("[LOCAL_MEDIA:")) {
    // Formato: [LOCAL_MEDIA:type:blobUrl:filename]
    // blobUrl pode conter ':', então capturamos filename do final
    const rest = mediaTag.slice("[LOCAL_MEDIA:".length);
    const typeEnd = rest.indexOf(":");
    const type = rest.slice(0, typeEnd);
    const afterType = rest.slice(typeEnd + 1);
    // filename é tudo após o último ':', sem o ']' de fechamento
    const lastColon = afterType.lastIndexOf(":");
    const blobUrl = afterType.slice(0, lastColon);
    const fileName = afterType.slice(lastColon + 1).replace(/\]$/, "");

    if (type === "image") {
      return wrapMediaWithCaption(
        <div
          className="relative group w-full max-w-sm sm:max-w-md rounded-2xl overflow-hidden border border-border/80 bg-black/5 hover:opacity-95 transition cursor-pointer shadow-soft"
          onClick={() => {
            if (onMediaClick) {
              onMediaClick("image", blobUrl);
            } else {
              window.open(blobUrl, "_blank");
            }
          }}
        >
          <img src={blobUrl} alt={fileName} className="max-h-72 sm:max-h-80 w-full object-contain rounded-2xl" />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition rounded-2xl" />
        </div>
      );
    }

    if (type === "video") {
      return wrapMediaWithCaption(
        <div
          className="relative group w-full max-w-sm sm:max-w-md rounded-2xl overflow-hidden cursor-pointer bg-black/5 flex items-center justify-center border border-border shadow-soft"
          onClick={() => {
            if (onMediaClick) {
              onMediaClick("video", blobUrl);
            }
          }}
        >
          <video
            src={blobUrl}
            className="max-h-72 sm:max-h-80 w-full object-contain rounded-2xl pointer-events-none"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/25 transition">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-md backdrop-blur-xs transition group-hover:scale-105">
              <Play className="h-5 w-5 fill-slate-800 ml-0.5" />
            </div>
          </div>
        </div>
      );
    }

    if (type === "audio") {
      const audioTitle = getAudioLabel(authorName, isMe, clientName);
      return wrapMediaWithCaption(<AudioBubble src={blobUrl} fileName={audioTitle} isMe={isMe} />);
    }

    if (type === "sticker") {
      return wrapMediaWithCaption(
        <div className="relative w-44 h-44 sm:w-52 sm:h-52 group overflow-visible">
          <img
            src={blobUrl}
            alt={fileName || "Figurinha"}
            className="w-full h-full object-contain drop-shadow-sm hover:scale-105 transition-transform duration-200"
          />
        </div>
      );
    }

    // document
    return wrapMediaWithCaption(<DocumentCard src={blobUrl} fileName={fileName} />);
  }

  if (mediaTag.startsWith("[MEDIA:")) {
    const match = mediaTag.match(/^\[MEDIA:(image|video|audio|document|sticker)\]([^:]+)(?::(.+))?$/);
    if (match) {
      const [, type, messageId, extra] = match;
      const mediaUrl = `${BACKEND_URL}/api/baileys/media?messageId=${messageId}`;

      if (type === "image") {
        return wrapMediaWithCaption(
          <div
            className="relative group w-full max-w-sm sm:max-w-md rounded-2xl overflow-hidden border border-border/80 bg-black/5 hover:opacity-95 transition cursor-pointer shadow-soft"
            onClick={() => {
              if (onMediaClick) {
                onMediaClick("image", mediaUrl);
              } else {
                window.open(mediaUrl, "_blank");
              }
            }}
          >
            <img src={mediaUrl} alt="Imagem" className="max-h-72 sm:max-h-80 w-full object-contain rounded-2xl" />
          </div>
        );
      }

      if (type === "video") {
        return wrapMediaWithCaption(
          <div
            className="relative group w-full max-w-sm sm:max-w-md rounded-2xl overflow-hidden border border-border/80 bg-black/5 cursor-pointer flex items-center justify-center shadow-soft"
            onClick={() => {
              if (onMediaClick) {
                onMediaClick("video", mediaUrl);
              }
            }}
          >
            <video src={mediaUrl} className="max-h-72 sm:max-h-80 w-full object-contain pointer-events-none rounded-2xl" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/25 transition">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-md backdrop-blur-xs transition group-hover:scale-105">
                <Play className="h-5 w-5 fill-slate-800 ml-0.5" />
              </div>
            </div>
          </div>
        );
      }

      if (type === "audio") {
        const audioTitle = getAudioLabel(authorName, isMe, clientName);
        return wrapMediaWithCaption(<AudioBubble src={mediaUrl} fileName={audioTitle} isMe={isMe} />);
      }

      if (type === "document") {
        const fileName = extra || "documento";
        return wrapMediaWithCaption(<DocumentCard src={mediaUrl} fileName={fileName} />);
      }

      if (type === "sticker") {
        return wrapMediaWithCaption(
          <div className="relative w-44 h-44 sm:w-52 sm:h-52 group overflow-visible">
            <img
              src={mediaUrl}
              alt="Figurinha"
              className="w-full h-full object-contain drop-shadow-sm hover:scale-105 transition-transform duration-200"
              onError={(e) => {
                const target = e.currentTarget;
                target.style.display = "none";
                const fb = target.nextElementSibling as HTMLElement | null;
                if (fb) fb.style.display = "flex";
              }}
            />
            <div
              className="w-full h-full items-center justify-center text-muted-foreground hidden"
              title="Figurinha"
            >
              <Sparkles className="h-10 w-10" />
            </div>
            {onSaveSticker && (
              <button
                onClick={() => onSaveSticker(messageId, mediaUrl)}
                className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 hover:scale-110 transition-all duration-150 cursor-pointer shadow-md z-10"
                title="Salvar Figurinha"
              >
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              </button>
            )}
          </div>
        );
      }
    }
  }

  // Fallback para texto plano
  return <p className="whitespace-pre-wrap">{renderTextWithLinks(text, isMe)}</p>;
}

/** Detecta se o texto contém apenas emojis (inclui modificadores e ZWJ sequences) */
function isEmojiOnly(text: string): boolean {
  const stripped = text.replace(/[\u200D\uFE0F\u20E3]/g, "").trim();
  if (!stripped) return false;
  // Regex que cobre emoji base + modificadores
  const emojiRegex =
    /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|[\u{1F1E0}-\u{1F1FF}]|\u{1F3FB}-\u{1F3FF}|\u{1F466}-\u{1F469})+$/u;
  return emojiRegex.test(stripped);
}

export function getFriendlyQuotedContent(content: string | null | undefined): string {
  if (!content) return "";
  if (content.startsWith("[MEDIA:audio]") || content.startsWith("[LOCAL_MEDIA:audio]")) {
    return "Áudio";
  }
  if (content.startsWith("[MEDIA:image]") || content.startsWith("[LOCAL_MEDIA:image]")) {
    return "Foto";
  }
  if (content.startsWith("[MEDIA:video]") || content.startsWith("[LOCAL_MEDIA:video]")) {
    return "Vídeo";
  }
  if (content.startsWith("[MEDIA:document]") || content.startsWith("[LOCAL_MEDIA:document]")) {
    return "Documento";
  }
  if (content.startsWith("[MEDIA:sticker]")) {
    return "Figurinha";
  }
  return content;
}

export function ChatPanel({ embedded = false }: { embedded?: boolean }) {
  const {
    activeChat,
    activeProvider,
    sendMessage,
    captureChat,
    transferChat,
    finishChat,
    logSystemEvent,
    rightSidebarOpen,
    setRightSidebarOpen,
    tenant,
    sectors,
    operators,
    quickResponses,
    templates,
    currentOperatorId,
    operatorProfile,
    currentGroup,
    setSelectedChatId,
    setActiveView,
    clientTypingStatus,
    messageStatusOverrides,
    operatorTypingStatus,
    isValentinaTyping,
  } = useChat();

  const aiPersona = getAiPersona(tenant || "valem");

  const activeTyping = activeChat ? clientTypingStatus[activeChat.id] : null;
  const activeOperatorTyping = activeChat ? operatorTypingStatus[activeChat.id] : null;

  const {
    canCaptureChat,
    canTransferChat,
    canFinishChat,
    canOverrideChat,
    canSendInternalNotes,
    canEditClientInfo,
    canManageTags,
    canManageRdCrm,
    canChangeWalletOperator,
  } = usePermissions();

  // ── Flags de permissão derivadas do grupo de acesso ──────────────────────
  const isOwner = !!activeChat && activeChat.operatorId === currentOperatorId;
  const canCapture = canCaptureChat;
  const canTransfer = canTransferChat;
  const canFinish = canFinishChat;
  const canOverride = canOverrideChat;
  const ownerOperator = activeChat?.operatorId
    ? operators.find((o) => o.id === activeChat.operatorId)
    : null;

  const [text, setText] = useState("");
  const [metaWindow, setMetaWindow] = useState<{ open: boolean; expiresAt: string | null } | null>(null);
  const [metaTemplates, setMetaTemplates] = useState<Array<{ name: string; language: string; category: string; bodyText: string; variableCount: number; supported: boolean }>>([]);
  const [showMetaTemplates, setShowMetaTemplates] = useState(false);
  const [selectedMetaTemplate, setSelectedMetaTemplate] = useState("");
  const [metaTemplateParameters, setMetaTemplateParameters] = useState<string[]>([]);
  const [replyingTo, setReplyingTo] = useState<any>(null);

  useEffect(() => {
    if (activeProvider !== "meta" || activeChat?.channel !== "whatsapp") {
      setMetaWindow(null);
      setShowMetaTemplates(false);
      return;
    }
    let cancelled = false;
    const refresh = () => fetch(`${BACKEND_URL}/api/whatsapp/meta-state?conversationId=${encodeURIComponent(activeChat.id)}`, { credentials: "include" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (!cancelled) setMetaWindow(data?.window || null); })
      .catch(() => { if (!cancelled) setMetaWindow(null); });
    void refresh();
    const timer = window.setInterval(refresh, 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeProvider, activeChat?.id, activeChat?.messages.length]);

  const loadMetaTemplates = async () => {
    if (!activeChat) return;
    try {
      const response = await fetch(`${BACKEND_URL}/api/whatsapp/meta-state?conversationId=${encodeURIComponent(activeChat.id)}&templates=1`, { credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao carregar templates da Meta");
      setMetaTemplates((data.templates || []).filter((item: { supported: boolean }) => item.supported));
      setMetaWindow(data.window || null);
      setShowMetaTemplates(true);
    } catch (error: any) {
      toast.error(error.message || "Falha ao consultar templates aprovados");
    }
  };

  const sendSelectedMetaTemplate = async () => {
    const selected = metaTemplates.find((item) => `${item.name}:${item.language}` === selectedMetaTemplate);
    if (!selected || metaTemplateParameters.length !== selected.variableCount || metaTemplateParameters.some((value) => !value.trim())) {
      toast.error("Selecione um template e preencha todas as variáveis.");
      return;
    }
    const sent = await sendMessage("", false, undefined, null, {
      name: selected.name,
      language: selected.language,
      parameters: metaTemplateParameters.map((value) => value.trim()),
    });
    if (!sent) return;
    setShowMetaTemplates(false);
    setSelectedMetaTemplate("");
    setMetaTemplateParameters([]);
  };

  useEffect(() => {
    setReplyingTo(null);
  }, [activeChat?.id]);

  const [msgMode, setMsgMode] = useState<"client" | "internal">("client");
  const [showValentinaModal, setShowValentinaModal] = useState(false);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [showFinishConfirmModal, setShowFinishConfirmModal] = useState(false);
  const [markingEvidenceMsg, setMarkingEvidenceMsg] = useState<{ id: string; text: string; author?: string; time?: string } | null>(null);

  const handleApplyValentinaText = (newText: string, asInternalNote: boolean = false) => {
    if (asInternalNote) {
      setMsgMode("internal");
      setText(newText);
    } else {
      setMsgMode("client");
      setText(newText);
    }
    setIsCatalogOpen(false);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  };

  const handleAttachCatalogFiles = (newFiles: File[]) => {
    setAttachments((prev) => appendUniqueFiles(prev, newFiles));
    setIsCatalogOpen(false);
    setMsgMode("client");
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  };
  const [showQuickMenu, setShowQuickMenu] = useState(false);
  const [showTransferDropdown, setShowTransferDropdown] = useState(false);
  const [selectedTransferSectorId, setSelectedTransferSectorId] = useState<string | null>(null);

  const closeTransferDropdown = () => {
    setShowTransferDropdown(false);
    setSelectedTransferSectorId(null);
  };
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const sendInFlightRef = useRef(false);
  const [isSending, setIsSending] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [msgSearch, setMsgSearch] = useState("");
  const [showMsgSearch, setShowMsgSearch] = useState(false);
  const [searchMatchIndex, setSearchMatchIndex] = useState<number>(0);
  const [showValWarnings, setShowValWarnings] = useState(true);
  const [showValResponses, setShowValResponses] = useState(true);
  const [history, setHistory] = useState<{ chatId: string; messages: Message[]; nextCursor: string | null } | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (!activeChat || activeChat.id === "valentina") {
      setHistory(null);
      return;
    }
    const chatId = activeChat.id;
    const controller = new AbortController();
    setHistory(null);
    setLoadingHistory(true);
    fetch(`${BACKEND_URL}/api/chats/${encodeURIComponent(chatId)}/messages?limit=100`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar o histórico.");
        return response.json();
      })
      .then((data) => setHistory({ chatId, messages: data.messages, nextCursor: data.nextCursor }))
      .catch((error) => { if (error.name !== "AbortError") toast.error(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoadingHistory(false); });
    return () => controller.abort();
  }, [activeChat?.id]);

  const allMessages = useMemo(() => {
    if (!activeChat) return [];
    if (history?.chatId !== activeChat.id) return activeChat.messages;
    const seen = new Set<string>();
    return [...history.messages, ...activeChat.messages].filter((message) => {
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    }).sort((a, b) => {
      if (!a.sentAtISO) return 1;
      if (!b.sentAtISO) return -1;
      return a.sentAtISO.localeCompare(b.sentAtISO);
    });
  }, [activeChat?.id, activeChat?.messages, history]);

  // ── Presença em tempo real ────────────────────────────────────────────────
  // Só o responsável pela conversa capturada gera efeitos visíveis ao cliente.
  // O backend valida de novo (tenant da sessão + responsável) e decide se chama a Meta.
  const canEmitPresence =
    !!activeChat &&
    activeChat.id !== "valentina" &&
    activeChat.channel === "whatsapp" &&
    activeChat.queue === "meus" &&
    isOwner;

  const lastInboundId = useMemo(() => {
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const message = allMessages[i];
      if (message.side === "in" && !message.isWarning && !message.isInternalNote) return message.id;
    }
    return null;
  }, [allMessages]);

  const postPresence = useCallback((conversationId: string, action: "read" | "typing") => {
    fetch(`${BACKEND_URL}/api/whatsapp/presence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ conversationId, action }),
    }).catch(() => {});
  }, []);

  // "Lido": cliente vê ✓✓ azul assim que o responsável realmente visualiza a mensagem
  // (conversa aberta + aba do navegador visível). Só existe confirmação real na Meta Cloud API.
  const readSentRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeProvider !== "meta" || !canEmitPresence || !activeChat || !lastInboundId) return;
    const conversationId = activeChat.id;
    const key = `${conversationId}:${lastInboundId}`;
    if (readSentRef.current === key) return;

    const trySend = () => {
      if (document.visibilityState !== "visible" || readSentRef.current === key) return;
      readSentRef.current = key;
      postPresence(conversationId, "read");
    };
    trySend();
    if (readSentRef.current === key) return;

    document.addEventListener("visibilitychange", trySend);
    return () => document.removeEventListener("visibilitychange", trySend);
  }, [activeProvider, canEmitPresence, activeChat?.id, lastInboundId, postPresence]);

  // "Digitando": no máximo 1 sinal a cada 4s; o servidor renova o indicador da Meta a cada ~20s
  // (a Meta o encerra sozinha em 25s ou quando a mensagem é enviada).
  const lastTypingPingRef = useRef(0);
  useEffect(() => {
    lastTypingPingRef.current = 0;
  }, [activeChat?.id]);

  const loadOlderMessages = async () => {
    if (!history?.nextCursor || loadingHistory) return;
    const { chatId, nextCursor } = history;
    setLoadingHistory(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/chats/${encodeURIComponent(chatId)}/messages?limit=100&before=${encodeURIComponent(nextCursor)}`, { credentials: "include" });
      if (!response.ok) throw new Error("Não foi possível carregar mensagens anteriores.");
      const data = await response.json();
      setHistory((current) => current?.chatId === chatId
        ? { chatId, messages: [...data.messages, ...current.messages], nextCursor: data.nextCursor }
        : current);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  const matches = useMemo(() => {
    if (!msgSearch.trim() || !activeChat) return [];
    return allMessages.filter((m) => {
      // Se for a Valentina, respeita os filtros ativos de aviso/conversa
      if (activeChat.id === "valentina") {
        if (m.isWarning) {
          if (!showValWarnings) return false;
        } else {
          if (!showValResponses) return false;
        }
      }
      return m.text.toLowerCase().includes(msgSearch.toLowerCase());
    });
  }, [msgSearch, activeChat, allMessages, showValWarnings, showValResponses]);

  useEffect(() => {
    setSearchMatchIndex(0);
  }, [msgSearch, activeChat?.id]);

  useEffect(() => {
    if (matches.length > 0 && matches[searchMatchIndex]) {
      const activeMatchId = matches[searchMatchIndex].id;
      const element = document.getElementById(`msg-dom-${activeMatchId}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [searchMatchIndex, matches]);

  const [expandedMsgId, setExpandedMsgId] = useState<string | null>(null);
  const [activeMedia, setActiveMedia] = useState<{ type: "image" | "video"; url: string } | null>(
    null,
  );

  const handleMediaClick = useCallback((type: "image" | "video", url: string) => {
    setActiveMedia({ type, url });
  }, []);

  const handleSaveSticker = useCallback((messageId: string, url: string) => {
    try {
      const saved = localStorage.getItem("saved_stickers");
      let list = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(list)) list = [];
      
      const exists = list.some((item: any) => item.id === messageId || item.url === url);
      if (exists) {
        toast.info("Figurinha já está salva!");
        return;
      }
      
      list.push({ id: messageId, url });
      localStorage.setItem("saved_stickers", JSON.stringify(list));
      toast.success("Figurinha salva!");
    } catch (err) {
      console.error("Erro ao salvar figurinha:", err);
      toast.error("Erro ao salvar figurinha");
    }
  }, []);

  const handleSendSticker = useCallback(async (stickerUrl: string) => {
    try {
      setShowEmojiPicker(false);
      const response = await fetch(stickerUrl);
      const blob = await response.blob();
      const file = new File([blob], `sticker-${Date.now()}.webp`, { type: "image/webp" });
      await sendMessage("", false, [file]);
    } catch (err: any) {
      console.error("Erro ao enviar figurinha:", err);
      toast.error("Erro ao enviar figurinha: " + (err.message || "Erro desconhecido"));
    }
  }, [sendMessage]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveMedia(null);
      }
    };
    if (activeMedia) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeMedia]);

  // ── Call (WebRTC) state ────────────────────────────────────────────────────
  type CallModalStatus = "idle" | "waiting" | "active" | "transcribing" | "done" | "error";
  const [callStatus, setCallStatus] = React.useState<CallModalStatus>("idle");
  const [callDuration, setCallDuration] = React.useState(0);
  const [callRoomId, setCallRoomId] = React.useState<string | null>(null);
  const callPcRef = React.useRef<RTCPeerConnection | null>(null);
  const callStreamRef = React.useRef<MediaStream | null>(null);
  const callTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const callPollRef = React.useRef<ReturnType<typeof setInterval> | null>(null); // polling interval
  const callLastTsRef = React.useRef<number>(0); // último timestamp de sinal recebido
  const callRecorderRef = React.useRef<MediaRecorder | null>(null);
  const callChunksRef = React.useRef<Blob[]>([]);
  const remoteAudioRef = React.useRef<HTMLAudioElement | null>(null);

  const ICE_SERVERS: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
      urls: `turn:${import.meta.env.VITE_METERED_DOMAIN ?? "tecfagchat.metered.live"}:80`,
      username: "openrelayproject",
      credential: import.meta.env.VITE_METERED_SECRET ?? "",
    },
    {
      urls: `turns:${import.meta.env.VITE_METERED_DOMAIN ?? "tecfagchat.metered.live"}:443`,
      username: "openrelayproject",
      credential: import.meta.env.VITE_METERED_SECRET ?? "",
    },
  ];

  const fmtCallDuration = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  const cleanupCall = useCallback(() => {
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    if (callPollRef.current) clearInterval(callPollRef.current);
    callStreamRef.current?.getTracks().forEach((t) => t.stop());
    callPcRef.current?.close();
    callPcRef.current = null;
    callPollRef.current = null;
    callStreamRef.current = null;
    callLastTsRef.current = 0;
  }, []);

  const handleStartCall = useCallback(async () => {
    if (!activeChat) return;
    setCallStatus("waiting");
    setCallDuration(0);
    callChunksRef.current = [];
    callLastTsRef.current = Date.now();

    const operatorName = operatorProfile?.name || operators.find((op) => op.id === currentOperatorId)?.name || "Agente";

    // ── 1. Criar sala via API (CRÍTICO — aborta se falhar) ─────────────────
    let roomId: string;
    let callLink: string;
    try {
      const res = await fetch(`${BACKEND_URL}/api/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant, conversationId: activeChat.id, operatorId: currentOperatorId, operatorName }),
      });
      if (!res.ok) throw new Error(`API retornou ${res.status}`);
      const data = await res.json();
      roomId = data.roomId;
      callLink = data.callLink;
      setCallRoomId(roomId);
    } catch (err) {
      console.error("[Call] Falha ao criar sala:", err);
      setCallStatus("error");
      return;
    }

    // ── 2. Solicitar microfone (CRÍTICO — aborta se negado) ────────────────
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      callStreamRef.current = stream;
    } catch (err) {
      console.warn("[Call] Microfone negado:", err);
      // Encerrar sala no servidor
      fetch(`${BACKEND_URL}/api/calls?action=end`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId }),
      }).catch(() => {});
      setCallStatus("error");
      return;
    }

    // ── 3. Enviar link pelo WhatsApp (não crítico) ─────────────────────────
    fetch(`${BACKEND_URL}/api/baileys/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: tenant,
        phone: activeChat.phone,
        conversationId: activeChat.id,
        senderName: operatorName,
        text: `${operatorName} está te ligando!\n\nToque no link para atender pelo navegador:\n${callLink}\n\nLink expira em 10 minutos.`,
      }),
    }).catch((e) => console.warn("[Call] WhatsApp send falhou:", e));

    // ── 4. Nota interna no chat (não crítico) ──────────────────────────────
    sendMessage(
      `*Ligação iniciada por ${operatorName}*\n\nLink enviado para ${activeChat.name}:\n${callLink}`,
      true
    ).catch((e) => console.warn("[Call] Nota interna falhou:", e));

    // ── 5. Criar RTCPeerConnection ─────────────────────────────────────────
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    callPcRef.current = pc;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    pc.ontrack = (e) => {
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = e.streams[0];
      try {
        const ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        ctx.createMediaStreamSource(stream).connect(dest);
        ctx.createMediaStreamSource(e.streams[0]).connect(dest);
        const recorder = new MediaRecorder(dest.stream, { mimeType: "audio/webm;codecs=opus" });
        callRecorderRef.current = recorder;
        recorder.ondataavailable = (ev) => { if (ev.data.size > 0) callChunksRef.current.push(ev.data); };
        recorder.start(1000);
      } catch {}
    };

    // ICE candidates → polling API
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      fetch(`${BACKEND_URL}/api/calls?action=signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, role: "agent", type: "webrtc:ice", data: e.candidate }),
      }).catch(() => {});
    };

    // ── 6. Polling — verifica sinais do cliente a cada 600ms ───────────────
    callPollRef.current = setInterval(async () => {
      try {
        const r = await fetch(
          `${BACKEND_URL}/api/calls?action=signal&roomId=${roomId}&after=${callLastTsRef.current}&role=agent`
        );
        if (!r.ok) return;
        const { signals, status } = await r.json();

        if (status === "ended") { handleEndCall(roomId, true); return; }

        for (const sig of signals as Array<{ type: string; data: any; timestamp: number }>) {
          callLastTsRef.current = Math.max(callLastTsRef.current, sig.timestamp);

          if (sig.type === "client:joined") {
            setCallStatus("active");
            callTimerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await fetch(`${BACKEND_URL}/api/calls?action=signal`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ roomId, role: "agent", type: "webrtc:offer", data: offer }),
            });
          }

          if (sig.type === "webrtc:answer") {
            await pc.setRemoteDescription(new RTCSessionDescription(sig.data));
          }

          if (sig.type === "webrtc:ice") {
            try { await pc.addIceCandidate(new RTCIceCandidate(sig.data)); } catch {}
          }

          if (sig.type === "call:ended") {
            handleEndCall(roomId, true);
            return;
          }
        }
      } catch {}
    }, 600);

  }, [activeChat, tenant, currentOperatorId, operators, operatorProfile, sendMessage, cleanupCall]);


  const handleEndCall = useCallback(async (roomId: string | null, fromRemote = false) => {
    // Sinalizar encerramento para o cliente (se não veio do remoto)
    if (!fromRemote && roomId) {
      await fetch(`${BACKEND_URL}/api/calls?action=signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, role: "agent", type: "call:ended", data: null }),
      }).catch(() => {});
    }

    // Parar gravação
    const recorder = callRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();

    const duration = callDuration;
    cleanupCall();
    setCallStatus("transcribing");

    await new Promise((r) => setTimeout(r, 800));

    const operatorName = operatorProfile?.name || operators.find((op) => op.id === currentOperatorId)?.name || "Agente";

    const chunks = callChunksRef.current;
    if (chunks.length > 0 && roomId) {
      try {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const formData = new FormData();
        formData.append("audio", blob, "recording.webm");
        formData.append("roomId", roomId);
        formData.append("duration", String(duration));
        formData.append("operatorName", operatorName);
        await fetch(`${BACKEND_URL}/api/calls?action=transcribe`, { method: "POST", body: formData });
      } catch (e) {
        console.error("[Call] Erro ao transcrever:", e);
      }
    } else if (roomId) {
      await fetch(`${BACKEND_URL}/api/calls?action=end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId }),
      });
    }

    setCallStatus("done");
    setTimeout(() => setCallStatus("idle"), 3000);
  }, [callDuration, currentOperatorId, operators, operatorProfile, cleanupCall]);

  // ── Voice recorder state ────────────────────────────────────────────────────
  const [recordingState, setRecordingState] = React.useState<"idle" | "recording" | "preview">("idle");
  const [audioBlob, setAudioBlob] = React.useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = React.useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = React.useState(0);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  // ── Voice recorder logic ────────────────────────────────────────────────────
  const fmtSec = (s: number) =>
    `${Math.floor(s / 60)
      .toString()
      .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
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
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
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
    if (files.length > 0) setAttachments((prev) => appendUniqueFiles(prev, files));
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
        setAttachments((prev) => appendUniqueFiles(prev, files));
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
    return <FileIcon className="h-4 w-4" />;
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

  // Auto-redimensionar o campo de texto conforme o conteúdo
  useEffect(() => {
    const textarea = inputRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [text]);

  if (!activeChat) {
    return (
      <section className="flex h-full min-w-0 flex-1 flex-col items-center justify-center rounded-3xl bg-chat-panel border border-border shadow-soft text-muted-foreground select-none">
        <div className="text-center max-w-sm p-6">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-muted mx-auto mb-4">
            <Zap className="h-8 w-8 text-muted-foreground/30 animate-pulse" />
          </div>
          <h3 className="text-lg font-bold text-foreground">Nenhum Atendimento Ativo</h3>
          <p className="text-sm mt-2">
            Selecione uma conversa na barra lateral esquerda ou capture uma da Fila de Espera para
            iniciar o atendimento.
          </p>
        </div>
      </section>
    );
  }

  const logVigosPhoneCall = () => {
    if (!activeChat) return;
    const operatorName = operatorProfile?.name || operators.find((op) => op.id === currentOperatorId)?.name || "Agente";
    logSystemEvent(activeChat.id, `Clique no botão de ligação para o cliente por ${operatorName}`);
  };

  const performSend = async () => {
    if (activeProvider === "meta" && activeChat?.channel === "whatsapp" && msgMode !== "internal" && metaWindow && !metaWindow.open) {
      toast.error("A janela de 24 horas terminou. Use um template aprovado pela Meta.");
      loadMetaTemplates();
      return;
    }
    const quoted = replyingTo
      ? {
          id: replyingTo.id,
          sender: replyingTo.author,
          content: getFriendlyQuotedContent(replyingTo.text),
        }
      : null;

    // Se houver áudio em preview, envia o áudio
    if (recordingState === "preview" && audioBlob) {
      const ext = audioBlob.type.includes("ogg")
        ? "ogg"
        : audioBlob.type.includes("mp4")
          ? "mp4"
          : "webm";
      const mimeType = audioBlob.type || "audio/webm";
      // Cria um File real para que o FormData envie o filename corretamente
      const audioFile = new Blob([audioBlob], { type: mimeType }) as any;
      audioFile.name = `audio-${Date.now()}.${ext}`;
      audioFile.lastModified = Date.now();
      const extras =
        attachments.length > 0 ? [...attachments, audioFile as File] : [audioFile as File];
      if (!await sendMessage(text, false, extras, quoted)) return;
      setText("");
      setAttachments([]);
      setReplyingTo(null);
      discardRecording();
      return;
    }
    if (!text.trim() && attachments.length === 0) return;
    if (!await sendMessage(
      text,
      msgMode === "internal",
      attachments.length > 0 ? attachments : undefined,
      quoted,
    )) return;
    setText("");
    setAttachments([]);
    setReplyingTo(null);
    setShowQuickMenu(false);
    setShowEmojiPicker(false);
  };

  const handleSend = async () => {
    if (sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    setIsSending(true);
    try {
      await performSend();
    } finally {
      sendInFlightRef.current = false;
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    // "digitando..." para o cliente (Meta) e para quem acompanha a conversa — notas internas não contam.
    if (canEmitPresence && activeChat && msgMode === "client" && val.trim() && !val.startsWith("/")) {
      const now = Date.now();
      if (now - lastTypingPingRef.current > 4000) {
        lastTypingPingRef.current = now;
        postPresence(activeChat.id, "typing");
      }
    }

    // Show quick replies menu if text starts with "/"
    if (val.startsWith("/")) {
      setShowQuickMenu(true);
    } else {
      setShowQuickMenu(false);
    }
  };

  const selectQuickResponse = (response: string) => {
    let parsedText = response;
    
    // Substitui as tags dinâmicas pelos valores reais correspondentes
    if (parsedText.includes("<<1>>")) {
      parsedText = parsedText.replaceAll("<<1>>", operatorProfile.name);
    }
    if (parsedText.includes("<<2>>")) {
      parsedText = parsedText.replaceAll("<<2>>", activeChat?.name || "Cliente");
    }

    setText(parsedText);
    setShowQuickMenu(false);
    inputRef.current?.focus();
  };

  return (
    <motion.section
      key={activeChat.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex h-full min-w-0 flex-1 flex-col rounded-3xl bg-chat-panel border border-border shadow-soft relative"
    >
      {/* Header — flutuante com fundo sólido e sombra para melhor harmonia */}
      <header className="hidden md:flex flex-wrap items-center justify-between px-6 py-4 border-b border-border/50 bg-card shadow-sm rounded-t-3xl z-10">
        <div className="flex items-center gap-3">
          {/* Avatar & Channel Badge */}
          <div className="relative">
            {activeChat.id === "valentina" ? (
              <img
                src={aiPersona.avatarUrl}
                alt={aiPersona.name}
                className="h-10 w-10 rounded-full object-cover border border-border shadow-xs"
              />
            ) : activeChat.avatar ? (
              <img
                src={activeChat.avatar}
                alt={activeChat.name}
                className="h-10 w-10 rounded-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => setActiveMedia({ type: "image", url: activeChat.avatar })}
              />
            ) : (
              <div
                className="grid h-10 w-10 place-items-center rounded-full text-xs font-bold text-foreground"
                style={{ background: activeChat.initialsBg || "#eee" }}
              >
                {activeChat.initials || "U"}
              </div>
            )}
            <span
              className={`absolute -bottom-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full border border-card text-white ${
                activeChat.id === "valentina"
                  ? "bg-primary"
                  : activeChat.channel === "whatsapp"
                    ? "bg-emerald-500"
                    : activeChat.channel === "instagram"
                      ? "bg-gradient-to-tr from-yellow-500 to-purple-600"
                      : "bg-blue-600"
              }`}
            >
              {activeChat.id === "valentina" ? (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
                </span>
              ) : (
                <>
                  {activeChat.channel === "whatsapp" && <WhatsappLogo className="h-2.5 w-2.5" />}
                  {activeChat.channel === "instagram" && <InstagramLogo className="h-2.5 w-2.5" />}
                  {activeChat.channel === "messenger" && <MessengerLogo className="h-2.5 w-2.5" />}
                </>
              )}
            </span>
          </div>

          <div>
            <h2 className="text-sm font-bold text-foreground">{activeChat.name}</h2>
            {activeChat.whatsappUsername && <span className="text-[11px] text-primary">@{activeChat.whatsappUsername}</span>}
            {activeChat.id === "valentina" && isValentinaTyping ? (
              <span className="text-[11px] font-bold text-primary animate-pulse flex items-center gap-1 mt-0.5">
                <Zap className="h-3 w-3 text-primary animate-bounce" />
                <span>{aiPersona.name} está digitando...</span>
              </span>
            ) : activeTyping ? (
              <span className="text-[11px] font-bold text-primary animate-pulse flex items-center gap-1 mt-0.5">
                {activeTyping.status === "recording" ? (
                  <>
                    <Mic className="h-3 w-3 text-red-500" />
                    <span>gravando áudio...</span>
                  </>
                ) : (
                  <>
                    <Zap className="h-3 w-3 text-primary" />
                    <span>digitando...</span>
                  </>
                )}
              </span>
            ) : activeOperatorTyping ? (
              <span className="text-[11px] font-bold text-amber-500 animate-pulse flex items-center gap-1 mt-0.5">
                <Zap className="h-3 w-3" />
                <span>{activeOperatorTyping.operatorName.split(" ")[0]} está digitando uma resposta...</span>
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground font-semibold uppercase flex items-center gap-1.5 mt-0.5">
              {activeChat.queue === "meus" && (
                isOwner ? (
                  <span className="flex items-center gap-1 text-primary">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Meus Atendimentos
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-amber-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Atendimento com {ownerOperator?.name ?? "outro operador"}
                  </span>
                )
              )}
              {activeChat.queue === "fila" && (
                <span className="flex items-center gap-1 text-amber-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Fila de Espera
                </span>
              )}
              {activeChat.queue === "automacao" && (
                <span className="flex items-center gap-1 text-primary font-bold animate-pulse">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Com {aiPersona.name} (I.A)
                </span>
              )}
              {activeChat.queue === "finalizados" && (
                <span className="flex items-center gap-1 text-gray-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-400" /> Atendimento Finalizado
                </span>
              )}
            </span>
          )}
        </div>
      </div>

        {/* Handover Operations Actions */}
        <div className="flex items-center gap-2 relative">
          {!rightSidebarOpen && activeChat.id !== "valentina" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setRightSidebarOpen(true)}
                  className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
                >
                  <ChevronLeft className="h-4.5 w-4.5" strokeWidth={2.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Mostrar Painel de Informações</TooltipContent>
            </Tooltip>
          )}
          {activeChat.queue === "meus" ? (
            <>
              {/* Search button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setShowMsgSearch((v) => !v)}
                    className={`grid h-9 w-9 place-items-center rounded-xl border border-border text-xs font-semibold transition cursor-pointer ${
                      showMsgSearch
                        ? "bg-primary text-primary-foreground"
                        : "bg-card text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    <Search className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Buscar mensagem</TooltipContent>
              </Tooltip>

              {/* Filtros de mensagens da Valentina */}
              {activeChat.id === "valentina" && (
                <>
                  {/* Filtrar Avisos */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setShowValWarnings((v) => !v)}
                        className={`grid h-9 w-9 place-items-center rounded-xl border border-border text-xs font-semibold transition cursor-pointer ${
                          showValWarnings
                            ? "bg-primary text-primary-foreground"
                            : "bg-card text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                      >
                        <AlertCircle className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Avisos de {aiPersona.name}</TooltipContent>
                  </Tooltip>

                  {/* Filtrar Respostas/Conversas */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setShowValResponses((v) => !v)}
                        className={`grid h-9 w-9 place-items-center rounded-xl border border-border text-xs font-semibold transition cursor-pointer ${
                          showValResponses
                            ? "bg-primary text-primary-foreground"
                            : "bg-card text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Respostas/Conversas de {aiPersona.name}</TooltipContent>
                  </Tooltip>
                </>
              )}

              {/* Local Dial Button (VigosPhone) */}
              {activeChat.id !== "valentina" && !!activeChat.phone && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={(() => {
                        if (!activeChat.phone) return "#";
                        let n = activeChat.phone.replace(/\D/g, "");
                        if (n.startsWith("55") && n.length > 10) n = n.substring(2);
                        if (n.startsWith("0")) n = n.substring(1);
                        if (n.startsWith("14")) n = n.substring(2);
                        return `tel:${n}`;
                      })()}
                      onClick={logVigosPhoneCall}
                      className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-emerald-600 hover:bg-emerald-50 hover:border-emerald-300 transition cursor-pointer"
                    >
                      <PhoneCall className="h-3.5 w-3.5" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Discar via VigosPhone (Softphone Local)</TooltipContent>
                </Tooltip>
              )}

              {/* Transfer Menu — apenas para o dono com canTransferChat */}
              {activeChat.id !== "valentina" && isOwner && canTransfer && (
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
                            const selectedSector = sectors.find(
                              (s) => s.id === selectedTransferSectorId,
                            );
                            const sectorOps = selectedSector
                              ? operators.filter((op) => selectedSector.operatorIds.includes(op.id))
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
                                    transferChat(
                                      activeChat.id,
                                      selectedSector?.name || "Sem Nome",
                                      null,
                                    );
                                    closeTransferDropdown();
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-foreground hover:bg-muted transition border-b border-line border-dashed cursor-pointer"
                                >
                                  <div className="h-5 w-5 rounded-full bg-primary/10 text-primary grid place-items-center text-[10px] font-black uppercase shrink-0">
                                    F
                                  </div>
                                  <div className="flex flex-col">
                                    <span>Fila Geral do Setor</span>
                                    <span className="text-[9px] text-muted-foreground font-normal">
                                      Qualquer atendente
                                    </span>
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
                                        transferChat(
                                          activeChat.id,
                                          selectedSector?.name || "Sem Nome",
                                          op.id,
                                        );
                                        closeTransferDropdown();
                                      }}
                                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
                                    >
                                      <img
                                        src={op.avatar}
                                        alt={op.name}
                                        className="h-5 w-5 rounded-full object-cover shrink-0"
                                      />
                                      <div className="flex flex-col">
                                        <span>{op.name}</span>
                                        <span className="text-[9px] text-muted-foreground font-normal capitalize">
                                          {op.status === "disponivel"
                                            ? "Disponível"
                                            : op.status === "pausa"
                                              ? "Em Pausa"
                                              : "Desconectado"}
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
              )}

              {/* Finish Chat — apenas para o dono com canFinishChat */}
              {activeChat.id !== "valentina" && isOwner && canFinish && (
                <button
                  onClick={() => setShowFinishConfirmModal(true)}
                  className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer shadow-soft"
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  Finalizar
                </button>
              )}
            </>
          ) : (
            /* Claim Chat — fila/automação, apenas para quem tem canCaptureChat */
            activeChat.queue !== "finalizados" && !activeChat.operatorId && canCapture && (
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

      {/* ── Call Modal Overlay ─────────────────────────────────────────────── */}
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: "none" }} />
      {callStatus !== "idle" && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-3xl bg-black/80 backdrop-blur-md">
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-card border border-border p-8 shadow-2xl w-80 text-center">
            {/* Avatar */}
            <div className="h-16 w-16 rounded-full bg-primary/10 border-2 border-primary/30 grid place-items-center text-2xl">
              {activeChat?.avatar ? (
                <img src={activeChat.avatar} alt={activeChat.name} className="h-full w-full rounded-full object-cover" />
              ) : (
                <span>{activeChat?.initials ?? "?"}</span>
              )}
            </div>

            <div>
              <h3 className="text-base font-bold text-foreground">{activeChat?.name}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {callStatus === "waiting" && "Aguardando cliente atender..."}
                {callStatus === "active" && "Em chamada"}
                {callStatus === "transcribing" && "Transcrevendo chamada..."}
                {callStatus === "done" && "Transcrição inserida no chat"}
                {callStatus === "error" && "Microfone bloqueado ou erro ao conectar."}
              </p>
            </div>

            {callStatus === "active" && (
              <>
                <div className="text-4xl font-mono font-bold text-primary tabular-nums">
                  {fmtCallDuration(callDuration)}
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                  Gravando
                </span>
              </>
            )}

            {(callStatus === "waiting" || callStatus === "transcribing") && (
              <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            )}

            {(callStatus === "waiting" || callStatus === "active") && (
              <button
                onClick={() => handleEndCall(callRoomId)}
                className="flex items-center gap-2 rounded-xl bg-red-500 px-6 py-3 text-sm font-bold text-white hover:bg-red-600 transition cursor-pointer mt-2"
              >
                <PhoneOff className="h-4 w-4" />
                Encerrar chamada
              </button>
            )}

            {(callStatus === "error" || callStatus === "done") && (
              <div className="flex gap-2 mt-2">
                {callStatus === "error" && (
                  <button
                    onClick={handleStartCall}
                    className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-primary/90 transition cursor-pointer"
                  >
                    <Phone className="h-4 w-4" />
                    Tentar de novo
                  </button>
                )}
                <button
                  onClick={() => setCallStatus("idle")}
                  className="flex items-center gap-2 rounded-xl bg-muted px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/80 transition cursor-pointer"
                >
                  <X className="h-4 w-4" />
                  Fechar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

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
            <button
              onClick={() => setMsgSearch("")}
              className="text-muted-foreground hover:text-foreground transition cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Contadores e navegação entre ocorrências */}
          {msgSearch.trim() && (
            <div className="flex items-center gap-1.5 border-l border-border/60 pl-3 mr-1 select-none">
              <span className="text-[11px] font-bold text-muted-foreground min-w-[36px] text-center">
                {matches.length > 0 ? `${searchMatchIndex + 1}/${matches.length}` : "0/0"}
              </span>
              <SystemTooltip content="Mensagem anterior">
                <button
                  disabled={matches.length === 0}
                  onClick={() => setSearchMatchIndex((prev) => (prev - 1 + matches.length) % matches.length)}
                  className={`p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer ${
                    matches.length === 0 ? "opacity-30 cursor-not-allowed" : ""
                  }`}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
              </SystemTooltip>
              <SystemTooltip content="Próxima mensagem">
                <button
                  disabled={matches.length === 0}
                  onClick={() => setSearchMatchIndex((prev) => (prev + 1) % matches.length)}
                  className={`p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer ${
                    matches.length === 0 ? "opacity-30 cursor-not-allowed" : ""
                  }`}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </SystemTooltip>
            </div>
          )}

          <button
            onClick={() => {
              setShowMsgSearch(false);
              setMsgSearch("");
            }}
            className="text-[10px] font-semibold text-muted-foreground hover:text-foreground transition ml-1 cursor-pointer"
          >
            Fechar
          </button>
        </div>
      )}
      {/* Messages Window */}
      <div className="flex-1 overflow-y-auto px-6 py-4 scrollbar-thin">
        {activeChat.id !== "valentina" && history?.chatId === activeChat.id && history.nextCursor && (
          <div className="mb-4 text-center">
            <button
              type="button"
              onClick={loadOlderMessages}
              disabled={loadingHistory}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              {loadingHistory ? "Carregando..." : "Carregar mensagens anteriores"}
            </button>
          </div>
        )}
        {(() => {
          let displayed = allMessages;

          if (activeChat.id === "valentina") {
            displayed = displayed.filter((m) => {
              if (m.isWarning) {
                return showValWarnings;
              } else {
                return showValResponses;
              }
            });
          }

          if (displayed.length === 0) {
            return (
              <div className="flex h-full flex-col items-center justify-center text-muted-foreground py-16">
                <Clock className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-xs">Nenhuma mensagem encontrada.</p>
              </div>
            );
          }

          // Parse "HH:MM" → minutos desde meia-noite
          const toMin = (t: string) => {
            const [h, m] = (t || "0:0").split(":").map(Number);
            return (h || 0) * 60 + (m || 0);
          };

          // Decide se duas mensagens adjacentes pertencem ao mesmo grupo visual
          const canLink = (
            a: (typeof displayed)[0],
            b: (typeof displayed)[0],
          ) =>
            a.side === b.side &&
            a.author === b.author &&
            a.author !== "Sistema" &&
            !a.isInternalNote &&
            !b.isInternalNote &&
            !b.quotedMessageContent &&
            Math.abs(toMin(a.time) - toMin(b.time)) <= 3;

          return displayed.map((m, i) => {
            const prev = i > 0 ? displayed[i - 1] : null;
            const next = i < displayed.length - 1 ? displayed[i + 1] : null;
            const prevLinked = prev ? canLink(prev, m) : false;
            const nextLinked = next ? canLink(m, next) : false;

            const isFirst = !prevLinked;  // primeira do grupo
            const isLast  = !nextLinked;  // última do grupo
            const isMe     = m.side === "out";
            const isSystem = m.author === "Sistema";
            const isExpanded = expandedMsgId === m.id;

            // Espaçamento: 3px dentro do grupo, 12px entre grupos, extra para avisos
            const gap = m.isWarning || (i > 0 && displayed[i - 1].isWarning)
              ? "mt-6"
              : prevLinked
              ? "mt-[3px]"
              : i > 0
              ? "mt-3"
              : "";

            // ── Separador de Data (estilo WhatsApp) — calculado ANTES de qualquer if ──
            const todayBR = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
            const yesterdayBR = new Date(Date.now() - 86400000).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

            const formatDateLabel = (dateStr: string) => {
              if (!dateStr) return null;
              if (dateStr === todayBR) return "Hoje";
              if (dateStr === yesterdayBR) return "Ontem";
              const [d, mo, y] = dateStr.split("/");
              const months = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
              const monthName = months[parseInt(mo, 10) - 1] || mo;
              return `${parseInt(d, 10)} de ${monthName} de ${y}`;
            };

            const showDateSeparator = (m as any).date && (!prev || (prev as any).date !== (m as any).date);
            const dateLabel = showDateSeparator ? formatDateLabel((m as any).date as string) : null;

            // ── Mensagens de sistema ──────────────────────────────────────
            if (isSystem) {
              return (
                <React.Fragment key={m.id}>
                  {dateLabel && (
                    <div className="flex justify-center my-3">
                      <span className="rounded-full bg-muted px-4 py-1 text-[10px] font-semibold text-muted-foreground border border-border select-none">
                        {dateLabel}
                      </span>
                    </div>
                  )}
                  <div className={`flex justify-center ${gap} my-2`}>
                    <span className="rounded-full bg-muted px-4 py-1 text-[10px] font-semibold text-muted-foreground uppercase border border-border">
                      {renderTextWithLinks(m.text)} — {m.time}
                    </span>
                  </div>
                </React.Fragment>
              );
            }

            // ── Notas internas ────────────────────────────────────────────
            if (m.isInternalNote) {
              return (
                <React.Fragment key={m.id}>
                  {dateLabel && (
                    <div className="flex justify-center my-3">
                      <span className="rounded-full bg-muted px-4 py-1 text-[10px] font-semibold text-muted-foreground border border-border select-none">
                        {dateLabel}
                      </span>
                    </div>
                  )}
                  <div className={`flex flex-col items-center ${gap} w-full`}>
                    <div className="max-w-[85%] rounded-2xl border border-amber-500/20 bg-amber-500/10 dark:bg-amber-950/40 dark:border-amber-500/30 px-5 py-3 shadow-soft text-left">
                      <div
                        className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase mb-1.5 text-amber-600 dark:text-amber-400"
                      >
                        <Lock className="h-3 w-3 shrink-0" />
                        Anotação Interna — {m.author} às {m.time}
                      </div>
                      <p className="text-xs leading-relaxed font-medium text-amber-950 dark:text-amber-200">
                        {renderTextWithLinks(m.text, false, true)}
                      </p>
                    </div>
                  </div>
                </React.Fragment>
              );
            }

            const isSticker = m.text.startsWith("[MEDIA:sticker]") || m.text.startsWith("[LOCAL_MEDIA:sticker]");
            const isMedia = m.text.startsWith("[MEDIA:") || m.text.startsWith("[LOCAL_MEDIA:");
            const hasCaption = isMedia && m.text.includes("\n") && m.text.split("\n").slice(1).join("\n").trim().length > 0;
            const isAudioOrDoc = m.text.startsWith("[MEDIA:audio]") || m.text.startsWith("[LOCAL_MEDIA:audio]") || m.text.startsWith("[MEDIA:document]") || m.text.startsWith("[LOCAL_MEDIA:document]");

            // Resolução da mensagem citada (busca no histórico se o conteúdo não veio direto)
            const quotedTarget = (m.quotedMessageId && !m.quotedMessageContent)
              ? allMessages.find((prev) => prev.id === m.quotedMessageId || prev.externalId === m.quotedMessageId)
              : null;
            const displayQuotedContent = m.quotedMessageContent || quotedTarget?.text || null;
            const displayQuotedSender = m.quotedMessageSender || (quotedTarget ? (quotedTarget.side === "out" ? "Você" : quotedTarget.author || activeChat.name) : "Mensagem");

            // Função para rolar suavemente até a mensagem citada ao clicar
            const handleScrollToQuoted = (e: React.MouseEvent) => {
              e.stopPropagation();
              const targetId = m.quotedMessageId || quotedTarget?.id;
              if (targetId) {
                const el = document.getElementById(`msg-dom-${targetId}`);
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                  el.classList.add("ring-2", "ring-primary", "transition-all");
                  setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 1500);
                }
              }
            };

            // Border-radius por posição no grupo (estilo WhatsApp)
            const outR =
              isFirst && isLast  ? "rounded-2xl"
              : isFirst           ? "rounded-2xl rounded-br-[5px]"
              : isLast            ? "rounded-2xl rounded-tr-[5px]"
              :                    "rounded-lg   rounded-r-[5px]";

            const inR =
              isFirst && isLast  ? "rounded-2xl"
              : isFirst           ? "rounded-2xl rounded-bl-[5px]"
              : isLast            ? "rounded-2xl rounded-tl-[5px]"
              :                    "rounded-lg   rounded-l-[5px]";

            // Handler de clique no balão (ignora cliques em links/botões filhos)
            const onBubbleClick = (e: React.MouseEvent) => {
              if ((e.target as HTMLElement).closest("a, button")) return;
              setExpandedMsgId(isExpanded ? null : m.id);
            };

            // ── Enviadas (eu) ─────────────────────────────────────────────
            if (isMe) {
              const isMatch = matches.length > 0 && matches[searchMatchIndex]?.id === m.id;
              return (
                <React.Fragment key={m.id}>
                  {dateLabel && (
                    <div className="flex justify-center my-3">
                      <span className="rounded-full bg-muted px-4 py-1 text-[10px] font-semibold text-muted-foreground border border-border select-none">
                        {dateLabel}
                      </span>
                    </div>
                  )}
                <motion.div
                  id={`msg-dom-${m.id}`}
                  layout
                  initial={{ opacity: 0, x: 18, scale: 0.96 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                  className={`flex flex-col items-end group relative w-full ${gap}`}
                >
                  <div className="flex items-center gap-2 max-w-[80%] justify-end">
                    <SystemTooltip content="Marcar como evidência do negócio">
                      <button
                        onClick={() => setMarkingEvidenceMsg({ id: m.id, text: m.text, author: m.author, time: m.time })}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-amber-500 transition-all duration-150 cursor-pointer shrink-0"
                      >
                        <Bookmark className="h-3.5 w-3.5" />
                      </button>
                    </SystemTooltip>
                    <SystemTooltip content="Responder">
                      <button
                        onClick={() => setReplyingTo(m)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-all duration-150 cursor-pointer shrink-0"
                      >
                        <CornerUpLeft className="h-3.5 w-3.5" />
                      </button>
                    </SystemTooltip>
                    {isSticker ? (
                      <div className="leading-relaxed">
                        {displayQuotedContent && (
                          <div
                            onClick={handleScrollToQuoted}
                            className="mb-1 rounded-lg border-l-4 border-l-primary bg-card/90 border border-border/80 px-2.5 py-1.5 text-[11px] text-muted-foreground select-none max-w-full cursor-pointer hover:bg-card transition shadow-xs"
                          >
                            <div className="font-bold text-[10px] mb-0.5 text-primary">{displayQuotedSender}</div>
                            <div className="truncate font-medium">{getFriendlyQuotedContent(displayQuotedContent)}</div>
                          </div>
                        )}
                        {renderMessageContent(m.text, handleMediaClick, true, handleSaveSticker, m.author, activeChat.name)}
                      </div>
                    ) : isAudioOrDoc ? (
                      <div className="flex flex-col items-end gap-1.5">
                        {displayQuotedContent && (
                          <div
                            onClick={handleScrollToQuoted}
                            className="mb-0.5 rounded-lg border-l-4 border-l-primary bg-card/90 border border-border/80 px-2.5 py-1.5 text-[11px] text-muted-foreground select-none max-w-full cursor-pointer hover:bg-card transition shadow-xs"
                          >
                            <div className="font-bold text-[10px] mb-0.5 text-primary">{displayQuotedSender}</div>
                            <div className="truncate font-medium">{getFriendlyQuotedContent(displayQuotedContent)}</div>
                          </div>
                        )}
                        {renderMessageContent(m.text, handleMediaClick, true, undefined, m.author, activeChat.name)}
                      </div>
                    ) : isMedia && !hasCaption && !displayQuotedContent ? (
                      <div>{renderMessageContent(m.text, handleMediaClick, true, undefined, m.author, activeChat.name)}</div>
                    ) : isEmojiOnly(m.text) && !displayQuotedContent ? (
                      <div className="text-4xl leading-none select-none py-1">{m.text}</div>
                    ) : (
                      <div
                        onClick={onBubbleClick}
                        className={`${outR} px-4 py-2.5 text-sm leading-relaxed shadow-soft bg-primary text-primary-foreground text-left cursor-pointer transition-all duration-300 ${
                          isMatch ? "scale-[1.01] shadow-lg" : ""
                        }`}
                        style={{
                          outline: isMatch ? "3px solid var(--primary)" : undefined,
                          outlineOffset: isMatch ? "2px" : undefined,
                        }}
                      >
                        {displayQuotedContent && (
                          <div
                            onClick={handleScrollToQuoted}
                            className="mb-1.5 rounded-lg border-l-4 border-l-white/60 bg-white/10 px-2.5 py-1.5 text-[11px] text-white/95 select-none max-w-full cursor-pointer hover:bg-white/20 transition"
                          >
                            <div className="font-bold text-[10px] mb-0.5 opacity-90">{displayQuotedSender}</div>
                            <div className="truncate font-medium">{getFriendlyQuotedContent(displayQuotedContent)}</div>
                          </div>
                        )}
                        {renderMessageContent(m.text, handleMediaClick, true, undefined, m.author, activeChat.name)}
                      </div>
                    )}
                  </div>
                  <MessageReactions reactions={m.reactions} side="out" />
                  {/* Metadados (clique) + checks de entrega/leitura (somente envios pela Meta, que confirma de verdade) */}
                  {(() => {
                    const liveStatus = messageStatusOverrides[m.id];
                    const effectiveStatus = liveStatus?.status || m.status;
                    const effectiveError = liveStatus?.error ?? m.errorMessage;
                    const hasTicks = m.provider === "meta" && !m.isInternalNote && !!effectiveStatus;
                    const showTicks = hasTicks && (isLast || isExpanded || effectiveStatus === "failed");
                    if (!isExpanded && !showTicks) return null;
                    return (
                      <span className="mr-1 mt-1 flex items-center gap-1 text-[10px] text-muted-foreground font-medium animate-in fade-in slide-in-from-top-1 duration-150">
                        {isExpanded && <span>{m.author} · {m.time}</span>}
                        {showTicks && <MessageStatusTicks status={effectiveStatus} error={effectiveError} />}
                      </span>
                    );
                  })()}
                </motion.div>
                </React.Fragment>
              );
            }

            // ── Recebidas ─────────────────────────────────────────────────
            const isMatch = matches.length > 0 && matches[searchMatchIndex]?.id === m.id;
            return (
              <React.Fragment key={m.id}>
                {dateLabel && (
                  <div className="flex justify-center my-3">
                    <span className="rounded-full bg-muted px-4 py-1 text-[10px] font-semibold text-muted-foreground border border-border select-none">
                      {dateLabel}
                    </span>
                  </div>
                )}
              <motion.div
                id={`msg-dom-${m.id}`}
                layout
                initial={{ opacity: 0, x: -18, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                className={`flex items-end gap-2 group relative w-full ${gap}`}
              >
                {/* Avatar — só na última mensagem do grupo */}
                {isLast ? (
                  activeChat.avatar ? (
                    <img
                      src={activeChat.avatar}
                      alt=""
                      className="h-7 w-7 shrink-0 rounded-full object-cover border border-border self-end cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setActiveMedia({ type: "image", url: activeChat.avatar })}
                    />
                  ) : (
                    <div
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold text-foreground self-end"
                      style={{ background: activeChat.initialsBg || "#eee" }}
                    >
                      {activeChat.initials || "U"}
                    </div>
                  )
                ) : (
                  <div className="w-7 shrink-0" />
                )}
                <div className="min-w-0 max-w-[80%] flex-1">
                  <div className="flex items-center gap-2">
                    {isSticker ? (
                      <div className="leading-relaxed">
                        {displayQuotedContent && (
                          <div
                            onClick={handleScrollToQuoted}
                            className="mb-1 rounded-lg border-l-4 border-l-primary bg-card/90 border border-border/80 px-2.5 py-1.5 text-[11px] text-muted-foreground select-none max-w-full cursor-pointer hover:bg-card transition shadow-xs"
                          >
                            <div className="font-bold text-[10px] mb-0.5 text-primary">{displayQuotedSender}</div>
                            <div className="truncate font-medium">{getFriendlyQuotedContent(displayQuotedContent)}</div>
                          </div>
                        )}
                        {renderMessageContent(m.text, handleMediaClick, false, handleSaveSticker, m.author, activeChat.name)}
                      </div>
                    ) : isAudioOrDoc && !m.isWarning ? (
                      <div className="flex flex-col items-start gap-1.5">
                        {displayQuotedContent && (
                          <div
                            onClick={handleScrollToQuoted}
                            className="mb-0.5 rounded-lg border-l-4 border-l-primary bg-card/90 border border-border/80 px-2.5 py-1.5 text-[11px] text-muted-foreground select-none max-w-full cursor-pointer hover:bg-card transition shadow-xs"
                          >
                            <div className="font-bold text-[10px] mb-0.5 text-primary">{displayQuotedSender}</div>
                            <div className="truncate font-medium">{getFriendlyQuotedContent(displayQuotedContent)}</div>
                          </div>
                        )}
                        {renderMessageContent(m.text, handleMediaClick, false, undefined, m.author, activeChat.name)}
                      </div>
                    ) : isMedia && !hasCaption && !displayQuotedContent && !m.isWarning ? (
                      <div>{renderMessageContent(m.text, handleMediaClick, false, undefined, m.author, activeChat.name)}</div>
                    ) : isEmojiOnly(m.text) && !displayQuotedContent && !m.isWarning ? (
                      <div className="text-4xl leading-none select-none py-1">{m.text}</div>
                    ) : (
                      <div
                        onClick={onBubbleClick}
                        className={`${inR} ${
                          m.isWarning
                            ? "bg-emerald-500/5 border-emerald-500/10 dark:bg-emerald-950/15 dark:border-emerald-900/30 border-l-4 border-l-primary text-foreground text-[11px]"
                            : "bg-card border-border text-foreground text-sm"
                        } border px-4 py-2.5 leading-relaxed shadow-soft text-left cursor-pointer transition-all duration-300 ${
                          isMatch ? "scale-[1.01] shadow-lg" : ""
                        }`}
                        style={{
                          outline: isMatch ? "3px solid var(--primary)" : undefined,
                          outlineOffset: isMatch ? "2px" : undefined,
                        }}
                      >
                        {m.isWarning && (
                          <div className="flex items-center gap-1.5 text-[9px] font-black uppercase text-primary mb-1 select-none">
                            <AlertCircle className="h-3 w-3 shrink-0" />
                            Aviso de {aiPersona.name}
                          </div>
                        )}
                        {displayQuotedContent && (
                          <div
                            onClick={handleScrollToQuoted}
                            className="mb-1.5 rounded-lg border-l-4 border-l-primary bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground select-none max-w-full cursor-pointer hover:bg-muted/80 transition"
                          >
                            <div className="font-bold text-[10px] mb-0.5 text-primary">{displayQuotedSender}</div>
                            <div className="truncate font-medium">{getFriendlyQuotedContent(displayQuotedContent)}</div>
                          </div>
                        )}
                        {renderMessageContent(m.text, handleMediaClick, false, undefined, m.author, activeChat.name)}

                        {/* Card interativo: Atraso de Resposta */}
                        {m.isWarning && m.warningType === "delay" && m.warningMetadata && (
                          <div
                            className="mt-2.5 p-3 rounded-xl bg-card border border-border/80 shadow-sm flex flex-col gap-2 cursor-default text-xs"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="text-[11px] font-bold text-foreground">
                              Cliente: <span className="text-primary font-black">{m.warningMetadata.clientName}</span>
                            </div>
                            {m.warningMetadata.lastMessage && (
                              <div className="p-2 rounded-lg bg-muted/65 text-[10px] text-muted-foreground border-l-2 border-primary italic">
                                "{m.warningMetadata.lastMessage}"
                              </div>
                            )}
                            <button
                              onClick={() => {
                                setSelectedChatId(m.warningMetadata!.clientId);
                                if (!embedded) setActiveView("chat");
                              }}
                              className="mt-1 flex items-center justify-center gap-1.5 w-full py-1.5 px-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold shadow-soft transition cursor-pointer border-none"
                            >
                              <span>Abrir Conversa</span>
                              <ArrowRight className="h-3 w-3" />
                            </button>
                          </div>
                        )}

                        {/* Card interativo: Novo Cliente (Lead) */}
                        {m.isWarning && m.warningType === "new_lead" && m.warningMetadata && (
                          <div
                            className="mt-2.5 p-3 rounded-xl bg-card border border-border/80 shadow-sm flex flex-col gap-2 cursor-default text-xs"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="text-[11px] font-bold text-foreground flex items-center justify-between gap-2">
                              <span>
                                Cliente: <span className="text-primary font-black">{m.warningMetadata.clientName}</span>
                              </span>
                              {m.warningMetadata.temperature && (
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider ${
                                    m.warningMetadata.temperature === "quente"
                                      ? "bg-red-500/10 text-red-500 border border-red-500/25"
                                      : m.warningMetadata.temperature === "morno"
                                      ? "bg-amber-500/10 text-amber-500 border border-amber-500/25"
                                      : "bg-blue-500/10 text-blue-500 border border-blue-500/25"
                                  }`}
                                >
                                  {m.warningMetadata.temperature}
                                </span>
                              )}
                            </div>
                            {m.warningMetadata.interest && (
                              <div className="text-[10px] text-muted-foreground flex flex-col gap-0.5 bg-muted/40 p-2 rounded-lg">
                                <span className="font-semibold text-foreground text-[8px] uppercase tracking-wider text-muted-foreground">
                                  Interesse:
                                </span>
                                <span>{m.warningMetadata.interest}</span>
                              </div>
                            )}
                            <button
                              onClick={() => {
                                setSelectedChatId(m.warningMetadata!.clientId);
                                if (!embedded) setActiveView("chat");
                              }}
                              className="mt-1 flex items-center justify-center gap-1.5 w-full py-1.5 px-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold shadow-soft transition cursor-pointer border-none"
                            >
                              <span>Abrir Atendimento</span>
                              <ArrowRight className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    <SystemTooltip content="Responder">
                      <button
                        onClick={() => setReplyingTo(m)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-all duration-150 cursor-pointer shrink-0"
                      >
                        <CornerUpLeft className="h-3.5 w-3.5" />
                      </button>
                    </SystemTooltip>
                    <SystemTooltip content="Marcar como evidência do negócio">
                      <button
                        onClick={() => setMarkingEvidenceMsg({ id: m.id, text: m.text, author: m.author, time: m.time })}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-amber-500 transition-all duration-150 cursor-pointer shrink-0"
                      >
                        <Bookmark className="h-3.5 w-3.5" />
                      </button>
                    </SystemTooltip>
                  </div>

                  <MessageReactions reactions={m.reactions} side="in" />

                  {/* Dynamic Suggestions for AI Welcome Message */}
                  {m.id === "val_welcome" && (
                    <div className="mt-2.5 flex flex-col gap-1.5 max-w-sm">
                      {(aiPersona.name === "Fagner"
                        ? [
                            "Quantos atendimentos tenho pendentes?",
                            "Como estão os prazos de SLA da minha fila?",
                            "Quais são meus chamados abertos hoje?",
                          ]
                        : [
                            "Quantos leads tenho sem resposta?",
                            "Quais são meus leads quentes?",
                            "Como está a pontuação atual dos meus atendimentos?",
                          ]
                      ).map((q, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            sendMessage(q);
                          }}
                          className="text-left text-[11px] font-semibold text-primary hover:text-primary-foreground bg-primary/5 hover:bg-primary border border-primary/20 hover:border-primary px-3 py-2 rounded-xl transition duration-150 shadow-soft cursor-pointer flex items-center justify-between group/btn w-full"
                        >
                          <span>{q}</span>
                          <ArrowRight className="h-3 w-3 opacity-60 group-hover/btn:translate-x-0.5 group-hover/btn:opacity-100 transition-all shrink-0 ml-2" />
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Metadados — revelados com clique */}
                  {isExpanded && (
                    <span className="ml-1 mt-1 block text-[10px] text-muted-foreground font-medium animate-in fade-in slide-in-from-top-1 duration-150">
                      {m.author} · {m.time}
                    </span>
                  )}
                </div>
                </motion.div>
              </React.Fragment>
            );
          });
        })()}

        {/* Indicador da IA Digitando */}
        <AnimatePresence>
          {activeChat.id === "valentina" && isValentinaTyping && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              className="flex items-end gap-2 my-2.5 w-full"
            >
              <img
                src={aiPersona.avatarUrl}
                alt={aiPersona.name}
                className="h-7 w-7 rounded-full object-cover border border-border shrink-0 shadow-soft"
              />
              <div className="rounded-2xl rounded-bl-[5px] bg-primary-soft border border-primary/20 px-4 py-2 text-xs font-bold text-primary shadow-soft flex items-center gap-2">
                <span>{aiPersona.name} está digitando</span>
                <motion.span
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                >
                  ...
                </motion.span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Indicador do Cliente Digitando / Gravando Áudio */}
        <AnimatePresence>
          {activeTyping && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              className="flex items-end gap-2 my-2.5 w-full"
            >
              {activeChat.avatar ? (
                <img
                  src={activeChat.avatar}
                  alt=""
                  className="h-7 w-7 shrink-0 rounded-full object-cover border border-border"
                />
              ) : (
                <div
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold text-foreground"
                  style={{ background: activeChat.initialsBg || "#eee" }}
                >
                  {activeChat.initials || "U"}
                </div>
              )}
              <div className="rounded-2xl rounded-bl-[5px] bg-primary-soft border border-primary/20 px-4 py-2 text-xs font-bold text-primary shadow-soft flex items-center gap-2">
                {activeTyping.status === "recording" ? (
                  <>
                    <Mic className="h-3.5 w-3.5 text-red-500 animate-pulse" />
                    <span>gravando áudio...</span>
                  </>
                ) : (
                  <>
                    <span>digitando</span>
                    <motion.span
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.2, repeat: Infinity }}
                    >
                      ...
                    </motion.span>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {/* Floating Quick Replies Menu */}
      <AnimatePresence>
        {(() => {
          const filterText = text.startsWith("/") ? text.slice(1).toLowerCase() : "";
          const filteredQrs = quickResponses.filter((qr) => 
            qr.shortcut.toLowerCase().includes(filterText) ||
            qr.text.toLowerCase().includes(filterText)
          );
          const filteredTpls = (templates || []).filter((tpl) => 
            tpl.title.toLowerCase().includes(filterText) ||
            tpl.text.toLowerCase().includes(filterText)
          );
          const showFloatingMenu = showQuickMenu && (filteredQrs.length > 0 || filteredTpls.length > 0);

          if (!showFloatingMenu) return null;

          return (
            <motion.div
              initial={{ opacity: 0, y: 15, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 15, scale: 0.98 }}
              transition={{ type: "spring", damping: 20, stiffness: 300 }}
              className="absolute bottom-20 left-6 right-6 z-50 rounded-2xl bg-card p-4 border border-border shadow-card max-h-60 overflow-y-auto scrollbar-thin flex flex-col gap-4"
            >
              {filteredQrs.length > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60 border-b border-line mb-1">
                    Respostas Rápidas (Gerais)
                  </div>
                  {filteredQrs.map((qr) => (
                    <button
                      key={qr.id || qr.shortcut}
                      onClick={() => selectQuickResponse(qr.text)}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-muted transition cursor-pointer"
                    >
                      <span className="text-xs font-bold text-primary font-mono">{qr.shortcut}</span>
                      <span className="truncate text-xs text-foreground/80 max-w-[280px] font-medium ml-2">
                        {qr.text}
                      </span>
                      <span className="text-[10px] text-muted-foreground italic shrink-0">
                        {qr.description}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {filteredTpls.length > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60 border-b border-line mb-1">
                    Meus Templates (Individuais)
                  </div>
                  {filteredTpls.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => selectQuickResponse(tpl.text)}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-muted transition cursor-pointer"
                    >
                      <span className="text-xs font-bold text-foreground font-medium">{tpl.title}</span>
                      <span className="truncate text-xs text-muted-foreground max-w-[320px] ml-2">
                        {tpl.text}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          );
        })()}
      </AnimatePresence>


      {/* Message Composer */}
      {activeChat.queue !== "finalizados" ? (
        <div
          ref={composerRef}
          className="hidden md:block px-5 pb-5"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* ── BLOQUEIO: outro operador — oculta TUDO, mostra só o banner ── */}
          {!isOwner && activeChat.operatorId ? (
            <div
              className={`flex flex-col items-center justify-center gap-3 rounded-2xl px-6 py-8 border-2 text-center ${
                tenant === "valem"
                  ? "bg-emerald-50 border-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-700"
                  : "bg-red-50 border-red-300 dark:bg-red-950/30 dark:border-red-700"
              }`}
            >
              <div
                className={`h-12 w-12 rounded-full flex items-center justify-center ${
                  tenant === "valem"
                    ? "bg-emerald-100 dark:bg-emerald-900"
                    : "bg-red-100 dark:bg-red-900"
                }`}
              >
                <Lock
                  className={`h-6 w-6 ${
                    tenant === "valem"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                />
              </div>
              <div>
                <p
                  className={`text-sm font-bold ${
                    tenant === "valem"
                      ? "text-emerald-800 dark:text-emerald-300"
                      : "text-red-800 dark:text-red-300"
                  }`}
                >
                  Atendimento com{" "}
                  <span className="font-extrabold">{ownerOperator?.name ?? "outro operador"}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Somente o operador responsável pode enviar mensagens aqui.
                </p>
              </div>
              {canOverride && (
                <button
                  onClick={() => captureChat(activeChat.id)}
                  className={`mt-1 h-9 rounded-xl text-white text-xs font-bold px-6 transition cursor-pointer ${
                    tenant === "valem"
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  Assumir Atendimento
                </button>
              )}
            </div>
          ) : !activeChat.operatorId && activeChat.queue !== "automacao" ? (
            /* ── BLOQUEIO: fila de espera ── */
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl px-6 py-8 border-2 border-sky-300 bg-sky-50 dark:bg-sky-950/30 dark:border-sky-700 text-center">
              <div className="h-12 w-12 rounded-full flex items-center justify-center bg-sky-100 dark:bg-sky-900">
                <Clock className="h-6 w-6 text-sky-600 dark:text-sky-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-sky-800 dark:text-sky-300">Fila de Espera</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Capture este atendimento para começar a responder o cliente.
                </p>
              </div>
              {canCapture && (
                <button
                  onClick={() => captureChat(activeChat.id)}
                  className="mt-1 h-9 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold px-6 transition cursor-pointer"
                >
                  Capturar Atendimento
                </button>
              )}
            </div>
          ) : activeChat.queue === "automacao" ? (
            /* ── BLOQUEIO: automação ── */
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl px-6 py-8 border-2 border-primary/20 bg-primary-soft/30 dark:bg-primary/10 text-center">
              <div className="h-12 w-12 rounded-full overflow-hidden border-2 border-primary/30 bg-primary-soft flex items-center justify-center shadow-soft">
                <span aria-label={aiPersona.name} className="text-2xl">{aiPersona.avatar}</span>
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Com {aiPersona.name} (I.A)</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {aiPersona.name} está conduzindo este atendimento. Capture para assumir o controle.
                </p>
              </div>
              {canCapture && (
                <button
                  onClick={() => captureChat(activeChat.id)}
                  className="mt-1 h-9 rounded-xl bg-primary hover:opacity-95 text-white text-xs font-bold px-6 transition cursor-pointer shadow-soft"
                >
                  Assumir Atendimento
                </button>
              )}
            </div>
          ) : (
            /* ── COMPOSER NORMAL: sou o dono ── */
            <>
          {/* Drag overlay */}
          {isDragging && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-3xl bg-primary/10 border-2 border-dashed border-primary pointer-events-none">
              <Paperclip className="h-10 w-10 text-primary mb-2 animate-bounce" />
              <p className="text-sm font-bold text-primary">Solte os arquivos aqui</p>
            </div>
          )}

          {/* 4-Mode Selector (Mensagem vs Valentina vs Nota vs Válvulas) */}
          <div className="flex items-center gap-3 pl-2 mb-1.5 text-[11px] font-bold select-none">
            <button
              onClick={() => {
                setMsgMode("client");
                setIsCatalogOpen(false);
              }}
              className={`pb-1 border-b-2 px-1 transition cursor-pointer ${
                !isCatalogOpen && msgMode === "client"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Enviar Mensagem
            </button>
            <button
              onClick={() => setShowValentinaModal(true)}
              className="pb-1 border-b-2 border-transparent px-1 transition cursor-pointer flex items-center gap-1 text-primary hover:opacity-85"
            >
              <Sparkles className="h-3 w-3" />
              <span>{aiPersona.name}</span>
            </button>
            {canSendInternalNotes && (
              <button
                onClick={() => {
                  setMsgMode("internal");
                  setIsCatalogOpen(false);
                }}
                className={`pb-1 border-b-2 px-1 transition cursor-pointer flex items-center gap-1 ${
                  !isCatalogOpen && msgMode === "internal"
                    ? "border-amber-500 text-amber-600 dark:text-amber-400"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Lock className="h-3 w-3 text-amber-500" />
                <span>Nota Interna</span>
              </button>
            )}
            <button
              onClick={() => setIsCatalogOpen((v) => !v)}
              className={`pb-1 border-b-2 px-1 transition cursor-pointer flex items-center gap-1 ${
                isCatalogOpen
                  ? "border-primary text-primary font-extrabold"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Package className="h-3 w-3" />
              <span>{tenant === "tecfag" ? "Catálogo" : "Válvulas"}</span>
            </button>
          </div>

          {isCatalogOpen ? (
            <ProductCatalogPicker
              tenantId={tenant}
              onAttachFiles={handleAttachCatalogFiles}
              onClose={() => setIsCatalogOpen(false)}
            />
          ) : (
            <>
              {/* Audio preview panel */}
          {recordingState === "preview" && audioUrl && (
            <div className="flex items-center gap-3 mb-3 px-1 animate-in slide-in-from-bottom-2 duration-200">
              <div className="flex-1">
                <AudioBubble src={audioUrl} fileName="Áudio gravado" />
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={discardRecording}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border bg-card text-muted-foreground hover:text-destructive hover:border-destructive transition cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Descartar gravação</TooltipContent>
              </Tooltip>
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
                    <div
                      className={`h-9 w-9 shrink-0 grid place-items-center rounded-lg ${getFileColor(file)}`}
                    >
                      {getFileIcon(file)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold text-foreground max-w-[100px]">
                      {file.name}
                    </p>
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
                  {getFriendlyQuotedContent(replyingTo.text)}
                </div>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setReplyingTo(null)}
                    className="p-1 rounded-full hover:bg-muted text-muted-foreground transition shrink-0 cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Cancelar resposta</TooltipContent>
              </Tooltip>
            </div>
          )}

          {activeProvider === "meta" && activeChat.channel === "whatsapp" && msgMode !== "internal" && (
            <div className="mb-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {metaWindow === null ? "Consultando janela de atendimento da Meta..." : metaWindow.open
                    ? `Texto livre permitido até ${new Date(metaWindow.expiresAt!).toLocaleString("pt-BR")}. Mensagens entregues podem gerar cobrança.`
                    : "Janela de 24 horas encerrada. Para retomar, envie um template aprovado."}
                </span>
                <button type="button" onClick={loadMetaTemplates} className="font-semibold text-primary underline">Templates Meta</button>
              </div>
              {showMetaTemplates && (
                <div className="mt-3 space-y-2">
                  <select
                    value={selectedMetaTemplate}
                    onChange={(event) => {
                      const value = event.target.value;
                      const item = metaTemplates.find((template) => `${template.name}:${template.language}` === value);
                      setSelectedMetaTemplate(value);
                      setMetaTemplateParameters(Array(item?.variableCount || 0).fill(""));
                    }}
                    className="w-full rounded-lg border border-border bg-background p-2"
                  >
                    <option value="">Selecione um template aprovado</option>
                    {metaTemplates.map((item) => <option key={`${item.name}:${item.language}`} value={`${item.name}:${item.language}`}>{item.name} · {item.language} · {item.category}</option>)}
                  </select>
                  {selectedMetaTemplate && <p className="text-muted-foreground">{metaTemplates.find((item) => `${item.name}:${item.language}` === selectedMetaTemplate)?.bodyText}</p>}
                  {metaTemplateParameters.map((value, index) => (
                    <input
                      key={index}
                      value={value}
                      onChange={(event) => setMetaTemplateParameters((previous) => previous.map((entry, i) => i === index ? event.target.value : entry))}
                      placeholder={`Variável {{${index + 1}}}`}
                      className="w-full rounded-lg border border-border bg-background p-2"
                    />
                  ))}
                  <button type="button" onClick={sendSelectedMetaTemplate} className="rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground">Enviar template</button>
                </div>
              )}
            </div>
          )}

          <div
            className={`relative flex items-end gap-3 rounded-2xl px-4 py-3 shadow-soft border transition-all duration-200 ${
              recordingState === "recording"
                ? "border-primary/40 bg-primary/5"
                : msgMode === "internal"
                  ? "bg-amber-500/10 border-amber-500/30 dark:bg-amber-950/30 dark:border-amber-500/40"
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
                if (files.length > 0) setAttachments((prev) => appendUniqueFiles(prev, files));
                e.target.value = "";
              }}
            />

            {/* Recording: inline waveform */}
            {recordingState === "recording" ? (
              <>
                <div className="flex items-center gap-[3px] shrink-0 mb-1">
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
                <span className="text-sm font-bold text-primary tabular-nums flex-1 mb-1">
                  {fmtSec(recordingSeconds)}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={stopRecording}
                      className="grid h-8 w-8 place-items-center rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition shadow-soft cursor-pointer mb-0.5"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Parar gravação</TooltipContent>
                </Tooltip>
              </>
            ) : (
              <>
                <textarea
                  ref={inputRef}
                  placeholder={
                    msgMode === "internal"
                      ? "Escreva uma nota interna (visível apenas para vendedores)..."
                      : "Escreva sua mensagem... (digite '/' para respostas rápidas)"
                  }
                  value={text}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none resize-none overflow-y-auto leading-relaxed py-2 max-h-[160px] min-h-[36px] scrollbar-thin"
                />
                
                {/* Icons container to vertically align icons with the send button */}
                <div className="flex items-center gap-3 shrink-0 h-9">
                  {/* Quick Template Icon */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <motion.button
                        onClick={() => setShowQuickMenu(!showQuickMenu)}
                        whileHover={{ scale: 1.15 }}
                        whileTap={{ scale: 0.88 }}
                        animate={{ rotate: showQuickMenu ? -15 : 0 }}
                        className={`transition cursor-pointer ${
                          msgMode === "internal"
                            ? "text-amber-500 hover:text-amber-700"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Zap className="h-4.5 w-4.5" strokeWidth={2} />
                      </motion.button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Respostas Rápidas</TooltipContent>
                  </Tooltip>
                  {/* Emoji Picker Trigger */}
                  <div className="relative flex items-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <motion.button
                          onClick={() => setShowEmojiPicker((v) => !v)}
                          whileHover={{ scale: 1.15 }}
                          whileTap={{ scale: 0.88 }}
                          animate={{ rotate: showEmojiPicker ? 15 : 0 }}
                          className="text-muted-foreground hover:text-foreground cursor-pointer transition"
                        >
                          <Smile className="h-4.5 w-4.5" strokeWidth={1.75} />
                        </motion.button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Emojis</TooltipContent>
                    </Tooltip>
                    <AnimatePresence>
                      {showEmojiPicker && (
                        <EmojiPicker
                          onSelect={(emoji) => {
                            setText((prev) => prev + emoji);
                            inputRef.current?.focus();
                          }}
                          onClose={() => setShowEmojiPicker(false)}
                          onSelectSticker={handleSendSticker}
                        />
                      )}
                    </AnimatePresence>
                  </div>
                  {/* Attachment Button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <motion.button
                        onClick={() => fileInputRef.current?.click()}
                        whileHover={{ scale: 1.15 }}
                        whileTap={{ scale: 0.88 }}
                        className={`cursor-pointer transition relative ${
                          attachments.length > 0
                            ? "text-primary"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Paperclip className="h-4.5 w-4.5" strokeWidth={1.75} />
                        {attachments.length > 0 && (
                          <span className="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 grid place-items-center rounded-full bg-primary text-[8px] font-bold text-white">
                            {attachments.length}
                          </span>
                        )}
                      </motion.button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Anexar arquivo</TooltipContent>
                  </Tooltip>
                  {/* Mic button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <motion.button
                        onClick={startRecording}
                        whileHover={{ scale: 1.15 }}
                        whileTap={{ scale: 0.88 }}
                        className="text-muted-foreground hover:text-primary transition cursor-pointer"
                      >
                        <Mic className="h-4.5 w-4.5" strokeWidth={1.75} />
                      </motion.button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Gravar áudio</TooltipContent>
                  </Tooltip>
                </div>
              </>
            )}

            {/* Send — always visible */}
            <motion.button
              onClick={handleSend}
              disabled={isSending}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.94 }}
              className={`grid h-9 w-9 place-items-center rounded-xl transition cursor-pointer text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-60 ${
                msgMode === "internal" ? "bg-amber-500" : "bg-primary"
              }`}
            >
              {msgMode === "internal" ? <Lock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            </motion.button>
          </div>
            </>
          )}
          </>
          )}
        </div>
      ) : (
        <div className="px-5 pb-5 text-center flex flex-col items-center justify-center gap-3 py-6 border-t border-line bg-muted/20 rounded-b-3xl">
          <p className="text-xs text-muted-foreground italic">
            Este atendimento foi encerrado. Reative-o para iniciar uma nova conversa com o cliente.
          </p>
          <motion.button
            onClick={() => captureChat(activeChat.id)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-xs font-bold text-white shadow-soft transition hover:opacity-90 active:scale-98 cursor-pointer"
          >
            <CheckCircle className="h-4 w-4" />
            Reativar Atendimento
          </motion.button>
        </div>
      )}

      {activeMedia && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xs transition-all duration-200 animate-in fade-in"
          onClick={() => setActiveMedia(null)}
        >
          {/* Close button */}
          <SystemTooltip content="Fechar">
            <button
              className="absolute top-4 right-4 z-50 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer hover:scale-105 active:scale-95"
              onClick={() => setActiveMedia(null)}
            >
              <X className="h-6 w-6" />
            </button>
          </SystemTooltip>

          {/* Media container */}
          <div
            className="relative max-w-[90vw] max-h-[85vh] flex flex-col items-center justify-center animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {activeMedia.type === "image" ? (
              <img
                src={activeMedia.url}
                alt="Visualização"
                className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl select-none"
              />
            ) : (
              <video
                src={activeMedia.url}
                controls
                autoPlay
                className="max-w-full max-h-[80vh] rounded-xl shadow-2xl"
              />
            )}

            {/* Download Button */}
            <div className="mt-4 flex justify-center">
              <a
                href={activeMedia.url}
                download
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/10 backdrop-blur-xs transition-all hover:scale-102 active:scale-98 cursor-pointer shadow-soft"
                onClick={(e) => e.stopPropagation()}
              >
                <Download className="h-4 w-4" />
                Baixar Mídia
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Valentina Assistant Modal */}
      <ValentinaAssistantModal
        isOpen={showValentinaModal}
        onClose={() => setShowValentinaModal(false)}
        conversationId={activeChat?.id || ""}
        contactName={activeChat?.name}
        currentDraftText={text}
        recentMessages={activeChat?.messages}
        tenantId={tenant}
        operatorName={operatorProfile?.name || "Vendedor"}
        onApplyText={handleApplyValentinaText}
      />

      {/* Modal de Marcação de Evidência Comercial */}
      {activeChat && (
        <MarkEvidenceModal
          isOpen={!!markingEvidenceMsg}
          onClose={() => setMarkingEvidenceMsg(null)}
          message={markingEvidenceMsg}
          conversationId={activeChat.id}
        />
      )}

      {/* Modal de Confirmação de Finalização de Atendimento */}
      <AnimatePresence>
        {showFinishConfirmModal && activeChat && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none animate-in fade-in duration-150"
            onClick={() => setShowFinishConfirmModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="w-full max-w-md rounded-3xl bg-card border border-border p-6 shadow-card flex flex-col gap-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 border border-primary/20 text-primary">
                  <CheckCircle className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-extrabold text-foreground">
                    Finalizar Atendimento?
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Você está prestes a encerrar o atendimento com <strong className="text-foreground font-bold">{activeChat.name}</strong>. A conversa será movida para a aba de <span className="text-primary font-semibold">Finalizados</span>.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl bg-muted/40 border border-border p-3.5 flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                <span className="text-[11px] text-muted-foreground font-medium">
                  Você poderá reativar ou transferir este atendimento a qualquer momento no histórico.
                </span>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowFinishConfirmModal(false)}
                  className="h-10 rounded-xl border border-border bg-card px-4 text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
                >
                  Continuar Atendendo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowFinishConfirmModal(false);
                    finishChat(activeChat.id);
                  }}
                  className="h-10 rounded-xl bg-primary px-5 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer shadow-soft flex items-center gap-1.5"
                >
                  <CheckCircle className="h-4 w-4" />
                  Sim, Finalizar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

