import { describe, expect, test } from "bun:test";
import { parseRdNotification } from "../src/lib/rd-marketing/notifications";
import { commercialTransition } from "../src/lib/rd-marketing/commercial-outbox";
import { conversionAttribution } from "../src/lib/rd-marketing/attribution";
import { rdPhoneDigits } from "../src/lib/rd-marketing/sync-identity";
import {
  normalizeRdContactUuid,
  permitsRdRecipient,
  rdTestContactUuidError,
} from "../src/lib/rd-marketing/outbound-scope";

const uuid = "12345678-1234-1234-1234-123456789abc";
const hook = { id: "point-test", kind: "CONVERSION", label: "Conversões" };
const raw = {
  event_type: "WEBHOOK.CONVERTED",
  event_identifier: "botao-teste",
  event_timestamp: "2026-10-14T12:00:00Z",
  timestamp: "2026-10-14T12:00:05Z",
  contact: {
    uuid,
    email: "LEAD@example.com",
    cf_utm_source: "google",
    cf_utm_campaign: "campanha-atual",
    funnel: { origin: "Busca Paga | Google", lifecycle_stage: "Lead" },
  },
};
describe("RD Marketing: avisos e transições comerciais", () => {
  test("colar UUID com espaço ou rótulo mantém o último caractere e não completa UUID truncado", () => {
    for (const pasted of [
      ` ${uuid}`,
      `\u00a0${uuid}\u00a0`,
      `UUID: ${uuid.toUpperCase()}`,
      `"${uuid}"`,
      `\u200b${uuid}\ufeff`,
      uuid.replaceAll("-", "\u2011"),
    ]) {
      expect(normalizeRdContactUuid(pasted)).toBe(uuid);
      expect(rdTestContactUuidError(pasted, true)).toBeNull();
    }
    expect(normalizeRdContactUuid(uuid.slice(0, -1))).toHaveLength(35);
    expect(rdTestContactUuidError(uuid.slice(0, -1), true)).toContain("35 caracteres");
  });
  test("teste isolado restringe UUID, rejeita vínculo conflitante e falha fechado sem contato", () => {
    const config = {
      outboundScope: "test" as const,
      testContact: { uuid, name: "Teste", email: "test@example.com", phone: "+5511999990000" },
    };
    expect(permitsRdRecipient(config, {}, uuid)).toBe(true);
    expect(permitsRdRecipient(config, { email: " TEST@example.com " }, null)).toBe(true);
    expect(permitsRdRecipient(config, { phone: "+55 (11) 99999-0000" }, null)).toBe(true);
    expect(
      permitsRdRecipient(
        config,
        { email: "test@example.com" },
        "99999999-9999-9999-9999-999999999999",
      ),
    ).toBe(false);
    expect(
      permitsRdRecipient(config, { email: "other@example.com", phone: "+5511999990000" }, null),
    ).toBe(false);
    expect(
      permitsRdRecipient({ ...config, testContact: null }, { email: "test@example.com" }, uuid),
    ).toBe(false);
    expect(permitsRdRecipient({ ...config, outboundScope: "all" }, {}, null)).toBe(true);
  });
  test("perfil do webhook é um retrato separado, sem preencher atribuição histórica", () => {
    const event = parseRdNotification(raw, hook)[0];
    expect(event.email).toBe("lead@example.com");
    expect(event.data.source).toBeNull();
    expect(event.data.campaign).toBeNull();
    expect(event.data.observedSource).toBe("Busca Paga | Google");
    expect(event.data.observedCampaign).toBe("campanha-atual");
    expect(
      parseRdNotification({ ...raw, timestamp: "2026-10-14T12:20:00Z" }, hook)[0].eventKey,
    ).toBe(event.eventKey);
    expect(() =>
      parseRdNotification({ ...raw, event_type: "WEBHOOK.MARKED_OPPORTUNITY" }, hook),
    ).toThrow();
  });
  test("ponto de automação não inventa uma data de entrada/conclusão nativa", () => {
    const event = parseRdNotification(raw, {
      ...hook,
      kind: "AUTOMATION",
      label: "Passou na qualificação",
    })[0];
    expect(event.eventType).toBe("AUTOMATION");
    expect(event.occurredAt).toBeNull();
    expect(event.identifier).toBe(hook.id);
    expect(event.data.label).toBe("Passou na qualificação");
    expect(
      parseRdNotification(
        { ...raw, timestamp: "2026-10-14T12:20:00Z" },
        { ...hook, kind: "AUTOMATION", label: "Passou na qualificação" },
      )[0].eventKey,
    ).toBe(event.eventKey);
  });
  test("vendas e perdas são ocorrências por transição, com reabertura independente", () => {
    expect(commercialTransition("open", "lost")).toBe("OPPORTUNITY_LOST");
    expect(commercialTransition("open", "won")).toBe("SALE");
    expect(commercialTransition("won", "won")).toBeNull();
    expect(commercialTransition("lost", "lost")).toBeNull();
    expect(commercialTransition("lost", "open")).toBe("OPPORTUNITY");
    expect(commercialTransition("open", "paused")).toBeNull();
  });
  test("origem textual, tracking estruturado e UTMs em texto têm leitura humana", () => {
    expect(
      conversionAttribution({
        payload: { conversion_origin: "Busca Paga | Google", traffic_campaign: "oferta" },
      }),
    ).toEqual({ source: "Busca Paga | Google", campaign: "oferta", medium: null });
    expect(
      conversionAttribution({
        payload: { traffic_source: { source: "google", campaign: "oferta", medium: "cpc" } },
      }),
    ).toEqual({ source: "google", campaign: "oferta", medium: "cpc" });
    expect(
      conversionAttribution({
        traffic_source: "utm_source=google&utm_medium=cpc&utm_campaign=oferta",
      }),
    ).toEqual({ source: "google", campaign: "oferta", medium: "cpc" });
  });
  test("telefone internacional explícito conserva o país", () => {
    expect(rdPhoneDigits("+1 (202) 555-0100")).toBe("12025550100");
    expect(rdPhoneDigits("+55 (11) 99999-0000")).toBe("5511999990000");
  });
});
