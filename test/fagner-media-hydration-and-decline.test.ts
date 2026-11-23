import { describe, expect, test } from "bun:test";
import {
  parseMediaTagFromContent,
  hydrateMediaAttachmentsFromDb,
} from "../src/lib/valentina/media-hydration";
import { isClientDecliningTriage } from "../src/lib/triage/industrial-policy";
import { buildTecfagFagnerPrompt } from "../src/lib/valentina/sdr-tecfag-prompt";
import { getAiPersona } from "../src/lib/ai-persona";

describe("Fagner — Hidratação de mídia do banco + desistência/frustração (caso Junior)", () => {
  test("parseMediaTagFromContent extrai tipo, ID e legenda opcional corretamente", () => {
    expect(parseMediaTagFromContent("[MEDIA:image]med_d0be848b2ac0cae7d7029585571d082f")).toEqual({
      mediaType: "image",
      mediaId: "med_d0be848b2ac0cae7d7029585571d082f",
      caption: "",
    });
    expect(parseMediaTagFromContent("[MEDIA:image]med_123\nEssa máquina tem na Black?")).toEqual({
      mediaType: "image",
      mediaId: "med_123",
      caption: "Essa máquina tem na Black?",
    });
    expect(parseMediaTagFromContent("[MEDIA:sticker]med_stk1")).toEqual({
      mediaType: "image",
      mediaId: "med_stk1",
      caption: "",
    });
    expect(parseMediaTagFromContent("[MEDIA:audio]med_aud1")).toEqual({
      mediaType: "audio",
      mediaId: "med_aud1",
      caption: "",
    });
    expect(parseMediaTagFromContent("[MEDIA:document]med_pdf1")).toEqual({
      mediaType: "document",
      mediaId: "med_pdf1",
      caption: "",
    });
    expect(parseMediaTagFromContent("Olá, preciso de uma seladora")).toBeNull();
  });

  test("hydrateMediaAttachmentsFromDb hidrata imagem sem mediaBase64 do lote e histórico sem mediaInterpretation", async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: async () => [
            {
              id: "med_d0be848b2ac0cae7d7029585571d082f",
              mimeType: "image/jpeg",
              base64Data: "ZmFrZV9qcGVnX2J5dGVz",
            },
            {
              id: "med_hist_img",
              mimeType: "image/png",
              base64Data: "ZmFrZV9wbmdfYnl0ZXM=",
            },
          ],
        }),
      }),
    };

    const hydrated = await hydrateMediaAttachmentsFromDb({
      db: mockDb,
      tenantId: "tecfag",
      batchItems: [
        {
          messageId: "msg-batch-1",
          text: "[MEDIA:image]med_d0be848b2ac0cae7d7029585571d082f",
          mediaType: "text",
        },
      ],
      historyMsgs: [
        {
          id: "msg-already-interpreted",
          senderType: "client",
          content: "[MEDIA:image]med_already_done",
          mediaInterpretation: "Print de seladora FRM980ZQS",
        },
        {
          id: "msg-hist-uninterpreted",
          senderType: "client",
          content: "[MEDIA:image]med_hist_img",
          mediaInterpretation: null,
        },
      ],
    });

    expect(hydrated).toHaveLength(2);
    expect(hydrated[0]).toEqual({
      messageId: "msg-batch-1",
      mediaId: "med_d0be848b2ac0cae7d7029585571d082f",
      mediaType: "image",
      mimeType: "image/jpeg",
      mediaBase64: "ZmFrZV9qcGVnX2J5dGVz",
    });
    expect(hydrated[1]).toEqual({
      messageId: "msg-hist-uninterpreted",
      mediaId: "med_hist_img",
      mediaType: "image",
      mimeType: "image/png",
      mediaBase64: "ZmFrZV9wbmdfYnl0ZXM=",
    });
  });

  test("isClientDecliningTriage detecta 'deixa quieto' e desistência com frustração sem bloquear compras ativas", () => {
    expect(isClientDecliningTriage("vamos deixar quieto muito obrigado")).toBe(true);
    expect(isClientDecliningTriage("ja entendi deixa quieto")).toBe(true);
    expect(
      isClientDecliningTriage(
        "deixa quieto .. obrigado 2 vendedores e ninguem consegue arrumar a maquina que eu pedi nao importa o tanto que eu faço deixa quieto",
      ),
    ).toBe(true);
    expect(isClientDecliningTriage("pode esquecer, não quero mais")).toBe(true);
    expect(isClientDecliningTriage("Quero comprar uma seladora a vácuo FRM980ZQS")).toBe(false);
    expect(isClientDecliningTriage("a p400 é que me interessa")).toBe(false);
  });

  test("prompt do Fagner proíbe confundir códigos parciais (P400 vs FRP400) e insistir após desistência", () => {
    const prompt = buildTecfagFagnerPrompt({
      aiPersona: getAiPersona("tecfag"),
      knowledgeContext: "📚 BASE DE CONHECIMENTO",
      conversationHistoryText: "",
      batchSummary: "Cliente: a p400 é que me interessa",
      currentDataSummary: {},
      cnpjDirective: "",
      firstMessageRule: "",
      hasPreviousEmoji: false,
      hasPreviousAudio: false,
    });
    expect(prompt).toContain("P400");
    expect(prompt).toContain("FRP400");
    expect(prompt).toContain("deixa quieto");
    expect(prompt).toContain("5A_CLIENTE");
  });
});
