import React, { useState, useEffect } from "react";
import { User, CheckCheck, ExternalLink, ShoppingBag, MessageCircle, Mail, Phone, FileText, X } from "lucide-react";
import { AVATAR_URL, BACKEND_URL } from "../../config";

export interface Message {
  id: string;
  content: string;
  sender: "visitor" | "ai" | "agent" | "system";
  timestamp: string;
}

interface ChatBubbleProps {
  message: Message;
  onSelectOption?: (option: string) => void;
}

function extractAttachments(text: string): { cleanText: string; attachments: string[] } {
  const attachments: string[] = [];
  const regex = /\[Anexo_Cliente:\s*([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      attachments.push(match[1].trim());
    }
  }
  const cleanText = text.replace(regex, "").trim();
  return { cleanText, attachments };
}

function extractProductUrl(text: string): { cleanText: string; productUrl: string | null; productName: string | null } {
  const mdRegex = /\[([^\]]+)\]\((https?:\/\/(?:www\.)?tecfag\.com\.br\/[^\s)]+)\)/i;
  const mdMatch = text.match(mdRegex);
  if (mdMatch) {
    const cleanText = text.replace(mdMatch[0], "").replace(/:\s*$/, "").trim();
    return { cleanText, productUrl: mdMatch[2], productName: mdMatch[1] };
  }

  const rawRegex = /(https?:\/\/(?:www\.)?tecfag\.com\.br\/[^\s),]+)/i;
  const rawMatch = text.match(rawRegex);
  if (rawMatch) {
    const url = rawMatch[1];
    const cleanText = text.replace(url, "").replace(/:\s*$/, "").trim();
    const slug = url.split("/").filter(Boolean).pop()?.replace(/\/p$/, "") || "";
    const name = slug
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
    return { cleanText, productUrl: url, productName: name || "Ver Produto" };
  }

  return { cleanText: text, productUrl: null, productName: null };
}

function ProductCard({ url, name }: { url: string; name: string }) {
  const [meta, setMeta] = useState<{ title: string | null; image: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setImgError(false);
    fetch(`${BACKEND_URL}/api/proxy-meta?url=${encodeURIComponent(url)}`)
      .then((res) => res.json())
      .then((data) => {
        if (isMounted) {
          if (data && (data.title || data.image)) {
            setMeta(data);
          }
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [url]);

  const displayTitle = meta?.title ? meta.title.split("|")[0].split("-")[0].trim() : name;

  const displayImage = meta?.image
    ? meta.image.startsWith("/")
      ? `${BACKEND_URL}${meta.image}`
      : meta.image
    : null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2.5 flex flex-col rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white hover:border-[#E50914]/50 hover:shadow-md transition-all duration-200 overflow-hidden group no-underline"
    >
      {loading && (
        <div className="w-full h-32 bg-slate-100 animate-pulse flex items-center justify-center">
          <ShoppingBag className="w-6 h-6 text-slate-300 animate-bounce" />
        </div>
      )}

      {!loading && displayImage && !imgError && (
        <div className="w-full h-36 bg-white border-b border-slate-100 p-2 flex items-center justify-center overflow-hidden relative">
          <img
            src={displayImage}
            alt={displayTitle}
            className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300"
            onError={() => setImgError(true)}
          />
        </div>
      )}

      <div className="flex items-center gap-3 p-3">
        {(!displayImage || imgError) && !loading && (
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-white shadow-sm"
            style={{ background: "linear-gradient(135deg, #E50914 0%, #b8070f 100%)" }}
          >
            <ShoppingBag className="w-5 h-5" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#E50914] mb-0.5">
            Equipamento Tecfag
          </p>
          <p className="text-xs font-bold text-slate-800 line-clamp-2 group-hover:text-[#E50914] transition-colors leading-snug">
            {displayTitle}
          </p>
        </div>

        <div
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-white flex-shrink-0 shadow-sm group-hover:shadow transition-all self-end mb-0.5"
          style={{ background: "linear-gradient(135deg, #E50914 0%, #b8070f 100%)" }}
        >
          <span>Ver Produto</span>
          <ExternalLink className="w-3 h-3" />
        </div>
      </div>
    </a>
  );
}

function extractWhatsAppUrl(text: string): { cleanText: string; waUrl: string | null } {
  const mdRegex = /\[([^\]]*)\]\((https?:\/\/wa\.me\/[^\s)]+)\)/i;
  const mdMatch = text.match(mdRegex);
  if (mdMatch) {
    const cleanText = text.replace(mdMatch[0], "").replace(/:\s*$/, "").trim();
    return { cleanText, waUrl: mdMatch[2] };
  }

  const rawRegex = /(https?:\/\/wa\.me\/[^\s),]+)/i;
  const rawMatch = text.match(rawRegex);
  if (rawMatch) {
    const cleanText = text.replace(rawMatch[1], "").replace(/:\s*$/, "").trim();
    return { cleanText, waUrl: rawMatch[1] };
  }

  return { cleanText: text, waUrl: null };
}

function WhatsAppCard({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2.5 flex items-center gap-3 p-3 rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white hover:border-emerald-400 hover:shadow-md transition-all duration-200 group no-underline"
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-white shadow-sm"
        style={{ background: "linear-gradient(135deg, #25D366 0%, #128C7E 100%)" }}
      >
        <MessageCircle className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 mb-0.5">
          Atendimento Direto
        </p>
        <p className="text-xs font-bold text-slate-800 truncate group-hover:text-emerald-700 transition-colors">
          Continuar no WhatsApp
        </p>
      </div>
      <div
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white flex-shrink-0 shadow-sm group-hover:shadow transition-all"
        style={{ background: "linear-gradient(135deg, #25D366 0%, #128C7E 100%)" }}
      >
        <span>Abrir WhatsApp</span>
        <ExternalLink className="w-3 h-3" />
      </div>
    </a>
  );
}

function extractEmail(text: string): { cleanText: string; email: string | null } {
  const emailRegex = /([a-zA-Z0-9._%+-]+@tecfag\.com\.br)/i;
  const match = text.match(emailRegex);
  if (match) {
    return { cleanText: text, email: match[1].toLowerCase() };
  }
  return { cleanText: text, email: null };
}

function EmailCard({ email }: { email: string }) {
  return (
    <a
      href={`mailto:${email}`}
      className="mt-2.5 flex items-center gap-3 p-3 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-white hover:border-blue-400 hover:shadow-md transition-all duration-200 group no-underline"
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-white shadow-sm"
        style={{ background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)" }}
      >
        <Mail className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-600 mb-0.5">
          E-mail Corporativo
        </p>
        <p className="text-xs font-bold text-slate-800 truncate group-hover:text-blue-700 transition-colors">
          {email}
        </p>
      </div>
      <div
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white flex-shrink-0 shadow-sm group-hover:shadow transition-all"
        style={{ background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)" }}
      >
        <span>Enviar E-mail</span>
        <ExternalLink className="w-3 h-3" />
      </div>
    </a>
  );
}

function extractPhone(text: string): { cleanText: string; phone: string | null; phoneClean: string | null } {
  const phoneRegex = /(\(?\d{2}\)?\s*\d{4,5}[-.\s]?\d{4})/;
  const match = text.match(phoneRegex);
  if (match) {
    const digits = match[1].replace(/\D/g, "");
    return { cleanText: text, phone: match[1].trim(), phoneClean: `55${digits}` };
  }
  return { cleanText: text, phone: null, phoneClean: null };
}

function PhoneCard({ phone, phoneClean }: { phone: string; phoneClean: string }) {
  return (
    <a
      href={`tel:+${phoneClean}`}
      className="mt-2.5 flex items-center gap-3 p-3 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-white hover:border-amber-400 hover:shadow-md transition-all duration-200 group no-underline"
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-white shadow-sm"
        style={{ background: "linear-gradient(135deg, #D97706 0%, #B45309 100%)" }}
      >
        <Phone className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 mb-0.5">
          Telefone Fixo
        </p>
        <p className="text-xs font-bold text-slate-800 truncate group-hover:text-amber-700 transition-colors">
          {phone}
        </p>
      </div>
      <div
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white flex-shrink-0 shadow-sm group-hover:shadow transition-all"
        style={{ background: "linear-gradient(135deg, #D97706 0%, #B45309 100%)" }}
      >
        <span>Ligar Agora</span>
        <Phone className="w-3 h-3" />
      </div>
    </a>
  );
}

function extractChoices(text: string): { cleanText: string; choices: string[] } {
  const choices: string[] = [];

  const btnRegex = /\[BUTTON:\s*([^\]]+)\]/gi;
  let btnMatch: RegExpExecArray | null;
  while ((btnMatch = btnRegex.exec(text)) !== null) {
    if (btnMatch[1]) {
      choices.push(btnMatch[1].trim());
    }
  }

  if (choices.length > 0) {
    const cleanText = text.replace(/\[BUTTON:\s*[^\]]+\]/gi, "").trim();
    return { cleanText, choices };
  }

  const lines = text.split("\n");
  const nonChoiceLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*(?:\d+[.)]\s*|[•\-]\s+)\*{0,2}(.+?)\*{0,2}\s*$/);
    if (match && match[1].length <= 60 && !match[1].includes("http")) {
      choices.push(match[1].replace(/\*\*/g, "").trim());
    } else {
      nonChoiceLines.push(line);
    }
  }

  if (choices.length >= 2) {
    return { cleanText: nonChoiceLines.join("\n").trim(), choices };
  }
  return { cleanText: text, choices: [] };
}

function ChoiceButtons({ choices, onSelect }: { choices: string[]; onSelect?: (opt: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleClick = (choice: string) => {
    if (selected) return;
    setSelected(choice);
    onSelect?.(choice);
  };

  return (
    <div className="mt-2.5 flex flex-col gap-1.5">
      {choices.map((choice, idx) => {
        const isSelected = selected === choice;
        const isDisabled = selected !== null && !isSelected;
        return (
          <button
            key={idx}
            onClick={() => handleClick(choice)}
            disabled={isDisabled}
            className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold border transition-all duration-200 flex items-center gap-2.5 ${
              isSelected
                ? "text-white border-[#E50914] shadow-md"
                : isDisabled
                  ? "bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed"
                  : "bg-white text-slate-700 border-slate-200 hover:border-[#E50914] hover:text-[#E50914] hover:bg-red-50/40 hover:shadow-sm active:scale-[0.98] cursor-pointer"
            }`}
            style={
              isSelected
                ? { background: "linear-gradient(135deg, #E50914 0%, #b8070f 100%)" }
                : undefined
            }
          >
            <span
              className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${
                isSelected ? "bg-white/20 text-white" : "bg-red-50 text-[#E50914] border border-red-200"
              }`}
            >
              {idx + 1}
            </span>
            <span className="flex-1">{choice}</span>
          </button>
        );
      })}
    </div>
  );
}

function renderFormattedText(text: string, isVisitor: boolean): React.ReactNode {
  const lines = text.split("\n");

  return lines.map((line, lineIdx) => {
    const tokenRegex = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|(https?:\/\/[^\s),]+))/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }

      if (match[2] && match[3]) {
        parts.push(
          <a
            key={`${lineIdx}-${match.index}`}
            href={match[3]}
            target="_blank"
            rel="noopener noreferrer"
            className={`underline font-semibold break-all ${
              isVisitor ? "text-red-100 hover:text-white" : "text-[#E50914] hover:text-red-700"
            }`}
          >
            {match[2]}
          </a>,
        );
      } else if (match[4]) {
        parts.push(
          <strong key={`${lineIdx}-${match.index}`} className="font-bold">
            {match[4]}
          </strong>,
        );
      } else if (match[5]) {
        parts.push(
          <em key={`${lineIdx}-${match.index}`} className="italic">
            {match[5]}
          </em>,
        );
      } else if (match[6]) {
        parts.push(
          <a
            key={`${lineIdx}-${match.index}`}
            href={match[6]}
            target="_blank"
            rel="noopener noreferrer"
            className={`underline font-semibold break-all ${
              isVisitor ? "text-red-100 hover:text-white" : "text-[#E50914] hover:text-red-700"
            }`}
          >
            {match[6]}
          </a>,
        );
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }

    return (
      <React.Fragment key={lineIdx}>
        {lineIdx > 0 && <br />}
        {parts.length > 0 ? parts : line}
      </React.Fragment>
    );
  });
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({ message, onSelectOption }) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const isVisitor = message.sender === "visitor";
  const isSystem = message.sender === "system";
  const isAI = message.sender === "ai";

  if (isSystem) {
    return (
      <div className="flex justify-center my-4 message-enter">
        <div className="bg-emerald-50/90 backdrop-blur-sm text-emerald-700 text-xs font-medium px-4 py-1.5 rounded-full border border-emerald-200/80 shadow-sm flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          {message.content}
        </div>
      </div>
    );
  }

  const timeString = new Date(message.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const { cleanText: textWithoutAttachments, attachments } = extractAttachments(message.content);

  const { cleanText: textAfterProduct, productUrl, productName } = !isVisitor
    ? extractProductUrl(textWithoutAttachments)
    : { cleanText: textWithoutAttachments, productUrl: null, productName: null };

  const { cleanText: textAfterWa, waUrl } = !isVisitor
    ? extractWhatsAppUrl(textAfterProduct)
    : { cleanText: textAfterProduct, waUrl: null };

  const { cleanText: textAfterEmail, email } = !isVisitor
    ? extractEmail(textAfterWa)
    : { cleanText: textAfterWa, email: null };

  const { cleanText: textAfterPhone, phone, phoneClean } = !isVisitor
    ? extractPhone(textAfterEmail)
    : { cleanText: textAfterEmail, phone: null, phoneClean: null };

  const { cleanText, choices } = !isVisitor
    ? extractChoices(textAfterPhone)
    : { cleanText: textAfterPhone, choices: [] };

  return (
    <div className={`flex w-full ${isVisitor ? "justify-end" : "justify-start"} mb-4 message-enter group`}>
      <div className={`flex max-w-[85%] ${isVisitor ? "flex-row-reverse" : "flex-row"} items-end gap-2.5`}>
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mb-1 shadow-md overflow-hidden transition-transform group-hover:scale-105 ${
            isVisitor
              ? "bg-neutral-800 text-white"
              : "border-2 border-[#E50914]"
          }`}
        >
          {isVisitor ? (
            <User className="w-4 h-4" />
          ) : (
            <img
              src={AVATAR_URL}
              alt={isAI ? "Fagner" : "Atendente"}
              className="w-full h-full object-cover"
            />
          )}
        </div>

        <div className="flex flex-col">
          {!isVisitor && (
            <span className="text-[11px] font-medium text-slate-400 ml-1 mb-1">
              {isAI ? "Fagner • Consultor Tecfag" : "Especialista Tecfag"}
            </span>
          )}

          <div
            className={`px-4 py-3 rounded-2xl text-[14px] leading-relaxed shadow-sm relative transition-all ${
              isVisitor
                ? "text-white rounded-br-sm shadow-red-500/10"
                : "bg-white text-slate-700 border border-slate-100 rounded-bl-sm shadow-slate-200/50"
            }`}
            style={
              isVisitor
                ? { background: "linear-gradient(135deg, #E50914 0%, #b8070f 100%)" }
                : undefined
            }
          >
            {cleanText && (
              <div className="whitespace-pre-wrap break-words">
                {renderFormattedText(cleanText, isVisitor)}
              </div>
            )}

            {attachments.length > 0 && (
              <div className={`flex flex-col gap-2 ${cleanText ? "mt-2.5" : ""}`}>
                {attachments.map((url, i) => {
                  const fullUrl = url.startsWith("http") ? url : `${BACKEND_URL}${url}`;
                  const isImage = /\.(jpeg|jpg|png|gif|webp)$/i.test(url);

                  if (isImage) {
                    return (
                      <div
                        key={i}
                        onClick={() => setSelectedImage(fullUrl)}
                        className="block overflow-hidden rounded-lg border border-white/20 shadow-sm transition-transform hover:scale-[1.02] cursor-pointer group"
                      >
                        <img
                          src={fullUrl}
                          alt="Anexo enviado"
                          className="max-w-full rounded-lg max-h-[220px] object-cover border border-black/10 transition-opacity group-hover:opacity-90"
                        />
                      </div>
                    );
                  } else {
                    return (
                      <a
                        key={i}
                        href={fullUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs font-semibold no-underline transition-all ${
                          isVisitor
                            ? "bg-black/20 border-white/20 text-white hover:bg-black/30"
                            : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        <FileText className="w-5 h-5 flex-shrink-0" />
                        <span className="truncate flex-1">Ver Documento Anexo</span>
                        <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                      </a>
                    );
                  }
                })}
              </div>
            )}

            {productUrl && productName && <ProductCard url={productUrl} name={productName} />}

            {waUrl && <WhatsAppCard url={waUrl} />}

            {email && <EmailCard email={email} />}

            {phone && phoneClean && <PhoneCard phone={phone} phoneClean={phoneClean} />}

            {choices.length >= 2 && <ChoiceButtons choices={choices} onSelect={onSelectOption} />}

            <div className={`flex items-center justify-end gap-1 mt-1.5 ${isVisitor ? "text-red-100" : "text-slate-400"}`}>
              <span className="text-[10px] font-medium leading-none">{timeString}</span>
              {isVisitor && <CheckCheck className="w-3 h-3 opacity-80" />}
            </div>
          </div>
        </div>
      </div>

      {selectedImage && (
        <div
          className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex items-center justify-center">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedImage(null);
              }}
              className="absolute -top-12 right-0 sm:-right-12 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-md transition-all active:scale-95"
              title="Fechar imagem"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={selectedImage}
              alt="Visualização ampliada"
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl border border-white/10"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
};
