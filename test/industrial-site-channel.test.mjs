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
  generateContinuityCode,
  extractContinuityCode,
  hashContinuityCode,
  normalizeWhatsappNumber,
  buildContinuationUrl,
  stripHandoffState,
  CONTINUITY_TTL_MS,
  isUsableContinuityRecord,
} from "../src/lib/livechat/site-channel-policy.ts";
import crypto from "node:crypto";

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

describe("continuidade site → WhatsApp (E4)", () => {
  const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");

  it("código só é utilizável antes do vencimento e com prazo válido", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    assert.equal(isUsableContinuityRecord({ expiresAt: new Date(now + 1).toISOString() }, now), true);
    for (const expiresAt of [undefined, null, "", "inválido", 42, new Date(now).toISOString(), new Date(now - 1).toISOString()])
      assert.equal(isUsableContinuityRecord({ expiresAt }, now), false, String(expiresAt));
    for (const record of [null, undefined, [], false, "texto"])
      assert.equal(isUsableContinuityRecord(record, now), false);
  });

  it("código consumido ou registro corrompido não pode ser reutilizado", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    const valid = { expiresAt: new Date(now + CONTINUITY_TTL_MS).toISOString() };
    assert.equal(isUsableContinuityRecord({ ...valid, usedAt: null }, now), true);
    for (const usedAt of ["2026-10-20T11:59:00Z", "", false, 0])
      assert.equal(isUsableContinuityRecord({ ...valid, usedAt }, now), false);
    assert.equal(isUsableContinuityRecord(valid, NaN), false);
  });

  it("gera código legível, sem caracteres ambíguos, e o reconhece em mensagem livre", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateContinuityCode((n) => crypto.randomBytes(n));
      assert.match(code, /^SITE-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
      assert.equal(extractContinuityCode(`Olá! quero continuar. Código: ${code}`), code);
      assert.equal(extractContinuityCode(code.toLowerCase().replace(/-/g, " ")), code);
    }
  });

  it("não confunde texto comum com código", () => {
    for (const text of ["visitei o site ontem", "SITE-ABCD", "SITE-ABCD-EF0I", "", null, 42, "x".repeat(3000) + "SITE-ABCD-EFGH"])
      assert.equal(extractContinuityCode(text), null, String(text).slice(0, 30));
  });

  it("hash depende do tenant: código de uma empresa não vale na outra", () => {
    const code = "SITE-ABCD-EFGH";
    assert.notEqual(hashContinuityCode("tecfag", code, sha), hashContinuityCode("valem", code, sha));
    assert.equal(hashContinuityCode("tecfag", code, sha), hashContinuityCode("tecfag", code.toLowerCase(), sha));
    assert.equal(CONTINUITY_TTL_MS, 30 * 60 * 1000);
  });

  it("normaliza o WhatsApp da empresa e monta link wa.me com o código", () => {
    assert.equal(normalizeWhatsappNumber("+55 (14) 99999-8888"), "5514999998888");
    assert.equal(normalizeWhatsappNumber("123"), "");
    assert.equal(normalizeWhatsappNumber(undefined), "");
    const url = buildContinuationUrl("5514999998888", "SITE-ABCD-EFGH", "Grupo Tecfag");
    assert.match(url, /^https:\/\/wa\.me\/5514999998888\?text=/);
    assert.ok(decodeURIComponent(url).includes("SITE-ABCD-EFGH"));
    assert.ok(decodeURIComponent(url).includes("Grupo Tecfag"));
  });

  it("dados copiados não carregam checkpoint, recibo ou responsável do ciclo anterior", () => {
    const meta = stripHandoffState({
      subflow: "MAQUINAS",
      funnelStage: "maquinas",
      handoffRequest: { a: 1 },
      handoffReceipt: { b: 2 },
      handoffAttempts: 3,
      readyForHandoff: true,
      allocatedOperatorId: "op-1",
      localCrmDealId: "deal-1",
      previousTriages: [1],
    });
    assert.deepEqual(meta, { subflow: "MAQUINAS", funnelStage: "maquinas" });
  });

  it("configuração lê o número de WhatsApp do canal", () => {
    assert.equal(parseSiteChannelSettings(true, { siteWhatsappNumber: "5514999998888" }).whatsappNumber, "5514999998888");
    assert.equal(parseSiteChannelSettings(true, {}).whatsappNumber, "");
  });

  const continuity = read("src/lib/livechat/site-continuity.ts") + read("src/lib/livechat/site-continuity-store.ts");
  const inbound = read("src/lib/whatsapp/inbound.ts");
  const baileys = read("src/lib/baileys/session-manager.ts");
  const ws = read("src/lib/livechat/livechatWs.ts");
  const widget = read("valem-widget/src/widget.ts");

  it("vínculo é transacional, por tenant, de uso único e com prazo", () => {
    assert.match(continuity, /database\.transaction\(/);
    assert.match(continuity, /pg_advisory_xact_lock/);
    assert.match(continuity, /eq\(contacts\.tenantId, tenantId\)/);
    assert.match(continuity, /isUsableContinuityRecord\(continuity\)/);
    assert.match(continuity, /usedAt: now\.toISOString\(\)/);
    assert.doesNotMatch(continuity, /"valem"|"tecfag"/);
  });

  it("com responsável no site, WhatsApp vai ao mesmo operador sem rodízio e herda o card", () => {
    assert.match(continuity, /siteOwner && !waHasOwner/);
    assert.match(continuity, /isNull\(conversations\.operatorId\)/);
    assert.match(continuity, /insert\(crmConversationDeals\)/);
    assert.doesNotMatch(continuity, /allocateNextOperator|RodizioEngine/);
  });

  it("sem responsável, a IA continua a mesma triagem com os dados coletados e sem nova saudação", () => {
    assert.match(continuity, /collectedData: \(siteFlow\?\.collectedData/);
    assert.match(continuity, /stripHandoffState\(siteMeta\)/);
    assert.match(continuity, /lcx-\$\{sha256Hex/);
  });

  it("entradas do WhatsApp (Meta e Baileys) só vinculam no perfil industrial", () => {
    assert.match(inbound, /triagePolicy === "industrial"\) \{\s*const \{ linkSiteContinuity \}/);
    assert.match(inbound, /link\?\.linked && link\.mode === "operator"\) return;/);
    assert.match(baileys, /getAiPersona\(tenantId\)\.triagePolicy === "industrial"/);
    assert.match(baileys, /setTimeout\(\(\) => \{\s*import\("\.\.\/livechat\/site-continuity"\)/);
  });

  it("widget pede o código só no perfil com continuidade; Valem mantém link estático", () => {
    assert.match(ws, /type === "request_whatsapp_continuation" && conn\.industrial/);
    assert.match(widget, /serverContinuity: false,\s*\},\s*tecfag/);
    assert.match(widget, /serverContinuity: true,/);
    assert.match(widget, /\^https:\\\/\\\/wa\\\.me\\\/\\d\{10,15\}\\\?text=/);
  });
});
