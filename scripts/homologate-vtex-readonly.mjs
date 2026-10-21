// Node não lê .env. Este roteiro só permite catálogo público e simulação anônima, sem banco/IA/transporte.
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { queryVtex } from "../src/lib/vtex/client.ts";
import { defaultVtexSettings, vtexSettingsSchema } from "../src/lib/vtex/contract.ts";
import { formatVtexAnswer } from "../src/lib/vtex/turn.ts";
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
for (const key of ["--account", "--storefront", "--sku", "--postal-code", "--output"])
  if (!args.get(key)) throw new Error(`Parâmetro obrigatório: ${key}`);
const settings = vtexSettingsSchema.parse({
  ...defaultVtexSettings(),
  account: args.get("--account"),
  storefrontOrigin: args.get("--storefront"),
});
const requests = [],
  scenarios = [];
const guardedFetch = async (raw, options = {}) => {
  const url = new URL(String(raw)),
    method = options.method || "GET";
  assert.equal(url.origin, `https://${settings.account}.vtexcommercestable.com.br`);
  assert.ok(
    (method === "GET" && url.pathname.startsWith("/api/catalog_system/pub/products/search")) ||
      (method === "POST" && url.pathname === "/api/checkout/pub/orderForms/simulation"),
  );
  assert.ok(
    !Object.keys(options.headers || {}).some((name) =>
      /token|key|cookie|authorization/i.test(name),
    ),
  );
  const response = await fetch(url, options);
  requests.push({ method, path: url.pathname, status: response.status });
  return response;
};
const skuQuery = { kind: "sku", value: args.get("--sku"), quantity: 1 };
const price = await queryVtex(settings, skuQuery, "livechat", {
  fetch: guardedFetch,
  intent: "price",
});
assert.equal(price.status, "matched");
assert.equal(price.selectedSkuId, args.get("--sku"));
scenarios.push({
  name: "preço público por SKU",
  status: "passed",
  result: price,
  answer: formatVtexAnswer(price, "price"),
});
const shipping = await queryVtex(
  settings,
  { ...skuQuery, postalCode: args.get("--postal-code") },
  "livechat",
  { fetch: guardedFetch, intent: "shipping", shippingRequested: true },
);
assert.equal(shipping.status, "matched");
assert.ok(["available", "unavailable"].includes(shipping.shippingStatus));
scenarios.push({
  name: "simulação pública de frete",
  status: "passed",
  result: shipping,
  answer: formatVtexAnswer(shipping, "shipping"),
});
const before = requests.length;
const blocked = await queryVtex(settings, skuQuery, "whatsapp", {
  fetch: guardedFetch,
  intent: "price",
});
assert.equal(blocked.status, "policy_blocked");
assert.equal(requests.length, before);
scenarios.push({ name: "preço bloqueado no WhatsApp sem consulta externa", status: "passed" });
const specs = await queryVtex(settings, skuQuery, "whatsapp", {
  fetch: guardedFetch,
  intent: "details",
});
assert.equal(specs.status, "matched");
assert.ok(
  specs.products.every((product) =>
    product.skus.every((sku) => sku.priceCents === null && sku.available === null),
  ),
);
scenarios.push({
  name: "especificações no WhatsApp sem preço e estoque",
  status: "passed",
  answer: formatVtexAnswer(specs, "details"),
});
if (args.get("--variants-url")) {
  const variants = await queryVtex(
    settings,
    { kind: "url", value: args.get("--variants-url"), quantity: 1 },
    "livechat",
    { fetch: guardedFetch, intent: "price" },
  );
  assert.equal(variants.status, "choices");
  assert.equal(variants.selectedSkuId, null);
  scenarios.push({
    name: "produto com variantes exige escolha",
    status: "passed",
    answer: formatVtexAnswer(variants, "price"),
  });
}
const report = {
  testedAt: new Date().toISOString(),
  account: settings.account,
  storefront: settings.storefrontOrigin,
  salesChannel: settings.salesChannel,
  sellerId: settings.sellerId,
  postalCodeFixture: args.get("--postal-code"),
  operationalConfigurationChanged: false,
  applicationDatabaseAccessed: false,
  credentialsUsed: false,
  orderOrCartCreated: false,
  requests,
  scenarios,
};
await fs.writeFile(args.get("--output"), JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    passed: scenarios.length,
    requests: requests.length,
    shippingStatus: shipping.shippingStatus,
    report: args.get("--output"),
  }),
);
