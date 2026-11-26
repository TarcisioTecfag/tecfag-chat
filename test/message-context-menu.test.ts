import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  clampContextMenuPosition,
  resolveMessageInfoAuthor,
} from "../src/lib/chat/message-context-menu";

const root = path.resolve(import.meta.dir, "..");

describe("Menu de Contexto (botão direito → Informações) em mensagens e mídias", () => {
  it("clampContextMenuPosition mantém coordenadas dentro da viewport sem estourar bordas", () => {
    // Posição confortável no centro
    expect(clampContextMenuPosition(420, 310, 1280, 720)).toEqual({ x: 420, y: 310 });

    // Clique próximo à borda direita (ex.: foto/áudio/PDF enviado pelo operador)
    expect(clampContextMenuPosition(1260, 310, 1280, 720, 196, 48, 8)).toEqual({
      x: 1076,
      y: 310,
    });

    // Clique próximo ao rodapé (ex.: última mídia da conversa)
    expect(clampContextMenuPosition(500, 710, 1280, 720, 196, 48, 8)).toEqual({
      x: 500,
      y: 664,
    });

    // Coordenadas negativas ou menores que o padding mínimo
    expect(clampContextMenuPosition(-20, 2, 1280, 720, 196, 48, 8)).toEqual({
      x: 8,
      y: 8,
    });

    // Viewport inválido / muito pequeno não produz NaN nem negativos
    const fallback = clampContextMenuPosition(500, 500, 0, 0, 196, 48, 8);
    expect(Number.isFinite(fallback.x)).toBe(true);
    expect(Number.isFinite(fallback.y)).toBe(true);
    expect(fallback.x).toBeGreaterThanOrEqual(8);
    expect(fallback.y).toBeGreaterThanOrEqual(8);
  });

  it("resolveMessageInfoAuthor preserva autor explícito e aplica fallbacks limpos para mídias", () => {
    expect(
      resolveMessageInfoAuthor({
        author: "Tarcisio",
        isMe: true,
        operatorName: "Outro",
        chatName: "Cliente",
      }),
    ).toBe("Tarcisio");

    expect(
      resolveMessageInfoAuthor({
        author: "   ",
        isMe: true,
        operatorName: "Maria Vitoria",
        chatName: "Cliente",
      }),
    ).toBe("Maria Vitoria");

    expect(
      resolveMessageInfoAuthor({
        author: "",
        isMe: true,
        operatorName: null,
        chatName: "Cliente",
      }),
    ).toBe("Você");

    expect(
      resolveMessageInfoAuthor({
        author: undefined,
        isMe: false,
        operatorName: "Operador",
        chatName: "Anderson Silva",
      }),
    ).toBe("Anderson Silva");

    expect(
      resolveMessageInfoAuthor({
        author: null,
        isMe: false,
        operatorName: "Operador",
        chatName: "",
      }),
    ).toBe("Contato");
  });

  it("MessageContextMenu segue padrão visual da preview, usa portal e respeita Design System e multi-tenant", () => {
    const src = readFileSync(path.join(root, "src/components/chat/MessageContextMenu.tsx"), "utf8");

    expect(src).toContain("createPortal");
    expect(src).toContain("document.body");
    expect(src).toContain("rounded-xl bg-card border border-border shadow-card p-1");
    expect(src).toContain("Informações");
    expect(src).toContain("Ocultar informações");
    expect(src).toContain("clampContextMenuPosition");
    expect(src).toContain("Escape");
    expect(src).toContain('"scroll"');

    // Conformidade Design System e isolamento multi-tenant
    expect(src).not.toMatch(/\btitle\s*=/);
    expect(src).not.toMatch(/<select[\s>]/);
    expect(src).not.toMatch(/["'](valem|tecfag)["']/i);
  });

  it("ChatMessageBubble conecta onContextMenu em TODAS as variantes de mídia (foto, vídeo, áudio, PDF, figurinha, emoji) e texto", () => {
    const src = readFileSync(path.join(root, "src/components/chat/ChatMessageBubble.tsx"), "utf8");

    expect(src).toContain("onMessageContextMenu?: (e: React.MouseEvent, id: string) => void;");
    expect(src).toContain(
      "if (prev.onMessageContextMenu !== next.onMessageContextMenu) return false;",
    );

    // Contagem mínima:
    // Outgoing (5): sticker, audio/doc, media sem legenda, emoji-only, bolha padrão (texto + mídia com legenda)
    // Incoming (6): sticker, audio/doc, media sem legenda, emoji-only, vtex standalone, bolha padrão
    const contextMenuBindings =
      src.match(/onContextMenu=\{\(e\) => onMessageContextMenu\?\.\(e, m\.id\)\}/g) || [];
    expect(contextMenuBindings.length).toBeGreaterThanOrEqual(11);

    // Exibe displayAuthor (com fallback seguro) ao expandir informações
    expect(src).toContain("{displayAuthor} · {m.time}");
  });

  it("ChatPanel renderiza MessageContextMenu, passa onMessageContextMenu e evita toggle acidental ao clicar em foto/vídeo com legenda", () => {
    const src = readFileSync(path.join(root, "src/components/chat/ChatPanel.tsx"), "utf8");

    expect(src).toContain('import { MessageContextMenu } from "./MessageContextMenu"');
    expect(src).toContain("onMessageContextMenu={handleMessageContextMenu}");
    expect(src).toContain("<MessageContextMenu");
    expect(src).toContain("onToggleInfo={handleToggleMessageInfo}");
    expect(src).toContain("setMessageContextMenu(null)");
    expect(src).toContain("e.preventDefault();");
  });

  it("CrmChatWidget (Mini Chat) oferece o mesmo menu de contexto com Informações nas mensagens e mídias", () => {
    const src = readFileSync(path.join(root, "src/components/crm/CrmChatWidget.tsx"), "utf8");

    expect(src).toContain(
      'import { MessageContextMenu } from "@/components/chat/MessageContextMenu"',
    );
    expect(src).toContain("<MessageContextMenu");
    expect(src).toContain("insideMiniChat");
    const bindings =
      src.match(/onContextMenu=\{\(e\) => handleMessageContextMenu\(e, msgId\)\}/g) || [];
    expect(bindings.length).toBeGreaterThanOrEqual(3);
  });
});
