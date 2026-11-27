import type { Conversation, Message } from "./mockData";

export type PreviewSenderRole = "client" | "operator" | "none";

type PreviewMessageLike = Message & {
  sender?: string;
  sentAt?: string | Date | null;
};

const HHMM_REGEX = /^\d{2}:\d{2}$/;
const DDMMYYYY_REGEX = /^\d{2}\/\d{2}\/\d{4}$/;

export function isAutoDealContextNote(msg?: PreviewMessageLike | string | null): boolean {
  if (!msg) return false;
  if (
    typeof msg === "object" &&
    !msg.isInternalNote &&
    msg.sender !== "system" &&
    msg.author !== "Sistema" &&
    !/^\[(?:Nota|Sistema)\]/i.test((msg.text || "").trim())
  ) {
    return false;
  }
  const text = (typeof msg === "string" ? msg : msg.text || "").trim();
  return /^(?:\[(?:Sistema|Nota)\]\s*)?Negociaç(?:ão|ões) (?:atual|deste atendimento|criada neste atendimento|vinculada)/i.test(
    text,
  );
}

export function isConversationSystemLog(msg?: PreviewMessageLike | null): boolean {
  if (!msg) return false;
  return msg.senderType === "system" || msg.sender === "system" || msg.author === "Sistema";
}

export function getConversationPreviewMessage(messages?: Message[] | null): Message | undefined {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const candidate = messages[i];
    if (!isAutoDealContextNote(candidate) && !isConversationSystemLog(candidate)) {
      return candidate;
    }
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const candidate = messages[i];
    if (!isAutoDealContextNote(candidate)) {
      return candidate;
    }
  }
  return messages[messages.length - 1];
}

export function formatBrtTimeHHMM(value?: string | Date | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export function formatBrtDateDDMMYYYY(value?: string | Date | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

export function formatBrtTimeAndDate(value?: string | Date | null): string | null {
  const time = formatBrtTimeHHMM(value);
  const date = formatBrtDateDDMMYYYY(value);
  if (!time || !date) return null;
  return `${time} - ${date}`;
}

export function getConversationPreviewTime(
  conversation: Pick<Conversation, "lastMessageTime" | "lastMessageAtISO" | "messages"> & {
    time?: string;
  },
  previewMsg?: PreviewMessageLike,
): string {
  const targetMsg: PreviewMessageLike | undefined =
    previewMsg ?? getConversationPreviewMessage(conversation.messages);
  if (targetMsg) {
    const fromIso = formatBrtTimeAndDate(targetMsg.sentAtISO || targetMsg.sentAt);
    if (fromIso) return fromIso;
    if (targetMsg.time && HHMM_REGEX.test(targetMsg.time)) {
      if (targetMsg.date && DDMMYYYY_REGEX.test(targetMsg.date)) {
        return `${targetMsg.time} - ${targetMsg.date}`;
      }
      const convDate = formatBrtDateDDMMYYYY(conversation.lastMessageAtISO);
      if (convDate) return `${targetMsg.time} - ${convDate}`;
      return targetMsg.time;
    }
  }
  const fromConvIso = formatBrtTimeAndDate(conversation.lastMessageAtISO);
  if (fromConvIso) return fromConvIso;
  return conversation.time || conversation.lastMessageTime || "";
}

/**
 * Retorna a última mensagem real trocada com o cliente (ignorando notas internas,
 * avisos e logs de sistema), usada para determinar se a última interação foi do
 * operador ou do cliente.
 */
export function getConversationLastRealMessage(messages?: Message[] | null): Message | undefined {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const candidate = messages[i];
    if (!candidate) continue;
    if (
      candidate.isInternalNote ||
      candidate.isWarning ||
      isConversationSystemLog(candidate) ||
      isAutoDealContextNote(candidate)
    ) {
      continue;
    }
    return candidate;
  }
  return undefined;
}

/**
 * Classifica o remetente de uma mensagem de preview como "client", "operator" ou "none".
 * Notas internas, logs de sistema e avisos retornam "none".
 */
export function classifyConversationMessageSender(msg?: Message | null): PreviewSenderRole {
  if (!msg) return "none";
  if (
    msg.isInternalNote ||
    msg.isWarning ||
    isConversationSystemLog(msg) ||
    isAutoDealContextNote(msg)
  ) {
    return "none";
  }
  if (msg.senderType === "client") return "client";
  if (msg.senderType === "agent" || msg.senderType === "bot") return "operator";
  if (msg.side === "in") return "client";
  if (msg.side === "out") return "operator";
  return "none";
}

/**
 * Retorna o prefixo exibido antes da última mensagem na preview do atendimento:
 * - "Você" quando a mensagem foi enviada pelo operador
 * - "Ele" quando foi enviada pelo cliente
 * - null para notas internas, mensagens de sistema ou conversa vazia
 */
export function getConversationPreviewPrefix(msg?: Message | null): "Você" | "Ele" | null {
  const role = classifyConversationMessageSender(msg);
  if (role === "operator") return "Você";
  if (role === "client") return "Ele";
  return null;
}
