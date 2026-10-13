import { describe, expect, test } from "bun:test";
import { readinessResponse } from "../src/lib/readiness";
import { outboundEnvelope, restoreOutbound } from "../src/lib/whatsapp/envelope";
import { runtimeSingleton } from "../src/lib/runtime-singleton";

describe("recuperação sem efeitos externos", () => {
  test("serviços compartilhados entre chunks não iniciam duas instâncias", () => {
    const name = crypto.randomUUID();
    let created = 0;
    const first = runtimeSingleton(name, () => {
      created++;
      return { active: true };
    });
    const second = runtimeSingleton(name, () => {
      created++;
      return { active: false };
    });
    expect(second).toBe(first);
    expect(created).toBe(1);
  });
  test("readiness retorna 503 para banco falho, lento ou schema incompleto", async () => {
    expect((await readinessResponse(async () => true)).status).toBe(200);
    expect((await readinessResponse(async () => false)).status).toBe(503);
    expect(
      (
        await readinessResponse(async () => {
          throw new Error("credencial secreta");
        })
      ).status,
    ).toBe(503);
    const response = await readinessResponse(() => new Promise(() => {}), 5);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("credencial");
  });
  test("envelope recupera mídia e template com destinatário validado", () => {
    const payload = {
      tenantId: "test",
      conversationId: "test-conv",
      recipientPhone: "5511999999999",
      text: "legenda",
      mediaUrl: "/api/baileys/media?messageId=file-test",
      mediaType: "document" as const,
      fileName: "arquivo.pdf",
      quotedMessageId: "quote",
      templateName: "welcome",
      templateLanguage: "pt_BR",
      templateComponents: [{ type: "body", parameters: [] }],
    };
    const restored = restoreOutbound(
      {
        ...payload,
        content: "[MEDIA:document]file-test:arquivo.pdf",
        metaDetails: outboundEnvelope(payload),
      },
      payload.recipientPhone,
      "bsuid-test",
    );
    expect(restored.mediaUrl).toBe(payload.mediaUrl);
    expect(restored.templateComponents).toEqual(payload.templateComponents);
    expect(restored.quotedMessageId).toBe("quote");
    expect(restored.recipientUserId).toBe("bsuid-test");
    expect(
      restoreOutbound(
        {
          tenantId: "test",
          conversationId: "test",
          content: "[MEDIA:document]file:arquivo.pdf\nlegenda",
          metaDetails: {},
        },
        "123",
      ).text,
    ).toBe("legenda");
    expect(() =>
      restoreOutbound(
        {
          tenantId: "test",
          conversationId: "test",
          content: "[Mídia: arquivo.pdf]",
          metaDetails: {},
        },
        "123",
      ),
    ).toThrow();
  });
});
