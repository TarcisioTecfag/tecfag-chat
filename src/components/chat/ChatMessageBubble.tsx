import React, { memo } from "react";
import { useTrainingSurface } from "@/hooks/useTrainingSurface";
import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  Smile,
  Bookmark,
  Briefcase,
  CornerUpLeft,
  Lock,
  AlertCircle,
  ArrowRight,
  Clock,
  MessageSquare,
  PhoneCall,
  UserCheck,
  Users,
  HelpCircle,
  BookOpen,
  FileText,
  ShieldCheck,
  AlertTriangle,
  Database,
  Image as ImageIcon,
  Package,
  Info,
  ShoppingBag,
  ExternalLink,
  Copy,
  Check,
  Compass,
} from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AiAvatar } from "@/components/ui/AiAvatar";
import { stripNotificationEmojis } from "@/lib/format-notification-text";
import { MessageReactionPicker } from "./MessageReactionPicker";
import { MessageReactions } from "./MessageReactions";
import { MessageStatusTicks } from "./MessageStatusTicks";
import { SystemAnnotationBubble, type SystemAnnotationItem } from "./SystemAnnotationBubble";
import { AgenticThoughtTrace } from "@/components/valentina/chat-blocks/AgenticThoughtTrace";
import {
  Message,
  type KnowledgeSourceItem,
  type KnowledgeSourceStatus,
  type VtexProductPreviewItem,
} from "@/lib/mockData";
import {
  renderTextWithLinks,
  renderMessageContent,
  isEmojiOnly,
  QuotedMessagePreview,
} from "./ChatPanel";

const VTEX_HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&aacute;": "á",
  "&Aacute;": "Á",
  "&agrave;": "à",
  "&Agrave;": "À",
  "&acirc;": "â",
  "&Acirc;": "Â",
  "&atilde;": "ã",
  "&Atilde;": "Ã",
  "&auml;": "ä",
  "&Auml;": "Ä",
  "&eacute;": "é",
  "&Eacute;": "É",
  "&egrave;": "è",
  "&Egrave;": "È",
  "&ecirc;": "ê",
  "&Ecirc;": "Ê",
  "&iacute;": "í",
  "&Iacute;": "Í",
  "&icirc;": "î",
  "&Icirc;": "Î",
  "&oacute;": "ó",
  "&Oacute;": "Ó",
  "&ograve;": "ò",
  "&Ograve;": "Ò",
  "&ocirc;": "ô",
  "&Ocirc;": "Ô",
  "&otilde;": "õ",
  "&Otilde;": "Õ",
  "&uacute;": "ú",
  "&Uacute;": "Ú",
  "&ucirc;": "û",
  "&Ucirc;": "Û",
  "&uuml;": "ü",
  "&Uuml;": "Ü",
  "&ccedil;": "ç",
  "&Ccedil;": "Ç",
  "&ntilde;": "ñ",
  "&Ntilde;": "Ñ",
  "&ordm;": "º",
  "&ordf;": "ª",
  "&deg;": "°",
  "&sup2;": "²",
  "&sup3;": "³",
  "&sup1;": "¹",
  "&plusmn;": "±",
  "&times;": "×",
  "&divide;": "÷",
  "&ndash;": "–",
  "&mdash;": "—",
  "&bull;": "•",
  "&hellip;": "…",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&rdquo;": "”",
  "&ldquo;": "“",
  "&reg;": "®",
  "&trade;": "™",
  "&copy;": "©",
};

export function decodeVtexEntities(raw?: string | null): string {
  if (!raw) return "";
  let out = String(raw);
  for (let pass = 0; pass < 2; pass++) {
    out = out
      .replace(/&#(\d+);/g, (_m, dec) => {
        const code = Number(dec);
        return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : "";
      })
      .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
        const code = parseInt(hex, 16);
        return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : "";
      })
      .replace(/&[a-zA-Z0-9#]+;/g, (entity) => {
        if (VTEX_HTML_ENTITIES[entity] !== undefined) return VTEX_HTML_ENTITIES[entity];
        const lower = entity.toLowerCase();
        if (VTEX_HTML_ENTITIES[lower] !== undefined) return VTEX_HTML_ENTITIES[lower];
        return entity;
      });
  }
  return out;
}

export function isBoilerplateVtexIntroText(raw?: string | null): boolean {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return true;
  return (
    /^Segue\s+abaixo\s+o\s+link\s+direto\s+e\s+a\s+pr[eé]via\s+oficial\s+da\s+/i.test(trimmed) ||
    /^\*\*[^*]+\*\*\s*(?:\(e\s+modelos\s+relacionados\)\s*)?[—-]\s*Confira\s+abaixo\s+o\s+preview\s+oficial/i.test(
      trimmed
    )
  );
}

export function VtexProductPreviewCard({
  preview,
  previews,
  onMediaClick,
  compact = false,
  standalone = false,
}: {
  preview: VtexProductPreviewItem;
  previews?: VtexProductPreviewItem[];
  onMediaClick?: (type: "image" | "video" | "audio", url: string, caption?: string) => void;
  compact?: boolean;
  standalone?: boolean;
}) {
  const allPreviews = React.useMemo(() => {
    const list = Array.isArray(previews) && previews.length > 0 ? previews : [preview];
    const seen = new Set<string>();
    return list.filter((item) => {
      if (!item || !item.url) return false;
      const key = `${item.productId}-${item.skuId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [preview, previews]);

  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [copiedUrl, setCopiedUrl] = React.useState<string | null>(null);
  const [imgError, setImgError] = React.useState<Record<string, boolean>>({});

  const activeItem = allPreviews[selectedIdx] || preview;
  if (!activeItem) return null;

  const itemKey = `${activeItem.productId}-${activeItem.skuId}`;
  const hasValidImage = Boolean(activeItem.imageUrl && !imgError[itemKey]);
  const cleanName = decodeVtexEntities(activeItem.name);
  const cleanDescription = decodeVtexEntities(activeItem.descriptionSnippet);
  const cleanBrand = decodeVtexEntities(activeItem.brand);
  const cleanCategory = decodeVtexEntities(activeItem.category);

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeItem.url) return;
    navigator.clipboard?.writeText(activeItem.url).catch(() => {});
    setCopiedUrl(activeItem.url);
    setTimeout(() => {
      setCopiedUrl((prev) => (prev === activeItem.url ? null : prev));
    }, 2200);
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`${
        standalone ? "mt-0 rounded-2xl rounded-bl-xs" : "mt-2.5 rounded-xl"
      } bg-card border border-border/90 shadow-md overflow-hidden flex flex-col text-left cursor-default transition-all ${
        compact ? "max-w-[340px]" : "max-w-[420px]"
      }`}
    >
      {/* Cabeçalho Oficial VTEX */}
      <div className="px-3 py-2 bg-muted/45 border-b border-border/70 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="p-1 rounded-md bg-primary/12 text-primary border border-primary/25 shrink-0">
            <ShoppingBag className="h-3 w-3" />
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-foreground truncate">
            Loja Oficial VTEX • Tecfag
          </span>
        </div>
        <span
          className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-bold border ${
            activeItem.available
              ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
              : "bg-amber-500/12 text-amber-600 dark:text-amber-400 border-amber-500/30"
          }`}
        >
          {activeItem.available ? "Disponível no site" : "Sob consulta"}
        </span>
      </div>

      {/* Seletor rápido quando houver mais de 1 máquina relacionada */}
      {allPreviews.length > 1 && (
        <div className="px-2.5 py-1.5 bg-muted/25 border-b border-border/60 flex items-center gap-1 overflow-x-auto">
          {allPreviews.map((item, idx) => {
            const isSel = idx === selectedIdx;
            const shortLabel = item.modelCode || item.internalCode || `SKU ${item.skuId}`;
            return (
              <button
                key={`${item.productId}-${item.skuId}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedIdx(idx);
                }}
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition cursor-pointer shrink-0 border ${
                  isSel
                    ? "bg-primary text-primary-foreground border-primary shadow-2xs"
                    : "bg-background/80 text-muted-foreground hover:text-foreground border-border/70"
                }`}
              >
                {shortLabel}
              </button>
            );
          })}
        </div>
      )}

      {/* Preview Visual da Máquina vindo da VTEX */}
      {hasValidImage && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            if (onMediaClick && activeItem.imageUrl) {
              onMediaClick("image", activeItem.imageUrl, cleanName);
            } else if (activeItem.url) {
              window.open(activeItem.url, "_blank", "noopener,noreferrer");
            }
          }}
          className="relative w-full h-44 sm:h-48 bg-white dark:bg-zinc-900/90 border-b border-border/60 flex items-center justify-center p-3 overflow-hidden group/vteximg cursor-pointer"
        >
          <img
            src={activeItem.imageUrl!}
            alt={cleanName}
            onError={() => setImgError((prev) => ({ ...prev, [itemKey]: true }))}
            className="max-h-full max-w-full object-contain transition-transform duration-300 group-hover/vteximg:scale-105"
          />
          <div className="absolute top-2 left-2 flex flex-wrap items-center gap-1 pointer-events-none">
            <span className="px-2 py-0.5 rounded-md bg-zinc-900/80 text-white text-[9.5px] font-mono font-bold backdrop-blur-xs">
              SKU #{activeItem.skuId}
            </span>
            {activeItem.internalCode && (
              <span className="px-2 py-0.5 rounded-md bg-primary/90 text-primary-foreground text-[9.5px] font-mono font-bold backdrop-blur-xs">
                {activeItem.internalCode}
              </span>
            )}
          </div>
          {activeItem.modelCode && (
            <div className="absolute bottom-2 right-2 pointer-events-none">
              <span className="px-2 py-0.5 rounded-md bg-zinc-900/75 text-white text-[9.5px] font-bold backdrop-blur-xs">
                Modelo {activeItem.modelCode}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Corpo Descritivo + Preço + Especificações da Página VTEX */}
      <div className="p-3 flex flex-col gap-2">
        {(cleanCategory || cleanBrand) && (
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider truncate">
            {[cleanBrand, cleanCategory].filter(Boolean).join(" • ")}
          </div>
        )}

        <a
          href={activeItem.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-xs sm:text-[13px] font-bold text-foreground hover:text-primary leading-snug transition-colors no-underline"
        >
          {cleanName}
        </a>

        {/* Linha de Preço Público VTEX e Estoque */}
        <div className="flex items-baseline justify-between gap-2 pt-0.5">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-sm sm:text-base font-black text-primary">
              {activeItem.priceFormatted || "Sob consulta"}
            </span>
            {activeItem.listPriceFormatted &&
              activeItem.listPriceFormatted !== activeItem.priceFormatted &&
              (activeItem.listPriceCents ?? 0) > (activeItem.priceCents ?? 0) && (
                <span className="text-[10px] text-muted-foreground line-through">
                  {activeItem.listPriceFormatted}
                </span>
              )}
          </div>
          {!hasValidImage && (
            <span className="text-[10px] font-mono font-bold text-muted-foreground">
              SKU #{activeItem.skuId}
              {activeItem.internalCode ? ` • ${activeItem.internalCode}` : ""}
            </span>
          )}
        </div>

        {/* Descritivo extraído da página VTEX */}
        {cleanDescription && (
          <div className="text-[11px] text-muted-foreground bg-muted/35 border border-border/60 rounded-lg px-2.5 py-2 leading-relaxed line-clamp-3">
            {cleanDescription}
          </div>
        )}

        {/* Pílulas de especificações lidas da página VTEX */}
        {Array.isArray(activeItem.specificationsSummary) &&
          activeItem.specificationsSummary.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {activeItem.specificationsSummary.slice(0, 4).map((spec: any, sIdx) => {
                const rawSpecText =
                  typeof spec === "string"
                    ? spec
                    : spec && typeof spec === "object"
                    ? `${spec.label}: ${spec.value}`
                    : "";
                const specText = decodeVtexEntities(rawSpecText);
                if (!specText) return null;
                return (
                  <span
                    key={sIdx}
                    className="text-[9.5px] font-medium px-2 py-0.5 rounded-md bg-muted/55 text-foreground/90 border border-border/60 max-w-full truncate"
                  >
                    {specText}
                  </span>
                );
              })}
            </div>
          )}

        {/* Botões de Ação: Abrir Página da Máquina no Site + Copiar Link */}
        <div className="pt-1.5 flex items-center gap-1.5">
          <a
            href={activeItem.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-bold shadow-soft transition cursor-pointer no-underline"
          >
            <span>Abrir Máquina no Site</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </a>
          <button
            type="button"
            onClick={handleCopyLink}
            className="flex items-center justify-center gap-1 py-2 px-2.5 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-[11px] font-semibold border border-border/80 transition cursor-pointer shrink-0"
          >
            {copiedUrl === activeItem.url ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                <span>Copiado</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span>Copiar Link</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MessageKnowledgeSourceButton({
  message,
  compact = false,
}: {
  message: {
    author?: string;
    knowledgeSources?: KnowledgeSourceItem[];
    knowledgeSourceStatus?: KnowledgeSourceStatus;
    knowledgeSourceStatusLabel?: string;
    knowledgeSourceStatusDescription?: string;
  };
  isExpanded?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  useTrainingSurface("source", step => { setOpen(step.id === "chat.message-source-states"); return true; });
  const sources = Array.isArray(message.knowledgeSources) ? message.knowledgeSources : [];
  const status: KnowledgeSourceStatus =
    message.knowledgeSourceStatus ||
    (sources.some((s) => s.kind === "manual" || s.kind === "document" || s.kind === "vtex" || s.kind === "system_guide")
      ? "verified"
      : sources.some((s) => s.kind === "catalog" || s.kind === "photo")
      ? "catalog_only"
      : "operational_or_chat");

  const hasSources = sources.length > 0;
  const isVerifiedManual = status === "verified";
  const isCatalogVerified = status === "catalog_only";
  const isHonestUnknown = status === "honest_unknown";
  const isUnverifiedTech = status === "unverified_technical";

  const hoverVisibilityClass = open
    ? "opacity-100 pointer-events-auto"
    : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto";

  const statusConfig = isVerifiedManual
    ? {
        badgeBg: "bg-primary/10 border-primary/30 text-primary",
        btnClass: `${hoverVisibilityClass} text-primary bg-primary/10 hover:bg-primary/20 border border-primary/25`,
        icon: ShieldCheck,
        title: message.knowledgeSourceStatusLabel || "Fonte Técnica Verificada (Manual / RAG)",
        desc:
          message.knowledgeSourceStatusDescription ||
          "As informações técnicas desta mensagem foram extraídas diretamente dos Manuais Técnicos (PDF), Loja Oficial VTEX e Catálogo Oficial indexados na Base de Conhecimento.",
        tooltip: `Fonte verificada (${sources.length} ${sources.length === 1 ? "documento/ficha" : "documentos/fichas"}) — Clique para ver de onde ${message.author || "o assistente"} tirou a informação`,
      }
    : isCatalogVerified
    ? {
        badgeBg: "bg-primary/10 border-primary/30 text-primary",
        btnClass: `${hoverVisibilityClass} text-primary bg-primary/10 hover:bg-primary/20 border border-primary/25`,
        icon: BookOpen,
        title: message.knowledgeSourceStatusLabel || "Fonte Verificada no Catálogo Oficial",
        desc:
          message.knowledgeSourceStatusDescription ||
          "Modelos, códigos e linhas consultados diretamente no Catálogo Oficial de Máquinas e Acervo da Base de Conhecimento.",
        tooltip: `Catálogo Oficial (${sources.length} ${sources.length === 1 ? "referência" : "referências"}) — Clique para ver a fonte da informação`,
      }
    : isHonestUnknown
    ? {
        badgeBg: "bg-primary/10 border-primary/30 text-primary",
        btnClass: `${hoverVisibilityClass} text-primary bg-primary/10 hover:bg-primary/20 border border-primary/25`,
        icon: Info,
        title: message.knowledgeSourceStatusLabel || "Sinceridade Técnica (Anti-Alucinação)",
        desc:
          message.knowledgeSourceStatusDescription ||
          "O assistente verificou a documentação disponível e declarou com sinceridade os pontos que não constam no manual/catálogo, sem inventar dados.",
        tooltip: "Sinceridade Técnica — Clique para ver os documentos checados",
      }
    : isUnverifiedTech
    ? {
        badgeBg: "bg-primary/10 border-primary/30 text-primary",
        btnClass: `${hoverVisibilityClass} text-primary bg-primary/10 hover:bg-primary/20 border border-primary/25`,
        icon: AlertTriangle,
        title: message.knowledgeSourceStatusLabel || "Atenção: Sem Manual ou Ficha Vinculada",
        desc:
          message.knowledgeSourceStatusDescription ||
          "Esta resposta cita termos técnicos, mas nenhum Manual Técnico PDF ou item do Catálogo Oficial foi vinculado diretamente. Recomenda-se validar na ficha física antes de confirmar ao cliente.",
        tooltip: "Atenção: Nenhum manual vinculado a esta especificação — Clique para auditar",
      }
    : {
        badgeBg: "bg-primary/10 border-primary/25 text-primary",
        btnClass: `${hoverVisibilityClass} hover:bg-primary/10 text-muted-foreground hover:text-primary`,
        icon: Info,
        title: message.knowledgeSourceStatusLabel || "Interação Operacional / Conversa",
        desc:
          message.knowledgeSourceStatusDescription ||
          "Mensagem conversacional ou de acompanhamento operacional (não exigiu extração de ficha técnica de máquina).",
        tooltip: "Ver fonte da informação",
      };

  const StatusIcon = statusConfig.icon;

  const getSourceIcon = (kind: KnowledgeSourceItem["kind"]) => {
    switch (kind) {
      case "manual":
      case "document":
        return FileText;
      case "vtex":
        return ShoppingBag;
      case "system_guide":
        return Compass;
      case "catalog":
        return Package;
      case "photo":
        return ImageIcon;
      case "crm":
        return Database;
      default:
        return BookOpen;
    }
  };

  const getSourceBadgeLabel = (kind: KnowledgeSourceItem["kind"]) => {
    switch (kind) {
      case "manual":
        return "Manual Técnico PDF";
      case "document":
        return "Documento Oficial";
      case "vtex":
        return "Loja Oficial VTEX Ao Vivo";
      case "system_guide":
        return "Guia do Sistema • Wizard";
      case "catalog":
        return "Catálogo Oficial";
      case "photo":
        return "Foto Oficial da Base";
      case "crm":
        return "Dados do CRM";
      default:
        return "Fonte da Base";
    }
  };

  const getSourceAccent = (kind: KnowledgeSourceItem["kind"]) => {
    switch (kind) {
      case "manual":
      case "document":
      case "vtex":
      case "system_guide":
      case "catalog":
      case "photo":
      case "crm":
        return "bg-primary/10 text-primary border-primary/25";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <SystemTooltip content={open ? null : statusConfig.tooltip}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-tour="message.source" data-training-action="true"
            onClick={(e) => e.stopPropagation()}
            onMouseLeave={(e) => e.currentTarget.blur()}
            className={`${
              compact ? "p-1" : "p-1.5"
            } rounded-full transition-opacity duration-150 cursor-pointer shrink-0 relative flex items-center justify-center ${
              statusConfig.btnClass
            }`}
          >
            <HelpCircle className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
            {hasSources && (
              <span className="absolute -top-1 -right-1 min-w-[13px] h-[13px] px-0.5 rounded-full bg-primary text-primary-foreground text-[8px] font-bold flex items-center justify-center shadow-xs pointer-events-none">
                {sources.length}
              </span>
            )}
            {!hasSources && isUnverifiedTech && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary pointer-events-none" />
            )}
          </button>
        </PopoverTrigger>
      </SystemTooltip>
      <PopoverContent
        data-tour="message.source-panel"
        align="end"
        side="top"
        sideOffset={8}
        collisionPadding={16}
        avoidCollisions={true}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
        className="w-[360px] sm:w-[400px] max-w-[calc(100vw-32px)] p-0 rounded-2xl border border-border/80 bg-popover/98 backdrop-blur-xl shadow-2xl overflow-hidden z-50"
      >
        {/* Cabeçalho do Inspetor de Fonte */}
        <div className="px-3.5 py-3 border-b border-border/60 bg-muted/30">
          <div className="flex items-start gap-2.5">
            <div className={`p-1.5 rounded-xl border shrink-0 mt-0.5 ${statusConfig.badgeBg}`}>
              <StatusIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Fonte da Informação • {message.author || "Assistente IA"}
                </span>
                {hasSources && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-background border border-border text-foreground shrink-0">
                    {sources.length} {sources.length === 1 ? "fonte" : "fontes"}
                  </span>
                )}
              </div>
              <h4 className="text-xs font-bold text-foreground mt-0.5 leading-snug">
                {statusConfig.title}
              </h4>
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                {statusConfig.desc}
              </p>
            </div>
          </div>
        </div>

        {/* Lista de Documentos / Manuais / Fichas Consultadas */}
        <div className="max-h-[300px] overflow-y-auto divide-y divide-border/50">
          {hasSources ? (
            sources.map((src) => {
              const SrcIcon = getSourceIcon(src.kind);
              const badgeAccent = getSourceAccent(src.kind);
              return (
                <div
                  key={src.id}
                  className="px-3.5 py-2.5 hover:bg-muted/30 transition-colors flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border ${badgeAccent}`}
                    >
                      <SrcIcon className="h-3 w-3 shrink-0" />
                      {src.badge || getSourceBadgeLabel(src.kind)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {src.code && (
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-muted text-foreground border border-border/70">
                          {src.code}
                        </span>
                      )}
                      {src.charCount && src.charCount > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          {(src.charCount / 1000).toFixed(1)}k chars
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-xs font-semibold text-foreground leading-snug break-words">
                    {src.title}
                  </div>

                  {(src.folderOrCategory || src.subtitle) && (
                    <div className="text-[10px] font-medium text-muted-foreground">
                      {src.folderOrCategory || src.subtitle}
                    </div>
                  )}

                  {(src.excerptOrDetail || src.excerpt) && (
                    <div className="mt-0.5 text-[11px] text-muted-foreground bg-muted/40 border border-border/60 rounded-lg px-2.5 py-1.5 leading-relaxed line-clamp-4">
                      {src.excerptOrDetail || src.excerpt}
                    </div>
                  )}

                  {src.url && (
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] font-bold text-primary hover:underline"
                    >
                      <span>Abrir página oficial na loja VTEX</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  )}
                </div>
              );
            })
          ) : (
            <div className="px-4 py-5 text-center">
              <p className="text-xs font-medium text-foreground">
                {isUnverifiedTech
                  ? "Nenhum Manual PDF ou Ficha do Catálogo Oficial foi localizado para esta afirmação."
                  : isHonestUnknown
                  ? "O assistente verificou a base e informou sinceramente que o dado solicitado não consta nos manuais ativos."
                  : "Esta mensagem não exigiu extração de manual técnico ou ficha de equipamento."}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                {isUnverifiedTech
                  ? "Cuidado com possível alucinação: confirme especificações críticas na ficha física ou com a engenharia."
                  : "Quando a resposta incluir dados técnicos de uma máquina, o manual PDF e a ficha do catálogo aparecerão listados aqui."}
              </p>
            </div>
          )}
        </div>

        {/* Rodapé de Auditoria Anti-Alucinação */}
        <div className="px-3.5 py-2 bg-muted/40 border-t border-border/60 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span>Auditoria de Fonte & Anti-Alucinação</span>
          <span className="font-semibold text-foreground/80">
            {hasSources ? "Base Oficial Vinculada" : isUnverifiedTech ? "Requer Conferência" : "Sem Manual Técnico"}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function getVigosPhoneLink(phone?: string | null): string {
  if (!phone) return "#";
  let n = phone.replace(/\D/g, "");
  if (n.startsWith("55") && n.length > 10) n = n.substring(2);
  if (n.startsWith("0")) n = n.substring(1);
  if (n.startsWith("14")) n = n.substring(2);
  return `tel:${n}`;
}

function formatDisplayPhone(phone?: string | null): string {
  if (!phone) return "";
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

export interface ConnectionBannerInfo {
  label: string;
  foreignConversationId?: string | null;
}

function ConnectionBannerPill({
  banner,
  onOpenSourceConversation,
}: {
  banner?: ConnectionBannerInfo | null;
  onOpenSourceConversation?: (conversationId: string) => void;
}) {
  if (!banner) return null;
  return (
    <div className="flex justify-center my-2.5 select-none">
      <div className="inline-flex flex-wrap items-center justify-center gap-1.5 rounded-full bg-muted/80 dark:bg-muted/50 px-4 py-1 text-[11px] font-bold text-muted-foreground/90 border border-border/60 shadow-2xs text-center max-w-[92%]">
        <span>{banner.label}</span>
        {banner.foreignConversationId && onOpenSourceConversation && (
          <>
            <span className="opacity-50">·</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenSourceConversation(banner.foreignConversationId!);
              }}
              className="underline text-primary hover:opacity-80 transition cursor-pointer font-extrabold"
            >
              Abrir conversa deste número
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export interface ChatMessageBubbleProps {
  m: Message;
  prevLinked: boolean;
  nextLinked: boolean;
  isFirst: boolean;
  isLast: boolean;
  gap: string;
  dateLabel: string | null;
  connectionBanner?: ConnectionBannerInfo | null;
  systemGroup?: SystemAnnotationItem[];
  groupKnowledgeSources?: KnowledgeSourceItem[];
  isMe: boolean;
  isSystem: boolean;
  isExpanded: boolean;
  isMatch: boolean;
  displayQuotedContent: string | null;
  displayQuotedSender: string;
  quotedTargetId: string | null;
  activeChat: {
    id: string;
    name: string;
    avatar?: string;
    initials?: string;
  };
  aiPersona: {
    name: string;
    avatarUrl: string;
  };
  tenant: string;
  reactingMsgId: string | null;
  effectiveStatus?: string;
  effectiveError?: string | null;
  onReconcile?: (id: string, action: "resend" | "confirm_sent", uncertain: boolean) => void;
  onOpenSourceConversation?: (conversationId: string) => void;
  onBubbleClick: (e: React.MouseEvent, id: string) => void;
  onScrollToQuoted: (e: React.MouseEvent, targetId: string) => void;
  onSetReactingMsgId: (id: string | null) => void;
  onSetMarkingEvidenceMsg: (msg: {
    id: string;
    text: string;
    author: string;
    time: string;
  }) => void;
  onSetReplyingTo: (msg: Message) => void;
  onToggleReaction: (chatId: string, msgId: string, emoji: string) => void;
  onMediaClick?: (type: "image" | "video", url: string) => void;
  onSaveSticker?: (messageId: string, url: string) => void;
  onOpenWarningChat?: (clientId: string, clientName?: string) => void;
  onSendWelcomeSuggestion?: (text: string) => void;
}

function ChatMessageBubbleComponent({
  m,
  isFirst,
  isLast,
  gap,
  dateLabel,
  connectionBanner,
  systemGroup,
  groupKnowledgeSources,
  isMe,
  isSystem,
  isExpanded,
  isMatch,
  displayQuotedContent,
  displayQuotedSender,
  quotedTargetId,
  activeChat,
  aiPersona,
  tenant,
  reactingMsgId,
  effectiveStatus,
  effectiveError,
  onReconcile,
  onOpenSourceConversation,
  onBubbleClick,
  onScrollToQuoted,
  onSetReactingMsgId,
  onSetMarkingEvidenceMsg,
  onSetReplyingTo,
  onToggleReaction,
  onMediaClick,
  onSaveSticker,
  onOpenWarningChat,
  onSendWelcomeSuggestion,
}: ChatMessageBubbleProps) {
  const navigate = useNavigate();
  const [dealSearchQuery, setDealSearchQuery] = React.useState("");
  const safeText = typeof m.text === "string" ? m.text : "";
  // ── 1. Mensagens de Sistema (ocultas por padrão no ícone ? discreto, agrupadas quando em sequência) ──
  if (isSystem) {
    return (
      <div key={m.clientMessageId || m.id} className="w-full">
        {dateLabel && (
          <div className="flex justify-center my-3 select-none">
            <span className="rounded-full bg-muted/80 dark:bg-muted/50 px-4 py-1 text-[11px] font-bold text-muted-foreground/90 border border-border/60 shadow-2xs">
              {dateLabel}
            </span>
          </div>
        )}
        <SystemAnnotationBubble
          text={safeText}
          time={m.time}
          items={systemGroup}
          gap={gap}
          renderText={(val) => renderTextWithLinks(val)}
        />
      </div>
    );
  }

  // ── 2. Notas Internas ──
  if (m.isInternalNote) {
    return (
      <div key={m.clientMessageId || m.id} className="w-full">
        {dateLabel && (
          <div className="flex justify-center my-3 select-none">
            <span className="rounded-full bg-muted/80 dark:bg-muted/50 px-4 py-1 text-[11px] font-bold text-muted-foreground/90 border border-border/60 shadow-2xs">
              {dateLabel}
            </span>
          </div>
        )}
        <div className={`flex flex-col items-center ${gap} w-full`}>
          <div className="max-w-[85%] rounded-2xl border border-amber-500/20 bg-amber-500/10 dark:bg-amber-950/40 dark:border-amber-500/30 px-5 py-3 shadow-soft text-left">
            <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase mb-1.5 text-amber-600 dark:text-amber-400">
              <Lock className="h-3 w-3 shrink-0" />
              Anotação Interna — {m.author} às {m.time}
            </div>
            <p className="text-xs leading-relaxed font-medium text-amber-950 dark:text-amber-200">
              {renderTextWithLinks(safeText, false, true)}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isSticker = safeText.startsWith("[MEDIA:sticker]") || safeText.startsWith("[LOCAL_MEDIA:sticker]");
  const isMedia =
    safeText.startsWith("[MEDIA:") ||
    safeText.startsWith("[LOCAL_MEDIA:") ||
    safeText.startsWith("[SEND_IMAGE:");
  const hasCaption = isMedia && safeText.includes("\n") && safeText.split("\n").slice(1).join("\n").trim().length > 0;
  const isAudioOrDoc =
    safeText.startsWith("[MEDIA:audio]") ||
    safeText.startsWith("[LOCAL_MEDIA:audio]") ||
    safeText.startsWith("[MEDIA:document]") ||
    safeText.startsWith("[LOCAL_MEDIA:document]");

  // Border-radius por posição no grupo (estilo WhatsApp)
  const outR =
    isFirst && isLast
      ? "rounded-2xl"
      : isFirst
      ? "rounded-2xl rounded-br-[5px]"
      : isLast
      ? "rounded-2xl rounded-tr-[5px]"
      : "rounded-lg rounded-r-[5px]";

  const inR =
    isFirst && isLast
      ? "rounded-2xl"
      : isFirst
      ? "rounded-2xl rounded-bl-[5px]"
      : isLast
      ? "rounded-2xl rounded-tl-[5px]"
      : "rounded-lg rounded-l-[5px]";

  // ── 3. Mensagens Enviadas (Operador / Empresa) ──
  if (isMe) {
    return (
      <div key={m.clientMessageId || m.id} className="w-full">
        {dateLabel && (
          <div className="flex justify-center my-3 select-none">
            <span className="rounded-full bg-muted/80 dark:bg-muted/50 px-4 py-1 text-[11px] font-bold text-muted-foreground/90 border border-border/60 shadow-2xs">
              {dateLabel}
            </span>
          </div>
        )}
        <ConnectionBannerPill
          banner={connectionBanner}
          onOpenSourceConversation={onOpenSourceConversation}
        />
        <motion.div
          id={`msg-dom-${m.id}`}
          initial={{ opacity: 0, x: 18, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          className={`flex flex-col items-end group relative w-full ${gap}`}
        >
          <div className="flex items-center gap-2 max-w-[80%] justify-end relative">
            <SystemTooltip content="Reagir">
              <button
                type="button"
                data-tour="message.react" data-training-action="true"
                onClick={() => onSetReactingMsgId(reactingMsgId === m.id ? null : m.id)}
                onMouseLeave={(e) => e.currentTarget.blur()}
                className={`opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-all duration-150 cursor-pointer shrink-0 ${
                  isExpanded ? "!opacity-100" : ""
                } ${reactingMsgId === m.id ? "!opacity-100 bg-muted text-foreground" : ""}`}
              >
                <Smile className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
            {activeChat.id !== "valentina" && (
              <SystemTooltip content="Marcar como evidência do negócio">
                <button
                  type="button"
                  data-tour="message.evidence" data-training-action="true"
                onClick={() =>
                    onSetMarkingEvidenceMsg({
                      id: m.id,
                      text: m.text,
                      author: m.author,
                      time: m.time,
                    })
                  }
                  onMouseLeave={(e) => e.currentTarget.blur()}
                  className={`opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-amber-500 transition-all duration-150 cursor-pointer shrink-0 ${
                    isExpanded ? "!opacity-100" : ""
                  }`}
                >
                  <Bookmark className="h-3.5 w-3.5" />
                </button>
              </SystemTooltip>
            )}
            <SystemTooltip content="Responder">
              <button
                type="button"
                data-tour="message.reply" data-training-action="true"
                onClick={() => onSetReplyingTo(m)}
                onMouseLeave={(e) => e.currentTarget.blur()}
                className={`opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-all duration-150 cursor-pointer shrink-0 ${
                  isExpanded ? "!opacity-100" : ""
                }`}
              >
                <CornerUpLeft className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>

            {isSticker ? (
              <div className="leading-relaxed">
                {displayQuotedContent && (
                  <QuotedMessagePreview
                    sender={displayQuotedSender}
                    content={displayQuotedContent}
                    variant="card"
                    className="mb-1"
                    onClick={(e) => quotedTargetId && onScrollToQuoted(e, quotedTargetId)}
                  />
                )}
                {renderMessageContent(
                  safeText,
                  onMediaClick,
                  true,
                  onSaveSticker,
                  m.author,
                  activeChat.name,
                )}
              </div>
            ) : isAudioOrDoc ? (
              <div className="flex flex-col items-end gap-1.5">
                {displayQuotedContent && (
                  <QuotedMessagePreview
                    sender={displayQuotedSender}
                    content={displayQuotedContent}
                    variant="card"
                    className="mb-0.5"
                    onClick={(e) => quotedTargetId && onScrollToQuoted(e, quotedTargetId)}
                  />
                )}
                {renderMessageContent(
                  safeText,
                  onMediaClick,
                  true,
                  undefined,
                  m.author,
                  activeChat.name,
                )}
              </div>
            ) : isMedia && !hasCaption && !displayQuotedContent ? (
              <div>
                {renderMessageContent(
                  safeText,
                  onMediaClick,
                  true,
                  undefined,
                  m.author,
                  activeChat.name,
                )}
              </div>
            ) : isEmojiOnly(safeText) && !displayQuotedContent ? (
              <div className="text-4xl leading-none select-none py-1">{safeText}</div>
            ) : (
              <div
                onClick={(e) => onBubbleClick(e, m.id)}
                className={`${outR} px-4 py-2.5 text-sm leading-relaxed shadow-soft bg-primary text-primary-foreground text-left cursor-pointer transition-all duration-300 ${
                  isMatch ? "scale-[1.01] shadow-lg" : ""
                }`}
                style={{
                  outline: isMatch ? "3px solid var(--primary)" : undefined,
                  outlineOffset: isMatch ? "2px" : undefined,
                }}
              >
                {displayQuotedContent && (
                  <QuotedMessagePreview
                    sender={displayQuotedSender}
                    content={displayQuotedContent}
                    variant="outgoing"
                    className="mb-1.5"
                    onClick={(e) => quotedTargetId && onScrollToQuoted(e, quotedTargetId)}
                  />
                )}
                {renderMessageContent(
                  safeText,
                  onMediaClick,
                  true,
                  undefined,
                  m.author,
                  activeChat.name,
                )}
              </div>
            )}

            {reactingMsgId === m.id && (
              <MessageReactionPicker
                activeEmoji={m.reactions?.find((r) => r.from === "operator")?.emoji || null}
                side="out"
                onSelectEmoji={(emoji) => onToggleReaction(activeChat.id, m.id, emoji)}
                onClose={() => onSetReactingMsgId(null)}
              />
            )}
          </div>

          <MessageReactions
            reactions={m.reactions}
            side="out"
            onReactionClick={() => onToggleReaction(activeChat.id, m.id, "")}
          />
          {["failed", "unknown", "uncertain", "pending"].includes(effectiveStatus || "") && (
            <div className="text-xs mt-2 space-x-3">
              <span>
                {effectiveStatus === "pending"
                  ? "Na fila de envio"
                  : effectiveStatus === "failed"
                    ? "Falha no envio"
                    : "Resultado do envio desconhecido"}
              </span>
              {effectiveError && <p>{effectiveError}</p>}
              {effectiveStatus !== "pending" && onReconcile && (
                <>
                  <button
                    className="underline"
                    onClick={(event) => {
                      event.stopPropagation();
                      onReconcile(m.id, "resend", effectiveStatus !== "failed");
                    }}
                  >
                    Reenviar
                  </button>
                  {effectiveStatus !== "failed" && (
                    <button
                      className="underline"
                      onClick={(event) => {
                        event.stopPropagation();
                        onReconcile(m.id, "confirm_sent", true);
                      }}
                    >
                      Já foi enviado
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {(() => {
            const hasTicks = m.provider === "meta" && !m.isInternalNote && !!effectiveStatus;
            const showTicks = hasTicks && (isLast || isExpanded || effectiveStatus === "failed");
            if (!isExpanded && !showTicks) return null;
            return (
              <span className="mr-1 mt-1 flex items-center gap-1 text-[10px] text-muted-foreground font-medium animate-in fade-in slide-in-from-top-1 duration-150">
                {isExpanded && (
                  <span>
                    {m.author} · {m.time}
                  </span>
                )}
                {showTicks && (
                  <MessageStatusTicks status={effectiveStatus} error={effectiveError} />
                )}
              </span>
            );
          })()}
        </motion.div>
      </div>
    );
  }

  // ── 4. Mensagens Recebidas (Cliente / Valentina IA) ──
  return (
    <div key={m.clientMessageId || m.id} className="w-full">
      {dateLabel && (
        <div className="flex justify-center my-3 select-none">
          <span className="rounded-full bg-muted/80 dark:bg-muted/50 px-4 py-1 text-[11px] font-bold text-muted-foreground/90 border border-border/60 shadow-2xs">
            {dateLabel}
          </span>
        </div>
      )}
      <ConnectionBannerPill
        banner={connectionBanner}
        onOpenSourceConversation={onOpenSourceConversation}
      />
      <motion.div
        id={`msg-dom-${m.id}`}
        initial={{ opacity: 0, x: -18, scale: 0.98 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
        className={`flex items-end gap-2 group relative w-full ${gap}`}
      >
        {/* Avatar — só na última mensagem do grupo */}
        {isLast ? (
          activeChat.id === "valentina" ? (
            <AiAvatar
              tenantId={tenant}
              className="h-7 w-7 shrink-0 rounded-full border border-border self-end cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => onMediaClick && onMediaClick("image", aiPersona.avatarUrl)}
            />
          ) : activeChat.avatar ? (
            <img
              src={activeChat.avatar}
              alt=""
              className="h-7 w-7 shrink-0 rounded-full object-cover border border-border self-end cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => onMediaClick && onMediaClick("image", activeChat.avatar!)}
            />
          ) : (
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold text-primary bg-primary/10 border border-primary/20 self-end">
              {activeChat.initials || "U"}
            </div>
          )
        ) : (
          <div className="w-7 shrink-0" />
        )}

        <div className="min-w-0 max-w-[80%] flex-1">
          <div className="flex items-center gap-2 relative min-w-0 max-w-full">
            {isSticker ? (
              <div className="leading-relaxed">
                {displayQuotedContent && (
                  <QuotedMessagePreview
                    sender={displayQuotedSender}
                    content={displayQuotedContent}
                    variant="card"
                    className="mb-1"
                    onClick={(e) => quotedTargetId && onScrollToQuoted(e, quotedTargetId)}
                  />
                )}
                {renderMessageContent(
                  safeText,
                  onMediaClick,
                  false,
                  onSaveSticker,
                  m.author,
                  activeChat.name,
                )}
              </div>
            ) : isAudioOrDoc && !m.isWarning ? (
              <div className="flex flex-col items-start gap-1.5 min-w-0 max-w-full">
                {displayQuotedContent && (
                  <QuotedMessagePreview
                    sender={displayQuotedSender}
                    content={displayQuotedContent}
                    variant="card"
                    className="mb-0.5"
                    onClick={(e) => quotedTargetId && onScrollToQuoted(e, quotedTargetId)}
                  />
                )}
                {renderMessageContent(
                  safeText,
                  onMediaClick,
                  false,
                  undefined,
                  m.author,
                  activeChat.name,
                )}
              </div>
            ) : isMedia && !hasCaption && !displayQuotedContent && !m.isWarning ? (
              <div className="min-w-0 max-w-full">
                {renderMessageContent(
                  safeText,
                  onMediaClick,
                  false,
                  undefined,
                  m.author,
                  activeChat.name,
                )}
              </div>
            ) : isEmojiOnly(safeText) && !displayQuotedContent && !m.isWarning ? (
              <div className="text-4xl leading-none select-none py-1">{safeText}</div>
            ) : m.vtexProductPreview && !isMedia && !m.isWarning && isBoilerplateVtexIntroText(safeText) ? (
              <div className="min-w-0 max-w-full flex flex-col items-start gap-1.5">
                {activeChat.id === "valentina" && m.thoughtTrace && (
                  <AgenticThoughtTrace
                    trace={m.thoughtTrace}
                    mode="completed"
                  />
                )}
                <VtexProductPreviewCard
                  preview={m.vtexProductPreview}
                  previews={m.vtexProductPreviews}
                  onMediaClick={onMediaClick}
                  standalone
                />
              </div>
            ) : (
              <div
                onClick={(e) => onBubbleClick(e, m.id)}
                className={`${inR} min-w-0 max-w-full overflow-hidden break-words ${
                  m.isWarning
                    ? `bg-card border-border border-l-4 ${
                        m.warningType === "delay"
                          ? "border-l-amber-500"
                          : m.warningType === "overload"
                          ? "border-l-violet-500"
                          : "border-l-primary"
                      } text-foreground text-[11px]`
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
                  <div
                    className={`flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider mb-1.5 select-none ${
                      m.warningType === "delay"
                        ? "text-amber-600 dark:text-amber-400"
                        : m.warningType === "overload"
                        ? "text-violet-600 dark:text-violet-400"
                        : "text-primary"
                    }`}
                  >
                    {m.warningType === "delay" ? (
                      <Clock className="h-3 w-3 shrink-0" />
                    ) : m.warningType === "new_lead" ? (
                      <UserCheck className="h-3 w-3 shrink-0" />
                    ) : m.warningType === "overload" ? (
                      <Users className="h-3 w-3 shrink-0" />
                    ) : (
                      <AlertCircle className="h-3 w-3 shrink-0" />
                    )}
                    <span>
                      {m.warningType === "delay"
                        ? `Alerta de SLA · ${aiPersona.name}`
                        : m.warningType === "new_lead"
                        ? `Novo Lead · ${aiPersona.name}`
                        : m.warningType === "overload"
                        ? `Atendimentos Ativos · ${aiPersona.name}`
                        : `Aviso de ${aiPersona.name}`}
                    </span>
                  </div>
                )}
                {activeChat.id === "valentina" && m.thoughtTrace && (
                  <AgenticThoughtTrace
                    trace={m.thoughtTrace}
                    mode="completed"
                  />
                )}
                {displayQuotedContent && (
                  <QuotedMessagePreview
                    sender={displayQuotedSender}
                    content={displayQuotedContent}
                    variant="incoming"
                    className="mb-1.5"
                    onClick={(e) => quotedTargetId && onScrollToQuoted(e, quotedTargetId)}
                  />
                )}
                {renderMessageContent(
                  m.isWarning || (m as any).sender === "valentina" || activeChat.id === "valentina"
                    ? stripNotificationEmojis(safeText)
                    : safeText,
                  onMediaClick,
                  false,
                  undefined,
                  m.author,
                  activeChat.name,
                )}

                {/* Card interativo: Atraso de Resposta */}
                {m.isWarning && m.warningType === "delay" && m.warningMetadata && (
                  <div
                    className="mt-2.5 p-3 rounded-xl bg-card border border-border/80 shadow-sm flex flex-col gap-2 cursor-default text-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="text-[11px] font-bold text-foreground">
                      Cliente:{" "}
                      <span className="text-primary font-black">
                        {m.warningMetadata.clientName}
                      </span>
                    </div>
                    {m.warningMetadata.lastMessage && (
                      <div className="p-2 rounded-lg bg-muted/65 text-[10px] text-muted-foreground border-l-2 border-primary italic">
                        "{m.warningMetadata.lastMessage}"
                      </div>
                    )}
                    {onOpenWarningChat &&
                      (m.warningMetadata.clientId || m.warningMetadata.clientName) && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenWarningChat(
                              m.warningMetadata!.clientId,
                              m.warningMetadata!.clientName,
                            )
                          }
                          className="mt-1 flex items-center justify-center gap-1.5 w-full py-1.5 px-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold shadow-soft transition cursor-pointer border-none"
                        >
                          <span>Abrir Conversa</span>
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
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
                        Cliente:{" "}
                        <span className="text-primary font-black">
                          {m.warningMetadata.clientName}
                        </span>
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
                          Resumo / Interesse:
                        </span>
                        <span>{m.warningMetadata.interest}</span>
                      </div>
                    )}
                    <div className="text-[10px] text-foreground flex items-center justify-between gap-2 bg-primary/8 border border-primary/20 px-2.5 py-1.5 rounded-lg">
                      <span className="font-bold">
                        Tarefa na Negociação:{" "}
                        <span className="text-primary">
                          {m.warningMetadata.taskTitle || "Responder o contato"}
                        </span>
                      </span>
                      <span className="text-[8.5px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        Pendente
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      {onOpenWarningChat &&
                        (m.warningMetadata.clientId || m.warningMetadata.clientName) && (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenWarningChat(
                                m.warningMetadata!.clientId,
                                m.warningMetadata!.clientName,
                              )
                            }
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold shadow-soft transition cursor-pointer border-none"
                          >
                            <span>Abrir Atendimento</span>
                            <ArrowRight className="h-3 w-3" />
                          </button>
                        )}
                      {m.warningMetadata.dealId && (
                        <button
                          type="button"
                          onClick={() =>
                            navigate({
                              to: "/crm/deals/$dealId",
                              params: { dealId: m.warningMetadata!.dealId! },
                              search: { from: "crm" },
                            })
                          }
                          className="flex items-center justify-center gap-1 py-1.5 px-2.5 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-[10px] font-bold border border-border/80 transition cursor-pointer"
                        >
                          <Briefcase className="h-3 w-3 text-primary" />
                          <span>Ver Negociação</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Cards interativos unificados e sem duplicidade (CRM / VigosPhone / Conversas) */}
                {(() => {
                  const dealsList = m.relatedDeals || [];
                  const dealIdsSet = new Set(dealsList.map((d) => d.dealId).filter(Boolean));
                  const dealConvIdsSet = new Set(
                    dealsList.map((d) => d.conversationId).filter(Boolean) as string[]
                  );
                  const dealPhonesSet = new Set(
                    dealsList
                      .map((d) => (d.contactPhone || "").replace(/\D/g, "").slice(-8))
                      .filter((p) => p.length >= 8)
                  );
                  const dealNamesSet = new Set(
                    dealsList
                      .flatMap((d) => [d.accountName, d.company, d.contactName])
                      .map((n) => (n || "").trim().toLowerCase())
                      .filter((n) => n.length >= 3)
                  );

                  // Filtra ligações que JÁ possuem card em Negociações do CRM (pois o card do CRM já tem o botão VigosPhone!)
                  const dedupedCalls = (m.relatedCalls || []).filter((c) => {
                    if (c.dealId && dealIdsSet.has(c.dealId)) return false;
                    if (c.conversationId && dealConvIdsSet.has(c.conversationId)) return false;
                    const phoneKey = (c.phone || "").replace(/\D/g, "").slice(-8);
                    if (phoneKey.length >= 8 && dealPhonesSet.has(phoneKey)) return false;
                    const nameKey = (c.clientName || "").trim().toLowerCase();
                    if (nameKey.length >= 3 && dealNamesSet.has(nameKey)) return false;
                    return true;
                  });

                  const callConvIdsSet = new Set(
                    dedupedCalls.map((c) => c.conversationId).filter(Boolean) as string[]
                  );
                  const callPhonesSet = new Set(
                    dedupedCalls
                      .map((c) => (c.phone || "").replace(/\D/g, "").slice(-8))
                      .filter((p) => p.length >= 8)
                  );
                  const callNamesSet = new Set(
                    dedupedCalls
                      .map((c) => (c.clientName || "").trim().toLowerCase())
                      .filter((n) => n.length >= 3)
                  );

                  const rawConvList =
                    m.warningType === "overload" && m.warningMetadata?.conversations?.length
                      ? m.warningMetadata.conversations
                      : m.relatedConversations?.length
                        ? m.relatedConversations
                        : null;

                  // Se não for card de sobrecarga, remove conversas cujo contato JÁ está em Negociações do CRM ou Discagem Direta
                  const dedupedConvs =
                    rawConvList && m.warningType !== "overload"
                      ? rawConvList.filter((conv) => {
                          if (
                            conv.clientId &&
                            (dealConvIdsSet.has(conv.clientId) || callConvIdsSet.has(conv.clientId))
                          ) {
                            return false;
                          }
                          const phoneKey = (conv.clientPhone || "").replace(/\D/g, "").slice(-8);
                          if (
                            phoneKey.length >= 8 &&
                            (dealPhonesSet.has(phoneKey) || callPhonesSet.has(phoneKey))
                          ) {
                            return false;
                          }
                          const nameKey = (conv.clientName || "").trim().toLowerCase();
                          if (
                            nameKey.length >= 3 &&
                            (dealNamesSet.has(nameKey) || callNamesSet.has(nameKey))
                          ) {
                            return false;
                          }
                          return true;
                        })
                      : rawConvList;

                  return (
                    <>
                      {/* 1. Balão/Card interativo: Ligação Direta via VigosPhone (apenas para contatos fora dos cards de CRM) */}
                      {dedupedCalls.length > 0 && (
                        <div
                          className="mt-2.5 p-2.5 rounded-xl bg-emerald-500/10 dark:bg-emerald-950/35 border border-emerald-500/35 shadow-sm flex flex-col gap-2 cursor-default text-xs min-w-0 max-w-full overflow-hidden"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center justify-between gap-2 min-w-0">
                            <span className="flex items-center gap-1 min-w-0 truncate">
                              <PhoneCall className="h-3 w-3 shrink-0" />
                              <span className="truncate">
                                {dedupedCalls.length === 1
                                  ? "Discagem Direta • VigosPhone"
                                  : `Discagem Direta • VigosPhone (${dedupedCalls.length})`}
                              </span>
                            </span>
                            <span className="text-[9px] font-semibold shrink-0">Clique para ligar</span>
                          </div>
                          <div className="flex flex-col gap-1.5 min-w-0 max-w-full overflow-x-hidden">
                            {dedupedCalls.map((callItem) => (
                              <a
                                key={callItem.id || callItem.phone}
                                href={getVigosPhoneLink(callItem.phone)}
                                className="group/call p-2 rounded-lg bg-card/95 hover:bg-emerald-500/15 border border-emerald-500/30 hover:border-emerald-500/60 flex items-center justify-between gap-2.5 min-w-0 max-w-full overflow-hidden transition cursor-pointer no-underline"
                              >
                                <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                                  <div className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 group-hover/call:bg-emerald-500 group-hover/call:text-white transition">
                                    <PhoneCall className="h-3.5 w-3.5" />
                                  </div>
                                  <div className="min-w-0 flex-1 flex flex-col gap-0.5 overflow-hidden">
                                    <div className="flex items-center gap-1.5 min-w-0 max-w-full overflow-hidden">
                                      <span className="text-[11px] font-bold text-foreground min-w-0 flex-1 truncate">
                                        {callItem.clientName}
                                      </span>
                                      {callItem.company &&
                                        callItem.company !== callItem.clientName && (
                                          <span className="text-[9px] text-muted-foreground shrink-0 max-w-[40%] truncate">
                                            • {callItem.company}
                                          </span>
                                        )}
                                    </div>
                                    <div className="text-[10.5px] font-mono font-bold text-emerald-600 dark:text-emerald-400 truncate">
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

                      {/* 2. Card interativo unificado: Negociações do CRM (com VigosPhone + Chat + Abrir CRM em 1 único card!) */}
                      {dealsList.length > 0 && (
                        <div
                          className="mt-2.5 p-2.5 rounded-xl bg-card/95 border border-border/80 shadow-sm flex flex-col gap-2 cursor-default text-xs min-w-0 max-w-full overflow-hidden"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center justify-between gap-2 min-w-0">
                            <span className="flex items-center gap-1 min-w-0 truncate">
                              <Briefcase className="h-3 w-3 text-primary shrink-0" />
                              <span className="truncate">{`Negociações do CRM (${dealsList.length})`}</span>
                            </span>
                            <span className="text-[9px] font-semibold text-primary shrink-0">
                              {dealsList.length > 5 ? "Role ou filtre abaixo" : "Ações rápidas"}
                            </span>
                          </div>
                          {dealsList.length > 5 && (
                            <input
                              type="text"
                              value={dealSearchQuery}
                              onChange={(e) => setDealSearchQuery(e.target.value)}
                              placeholder="Filtrar por empresa, código, etapa ou valor..."
                              className="w-full min-w-0 px-2.5 py-1.5 rounded-lg bg-muted/50 border border-border/70 text-[11px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary/50"
                            />
                          )}
                          <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto overflow-x-hidden pr-0.5 min-w-0 max-w-full">
                            {dealsList
                              .filter((deal) => {
                                const q = dealSearchQuery.trim().toLowerCase();
                                if (!q) return true;
                                const hay = `${deal.title || ""} ${deal.company || ""} ${deal.accountName || ""} ${deal.stageLabel || ""} ${deal.pipelineName || ""} ${deal.stageName || ""} ${deal.contactName || ""} ${deal.valueFormatted || ""}`.toLowerCase();
                                return hay.includes(q);
                              })
                              .map((deal) => {
                              const formattedVal =
                                deal.valueFormatted ||
                                (deal.value != null && Number(deal.value) > 0
                                  ? Number(deal.value).toLocaleString("pt-BR", {
                                      style: "currency",
                                      currency: "BRL",
                                    })
                                  : null);
                              const stageText =
                                deal.stageLabel ||
                                [deal.pipelineName, deal.stageName].filter(Boolean).join(" › ") ||
                                null;
                              const companyText = deal.company || deal.accountName || null;

                              return (
                                <div
                                  key={deal.dealId}
                                  className="p-2 rounded-lg bg-muted/40 hover:bg-muted/70 border border-border/60 flex items-center justify-between gap-2.5 min-w-0 max-w-full overflow-hidden transition"
                                >
                                  <div className="min-w-0 flex-1 flex flex-col gap-0.5 overflow-hidden">
                                    <div className="flex items-center gap-1.5 min-w-0 max-w-full overflow-hidden">
                                      <span className="text-[11px] font-bold text-foreground min-w-0 flex-1 truncate">
                                        {deal.title}
                                      </span>
                                      {formattedVal && (
                                        <span className="shrink-0 px-1.5 py-0.2 rounded-full text-[8.5px] font-bold bg-primary/15 text-primary border border-primary/30">
                                          {formattedVal}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[9.5px] font-semibold text-muted-foreground truncate">
                                      {[
                                        stageText,
                                        companyText && companyText !== "Sem empresa"
                                          ? companyText
                                          : null,
                                        deal.contactName && deal.contactName !== companyText
                                          ? deal.contactName
                                          : null,
                                        deal.daysIdle && deal.daysIdle >= 3
                                          ? `Parada há ${deal.daysIdle}d`
                                          : null,
                                      ]
                                        .filter(Boolean)
                                        .join(" • ")}
                                    </div>
                                    {deal.contactPhone ? (
                                      <div className="text-[9.5px] font-mono font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 min-w-0 truncate">
                                        <PhoneCall className="h-2.5 w-2.5 shrink-0" />
                                        <span className="truncate">{formatDisplayPhone(deal.contactPhone)}</span>
                                      </div>
                                    ) : (
                                      <div className="text-[9px] text-muted-foreground/80 italic truncate">
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
                                      <SystemTooltip
                                        content={`Ligar para ${formatDisplayPhone(deal.contactPhone)} via VigosPhone`}
                                      >
                                        <a
                                          href={getVigosPhoneLink(deal.contactPhone)}
                                          className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500/15 hover:bg-emerald-600 text-emerald-600 dark:text-emerald-400 hover:text-white border border-emerald-500/30 transition cursor-pointer"
                                        >
                                          <PhoneCall className="h-3.5 w-3.5" />
                                        </a>
                                      </SystemTooltip>
                                    )}
                                    {deal.conversationId && onOpenWarningChat && (
                                      <SystemTooltip content="Abrir conversa no WhatsApp">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            onOpenWarningChat(
                                              deal.conversationId!,
                                              deal.contactName || deal.accountName || deal.title
                                            )
                                          }
                                          className="grid h-7 w-7 place-items-center rounded-lg bg-primary/12 hover:bg-primary text-primary hover:text-primary-foreground border border-primary/25 transition cursor-pointer"
                                        >
                                          <MessageSquare className="h-3.5 w-3.5" />
                                        </button>
                                      </SystemTooltip>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        navigate({
                                          to: "/crm/deals/$dealId",
                                          params: { dealId: deal.dealId },
                                          search: { from: "crm" },
                                        })
                                      }
                                      className="shrink-0 flex items-center gap-1 py-1.5 px-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold shadow-soft transition cursor-pointer border-none"
                                    >
                                      <span>Abrir CRM</span>
                                      <ArrowRight className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* 3. Card interativo: Lista de Conversas Citadas (apenas conversas que não estão nos cards acima) */}
                      {dedupedConvs && dedupedConvs.length > 0 && (
                        <div
                          className="mt-2.5 p-2.5 rounded-xl bg-card/95 border border-border/80 shadow-sm flex flex-col gap-2 cursor-default text-xs min-w-0 max-w-full overflow-hidden"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center justify-between gap-2 min-w-0">
                            <span className="truncate">
                              {m.warningType === "overload"
                                ? `Atendimentos Ativos (${dedupedConvs.length})`
                                : `Conversas Citadas (${dedupedConvs.length})`}
                            </span>
                            <span className="text-[9px] font-semibold text-primary shrink-0">
                              Clique para abrir
                            </span>
                          </div>
                          <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto overflow-x-hidden pr-0.5 min-w-0 max-w-full">
                            {dedupedConvs.map((conv) => (
                              <div
                                key={conv.clientId}
                                className="p-2 rounded-lg bg-muted/40 hover:bg-muted/70 border border-border/60 flex items-center justify-between gap-2.5 min-w-0 max-w-full overflow-hidden transition"
                              >
                                <div className="min-w-0 flex-1 flex flex-col gap-0.5 overflow-hidden">
                                  <div className="flex items-center gap-1.5 min-w-0 max-w-full overflow-hidden">
                                    <span className="text-[11px] font-bold text-foreground min-w-0 flex-1 truncate">
                                      {conv.clientName}
                                    </span>
                                    {conv.company && (
                                      <span className="text-[9px] text-muted-foreground shrink-0 max-w-[35%] truncate">
                                        • {conv.company}
                                      </span>
                                    )}
                                    {conv.isWaiting && (
                                      <span className="shrink-0 px-1.5 py-0.2 rounded-full text-[8px] font-bold bg-amber-500/15 text-amber-500 border border-amber-500/30">
                                        {conv.waitMinutes && conv.waitMinutes > 0
                                          ? `Aguardando há ${conv.waitMinutes}min`
                                          : "Aguardando resposta"}
                                      </span>
                                    )}
                                  </div>
                                  {(conv.dealTitle || conv.funnelName) && (
                                    <div className="text-[9px] font-semibold text-primary/90 truncate">
                                      {[conv.funnelName, conv.dealTitle].filter(Boolean).join(" • ")}
                                    </div>
                                  )}
                                  {conv.lastMessage && (
                                    <div className="text-[10px] text-muted-foreground truncate italic">
                                      "{conv.lastMessage}"
                                    </div>
                                  )}
                                </div>
                                {onOpenWarningChat && conv.clientId && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenWarningChat(conv.clientId)}
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
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            <SystemTooltip content="Responder">
              <button
                type="button"
                data-tour="message.reply" data-training-action="true"
                onClick={() => onSetReplyingTo(m)}
                onMouseLeave={(e) => e.currentTarget.blur()}
                className="opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-opacity duration-150 cursor-pointer shrink-0"
              >
                <CornerUpLeft className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
            <SystemTooltip content="Reagir">
              <button
                type="button"
                data-tour="message.react" data-training-action="true"
                onClick={() => onSetReactingMsgId(reactingMsgId === m.id ? null : m.id)}
                onMouseLeave={(e) => e.currentTarget.blur()}
                className={`opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-opacity duration-150 cursor-pointer shrink-0 ${
                  reactingMsgId === m.id ? "!opacity-100 !pointer-events-auto bg-muted text-foreground" : ""
                }`}
              >
                <Smile className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
            {activeChat.id === "valentina" ? (
              isLast && !m.isWarning && m.id !== "val_welcome" ? (
                <MessageKnowledgeSourceButton
                  message={
                    groupKnowledgeSources && groupKnowledgeSources.length > 0
                      ? { ...m, knowledgeSources: groupKnowledgeSources }
                      : m
                  }
                />
              ) : null
            ) : (
              <SystemTooltip content="Marcar como evidência do negócio">
                <button
                  type="button"
                  data-tour="message.evidence" data-training-action="true"
                onClick={() =>
                    onSetMarkingEvidenceMsg({
                      id: m.id,
                      text: m.text,
                      author: m.author,
                      time: m.time,
                    })
                  }
                  onMouseLeave={(e) => e.currentTarget.blur()}
                  className="opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-amber-500 transition-opacity duration-150 cursor-pointer shrink-0"
                >
                  <Bookmark className="h-3.5 w-3.5" />
                </button>
              </SystemTooltip>
            )}

            {reactingMsgId === m.id && (
              <MessageReactionPicker
                activeEmoji={m.reactions?.find((r) => r.from === "operator")?.emoji || null}
                side="in"
                onSelectEmoji={(emoji) => onToggleReaction(activeChat.id, m.id, emoji)}
                onClose={() => onSetReactingMsgId(null)}
              />
            )}
          </div>

          <MessageReactions
            reactions={m.reactions}
            side="in"
            onReactionClick={() => onToggleReaction(activeChat.id, m.id, "")}
          />

          {m.vtexProductPreview &&
            !(!isMedia && !m.isWarning && isBoilerplateVtexIntroText(safeText)) && (
              <div className="mt-3.5">
                <VtexProductPreviewCard
                  preview={m.vtexProductPreview}
                  previews={m.vtexProductPreviews}
                  onMediaClick={onMediaClick}
                  standalone
                />
              </div>
            )}

          {/* Sugestões dinâmicas por setor para mensagem de boas-vindas da IA */}
          {m.id === "val_welcome" && (
            <div data-tour="chat.assistant-suggestions" className="mt-2.5 flex flex-col gap-1.5 max-w-sm">
              {m.welcomeSectorName && (
                <div className="mb-0.5 flex items-center gap-1.5 px-1">
                  <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 border border-primary/20 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-primary">
                    Setor: {m.welcomeSectorName}
                  </span>
                </div>
              )}
              {(Array.isArray(m.welcomeSuggestions) && m.welcomeSuggestions.length > 0
                ? m.welcomeSuggestions
                : [
                    "Como está minha meta do mês e meu ritmo hoje?",
                    "Quais são minhas tarefas e ligações agendadas para hoje?",
                    "Quais negociações minhas estão paradas ou esfriando?",
                    "Quais clientes estão aguardando minha resposta agora?",
                  ]
              ).map((q, idx) => (
                <button
                  key={`${q}-${idx}`}
                  type="button"
                  onClick={() => onSendWelcomeSuggestion && onSendWelcomeSuggestion(q)}
                  className="text-left text-[11px] font-semibold text-primary hover:text-primary-foreground bg-primary/5 hover:bg-primary border border-primary/20 hover:border-primary px-3 py-2 rounded-xl transition duration-150 shadow-soft cursor-pointer flex items-center justify-between group/btn w-full"
                >
                  <span>{q}</span>
                  <ArrowRight className="h-3 w-3 opacity-60 group-hover/btn:translate-x-0.5 group-hover/btn:opacity-100 transition-all shrink-0 ml-2" />
                </button>
              ))}
            </div>
          )}

          {isExpanded && (
            <span className="ml-1 mt-1 block text-[10px] text-muted-foreground font-medium animate-in fade-in slide-in-from-top-1 duration-150">
              {m.author} · {m.time}
            </span>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Componente Memoizado de Alta Performance:
 * Garante que a digitação na caixa de texto, atualizações de áudio ou re-renders
 * do painel principal NÃO provoquem re-renders em cascata dos balões do histórico.
 */
export const ChatMessageBubble = memo(
  ChatMessageBubbleComponent,
  (prev, next) => {
    // Retorna true se as props forem equivalentes (PULA O RENDER)
    if (prev.m !== next.m) return false;
    if (prev.isExpanded !== next.isExpanded) return false;
    if (prev.isMatch !== next.isMatch) return false;
    if (prev.isFirst !== next.isFirst || prev.isLast !== next.isLast) return false;
    if (prev.prevLinked !== next.prevLinked || prev.nextLinked !== next.nextLinked) return false;
    if (prev.gap !== next.gap || prev.dateLabel !== next.dateLabel) return false;
    if ((prev.systemGroup?.length ?? 0) !== (next.systemGroup?.length ?? 0)) return false;
    if ((prev.groupKnowledgeSources?.length ?? 0) !== (next.groupKnowledgeSources?.length ?? 0)) return false;
    if (
      prev.connectionBanner?.label !== next.connectionBanner?.label ||
      prev.connectionBanner?.foreignConversationId !== next.connectionBanner?.foreignConversationId
    ) {
      return false;
    }
    if (prev.effectiveStatus !== next.effectiveStatus || prev.effectiveError !== next.effectiveError) return false;
    if (
      prev.reactingMsgId !== next.reactingMsgId &&
      (prev.reactingMsgId === prev.m.id || next.reactingMsgId === next.m.id)
    ) {
      return false;
    }
    if (prev.displayQuotedContent !== next.displayQuotedContent) return false;
    if (prev.activeChat.id !== next.activeChat.id) return false;

    return true; // Pula re-renderização com segurança!
  }
);
