import React from "react";

/**
 * Remove emojis de status/alerta (ex: ⚠️, 🚨, 📥, 🔄, 🎯, 🔥, 📋, etc.)
 * e seletores de variação Unicode, preservando acentuação, pontuação e texto normal.
 */
export function stripNotificationEmojis(text: string): string {
  if (!text) return "";
  return text
    .replace(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{200D}\u{FE0E}\u{FE0F}]/gu,
      "",
    )
    .replace(/^[ \t•·\-–—]+/gm, (match) => (match.includes("•") ? "• " : ""))
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Remove prefixos redundantes de cabeçalho no corpo de notificações de SLA
 * quando o próprio card/toast já exibe o título "Alerta de SLA" / "SLA Estourado".
 */
export function stripRedundantSlaPrefix(text: string): string {
  if (!text) return "";
  return text
    .replace(
      /^\s*\*{0,2}\s*(Atenção ao SLA|SLA Estourado(?:\s*\([^)]*\))?|SLA em risco)\s*:?\s*\*{0,2}\s*:?\s*/i,
      "",
    )
    .trim();
}

/**
 * Retorna texto puro limpo (sem emojis e sem asteriscos de markdown) para
 * contextos de string simples (ex: Notification nativa do SO, atributos title, etc.).
 */
export function cleanPlainNotificationText(
  text: string,
  options?: { stripRedundantPrefix?: boolean; maxLength?: number },
): string {
  if (!text) return "";
  let cleaned = stripNotificationEmojis(String(text));
  if (options?.stripRedundantPrefix) {
    cleaned = stripRedundantSlaPrefix(cleaned);
  }
  cleaned = cleaned
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/\*/g, "")
    .replace(/\s*\n\s*/g, " • ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (options?.maxLength && cleaned.length > options.maxLength) {
    return `${cleaned.slice(0, options.maxLength - 1).trimEnd()}…`;
  }
  return cleaned;
}

/**
 * Converte marcadores `*negrito*` e `**negrito**` em elementos `<strong>` alinhados,
 * removendo emojis e asteriscos soltos para que nenhum caractere especial bruto vaze na UI.
 */
export function renderFormattedNotificationText(
  text: string,
  options?: {
    stripEmojis?: boolean;
    stripRedundantPrefix?: boolean;
    strongClassName?: string;
    maxLength?: number;
  },
): React.ReactNode {
  if (!text) return null;

  const stripEmojis = options?.stripEmojis ?? true;
  const strongClass = options?.strongClassName ?? "font-semibold text-foreground";

  let normalized = String(text);
  if (stripEmojis) {
    normalized = stripNotificationEmojis(normalized);
  }
  if (options?.stripRedundantPrefix) {
    normalized = stripRedundantSlaPrefix(normalized);
  }

  // Corrigir eventuais asteriscos aninhados (ex: *Novo cliente transferido por *Nome*!*)
  normalized = normalized.replace(/\*([^*\n]*)\*([^*\n]+)\*([^*\n]*)\*/g, "*$1$2$3*");

  if (options?.maxLength && normalized.length > options.maxLength) {
    normalized = `${normalized.slice(0, options.maxLength - 1).trimEnd()}…`;
  }

  // Divide preservando segmentos **negrito** ou *negrito*
  const tokenRegex = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
  const parts = normalized.split(tokenRegex);

  return parts.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      const inner = part.slice(2, -2).replace(/\*/g, "").trim();
      return (
        <strong key={idx} className={strongClass}>
          {inner}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      const inner = part.slice(1, -1).replace(/\*/g, "").trim();
      return (
        <strong key={idx} className={strongClass}>
          {inner}
        </strong>
      );
    }
    // Remove asteriscos órfãos remanescentes
    const cleanPart = part.replace(/\*/g, "");
    return <React.Fragment key={idx}>{cleanPart}</React.Fragment>;
  });
}
