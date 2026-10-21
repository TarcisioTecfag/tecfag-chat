import {
  plainText,
  projectVtexForChannel,
  sameStorefront,
  vtexQuerySchema,
  vtexSettingsSchema,
  type VtexSettings,
  type VtexQuery,
  type VtexProduct,
  type VtexSku,
  type VtexResult,
  type VtexChannel,
} from "./contract.ts";

export class VtexError extends Error {
  diagnostic: NonNullable<VtexResult["diagnostic"]>;
  constructor(diagnostic: NonNullable<VtexResult["diagnostic"]>) {
    super(diagnostic);
    this.diagnostic = diagnostic;
  }
}
type Fetcher = typeof fetch;
type Credentials = { appKey: string; appToken: string };
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const rows = (value: unknown) => list(value).map(object);
const cents = (value: unknown, scale = 1) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  Number.isSafeInteger(Math.round(value * scale))
    ? Math.round(value * scale)
    : null;
async function readJson(response: Response) {
  if (response.status === 429) throw new VtexError("rate_limited");
  if (!response.ok) throw new VtexError("upstream_error");
  if (Number(response.headers.get("content-length")) > 2_000_000)
    throw new VtexError("invalid_response");
  if (!response.body) throw new VtexError("invalid_response");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new VtexError("invalid_response");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new VtexError("invalid_response");
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
function productFromApi(raw: unknown, config: VtexSettings): VtexProduct | null {
  const value = object(raw),
    id = plainText(value.productId, 30),
    slug = plainText(value.linkText, 300);
  if (!/^\d+$/.test(id) || !slug || /[/?#\\]/.test(slug)) return null;
  const specifications: Record<string, string> = {};
  for (const key of list(value.allSpecifications).slice(0, 20)) {
    if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key))
      continue;
    const description = list(value[key])
      .map((item) => plainText(item, 300))
      .filter(Boolean)
      .join("; ");
    if (description) specifications[plainText(key, 100)] = description.slice(0, 1000);
  }
  const skus: VtexSku[] = rows(value.items)
    .slice(0, 30)
    .flatMap((item) => {
      if (typeof item.itemId !== "string" || !/^\d{1,20}$/.test(item.itemId)) return [];
      const seller = rows(item.sellers).find((entry) => entry.sellerId === config.sellerId);
      const offer = object(seller?.commertialOffer),
        price = cents(offer.Price, 100);
      return [
        {
          id: String(item.itemId),
          name: plainText(item.name, 200),
          reference: plainText(
            rows(item.referenceId).find((entry) => entry.Key === "RefId")?.Value,
            100,
          ),
          sellerId: seller ? config.sellerId : "",
          priceCents: price && price > 0 ? price : null,
          available:
            typeof offer.AvailableQuantity === "number" && Number.isFinite(offer.AvailableQuantity)
              ? offer.AvailableQuantity > 0
              : null,
        },
      ];
    });
  return {
    id,
    name: plainText(value.productName, 300),
    url: `${config.storefrontOrigin}/${encodeURIComponent(slug)}/p`,
    description: plainText(value.description, 2500),
    specifications,
    skus,
  };
}
/** Somente GET de catálogo e POST de simulação anônima. Não cria nem modifica orderForm/pedido. */
export async function queryVtex(
  settings: VtexSettings,
  input: VtexQuery,
  channel: VtexChannel,
  options: {
    fetch?: Fetcher;
    signal?: AbortSignal;
    credentials?: Credentials;
    now?: Date;
    shippingRequested?: boolean;
    intent?: "price" | "shipping" | "details";
  } = {},
): Promise<VtexResult> {
  const base: VtexResult = {
    status: "not_found",
    source: "vtex",
    checkedAt: (options.now || new Date()).toISOString(),
    channel,
    products: [],
    selectedSkuId: null,
    shipping: [],
    shippingStatus: "not_requested",
    quantity: input.quantity || 1,
  };
  try {
    const config = vtexSettingsSchema.parse(settings),
      query = vtexQuerySchema.parse(input);
    if (!config.channels[channel].catalog) return projectVtexForChannel(base, config);
    if (
      (options.intent === "price" && !config.channels[channel].price) ||
      (options.intent === "shipping" && !config.channels[channel].shipping)
    )
      return { ...base, status: "policy_blocked", shippingStatus: "blocked" };
    const apiOrigin = `https://${config.account}.vtexcommercestable.com.br`;
    const url = new URL("/api/catalog_system/pub/products/search", apiOrigin);
    url.searchParams.set("sc", config.salesChannel);
    url.searchParams.set("_from", "0");
    url.searchParams.set("_to", "2");
    let slug: string | null = null;
    if (query.kind === "url") {
      if (!sameStorefront(query.value, config)) throw new VtexError("invalid_query");
      const path = new URL(query.value).pathname.split("/").filter(Boolean);
      if (path.length !== 2 || path[1] !== "p") throw new VtexError("invalid_query");
      slug = decodeURIComponent(path[0]);
      if (!slug || /[/?#\\]/.test(slug)) throw new VtexError("invalid_query");
      url.pathname += `/${encodeURIComponent(slug)}/p`;
    } else if (query.kind === "sku") url.searchParams.set("fq", `skuId:${query.value}`);
    else url.searchParams.set("ft", query.value);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (config.useCredentials) {
      if (!options.credentials) throw new VtexError("credentials_unavailable");
      headers["X-VTEX-API-AppKey"] = options.credentials.appKey;
      headers["X-VTEX-API-AppToken"] = options.credentials.appToken;
    }
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(8000)])
      : AbortSignal.timeout(8000);
    const request = options.fetch || fetch;
    const response = await readJson(
      await request(url, {
        headers,
        signal,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      }),
    );
    if (!Array.isArray(response)) throw new VtexError("invalid_response");
    const products = response
      .slice(0, 3)
      .map((item) => productFromApi(item, config))
      .filter((item): item is VtexProduct => Boolean(item));
    const selectedId = query.skuId || (query.kind === "sku" ? query.value : null);
    base.products = products
      .filter(
        (product) => !slug || new URL(product.url).pathname === `/${encodeURIComponent(slug)}/p`,
      )
      .map((product) => ({
        ...product,
        skus: selectedId ? product.skus.filter((sku) => sku.id === selectedId) : product.skus,
      }))
      .filter((product) => product.skus.length);
    const skus = base.products.flatMap((product) => product.skus);
    base.status =
      skus.length === 1 && (query.kind !== "term" || selectedId)
        ? "matched"
        : skus.length
          ? "choices"
          : "not_found";
    base.selectedSkuId = base.status === "matched" ? skus[0].id : null;
    if (options.shippingRequested || query.postalCode) {
      if (!config.channels[channel].shipping) base.shippingStatus = "blocked";
      else if (!base.selectedSkuId) base.shippingStatus = "needs_sku";
      else if (!query.postalCode) base.shippingStatus = "needs_postal_code";
      else if (!skus[0].sellerId) base.shippingStatus = "unavailable";
      else {
        const simulationUrl = new URL("/api/checkout/pub/orderForms/simulation", apiOrigin);
        simulationUrl.searchParams.set("sc", config.salesChannel);
        try {
          // Sem AppKey, AppToken, cookie, perfil ou endereço pessoal: preço/frete públicos.
          const simulation = object(
            await readJson(
              await request(simulationUrl, {
                method: "POST",
                headers: { Accept: "application/json", "Content-Type": "application/json" },
                signal,
                redirect: "error",
                credentials: "omit",
                cache: "no-store",
                body: JSON.stringify({
                  items: [
                    { id: base.selectedSkuId, quantity: query.quantity, seller: config.sellerId },
                  ],
                  postalCode: query.postalCode.replace(/\D/g, ""),
                  country: "BRA",
                }),
              }),
            ),
          );
          const item = rows(simulation.items).find(
            (entry) => String(entry.id) === base.selectedSkuId && entry.seller === config.sellerId,
          );
          if (!item || item.availability !== "available" || item.quantity !== query.quantity)
            throw new VtexError("invalid_response");
          if (typeof item.sellingPrice === "number") skus[0].priceCents = cents(item.sellingPrice);
          base.shipping = rows(simulation.logisticsInfo)
            .filter((entry) => entry.itemIndex === 0)
            .flatMap((entry) => rows(entry.slas))
            .filter((sla) => sla.deliveryChannel === "delivery" && cents(sla.price) !== null)
            .slice(0, 5)
            .map((sla) => ({
              name: plainText(sla.name || sla.id, 120),
              priceCents: cents(sla.price)!,
              estimate: plainText(sla.shippingEstimate, 80),
            }));
          base.shippingStatus = base.shipping.length ? "available" : "unavailable";
        } catch {
          base.shippingStatus = "unavailable";
        }
      }
    }
    return projectVtexForChannel(base, config);
  } catch (error) {
    return {
      ...base,
      status: "unavailable",
      products: [],
      shipping: [],
      selectedSkuId: null,
      diagnostic:
        error instanceof VtexError
          ? error.diagnostic
          : error instanceof Error && /timeout|abort/i.test(error.name)
            ? "timeout"
            : "invalid_response",
    };
  }
}
