import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Download, Info } from "lucide-react";
import {
  clampContextMenuPosition,
  type DownloadableMediaDescriptor,
  type MessageContextMenuState,
} from "@/lib/chat/message-context-menu";

interface MessageContextMenuProps {
  menu: MessageContextMenuState | null;
  isExpanded: boolean;
  showInfoOption?: boolean;
  downloadMedia?: DownloadableMediaDescriptor | null;
  onToggleInfo: (messageId: string) => void;
  onDownloadMedia?: (media: DownloadableMediaDescriptor) => void;
  onClose: () => void;
  /** Mantém compatibilidade com detectores de foco do Mini Chat Flutuante */
  insideMiniChat?: boolean;
}

/**
 * Menu de contexto (clique com botão direito) exibido sobre mensagens e mídias do chat.
 * Segue exatamente o mesmo padrão visual e comportamental do menu de contexto da
 * preview de atendimentos em ChatList / CrmChatWidget.
 */
export function MessageContextMenu({
  menu,
  isExpanded,
  showInfoOption = true,
  downloadMedia = null,
  onToggleInfo,
  onDownloadMedia,
  onClose,
  insideMiniChat = false,
}: MessageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;

    const handleMouseDown = (event: MouseEvent) => {
      // Botão direito em outra mensagem atualiza o menu via onContextMenu sem piscar;
      // clique esquerdo/meio fora fecha imediatamente.
      if (event.button === 2) return;
      if (menuRef.current && menuRef.current.contains(event.target as Node)) return;
      onClose();
    };

    const handleWindowContextMenu = (event: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(event.target as Node)) return;
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const handleScrollOrResize = () => {
      onClose();
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("contextmenu", handleWindowContextMenu);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    window.addEventListener("blur", handleScrollOrResize);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("contextmenu", handleWindowContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("blur", handleScrollOrResize);
    };
  }, [menu, onClose]);

  if (typeof document === "undefined") return null;

  const canDownload = Boolean(downloadMedia && onDownloadMedia);
  const itemCount = (showInfoOption ? 1 : 0) + (canDownload ? 1 : 0);
  const estimatedMenuHeight = Math.max(48, itemCount * 36 + 12);

  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1280;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 720;
  const pos =
    menu && itemCount > 0
      ? clampContextMenuPosition(menu.x, menu.y, viewportW, viewportH, 196, estimatedMenuHeight, 8)
      : null;

  return createPortal(
    <AnimatePresence>
      {menu && pos && itemCount > 0 && (
        <motion.div
          ref={menuRef}
          role="menu"
          aria-label="Opções da mensagem"
          data-tour="chat.message-context-menu"
          {...(insideMiniChat ? { "data-crm-chat-widget": "" } : {})}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.1 }}
          className="fixed z-[10070] pointer-events-auto min-w-[180px] rounded-xl bg-card border border-border shadow-card p-1"
          style={{ top: pos.y, left: pos.x }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {showInfoOption && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onToggleInfo(menu.messageId);
                onClose();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
            >
              <Info className="h-3.5 w-3.5 text-primary shrink-0" />
              <span>{isExpanded ? "Ocultar informações" : "Informações"}</span>
            </button>
          )}
          {canDownload && downloadMedia && onDownloadMedia && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onDownloadMedia(downloadMedia);
                onClose();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-primary shrink-0" />
              <span>Baixar</span>
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
