import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  encryptRdSecret,
  decryptRdSecret,
  rdEncryptionReady,
} from "../src/lib/rd-marketing/api-crypto";
import { randomBytes } from "node:crypto";
import {
  parseRdContact,
  parseRdEventPage,
  rdContactPath,
  rdEventsPath,
  rdRequest,
  sanitizeRdResponse,
} from "../src/lib/rd-marketing/api-client";

const uuid = "6407acd3-1205-4bd2-9be2-824886e26a3f";
describe("RD Marketing: criptografia e leitura", () => {
  test("recusa de campos expõe apenas códigos de validação permitidos, com leitura limitada", async () => {
    const provider = (async () =>
      Response.json(
        {
          errors: {
            name: {
              "pt-BR": [
                { error_type: "TAKEN", error_message: "secret-token", value: "private-lead" },
              ],
            },
            api_identifier: [{ error_type: "INVALID", error_message: "private-error" }],
            email: [{ error_type: "TAKEN" }],
            label: { "pt-BR": [{ error_type: "secret-code" }] },
          },
        },
        { status: 400 },
      )) as typeof fetch;
    let captured: unknown;
    try {
      await rdRequest("/platform/contacts/fields", { method: "POST" }, provider);
    } catch (error) {
      captured = error;
    }
    expect(captured).toMatchObject({
      code: "RD_HTTP_400",
      statusCode: 400,
      rdFieldValidation: "name.pt-BR: TAKEN; api_identifier: INVALID",
    });
    expect(JSON.stringify(captured)).not.toContain("secret");
    expect(JSON.stringify(captured)).not.toContain("private");
    const oversized = (async () =>
      new Response("x".repeat(20000), { status: 422 })) as typeof fetch;
    await expect(
      rdRequest("/platform/contacts/fields", { method: "POST" }, oversized),
    ).rejects.toMatchObject({ code: "RD_HTTP_422", statusCode: 422 });
  });
  const oldKey = process.env.RD_MARKETING_ENCRYPTION_KEY;
  beforeAll(() => {
    process.env.RD_MARKETING_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });
  afterAll(() => {
    if (oldKey === undefined) delete process.env.RD_MARKETING_ENCRYPTION_KEY;
    else process.env.RD_MARKETING_ENCRYPTION_KEY = oldKey;
  });
  test("AES-GCM protege tenant, finalidade, integridade e usa IV aleatório", () => {
    const envelope = encryptRdSecret("tenant-a", "access-token", "segredo");
    expect(envelope).not.toContain("segredo");
    expect(encryptRdSecret("tenant-a", "access-token", "segredo")).not.toBe(envelope);
    expect(decryptRdSecret("tenant-a", "access-token", envelope)).toBe("segredo");
    expect(() => decryptRdSecret("tenant-b", "access-token", envelope)).toThrow();
    expect(() => decryptRdSecret("tenant-a", "refresh-token", envelope)).toThrow();
    const parts = envelope.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptRdSecret("tenant-a", "access-token", parts.join("."))).toThrow();
  });
  test("não utiliza chave fraca ou fallback", () => {
    const saved = process.env.RD_MARKETING_ENCRYPTION_KEY;
    delete process.env.RD_MARKETING_ENCRYPTION_KEY;
    expect(rdEncryptionReady()).toBe(false);
    expect(() => encryptRdSecret("tenant-a", "token", "secret")).toThrow();
    process.env.RD_MARKETING_ENCRYPTION_KEY = "short";
    expect(rdEncryptionReady()).toBe(false);
    process.env.RD_MARKETING_ENCRYPTION_KEY = saved;
  });
  test("valida identificadores e não permite injetar rota ou evento", () => {
    expect(rdContactPath("email", "cliente+tag@example.com")).toBe(
      "/platform/contacts/email:cliente%2Btag%40example.com",
    );
    expect(rdContactPath("phone", "+55 (11) 99999-9999")).toContain("%2B5511999999999");
    expect(() => rdContactPath("phone", "11999999999")).toThrow();
    expect(() => rdContactPath("uuid", "../../events")).toThrow();
    expect(() => rdEventsPath(uuid, "CONVERSION", 0)).toThrow();
    expect(() => rdEventsPath(uuid, "INVALID" as "CONVERSION", 1)).toThrow();
    expect(rdEventsPath(uuid, "OPPORTUNITY", 2)).toContain(
      "event_type=OPPORTUNITY&order=created_at:desc&page=2",
    );
  });
  test("contato respeita campos ausentes e esconde credenciais do JSON", () => {
    const contact = parseRdContact({
      uuid,
      email: "example@example.com",
      personal_phone: "+5511999999999",
      nested: { access_token: "secret" },
    });
    expect(contact.name).toBeNull();
    expect(contact.phone).toBe("+5511999999999");
    expect(JSON.stringify(contact.raw)).not.toContain("secret");
    expect(() => parseRdContact({ email: "example@example.com" })).toThrow();
    expect(sanitizeRdResponse({ client_secret: "a", events: [{ refresh_token: "b" }] })).toEqual({
      client_secret: "[oculto]",
      events: [{ refresh_token: "[oculto]" }],
    });
  });
  test("eventos mantêm atribuição e data recebidas sem inventar visitas ou links", () => {
    const raw = [
      {
        uuid: "event-1",
        created_at: "2026-10-13T13:32:00-03:00",
        payload: {
          conversion_identifier: "botao-whatsapp",
          conversion_origin: { source: "google", campaign: "dosadoras" },
          url: "https://example.com/produto",
          deal_url: "javascript:alert(1)",
          page_url: "https://secret:password@example.com",
        },
      },
      { payload: {} },
    ];
    const page = parseRdEventPage({ events: raw }, "CONVERSION", 1);
    expect(page.recognized).toBe(true);
    expect(page.events[0].source).toBe("google");
    expect(page.events[0].campaign).toBe("dosadoras");
    expect(page.events[0].links).toEqual(["https://example.com/produto"]);
    expect(page.events[1].date).toBeNull();
    expect(page.nextPage).toBeNull();
    expect(parseRdEventPage({ data: Array(10).fill({}) }, "CONVERSION", 3).nextPage).toBe(4);
    const unknown = parseRdEventPage({ history: raw }, "CONVERSION", 1);
    expect(unknown.recognized).toBe(false);
    expect(unknown.raw).toEqual({ history: raw });
  });
  test("erros do provedor não expõem resposta sensível e redirecionamentos são bloqueados", async () => {
    let redirect: RequestRedirect | undefined;
    const mockFetch = (async (_url: unknown, init: RequestInit) => {
      redirect = init.redirect;
      return new Response("client_secret=hidden", { status: 401 });
    }) as typeof fetch;
    await expect(rdRequest("/auth/token", { method: "POST" }, mockFetch)).rejects.toMatchObject({
      code: "RD_HTTP_401",
    });
    expect(redirect).toBe("error");
    await expect(
      rdRequest("/platform/contacts/x", {}, (async () => {
        throw new Error("secret");
      }) as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: "RD_UNAVAILABLE" });
    await expect(
      rdRequest(
        "/platform/events",
        { method: "POST" },
        (async () => new Response("client_secret=hidden", { status: 422 })) as typeof fetch,
      ),
    ).rejects.toMatchObject({ code: "RD_HTTP_422", message: expect.stringContaining("HTTP 422") });
  });
});
