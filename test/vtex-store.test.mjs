import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as contract from "../src/lib/vtex/contract.ts";
import * as turn from "../src/lib/vtex/turn.ts";
import { queryVtex } from "../src/lib/vtex/client.ts";
import {
  encryptVtexCredentials,
  decryptVtexCredentials,
  vtexEncryptionReady,
} from "../src/lib/vtex/crypto.ts";
import { captureSiteContext } from "../src/lib/livechat/site-context.ts";
import * as jsxRuntime from "react/jsx-runtime";
const config = () => ({
  ...contract.defaultVtexSettings(),
  account: "fixture-store",
  storefrontOrigin: "https://shop.example.test",
  enabled: true,
});
const product = (variants = false) => ({
  productId: "10",
  productName: "Seladora S100",
  linkText: "seladora-s100",
  description: "<script>bad()</script><p>Seladora de bancada.</p>",
  allSpecifications: ["Potência"],
  Potência: ["500 W"],
  items: (variants ? ["147", "148"] : ["147"]).map((id) => ({
    itemId: id,
    name: id === "147" ? "110 V" : "220 V",
    referenceId: [{ Key: "RefId", Value: "S100" }],
    sellers: [{ sellerId: "1", commertialOffer: { Price: 123.45, AvailableQuantity: 10 } }],
  })),
});
const sku = { kind: "sku", value: "147", quantity: 1 };
function fixtureFetch(catalog = [product()], simulation) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url: String(url), ...options });
    if (options.method === "POST")
      return Response.json(
        simulation || {
          items: [
            { id: "147", seller: "1", quantity: 1, availability: "available", sellingPrice: 12345 },
          ],
          logisticsInfo: [
            {
              itemIndex: 0,
              slas: [
                {
                  id: "normal",
                  name: "Normal",
                  price: 1570,
                  shippingEstimate: "3bd",
                  deliveryChannel: "delivery",
                },
              ],
            },
          ],
        },
      );
    return Response.json(catalog);
  };
  return { calls, fetch };
}
function load(file, dependencies, globals = {}) {
  const source = ts.transpileModule(
    fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    URL,
    Response,
    Request,
    AbortSignal,
    AbortController,
    console,
    ...globals,
    require(name) {
      if (!(name in dependencies)) throw new Error(`Import não permitido: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
}
describe("VTEX: catálogo, vendedor, variante e valores públicos", () => {
  it("confirma SKU com dados oficiais e converte preço decimal para centavos", async () => {
    const transport = fixtureFetch(),
      result = await queryVtex(config(), sku, "livechat", transport);
    assert.equal(result.status, "matched");
    assert.equal(result.selectedSkuId, "147");
    assert.equal(result.products[0].skus[0].priceCents, 12345);
    assert.equal(result.products[0].description, "Seladora de bancada.");
    assert.equal(new URL(transport.calls[0].url).searchParams.get("fq"), "skuId:147");
    assert.equal(transport.calls[0].redirect, "error");
  });
  it("produto com duas variantes exige escolha, sem preço ou SKU escolhido arbitrariamente", async () => {
    const transport = fixtureFetch([product(true)]);
    const result = await queryVtex(
      config(),
      { kind: "url", value: "https://shop.example.test/seladora-s100/p", quantity: 1 },
      "livechat",
      transport,
    );
    assert.equal(result.status, "choices");
    assert.equal(result.selectedSkuId, null);
    const answer = turn.formatVtexAnswer(result, "price").join(" ");
    assert.match(answer, /110 V.*SKU 147/);
    assert.match(answer, /220 V.*SKU 148/);
    assert.doesNotMatch(answer, /R\$/);
  });
  it("busca textual apresenta opções mesmo com uma única correspondência", async () => {
    const result = await queryVtex(
      config(),
      { kind: "term", value: "seladora", quantity: 1 },
      "livechat",
      fixtureFetch(),
    );
    assert.equal(result.status, "choices");
    assert.equal(result.selectedSkuId, null);
  });
  it("SKU incompatível com URL não usa a primeira variante", async () => {
    const result = await queryVtex(
      config(),
      {
        kind: "url",
        value: "https://shop.example.test/seladora-s100/p",
        skuId: "999",
        quantity: 1,
      },
      "livechat",
      fixtureFetch(),
    );
    assert.equal(result.status, "not_found");
  });
  it("vendedor não configurado não fornece preço ou estoque", async () => {
    const settings = { ...config(), sellerId: "other" },
      result = await queryVtex(settings, sku, "livechat", fixtureFetch());
    assert.equal(result.products[0].skus[0].priceCents, null);
    assert.equal(result.products[0].skus[0].available, null);
  });
  for (const value of [0, -1, "123.45", null])
    it(`preço não confirmado ${JSON.stringify(value)} não vira oferta`, async () => {
      const raw = product();
      raw.items[0].sellers[0].commertialOffer.Price = value;
      const result = await queryVtex(config(), sku, "livechat", fixtureFetch([raw]));
      assert.equal(result.products[0].skus[0].priceCents, null);
    });
  it("não interpreta referência ausente na loja como produto indisponível definitivo", async () => {
    const result = await queryVtex(config(), sku, "livechat", fixtureFetch([]));
    assert.equal(result.status, "not_found");
    assert.match(turn.formatVtexAnswer(result, "price")[0], /Não localizei/);
  });
});
describe("VTEX: frete somente por simulação anônima", () => {
  it("envia SKU, vendedor, canal, quantidade e CEP sem criar carrinho ou expor credenciais", async () => {
    const transport = fixtureFetch();
    const result = await queryVtex(
      { ...config(), useCredentials: true },
      { ...sku, postalCode: "01001-000" },
      "livechat",
      {
        ...transport,
        shippingRequested: true,
        credentials: { appKey: "test-key", appToken: "test-token" },
      },
    );
    assert.equal(result.shippingStatus, "available");
    assert.equal(result.shipping[0].priceCents, 1570);
    assert.equal(transport.calls.length, 2);
    const simulation = transport.calls[1];
    assert.equal(new URL(simulation.url).pathname, "/api/checkout/pub/orderForms/simulation");
    assert.deepEqual(JSON.parse(simulation.body), {
      items: [{ id: "147", seller: "1", quantity: 1 }],
      postalCode: "01001000",
      country: "BRA",
    });
    assert.ok(!JSON.stringify(simulation.headers).includes("test-token"));
    assert.match(turn.formatVtexAnswer(result, "shipping")[0], /3 dias úteis/);
  });
  it("sem CEP não tenta simular entrega", async () => {
    const transport = fixtureFetch(),
      result = await queryVtex(config(), sku, "livechat", {
        ...transport,
        shippingRequested: true,
      });
    assert.equal(result.shippingStatus, "needs_postal_code");
    assert.equal(transport.calls.length, 1);
  });
  it("sem variante escolhida não simula frete", async () => {
    const transport = fixtureFetch([product(true)]),
      result = await queryVtex(
        config(),
        {
          kind: "url",
          value: "https://shop.example.test/seladora-s100/p",
          quantity: 1,
          postalCode: "01001000",
        },
        "livechat",
        transport,
      );
    assert.equal(result.shippingStatus, "needs_sku");
    assert.equal(transport.calls.length, 1);
  });
  it("erro no frete preserva especificações e não inventa prazo ou gratuidade", async () => {
    const transport = fixtureFetch([product()], {
      items: [{ id: "147", seller: "1", quantity: 1, availability: "cannotBeDelivered" }],
    });
    const result = await queryVtex(
      config(),
      { ...sku, postalCode: "01001000" },
      "livechat",
      transport,
    );
    assert.equal(result.status, "matched");
    assert.equal(result.shippingStatus, "unavailable");
    assert.deepEqual(result.shipping, []);
    assert.doesNotMatch(turn.formatVtexAnswer(result, "shipping")[0], /grátis|3 dias/);
  });
});
describe("VTEX: política de canal, origem e falhas", () => {
  for (const intent of ["price", "shipping"])
    it(`WhatsApp bloqueia ${intent} antes da consulta`, async () => {
      const transport = fixtureFetch(),
        result = await queryVtex(config(), sku, "whatsapp", { ...transport, intent });
      assert.equal(result.status, "policy_blocked");
      assert.equal(transport.calls.length, 0);
    });
  it("WhatsApp remove valores comerciais até de descrições e especificações", async () => {
    const raw = product();
    raw.description = "Oferta R$ 10 com frete grátis";
    raw.allSpecifications.push("Condição");
    raw.Condição = ["Valor R$ 10"];
    const result = await queryVtex(config(), sku, "whatsapp", fixtureFetch([raw]));
    assert.equal(result.products[0].description, "");
    assert.equal(result.products[0].specifications.Condição, undefined);
    assert.equal(result.products[0].skus[0].priceCents, null);
    assert.equal(result.products[0].skus[0].available, null);
    assert.doesNotMatch(turn.formatVtexAnswer(result, "details")[0], /R\$|frete grátis/);
  });
  for (const value of [
    "https://evil.example/p",
    "http://shop.example.test/seladora-s100/p",
    "https://user:pass@shop.example.test/seladora-s100/p",
    "https://shop.example.test/checkout",
  ])
    it(`URL inválida não gera chamada: ${value}`, async () => {
      const transport = fixtureFetch(),
        result = await queryVtex(
          config(),
          { kind: "url", value, quantity: 1 },
          "livechat",
          transport,
        );
      assert.equal(result.status, "unavailable");
      assert.equal(transport.calls.length, 0);
    });
  for (const [fetch, diagnostic] of [
    [async () => new Response("private error", { status: 429 }), "rate_limited"],
    [async () => new Response("token=secret", { status: 500 }), "upstream_error"],
    [async () => Response.json({ invalid: true }), "invalid_response"],
    [
      async () => {
        throw new DOMException("timeout", "TimeoutError");
      },
      "timeout",
    ],
  ])
    it(`falha controlada: ${diagnostic}`, async () => {
      const result = await queryVtex(config(), sku, "livechat", { fetch });
      assert.equal(result.status, "unavailable");
      assert.equal(result.diagnostic, diagnostic);
      assert.doesNotMatch(JSON.stringify(result), /token=secret|private error/);
    });
  it("resposta excessiva é recusada", async () => {
    const result = await queryVtex(config(), sku, "livechat", {
      fetch: async () => new Response("[]", { headers: { "content-length": "3000000" } }),
    });
    assert.equal(result.diagnostic, "invalid_response");
  });
  it("não aceita conta como endereço arbitrário nem parâmetros de autoridade", () => {
    assert.equal(
      contract.vtexSettingsSchema.safeParse({ ...config(), account: "127.0.0.1/api" }).success,
      false,
    );
    assert.equal(
      contract.vtexSettingsSchema.safeParse({ ...config(), tenantId: "other" }).success,
      false,
    );
  });
});
describe("VTEX: intenção atual e resposta controlada", () => {
  const context = captureSiteContext(
    {
      page: { url: "https://shop.example.test/seladora-s100/p" },
      product: { url: "https://shop.example.test/seladora-s100/p", name: "Seladora S100" },
    },
    "https://shop.example.test",
    new Date(),
    true,
  );
  it("consulta explícita usa o produto, mas pedido de humano e suporte têm precedência", () => {
    assert.equal(
      turn.deriveVtexQuery("Gostaria de informações sobre Seladora S100.", context).query.kind,
      "url",
    );
    for (const text of [
      "Quero falar com um humano",
      "Preciso de manutenção na seladora",
      "Quero a nota fiscal do pedido",
    ])
      assert.equal(turn.deriveVtexQuery(text, context), null);
  });
  it("consulta disponibilidade e aceita escolha numérica somente após opções da loja", () => {
    const available = turn.deriveVtexQuery("Este produto está disponível?", context, {
      selectedSkuId: "147",
    });
    assert.equal(available.query.value, "147");
    assert.equal(available.intent, "details");
    assert.equal(turn.deriveVtexQuery("148", null, { status: "choices" }).query.value, "148");
    assert.equal(turn.deriveVtexQuery("148", null), null);
  });
  it("afirmação generativa de estoque exige confirmação oficial", () => {
    const invented = "Temos o produto disponível em estoque";
    assert.notEqual(turn.guardVtexMessages([invented])[0], invented);
    assert.equal(turn.guardVtexMessages([invented], [invented])[0], invented);
  });
  it("SKU explícito prevalece sobre consulta anterior e CEP continua o SKU confirmado", () => {
    assert.equal(
      turn.deriveVtexQuery("Qual preço do SKU 148?", context, { selectedSkuId: "147" }).query.value,
      "148",
    );
    const result = turn.deriveVtexQuery("01001-000", context, { selectedSkuId: "147" });
    assert.equal(result.intent, "shipping");
    assert.equal(result.query.value, "147");
  });
  it("produto novo nomeado não recebe preço do produto anterior", () => {
    const value = turn.deriveVtexQuery("Qual o preço da envasadora X200?", context, {
      selectedSkuId: "147",
    });
    assert.equal(value.query.kind, "term");
    assert.equal(value.query.value, "envasadora X200");
    assert.equal(
      turn.deriveVtexQuery("Quero outro produto, qual o preço?", null, { selectedSkuId: "147" })
        .query,
      null,
    );
  });
  it("mensagem generativa não pode criar preço, frete grátis ou prazo", () => {
    const output = turn.guardVtexMessages([
      "Custa R$ 99",
      "Entrega em 2 dias",
      "Frete grátis",
      "Qual o seu nome?",
    ]);
    assert.equal(output.length, 2);
    assert.ok(output.includes("Qual o seu nome?"));
    assert.deepEqual(turn.guardVtexMessages(["Custa R$ 99"], ["Custa R$ 99"]), ["Custa R$ 99"]);
  });
  it("evidência não guarda CEP, valores, credenciais ou conteúdo bruto", async () => {
    const evidence = turn.safeVtexEvidence(
      await queryVtex(config(), sku, "livechat", fixtureFetch()),
    );
    assert.equal(contract.readVtexEvidence(evidence).selectedSkuId, "147");
    assert.doesNotMatch(JSON.stringify(evidence), /priceCents|appToken|postalCode/);
  });
});
describe("VTEX: credenciais criptografadas", () => {
  it("isola a credencial por tenant e conta e recusa adulteração", () => {
    const previous = process.env.VTEX_CREDENTIALS_ENCRYPTION_KEY;
    process.env.VTEX_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    try {
      assert.equal(vtexEncryptionReady(), true);
      const value = { appKey: "fake-key", appToken: "fake-token" },
        encrypted = encryptVtexCredentials("fixture", "store", value);
      assert.ok(!encrypted.includes("fake-token"));
      assert.deepEqual(decryptVtexCredentials("fixture", "store", encrypted), value);
      assert.throws(() => decryptVtexCredentials("other", "store", encrypted));
      assert.throws(() => decryptVtexCredentials("fixture", "other", encrypted));
      assert.throws(() => decryptVtexCredentials("fixture", "store", encrypted + "x"));
    } finally {
      if (previous === undefined) delete process.env.VTEX_CREDENTIALS_ENCRYPTION_KEY;
      else process.env.VTEX_CREDENTIALS_ENCRYPTION_KEY = previous;
    }
  });
});

const storeModule = load("src/lib/vtex/store.ts", {
  "drizzle-orm": {},
  zod: { z },
  "../../db/schema": {},
  "./contract": contract,
  "./crypto": { encryptVtexCredentials, decryptVtexCredentials, vtexEncryptionReady },
});
function routeHarness({
  authenticated = true,
  role = "admin",
  industrial = true,
  conflict = false,
} = {}) {
  let reads = 0,
    saves = 0,
    credentialReads = 0;
  const transport = fixtureFetch();
  const state = { revision: 1, settings: config(), credentialsEncrypted: "private-envelope" };
  const handlers = load("src/routes/api/livechat/vtex-config.ts", {
    "@tanstack/react-router": { createFileRoute: () => (route) => route },
    zod: { z },
    "../../../db": { db: {} },
    "../../../lib/auth-session": {
      requireSession: async () =>
        authenticated
          ? { session: { tenantId: "session-tenant", operator: { id: "actual-admin", role } } }
          : { response: new Response(null, { status: 401 }) },
    },
    "../../../lib/ai-persona": {
      getAiPersona: () => ({ triagePolicy: industrial ? "industrial" : undefined }),
    },
    "../../../lib/vtex/contract": contract,
    "../../../lib/vtex/client": {
      queryVtex: (settings, query, channel, options) =>
        queryVtex(settings, query, channel, { ...options, fetch: transport.fetch }),
    },
    "../../../lib/vtex/store": {
      VtexConfigError: storeModule.VtexConfigError,
      publicVtexConfig: storeModule.publicVtexConfig,
      readVtexConfig: async (_db, tenantId) => {
        assert.equal(tenantId, "session-tenant");
        reads++;
        return state;
      },
      credentialsForVtex: () => {
        credentialReads++;
        return undefined;
      },
      saveVtexConfig: async (_db, tenantId, raw, operatorId) => {
        const body = storeModule.vtexSaveSchema.parse(raw);
        assert.equal(tenantId, "session-tenant");
        assert.equal(operatorId, "actual-admin");
        if (conflict) throw new storeModule.VtexConfigError("Conflito", 409);
        saves++;
        return {
          revision: body.expectedRevision + 1,
          settings: body.settings,
          hasCredentials: true,
        };
      },
    },
  }).Route.server.handlers;
  return {
    transport,
    counts: () => ({ reads, saves, credentialReads }),
    get: () =>
      handlers.GET({
        request: new Request("https://app.example.test/api/livechat/vtex-config?tenantId=other"),
      }),
    post: (body) =>
      handlers.POST({
        request: new Request("https://app.example.test/api/livechat/vtex-config?tenantId=other", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      }),
  };
}
describe("VTEX: API autenticada e teste sem persistência", () => {
  for (const [options, status] of [
    [{ authenticated: false }, 401],
    [{ role: "operator" }, 403],
    [{ industrial: false }, 404],
  ])
    it(`nega leitura e escrita antes do banco: ${status}`, async () => {
      const api = routeHarness(options);
      assert.equal((await api.get()).status, status);
      assert.equal((await api.post({})).status, status);
      assert.deepEqual(api.counts(), { reads: 0, saves: 0, credentialReads: 0 });
    });
  it("GET não devolve segredo e tenant vem da sessão", async () => {
    const api = routeHarness(),
      response = await api.get(),
      body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.hasCredentials, true);
    assert.ok(!JSON.stringify(body).includes("private-envelope"));
    assert.match(response.headers.get("cache-control"), /no-store/);
  });
  it("teste consulta a loja sem salvar nem ativar o atendimento", async () => {
    const api = routeHarness(),
      result = await api.post({
        action: "test",
        settings: { ...config(), enabled: false },
        query: sku,
        channel: "livechat",
        intent: "price",
      });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).result.status, "matched");
    assert.equal(api.counts().saves, 0);
  });
  it("teste bloqueado por canal não descriptografa credenciais nem chama a loja", async () => {
    const api = routeHarness(),
      response = await api.post({
        action: "test",
        settings: config(),
        query: sku,
        channel: "whatsapp",
        intent: "price",
      });
    assert.equal((await response.json()).result.status, "policy_blocked");
    assert.equal(api.counts().credentialReads, 0);
    assert.equal(api.transport.calls.length, 0);
  });
  it("não aceita tenant, operador ou ativação do SDR no body", async () => {
    for (const extra of [{ tenantId: "other" }, { operatorId: "fake" }, { sdrEnabled: true }]) {
      const api = routeHarness(),
        response = await api.post({
          action: "save",
          expectedRevision: 1,
          settings: config(),
          ...extra,
        });
      assert.equal(response.status, 400);
      assert.equal(api.counts().saves, 0);
    }
  });
  it("conflito de revisão impede sobrescrita", async () => {
    const api = routeHarness({ conflict: true });
    assert.equal(
      (await api.post({ action: "save", expectedRevision: 1, settings: config() })).status,
      409,
    );
  });
});

describe("VTEX: isolamento da rota genérica de agentes", () => {
  function genericRoute() {
    let mutations = 0,
      reads = 0;
    const rows = [
      { id: "sdr", agentType: "sdr", config: {} },
      {
        id: "vtex",
        agentType: contract.VTEX_AGENT,
        config: { credentialsEncrypted: "private-envelope" },
      },
    ];
    const handlers = load("src/routes/api/valentina/config.ts", {
      "@tanstack/react-router": { createFileRoute: () => (route) => route },
      "../../../db": {
        db: {
          select: () => ({
            from: () => ({
              where: () => {
                reads++;
                return Object.assign(Promise.resolve(rows), { limit: async () => [rows[1]] });
              },
            }),
          }),
          update: () => {
            mutations++;
            throw new Error("Escrita genérica proibida");
          },
          insert: () => {
            mutations++;
            throw new Error("Escrita genérica proibida");
          },
        },
      },
      "../../../db/schema": { agentConfigs: { id: "id", tenantId: "tenant", agentType: "type" } },
      "drizzle-orm": { eq: (...values) => values, and: (...values) => values },
      "../../../lib/auth-session": {
        requireSession: async () => ({
          session: { tenantId: "fixture", operator: { role: "admin" } },
        }),
      },
      "../../../lib/ai-persona": { getAiPersona: () => ({ triagePolicy: "industrial" }) },
      "../../../lib/vtex/contract": contract,
    }).Route.server.handlers;
    return { handlers, counts: () => ({ reads, mutations }) };
  }
  it("listagem genérica não devolve configuração ou envelope VTEX", async () => {
    const api = genericRoute();
    const response = await api.handlers.GET({
      request: new Request("https://app.example.test/api/valentina/config"),
    });
    const rows = await response.json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].agentType, "sdr");
    assert.doesNotMatch(JSON.stringify(rows), /private-envelope|vtex_store/);
  });
  it("busca direta pela configuração VTEX não consulta nem expõe o registro", async () => {
    const api = genericRoute();
    const response = await api.handlers.GET({
      request: new Request(
        `https://app.example.test/api/valentina/config?agentType=${contract.VTEX_AGENT}`,
      ),
    });
    assert.equal(await response.json(), null);
    assert.equal(api.counts().reads, 0);
  });
  it("bloqueia escrita genérica pelo tipo solicitado ou pelo tipo do registro existente", async () => {
    for (const agentType of [contract.VTEX_AGENT, "sdr"]) {
      const api = genericRoute();
      const response = await api.handlers.POST({
        request: new Request("https://app.example.test/api/valentina/config", {
          method: "POST",
          body: JSON.stringify({ id: "vtex", agentType, config: {} }),
        }),
      });
      assert.equal(response.status, 400);
      assert.equal(api.counts().mutations, 0);
    }
  });
});
describe("VTEX: runtime no núcleo industrial", () => {
  it("desativação não produz consulta nem resposta automática", async () => {
    const transport = fixtureFetch();
    const runtime = load("src/lib/vtex/runtime.ts", {
      "./store": {
        readVtexConfig: async () => ({
          settings: { ...config(), enabled: false },
          row: { enabled: 0 },
        }),
      },
      "./client": { queryVtex },
      "./turn": turn,
    });
    assert.equal(
      await runtime.runVtexStoreTurn({}, "fixture", {
        text: "Qual preço do SKU 147?",
        channel: "livechat",
        siteContext: null,
        fetch: transport.fetch,
      }),
      null,
    );
    assert.equal(transport.calls.length, 0);
  });
  it("consulta responde com fonte atual sem escrever coleta ou pedir geração de IA", async () => {
    const transport = fixtureFetch();
    const runtime = load("src/lib/vtex/runtime.ts", {
      "./store": {
        readVtexConfig: async (_db, tenantId) => {
          assert.equal(tenantId, "fixture");
          return { settings: config(), row: { enabled: 1 } };
        },
        credentialsForVtex: () => undefined,
      },
      "./client": { queryVtex },
      "./turn": turn,
    });
    const result = await runtime.runVtexStoreTurn({}, "fixture", {
      text: "Qual preço do SKU 147?",
      channel: "livechat",
      siteContext: null,
      fetch: transport.fetch,
    });
    assert.match(result.messages[0], /R\$\s*123,45/);
    assert.equal(result.evidence.selectedSkuId, "147");
    assert.equal(result.isCompleted, undefined);
    assert.equal(result.collectedData, undefined);
  });
});

function panelHarness({ role = "admin", loadFails = false, conflict = false } = {}) {
  const states = [],
    effects = [],
    calls = [];
  let cursor = 0,
    mounted = false,
    tree;
  const initial = {
    revision: 0,
    settings: contract.defaultVtexSettings(),
    hasCredentials: false,
    encryptionReady: false,
  };
  const component = load(
    "src/components/chat/VtexStoreCard.tsx",
    {
      react: {
        useState: (initialValue) => {
          const index = cursor++;
          if (!(index in states))
            states[index] = typeof initialValue === "function" ? initialValue() : initialValue;
          return [
            states[index],
            (value) => {
              states[index] = typeof value === "function" ? value(states[index]) : value;
            },
          ];
        },
        useEffect: (effect) => {
          if (!mounted) effects.push(effect);
        },
      },
      "react/jsx-runtime": jsxRuntime,
      "lucide-react": new Proxy({}, { get: () => () => null }),
      "@/hooks/useChatState": { useChat: () => ({ sessionRole: role, tenant: "fixture" }) },
      "@/lib/vtex/contract": contract,
      "@/lib/vtex/turn": turn,
      "@/components/ui/tooltip": { SystemTooltip: ({ children }) => children },
      "@/components/ui/popover": {
        Popover: ({ children }) => children,
        PopoverTrigger: ({ children }) => children,
        PopoverContent: ({ children }) => children,
      },
      "@/components/ui/system-date-time-picker": { SystemDateTimePicker: () => null },
    },
    {
      fetch: async (url, options = {}) => {
        calls.push({ url, ...options });
        if (!options.method)
          return Response.json(loadFails ? { error: "Falha de leitura" } : initial, {
            status: loadFails ? 500 : 200,
          });
        const body = JSON.parse(options.body);
        if (body.action === "save")
          return Response.json(
            conflict
              ? { error: "Recarregue antes de salvar" }
              : { ...initial, revision: 1, settings: body.settings },
            { status: conflict ? 409 : 200 },
          );
        return Response.json({
          result: await queryVtex(config(), sku, body.channel, {
            ...fixtureFetch(),
            intent: body.intent,
          }),
        });
      },
    },
  ).VtexStoreCard;
  const render = () => {
    cursor = 0;
    tree = component({ backendUrl: "" });
    mounted = true;
    return tree;
  };
  function nodes(value) {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap(nodes);
    return [value, ...nodes(value.props?.children)];
  }
  const text = (value) =>
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value.map(text).join(" ")
        : value?.props
          ? text(value.props.children)
          : "";
  const flush = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    render();
  };
  return {
    calls,
    render,
    flush,
    nodes: () => nodes(tree),
    text: () => text(tree),
    mount: async () => {
      render();
      effects.forEach((effect) => effect());
      await flush();
    },
    change: (label, value) => {
      nodes(tree)
        .find((node) => node.type === "input" && node.props["aria-label"] === label)
        .props.onChange({ target: { value } });
      render();
    },
    click: async (label) => {
      nodes(tree)
        .find((node) => node.type === "button" && text(node) === label)
        .props.onClick();
      await flush();
    },
  };
}
describe("VTEX: painel administrativo com componente real e transporte isolado", () => {
  it("operador sem perfil admin não carrega nem mostra integração", async () => {
    const panel = panelHarness({ role: "operator" });
    await panel.mount();
    assert.equal(panel.render(), null);
    assert.equal(panel.calls.length, 0);
  });
  it("carrega política inicial: site público e WhatsApp somente especificações", async () => {
    const panel = panelHarness();
    await panel.mount();
    assert.match(panel.text(), /Loja VTEX/);
    assert.match(panel.text(), /Testar consulta sem salvar/);
    assert.deepEqual(
      panel
        .nodes()
        .filter((node) => node.type === "input" && node.props.type === "checkbox")
        .slice(0, 9)
        .map((node) => node.props.checked),
      [false, true, true, true, true, true, false, false, false],
    );
  });
  it("edita e testa sem salvar; salvar é ação separada com revisão", async () => {
    const panel = panelHarness();
    await panel.mount();
    panel.change("Conta VTEX", "fixture-store");
    panel.change("Domínio da loja VTEX", "https://shop.example.test");
    panel.change("Consulta VTEX", "147");
    await panel.click("Testar consulta VTEX");
    assert.equal(JSON.parse(panel.calls[1].body).action, "test");
    assert.equal(JSON.parse(panel.calls[1].body).settings.enabled, false);
    assert.match(panel.text(), /Consulta de teste concluída sem salvar/);
    assert.ok(
      panel.nodes().some((node) => node.props?.["aria-label"] === "Resultado da consulta VTEX"),
    );
    await panel.click("Salvar integração VTEX");
    assert.equal(JSON.parse(panel.calls[2].body).expectedRevision, 0);
    assert.match(panel.text(), /Integração salva/);
    assert.ok(
      panel
        .nodes()
        .filter((node) => node.props?.type === "password")
        .every((node) => node.props.value === ""),
    );
  });
  it("erro de leitura oferece recuperação sem carregamento infinito", async () => {
    const panel = panelHarness({ loadFails: true });
    await panel.mount();
    assert.match(panel.text(), /Falha de leitura/);
    assert.match(panel.text(), /Reabra a aba/);
    assert.doesNotMatch(panel.text(), /Carregando configuração/);
  });
  it("conflito mantém edição e mostra erro sem sucesso falso", async () => {
    const panel = panelHarness({ conflict: true });
    await panel.mount();
    panel.change("Conta VTEX", "fixture-store");
    await panel.click("Salvar integração VTEX");
    assert.match(panel.text(), /Recarregue antes de salvar/);
    assert.doesNotMatch(panel.text(), /Integração salva/);
    assert.equal(
      panel.nodes().find((node) => node.props?.["aria-label"] === "Conta VTEX").props.value,
      "fixture-store",
    );
  });
});
