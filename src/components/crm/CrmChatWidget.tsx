import React, { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Briefcase,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Folder,
  Forward,
  GripVertical,
  Image as ImageIcon,
  LayoutTemplate,
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
  PhoneCall,
  Pin,
  Play,
  Search,
  Send,
  Square,
  Trash2,
  User,
  UserCheck,
  Users,
  Video as VideoIcon,
  X,
} from "lucide-react";
import {
  InstagramLogo,
  MessengerLogo,
  WhatsappLogo,
} from "@/components/chat/ChatList";
import { SystemAnnotationBubble } from "@/components/chat/SystemAnnotationBubble";
import { DismissableLayerBranch } from "@radix-ui/react-dismissable-layer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ensureMiniChatBodyEventGuard,
} from "@/components/ui/dialog";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useChat } from "@/hooks/useChatState";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePermissions } from "@/hooks/usePermissions";
import { getAiPersona } from "@/lib/ai-persona";
import { AiAvatar } from "@/components/ui/AiAvatar";
import { AgenticThoughtTrace } from "@/components/valentina/chat-blocks/AgenticThoughtTrace";
import { stripNotificationEmojis } from "@/lib/format-notification-text";
import { shouldShowMiniChatWidget } from "@/lib/widget-visibility";
import { QuotedMessagePreview } from "@/components/chat/ChatPanel";
import type { ApprovedMetaTemplate } from "@/components/chat/MetaTemplateSelectModal";
import {
  collectTemplateCustomGroups,
  formatTemplateFirstName,
  matchesMetaTemplateFilter,
  normalizeTemplateCustomGroups,
} from "@/lib/whatsapp/meta-template-common";
import { toast } from "sonner";
import { getConversationSortTimestamp, type Conversation, type Message } from "@/lib/mockData";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

export function getVigosPhoneLink(phone?: string | null): string {
  if (!phone) return "#";
  let n = phone.replace(/\D/g, "");
  if (n.startsWith("55") && n.length > 10) n = n.substring(2);
  if (n.startsWith("0")) n = n.substring(1);
  if (n.startsWith("14")) n = n.substring(2);
  return `tel:${n}`;
}

export function formatDisplayPhone(phone?: string | null): string {
  if (!phone) return "";
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

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
  if (!text.startsWith("[MEDIA:") && !text.startsWith("[LOCAL_MEDIA:")) {
    return stripNotificationEmojis(text).replace(/\*\*/g, "").replace(/\*/g, "").replace(/`/g, "");
  }
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

function renderInlineBoldSegments(segment: string, keyPrefix: string) {
  if (!segment) return segment;
  const withBackticksConverted = segment.includes("`")
    ? segment.replace(/`([^`\n]+)`/g, "*$1*")
    : segment;
  if (!withBackticksConverted.includes("*")) return withBackticksConverted;
  const normalized = withBackticksConverted.replace(/\*([^*\n]*)\*([^*\n]+)\*([^*\n]*)\*/g, "*$1$2$3*");
  const tokenRegex = /(\*\*[^*\n]+\*\*|\*[^\s*](?:[^*\n]*[^\s*])?\*)/g;
  const tokens = normalized.split(tokenRegex);
  if (tokens.length === 1) return withBackticksConverted;

  return tokens.map((tok, i) => {
    if (!tok) return null;
    if (tok.startsWith("**") && tok.endsWith("**") && tok.length > 4) {
      return (
        <strong key={`${keyPrefix}-b2-${i}`} className="font-semibold">
          {tok.slice(2, -2)}
        </strong>
      );
    }
    if (tok.startsWith("*") && tok.endsWith("*") && tok.length > 2) {
      return (
        <strong key={`${keyPrefix}-b1-${i}`} className="font-semibold">
          {tok.slice(1, -1)}
        </strong>
      );
    }
    return <React.Fragment key={`${keyPrefix}-t-${i}`}>{tok}</React.Fragment>;
  });
}

function renderTextWithLinks(text: string, isMe?: boolean) {
  if (!text) return "";
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const parts = text.split(urlRegex);
  if (parts.length === 1) {
    return renderInlineBoldSegments(text, "w-txt");
  }

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
    return <React.Fragment key={index}>{renderInlineBoldSegments(part, `w-p-${index}`)}</React.Fragment>;
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

function MiniChatTemplateSelector({
  templates,
  customGroups: configuredGroups = [],
  customerName = "Cliente",
  operatorName = "Atendente",
  loading = false,
  onClose,
  onSend,
}: {
  templates: ApprovedMetaTemplate[];
  customGroups?: string[];
  customerName?: string;
  operatorName?: string;
  loading?: boolean;
  onClose: () => void;
  onSend: (template: ApprovedMetaTemplate, parameters: string[]) => Promise<boolean>;
}) {
  const [search, setSearch] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<string>("ALL");
  const [selectedTemplate, setSelectedTemplate] = useState<ApprovedMetaTemplate | null>(null);
  const [parameters, setParameters] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const formattedCustomerName = useMemo(
    () => formatTemplateFirstName(customerName, "Cliente"),
    [customerName],
  );
  const formattedOperatorName = useMemo(
    () => formatTemplateFirstName(operatorName, "Atendente"),
    [operatorName],
  );

  const supportedTemplates = useMemo(
    () => templates.filter((t) => t.supported),
    [templates],
  );

  const categories = useMemo(() => {
    const cats = new Set<string>();
    supportedTemplates.forEach((t) => {
      if (t.category) cats.add(t.category.toUpperCase());
    });
    return Array.from(cats);
  }, [supportedTemplates]);

  const customGroups = useMemo(
    () => collectTemplateCustomGroups(supportedTemplates, configuredGroups),
    [supportedTemplates, configuredGroups],
  );

  const filteredTemplates = useMemo(() => {
    return supportedTemplates.filter((t) =>
      matchesMetaTemplateFilter(t, { search, selectedFilter }),
    );
  }, [supportedTemplates, search, selectedFilter]);

  const handleSelect = (template: ApprovedMetaTemplate) => {
    setSelectedTemplate(template);
    const initialParams = Array.from({ length: template.variableCount }, (_, idx) => {
      const binding = template.bindings?.[String(idx + 1)];
      if (binding === "customer_name") return formattedCustomerName;
      if (binding === "operator_name") return formattedOperatorName;
      return "";
    });
    setParameters(initialParams);
  };

  const handleBack = () => {
    setSelectedTemplate(null);
    setParameters([]);
  };

  const handleConfirmSend = async () => {
    if (!selectedTemplate) return;
    if (
      parameters.length !== selectedTemplate.variableCount ||
      parameters.some((p) => !p.trim())
    ) {
      return;
    }
    setSending(true);
    try {
      const ok = await onSend(selectedTemplate, parameters);
      if (ok) {
        handleBack();
        onClose();
      }
    } finally {
      setSending(false);
    }
  };

  const previewText = useMemo(() => {
    if (!selectedTemplate) return "";
    return selectedTemplate.bodyText.replace(/@?\{\{(\d+)\}\}/g, (_, num) => {
      const idx = Number(num) - 1;
      const val = parameters[idx]?.trim();
      if (val) return val.replace(/^@+/, "");
      const binding = selectedTemplate.bindings?.[num];
      if (binding === "customer_name") return formattedCustomerName;
      if (binding === "operator_name") return formattedOperatorName;
      return `{{${num}}}`;
    });
  }, [selectedTemplate, parameters, formattedCustomerName, formattedOperatorName]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="absolute inset-0 z-20 flex flex-col bg-card"
    >
      {/* Sub-header interno do seletor de templates */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/70 bg-muted/25 px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          {selectedTemplate ? (
            <button
              type="button"
              onClick={handleBack}
              className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer shrink-0"
              title="Voltar para a lista de templates"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
          ) : (
            <div className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <LayoutTemplate className="h-3.5 w-3.5" />
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-xs font-bold text-foreground">
              {selectedTemplate ? selectedTemplate.name : "Templates Meta Oficiais"}
            </div>
            <div className="truncate text-[10px] text-muted-foreground">
              {selectedTemplate
                ? "Configure os campos antes de enviar"
                : "Selecione um template aprovado para iniciar"}
            </div>
          </div>
        </div>
        <SystemTooltip content="Fechar templates">
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar templates"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </SystemTooltip>
      </div>

      {loading && templates.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <p className="text-xs font-medium">Carregando templates aprovados...</p>
        </div>
      ) : !selectedTemplate ? (
        <>
          {/* Busca + Filtro por Categoria e Grupo Personalizado */}
          <div className="shrink-0 space-y-2 border-b border-border/60 bg-background/60 p-2.5">
            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Pesquisar por nome, texto ou grupo..."
                className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/20"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {(categories.length > 0 || customGroups.length > 0) && (
              <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none">
                <button
                  type="button"
                  onClick={() => setSelectedFilter("ALL")}
                  className={`shrink-0 rounded-md px-2.5 py-1 text-[10px] font-bold transition-colors cursor-pointer ${
                    selectedFilter === "ALL"
                      ? "bg-primary text-primary-foreground shadow-2xs"
                      : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  TODOS ({supportedTemplates.length})
                </button>
                {categories.map((cat) => {
                  const filterKey = `CAT:${cat}`;
                  return (
                    <button
                      key={filterKey}
                      type="button"
                      onClick={() => setSelectedFilter(filterKey)}
                      className={`shrink-0 rounded-md px-2.5 py-1 text-[10px] font-bold transition-colors cursor-pointer ${
                        selectedFilter === filterKey
                          ? "bg-primary text-primary-foreground shadow-2xs"
                          : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {cat === "UTILITY" ? "UTILIDADE" : cat}
                    </button>
                  );
                })}
                {customGroups.length > 0 && categories.length > 0 && (
                  <span className="h-3.5 w-px bg-border shrink-0 mx-0.5" />
                )}
                {customGroups.map((groupName) => {
                  const filterKey = `GRP:${groupName}`;
                  return (
                    <button
                      key={filterKey}
                      type="button"
                      onClick={() => setSelectedFilter(filterKey)}
                      className={`shrink-0 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-bold transition-colors cursor-pointer ${
                        selectedFilter === filterKey
                          ? "bg-primary text-primary-foreground shadow-2xs"
                          : "bg-primary/10 text-primary hover:bg-primary/15 border border-primary/20"
                      }`}
                    >
                      <Folder className="h-2.5 w-2.5 shrink-0" />
                      <span>{groupName}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Lista compacta de Templates para o Mini Chat */}
          <div className="min-h-0 flex-1 overflow-y-auto p-2.5 space-y-2 scrollbar-thin">
            {filteredTemplates.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-6 text-center my-4">
                <LayoutTemplate className="h-6 w-6 text-muted-foreground/50 mb-1.5" />
                <p className="text-xs font-semibold text-foreground">Nenhum template encontrado</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Tente outro termo de busca, categoria ou grupo.
                </p>
              </div>
            ) : (
              filteredTemplates.map((template) => {
                const buttonsComponent = template.components?.find((c) => c.type === "BUTTONS");
                const tplGroups = normalizeTemplateCustomGroups(template.customGroups);
                return (
                  <button
                    key={`${template.name}:${template.language}`}
                    type="button"
                    onClick={() => handleSelect(template)}
                    className="group w-full text-left rounded-xl border border-border/80 bg-background hover:border-primary/50 hover:bg-primary/5 p-2.5 transition-all cursor-pointer shadow-2xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                          <LayoutTemplate className="h-3 w-3" />
                        </div>
                        <span className="truncate text-[11px] font-bold text-foreground font-mono group-hover:text-primary transition-colors">
                          {template.name}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        {tplGroups.map((gName) => (
                          <span
                            key={gName}
                            className="inline-flex items-center gap-0.5 shrink-0 rounded bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[9px] font-bold text-primary"
                          >
                            <Folder className="h-2.5 w-2.5" />
                            <span>{gName}</span>
                          </span>
                        ))}
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">
                          {template.category === "UTILITY" ? "UTILIDADE" : template.category}
                        </span>
                      </div>
                    </div>

                    <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                      {template.bodyText.replace(/@?\{\{(\d+)\}\}/g, (_, num) => {
                        const binding = template.bindings?.[num];
                        if (binding === "customer_name") return formattedCustomerName;
                        if (binding === "operator_name") return formattedOperatorName;
                        return `{{${num}}}`;
                      })}
                    </p>

                    {buttonsComponent?.buttons && buttonsComponent.buttons.length > 0 && (
                      <div className="mt-2 pt-1.5 border-t border-border/50 flex flex-wrap gap-1">
                        {buttonsComponent.buttons.map((btn, bIdx) => (
                          <span
                            key={bIdx}
                            className="rounded bg-muted/70 border border-border/60 px-1.5 py-0.5 text-[9.5px] font-semibold text-foreground"
                          >
                            {btn.text}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </>
      ) : (
        /* Etapa 2: Configurar variáveis e enviar dentro do Mini Chat */
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin">
            {/* Prévia estilo balão do WhatsApp */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Prévia da mensagem
                </span>
                <span className="text-[10px] text-muted-foreground font-medium">
                  {selectedTemplate.category === "UTILITY" ? "UTILIDADE" : selectedTemplate.category} · {selectedTemplate.language}
                </span>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/35 p-2.5">
                <div className="rounded-xl rounded-br-xs bg-primary px-3 py-2 text-primary-foreground shadow-xs space-y-1.5">
                  <p className="text-xs whitespace-pre-wrap leading-relaxed">
                    {previewText}
                  </p>
                  {selectedTemplate.components?.some((c) => c.type === "BUTTONS") && (
                    <div className="pt-1.5 border-t border-white/20 flex flex-col gap-1">
                      {selectedTemplate.components
                        ?.find((c) => c.type === "BUTTONS")
                        ?.buttons?.map((btn, bIdx) => (
                          <div
                            key={bIdx}
                            className="rounded-lg bg-white/15 py-1 text-center text-[11px] font-semibold text-white"
                          >
                            {btn.text}
                          </div>
                        ))}
                    </div>
                  )}
                  <div className="flex justify-end text-[9.5px] text-primary-foreground/75 font-medium">
                    Agora
                  </div>
                </div>
              </div>
            </div>

            {/* Variáveis */}
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Variáveis ({selectedTemplate.variableCount})
              </div>
              {selectedTemplate.variableCount === 0 ? (
                <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                  Este template não possui variáveis editáveis e está pronto para envio.
                </div>
              ) : (
                <div className="space-y-2">
                  {Array.from({ length: selectedTemplate.variableCount }, (_, idx) => {
                    const num = String(idx + 1);
                    const binding = selectedTemplate.bindings?.[num] || "manual";
                    const isAuto = binding === "customer_name" || binding === "operator_name";

                    return (
                      <div key={idx} className="space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-foreground">
                            Variável {`{{${num}}}`}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {binding === "customer_name"
                              ? "Automático (Contato)"
                              : binding === "operator_name"
                                ? "Automático (Atendente)"
                                : "Manual"}
                          </span>
                        </div>
                        <input
                          value={parameters[idx] || ""}
                          readOnly={isAuto}
                          onChange={(e) => {
                            const val = e.target.value;
                            setParameters((prev) =>
                              prev.map((item, i) => (i === idx ? val : item)),
                            );
                          }}
                          placeholder={`Informe o valor para {{${num}}}`}
                          className={`h-8 w-full rounded-lg border px-2.5 text-xs outline-none transition ${
                            isAuto
                              ? "border-border/60 bg-muted/50 text-muted-foreground cursor-not-allowed"
                              : "border-border bg-background text-foreground focus:border-primary/60 focus:ring-1 focus:ring-primary/20"
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/70 bg-card/95 px-3 py-2.5">
            <button
              type="button"
              onClick={handleBack}
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
            >
              Voltar
            </button>
            <button
              type="button"
              disabled={
                sending ||
                parameters.length !== selectedTemplate.variableCount ||
                parameters.some((p) => !p.trim())
              }
              onClick={() => void handleConfirmSend()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50 transition cursor-pointer"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              <span>{sending ? "Enviando..." : "Enviar Template"}</span>
            </button>
          </div>
        </>
      )}
    </motion.div>
  );
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
  const [openedChatIds, setOpenedChatIds] = useState<string[]>([]);
  const [resolvingThread, setResolvingThread] = useState<{
    conversationId?: string;
    name?: string;
    phone?: string;
  } | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentMetaChatIdRef = useRef<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const {
    activeProvider,
    activeView,
    captureChat,
    conversations,
    currentOperatorId,
    isAuthenticated,
    logSystemEvent,
    markAsRead,
    markAsUnread,
    operatorProfile,
    operators,
    pinChat,
    refreshConversations,
    selectedChatId,
    sendMessage,
    setActiveView,
    setSelectedChatId,
    tenant,
    transferChat,
    isValentinaTyping,
    valentinaThoughtTrace,
  } = useChat();
  const { canAccessView, canViewCrm } = usePermissions();

  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const aiPersona = getAiPersona(tenant || "valem");
  const aiConversation = conversations.find((conversation) => conversation.id === "valentina");

  // ── Gravação de Áudio no Mini Chat ──────────────────────────────────────────
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "preview">("idle");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelRecordingRef = useRef(false);

  const fmtSec = (s: number) =>
    `${Math.floor(s / 60)
      .toString()
      .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const discardRecording = useCallback(() => {
    cancelRecordingRef.current = true;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingSeconds(0);
    setRecordingState("idle");
  }, [audioUrl]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let recorderOptions: MediaRecorderOptions = {};
      if (typeof MediaRecorder !== "undefined") {
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
          recorderOptions = { mimeType: "audio/webm;codecs=opus" };
        } else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
          recorderOptions = { mimeType: "audio/ogg;codecs=opus" };
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
          recorderOptions = { mimeType: "audio/mp4" };
        }
      }
      cancelRecordingRef.current = false;
      const mr = new MediaRecorder(stream, recorderOptions);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (cancelRecordingRef.current) {
          chunksRef.current = [];
          return;
        }
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
      toast.error("Não foi possível acessar o microfone. Verifique as permissões do navegador.");
    }
  };

  const stopRecording = () => {
    cancelRecordingRef.current = false;
    mediaRecorderRef.current?.stop();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

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
  const [metaTemplateCustomGroups, setMetaTemplateCustomGroups] = useState<string[]>([]);
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
      setMetaTemplateCustomGroups(
        Array.isArray(data.customGroups) ? data.customGroups : []
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
      if (
        selected &&
        selected.id !== "valentina" &&
        selected.id !== "__resolving__" &&
        (selected.queue !== "meus" || selected.operatorId !== currentOperatorId)
      ) {
        await captureChat(selected.id);
      }
      const sent = await sendMessage("", false, undefined, null, {
        name: template.name,
        language: template.language,
        parameters: parameters.map((v) => v.trim()),
      });
      if (sent) {
        setShowMetaTemplateModal(false);
        toast.success("Template Meta enviado com sucesso!");
        return true;
      }
      return false;
    } catch (err: any) {
      toast.error(err.message || "Falha ao disparar template");
      return false;
    }
  };

  const isWidgetAllowed = shouldShowMiniChatWidget({
    activeView,
    pathname: location.pathname,
    isAuthenticated,
    isMobile,
  });

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
    isWidgetAllowed &&
    canAccessView("chat") &&
    !isSuppressed;

  const assigned = conversations.filter(
    (conversation) =>
      conversation.id !== "valentina" &&
      !archivedIds.includes(conversation.id) &&
      ((conversation.queue === "meus" && conversation.operatorId === currentOperatorId) ||
       (conversation.walletOperatorId === currentOperatorId && conversation.queue !== "finalizados") ||
       openedChatIds.includes(conversation.id)),
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
          : conversations.find((conversation) => conversation.id === selectedChatId) ||
            (resolvingThread
              ? ({
                  id: resolvingThread.conversationId || "__resolving__",
                  name: resolvingThread.name || "Iniciando atendimento...",
                  phone: resolvingThread.phone || "",
                  initials: (resolvingThread.name || "C").slice(0, 2).toUpperCase(),
                  initialsBg: "#10b981",
                  channel: "whatsapp",
                  queue: "meus",
                  messages: [],
                  lastMessageTime: "Agora",
                  unreadCount: 0,
                } as any)
              : undefined))
      : undefined;

  // ── Histórico completo de mensagens no Mini Chat + sincronização em tempo real ──
  const [history, setHistory] = useState<{ chatId: string; messages: Message[] } | null>(null);

  useEffect(() => {
    if (
      !open ||
      view !== "thread" ||
      !selected?.id ||
      selected.id === "valentina" ||
      selected.id === "__resolving__"
    ) {
      return;
    }
    const chatId = selected.id;
    let disposed = false;

    const fetchMessages = async () => {
      if (disposed || document.hidden) return;
      try {
        const res = await fetch(
          `${BACKEND_URL}/api/chats/${encodeURIComponent(chatId)}/messages?limit=100`,
          { credentials: "include", cache: "no-store" },
        );
        if (!res.ok || disposed) return;
        const data = await res.json();
        if (disposed || !Array.isArray(data?.messages)) return;
        setHistory((prev) => {
          const base = prev && prev.chatId === chatId ? prev.messages : [];
          const byId = new Map<string, Message>(base.map((m) => [m.id, m]));
          for (const msg of data.messages as Message[]) {
            byId.set(msg.id, msg);
          }
          const merged = Array.from(byId.values()).sort((a, b) =>
            (a.sentAtISO || "").localeCompare(b.sentAtISO || ""),
          );
          return { chatId, messages: merged };
        });
      } catch {}
    };

    void fetchMessages();
    const pollTimer = window.setInterval(fetchMessages, 4000);
    window.addEventListener("chat:reconnected", fetchMessages);
    return () => {
      disposed = true;
      window.clearInterval(pollTimer);
      window.removeEventListener("chat:reconnected", fetchMessages);
    };
  }, [open, view, selected?.id]);

  // Mescla mensagens carregadas do histórico com as mensagens em tempo real de `selected.messages`
  const threadMessages = useMemo<Message[]>(() => {
    if (!selected) return [];
    if (
      selected.id === "valentina" ||
      selected.id === "__resolving__" ||
      !history ||
      history.chatId !== selected.id
    ) {
      return selected.messages || [];
    }
    const map = new Map<string, Message>();
    for (const msg of history.messages) {
      map.set(msg.id, msg);
    }
    for (const msg of selected.messages || []) {
      const existing = map.get(msg.id);
      map.set(msg.id, existing ? { ...existing, ...msg } : msg);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (!a.sentAtISO) return 1;
      if (!b.sentAtISO) return -1;
      return a.sentAtISO.localeCompare(b.sentAtISO);
    });
  }, [selected, history]);

  // Identifica a última mensagem recebida do cliente (side === 'in')
  const lastInboundMessage = useMemo<Message | null>(() => {
    for (let i = threadMessages.length - 1; i >= 0; i--) {
      const msg = threadMessages[i];
      if (
        msg &&
        msg.side === "in" &&
        !msg.isInternalNote &&
        msg.author !== "Sistema" &&
        !(msg as any).isWarning
      ) {
        return msg;
      }
    }
    return null;
  }, [threadMessages]);

  // Limpar gravação e modal de template ao trocar de conversa ou fechar
  useEffect(() => {
    setShowMetaTemplateModal(false);
    discardRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, open, view]);

  const query = search.trim().toLocaleLowerCase("pt-BR");
  const filtered = [...assigned]
    .sort((a, b) => {
      const aPinned = (a as any).pinned ? 1 : 0;
      const bPinned = (b as any).pinned ? 1 : 0;
      return bPinned - aPinned || getConversationSortTimestamp(b) - getConversationSortTimestamp(a);
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

  const aiUnreadCount = aiConversation?.unreadCount || 0;
  const unread =
    assigned.reduce(
      (total, conversation) => total + (conversation.unreadCount || 0),
      0,
    ) + aiUnreadCount;

  // Garante guarda de eventos no body (wheel, touchmove, focusin/focusout) para uso simultâneo com modais
  useEffect(() => {
    ensureMiniChatBodyEventGuard();
  }, []);

  // Resetar ao trocar de tenant
  useEffect(() => {
    setOpen(false);
    setView("list");
    setResolvingThread(null);
    setOpenedChatIds([]);
    setDraft("");
    setSearch("");
  }, [tenant]);

  // Fechar no Escape (respeitando modais abertos em segundo plano)
  useEffect(() => {
    if (!open || !visible) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (transferTargetChat) {
        event.stopPropagation();
        setTransferTargetChat(null);
        return;
      }
      if (showMetaTemplateModal) {
        event.stopPropagation();
        setShowMetaTemplateModal(false);
        return;
      }
      if (recordingState !== "idle") {
        event.stopPropagation();
        discardRecording();
        return;
      }
      if (contextMenu) {
        event.stopPropagation();
        setContextMenu(null);
        return;
      }
      if (previewImage) {
        event.stopPropagation();
        setPreviewImage(null);
        return;
      }

      const activeEl = document.activeElement as HTMLElement | null;
      const isFocusedInsideMiniChat = Boolean(activeEl?.closest?.("[data-crm-chat-widget]"));
      const hasOtherOpenDialog = Boolean(
        document.querySelector('[role="dialog"][data-state="open"], [data-crm-interactive-portal]'),
      );

      // Se outro modal está aberto e o foco não está no Mini Chat, deixa o Escape atuar apenas no modal
      if (hasOtherOpenDialog && !isFocusedInsideMiniChat) {
        return;
      }

      if (isFocusedInsideMiniChat) {
        event.stopPropagation();
      }

      if (view === "thread") {
        setResolvingThread(null);
        setView("list");
      } else {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    open,
    visible,
    view,
    previewImage,
    contextMenu,
    transferTargetChat,
    showMetaTemplateModal,
    recordingState,
    discardRecording,
  ]);

  // Listener para eventos globais crm:open-mini-chat e open-crm-chat-widget
  useEffect(() => {
    const handleOpenMiniChat = (event: Event) => {
      const custom = event as CustomEvent<{
        conversationId?: string;
        contactId?: string;
        dealId?: string;
        phone?: string;
        name?: string;
      }>;
      const detail = custom.detail || {};
      const hasSpecificTarget = Boolean(
        detail.conversationId ||
        detail.contactId ||
        detail.dealId ||
        detail.phone ||
        detail.name,
      );

      setOpen(true);

      if (!hasSpecificTarget) {
        return;
      }

      // Entra imediatamente na tela de thread da pessoa selecionada (nunca cai na lista geral)
      setView("thread");

      const currentList = conversationsRef.current;
      const cleanPhone = detail.phone ? detail.phone.replace(/\D/g, "") : "";
      const localMatch =
        (detail.conversationId
          ? currentList.find((c) => c.id === detail.conversationId)
          : undefined) ||
        (detail.contactId
          ? currentList.find((c) => c.contactId && c.contactId === detail.contactId)
          : undefined) ||
        (cleanPhone.length >= 8
          ? currentList.find((c) => {
              const cPhone = c.phone?.replace(/\D/g, "");
              return (
                cPhone &&
                cPhone.length >= 8 &&
                (cPhone.includes(cleanPhone) || cleanPhone.includes(cPhone))
              );
            })
          : undefined);

      const initialConvId = detail.conversationId || localMatch?.id;
      if (initialConvId === "valentina") {
        setResolvingThread(null);
        setSelectedChatId("valentina");
        markAsRead("valentina");
        return;
      }
      setResolvingThread({
        conversationId: initialConvId,
        name: detail.name || localMatch?.name || "Atendimento",
        phone: detail.phone || localMatch?.phone || "",
      });

      if (initialConvId) {
        unarchiveInMiniChat(initialConvId);
        setOpenedChatIds((prev) =>
          prev.includes(initialConvId) ? prev : [...prev, initialConvId],
        );
        setSelectedChatId(initialConvId);
        markAsRead(initialConvId);
      }

      void (async () => {
        try {
          let resolvedConvId = initialConvId || null;

          // 1. Se contactId foi informado (ou se ainda não temos conversa), garante/inicia conversa do contato
          if (detail.contactId && !detail.conversationId) {
            const res = await fetch(
              `${BACKEND_URL}/api/contacts/${encodeURIComponent(detail.contactId)}/conversations`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                  dealId: detail.dealId || undefined,
                  autoCapture: true,
                }),
              },
            );
            if (res.ok) {
              const data = await res.json();
              if (data?.conversationId) {
                resolvedConvId = data.conversationId;
              }
            }
          }

          // 2. Se ainda não há conversationId e dealId foi informado, resolve/cria contato e conversa da negociação
          if (!resolvedConvId && detail.dealId) {
            const res = await fetch(
              `${BACKEND_URL}/api/crm/deals/${encodeURIComponent(detail.dealId)}/conversations`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                  ensure: true,
                  autoCapture: true,
                  phone: detail.phone || undefined,
                  name: detail.name || undefined,
                }),
              },
            );
            if (res.ok) {
              const data = await res.json();
              if (data?.conversationId) {
                resolvedConvId = data.conversationId;
              }
            }
          }

          // 3. Se ainda não há conversationId mas temos telefone ou nome, localiza ou cria o contato e inicia a conversa
          if (!resolvedConvId && (detail.phone || detail.name)) {
            let targetContactId: string | null = null;
            const searchQuery = (detail.phone || detail.name || "").trim();
            if (searchQuery) {
              const searchRes = await fetch(
                `${BACKEND_URL}/api/contacts?search=${encodeURIComponent(searchQuery)}&limit=5`,
                { credentials: "include" },
              );
              if (searchRes.ok) {
                const searchData = await searchRes.json();
                const list = Array.isArray(searchData?.contacts)
                  ? searchData.contacts
                  : Array.isArray(searchData)
                    ? searchData
                    : [];
                if (list.length > 0) {
                  targetContactId = list[0].id;
                }
              }
            }

            if (!targetContactId) {
              const createContactRes = await fetch(`${BACKEND_URL}/api/contacts`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                  name: detail.name?.trim() || detail.phone?.trim() || "Contato CRM",
                  dealId: detail.dealId,
                  phone: detail.phone?.trim() || null,
                }),
              });
              if (createContactRes.ok) {
                const createdContact = await createContactRes.json();
                targetContactId = createdContact?.contactId || createdContact?.contact?.id || createdContact?.id || null;
              }
            }

            if (targetContactId) {
              const convRes = await fetch(
                `${BACKEND_URL}/api/contacts/${encodeURIComponent(targetContactId)}/conversations`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({
                    dealId: detail.dealId || undefined,
                    autoCapture: true,
                  }),
                },
              );
              if (convRes.ok) {
                const convData = await convRes.json();
                if (convData?.conversationId) {
                  resolvedConvId = convData.conversationId;
                }
              }
            }
          }

          if (resolvedConvId) {
            setResolvingThread((prev) =>
              prev ? { ...prev, conversationId: resolvedConvId! } : null,
            );
            unarchiveInMiniChat(resolvedConvId);
            setOpenedChatIds((prev) =>
              prev.includes(resolvedConvId!) ? prev : [...prev, resolvedConvId!],
            );
            setSelectedChatId(resolvedConvId);
            setView("thread");
            await refreshConversations(resolvedConvId);
            markAsRead(resolvedConvId);
            setResolvingThread(null);
          } else {
            toast.error("Não foi possível abrir o atendimento selecionado.");
            setResolvingThread(null);
          }
        } catch (err) {
          console.error("[CrmChatWidget] Erro ao abrir conversa no Mini Chat:", err);
          setResolvingThread(null);
        }
      })();
    };

    window.addEventListener("crm:open-mini-chat", handleOpenMiniChat);
    window.addEventListener("open-crm-chat-widget", handleOpenMiniChat);
    return () => {
      window.removeEventListener("crm:open-mini-chat", handleOpenMiniChat);
      window.removeEventListener("open-crm-chat-widget", handleOpenMiniChat);
    };
  }, [markAsRead, refreshConversations, setSelectedChatId]);

  // Desbloqueio imediato da janela de 24h assim que uma mensagem recente do cliente é detectada
  useEffect(() => {
    if (!open || activeProvider !== "meta" || selected?.channel !== "whatsapp" || !lastInboundMessage) {
      return;
    }
    const sentTime = lastInboundMessage.sentAtISO
      ? new Date(lastInboundMessage.sentAtISO).getTime()
      : NaN;
    const isWithin24h = !isNaN(sentTime) && Date.now() - sentTime < 24 * 60 * 60 * 1000;
    if (isWithin24h) {
      setMetaWindowOpen(true);
      setShowMetaTemplateModal(false);
    }
  }, [open, activeProvider, selected?.id, selected?.channel, lastInboundMessage?.id, lastInboundMessage?.sentAtISO]);

  // Validação de janela de 24h na Meta API (reativa a novas mensagens do cliente)
  useEffect(() => {
    if (
      !open ||
      activeProvider !== "meta" ||
      selected?.channel !== "whatsapp" ||
      selected?.id === "valentina" ||
      selected?.id === "__resolving__"
    ) {
      setMetaWindowOpen(null);
      currentMetaChatIdRef.current = null;
      return;
    }
    const conversationId = selected.id;
    let cancelled = false;
    if (currentMetaChatIdRef.current !== conversationId) {
      currentMetaChatIdRef.current = conversationId;
      setMetaWindowOpen(null);
    }
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/whatsapp/meta-state?conversationId=${encodeURIComponent(conversationId)}`,
          { credentials: "include", cache: "no-store" },
        );
        const data = response.ok ? await response.json() : null;
        if (!cancelled) {
          const isOpen =
            data?.activeProvider === "meta" ? data.window?.open === true : response.ok;
          setMetaWindowOpen(isOpen);
          if (isOpen) {
            setShowMetaTemplateModal(false);
          }
        }
      } catch {
        if (!cancelled) setMetaWindowOpen(false);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, activeProvider, selected?.id, selected?.channel, lastInboundMessage?.id]);

  // Scroll automático ao final da conversa (sempre começa da mensagem/imagem mais recente, de baixo para cima)
  const threadScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const prevThreadChatIdRef = useRef<string | null>(null);
  const prevThreadHistoryChatIdRef = useRef<string | null>(null);
  const prevThreadLastMsgIdRef = useRef<string | null>(null);
  const threadOpenedAtRef = useRef<number>(0);
  const shouldStickThreadToBottomRef = useRef<boolean>(true);

  const scrollThreadToBottom = useCallback((instant = true) => {
    const el = threadScrollContainerRef.current;
    if (el) {
      if (instant) {
        el.scrollTop = el.scrollHeight;
      } else {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }
    }
    endRef.current?.scrollIntoView({ behavior: instant ? "auto" : "smooth", block: "end" });
  }, []);

  const handleThreadScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldStickThreadToBottomRef.current = distanceFromBottom <= 140;
  }, []);

  const handleThreadMediaLoad = useCallback(
    (e: React.SyntheticEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (!target || (target.tagName !== "IMG" && target.tagName !== "VIDEO")) return;
      if (Date.now() - threadOpenedAtRef.current < 3000 || shouldStickThreadToBottomRef.current) {
        scrollThreadToBottom(true);
        requestAnimationFrame(() => scrollThreadToBottom(true));
      }
    },
    [scrollThreadToBottom],
  );

  useEffect(() => {
    if (!open || view !== "thread" || !selected?.id) {
      prevThreadChatIdRef.current = null;
      prevThreadHistoryChatIdRef.current = null;
      prevThreadLastMsgIdRef.current = null;
      return;
    }

    const currentChatId = selected.id;
    const isNewChat = currentChatId !== prevThreadChatIdRef.current;
    const historyLoadedForCurrent =
      history?.chatId === currentChatId && prevThreadHistoryChatIdRef.current !== currentChatId;
    const lastMsg = threadMessages.length > 0 ? threadMessages[threadMessages.length - 1] : null;
    const lastMsgId = lastMsg ? lastMsg.clientMessageId || lastMsg.id : null;
    const hasNewLastMsg = lastMsgId !== null && lastMsgId !== prevThreadLastMsgIdRef.current;

    prevThreadChatIdRef.current = currentChatId;
    if (history?.chatId === currentChatId) {
      prevThreadHistoryChatIdRef.current = currentChatId;
    }
    prevThreadLastMsgIdRef.current = lastMsgId;

    if (isNewChat || historyLoadedForCurrent) {
      threadOpenedAtRef.current = Date.now();
      shouldStickThreadToBottomRef.current = true;
      scrollThreadToBottom(true);
      const rafId = requestAnimationFrame(() => scrollThreadToBottom(true));
      const t1 = setTimeout(() => scrollThreadToBottom(true), 60);
      const t2 = setTimeout(() => scrollThreadToBottom(true), 190);
      const t3 = setTimeout(() => scrollThreadToBottom(true), 350);
      return () => {
        cancelAnimationFrame(rafId);
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }

    if (hasNewLastMsg) {
      shouldStickThreadToBottomRef.current = true;
      scrollThreadToBottom(false);
      const t1 = setTimeout(() => scrollThreadToBottom(true), 100);
      return () => clearTimeout(t1);
    }
  }, [open, view, selected?.id, history?.chatId, history?.messages?.length, threadMessages, scrollThreadToBottom]);

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

  const handleOpenWarningChat = (clientId?: string, clientName?: string) => {
    const cleanId = clientId?.trim() || "";
    const cleanName = clientName?.trim() || "";
    if (!cleanId && !cleanName) return;

    const localMatch =
      (cleanId ? conversations.find((c) => c.id === cleanId) : undefined) ||
      (cleanName
        ? conversations.find(
            (c) =>
              c.id !== "valentina" &&
              c.name.trim().toLocaleLowerCase("pt-BR") === cleanName.toLocaleLowerCase("pt-BR"),
          )
        : undefined);

    const resolvedId = localMatch?.id || cleanId;
    if (localMatch && resolvedId) {
      unarchiveInMiniChat(resolvedId);
      setOpenedChatIds((prev) => (prev.includes(resolvedId) ? prev : [...prev, resolvedId]));
      setSelectedChatId(resolvedId);
      markAsRead(resolvedId);
      setDraft("");
      setResolvingThread(null);
      setView("thread");
      void refreshConversations(resolvedId).catch(() => {});
      return;
    }

    window.dispatchEvent(
      new CustomEvent("crm:open-mini-chat", {
        detail: {
          conversationId: resolvedId || undefined,
          name: cleanName || undefined,
        },
      }),
    );
  };

  const handleOpenCrmDeal = (dealId?: string) => {
    const cleanDealId = dealId?.trim();
    if (!cleanDealId) return;
    setActiveView("crm");
    navigate({
      to: "/crm/deals/$dealId",
      params: { dealId: cleanDealId },
      search: { from: "crm" },
    });
  };

  const handleVigosCallClick = (clientName?: string, conversationId?: string) => {
    const operatorName =
      operatorProfile?.name ||
      operators.find((op) => op.id === currentOperatorId)?.name ||
      "Agente";
    if (conversationId) {
      logSystemEvent(
        conversationId,
        `Clique no botão de ligação (VigosPhone) para ${clientName || "o cliente"} por ${operatorName}`,
      );
    }
    toast.success(`Abrindo VigosPhone para ligar para ${clientName || "o cliente"}...`);
  };

  const metaRestricted =
    selected?.id !== "valentina" &&
    selected?.id !== "__resolving__" &&
    activeProvider === "meta" &&
    selected?.channel === "whatsapp" &&
    metaWindowOpen !== true;

  const handleSend = async () => {
    const text = draft.trim();
    if (
      !text ||
      sending ||
      metaRestricted ||
      !selected ||
      selected.id === "__resolving__" ||
      selected.id !== selectedChatId
    ) {
      return;
    }
    setSending(true);
    setDraft("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    textareaRef.current?.focus();
    try {
      if (
        selected.id !== "valentina" &&
        (selected.queue !== "meus" || selected.operatorId !== currentOperatorId)
      ) {
        await captureChat(selected.id);
      }
      const ok = await sendMessage(text);
      if (!ok) {
        setDraft(text);
      }
    } finally {
      setSending(false);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  };

  const handleSendAudio = async () => {
    if (
      !audioBlob ||
      sending ||
      metaRestricted ||
      !selected ||
      selected.id === "__resolving__" ||
      selected.id !== selectedChatId
    ) {
      return;
    }
    setSending(true);
    try {
      if (
        selected.id !== "valentina" &&
        (selected.queue !== "meus" || selected.operatorId !== currentOperatorId)
      ) {
        await captureChat(selected.id);
      }
      const ext = audioBlob.type.includes("ogg")
        ? "ogg"
        : audioBlob.type.includes("mp4")
          ? "mp4"
          : "webm";
      const mimeType = audioBlob.type || "audio/webm";
      const audioFile = new File([audioBlob], `audio-${Date.now()}.${ext}`, {
        type: mimeType,
        lastModified: Date.now(),
      });
      const ok = await sendMessage("", false, [audioFile]);
      if (ok) {
        discardRecording();
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
          <DismissableLayerBranch asChild>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPreviewImage(null)}
              data-crm-chat-widget
              aria-live="polite"
              className="fixed inset-0 z-[10060] pointer-events-auto flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm cursor-zoom-out"
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
          </DismissableLayerBranch>
        )}
      </AnimatePresence>

      <DismissableLayerBranch asChild>
        <div
          className={`fixed bottom-0 z-[10050] pointer-events-auto flex flex-col items-end ${
            isDragging ? "select-none" : ""
          }`}
          style={{
            right: `${rightOffset}px`,
            touchAction: "none",
          }}
          data-crm-chat-widget
          aria-live="polite"
        >
          {/* Janela Flutuante do Chat */}
          <AnimatePresence>
            {open && (
              <motion.section
                id="crm-chat-window"
                tabIndex={-1}
                aria-label="Conversas no CRM"
                initial={{ opacity: 0, y: 20, scale: 0.97, x: popupShiftX }}
                animate={{ opacity: 1, y: 0, scale: 1, x: popupShiftX }}
                exit={{ opacity: 0, y: 20, scale: 0.97, x: popupShiftX }}
                transition={{
                  duration: 0.22,
                  ease: [0.16, 1, 0.3, 1],
                  x: { duration: isDragging ? 0 : 0.15 },
                }}
                className="mb-2 flex h-[min(580px,calc(100dvh-5.5rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border/80 bg-card/98 shadow-2xl backdrop-blur-xl ring-1 ring-black/5 dark:ring-white/5 outline-none"
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
                              onClick={() => {
                                setResolvingThread(null);
                                setView("list");
                              }}
                              aria-label="Voltar às conversas"
                              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                            >
                              <ArrowLeft className="h-4 w-4" />
                            </button>
                          </SystemTooltip>

                          {selected.id === "valentina" ? (
                            <div className="relative shrink-0 select-none">
                              <AiAvatar
                                tenantId={tenant}
                                className="h-9 w-9 rounded-full border border-primary/40 shadow-xs"
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
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (selected.name) {
                                      void navigator.clipboard?.writeText(selected.name);
                                      toast.success("Nome copiado!");
                                    }
                                  }}
                                  title="Clique para copiar o nome do cliente"
                                  className="truncate text-left hover:text-primary transition-colors cursor-pointer"
                                >
                                  {selected.name}
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium">
                              <span
                                className={`h-1.5 w-1.5 rounded-full animate-pulse ${
                                  selected.id === "valentina" ? "bg-primary" : "bg-emerald-500"
                                }`}
                              />
                              {selected.id !== "valentina" && selected.phone ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void navigator.clipboard?.writeText(selected.phone);
                                    toast.success("Telefone copiado!");
                                  }}
                                  title="Clique para copiar o telefone"
                                  className="truncate text-left hover:text-foreground transition-colors cursor-pointer"
                                >
                                  {selected.id === "__resolving__"
                                    ? `${selected.phone} · Preparando atendimento...`
                                    : `${selected.phone} · Em atendimento`}
                                </button>
                              ) : (
                                <span
                                  className={`truncate ${
                                    selected.id === "valentina" && isValentinaTyping
                                      ? "text-primary font-semibold"
                                      : ""
                                  }`}
                                >
                                  {selected.id === "valentina"
                                    ? isValentinaTyping
                                      ? "Assistente Inteligente · Pensando..."
                                      : "Assistente Inteligente · Online"
                                    : selected.id === "__resolving__"
                                      ? "WhatsApp · Preparando atendimento..."
                                      : "WhatsApp · Em atendimento"}
                                </span>
                              )}
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

                    {/* Corpo da Thread (Mensagens + Composer + Seletor Interno de Templates) */}
                    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                      <AnimatePresence>
                        {showMetaTemplateModal && selected.id !== "valentina" && selected.id !== "__resolving__" && (
                          <MiniChatTemplateSelector
                            templates={metaTemplates}
                            customGroups={metaTemplateCustomGroups}
                            customerName={selected.name || "Cliente"}
                            operatorName={operatorProfile?.name || "Atendente"}
                            loading={metaTemplatesLoading}
                            onClose={() => setShowMetaTemplateModal(false)}
                            onSend={handleSendMetaTemplate}
                          />
                        )}
                      </AnimatePresence>

                      {/* Área de Mensagens com Balões Refinados */}
                      <div
                        ref={threadScrollContainerRef}
                        onScroll={handleThreadScroll}
                        onLoadCapture={handleThreadMediaLoad}
                        className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-background/85 px-3 py-3.5 text-xs scrollbar-thin"
                      >
                        {selected.id === "__resolving__" ? (
                          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                            <Loader2 className="h-6 w-6 animate-spin text-primary mb-2" />
                            <p className="text-xs font-semibold text-foreground">
                              Abrindo conversa de {selected.name}...
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Sincronizando histórico do atendimento.
                            </p>
                          </div>
                        ) : threadMessages.length === 0 ? (
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
                          threadMessages.map((message: any, i: number) => {
                            const isMe = message.side === "out";
                            const isSystem = message.author === "Sistema";

                            // Mensagem de Sistema (oculta por padrão no ícone ? discreto)
                            if (isSystem) {
                              return (
                                <SystemAnnotationBubble
                                  key={message.id || i}
                                  text={message.text}
                                  time={message.time}
                                />
                              );
                            }

                            // Nota Interna
                            if (message.isInternalNote) {
                              return (
                                <div key={message.id || i} className="flex justify-center my-1 w-full">
                                  <div className="w-full max-w-[92%] rounded-xl border border-primary/25 bg-primary/10 px-3.5 py-2.5 text-xs text-foreground shadow-xs">
                                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary mb-1">
                                      <Lock className="h-3 w-3 shrink-0" />
                                      Nota interna · {message.time}
                                    </div>
                                    <p className="leading-relaxed whitespace-pre-wrap">{message.text}</p>
                                  </div>
                                </div>
                              );
                            }

                            const quotedTarget = message.quotedMessageId
                              ? threadMessages.find((m: any) => m.id === message.quotedMessageId)
                              : null;
                            const resolvedQuotedContent =
                              (message.quotedMessageContent &&
                              !message.quotedMessageContent.startsWith("[LOCAL_MEDIA:")
                                ? message.quotedMessageContent
                                : quotedTarget?.text || message.quotedMessageContent) || null;
                            const resolvedQuotedSender =
                              message.quotedMessageSender ||
                              (quotedTarget
                                ? quotedTarget.side === "out"
                                  ? "Você"
                                  : quotedTarget.author || selected.name
                                : "Mensagem");

                            // Mensagem do Operador (Enviada / Eu)
                            if (isMe) {
                              return (
                                <div key={message.id || i} className="flex justify-end w-full group">
                                  <div className="max-w-[85%] rounded-2xl rounded-br-xs bg-primary px-3.5 py-2.5 text-primary-foreground shadow-sm text-xs leading-relaxed select-text">
                                    {resolvedQuotedContent && (
                                      <QuotedMessagePreview
                                        sender={resolvedQuotedSender}
                                        content={resolvedQuotedContent}
                                        variant="outgoing"
                                        className="mb-1.5"
                                      />
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

                            // Mensagem do Cliente / Assistente IA (Recebida) com Foto ao Lado
                            return (
                              <div key={message.id || i} className="flex items-end gap-2 w-full group">
                                {selected.id === "valentina" ? (
                                  <AiAvatar
                                    tenantId={tenant}
                                    className="h-6 w-6 shrink-0 rounded-full border border-border/80 shadow-xs mb-1"
                                  />
                                ) : (
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
                                )}
                                <div
                                  className={`rounded-2xl rounded-bl-xs ${
                                    message.isWarning
                                      ? `w-full max-w-[90%] border border-border/80 border-l-4 ${
                                          message.warningType === "delay"
                                            ? "border-l-amber-500"
                                            : message.warningType === "overload"
                                            ? "border-l-violet-500"
                                            : "border-l-primary"
                                        } bg-card text-foreground text-[11px]`
                                      : "max-w-[85%] border border-border/80 bg-card text-foreground text-xs"
                                  } px-3.5 py-2.5 shadow-xs leading-relaxed select-text`}
                                >
                                  {message.isWarning && (
                                    <div
                                      className={`flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider mb-1.5 select-none ${
                                        message.warningType === "delay"
                                          ? "text-amber-600 dark:text-amber-400"
                                          : message.warningType === "overload"
                                          ? "text-violet-600 dark:text-violet-400"
                                          : "text-primary"
                                      }`}
                                    >
                                      {message.warningType === "delay" ? (
                                        <Clock className="h-3 w-3 shrink-0" />
                                      ) : message.warningType === "new_lead" ? (
                                        <UserCheck className="h-3 w-3 shrink-0" />
                                      ) : message.warningType === "overload" ? (
                                        <Users className="h-3 w-3 shrink-0" />
                                      ) : (
                                        <AlertCircle className="h-3 w-3 shrink-0" />
                                      )}
                                      <span>
                                        {message.warningType === "delay"
                                          ? `Alerta de SLA · ${aiPersona.name}`
                                          : message.warningType === "new_lead"
                                          ? `Novo Lead · ${aiPersona.name}`
                                          : message.warningType === "overload"
                                          ? `Atendimentos Ativos · ${aiPersona.name}`
                                          : `Aviso de ${aiPersona.name}`}
                                      </span>
                                    </div>
                                  )}

                                  {selected.id === "valentina" && message.thoughtTrace && (
                                    <AgenticThoughtTrace
                                      trace={message.thoughtTrace}
                                      mode="completed"
                                      compact
                                    />
                                  )}

                                  {resolvedQuotedContent && (
                                    <QuotedMessagePreview
                                      sender={resolvedQuotedSender}
                                      content={resolvedQuotedContent}
                                      variant="incoming"
                                      className="mb-1.5"
                                    />
                                  )}
                                  <MiniMediaRenderer
                                    text={
                                      message.isWarning
                                        ? stripNotificationEmojis(message.text)
                                        : message.text
                                    }
                                    isMe={false}
                                    onImageClick={(url) => setPreviewImage(url)}
                                  />

                                  {/* Card interativo: Atraso de Resposta (SLA) */}
                                  {message.isWarning &&
                                    message.warningType === "delay" &&
                                    message.warningMetadata && (
                                      <div
                                        className="mt-2.5 p-2.5 rounded-xl bg-card border border-border/80 shadow-2xs flex flex-col gap-2 cursor-default text-xs"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div className="text-[11px] font-bold text-foreground">
                                          Cliente:{" "}
                                          <span className="text-primary font-black">
                                            {message.warningMetadata.clientName}
                                          </span>
                                        </div>
                                        {message.warningMetadata.lastMessage && (
                                          <div className="p-2 rounded-lg bg-muted/65 text-[10px] text-muted-foreground border-l-2 border-primary italic">
                                            "{message.warningMetadata.lastMessage}"
                                          </div>
                                        )}
                                        {(message.warningMetadata.clientId ||
                                          message.warningMetadata.clientName) && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleOpenWarningChat(
                                                message.warningMetadata.clientId,
                                                message.warningMetadata.clientName,
                                              )
                                            }
                                            className="mt-0.5 flex items-center justify-center gap-1.5 w-full py-1.5 px-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold shadow-soft transition cursor-pointer border-none"
                                          >
                                            <span>Abrir Conversa</span>
                                            <ArrowRight className="h-3 w-3" />
                                          </button>
                                        )}
                                      </div>
                                    )}

                                  {/* Card interativo: Novo Cliente (Lead) */}
                                  {message.isWarning &&
                                    message.warningType === "new_lead" &&
                                    message.warningMetadata && (
                                      <div
                                        className="mt-2.5 p-2.5 rounded-xl bg-card border border-border/80 shadow-2xs flex flex-col gap-2 cursor-default text-xs"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div className="text-[11px] font-bold text-foreground flex items-center justify-between gap-2">
                                          <span>
                                            Cliente:{" "}
                                            <span className="text-primary font-black">
                                              {message.warningMetadata.clientName}
                                            </span>
                                          </span>
                                          {message.warningMetadata.temperature && (
                                            <span
                                              className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider ${
                                                message.warningMetadata.temperature === "quente"
                                                  ? "bg-red-500/10 text-red-500 border border-red-500/25"
                                                  : message.warningMetadata.temperature === "morno"
                                                    ? "bg-amber-500/10 text-amber-500 border border-amber-500/25"
                                                    : "bg-blue-500/10 text-blue-500 border border-blue-500/25"
                                              }`}
                                            >
                                              {message.warningMetadata.temperature}
                                            </span>
                                          )}
                                        </div>
                                        {message.warningMetadata.interest && (
                                          <div className="text-[10px] text-muted-foreground flex flex-col gap-0.5 bg-muted/40 p-2 rounded-lg">
                                            <span className="font-semibold text-[8px] uppercase tracking-wider text-muted-foreground">
                                              Interesse:
                                            </span>
                                            <span>{message.warningMetadata.interest}</span>
                                          </div>
                                        )}
                                        {(message.warningMetadata.clientId ||
                                          message.warningMetadata.clientName) && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleOpenWarningChat(
                                                message.warningMetadata.clientId,
                                                message.warningMetadata.clientName,
                                              )
                                            }
                                            className="mt-0.5 flex items-center justify-center gap-1.5 w-full py-1.5 px-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold shadow-soft transition cursor-pointer border-none"
                                          >
                                            <span>Abrir Atendimento</span>
                                            <ArrowRight className="h-3 w-3" />
                                          </button>
                                        )}
                                      </div>
                                    )}

                                  {/* Balão/Card interativo: Ligação Direta via VigosPhone */}
                                  {message.relatedCalls && message.relatedCalls.length > 0 && (
                                    <div
                                      className="mt-2.5 p-2 rounded-xl bg-emerald-500/10 dark:bg-emerald-950/35 border border-emerald-500/35 shadow-2xs flex flex-col gap-1.5 cursor-default text-xs"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <div className="text-[9.5px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center justify-between">
                                        <span className="flex items-center gap-1">
                                          <PhoneCall className="h-3 w-3" />
                                          {message.relatedCalls.length === 1
                                            ? "Discagem Direta • VigosPhone"
                                            : `Discagem Direta • VigosPhone (${message.relatedCalls.length})`}
                                        </span>
                                        <span className="text-[9px] font-semibold">
                                          Clique para ligar
                                        </span>
                                      </div>
                                      <div className="flex flex-col gap-1.5">
                                        {message.relatedCalls.map((callItem) => (
                                          <a
                                            key={callItem.id || callItem.phone}
                                            href={getVigosPhoneLink(callItem.phone)}
                                            onClick={() =>
                                              handleVigosCallClick(
                                                callItem.clientName,
                                                callItem.conversationId,
                                              )
                                            }
                                            className="group/call p-2 rounded-lg bg-card/95 hover:bg-emerald-500/15 border border-emerald-500/30 hover:border-emerald-500/60 flex items-center justify-between gap-2 transition cursor-pointer no-underline"
                                          >
                                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                              <div className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 group-hover/call:bg-emerald-500 group-hover/call:text-white transition">
                                                <PhoneCall className="h-3.5 w-3.5" />
                                              </div>
                                              <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                  <span className="text-[11px] font-bold text-foreground truncate">
                                                    {callItem.clientName}
                                                  </span>
                                                  {callItem.company &&
                                                    callItem.company !== callItem.clientName && (
                                                      <span className="text-[9px] text-muted-foreground truncate">
                                                        • {callItem.company}
                                                      </span>
                                                    )}
                                                </div>
                                                <div className="text-[10.5px] font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                                  {formatDisplayPhone(callItem.phone)}
                                                </div>
                                                {(callItem.dealTitle || callItem.reason) && (
                                                  <div className="text-[9px] text-muted-foreground truncate">
                                                    {callItem.dealTitle
                                                      ? `${callItem.dealTitle}${callItem.dealValueFormatted ? ` • ${callItem.dealValueFormatted}` : ""}`
                                                      : callItem.reason}
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                            <div className="shrink-0 flex items-center gap-1 py-1.5 px-2.5 rounded-lg bg-emerald-600 group-hover/call:bg-emerald-500 text-white text-[10px] font-bold shadow-soft transition">
                                              <PhoneCall className="h-3 w-3" />
                                              <span>Ligar</span>
                                            </div>
                                          </a>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Card interativo: Lista de Negociações do CRM Citadas */}
                                  {message.relatedDeals && message.relatedDeals.length > 0 && (
                                    <div
                                      className="mt-2.5 p-2 rounded-xl bg-card/95 border border-border/80 shadow-2xs flex flex-col gap-1.5 cursor-default text-xs"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <div className="text-[9.5px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                                        <span className="flex items-center gap-1">
                                          <Briefcase className="h-3 w-3 text-primary" />
                                          {`Negociações do CRM (${message.relatedDeals.length})`}
                                        </span>
                                        <span className="text-[9px] font-semibold text-primary">
                                          Clique para abrir o card
                                        </span>
                                      </div>
                                      <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-0.5 scrollbar-thin">
                                        {message.relatedDeals.map((deal) => (
                                          <div
                                            key={deal.dealId}
                                            className="p-2 rounded-lg bg-muted/40 hover:bg-muted/70 border border-border/60 flex items-center justify-between gap-2 transition"
                                          >
                                            <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                                              <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="text-[11px] font-bold text-foreground truncate">
                                                  {deal.title}
                                                </span>
                                                <span className="px-1.5 py-0.2 rounded-full text-[8.5px] font-bold bg-primary/15 text-primary border border-primary/30">
                                                  {deal.valueFormatted}
                                                </span>
                                              </div>
                                              <div className="text-[9.5px] font-semibold text-muted-foreground truncate">
                                                {[
                                                  deal.stageLabel,
                                                  deal.company && deal.company !== "Sem empresa"
                                                    ? deal.company
                                                    : null,
                                                  deal.contactName && deal.contactName !== deal.company
                                                    ? deal.contactName
                                                    : null,
                                                ]
                                                  .filter(Boolean)
                                                  .join(" • ")}
                                              </div>
                                              {deal.contactPhone ? (
                                                <div className="text-[9.5px] font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                                                  📞 {formatDisplayPhone(deal.contactPhone)}
                                                </div>
                                              ) : (
                                                <div className="text-[9px] text-muted-foreground/80 italic">
                                                  Sem telefone vinculado no card
                                                </div>
                                              )}
                                              {deal.lastActivitySummary && (
                                                <div className="text-[9.5px] text-muted-foreground truncate italic">
                                                  "{deal.lastActivitySummary}"
                                                </div>
                                              )}
                                            </div>
                                            <div className="shrink-0 flex items-center gap-1">
                                              {deal.contactPhone && (
                                                <a
                                                  href={getVigosPhoneLink(deal.contactPhone)}
                                                  onClick={() =>
                                                    handleVigosCallClick(
                                                      deal.contactName || deal.company || deal.title,
                                                      deal.conversationId,
                                                    )
                                                  }
                                                  title={`Ligar para ${formatDisplayPhone(deal.contactPhone)} via VigosPhone`}
                                                  className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500/15 hover:bg-emerald-600 text-emerald-600 dark:text-emerald-400 hover:text-white border border-emerald-500/30 transition cursor-pointer"
                                                >
                                                  <PhoneCall className="h-3.5 w-3.5" />
                                                </a>
                                              )}
                                              <button
                                                type="button"
                                                onClick={() => handleOpenCrmDeal(deal.dealId)}
                                                className="shrink-0 flex items-center gap-1 py-1.5 px-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold shadow-soft transition cursor-pointer border-none"
                                              >
                                                <span>Abrir CRM</span>
                                                <ArrowRight className="h-3 w-3" />
                                              </button>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Card interativo: Lista de Conversas Citadas (Sobrecarga / Respostas da IA) */}
                                  {(() => {
                                    const list =
                                      message.warningType === "overload" &&
                                      message.warningMetadata?.conversations?.length
                                        ? message.warningMetadata.conversations
                                        : message.relatedConversations?.length
                                          ? message.relatedConversations
                                          : null;
                                    if (!list || list.length === 0) return null;

                                    return (
                                      <div
                                        className="mt-2.5 p-2 rounded-xl bg-card/95 border border-border/80 shadow-2xs flex flex-col gap-1.5 cursor-default text-xs"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div className="text-[9.5px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                                          <span>
                                            {message.warningType === "overload"
                                              ? `Atendimentos Ativos (${list.length})`
                                              : `Conversas Citadas (${list.length})`}
                                          </span>
                                          <span className="text-[9px] font-semibold text-primary">
                                            Clique para abrir
                                          </span>
                                        </div>
                                        <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto pr-0.5 scrollbar-thin">
                                          {list.map((conv: any) => (
                                            <div
                                              key={conv.clientId || conv.clientName}
                                              className="p-2 rounded-lg bg-muted/40 hover:bg-muted/70 border border-border/60 flex items-center justify-between gap-2 transition"
                                            >
                                              <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                  <span className="text-[11px] font-bold text-foreground truncate">
                                                    {conv.clientName}
                                                  </span>
                                                  {conv.company && (
                                                    <span className="text-[9px] text-muted-foreground truncate">
                                                      • {conv.company}
                                                    </span>
                                                  )}
                                                  {conv.isWaiting && (
                                                    <span className="px-1.5 py-0.2 rounded-full text-[8px] font-bold bg-amber-500/15 text-amber-500 border border-amber-500/30">
                                                      {conv.waitMinutes && conv.waitMinutes > 0
                                                        ? `Aguardando há ${conv.waitMinutes}min`
                                                        : "Aguardando resposta"}
                                                    </span>
                                                  )}
                                                </div>
                                                {(conv.dealTitle || conv.funnelName) && (
                                                  <div className="text-[9px] font-semibold text-primary/90 truncate">
                                                    {[conv.funnelName, conv.dealTitle]
                                                      .filter(Boolean)
                                                      .join(" • ")}
                                                  </div>
                                                )}
                                                {conv.lastMessage && (
                                                  <div className="text-[10px] text-muted-foreground truncate italic">
                                                    "{conv.lastMessage}"
                                                  </div>
                                                )}
                                              </div>
                                              {(conv.clientId || conv.clientName) && (
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    handleOpenWarningChat(
                                                      conv.clientId,
                                                      conv.clientName,
                                                    )
                                                  }
                                                  className="shrink-0 flex items-center gap-1 py-1.5 px-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold shadow-soft transition cursor-pointer border-none"
                                                >
                                                  <span>Abrir</span>
                                                  <ArrowRight className="h-3 w-3" />
                                                </button>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })()}

                                  <div className="mt-1 flex items-center justify-end gap-1 text-[9.5px] text-muted-foreground font-medium select-none">
                                    <span>{message.time}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}

                        {selected?.id === "valentina" &&
                          isValentinaTyping &&
                          valentinaThoughtTrace && (
                            <div className="flex items-start gap-2 w-full py-1">
                              <AiAvatar
                                tenantId={tenant}
                                className="h-6 w-6 shrink-0 rounded-full border border-border/80 shadow-xs mt-0.5"
                              />
                              <div className="flex-1 min-w-0">
                                <AgenticThoughtTrace
                                  trace={valentinaThoughtTrace}
                                  mode="live"
                                  compact
                                  onStepReveal={() => {
                                    if (shouldStickThreadToBottomRef.current) {
                                      scrollThreadToBottom(false);
                                    }
                                  }}
                                />
                              </div>
                            </div>
                          )}

                        <div ref={endRef} />
                      </div>

                      {/* Caixa de Composição (Composer) */}
                      <div className="shrink-0 border-t border-border/70 bg-card/95 p-2.5 backdrop-blur-md">
                        {metaRestricted && (
                          <div className="mb-2 rounded-xl border border-primary/20 bg-primary/5 dark:bg-primary/10 px-2.5 py-1.5 text-[11px] text-foreground">
                            {metaWindowOpen === null ? (
                              <div className="flex items-center gap-1.5 text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                                <span>Verificando janela de atendimento de 24h...</span>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
                                  <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                                  <span className="truncate">Janela de 24h encerrada.</span>
                                </div>
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
                                  <LayoutTemplate className="h-3.5 w-3.5" />
                                  Enviar Template
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {recordingState === "recording" ? (
                          /* Modo Gravação de Áudio Ativa */
                          <div className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-2.5 py-1.5">
                            <SystemTooltip content="Cancelar gravação">
                              <button
                                type="button"
                                onClick={discardRecording}
                                aria-label="Cancelar gravação"
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition cursor-pointer"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </SystemTooltip>

                            <div className="flex flex-1 items-center gap-2 min-w-0 px-1">
                              <span className="h-2 w-2 shrink-0 rounded-full bg-red-500 animate-ping" />
                              <div className="flex items-center gap-[3px] shrink-0">
                                {[0.5, 0.9, 0.65, 1, 0.7, 1.1, 0.6, 0.85].map((h, i) => (
                                  <div
                                    key={i}
                                    className="w-[3px] rounded-full bg-primary animate-pulse"
                                    style={{
                                      height: `${h * 14}px`,
                                      animationDelay: `${i * 75}ms`,
                                      animationDuration: `${550 + i * 65}ms`,
                                    }}
                                  />
                                ))}
                              </div>
                              <span className="text-xs font-bold text-primary tabular-nums ml-1">
                                {fmtSec(recordingSeconds)}
                              </span>
                            </div>

                            <SystemTooltip content="Parar e ouvir áudio">
                              <button
                                type="button"
                                onClick={stopRecording}
                                aria-label="Parar gravação"
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 transition cursor-pointer"
                              >
                                <Square className="h-3.5 w-3.5 fill-current" />
                              </button>
                            </SystemTooltip>
                          </div>
                        ) : recordingState === "preview" && audioUrl ? (
                          /* Modo Pré-visualização de Áudio (Ouvir / Excluir / Enviar) */
                          <div className="flex items-center gap-2">
                            <SystemTooltip content="Excluir áudio">
                              <button
                                type="button"
                                onClick={discardRecording}
                                disabled={sending}
                                aria-label="Excluir áudio gravado"
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive transition cursor-pointer disabled:opacity-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </SystemTooltip>

                            <div className="flex-1 min-w-0 flex justify-center">
                              <MiniAudioBubble src={audioUrl} isMe={false} />
                            </div>

                            <SystemTooltip content="Enviar áudio">
                              <button
                                type="button"
                                onClick={() => void handleSendAudio()}
                                disabled={sending || metaRestricted}
                                aria-label="Enviar áudio"
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition hover:bg-primary/90 active:scale-95 disabled:opacity-40 cursor-pointer"
                              >
                                {sending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Send className="h-4 w-4" />
                                )}
                              </button>
                            </SystemTooltip>
                          </div>
                        ) : (
                          /* Modo Padrão (Digitação ou Botão de Microfone quando vazio) */
                          <div className="flex items-end gap-2">
                            {activeProvider === "meta" &&
                              selected?.channel === "whatsapp" &&
                              selected?.id !== "valentina" && (
                                <SystemTooltip content="Templates Meta Oficiais">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!selected) return;
                                      if (!showMetaTemplateModal) {
                                        void loadMetaTemplates(selected.id);
                                      }
                                      setShowMetaTemplateModal((prev) => !prev);
                                    }}
                                    aria-label="Abrir templates Meta"
                                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition cursor-pointer ${
                                      showMetaTemplateModal
                                        ? "border-primary/40 bg-primary/10 text-primary"
                                        : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                                    }`}
                                  >
                                    <LayoutTemplate className="h-4 w-4" />
                                  </button>
                                </SystemTooltip>
                              )}
                            <textarea
                              ref={textareaRef}
                              value={draft}
                              onChange={handleTextareaInput}
                              onKeyDown={handleComposerKeyDown}
                              disabled={metaRestricted}
                              rows={1}
                              placeholder={
                                selected?.id === "valentina"
                                  ? `Pergunte algo para ${aiPersona.name}...`
                                  : "Digite uma mensagem (Enter para enviar)..."
                              }
                              aria-label="Mensagem para o cliente"
                              className="min-h-9 max-h-28 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/20 disabled:opacity-50"
                            />
                            {!draft.trim() && selected?.id !== "valentina" ? (
                              <SystemTooltip content="Gravar áudio">
                                <button
                                  type="button"
                                  onClick={() => void startRecording()}
                                  disabled={sending || metaRestricted}
                                  aria-label="Gravar áudio"
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition hover:bg-primary/90 active:scale-95 disabled:opacity-40 disabled:hover:bg-primary cursor-pointer"
                                >
                                  {sending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Mic className="h-4 w-4" />
                                  )}
                                </button>
                              </SystemTooltip>
                            ) : (
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                }}
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
                            )}
                          </div>
                        )}
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
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const x = Math.min(e.clientX, window.innerWidth - 220);
                            const y = Math.min(e.clientY, window.innerHeight - 200);
                            setContextMenu({ chatId: "valentina", x, y });
                          }}
                          className="group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-muted/70 active:scale-[0.99] cursor-pointer mb-1 border border-primary/20 bg-primary/5"
                        >
                          <div className="relative shrink-0 select-none">
                            <AiAvatar
                              tenantId={tenant}
                              className="h-9 w-9 rounded-full border border-primary/40 shadow-xs"
                            />
                            {aiUnreadCount > 0 && (
                              <span
                                title={`${aiUnreadCount} ${aiUnreadCount === 1 ? "mensagem não lida" : "mensagens não lidas"}`}
                                className="absolute -top-1 -left-1 z-10 flex h-4.5 min-w-4.5 items-center justify-center rounded-full border-2 border-card bg-primary px-1 text-[9px] font-black text-primary-foreground shadow-soft animate-in zoom-in-50"
                              >
                                {aiUnreadCount > 99 ? "99+" : aiUnreadCount}
                              </span>
                            )}
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
                                {aiConversation?.lastMessageTime || "Agora"}
                              </span>
                            </div>

                            <div className="mt-0.5 flex items-center justify-between gap-2">
                              <span
                                className={`truncate text-[11px] ${
                                  isValentinaTyping
                                    ? "text-primary font-semibold animate-pulse"
                                    : aiUnreadCount > 0
                                      ? "text-foreground font-semibold"
                                      : "text-muted-foreground"
                                }`}
                              >
                                {isValentinaTyping
                                  ? "Pensando..."
                                  : aiConversation?.messages?.at(-1)?.text
                                    ? previewSnippet(aiConversation.messages.at(-1)!.text)
                                    : "Assistente virtual pronto para ajudar"}
                              </span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="shrink-0 text-[10px] font-bold text-primary flex items-center gap-1">
                                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                                  {isValentinaTyping ? "Pensando" : "Online"}
                                </span>
                                {aiUnreadCount > 0 && (
                                  <span className="shrink-0 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-primary px-1 text-[9px] font-extrabold text-primary-foreground shadow-xs animate-in zoom-in-50">
                                    {aiUnreadCount > 99 ? "99+" : aiUnreadCount}
                                  </span>
                                )}
                              </div>
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
                                      <span className="text-primary font-semibold shrink-0">
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
      </DismissableLayerBranch>

      {/* Mini Pop-up de Menu de Contexto (botão direito) */}
      <AnimatePresence>
        {contextMenu && (() => {
          const chat = conversations.find((c) => c.id === contextMenu.chatId);
          if (!chat) return null;
          return (
            <DismissableLayerBranch asChild>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.1 }}
                data-crm-chat-widget
                aria-live="polite"
                className="fixed z-[10060] pointer-events-auto min-w-[200px] rounded-xl bg-card border border-border shadow-2xl p-1 text-xs"
                style={{ top: contextMenu.y, left: contextMenu.x }}
                onClick={(e) => e.stopPropagation()}
              >
                {chat.id !== "valentina" && (
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
                )}
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
                {chat.id !== "valentina" && (
                  <>
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
                  </>
                )}
              </motion.div>
            </DismissableLayerBranch>
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
        <DialogContent
          data-crm-chat-widget
          className="z-[10060] pointer-events-auto max-w-md p-5 bg-card text-foreground border border-border shadow-2xl"
        >
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
