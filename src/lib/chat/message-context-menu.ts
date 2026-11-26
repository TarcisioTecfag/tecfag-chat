export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface MessageContextMenuState {
  messageId: string;
  x: number;
  y: number;
}

/**
 * Garante que o menu de contexto de mensagem nunca ultrapasse os limites visíveis
 * da viewport (ex.: mensagens enviadas coladas na borda direita ou na última linha do chat).
 */
export function clampContextMenuPosition(
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
  menuWidth = 196,
  menuHeight = 48,
  padding = 8,
): ContextMenuPosition {
  const safeViewportW =
    Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : menuWidth + padding * 2;
  const safeViewportH =
    Number.isFinite(viewportHeight) && viewportHeight > 0
      ? viewportHeight
      : menuHeight + padding * 2;
  const maxX = Math.max(padding, safeViewportW - menuWidth - padding);
  const maxY = Math.max(padding, safeViewportH - menuHeight - padding);

  return {
    x: Math.min(Math.max(clientX, padding), maxX),
    y: Math.min(Math.max(clientY, padding), maxY),
  };
}

/**
 * Resolve o rótulo do remetente exibido ao expandir as informações da mensagem,
 * garantindo fallback consistente para mídias e mensagens otimistas/legadas.
 */
export function resolveMessageInfoAuthor(params: {
  author?: string | null;
  isMe: boolean;
  operatorName?: string | null;
  chatName?: string | null;
}): string {
  const explicit = params.author?.trim();
  if (explicit) return explicit;
  if (params.isMe) {
    return params.operatorName?.trim() || "Você";
  }
  return params.chatName?.trim() || "Contato";
}
