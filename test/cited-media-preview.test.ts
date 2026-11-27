import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  extractLegacyMediaRefFromPreview,
  inferCitedMediaKindFromMimeOrFileName,
  normalizeCitedMessageMedia,
  parseCitedMessageMedia,
  sanitizeCitedTextPreview,
} from "../src/lib/valentina/cited-media";
import { hydrateCitedMediaForInternalRows } from "../src/lib/valentina/cited-media-hydrate";

describe("parseCitedMessageMedia — parser de mídias citadas no PV", () => {
  it("interpreta foto com e sem legenda sem vazar o ID med_", () => {
    const simple = parseCitedMessageMedia("[MEDIA:image]med_912d1ac62bbd9f606514ab95ddb9e91b");
    expect(simple.media).toEqual({
      type: "image",
      mediaId: "med_912d1ac62bbd9f606514ab95ddb9e91b",
      url: "/api/baileys/media?messageId=med_912d1ac62bbd9f606514ab95ddb9e91b",
      fileName: null,
      mimeType: null,
      caption: null,
      transcription: null,
      messageId: null,
    });
    expect(simple.previewText).toBe("Foto enviada pelo cliente");
    expect(simple.previewText).not.toContain("med_");

    const withCaption = parseCitedMessageMedia(
      "[MEDIA:image]med_912d1ac62bbd9f606514ab95ddb9e91b\nOlha o painel da seladora",
    );
    expect(withCaption.media?.caption).toBe("Olha o painel da seladora");
    expect(withCaption.previewText).toBe("Foto: Olha o painel da seladora");
  });

  it("interpreta vídeo com legenda e gera URL autenticada /api/baileys/media", () => {
    const parsed = parseCitedMessageMedia(
      "[MEDIA:video]med_video_abc123\nVídeo mostrando o ruído na esteira",
      { messageId: "msg-vid-1" },
    );
    expect(parsed.media).toEqual({
      type: "video",
      mediaId: "med_video_abc123",
      url: "/api/baileys/media?messageId=med_video_abc123",
      fileName: null,
      mimeType: null,
      caption: "Vídeo mostrando o ruído na esteira",
      transcription: null,
      messageId: "msg-vid-1",
    });
    expect(parsed.previewText).toBe("Vídeo: Vídeo mostrando o ruído na esteira");
  });

  it("interpreta áudio com e sem transcrição (mediaInterpretation)", () => {
    const noTranscript = parseCitedMessageMedia("[MEDIA:audio]med_audio_778899", {
      messageId: "msg-aud-1",
    });
    expect(noTranscript.media?.type).toBe("audio");
    expect(noTranscript.media?.transcription).toBeNull();
    expect(noTranscript.media?.messageId).toBe("msg-aud-1");
    expect(noTranscript.previewText).toBe("Áudio enviado pelo cliente");

    const withTranscript = parseCitedMessageMedia("[MEDIA:audio]med_audio_778899", {
      mediaInterpretation: "Preciso do orçamento da seladora a vácuo até sexta.",
      messageId: "msg-aud-1",
    });
    expect(withTranscript.media?.transcription).toBe(
      "Preciso do orçamento da seladora a vácuo até sexta.",
    );
    expect(withTranscript.previewText).toBe(
      "Áudio: Preciso do orçamento da seladora a vácuo até sexta.",
    );
  });

  it("interpreta documento/arquivo preservando fileName e legenda", () => {
    const parsed = parseCitedMessageMedia(
      "[MEDIA:document]med_doc_9911:PROPOSTA_0025467.pdf\nSegue o contrato assinado",
    );
    expect(parsed.media).toEqual({
      type: "document",
      mediaId: "med_doc_9911",
      url: "/api/baileys/media?messageId=med_doc_9911",
      fileName: "PROPOSTA_0025467.pdf",
      mimeType: null,
      caption: "Segue o contrato assinado",
      transcription: null,
      messageId: null,
    });
    expect(parsed.previewText).toBe("Arquivo (PROPOSTA_0025467.pdf): Segue o contrato assinado");
  });

  it("interpreta figurinha (sticker) e formatos [LOCAL_MEDIA:] / [MEDIA_URL:]", () => {
    const sticker = parseCitedMessageMedia("[MEDIA:sticker]med_stk_01");
    expect(sticker.media?.type).toBe("sticker");
    expect(sticker.previewText).toBe("Figurinha enviada pelo cliente");

    const local = parseCitedMessageMedia(
      "[LOCAL_MEDIA:image:https://cdn.example.com/foto.png:foto.png]\nFoto da peça",
    );
    expect(local.media?.type).toBe("image");
    expect(local.media?.url).toBe("https://cdn.example.com/foto.png");
    expect(local.media?.fileName).toBe("foto.png");
    expect(local.media?.caption).toBe("Foto da peça");

    const mediaUrl = parseCitedMessageMedia(
      "[MEDIA_URL:video:https://cdn.example.com/demo.mp4:demo.mp4]",
    );
    expect(mediaUrl.media?.type).toBe("video");
    expect(mediaUrl.media?.url).toBe("https://cdn.example.com/demo.mp4");
    expect(mediaUrl.media?.fileName).toBe("demo.mp4");
  });

  it("corrige alertas legados '[Mídia recebida] med_...' sem nunca expor hash bruto", () => {
    const rawLegacy = "[Mídia recebida] med_912d1ac62bbd9f606514ab95ddb9e91b";

    // Sem MIME conhecido (fallback no cliente): esconde o hash e expõe unresolvedMediaId
    const withoutHint = parseCitedMessageMedia(rawLegacy);
    expect(withoutHint.media).toBeNull();
    expect(withoutHint.previewText).toBe("Mídia recebida");
    expect(withoutHint.previewText).not.toContain("med_");
    expect(withoutHint.unresolvedMediaId).toBe("med_912d1ac62bbd9f606514ab95ddb9e91b");

    // Com MIME resolvido pelo banco (áudio / foto / vídeo / PDF)
    const asAudio = parseCitedMessageMedia(rawLegacy, {
      mimeType: "audio/ogg; codecs=opus",
      mediaInterpretation: "Oi, consegue me mandar o boleto?",
      messageId: "msg-123",
    });
    expect(asAudio.media?.type).toBe("audio");
    expect(asAudio.media?.url).toBe(
      "/api/baileys/media?messageId=med_912d1ac62bbd9f606514ab95ddb9e91b",
    );
    expect(asAudio.media?.transcription).toBe("Oi, consegue me mandar o boleto?");
    expect(asAudio.previewText).toBe("Áudio: Oi, consegue me mandar o boleto?");

    const asImage = parseCitedMessageMedia(rawLegacy, { mimeType: "image/jpeg" });
    expect(asImage.media?.type).toBe("image");
    expect(asImage.previewText).toBe("Foto enviada pelo cliente");

    const asVideo = parseCitedMessageMedia(rawLegacy, { mimeType: "video/mp4" });
    expect(asVideo.media?.type).toBe("video");
    expect(asVideo.previewText).toBe("Vídeo enviado pelo cliente");

    const asDoc = parseCitedMessageMedia(rawLegacy, {
      mimeType: "application/pdf",
      fileName: "cartao_cnpj.pdf",
    });
    expect(asDoc.media?.type).toBe("document");
    expect(asDoc.media?.fileName).toBe("cartao_cnpj.pdf");
    expect(asDoc.previewText).toBe("Arquivo: cartao_cnpj.pdf");
  });

  it("infere tipo de documento automaticamente em legado '[Mídia] med_...:arquivo.pdf'", () => {
    const parsed = parseCitedMessageMedia(
      "[Mídia] med_912d1ac62bbd9f606514ab95ddb9e91b:nota_fiscal.pdf\nComprovante do pagamento",
    );
    expect(parsed.media?.type).toBe("document");
    expect(parsed.media?.mediaId).toBe("med_912d1ac62bbd9f606514ab95ddb9e91b");
    expect(parsed.media?.fileName).toBe("nota_fiscal.pdf");
    expect(parsed.media?.caption).toBe("Comprovante do pagamento");
    expect(parsed.previewText).toBe("Arquivo (nota_fiscal.pdf): Comprovante do pagamento");
  });

  it("mantém texto comum intacto e protege contra entradas adversariais (linear O(N))", () => {
    const plain = parseCitedMessageMedia("Bom dia! Qual o prazo de entrega da seladora?");
    expect(plain.media).toBeNull();
    expect(plain.previewText).toBe("Bom dia! Qual o prazo de entrega da seladora?");

    const t0 = performance.now();
    const huge = `[Mídia recebida] ${"a".repeat(20_000)}:${"b".repeat(20_000)}`;
    const result = extractLegacyMediaRefFromPreview(huge);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(25);
    expect(result).toBeNull();
  });

  it("inferCitedMediaKindFromMimeOrFileName, normalizeCitedMessageMedia e sanitizeCitedTextPreview", () => {
    expect(inferCitedMediaKindFromMimeOrFileName("audio/ogg", null)).toBe("audio");
    expect(inferCitedMediaKindFromMimeOrFileName("image/webp", "sticker_01.webp")).toBe("sticker");
    expect(inferCitedMediaKindFromMimeOrFileName("image/webp", "foto_maquina.webp")).toBe("image");
    expect(inferCitedMediaKindFromMimeOrFileName(null, "planilha.xlsx")).toBe("document");
    expect(inferCitedMediaKindFromMimeOrFileName(null, "demo.mp4")).toBe("video");

    const normalized = normalizeCitedMessageMedia(
      { type: "audio", mediaId: "med_abc999" },
      "https://api.example.com",
    );
    expect(normalized?.url).toBe("https://api.example.com/api/baileys/media?messageId=med_abc999");
    expect(normalizeCitedMessageMedia({ type: "invalid", mediaId: "med_1" })).toBeNull();

    expect(
      sanitizeCitedTextPreview("[Mídia recebida] med_912d1ac62bbd9f606514ab95ddb9e91b", 80),
    ).toBe("Mídia recebida");
  });
});

describe("hydrateCitedMediaForInternalRows — hidratação em lote de alertas legados e conversas citadas", () => {
  function createMockDb(dataset: {
    mediaFiles: Array<{
      id: string;
      tenantId: string;
      conversationId: string | null;
      fileName: string | null;
      mimeType: string;
    }>;
    messages: Array<{
      id: string;
      tenantId: string;
      conversationId: string;
      content: string | null;
      mediaInterpretation: string | null;
    }>;
  }) {
    let callCount = 0;
    return {
      getCallCount: () => callCount,
      select: () => ({
        from: (table: any) => ({
          where: async () => {
            callCount += 1;
            const tableName = table?.[Symbol.for("drizzle:Name")] || "";
            if (tableName === "media_files") {
              return dataset.mediaFiles;
            }
            if (tableName === "messages") {
              return dataset.messages;
            }
            return [];
          },
        }),
      }),
    };
  }

  it("hidrata alerta de SLA legado ('[Mídia recebida] med_...') com foto, áudio transcrito e documento", async () => {
    const mockDb = createMockDb({
      mediaFiles: [
        {
          id: "med_912d1ac62bbd9f606514ab95ddb9e91b",
          tenantId: "tecfag",
          conversationId: "conv-1",
          fileName: null,
          mimeType: "audio/ogg",
        },
        {
          id: "med_img_44556677",
          tenantId: "tecfag",
          conversationId: "conv-2",
          fileName: "etiqueta.jpg",
          mimeType: "image/jpeg",
        },
        {
          id: "med_doc_88990011",
          tenantId: "tecfag",
          conversationId: "conv-3",
          fileName: "pedido_compra.pdf",
          mimeType: "application/pdf",
        },
      ],
      messages: [
        {
          id: "msg-audio-1",
          tenantId: "tecfag",
          conversationId: "conv-1",
          content: "[MEDIA:audio]med_912d1ac62bbd9f606514ab95ddb9e91b",
          mediaInterpretation: "Bom dia, já fiz o Pix e preciso confirmar o envio.",
        },
        {
          id: "msg-img-2",
          tenantId: "tecfag",
          conversationId: "conv-2",
          content: "[MEDIA:image]med_img_44556677\nFoto da peça quebrada",
          mediaInterpretation: null,
        },
        {
          id: "msg-doc-3",
          tenantId: "tecfag",
          conversationId: "conv-3",
          content: "[MEDIA:document]med_doc_88990011:pedido_compra.pdf",
          mediaInterpretation: null,
        },
      ],
    });

    const rows = [
      {
        id: "im-sla-1",
        metadata: {
          type: "sla_alert",
          conversationId: "conv-1",
          clientName: "Tarcisio Pereira Do Nascimento",
          lastMessage: "[Mídia recebida] med_912d1ac62bbd9f606514ab95ddb9e91b",
        },
      },
      {
        id: "im-overload-1",
        metadata: {
          type: "operator_overload",
          conversations: [
            {
              clientId: "conv-2",
              clientName: "Indústria Alfa",
              lastMessage: "[Mídia] med_img_44556677",
            },
            {
              clientId: "conv-3",
              clientName: "Padaria Central",
              lastMessage: "[MEDIA:document]med_doc_88990011:pedido_compra.pdf",
            },
          ],
        },
      },
    ];

    const repairs = await hydrateCitedMediaForInternalRows({
      db: mockDb,
      tenantId: "tecfag",
      rows,
    });

    // Exatamente 2 queries em lote (1 media_files + 1 messages)
    expect(mockDb.getCallCount()).toBe(2);
    expect(repairs.length).toBe(2);

    const slaMeta = rows[0].metadata as any;
    expect(slaMeta.lastMessage).toBe("Áudio: Bom dia, já fiz o Pix e preciso confirmar o envio.");
    expect(slaMeta.lastMessage).not.toContain("med_");
    expect(slaMeta.lastMessageMedia).toEqual({
      type: "audio",
      mediaId: "med_912d1ac62bbd9f606514ab95ddb9e91b",
      url: "/api/baileys/media?messageId=med_912d1ac62bbd9f606514ab95ddb9e91b",
      fileName: null,
      mimeType: "audio/ogg",
      caption: null,
      transcription: "Bom dia, já fiz o Pix e preciso confirmar o envio.",
      messageId: "msg-audio-1",
    });

    const overloadConvs = (rows[1].metadata as any).conversations;
    expect(overloadConvs[0].lastMessage).toBe("Foto: Foto da peça quebrada");
    expect(overloadConvs[0].lastMessageMedia?.type).toBe("image");
    expect(overloadConvs[0].lastMessageMedia?.caption).toBe("Foto da peça quebrada");

    expect(overloadConvs[1].lastMessage).toBe("Arquivo: pedido_compra.pdf");
    expect(overloadConvs[1].lastMessageMedia?.type).toBe("document");
    expect(overloadConvs[1].lastMessageMedia?.fileName).toBe("pedido_compra.pdf");
    expect(overloadConvs[1].lastMessageMedia?.mimeType).toBe("application/pdf");

    // 2ª passagem: já hidratado e completo -> 0 queries extras, 0 reparos
    const prevCalls = mockDb.getCallCount();
    const secondPass = await hydrateCitedMediaForInternalRows({
      db: mockDb,
      tenantId: "tecfag",
      rows,
    });
    expect(secondPass.length).toBe(0);
    expect(mockDb.getCallCount()).toBe(prevCalls);
  });

  it("enriquece áudio já estruturado quando a transcrição fica pronta posteriormente", async () => {
    const mockDb = createMockDb({
      mediaFiles: [
        {
          id: "med_late_audio_1",
          tenantId: "valem",
          conversationId: "conv-valem-1",
          fileName: null,
          mimeType: "audio/ogg",
        },
      ],
      messages: [
        {
          id: "msg-late-1",
          tenantId: "valem",
          conversationId: "conv-valem-1",
          content: "[MEDIA:audio]med_late_audio_1",
          mediaInterpretation: "Quero cotar 5 mil válvulas spray 24/410.",
        },
      ],
    });

    const rows = [
      {
        id: "im-valem-1",
        metadata: {
          type: "sla_alert",
          conversationId: "conv-valem-1",
          lastMessage: "Áudio enviado pelo cliente",
          lastMessageMedia: {
            type: "audio",
            mediaId: "med_late_audio_1",
            url: "/api/baileys/media?messageId=med_late_audio_1",
            transcription: null,
          },
        },
      },
    ];

    const repairs = await hydrateCitedMediaForInternalRows({
      db: mockDb,
      tenantId: "valem",
      rows,
    });
    expect(repairs.length).toBe(1);
    expect((rows[0].metadata as any).lastMessageMedia.transcription).toBe(
      "Quero cotar 5 mil válvulas spray 24/410.",
    );
    expect((rows[0].metadata as any).lastMessage).toBe(
      "Áudio: Quero cotar 5 mil válvulas spray 24/410.",
    );
  });
});

describe("Guardrails de Design System e Isolamento Multi-Tenant", () => {
  it("CitedMessageMediaPreview segue 100% Design System (sem title=, <select> ou inputs nativos de data)", () => {
    const componentPath = path.resolve(
      process.cwd(),
      "src/components/chat/CitedMessageMediaPreview.tsx",
    );
    const source = fs.readFileSync(componentPath, "utf-8");
    expect(source).toContain("SystemTooltip");
    expect(source).not.toMatch(/\btitle\s*=/);
    expect(source).not.toMatch(/<select[\s>]/i);
    expect(source).not.toMatch(/type\s*=\s*["'](?:date|time|datetime-local)["']/i);
  });

  it("cited-media-hydrate sempre filtra queries por tenantId e não hardcoda tenants", () => {
    const hydratePath = path.resolve(
      process.cwd(),
      "src/lib/valentina/cited-media-hydrate.ts",
    );
    const source = fs.readFileSync(hydratePath, "utf-8");
    expect(source).toContain("eq(mediaFiles.tenantId, tenantId)");
    expect(source).toContain("eq(messages.tenantId, tenantId)");
    expect(source).not.toMatch(/["'](?:valem|tecfag)["']/);
  });
});
