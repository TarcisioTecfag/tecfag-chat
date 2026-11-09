import React, { useState } from "react";
import { Minus, X } from "lucide-react";
import { AVATAR_URL } from "../../config";

const WhatsAppIcon = ({ size = 14 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  </svg>
);

const CopyIcon = ({ size = 12 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = ({ size = 12 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export interface ChatHeaderProps {
  onMinimize?: () => void;
  onClose: () => void;
  onRestart?: () => void;
  messages?: { sender: string; content: string }[];
  isBlackNovember?: boolean;
  avatarSrc?: string;
  operatorName?: string | null;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  onMinimize,
  onClose,
  onRestart,
  messages = [],
  isBlackNovember = false,
  avatarSrc,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (messages.length === 0) return;
    const text = messages
      .map((m) => `${m.sender === "visitor" ? "Você" : "Fagner"}: ${m.content}`)
      .join("\n");

    const doCopy = (t: string) => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return t;
    };

    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(text)
        .then(() => doCopy(text))
        .catch(() => {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          doCopy(text);
        });
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      doCopy(text);
    }
  };

  return (
    <div
      className="relative px-5 py-4 flex items-center gap-3 rounded-t-2xl"
      style={{
        background: isBlackNovember
          ? "linear-gradient(135deg, #09090b 0%, #18181b 55%, #3f3f46 100%)"
          : "linear-gradient(135deg, #1a0000 0%, #2d0000 60%, #450a0a 100%)",
      }}
    >
      {/* Avatar */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <img
          src={avatarSrc || AVATAR_URL}
          alt="Fagner"
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            objectFit: "cover",
            objectPosition: "top",
            boxShadow: isBlackNovember ? "0 0 0 2px rgba(255,255,255,0.45)" : "0 0 0 2px #b91c1c",
          }}
        />
        <span
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: 12,
            height: 12,
            background: "#4ade80",
            borderRadius: "50%",
            boxShadow: isBlackNovember ? "0 0 0 2px #09090b" : "0 0 0 2px #1a0000",
            display: "block",
          }}
        />
      </div>

      {/* Info */}
      <div style={{ flex: "1 1 0%", minWidth: 0 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "white", margin: 0, lineHeight: "1.25" }}>
          Fagner
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", margin: 0 }}>Comercial</p>

          {/* Separador */}
          <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 12 }}>·</span>

          {/* WhatsApp */}
          <a
            href="https://solucoes.tecfag.com.br/fagner"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              color: "rgba(255,255,255,0.5)",
              transition: "color 0.2s",
            }}
            title="Continuar no WhatsApp"
            onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#4ade80")}
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLAnchorElement).style.color = "rgba(255,255,255,0.5)")
            }
          >
            <WhatsAppIcon size={15} />
          </a>

          {/* Copiar conversa */}
          <button
            onClick={handleCopy}
            title={copied ? "Copiado! ✓" : "Copiar conversa"}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px 4px",
              borderRadius: "4px",
              display: "flex",
              alignItems: "center",
              color: copied ? "#86efac" : "rgba(255,255,255,0.5)",
              transition: "color 0.2s",
            }}
            onMouseEnter={(e) => {
              if (!copied) (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.9)";
            }}
            onMouseLeave={(e) => {
              if (!copied) (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.5)";
            }}
          >
            {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
          </button>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <button
          onClick={onMinimize || onClose}
          style={{
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "rgba(255,255,255,0.5)",
            transition: "background 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.1)";
            (e.currentTarget as HTMLButtonElement).style.color = "white";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "none";
            (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.5)";
          }}
        >
          <Minus size={16} />
        </button>
        <button
          onClick={onRestart || onClose}
          style={{
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "rgba(255,255,255,0.5)",
            transition: "background 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.1)";
            (e.currentTarget as HTMLButtonElement).style.color = "white";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "none";
            (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.5)";
          }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default ChatHeader;
