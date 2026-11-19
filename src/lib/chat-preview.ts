import type { Message } from "./mockData";

export type PreviewSenderRole = "client" | "operator" | "none";

export function isAutoDealContextNote(msg?: Message | string | null): boolean {
  if (!msg) return false;
  if (
    typeof msg === "object" &&
    !msg.isInternalNote &&
    (msg as any).sender !== "system" &&
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

export function isConversationSystemLog(msg?: Message | null): boolean {
  if (!msg) return false;
  return (
    msg.senderType === "system" ||
    (msg as any).sender === "system" ||
    msg.author === "Sistema"
  );
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
