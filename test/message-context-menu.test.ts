import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  clampContextMenuPosition,
  extractDownloadableMediaFromMessage,
  resolveDownloadFileName,
  resolveMessageInfoAuthor,
  sanitizeDownloadFileName,
} from "../src/lib/chat/message-context-menu";

const root = path.resolve(import.meta.dir, "..");

describe("Menu de Contexto (botão direito → Informações e Baixar) em mensagens e mídias", () => {
  it("clampContextMenuPosition mantém coordenadas dentro da viewport sem estourar bordas", () => {
    expect(clampContextMenuPosition(420, 310, 1280, 720)).toEqual({ x: 420, y: 310 });

    expect(clampContextMenuPosition(1260, 310, 1280, 720, 196, 84, 8)).toEqual({
      x: 1076,
      y: 310,
    });

    expect(clampContextMenuPosition(500, 710, 1280, 720, 196, 84, 8)).toEqual({
      x: 500,
      y: 628,
    });

    expect(clampContextMenuPosition(-20, 2, 1280, 720, 196, 48, 8)).toEqual({
      x: 8,
      y: 8,
    });

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

  it("extractDownloadableMediaFromMessage reconhece foto, vídeo, áudio, PDF, figurinha, mídia local e SEND_IMAGE, e retorna null para texto", () => {
    // Texto puro e emoji não oferecem botão Baixar
    expect(extractDownloadableMediaFromMessage("Olá, tudo bem?")).toBeNull();
    expect(extractDownloadableMediaFromMessage("👍")).toBeNull();
    expect(extractDownloadableMediaFromMessage("")).toBeNull();
    expect(extractDownloadableMediaFromMessage(null)).toBeNull();

    // Foto com legenda
    const img = extractDownloadableMediaFromMessage(
      "[MEDIA:image]wamid-123456:seladora.png\nSegue a foto da máquina",
    );
    expect(img).toEqual({
      type: "image",
      url: "/api/baileys/media?messageId=wamid-123456",
      fallbackUrl: "/api/valentina/catalog-images?action=rawImage&fileName=seladora.png",
      fileName: "seladora.png",
      hasExplicitFileName: true,
    });

    // Vídeo sem extra
    const vid = extractDownloadableMediaFromMessage("[MEDIA:video]vid987654321");
    expect(vid?.type).toBe("video");
    expect(vid?.url).toBe("/api/baileys/media?messageId=vid987654321");
    expect(vid?.hasExplicitFileName).toBe(false);

    // Áudio
    const aud = extractDownloadableMediaFromMessage("[MEDIA:audio]aud-555");
    expect(aud?.type).toBe("audio");
    expect(aud?.url).toBe("/api/baileys/media?messageId=aud-555");

    // PDF / documento com espaços
    const doc = extractDownloadableMediaFromMessage(
      "[MEDIA:document]doc-42:PROPOSTA 0025467 - Cliente.pdf\nSegue proposta",
    );
    expect(doc).toEqual({
      type: "document",
      url: "/api/baileys/media?messageId=doc-42",
      fallbackUrl: null,
      fileName: "PROPOSTA 0025467 - Cliente.pdf",
      hasExplicitFileName: true,
    });

    // Figurinha
    const sticker = extractDownloadableMediaFromMessage("[MEDIA:sticker]stk-77");
    expect(sticker?.type).toBe("sticker");
    expect(sticker?.url).toBe("/api/baileys/media?messageId=stk-77");

    // Mídia local (blob:) recém-enviada
    const localPdf = extractDownloadableMediaFromMessage(
      "[LOCAL_MEDIA:document:blob:https://tecfagchat.up.railway.app/abc-123:cartao cnpj.pdf]",
    );
    expect(localPdf).toEqual({
      type: "document",
      url: "blob:https://tecfagchat.up.railway.app/abc-123",
      fallbackUrl: null,
      fileName: "cartao cnpj.pdf",
      hasExplicitFileName: true,
    });

    // SEND_IMAGE de catálogo
    const sendImg = extractDownloadableMediaFromMessage("[SEND_IMAGE:kf-maquina-01.png]");
    expect(sendImg?.type).toBe("image");
    expect(sendImg?.url).toBe("/api/valentina/catalog-images?action=rawImage&fileId=kf-maquina-01");
    expect(sendImg?.fileName).toBe("kf-maquina-01.png");

    // Tag legada de imagem
    const legacy = extractDownloadableMediaFromMessage("[Arquivo anexado: foto_maquina.jpg]");
    expect(legacy?.type).toBe("image");
    expect(legacy?.fileName).toBe("foto_maquina.jpg");
    expect(legacy?.url).toBe(
      "/api/valentina/catalog-images?action=rawImage&fileName=foto_maquina.jpg",
    );
  });

  it("resolveDownloadFileName e sanitizeDownloadFileName preservam extensões reais e inferem extensão via Content-Type", () => {
    expect(sanitizeDownloadFileName('Proposta: <01/2026> "Cliente"?.pdf')).toBe(
      "Proposta_ _01_2026_ _Cliente__.pdf",
    );

    const pdfDoc = extractDownloadableMediaFromMessage("[MEDIA:document]d1:proposta.pdf")!;
    expect(resolveDownloadFileName(pdfDoc, "application/pdf")).toBe("proposta.pdf");

    const docNoExt = extractDownloadableMediaFromMessage("[MEDIA:document]d2:proposta")!;
    expect(resolveDownloadFileName(docNoExt, "application/pdf")).toBe("proposta.pdf");

    const audio = extractDownloadableMediaFromMessage("[MEDIA:audio]a1")!;
    expect(resolveDownloadFileName(audio, "audio/ogg; codecs=opus")).toMatch(/^audio-.*\.ogg$/);
    expect(resolveDownloadFileName(audio, "audio/mpeg")).toMatch(/^audio-.*\.mp3$/);
    expect(resolveDownloadFileName(audio, null)).toMatch(/^audio-.*\.ogg$/);

    const photo = extractDownloadableMediaFromMessage("[MEDIA:image]p1")!;
    expect(resolveDownloadFileName(photo, "image/png")).toMatch(/^imagem-.*\.png$/);
    expect(resolveDownloadFileName(photo, "application/octet-stream")).toMatch(/^imagem-.*\.jpg$/);

    const video = extractDownloadableMediaFromMessage("[MEDIA:video]v1")!;
    expect(resolveDownloadFileName(video, "video/mp4")).toMatch(/^video-.*\.mp4$/);

    const sticker = extractDownloadableMediaFromMessage("[MEDIA:sticker]s1")!;
    expect(resolveDownloadFileName(sticker, "image/webp")).toMatch(/^figurinha-.*\.webp$/);
  });

  it("MessageContextMenu oferece Informações e Baixar no padrão visual da preview, usa portal e respeita Design System e multi-tenant", () => {
    const src = readFileSync(path.join(root, "src/components/chat/MessageContextMenu.tsx"), "utf8");

    expect(src).toContain("createPortal");
    expect(src).toContain("document.body");
    expect(src).toContain("rounded-xl bg-card border border-border shadow-card p-1");
    expect(src).toContain("Informações");
    expect(src).toContain("Ocultar informações");
    expect(src).toContain("Baixar");
    expect(src).toContain("onDownloadMedia");
    expect(src).toContain("clampContextMenuPosition");
    expect(src).toContain("Escape");
    expect(src).toContain('"scroll"');

    // Conformidade Design System e isolamento multi-tenant
    expect(src).not.toMatch(/\btitle\s*=/);
    expect(src).not.toMatch(/<select[\s>]/);
    expect(src).not.toMatch(/["'](valem|tecfag)["']/i);
  });

  it("ChatMessageBubble conecta onContextMenu em todas as variantes de mídia (inclusive notas internas com mídia) e texto", () => {
    const src = readFileSync(path.join(root, "src/components/chat/ChatMessageBubble.tsx"), "utf8");

    expect(src).toContain("onMessageContextMenu?: (e: React.MouseEvent, id: string) => void;");
    expect(src).toContain(
      "if (prev.onMessageContextMenu !== next.onMessageContextMenu) return false;",
    );

    // Outgoing (5) + Incoming (6) + Notas Internas com mídia (2) = 13
    const contextMenuBindings =
      src.match(/onContextMenu=\{\(e\) => onMessageContextMenu\?\.\(e, m\.id\)\}/g) || [];
    expect(contextMenuBindings.length).toBeGreaterThanOrEqual(13);

    expect(src).toContain("{displayAuthor} · {m.time}");
  });

  it("ChatPanel integra download de mídia no MessageContextMenu e evita toggle acidental ao clicar em foto/vídeo com legenda", () => {
    const src = readFileSync(path.join(root, "src/components/chat/ChatPanel.tsx"), "utf8");

    expect(src).toContain('import { MessageContextMenu } from "./MessageContextMenu"');
    expect(src).toContain("downloadChatMedia");
    expect(src).toContain("extractDownloadableMediaFromMessage");
    expect(src).toContain("onMessageContextMenu={handleMessageContextMenu}");
    expect(src).toContain("<MessageContextMenu");
    expect(src).toContain("downloadMedia={contextMenuDownloadMedia}");
    expect(src).toContain("handleDownloadContextMedia");
  });

  it("CrmChatWidget (Mini Chat) oferece Informações e Baixar nas mensagens e mídias", () => {
    const src = readFileSync(path.join(root, "src/components/crm/CrmChatWidget.tsx"), "utf8");

    expect(src).toContain(
      'import { MessageContextMenu } from "@/components/chat/MessageContextMenu"',
    );
    expect(src).toContain("downloadChatMedia");
    expect(src).toContain("extractDownloadableMediaFromMessage");
    expect(src).toContain("<MessageContextMenu");
    expect(src).toContain("insideMiniChat");
    expect(src).toContain("handleDownloadContextMedia");
    const bindings =
      src.match(/onContextMenu=\{\(e\) => handleMessageContextMenu\(e, msgId, message\)\}/g) || [];
    expect(bindings.length).toBeGreaterThanOrEqual(3);
  });
});
