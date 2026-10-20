import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  SITE_CHANNEL,
  SITE_PROVIDER,
  siteIdentityIds,
  isSiteConversationId,
  visitorIdFromSiteConversation,
  parseSiteChannelSettings,
  isSiteOriginAllowed,
  sanitizeSiteIdentity,
  clampSiteText,
} from "../src/lib/livechat/site-channel-policy.ts";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("canal Site no núcleo industrial — regras puras", () => {
  it("usa o canal livechat já reconhecido pela UI e pelo Supervisor", () => {
    assert.equal(SITE_CHANNEL, "livechat");
    assert.equal(SITE_PROVIDER, "livechat");
  });

  it("gera IDs determinísticos e reversíveis por visitante", () => {
    const ids = siteIdentityIds("3f1c2a9e-1111-4b2c-9d7e-000000000001");
    assert.equal(ids.contactId, "cont-lc-3f1c2a9e-1111-4b2c-9d7e-000000000001");
    assert.equal(ids.conversationId, "conv-lc-3f1c2a9e-1111-4b2c-9d7e-000000000001");
    assert.equal(isSiteConversationId(ids.conversationId), true);
    assert.equal(visitorIdFromSiteConversation(ids.conversationId), "3f1c2a9e-1111-4b2c-9d7e-000000000001");
  });

  it("conversas WhatsApp nunca são tratadas como site", () => {
    for (const id of ["conv-1729430000000-ab12", "conv-lcx-1", "", null, undefined, "lc-123"]) {
      assert.equal(isSiteConversationId(id), false, String(id));
    }
    assert.equal(visitorIdFromSiteConversation("conv-123"), null);
  });

  it("rejeita identificador de visitante com caracteres inseguros", () => {
    assert.throws(() => siteIdentityIds("../etc"));
    assert.throws(() => siteIdentityIds("a b"));
    assert.throws(() => siteIdentityIds(""));
    assert.equal(visitorIdFromSiteConversation("conv-lc-a;drop"), null);
  });

  it("canal desligado por padrão; precisa SDR habilitado E siteChannelEnabled === true", () => {
    assert.equal(parseSiteChannelSettings(true, {}).enabled, false);
    assert.equal(parseSiteChannelSettings(true, null).enabled, false);
    assert.equal(parseSiteChannelSettings(true, { siteChannelEnabled: "true" }).enabled, false);
    assert.equal(parseSiteChannelSettings(false, { siteChannelEnabled: true }).enabled, false);
    assert.equal(parseSiteChannelSettings(true, { siteChannelEnabled: true }).enabled, true);
  });

  it("normaliza origens autorizadas e descarta valores inválidos", () => {
    const settings = parseSiteChannelSettings(true, {
      siteChannelEnabled: true,
      siteAllowedOrigins: ["https://www.Tecfag.com.br/", "https://www.tecfag.com.br", "javascript:alert(1)", 42, "nao-e-url"],
    });
    assert.deepEqual(settings.allowedOrigins, ["https://www.tecfag.com.br"]);
  });

  it("aplica a lista de origens somente quando configurada", () => {
    assert.equal(isSiteOriginAllowed(undefined, []), true);
    assert.equal(isSiteOriginAllowed("https://www.tecfag.com.br", ["https://www.tecfag.com.br"]), true);
    assert.equal(isSiteOriginAllowed("https://www.tecfag.com.br:443", ["https://www.tecfag.com.br"]), true);
    assert.equal(isSiteOriginAllowed("https://evil.example", ["https://www.tecfag.com.br"]), false);
    assert.equal(isSiteOriginAllowed("https://tecfag.com.br.evil.example", ["https://tecfag.com.br"]), false);
    assert.equal(isSiteOriginAllowed(undefined, ["https://www.tecfag.com.br"]), false);
  });

  it("pré-chat guarda documento só com dígitos verificadores válidos", () => {
    assert.deepEqual(sanitizeSiteIdentity("  Maria   Souza ", "529.982.247-25"), {
      name: "Maria Souza",
      cpf: "52998224725",
      cnpj: null,
    });
    assert.deepEqual(sanitizeSiteIdentity("ACME", "11.222.333/0001-81"), {
      name: "ACME",
      cpf: null,
      cnpj: "11222333000181",
    });
    assert.deepEqual(sanitizeSiteIdentity("X", "111.111.111-11"), { name: "", cpf: null, cnpj: null });
    assert.deepEqual(sanitizeSiteIdentity(null, 123), { name: "", cpf: null, cnpj: null });
  });

  it("limita texto livre do visitante", () => {
    assert.equal(clampSiteText("a".repeat(5000)).length, 4000);
    assert.equal(clampSiteText({}), "");
    assert.equal(clampSiteText("  oi  "), "oi");
  });
});

describe("canal Site — contratos de integração (inspeção de código)", () => {
  const ws = read("src/lib/livechat/livechatWs.ts");
  const engine = read("src/lib/valentina/sdr-engine.ts");
  const sender = read("src/lib/valentina/sdr-channel-sender.ts");
  const store = read("src/lib/triage/industrial-handoff-store.ts");
  const sendRoute = read("src/routes/api/whatsapp/send.ts");
  const adapter = read("src/lib/livechat/site-industrial-adapter.ts");

  it("WebSocket recusa tenant desconhecido e exige gate/origem no perfil industrial", () => {
    assert.match(ws, /if \(!isSdrTenant\(tenantId\)\)/);
    assert.match(ws, /loadSiteChannelSettings\(tenantId\)/);
    assert.match(ws, /isSiteOriginAllowed\(req\.headers\.origin/);
  });

  it("Valem mantém a Valentina do site; perfil industrial não usa a saudação proativa nem o LiveChatDebouncer", () => {
    assert.match(ws, /if \(!industrial && \(!chat\.status \|\| chat\.status === "active"\)\)/);
    assert.match(ws, /LiveChatDebouncer\.getInstance\(\)\.pushIncomingMessage/);
    assert.match(ws, /if \(conn\.industrial\) \{\s*await handleIndustrialSiteMessage/);
  });

  it("ações do operador no WS validam o chat no tenant e usam o visitante do banco", () => {
    assert.match(ws, /getChatById\(tenantId, chatId\)/);
    assert.match(ws, /visitorId = ownedChat\.visitorId/);
    assert.match(ws, /USE_CONVERSATIONS/);
  });

  it("adaptador usa o mesmo SdrDebouncer do WhatsApp e respeita a trava de operador", () => {
    assert.match(adapter, /SdrDebouncer\.getInstance\(\)\.pushIncomingMessage/);
    assert.match(adapter, /!current\.operatorId && current\.queueState === "automacao"/);
    assert.doesNotMatch(adapter, /"valem"|"tecfag"/);
  });

  it("SdrEngine e presença desviam para o widget somente em conversas do site", () => {
    assert.match(engine, /isSiteConversationId\(conversationId\) && getAiPersona\(tenantId\)\.triagePolicy === "industrial"/);
    assert.match(engine, /private async sendSiteBotMessages/);
    assert.match(sender, /if \(isSiteConversationId\(conversationId\)\) \{\s*await pushSiteTyping/);
  });

  it("handoff do site exige canal habilitado e não depende da whitelist de telefone", () => {
    assert.match(store, /siteContact && settings\.siteChannelEnabled !== true/);
    assert.match(store, /!siteContact && settings\.whitelistEnabled === true/);
  });

  it("rota de envio do operador entrega texto ao site após as validações de posse e card", () => {
    const siteIdx = sendRoute.indexOf("targetContact?.mainChannel === SITE_CHANNEL");
    assert.ok(siteIdx > sendRoute.indexOf("conv.operatorId !== session.operator.id"));
    assert.ok(siteIdx > sendRoute.indexOf("DEAL_REQUIRED"));
    assert.match(sendRoute, /SITE_TEXT_ONLY/);
  });

  it("rota do canal exige admin e perfil industrial, sem criar ou ativar o SDR", () => {
    const route = read("src/routes/api/valentina/site-channel.ts");
    assert.match(route, /requireSession\(request\)/);
    assert.match(route, /operator\.role !== "admin"/);
    assert.match(route, /triagePolicy !== "industrial"/);
    assert.match(route, /if \(!row\) return json\(/);
    assert.doesNotMatch(route, /insert\(agentConfigs\)/);
    assert.doesNotMatch(route, /enabled: 1/);
  });
});

describe("widget do site por marca", () => {
  const widget = read("valem-widget/src/widget.ts");
  const brandBlock = (tenant) => {
    const start = widget.indexOf(`  ${tenant}: {`);
    return widget.slice(start, widget.indexOf("\n  },", start));
  };

  it("Valem preserva textos, chave de armazenamento e saudação local atuais", () => {
    const valem = brandBlock("valem");
    assert.match(valem, /aiName: "Valentina"/);
    assert.match(valem, /welcomeIntro: "Eu sou a Valentina, da Valem Válvulas e Embalagens\."/);
    assert.match(valem, /storagePrefix: "valem"/);
    assert.match(valem, /requireDoc: true/);
  });

  it("Tecfag usa o Fagner, sem nome/número da Valem e sem saudação local duplicada", () => {
    const tecfag = brandBlock("tecfag");
    assert.match(tecfag, /aiName: "Fagner"/);
    assert.match(tecfag, /welcomeIntro: null/);
    assert.match(tecfag, /defaultWhatsapp: ""/);
    assert.match(tecfag, /requireDoc: false/);
    assert.doesNotMatch(tecfag, /Valentina|Valem/);
  });

  it("template não contém mais o nome da persona fixo", () => {
    const template = widget.slice(widget.indexOf("private renderHTML()"), widget.indexOf("private bindEvents()"));
    assert.doesNotMatch(template, /Valentina|Valem/);
  });
});
