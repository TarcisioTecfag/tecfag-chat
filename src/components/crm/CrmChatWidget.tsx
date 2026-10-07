import React, { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ArrowLeft,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  FileText,
  Forward,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  Lock,
  Maximize2,
  MessageCircle,
  MessageSquare,
  MessageSquareDashed,
  Mic,
  Minus,
  Paperclip,
  Pause,
  Pin,
  Play,
  Search,
  Send,
  Sparkles,
  User,
  Video as VideoIcon,
  X,
} from "lucide-react";
import {
  InstagramLogo,
  MessengerLogo,
  WhatsappLogo,
} from "@/components/chat/ChatList";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useChat } from "@/hooks/useChatState";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePermissions } from "@/hooks/usePermissions";
import { getAiPersona } from "@/lib/ai-persona";
import {
  MetaTemplateSelectModal,
  type ApprovedMetaTemplate,
} from "@/components/chat/MetaTemplateSelectModal";
import { toast } from "sonner";
import type { Conversation, Message } from "@/lib/mockData";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

// Cores determinísticas e vibrantes para avatares sem foto
const AVATAR_PALETTE = [
  "linear-gradient(135deg, #ef4444, #b91c1c)",
  "linear-gradient(135deg, #3b82f6, #1d4ed8)",
  "linear-gradient(135deg, #10b981, #047857)",
  "linear-gradient(135deg, #f59e0b, #b45309)",
  "linear-gradient(135deg, #8b5cf6, #6d28d9)",
  "linear-gradient(135deg, #ec4899, #be185d)",
  "linear-gradient(135deg, #06b6d4, #0e7490)",
  "linear-gradient(135deg, #6366f1, #4338ca)",
];

function getAvatarBg(name: string, fallback?: string): string {
  if (fallback && fallback !== "#eee") return fallback;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[index];
}

function previewSnippet(text: string) {
  if (!text) return "Sem mensagens";
  if (!text.startsWith("[MEDIA:") && !text.startsWith("[LOCAL_MEDIA:")) return text;
  const type = text.match(/^\[(?:LOCAL_)?MEDIA:([^\]:]+)/)?.[1];
  const labels: Record<string, string> = {
    image: "Imagem",
    video: "Vídeo",
    audio: "Áudio",
    document: "Documento",
    sticker: "Figurinha",
  };
  const caption = text.includes("\n") ? text.slice(text.indexOf("\n") + 1).trim() : "";
  return `${labels[type || ""] || "Mídia"}${caption ? `: ${caption}` : ""}`;
}

function renderTextWithLinks(text: string, isMe?: boolean) {
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const parts = text.split(urlRegex);

  return parts.map((part, index) => {
    if (part.match(urlRegex)) {
      let url = part;
      let trailing = "";
      const lastChar = url.slice(-1);
      if ([".", ",", "!", "?", ";", ")", "]", "}"].includes(lastChar)) {
        trailing = lastChar;
        url = url.slice(0, -1);
      }
      let href = url;
      if (url.toLowerCase().startsWith("www.")) {
        href = `https://${url}`;
      }
      const linkClass = isMe
        ? "underline font-semibold break-all text-white/95 hover:text-white decoration-white/70"
        : "underline font-semibold break-all text-primary hover:opacity-85 decoration-primary/70";

      return (
        <React.Fragment key={index}>
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
        </React.Fragment>
      );
    }
    return part;
  });
}

function CustomerAvatar({
  avatar,
  name,
  initials,
  initialsBg,
  channel,
  size = "md",
  showChannel = true,
  className = "",
}: {
  avatar?: string;
  name: string;
  initials?: string;
  initialsBg?: string;
  channel?: string;
  size?: "xs" | "sm" | "md" | "lg";
  showChannel?: boolean;
  className?: string;
}) {
  const [imgError, setImgError] = useState(false);

  const sizeClasses = {
    xs: "h-6 w-6 text-[9px]",
    sm: "h-7 w-7 text-[10px]",
    md: "h-9 w-9 text-xs",
    lg: "h-10 w-10 text-sm",
  };

  const badgeSizes = {
    xs: "h-2.5 w-2.5 -bottom-0.5 -right-0.5",
    sm: "h-3 w-3 -bottom-0.5 -right-0.5",
    md: "h-3.5 w-3.5 -bottom-0.5 -right-0.5",
    lg: "h-4 w-4 -bottom-0.5 -right-0.5",
  };

  const iconSizes = {
    xs: "h-1.5 w-1.5",
    sm: "h-2 w-2",
    md: "h-2 w-2",
    lg: "h-2.5 w-2.5",
  };

  const computedInitials =
    initials ||
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() ||
    "CL";

  const bg = getAvatarBg(name, initialsBg);

  return (
    <div className={`relative shrink-0 select-none ${className}`}>
      {avatar && !imgError ? (
        <img
          src={avatar}
          alt={name}
          onError={() => setImgError(true)}
          className={`${sizeClasses[size]} rounded-full object-cover border border-border/80 shadow-xs`}
        />
      ) : (
        <div
          className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-bold text-primary bg-primary/10 border border-primary/20 shadow-xs`}
        >
          {computedInitials}
        </div>
      )}

      {showChannel && (
        <span
          className={`absolute ${badgeSizes[size]} flex items-center justify-center rounded-full border border-card text-primary-foreground shadow-xs bg-primary`}
          title={channel ? channel.toUpperCase() : "WhatsApp"}
        >
          {channel === "whatsapp" ? (
            <WhatsappLogo className={iconSizes[size]} />
          ) : channel === "instagram" ? (
            <InstagramLogo className={iconSizes[size]} />
          ) : channel === "messenger" ? (
            <MessengerLogo className={iconSizes[size]} />
          ) : (
            <MessageCircle className={iconSizes[size]} />
          )}
        </span>
      )}
    </div>
  );
}

function MiniAudioBubble({ src, isMe }: { src: string; isMe: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      void a.play();
      setPlaying(true);
    }
  };

  const fmt = (s: number) => {
    if (!isFinite(s) || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const pct = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div
      className={`flex items-center gap-2 rounded-xl px-2.5 py-2 min-w-[200px] max-w-[240px] select-none ${
        isMe
          ? "bg-white/10 text-primary-foreground border border-white/15"
          : "bg-muted/70 text-foreground border border-border"
      }`}
    >
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
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pausar áudio" : "Tocar áudio"}
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-transform active:scale-95 ${
          isMe
            ? "bg-white text-primary hover:bg-white/90"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        }`}
      >
        {playing ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current ml-0.5" />}
      </button>
      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <div className="relative h-1 w-full rounded-full bg-black/15 overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-100 ${
              isMe ? "bg-white" : "bg-primary"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[9px] opacity-75 font-mono">
          <span>{fmt(current)}</span>
          <span>{duration > 0 ? fmt(duration) : <Mic className="h-2.5 w-2.5" />}</span>
        </div>
      </div>
    </div>
  );
}

function MiniMediaRenderer({
  text,
  isMe,
  onImageClick,
}: {
  text: string;
  isMe: boolean;
  onImageClick?: (url: string) => void;
}) {
  const newlineIndex = text.indexOf("\n");
  const mediaTag = newlineIndex !== -1 ? text.slice(0, newlineIndex).trim() : text.trim();
  const captionText = newlineIndex !== -1 ? text.slice(newlineIndex + 1).trim() : "";

  // 1) Local Media
  if (mediaTag.startsWith("[LOCAL_MEDIA:")) {
    const rest = mediaTag.slice("[LOCAL_MEDIA:".length);
    const typeEnd = rest.indexOf(":");
    const type = rest.slice(0, typeEnd);
    const afterType = rest.slice(typeEnd + 1);
    const lastColon = afterType.lastIndexOf(":");
    const blobUrl = afterType.slice(0, lastColon);
    const fileName = afterType.slice(lastColon + 1).replace(/\]$/, "");

    if (type === "image") {
      return (
        <div className="space-y-1.5">
          <div
            onClick={() => (onImageClick ? onImageClick(blobUrl) : window.open(blobUrl, "_blank"))}
            className="group relative overflow-hidden rounded-xl border border-white/20 bg-black/10 cursor-pointer max-h-48"
          >
            <img src={blobUrl} alt={fileName} className="max-h-48 w-full object-cover rounded-xl transition group-hover:scale-[1.02]" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-colors">
              <Maximize2 className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
            </div>
          </div>
          {captionText && <p className="text-xs leading-relaxed">{renderTextWithLinks(captionText, isMe)}</p>}
        </div>
      );
    }

    if (type === "audio") {
      return (
        <div className="space-y-1">
          <MiniAudioBubble src={blobUrl} isMe={isMe} />
          {captionText && <p className="text-xs leading-relaxed">{renderTextWithLinks(captionText, isMe)}</p>}
        </div>
      );
    }

    return (
      <div className="space-y-1.5">
        <a
          href={blobUrl}
          target="_blank"
          rel="noopener noreferrer"
          download={fileName}
          className={`flex items-center gap-2 rounded-xl p-2 text-xs border ${
            isMe ? "bg-white/10 border-white/20 text-white" : "bg-muted border-border text-foreground"
          }`}
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate flex-1 font-medium text-[11px]">{fileName || "Documento"}</span>
          <Download className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </a>
        {captionText && <p className="text-xs leading-relaxed">{renderTextWithLinks(captionText, isMe)}</p>}
      </div>
    );
  }

  // 2) Baileys Media
  if (mediaTag.startsWith("[MEDIA:")) {
    const match = mediaTag.match(/^\[MEDIA:(image|video|audio|document|sticker)\]([^:]+)(?::(.+))?$/);
    if (match) {
      const [, type, messageId, extra] = match;
      const mediaUrl = `${BACKEND_URL}/api/baileys/media?messageId=${messageId}`;

      if (type === "image") {
        return (
          <div className="space-y-1.5">
            <div
              onClick={() => (onImageClick ? onImageClick(mediaUrl) : window.open(mediaUrl, "_blank"))}
              className="group relative overflow-hidden rounded-xl border border-border/40 bg-black/10 cursor-pointer max-h-48"
            >
              <img src={mediaUrl} alt="Imagem" className="max-h-48 w-full object-cover rounded-xl transition group-hover:scale-[1.02]" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-colors">
                <Maximize2 className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
              </div>
            </div>
            {captionText && <p className="text-xs leading-relaxed">{renderTextWithLinks(captionText, isMe)}</p>}
          </div>
        );
      }

      if (type === "sticker") {
        return (
          <img src={mediaUrl} alt="Figurinha" className="h-28 w-28 object-contain drop-shadow" />
        );
      }

      if (type === "audio") {
        return (
          <div className="space-y-1">
            <MiniAudioBubble src={mediaUrl} isMe={isMe} />
            {captionText && <p className="text-xs leading-relaxed">{renderTextWithLinks(captionText, isMe)}</p>}
          </div>
        );
      }

      if (type === "video") {
        return (
          <div className="space-y-1.5">
            <div
              onClick={() => window.open(mediaUrl, "_blank")}
              className="group relative overflow-hidden rounded-xl border border-border/40 bg-black/20 cursor-pointer max-h-44 flex items-center justify-center"
            >
              <video src={mediaUrl} className="max-h-44 w-full object-cover pointer-events-none" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/35 transition">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-white/90 text-slate-800 shadow">
                  <Play className="h-4 w-4 fill-slate-800 ml-0.5" />
                </div>
              </div>
            </div>
            {captionText && <p className="text-xs leading-relaxed">{renderTextWithLinks(captionText, isMe)}</p>}
          </div>
        );
      }

      // document
      const fileName = extra || "Documento";
      return (
        <div className="space-y-1.5">
          <a
            href={mediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            download={fileName}
            className={`flex items-center gap-2 rounded-xl p-2 text-xs border transition hover:opacity-90 ${
              isMe ? "bg-white/10 border-white/20 text-white" : "bg-muted border-border text-foreground"
            }`}
          >
            <FileText className="h-4 w-4 shrink-0" />
            <span className="truncate flex-1 font-medium text-[11px]">{fileName}</span>
            <Download className="h-3.5 w-3.5 shrink-0 opacity-70" />
          </a>
          {captionText && <p className="text-xs leading-relaxed">{renderTextWithLinks(captionText, isMe)}</p>}
        </div>
      );
    }
  }

  // 3) Texto comum com links
  return <p className="whitespace-pre-wrap break-words">{renderTextWithLinks(text, isMe)}</p>;
}

/**
 * CrmChatWidget — Redesign completo do Mini Chat Flutuante
 * Harmonia com o sistema dark, animações Framer Motion, balões com estética WhatsApp/SaaS,
 * avatares dinâmicos com badges dos canais e responsividade.
 */
export function CrmChatWidget() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "thread">("list");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [metaWindowOpen, setMetaWindowOpen] = useState<boolean | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const {
    activeProvider,
    activeView,
    conversations,
    currentOperatorId,
    isAuthenticated,
    markAsRead,
    markAsUnread,
    operatorProfile,
    operators,
    pinChat,
    selectedChatId,
    sendMessage,
    setActiveView,
    setSelectedChatId,
    tenant,
    transferChat,
  } = useChat();
  const { canAccessView, canViewCrm } = usePermissions();

  const aiPersona = getAiPersona(tenant || "valem");
  const aiConversation = conversations.find((conversation) => conversation.id === "valentina");

  // Lista de conversas arquivadas localmente apenas no Mini Chat
  const archivedKey = `mini_chat_archived_${currentOperatorId || "global"}`;
  const [archivedIds, setArchivedIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem(archivedKey);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const archiveFromMiniChat = (id: string) => {
    setArchivedIds((prev) => {
      const updated = prev.includes(id) ? prev : [...prev, id];
      try {
        localStorage.setItem(archivedKey, JSON.stringify(updated));
      } catch (e) {
        console.error("Erro ao salvar arquivados do mini chat:", e);
      }
      return updated;
    });
    toast.success("Conversa arquivada do mini chat");
  };

  const unarchiveInMiniChat = (id: string) => {
    setArchivedIds((prev) => {
      if (!prev.includes(id)) return prev;
      const updated = prev.filter((item) => item !== id);
      try {
        localStorage.setItem(archivedKey, JSON.stringify(updated));
      } catch (e) {
        console.error("Erro ao atualizar arquivados do mini chat:", e);
      }
      return updated;
    });
  };

  // Context Menu (Right Click)
  const [contextMenu, setContextMenu] = useState<{
    chatId: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const handleClose = () => setContextMenu(null);
    window.addEventListener("click", handleClose);
    return () => window.removeEventListener("click", handleClose);
  }, []);

  // Modal de Transferência
  const [transferTargetChat, setTransferTargetChat] = useState<Conversation | null>(null);
  const [transferSearch, setTransferSearch] = useState("");
  const [transferSubmitting, setTransferSubmitting] = useState(false);

  const handleExecuteTransfer = async (targetOpId: string) => {
    if (!transferTargetChat || transferSubmitting) return;
    setTransferSubmitting(true);
    try {
      const ok = await transferChat(transferTargetChat.id, null, targetOpId);
      if (ok) {
        setTransferTargetChat(null);
        setTransferSearch("");
        if (selectedChatId === transferTargetChat.id) {
          setView("list");
          setSelectedChatId(null);
        }
      }
    } finally {
      setTransferSubmitting(false);
    }
  };

  // Templates Meta Aprovados
  const [metaTemplates, setMetaTemplates] = useState<ApprovedMetaTemplate[]>([]);
  const [metaTemplatesLoading, setMetaTemplatesLoading] = useState(false);
  const [showMetaTemplateModal, setShowMetaTemplateModal] = useState(false);

  const loadMetaTemplates = async (convId: string) => {
    setMetaTemplatesLoading(true);
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/whatsapp/meta-state?conversationId=${encodeURIComponent(convId)}&templates=1`,
        { credentials: "include" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao carregar templates da Meta");
      setMetaTemplates(
        (data.templates || []).filter((item: { supported: boolean }) => item.supported)
      );
      if (data.window) setMetaWindowOpen(data.window.open === true);
    } catch (err: any) {
      toast.error(err.message || "Erro ao consultar templates aprovados");
    } finally {
      setMetaTemplatesLoading(false);
    }
  };

  const handleSendMetaTemplate = async (
    template: ApprovedMetaTemplate,
    parameters: string[],
  ): Promise<boolean> => {
    try {
      const sent = await sendMessage("", false, undefined, null, {
        name: template.name,
        language: template.language,
        parameters: parameters.map((v) => v.trim()),
      });
      if (sent) {
        setShowMetaTemplateModal(false);
        setMetaWindowOpen(true);
        toast.success("Template Meta enviado com sucesso!");
        return true;
      }
      return false;
    } catch (err: any) {
      toast.error(err.message || "Falha ao disparar template");
      return false;
    }
  };

  const isChatView =
    location.pathname === "/chat" ||
    (location.pathname === "/" && activeView === "chat");

  const [isSuppressed, setIsSuppressed] = useState(false);

  useEffect(() => {
    const handleSuppressed = (event: Event) => {
      const custom = event as CustomEvent<{ suppressed?: boolean }>;
      setIsSuppressed(Boolean(custom.detail?.suppressed));
    };
    window.addEventListener("crm:set-chat-widget-suppressed", handleSuppressed);
    return () => window.removeEventListener("crm:set-chat-widget-suppressed", handleSuppressed);
  }, []);

  // Publicar estado do mini chat para que useChatState saiba se a conversa está visível na tela
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__miniChatState = {
        open,
        selectedChatId: view === "thread" ? selectedChatId : null,
      };
    }
  }, [open, view, selectedChatId]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") {
        (window as any).__miniChatState = { open: false, selectedChatId: null };
      }
    };
  }, []);

  const visible =
    isAuthenticated &&
    !isMobile &&
    !isChatView &&
    canAccessView("chat") &&
    !isSuppressed;

  const assigned = conversations.filter(
    (conversation) =>
      conversation.id !== "valentina" &&
      !archivedIds.includes(conversation.id) &&
      ((conversation.queue === "meus" && conversation.operatorId === currentOperatorId) ||
       (conversation.walletOperatorId === currentOperatorId && conversation.queue !== "finalizados")),
  );

  const selected =
    view === "thread"
      ? (selectedChatId === "valentina"
          ? (aiConversation || ({
              id: "valentina",
              name: aiPersona.name,
              avatar: aiPersona.avatarUrl,
              channel: "whatsapp",
              queue: "meus",
              messages: [],
              lastMessageTime: "Agora",
              unreadCount: 0,
            } as any))
          : conversations.find((conversation) => conversation.id === selectedChatId))
      : undefined;

  const query = search.trim().toLocaleLowerCase("pt-BR");
  const filtered = [...assigned]
    .sort((a, b) => {
      const aPinned = (a as any).pinned ? 1 : 0;
      const bPinned = (b as any).pinned ? 1 : 0;
      return bPinned - aPinned;
    })
    .filter(
      (conversation) =>
        !query ||
        conversation.name.toLocaleLowerCase("pt-BR").includes(query) ||
        conversation.phone?.includes(query),
    );

  const showAiAssistant =
    !query ||
    aiPersona.name.toLocaleLowerCase("pt-BR").includes(query) ||
    "ia".includes(query) ||
    "assistente".includes(query) ||
    "fagner".includes(query) ||
    "valentina".includes(query);

  const unread = assigned.reduce(
    (total, conversation) => total + (conversation.unreadCount || 0),
    0,
  );

  // Resetar ao trocar de tenant
  useEffect(() => {
    setOpen(false);
    setView("list");
    setDraft("");
    setSearch("");
  }, [tenant]);

  // Fechar no Escape
  useEffect(() => {
    if (!open || !visible) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        if (transferTargetChat) {
          setTransferTargetChat(null);
        } else if (showMetaTemplateModal) {
          setShowMetaTemplateModal(false);
        } else if (contextMenu) {
          setContextMenu(null);
        } else if (previewImage) {
          setPreviewImage(null);
        } else if (view === "thread") {
          setView("list");
        } else {
          setOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, visible, view, previewImage, contextMenu, transferTargetChat, showMetaTemplateModal]);

  // Listener para eventos globais crm:open-mini-chat
  useEffect(() => {
    const handleOpenMiniChat = (event: Event) => {
      const custom = event as CustomEvent<{
        conversationId?: string;
        phone?: string;
        name?: string;
      }>;
      setOpen(true);
      if (custom.detail?.conversationId) {
        unarchiveInMiniChat(custom.detail.conversationId);
        setSelectedChatId(custom.detail.conversationId);
        markAsRead(custom.detail.conversationId);
        setView("thread");
      } else if (custom.detail?.phone) {
        const cleanPhone = custom.detail.phone.replace(/\D/g, "");
        const found = conversations.find((c) => {
          const cPhone = c.phone?.replace(/\D/g, "");
          return cPhone && cleanPhone && (cPhone.includes(cleanPhone) || cleanPhone.includes(cPhone));
        });
        if (found) {
          unarchiveInMiniChat(found.id);
          setSelectedChatId(found.id);
          markAsRead(found.id);
          setView("thread");
        }
      }
    };

    window.addEventListener("crm:open-mini-chat", handleOpenMiniChat);
    return () => window.removeEventListener("crm:open-mini-chat", handleOpenMiniChat);
  }, [conversations, markAsRead, setSelectedChatId]);

  // Validação de janela de 24h na Meta API
  useEffect(() => {
    if (!open || activeProvider !== "meta" || selected?.channel !== "whatsapp") {
      setMetaWindowOpen(null);
      return;
    }
    const conversationId = selected.id;
    let cancelled = false;
    setMetaWindowOpen(null);
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/whatsapp/meta-state?conversationId=${encodeURIComponent(conversationId)}`,
          { credentials: "include" },
        );
        const data = response.ok ? await response.json() : null;
        if (!cancelled)
          setMetaWindowOpen(
            data?.activeProvider === "meta" ? data.window?.open === true : response.ok,
          );
      } catch {
        if (!cancelled) setMetaWindowOpen(false);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, activeProvider, selected?.id, selected?.channel]);

  // Scroll automático ao final da conversa
  useEffect(() => {
    if (open && view === "thread") {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [open, view, selected?.id, selected?.messages.length]);

  // Posição horizontal do widget (distância em px a partir da borda direita da viewport)
  const STORAGE_KEY = "crm_chat_widget_right_offset";
  const [rightOffset, setRightOffset] = useState<number>(() => {
    if (typeof window === "undefined") return 20;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        const val = parseFloat(saved);
        if (!isNaN(val) && isFinite(val) && val >= 0) return val;
      }
    } catch {}
    return 20;
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragInfoRef = useRef<{
    startX: number;
    initialRight: number;
    moved: boolean;
  }>({ startX: 0, initialRight: 20, moved: false });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const startDrag = (e: React.PointerEvent) => {
    // Permite apenas o botão principal (esquerdo) ou toque
    if (e.button !== 0) return;

    const target = e.target as HTMLElement;
    const isMainTrigger = Boolean(target.closest("[data-drag-trigger]"));
    // Se não for o botão principal e for um elemento interativo interno, não inicia arrasto
    if (!isMainTrigger && target.closest("button, input, textarea, a, select")) {
      return;
    }

    e.preventDefault();
    dragInfoRef.current = {
      startX: e.clientX,
      initialRight: rightOffset,
      moved: false,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - dragInfoRef.current.startX;
      if (!dragInfoRef.current.moved && Math.abs(deltaX) > 3) {
        dragInfoRef.current.moved = true;
        setIsDragging(true);
      }

      if (dragInfoRef.current.moved) {
        const buttonWidth = buttonRef.current?.offsetWidth || 170;
        const minRight = 16;
        const maxRight = Math.max(minRight, window.innerWidth - buttonWidth - 16);
        // deltaX < 0 significa que arrastou para a esquerda -> aumenta a distância da direita
        const newRight = dragInfoRef.current.initialRight - deltaX;
        const clamped = Math.max(minRight, Math.min(newRight, maxRight));
        setRightOffset(clamped);
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);

      if (dragInfoRef.current.moved) {
        setIsDragging(false);
        setRightOffset((current) => {
          try {
            localStorage.setItem(STORAGE_KEY, current.toString());
          } catch {}
          return current;
        });
        setTimeout(() => {
          dragInfoRef.current.moved = false;
        }, 80);
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  // Ajusta automaticamente a posição caso a janela do navegador seja redimensionada
  useEffect(() => {
    const handleResize = () => {
      const buttonWidth = buttonRef.current?.offsetWidth || 170;
      const minRight = 16;
      const maxRight = Math.max(minRight, window.innerWidth - buttonWidth - 16);
      setRightOffset((prev) => Math.max(minRight, Math.min(prev, maxRight)));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Calcula se o pop-up (400px) ultrapassaria o limite esquerdo da tela ao mover o chat para a esquerda
  const popupWidth = typeof window !== "undefined" ? Math.min(400, window.innerWidth - 32) : 400;
  const popupShiftX =
    typeof window !== "undefined"
      ? Math.max(0, 16 - (window.innerWidth - rightOffset - popupWidth))
      : 0;

  if (!visible) return null;

  const openFullChat = () => {
    setOpen(false);
    setActiveView("chat");
    if (location.pathname !== "/") navigate({ to: "/" });
  };

  const selectConversation = (conversation: Conversation) => {
    setSelectedChatId(conversation.id);
    markAsRead(conversation.id);
    setDraft("");
    setView("thread");
  };

  const metaRestricted =
    selected?.id !== "valentina" &&
    activeProvider === "meta" &&
    selected?.channel === "whatsapp" &&
    metaWindowOpen !== true;

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending || metaRestricted || !selected || selected.id !== selectedChatId) return;
    setSending(true);
    try {
      if (await sendMessage(text)) {
        setDraft("");
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
        }
      }
    } finally {
      setSending(false);
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  return (
    <>
      {/* Lightbox rápido para visualização de imagem enviada/recebida */}
      <AnimatePresence>
        {previewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreviewImage(null)}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm cursor-zoom-out"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-2xl border border-white/20 bg-black/60 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black/90 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
              <img src={previewImage} alt="Visualização ampliada" className="max-h-[85vh] max-w-[85vw] object-contain" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={`fixed bottom-0 z-[100] flex flex-col items-end ${
          isDragging ? "select-none pointer-events-auto" : ""
        }`}
        style={{
          right: `${rightOffset}px`,
          touchAction: "none",
        }}
        data-crm-chat-widget
      >
        {/* Janela Flutuante do Chat */}
        <AnimatePresence>
          {open && (
            <motion.section
              id="crm-chat-window"
              aria-label="Conversas no CRM"
              initial={{ opacity: 0, y: 20, scale: 0.97, x: popupShiftX }}
              animate={{ opacity: 1, y: 0, scale: 1, x: popupShiftX }}
              exit={{ opacity: 0, y: 20, scale: 0.97, x: popupShiftX }}
              transition={{
                duration: 0.22,
                ease: [0.16, 1, 0.3, 1],
                x: { duration: isDragging ? 0 : 0.15 },
              }}
              className="mb-2 flex h-[min(580px,calc(100dvh-5.5rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border/80 bg-card/98 shadow-2xl backdrop-blur-xl ring-1 ring-black/5 dark:ring-white/5"
            >
              <AnimatePresence mode="wait" initial={false}>
                {selected ? (
                  // ══════════════════════════════════════════════════════════════
                  // TELA DA CONVERSA SELECIONADA (THREAD)
                  // ══════════════════════════════════════════════════════════════
                  <motion.div
                    key="thread-view"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className="flex h-full w-full flex-col"
                  >
                    {/* Cabeçalho da Conversa */}
                    <header
                      onPointerDown={startDrag}
                      className="flex h-14 shrink-0 items-center justify-between border-b border-border/70 bg-card/95 px-3 backdrop-blur-md cursor-grab active:cursor-grabbing select-none"
                      title="Arraste para mover o mini chat para a esquerda ou direita"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <SystemTooltip content="Voltar para a lista">
                          <button
                            type="button"
                            onClick={() => setView("list")}
                            aria-label="Voltar às conversas"
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                          >
                            <ArrowLeft className="h-4 w-4" />
                          </button>
                        </SystemTooltip>

                        {selected.id === "valentina" ? (
                          <div className="relative shrink-0 select-none">
                            <img
                              src={aiPersona.avatarUrl}
                              alt={aiPersona.name}
                              className="h-9 w-9 rounded-full object-cover border border-primary/40 shadow-xs"
                            />
                            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full border border-card bg-primary">
                              <span className="h-1.5 w-1.5 rounded-full bg-white" />
                            </span>
                          </div>
                        ) : (
                          <CustomerAvatar
                            avatar={selected.avatar}
                            name={selected.name}
                            initials={selected.initials}
                            initialsBg={selected.initialsBg}
                            channel={selected.channel}
                            size="md"
                          />
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-bold text-foreground flex items-center gap-1.5">
                            {selected.id === "valentina" ? (
                              <>
                                <span className="text-primary">{aiPersona.name}</span>
                                <span className="px-1.5 py-0.2 rounded bg-primary text-primary-foreground text-[8px] font-black uppercase tracking-wider">
                                  IA
                                </span>
                              </>
                            ) : (
                              selected.name
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="truncate">
                              {selected.id === "valentina"
                                ? "Assistente Inteligente · Online"
                                : `${selected.phone || "WhatsApp"} · Em atendimento`}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <SystemTooltip content="Abrir no Chat completo">
                          <button
                            type="button"
                            onClick={openFullChat}
                            aria-label="Abrir no Chat"
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                          >
                            <Maximize2 className="h-4 w-4" />
                          </button>
                        </SystemTooltip>

                        <SystemTooltip content="Minimizar">
                          <button
                            type="button"
                            onClick={() => setOpen(false)}
                            aria-label="Minimizar chat"
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                        </SystemTooltip>
                      </div>
                    </header>

                    {/* Área de Mensagens com Balões Refinados */}
                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-background/85 px-3 py-3.5 text-xs scrollbar-thin">
                      {selected.messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                          <div className="grid h-10 w-10 place-items-center rounded-full bg-muted/80 mb-2 border border-border/50">
                            <MessageCircle className="h-5 w-5 text-muted-foreground/60" />
                          </div>
                          <p className="text-xs font-semibold text-foreground">Início da conversa</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Nenhuma mensagem registrada nesta conversa.
                          </p>
                        </div>
                      ) : (
                        selected.messages.map((message: any, i: number) => {
                          const isMe = message.side === "out";
                          const isSystem = message.author === "Sistema";

                          // Mensagem de Sistema
                          if (isSystem) {
                            return (
                              <div key={message.id || i} className="flex justify-center my-2">
                                <span className="rounded-full bg-muted/90 border border-border/70 px-3 py-0.5 text-[10px] font-medium text-muted-foreground uppercase shadow-2xs select-none">
                                  {message.text} · {message.time}
                                </span>
                              </div>
                            );
                          }

                          // Nota Interna
                          if (message.isInternalNote) {
                            return (
                              <div key={message.id || i} className="flex justify-center my-1 w-full">
                                <div className="w-full max-w-[92%] rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-950 dark:text-amber-200 shadow-xs">
                                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1">
                                    <Lock className="h-3 w-3 shrink-0" />
                                    Nota interna · {message.time}
                                  </div>
                                  <p className="leading-relaxed whitespace-pre-wrap">{message.text}</p>
                                </div>
                              </div>
                            );
                          }

                          // Mensagem do Operador (Enviada / Eu)
                          if (isMe) {
                            return (
                              <div key={message.id || i} className="flex justify-end w-full group">
                                <div className="max-w-[85%] rounded-2xl rounded-br-xs bg-primary px-3.5 py-2.5 text-primary-foreground shadow-sm text-xs leading-relaxed select-text">
                                  {message.quotedMessageContent && (
                                    <div className="mb-1.5 rounded-lg border-l-2 border-white/70 bg-white/15 px-2 py-1 text-[10px] text-white/95">
                                      <div className="font-bold opacity-90">{message.quotedMessageSender || "Mensagem"}</div>
                                      <div className="truncate opacity-80">{message.quotedMessageContent}</div>
                                    </div>
                                  )}
                                  <MiniMediaRenderer
                                    text={message.text}
                                    isMe={true}
                                    onImageClick={(url) => setPreviewImage(url)}
                                  />
                                  <div className="mt-1 flex items-center justify-end gap-1 text-[9.5px] text-primary-foreground/75 font-medium select-none">
                                    <span>{message.time}</span>
                                    <CheckCheck className="h-3 w-3 text-primary-foreground/90 inline" />
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          // Mensagem do Cliente (Recebida) com Foto ao Lado
                          return (
                            <div key={message.id || i} className="flex items-end gap-2 w-full group">
                              <CustomerAvatar
                                avatar={selected.avatar}
                                name={selected.name}
                                initials={selected.initials}
                                initialsBg={selected.initialsBg}
                                channel={selected.channel}
                                size="xs"
                                showChannel={false}
                                className="mb-1"
                              />
                              <div className="max-w-[85%] rounded-2xl rounded-bl-xs border border-border/80 bg-card px-3.5 py-2.5 text-foreground shadow-xs text-xs leading-relaxed select-text">
                                {message.quotedMessageContent && (
                                  <div className="mb-1.5 rounded-lg border-l-2 border-primary bg-muted/60 px-2 py-1 text-[10px] text-muted-foreground">
                                    <div className="font-bold text-primary">{message.quotedMessageSender || "Mensagem"}</div>
                                    <div className="truncate">{message.quotedMessageContent}</div>
                                  </div>
                                )}
                                <MiniMediaRenderer
                                  text={message.text}
                                  isMe={false}
                                  onImageClick={(url) => setPreviewImage(url)}
                                />
                                <div className="mt-1 flex items-center justify-end gap-1 text-[9.5px] text-muted-foreground font-medium select-none">
                                  <span>{message.time}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                      <div ref={endRef} />
                    </div>

                    {/* Caixa de Composição (Composer) */}
                    <div className="shrink-0 border-t border-border/70 bg-card/95 p-2.5 backdrop-blur-md">
                      {metaRestricted && (
                        <div className="mb-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                          {metaWindowOpen === null ? (
                            "Verificando janela de atendimento de 24h..."
                          ) : (
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <span>Janela Meta de 24h encerrada.</span>
                              <button
                                type="button"
                                onClick={() => {
                                  if (selected) {
                                    void loadMetaTemplates(selected.id);
                                    setShowMetaTemplateModal(true);
                                  }
                                }}
                                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 transition cursor-pointer shrink-0"
                              >
                                <Sparkles className="h-3.5 w-3.5" />
                                Enviar Template
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex items-end gap-2">
                        {activeProvider === "meta" && selected?.channel === "whatsapp" && selected?.id !== "valentina" && (
                          <SystemTooltip content="Enviar Template Meta Oficial">
                            <button
                              type="button"
                              onClick={() => {
                                if (selected) {
                                  void loadMetaTemplates(selected.id);
                                  setShowMetaTemplateModal(true);
                                }
                              }}
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
                            >
                              <Sparkles className="h-4 w-4 text-amber-500" />
                            </button>
                          </SystemTooltip>
                        )}
                        <textarea
                          ref={textareaRef}
                          value={draft}
                          onChange={handleTextareaInput}
                          onKeyDown={handleComposerKeyDown}
                          disabled={metaRestricted || sending}
                          rows={1}
                          placeholder={
                            selected?.id === "valentina"
                              ? `Pergunte algo para ${aiPersona.name}...`
                              : "Digite uma mensagem (Enter para enviar)..."
                          }
                          aria-label="Mensagem para o cliente"
                          className="min-h-9 max-h-28 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/20 disabled:opacity-50"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSend()}
                          disabled={!draft.trim() || sending || metaRestricted}
                          aria-label="Enviar mensagem"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition hover:bg-primary/90 active:scale-95 disabled:opacity-40 disabled:hover:bg-primary cursor-pointer"
                        >
                          {sending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  // ══════════════════════════════════════════════════════════════
                  // TELA DE LISTA DE CONVERSAS (LIST VIEW)
                  // ══════════════════════════════════════════════════════════════
                  <motion.div
                    key="list-view"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className="flex h-full w-full flex-col"
                  >
                    {/* Cabeçalho da Lista */}
                    <header
                      onPointerDown={startDrag}
                      className="flex h-14 shrink-0 items-center justify-between border-b border-border/70 bg-card/95 px-3.5 backdrop-blur-md cursor-grab active:cursor-grabbing select-none"
                      title="Arraste para mover o mini chat para a esquerda ou direita"
                    >
                      <div className="flex items-center gap-2">
                        <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
                          <MessageSquare className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-foreground">
                            Atendimentos no CRM
                          </div>
                          <div className="text-[10px] text-muted-foreground font-medium">
                            {assigned.length} {assigned.length === 1 ? "conversa ativa" : "conversas ativas"}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <SystemTooltip content="Abrir no Chat completo">
                          <button
                            type="button"
                            onClick={openFullChat}
                            aria-label="Abrir no Chat"
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                          >
                            <Maximize2 className="h-4 w-4" />
                          </button>
                        </SystemTooltip>

                        <SystemTooltip content="Minimizar">
                          <button
                            type="button"
                            onClick={() => setOpen(false)}
                            aria-label="Minimizar"
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                        </SystemTooltip>
                      </div>
                    </header>

                    {/* Barra de Busca com Botão de Limpar */}
                    <div className="border-b border-border/70 bg-muted/20 p-2.5">
                      <div className="relative flex items-center">
                        <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
                        <input
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Buscar por cliente ou telefone..."
                          aria-label="Buscar conversa"
                          className="h-8 w-full rounded-lg border border-border bg-background/90 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/20"
                        />
                        {search && (
                          <button
                            type="button"
                            onClick={() => setSearch("")}
                            className="absolute right-2 p-0.5 text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Lista de Atendimentos */}
                    <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5 scrollbar-thin">
                      {/* Fagner / Valentina Fixado no Topo */}
                      {showAiAssistant && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedChatId("valentina");
                            markAsRead("valentina");
                            setDraft("");
                            setView("thread");
                          }}
                          className="group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-muted/70 active:scale-[0.99] cursor-pointer mb-1 border border-primary/20 bg-primary/5"
                        >
                          <div className="relative shrink-0 select-none">
                            <img
                              src={aiPersona.avatarUrl}
                              alt={aiPersona.name}
                              className="h-9 w-9 rounded-full object-cover border border-primary/40 shadow-xs"
                            />
                            <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-card bg-primary text-primary-foreground shadow-soft">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
                            </span>
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1">
                              <span className="truncate text-xs font-bold text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5">
                                {aiPersona.name}
                                <span className="px-1.5 py-0.2 rounded bg-primary text-primary-foreground text-[8px] font-black uppercase tracking-wider">
                                  IA
                                </span>
                              </span>
                              <span className="shrink-0 text-[10px] text-muted-foreground font-medium">
                                Agora
                              </span>
                            </div>

                            <div className="mt-0.5 flex items-center justify-between gap-2">
                              <span className="truncate text-[11px] text-muted-foreground">
                                {aiConversation?.messages?.at(-1)?.text
                                  ? previewSnippet(aiConversation.messages.at(-1)!.text)
                                  : "Assistente virtual pronto para ajudar"}
                              </span>
                              <span className="shrink-0 text-[10px] font-bold text-emerald-500 flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                Online
                              </span>
                            </div>
                          </div>
                        </button>
                      )}

                      {filtered.length === 0 && !showAiAssistant ? (
                        <div className="flex flex-col items-center justify-center py-12 px-4 text-center my-auto">
                          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-muted/80 text-muted-foreground mb-3 border border-border/60">
                            <MessageSquareDashed className="h-6 w-6 text-muted-foreground/60" />
                          </div>
                          <div className="text-xs font-bold text-foreground">
                            {search ? "Nenhuma conversa encontrada" : "Sem atendimentos no momento"}
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed max-w-[240px]">
                            {search
                              ? `Nenhum resultado corresponde à busca "${search}".`
                              : "Você não possui nenhuma conversa atribuída na sua fila 'Meus' no momento."}
                          </p>
                          <button
                            type="button"
                            onClick={openFullChat}
                            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 px-3 py-1.5 text-xs font-semibold text-primary transition-all cursor-pointer"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Abrir Chat completo
                          </button>
                        </div>
                      ) : (
                        filtered.map((conversation) => {
                          const last = conversation.messages.at(-1);
                          const isLastInternal = last?.isInternalNote;

                          return (
                            <button
                              key={conversation.id}
                              type="button"
                              onClick={() => selectConversation(conversation)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const x = Math.min(e.clientX, window.innerWidth - 220);
                                const y = Math.min(e.clientY, window.innerHeight - 200);
                                setContextMenu({ chatId: conversation.id, x, y });
                              }}
                              className="group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-muted/70 active:scale-[0.99] cursor-pointer"
                            >
                              <div className="relative shrink-0">
                                <CustomerAvatar
                                  avatar={conversation.avatar}
                                  name={conversation.name}
                                  initials={conversation.initials}
                                  initialsBg={conversation.initialsBg}
                                  channel={conversation.channel}
                                  size="md"
                                />
                                {(conversation as any).pinned && (
                                  <span className="absolute -top-1 -left-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-primary text-primary-foreground shadow-xs">
                                    <Pin className="h-2 w-2" />
                                  </span>
                                )}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-1">
                                  <span className="truncate text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                                    {conversation.name}
                                  </span>
                                  <span className="shrink-0 text-[10px] text-muted-foreground font-medium">
                                    {conversation.lastMessageTime}
                                  </span>
                                </div>

                                <div className="mt-0.5 flex items-center justify-between gap-2">
                                  <span className="truncate text-[11px] text-muted-foreground flex items-center gap-1">
                                    {isLastInternal && (
                                      <span className="text-amber-500 font-semibold shrink-0">
                                        [Nota]
                                      </span>
                                    )}
                                    <span className="truncate">
                                      {last ? previewSnippet(last.text) : "Sem mensagens"}
                                    </span>
                                  </span>

                                  {conversation.unreadCount > 0 && (
                                    <span className="shrink-0 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-primary px-1 text-[9px] font-extrabold text-primary-foreground shadow-xs animate-in zoom-in-50">
                                      {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>

                    {/* Rodapé da Lista */}
                    <footer className="flex shrink-0 items-center justify-between border-t border-border/70 bg-card/90 px-3.5 py-2 backdrop-blur-sm">
                      <span className="text-[10px] text-muted-foreground font-medium">
                        {assigned.length} {assigned.length === 1 ? "conversa" : "conversas"}
                      </span>
                      <button
                        type="button"
                        onClick={openFullChat}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline cursor-pointer"
                      >
                        Abrir Chat completo
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    </footer>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Botão Gatilho / Barra Inferior Dockada (Arrastável horizontalmente) */}
        <motion.button
          ref={buttonRef}
          type="button"
          data-drag-trigger="true"
          onPointerDown={startDrag}
          onClick={() => {
            if (dragInfoRef.current.moved) return;
            setOpen((previous) => !previous);
          }}
          aria-expanded={open}
          aria-controls="crm-chat-window"
          aria-label={open ? "Recolher conversas" : "Abrir conversas"}
          whileHover={{ scale: isDragging ? 1 : 1.02 }}
          whileTap={{ scale: isDragging ? 1 : 0.98 }}
          className={`flex h-10 min-w-40 items-center justify-between gap-2.5 rounded-t-xl border border-b-0 border-border/90 bg-card/95 hover:bg-card px-3 text-xs font-semibold text-foreground shadow-xl backdrop-blur-md transition-colors select-none ring-1 ring-black/5 dark:ring-white/5 ${
            isDragging ? "cursor-grabbing shadow-2xl ring-primary/40" : "cursor-grab"
          }`}
          title="Clique para abrir/fechar · Arraste para mover para os lados"
        >
          <span className="flex items-center gap-1.5">
            <span
              className="text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors p-0.5"
              title="Arraste horizontalmente"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </span>
            <span className="relative flex items-center justify-center">
              <MessageCircle className="h-4 w-4 text-primary" />
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary animate-ping" />
              )}
            </span>
            <span className="tracking-tight">Conversas</span>
          </span>

          <span className="flex items-center gap-1.5">
            {unread > 0 && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-extrabold text-primary-foreground shadow-xs animate-in zoom-in-50">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
            <ChevronUp
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                open ? "rotate-180" : ""
              }`}
            />
          </span>
        </motion.button>
      </div>

      {/* Modal Selecionador de Templates Meta Oficial */}
      {selected && selected.id !== "valentina" && (
        <MetaTemplateSelectModal
          isOpen={showMetaTemplateModal}
          onClose={() => setShowMetaTemplateModal(false)}
          templates={metaTemplates}
          customerName={selected.name || "Cliente"}
          operatorName={operatorProfile?.name || "Atendente"}
          onSend={handleSendMetaTemplate}
          loading={metaTemplatesLoading}
        />
      )}

      {/* Mini Pop-up de Menu de Contexto (botão direito) */}
      <AnimatePresence>
        {contextMenu && (() => {
          const chat = conversations.find((c) => c.id === contextMenu.chatId);
          if (!chat) return null;
          return (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1 }}
              className="fixed z-[99999] min-w-[200px] rounded-xl bg-card border border-border shadow-2xl p-1 text-xs"
              style={{ top: contextMenu.y, left: contextMenu.x }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  pinChat(chat.id);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
              >
                <Pin className="h-3.5 w-3.5 text-primary" />
                {(chat as any).pinned ? "Desafixar Chat" : "Fixar Chat"}
              </button>
              <button
                type="button"
                onClick={() => {
                  markAsUnread(chat.id);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
              >
                <BookOpen className="h-3.5 w-3.5 text-primary" />
                Marcar como não lido
              </button>
              <button
                type="button"
                onClick={() => {
                  setTransferTargetChat(chat);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
              >
                <Forward className="h-3.5 w-3.5 text-primary" />
                Transferir atendimento
              </button>
              <div className="my-1 border-t border-border/60" />
              <button
                type="button"
                onClick={() => {
                  archiveFromMiniChat(chat.id);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition cursor-pointer"
              >
                <Archive className="h-3.5 w-3.5 text-amber-500" />
                Arquivar do mini chat
              </button>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Modal de Transferência de Atendimento */}
      <Dialog
        open={!!transferTargetChat}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setTransferTargetChat(null);
            setTransferSearch("");
          }
        }}
      >
        <DialogContent className="max-w-md p-5 bg-card text-foreground border border-border shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-bold">
              <Forward className="h-4 w-4 text-primary" />
              Transferir Atendimento
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Selecione o operador que assumirá a conversa com <strong className="text-foreground">{transferTargetChat?.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={transferSearch}
                onChange={(e) => setTransferSearch(e.target.value)}
                placeholder="Buscar operador por nome..."
                className="h-8.5 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20"
              />
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1 pr-1 scrollbar-thin">
              {operators
                .filter((op) => op.id !== currentOperatorId)
                .filter((op) => !transferSearch || op.name.toLowerCase().includes(transferSearch.toLowerCase()))
                .map((op) => (
                  <button
                    key={op.id}
                    type="button"
                    onClick={() => handleExecuteTransfer(op.id)}
                    disabled={transferSubmitting}
                    className="flex w-full items-center justify-between rounded-lg p-2 text-left hover:bg-muted/80 transition cursor-pointer disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={op.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${op.name}`}
                        alt={op.name}
                        className="h-7 w-7 rounded-full object-cover border border-border"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-foreground">{op.name}</div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {(op as any).role === "admin" ? "Administrador" : "Operador"}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-primary flex items-center gap-1">
                      {transferSubmitting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>Transferir &rarr;</>
                      )}
                    </span>
                  </button>
                ))}
              {operators.filter((op) => op.id !== currentOperatorId).length === 0 && (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  Nenhum outro operador disponível para transferência.
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
