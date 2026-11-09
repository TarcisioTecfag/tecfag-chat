import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { FileText, X, ExternalLink, Download, UserCheck, Code } from "lucide-react";
import { BACKEND_URL } from "../../config";

export interface Attachment {
  id: string;
  file: File;
  previewUrl: string | null;
  type: "image" | "file";
}

export interface Message {
  id: string;
  content: string;
  sender: "visitor" | "ai" | "agent" | "system";
  timestamp: string;
  deliveryState?: "pending" | "confirmed" | "failed";
  attachments?: Attachment[];
  agentAttachments?: { url: string; name: string; mimeType: string; size?: number }[];
  serverTs?: string;
  isSystem?: boolean;
  isAgentJoined?: boolean;
}

export interface ChatBubbleProps {
  message: string | Message;
  isAgent?: boolean;
  timestamp?: string;
  attachments?: Attachment[];
  agentAttachments?: { url: string; name: string; mimeType: string; size?: number }[];
  isSystem?: boolean;
  isAgentJoined?: boolean;
  onSelectRating?: (rating: number) => void;
  onRetry?: (id: string) => void;
  isBlackNovember?: boolean;
}

// ─── Helpers: detectar URLs de produtos e PDFs na mensagem ────────────────────

const TECFAG_URL_REGEX = /(https?:\/\/(?:www\.)?tecfag\.com\.br\/[^\s)]+)/gi;
const PDF_URL_REGEX = /(https?:\/\/[^\s)]+\.pdf(?:\?[^\s)]*)?)/gi;
const BACKEND_PDF_REGEX = /(\/uploads\/[^\s)]+\.pdf)/gi;
const WHATSAPP_URL_REGEX =
  /(https?:\/\/(?:solucoes\.tecfag\.com\.br\/fagner|wa\.me\/[^\s)]+|api\.whatsapp\.com\/[^\s)]+))/gi;
const CHECKOUT_URL_REGEX = /https?:\/\/(?:www\.)?tecfag\.com\.br\/checkout\/?\?[^\s]*/gi;

interface RichEmbed {
  type: "product" | "pdf" | "checkout" | "whatsapp";
  url: string;
  title?: string;
  image?: string;
}

// ─── Remove tags internas que NUNCA devem aparecer ao cliente ────────────────────
const INTERNAL_TAG_REGEX =
  /\[(?:PRODUTO_IDENTIFICADO|PRODUCT_IDENTIFIED|SCORE|OUTCOME|STAGE|VTEX_PEDIDO_INICIADO|VTEX_ORDER_DADOS|VTEX_CHECKOUT_REQUEST|VTEX_CUPOM|MAQUINAS_DADOS|POS_VENDA_DADOS|PECAS_DADOS|CNPJ_CHECK|CNPJ_RESULT|LOG_OCULTO|NPS_SURVEY)[^\]]*\]/gi;

function cleanInternalTags(text: string): string {
  return text
    .replace(INTERNAL_TAG_REGEX, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractInlineAttachments(text: string): {
  cleaned: string;
  inlineAttachments: { url: string; name: string; mimeType: string }[];
} {
  const inlineAttachments: { url: string; name: string; mimeType: string }[] = [];
  const rx = /\[(?:Anexo_Cliente|IMAGE):\s*([^\]]+)\]/gi;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(text)) !== null) {
    const rawUrl = (match[1] || "").trim();
    if (!rawUrl) continue;
    const lower = rawUrl.toLowerCase();
    const isPdf = lower.endsWith(".pdf");
    const mimeType = isPdf ? "application/pdf" : "image/jpeg";
    const name = decodeURIComponent(rawUrl.split("/").pop()?.split("?")[0] || (isPdf ? "Manual.pdf" : "Imagem"));
    inlineAttachments.push({ url: rawUrl, name, mimeType });
  }
  const cleaned = text.replace(rx, "").trim();
  return { cleaned, inlineAttachments };
}

function isPureCheckoutUrl(text: string): string | null {
  const trimmed = text.trim();
  const rx = /^https?:\/\/(?:www\.)?tecfag\.com\.br\/checkout\/?\?[^\s]*$/i;
  return rx.test(trimmed) ? trimmed : null;
}

function extractEmbeds(text: string): { cleanText: string; embeds: RichEmbed[] } {
  const embeds: RichEmbed[] = [];

  const BARE_BACKEND_REGEX =
    /(?<![:/])\b((?:fagnertecfag-production\.up\.railway\.app|tecfagchat\.up\.railway\.app)\/[^\s)]+)/gi;
  const normalizedText = text.replace(BARE_BACKEND_REGEX, "https://$1");
  let cleanText = normalizedText;

  // 0) Detecta links de WhatsApp
  const waMatches = Array.from(normalizedText.matchAll(new RegExp(WHATSAPP_URL_REGEX.source, "gi")));
  for (const m of waMatches) {
    const url = m[0];
    embeds.push({ type: "whatsapp", url: url.includes("wa.me") || url.includes("whatsapp.com") ? url : "https://solucoes.tecfag.com.br/fagner" });
    cleanText = cleanText.replace(url, "").trim();
  }

  // 0.1) Detecta links de checkout VTEX
  const checkoutRx = new RegExp(CHECKOUT_URL_REGEX.source, "gi");
  const checkoutMatches = Array.from(normalizedText.matchAll(checkoutRx));
  for (const m of checkoutMatches) {
    const url = m[0];
    embeds.push({ type: "checkout", url });
    cleanText = cleanText.replace(url, "").trim();
  }

  // 1) Detecta links de produtos Tecfag
  const productMatches = Array.from(cleanText.matchAll(new RegExp(TECFAG_URL_REGEX.source, "gi")));
  for (const m of productMatches) {
    const url = m[0];
    if (url.toLowerCase().endsWith(".pdf")) continue;
    if (url.includes("/checkout")) continue;
    if (url.includes("solucoes.tecfag.com.br")) continue;
    embeds.push({ type: "product", url });
    cleanText = cleanText.replace(url, "").trim();
  }

  // 2) Detecta PDFs (URLs completas com https://)
  const pdfMatches = Array.from(cleanText.matchAll(new RegExp(PDF_URL_REGEX.source, "gi")));
  for (const m of pdfMatches) {
    const url = m[0];
    const raw = decodeURIComponent(url.split("/").pop()?.split("?")[0] || "Manual.pdf");
    const filename =
      raw
        .replace(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-/i, "")
        .replace(/\.pdf$/i, "")
        .trim() + ".pdf";
    embeds.push({ type: "pdf", url, title: filename });
    cleanText = cleanText.replace(url, "").trim();
  }

  // 3) Detecta PDFs do backend local (/uploads/...)
  const backendPdfMatches = Array.from(cleanText.matchAll(new RegExp(BACKEND_PDF_REGEX.source, "gi")));
  for (const m of backendPdfMatches) {
    const path = m[0];
    const raw = decodeURIComponent(path.split("/").pop() || "Manual.pdf");
    const filename =
      raw
        .replace(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-/i, "")
        .replace(/\.pdf$/i, "")
        .trim() + ".pdf";
    embeds.push({ type: "pdf", url: path, title: filename });
    cleanText = cleanText.replace(path, "").trim();
  }

  cleanText = cleanText.replace(/\s{2,}/g, " ").trim();

  return { cleanText, embeds };
}

function renderMarkdownText(text: string, isAgent: boolean): { __html: string } {
  const color = isAgent ? "#ffffff" : "#1a1a1a";
  const html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*([^*\n]+)\*\*/g, `<strong style="color:${color}">$1</strong>`)
    .replace(/\*([^*\n]+)\*/g, `<strong style="color:${color}">$1</strong>`)
    .replace(/_([^_\n]+)_/g, `<em>$1</em>`)
    .replace(/\n/g, "<br/>");
  return { __html: html };
}

function CheckoutLinkBubble({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{ textDecoration: "none", display: "block" }}
    >
      <div
        style={{
          marginTop: 8,
          background: "rgba(255,255,255,0.18)",
          border: "1px solid rgba(255,255,255,0.35)",
          borderRadius: 14,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          transition: "background 0.15s",
        }}
      >
        <span style={{ fontSize: 20 }}>🛒</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#ffffff" }}>
            Finalizar Pagamento
          </p>
          <p style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,0.7)", marginTop: 2 }}>
            PIX · Boleto · Cartão — dados já preenchidos
          </p>
        </div>
        <ExternalLink size={16} style={{ color: "rgba(255,255,255,0.8)", flexShrink: 0 }} />
      </div>
    </a>
  );
}

function WhatsAppLinkBubble({ url }: { url: string }) {
  const targetUrl = url || "https://solucoes.tecfag.com.br/fagner";
  return (
    <a
      href={targetUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{ textDecoration: "none", display: "block" }}
    >
      <div
        style={{
          marginTop: 8,
          background: "linear-gradient(135deg, #15803d 0%, #166534 100%)",
          border: "1px solid rgba(255,255,255,0.35)",
          borderRadius: 14,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          cursor: "pointer",
          boxShadow: "0 4px 14px rgba(22, 101, 52, 0.4)",
          transition: "transform 0.15s, filter 0.15s",
        }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: "#22c55e",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width={20} height={20} viewBox="0 0 24 24" fill="white">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#ffffff" }}>
            Falar no WhatsApp
          </p>
          <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.9)", marginTop: 2 }}>
            Clique aqui para falar no Whats com a gente
          </p>
        </div>
        <ExternalLink size={16} style={{ color: "#ffffff", flexShrink: 0 }} />
      </div>
    </a>
  );
}

function ProductCard({ url }: { url: string }) {
  const [meta, setMeta] = useState<{ title: string; image: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const segments = url.split("/").filter(Boolean);
    let slug = segments.pop() || "";
    if (slug.toLowerCase() === "p" && segments.length > 0) {
      slug = segments.pop() || slug;
    }

    const fallbackTitle = slug
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\.html?$/, "");

    (async () => {
      try {
        const proxyUrl = `${BACKEND_URL}/api/proxy-meta?url=${encodeURIComponent(url)}`;
        const res = await fetch(proxyUrl);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setMeta({
              title: data.title || fallbackTitle,
              image: data.image || "",
            });
          }
        } else {
          if (!cancelled) setMeta({ title: fallbackTitle, image: "" });
        }
      } catch {
        if (!cancelled) setMeta({ title: fallbackTitle, image: "" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-3 animate-pulse">
        <div className="h-24 bg-white/10 rounded-lg mb-2" />
        <div className="h-3 bg-white/10 rounded w-3/4" />
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl overflow-hidden border border-white/15 bg-gradient-to-br from-white/10 to-white/5 hover:from-white/15 hover:to-white/10 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] no-underline group"
      style={{
        textDecoration: "none",
        display: "block",
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.15)",
        background: "rgba(255,255,255,0.08)",
      }}
    >
      {meta?.image && (
        <div className="w-full h-28 overflow-hidden bg-white" style={{ width: "100%", height: 112, overflow: "hidden", background: "#ffffff" }}>
          <img
            src={`${BACKEND_URL}/api/proxy-image?url=${encodeURIComponent(meta.image)}`}
            alt={meta?.title || "Produto"}
            className="w-full h-full object-contain bg-white p-1"
            style={{ width: "100%", height: "100%", objectFit: "contain", background: "#ffffff", padding: 4 }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}
      <div className="px-3 py-2.5 flex items-center gap-2" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
        <div className="flex-1 min-w-0" style={{ flex: 1, minWidth: 0 }}>
          <p className="text-xs font-bold truncate" style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#ffffff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {meta?.title || "Produto Tecfag"}
          </p>
          <p className="text-[10px] mt-0.5" style={{ margin: "2px 0 0", fontSize: 10, color: "rgba(255,255,255,0.6)" }}>
            tecfag.com.br
          </p>
        </div>
        <div
          className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 group-hover:bg-white/20 transition-colors"
          style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
        >
          <ExternalLink size={13} style={{ color: "rgba(255,255,255,0.85)" }} />
        </div>
      </div>
    </a>
  );
}

function PdfCard({ url, title }: { url: string; title: string }) {
  const displayName = title
    .replace(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-/i, "")
    .replace(/\.extracted\.txt$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  let finalUrl = url;
  if (url.startsWith("/")) {
    finalUrl = `${BACKEND_URL}${url}`;
  }

  return (
    <a
      href={finalUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-xl border border-white/15 bg-gradient-to-r from-red-600/20 to-red-500/10 px-3.5 py-3 hover:from-red-600/30 hover:to-red-500/20 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] no-underline group"
      style={{
        textDecoration: "none",
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.15)",
        background: "rgba(220, 38, 38, 0.2)",
        padding: "12px 14px",
      }}
    >
      <div
        className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center flex-shrink-0"
        style={{ width: 40, height: 40, borderRadius: 8, background: "rgba(239,68,68,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
      >
        <FileText size={20} className="text-red-300" style={{ color: "#fca5a5" }} />
      </div>
      <div className="flex-1 min-w-0" style={{ flex: 1, minWidth: 0 }}>
        <p className="text-xs font-bold truncate" style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#ffffff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {displayName}
        </p>
        <p className="text-[10px] mt-0.5 flex items-center gap-1" style={{ margin: "2px 0 0", fontSize: 10, display: "flex", alignItems: "center", gap: 4, color: "rgba(255,255,255,0.65)" }}>
          <Download size={9} /> Clique para baixar o PDF
        </p>
      </div>
    </a>
  );
}

const AUDIO_TAG_REGEX = /^\[AUDIO:(https?:\/\/[^\]]+)\]/i;

function AudioPlayerBubble({ url, isAgent }: { url: string; isAgent: boolean }) {
  const [errored, setErrored] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 220 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
          opacity: 0.75,
          color: isAgent ? "#ffe4e4" : "#555",
          fontWeight: 600,
        }}
      >
        🎙️ Mensagem de voz
      </div>

      {!errored ? (
        <audio
          controls
          src={url}
          onError={() => setErrored(true)}
          style={{
            width: "100%",
            minWidth: 210,
            maxWidth: 300,
            filter: isAgent ? "invert(1) brightness(0.85)" : "none",
            borderRadius: 8,
            outline: "none",
          }}
        >
          Seu browser não suporta áudio.
        </audio>
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 12px",
            borderRadius: 10,
            fontSize: 12,
            fontWeight: 600,
            textDecoration: "none",
            background: isAgent ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.06)",
            color: isAgent ? "#fff" : "#333",
          }}
        >
          🎤 Ouvir mensagem de voz
        </a>
      )}
    </div>
  );
}

function NpsStarSelector({ onSelectRating }: { onSelectRating?: (rating: number) => void }) {
  const [hoveredRating, setHoveredRating] = useState<number | null>(null);
  const [selectedRating, setSelectedRating] = useState<number | null>(null);

  const handleClick = (rating: number) => {
    if (selectedRating !== null) return;
    setSelectedRating(rating);
    if (onSelectRating) {
      onSelectRating(rating);
    }
  };

  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", padding: "6px 0" }}>
        {[1, 2, 3, 4, 5].map((star) => {
          const isHighlighted =
            (hoveredRating !== null ? star <= hoveredRating : false) ||
            (selectedRating !== null ? star <= selectedRating : false);
          return (
            <motion.button
              key={star}
              type="button"
              onClick={() => handleClick(star)}
              onMouseEnter={() => selectedRating === null && setHoveredRating(star)}
              onMouseLeave={() => selectedRating === null && setHoveredRating(null)}
              whileHover={selectedRating === null ? { scale: 1.25 } : {}}
              whileTap={selectedRating === null ? { scale: 0.9 } : {}}
              style={{
                background: "none",
                border: "none",
                cursor: selectedRating === null ? "pointer" : "default",
                padding: 0,
                outline: "none",
              }}
            >
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill={isHighlighted ? "#facc15" : "none"}
                stroke={isHighlighted ? "#eab308" : "rgba(255,255,255,0.4)"}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  filter: isHighlighted ? "drop-shadow(0 0 4px rgba(250,204,21,0.6))" : "none",
                  transition: "stroke 0.15s, fill 0.15s",
                }}
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </motion.button>
          );
        })}
      </div>
      {selectedRating !== null && (
        <p
          style={{
            margin: 0,
            fontSize: 11,
            textAlign: "center",
            color: "rgba(255,255,255,0.7)",
            fontWeight: 500,
          }}
        >
          Nota {selectedRating} enviada! Obrigado.
        </p>
      )}
    </div>
  );
}

export const ChatBubble: React.FC<ChatBubbleProps> = (props) => {
  const isMsgObj = typeof props.message === "object" && props.message !== null;
  const msgObj = isMsgObj ? (props.message as Message) : null;

  const rawText = isMsgObj ? msgObj!.content || "" : (props.message as string) || "";
  const isAgent = isMsgObj
    ? msgObj!.sender === "ai" || msgObj!.sender === "agent"
    : Boolean(props.isAgent);
  const isSystem = isMsgObj
    ? Boolean(msgObj!.isSystem || msgObj!.sender === "system")
    : Boolean(props.isSystem);
  const isAgentJoined = isMsgObj ? Boolean(msgObj!.isAgentJoined) : Boolean(props.isAgentJoined);
  const deliveryState = isMsgObj ? msgObj!.deliveryState : undefined;
  const msgId = isMsgObj ? msgObj!.id : "";

  const formatTs = (ts?: string) => {
    if (!ts) return "";
    if (/^\d{2}:\d{2}$/.test(ts)) return ts;
    try {
      const d = new Date(ts);
      if (!isNaN(d.getTime())) {
        return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      }
    } catch {}
    return ts;
  };

  const timestamp = formatTs(isMsgObj ? msgObj!.timestamp : props.timestamp);
  const attachments = isMsgObj ? msgObj!.attachments || props.attachments : props.attachments;
  const baseAgentAttachments = isMsgObj
    ? msgObj!.agentAttachments || props.agentAttachments
    : props.agentAttachments;
  const isBlackNovember = Boolean(props.isBlackNovember);
  const onSelectRating = props.onSelectRating;
  const onRetry = props.onRetry;

  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [isLogExpanded, setIsLogExpanded] = useState(false);
  const agentBubbleBg = isBlackNovember
    ? "linear-gradient(135deg, #18181b 0%, #27272a 100%)"
    : "#dc2626";

  // ─ PRIMEIRA VERIFICAÇÃO: áudio do operador [AUDIO:url] ───────────────────────────────
  const audioMatch = rawText.trim().match(AUDIO_TAG_REGEX);
  if (audioMatch) {
    const audioUrl = audioMatch[1];
    return (
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 26 }}
        style={{
          display: "flex",
          justifyContent: isAgent ? "flex-start" : "flex-end",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            maxWidth: "85%",
            borderRadius: isAgent ? "18px 18px 18px 4px" : "18px 18px 4px 18px",
            padding: "10px 14px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            background: isAgent ? agentBubbleBg : "#f1f0f0",
            color: isAgent ? "#ffffff" : "#1a1a1a",
          }}
        >
          <AudioPlayerBubble url={audioUrl} isAgent={isAgent} />
          <span
            style={{
              fontSize: 10,
              marginTop: 6,
              display: "block",
              opacity: isAgent ? 0.65 : 0.5,
              color: isAgent ? "#ffffff" : "#666",
            }}
          >
            {timestamp}
          </span>
        </div>
      </motion.div>
    );
  }

  // Banner compacto quando um agente humano assume o atendimento
  if (isAgentJoined) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 30 }}
        className="flex justify-center mb-3 px-2"
        style={{ display: "flex", justifyContent: "center", marginBottom: 12, padding: "0 8px" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            background: isBlackNovember
              ? "linear-gradient(135deg, rgba(9,9,11,0.08), rgba(39,39,42,0.06))"
              : "linear-gradient(135deg, rgba(127,29,29,0.10), rgba(220,38,38,0.08))",
            border: isBlackNovember
              ? "1px solid rgba(24,24,27,0.20)"
              : "1px solid rgba(185,28,28,0.20)",
            borderRadius: "20px",
            padding: "4px 12px 4px 8px",
            maxWidth: "85%",
          }}
        >
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: isBlackNovember ? "rgba(24,24,27,0.12)" : "rgba(185,28,28,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <UserCheck size={11} style={{ color: isBlackNovember ? "#18181b" : "#b91c1c" }} />
          </div>
          <span
            style={{
              fontSize: "11px",
              color: isBlackNovember ? "#18181b" : "#9f1239",
              fontWeight: 600,
              lineHeight: 1.3,
            }}
          >
            {rawText}
          </span>
        </div>
      </motion.div>
    );
  }

  // Mensagem discreta de sistema
  if (isSystem) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        className="flex justify-center mb-3"
        style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            background: "rgba(0,0,0,0.06)",
            borderRadius: "20px",
            padding: "3px 12px",
            fontSize: "11px",
            color: "#666",
            fontWeight: 500,
          }}
        >
          {rawText}
        </span>
      </motion.div>
    );
  }

  // Balão puro de URL de checkout
  if (isAgent) {
    const pureUrl = isPureCheckoutUrl(rawText);
    if (pureUrl) {
      return (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}
        >
          <div
            style={{
              maxWidth: "85%",
              borderRadius: "18px 18px 18px 4px",
              padding: "10px 14px 8px 14px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              background: agentBubbleBg,
            }}
          >
            <CheckoutLinkBubble url={pureUrl} />
            <span style={{ fontSize: 10, marginTop: 6, display: "block", opacity: 0.65, color: "#ffffff" }}>
              {timestamp}
            </span>
          </div>
        </motion.div>
      );
    }
  }

  const hasNpsSurvey = isAgent && rawText.includes("[NPS_SURVEY]");
  const { cleaned: withoutInlineAtt, inlineAttachments } = extractInlineAttachments(rawText);
  const agentAttachments = [
    ...(baseAgentAttachments || []),
    ...inlineAttachments,
  ];
  const cleanedMessage = isAgent ? cleanInternalTags(withoutInlineAtt) : withoutInlineAtt;
  const { cleanText, embeds } = isAgent
    ? extractEmbeds(cleanedMessage)
    : { cleanText: cleanedMessage, embeds: [] };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        style={{
          display: "flex",
          justifyContent: isAgent ? "flex-start" : "flex-end",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            maxWidth: "85%",
            borderRadius: isAgent ? "18px 18px 18px 4px" : "18px 18px 4px 18px",
            padding: "10px 14px 8px 14px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            background: isAgent ? agentBubbleBg : "#f1f0f0",
            color: isAgent ? "#ffffff" : "#1a1a1a",
          }}
        >
          {/* Attachments do VISITANTE (File objects) */}
          {attachments && attachments.length > 0 && (
            <div style={{ marginBottom: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              {attachments.map((att) =>
                att.type === "image" && att.previewUrl ? (
                  <img
                    key={att.id}
                    src={att.previewUrl}
                    alt={att.file.name}
                    style={{
                      borderRadius: 10,
                      maxHeight: 192,
                      width: "auto",
                      objectFit: "cover",
                      cursor: "pointer",
                    }}
                    onClick={() => setLightboxSrc(att.previewUrl)}
                  />
                ) : (
                  <div
                    key={att.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      borderRadius: 8,
                      fontSize: 12,
                      background: isAgent ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.05)",
                    }}
                  >
                    <FileText size={14} style={{ flexShrink: 0 }} />
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {att.file.name}
                    </span>
                    <span style={{ flexShrink: 0, opacity: 0.6 }}>
                      {(att.file.size / 1024).toFixed(0)}KB
                    </span>
                  </div>
                ),
              )}
            </div>
          )}

          {/* Attachments via URL (imagens, PDFs, docs, vídeos) */}
          {agentAttachments && agentAttachments.length > 0 && (
            <div style={{ marginBottom: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              {agentAttachments.map((att, idx) => {
                const fullUrl = att.url.startsWith("/") ? `${BACKEND_URL}${att.url}` : att.url;
                const isImage = att.mimeType.startsWith("image/");
                const isVideo = att.mimeType.startsWith("video/");
                const isPdf = att.mimeType === "application/pdf";
                const cleanName = att.name.replace(/^\d+-/, "").replace(/_/g, " ");

                if (isImage) {
                  return (
                    <img
                      key={idx}
                      src={fullUrl}
                      alt={cleanName}
                      style={{
                        borderRadius: 10,
                        maxHeight: 220,
                        width: "auto",
                        maxWidth: "100%",
                        objectFit: "cover",
                        cursor: "pointer",
                      }}
                      onClick={() => setLightboxSrc(fullUrl)}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.opacity = "0.4";
                      }}
                    />
                  );
                }

                if (isVideo) {
                  return (
                    <video
                      key={idx}
                      src={fullUrl}
                      controls
                      style={{ borderRadius: 10, maxHeight: 200, width: "100%" }}
                    />
                  );
                }

                const fileIcon = isPdf
                  ? "📅"
                  : att.mimeType.includes("sheet") || att.mimeType.includes("excel")
                    ? "📊"
                    : "📄";
                const sizeStr = att.size ? `${(att.size / 1024).toFixed(0)} KB` : "";

                return (
                  <a
                    key={idx}
                    href={fullUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 14px",
                      borderRadius: 12,
                      textDecoration: "none",
                      background: isAgent ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.06)",
                      border: isAgent ? "1px solid rgba(255,255,255,0.2)" : "1px solid rgba(0,0,0,0.1)",
                      transition: "background 0.15s",
                    }}
                  >
                    <span style={{ fontSize: 22, flexShrink: 0 }}>{fileIcon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12,
                          fontWeight: 700,
                          color: isAgent ? "#fff" : "#1a1a1a",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {cleanName}
                      </p>
                      {sizeStr && (
                        <p style={{ margin: 0, fontSize: 10, opacity: 0.65, color: isAgent ? "#fff" : "#555" }}>
                          {sizeStr} — clique para baixar
                        </p>
                      )}
                    </div>
                    <Download size={14} style={{ flexShrink: 0, opacity: 0.8, color: isAgent ? "#fff" : "#333" }} />
                  </a>
                );
              })}
            </div>
          )}

          {/* Text content */}
          {cleanText && !/^\[[A-Z0-9_]+(?:[:\]])/.test(cleanText.trim()) && (
            isAgent ? (
              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.55,
                  margin: 0,
                  wordBreak: "break-word",
                  color: "#ffffff",
                }}
                dangerouslySetInnerHTML={renderMarkdownText(cleanText, true)}
              />
            ) : (
              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.55,
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: "#1a1a1a",
                }}
              >
                {cleanText}
              </p>
            )
          )}

          {cleanText && /^\[[A-Z0-9_]+(?:[:\]])/s.test(cleanText.trim()) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 180, margin: "4px 0" }}>
              <button
                onClick={() => setIsLogExpanded(!isLogExpanded)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  opacity: 0.8,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "inherit",
                  padding: 0,
                }}
              >
                <Code size={14} />
                {isLogExpanded ? "Ocultar Log" : "Log Oculto (Sistema)"}
              </button>
              {isLogExpanded && (
                <div
                  style={{
                    marginTop: 8,
                    padding: 10,
                    borderRadius: 8,
                    fontSize: 11,
                    fontFamily: "monospace",
                    maxHeight: 256,
                    overflowY: "auto",
                    background: isAgent ? "rgba(0,0,0,0.1)" : "rgba(0,0,0,0.05)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {cleanText}
                </div>
              )}
            </div>
          )}

          {/* Rich Embeds */}
          {embeds.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {embeds.map((embed, i) =>
                embed.type === "whatsapp" ? (
                  <WhatsAppLinkBubble key={`whatsapp-${i}`} url={embed.url} />
                ) : embed.type === "checkout" ? (
                  <CheckoutLinkBubble key={`checkout-${i}`} url={embed.url} />
                ) : embed.type === "product" ? (
                  <ProductCard key={`product-${i}`} url={embed.url} />
                ) : (
                  <PdfCard key={`pdf-${i}`} url={embed.url} title={embed.title || "Manual.pdf"} />
                ),
              )}
            </div>
          )}

          {/* Timestamp & Delivery State */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
            <span
              style={{
                fontSize: 10,
                display: "block",
                opacity: isAgent ? 0.65 : 0.5,
                color: isAgent ? "#ffffff" : "#666",
              }}
            >
              {timestamp}
            </span>
            {!isAgent && deliveryState === "failed" && onRetry && msgId && (
              <button
                type="button"
                onClick={() => onRetry(msgId)}
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#dc2626",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  textDecoration: "underline",
                }}
              >
                Reenviar
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {/* Balão de NPS separado */}
      {hasNpsSurvey && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 25, delay: 0.25 }}
          style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}
        >
          <div
            style={{
              maxWidth: "85%",
              borderRadius: "18px 18px 18px 4px",
              padding: "12px 16px 10px 16px",
              boxShadow: isBlackNovember
                ? "0 2px 8px rgba(0,0,0,0.22)"
                : "0 2px 8px rgba(220,38,38,0.18)",
              background: agentBubbleBg,
            }}
          >
            <NpsStarSelector onSelectRating={onSelectRating} />
            <span style={{ fontSize: 10, marginTop: 4, display: "block", opacity: 0.65, color: "#ffffff" }}>
              {timestamp}
            </span>
          </div>
        </motion.div>
      )}

      {/* Lightbox */}
      {lightboxSrc && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10000] bg-foreground/80 flex items-center justify-center p-6"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(10,15,25,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
          onClick={() => setLightboxSrc(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-card/20 text-primary-foreground hover:bg-card/40 transition-colors"
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              padding: 8,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.2)",
              color: "white",
              border: "none",
              cursor: "pointer",
            }}
            onClick={() => setLightboxSrc(null)}
          >
            <X size={20} />
          </button>
          <img
            src={lightboxSrc}
            alt="Preview"
            className="max-w-full max-h-full rounded-xl shadow-2xl object-contain"
            style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 12, objectFit: "contain" }}
            onClick={(e) => e.stopPropagation()}
          />
        </motion.div>
      )}
    </>
  );
};

export default ChatBubble;
