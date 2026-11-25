import { isSiteConversationId } from "../livechat/site-channel-policy";

export type ChannelDividerKind =
  | "site_start"
  | "whatsapp_start"
  | "site_end_pending_whatsapp";

export interface ChannelOriginMessageLike {
  id?: string | null;
  provider?: string | null;
  author?: string | null;
  senderType?: string | null;
  isInternalNote?: boolean | null;
  isWarning?: boolean | null;
  metaDetails?: Record<string, any> | null;
}

export interface ChannelBoundaryMarker {
  /** Verdadeiro quando a mensagem exibida na conversa de WhatsApp aconteceu originalmente no chat do Site. */
  isSiteOriginInWhatsapp: boolean;
  /** Divisória visual a renderizar ANTES desta mensagem (início do bloco Site ou início do atendimento no WhatsApp). */
  beforeDivider: ChannelDividerKind | null;
  /** Divisória visual a renderizar APÓS esta mensagem (quando a conversa termina no bloco do Site sem msg de WhatsApp ainda). */
  afterDivider: ChannelDividerKind | null;
}

/**
 * Identifica se uma mensagem veio originalmente do chat online do Site (triagem espelhada na ponte Site → WhatsApp).
 */
export function isSiteOriginMessage(msg: ChannelOriginMessageLike | null | undefined): boolean {
  if (!msg) return false;
  if (msg.isInternalNote || msg.isWarning) return false;
  if (msg.author === "Sistema" || msg.senderType === "system") return false;
  if (msg.provider === "livechat") return true;
  if (typeof msg.id === "string" && msg.id.startsWith("lcx-")) return true;
  const copiedChannel = (msg.metaDetails as Record<string, any> | null | undefined)?.copiedFrom?.channel;
  return copiedChannel === "livechat" || copiedChannel === "site";
}

function isRealChatBubble(msg: ChannelOriginMessageLike | null | undefined): boolean {
  if (!msg) return false;
  if (msg.id === "val_welcome") return false;
  if (msg.isInternalNote || msg.isWarning) return false;
  if (msg.author === "Sistema" || msg.senderType === "system") return false;
  return true;
}

function isSiteHandoffSystemNote(msg: ChannelOriginMessageLike | null | undefined): boolean {
  if (!msg) return false;
  if (msg.senderType !== "system" && msg.author !== "Sistema") return false;
  return typeof msg.id === "string" && (msg.id.startsWith("note-swa-") || msg.id.startsWith("sys-cont-"));
}

/**
 * Calcula, para cada item do feed de mensagens de uma conversa de WhatsApp, quais mensagens
 * são espelhadas do Site e onde inserir as divisórias explícitas de início do Site e início do WhatsApp.
 *
 * Funciona de forma idêntica com `showSystemInfo` ligado ou desligado, e nunca altera conversas
 * puras do Site (`conv-lc-*`) ou o chat interno do assistente (`valentina`).
 */
export function computeChannelBoundaryMarkers<T extends ChannelOriginMessageLike>(
  messages: readonly T[],
  activeChat: { id?: string | null; channel?: string | null },
): ChannelBoundaryMarker[] {
  const empty = (): ChannelBoundaryMarker[] =>
    messages.map(() => ({
      isSiteOriginInWhatsapp: false,
      beforeDivider: null,
      afterDivider: null,
    }));

  if (!messages.length) return [];
  if (
    activeChat.id === "valentina" ||
    activeChat.channel === "livechat" ||
    isSiteConversationId(activeChat.id)
  ) {
    return empty();
  }

  const hasAnySiteMsg = messages.some((m) => isSiteOriginMessage(m));
  if (!hasAnySiteMsg) return empty();

  const markers = empty();
  let lastRealOrigin: "site" | "whatsapp" | null = null;
  let lastSiteRealIndex = -1;
  let trailingSiteNoteIndex = -1;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!isRealChatBubble(msg)) {
      if (lastRealOrigin === "site" && isSiteHandoffSystemNote(msg)) {
        trailingSiteNoteIndex = i;
      }
      continue;
    }

    const origin: "site" | "whatsapp" = isSiteOriginMessage(msg) ? "site" : "whatsapp";
    if (origin === "site") {
      markers[i].isSiteOriginInWhatsapp = true;
      if (lastRealOrigin !== "site") {
        markers[i].beforeDivider = "site_start";
      }
      lastSiteRealIndex = i;
      trailingSiteNoteIndex = -1;
    } else if (lastRealOrigin === "site") {
      markers[i].beforeDivider = "whatsapp_start";
      trailingSiteNoteIndex = -1;
    }
    lastRealOrigin = origin;
  }

  // Se o histórico ainda termina na triagem do Site (nenhuma mensagem de WhatsApp veio depois),
  // exibe a divisória de transição ao final do bloco do Site (após a nota de resumo se ela estiver visível).
  if (lastRealOrigin === "site" && lastSiteRealIndex >= 0) {
    const anchorIdx = trailingSiteNoteIndex >= 0 ? trailingSiteNoteIndex : lastSiteRealIndex;
    markers[anchorIdx].afterDivider = "site_end_pending_whatsapp";
  }

  return markers;
}
