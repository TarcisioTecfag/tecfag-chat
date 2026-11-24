import { z } from "zod";

export const VTEX_AGENT = "vtex_store";
export const channelPolicySchema = z
  .object({
    catalog: z.boolean(),
    price: z.boolean(),
    availability: z.boolean(),
    shipping: z.boolean(),
  })
  .strict();
export const vtexSettingsSchema = z
  .object({
    account: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{0,49}$/),
    storefrontOrigin: z
      .string()
      .url()
      .max(300)
      .refine((raw) => {
        const url = new URL(raw);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          url.pathname === "/" &&
          !url.search &&
          !url.hash &&
          !url.port &&
          /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)
        );
      }, "Informe somente a origem HTTPS da loja.")
      .transform((raw) => new URL(raw).origin),
    salesChannel: z.string().regex(/^[1-9]\d{0,5}$/),
    sellerId: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_-]{1,80}$/),
    enabled: z.boolean(),
    useCredentials: z.boolean(),
    channels: z.object({ livechat: channelPolicySchema, whatsapp: channelPolicySchema }).strict(),
  })
  .strict();
export type VtexSettings = z.infer<typeof vtexSettingsSchema>;
export type VtexChannel = keyof VtexSettings["channels"];
export const defaultVtexSettings = (): VtexSettings => ({
  account: "",
  storefrontOrigin: "",
  salesChannel: "1",
  sellerId: "1",
  enabled: false,
  useCredentials: false,
  channels: {
    livechat: { catalog: true, price: true, availability: true, shipping: true },
    whatsapp: { catalog: true, price: false, availability: false, shipping: false },
  },
});
export const vtexQuerySchema = z
  .object({
    kind: z.enum(["url", "sku", "term"]),
    value: z.string().trim().min(1).max(2000),
    skuId: z
      .string()
      .regex(/^\d{1,20}$/)
      .optional(),
    postalCode: z
      .string()
      .regex(/^\d{5}-?\d{3}$/)
      .optional(),
    quantity: z.number().int().min(1).max(100).default(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "sku" && !/^\d{1,20}$/.test(value.value))
      ctx.addIssue({ code: "custom", message: "SKU inválido." });
    if (value.kind === "term" && (value.value.length < 3 || value.value.length > 120))
      ctx.addIssue({ code: "custom", message: "Busca deve ter entre 3 e 120 caracteres." });
  });
export type VtexQuery = z.infer<typeof vtexQuerySchema>;
export interface VtexSku {
  id: string;
  name: string;
  reference: string;
  sellerId: string;
  priceCents: number | null;
  available: boolean | null;
}
export interface VtexProduct {
  id: string;
  name: string;
  url: string;
  description: string;
  specifications: Record<string, string>;
  skus: VtexSku[];
}
export interface VtexShipping {
  name: string;
  priceCents: number;
  estimate: string;
}
export interface VtexResult {
  status: "matched" | "choices" | "not_found" | "unavailable" | "disabled" | "policy_blocked";
  checkedAt: string;
  source: "vtex";
  channel: VtexChannel;
  products: VtexProduct[];
  selectedSkuId: string | null;
  shipping: VtexShipping[];
  shippingStatus:
    "not_requested" | "needs_postal_code" | "needs_sku" | "available" | "unavailable" | "blocked";
  quantity: number;
  diagnostic?:
    | "timeout"
    | "rate_limited"
    | "upstream_error"
    | "invalid_response"
    | "invalid_query"
    | "credentials_unavailable";
}
const VTEX_HTML_NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  ndash: "–",
  mdash: "—",
  bull: "•",
  middot: "·",
  hellip: "…",
  deg: "°",
  ordm: "º",
  ordf: "ª",
  sup2: "²",
  sup3: "³",
  times: "×",
  divide: "÷",
  plusmn: "±",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  aacute: "á",
  Aacute: "Á",
  agrave: "à",
  Agrave: "À",
  acirc: "â",
  Acirc: "Â",
  atilde: "ã",
  Atilde: "Ã",
  auml: "ä",
  Auml: "Ä",
  aring: "å",
  Aring: "Å",
  eacute: "é",
  Eacute: "É",
  egrave: "è",
  Egrave: "È",
  ecirc: "ê",
  Ecirc: "Ê",
  euml: "ë",
  Euml: "Ë",
  iacute: "í",
  Iacute: "Í",
  igrave: "ì",
  Igrave: "Ì",
  icirc: "î",
  Icirc: "Î",
  iuml: "ï",
  Iuml: "Ï",
  oacute: "ó",
  Oacute: "Ó",
  ograve: "ò",
  Ograve: "Ò",
  ocirc: "ô",
  Ocirc: "Ô",
  otilde: "õ",
  Otilde: "Õ",
  ouml: "ö",
  Ouml: "Ö",
  uacute: "ú",
  Uacute: "Ú",
  ugrave: "ù",
  Ugrave: "Ù",
  ucirc: "û",
  Ucirc: "Û",
  uuml: "ü",
  Uuml: "Ü",
  ccedil: "ç",
  Ccedil: "Ç",
  ntilde: "ñ",
  Ntilde: "Ñ",
  yacute: "ý",
  Yacute: "Ý",
  yuml: "ÿ",
};

function decodeVtexHtmlEntitiesOnce(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return " ";
      return code === 160 ? " " : String.fromCodePoint(code);
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return " ";
      return code === 160 ? " " : String.fromCodePoint(code);
    })
    .replace(/&([a-zA-Z0-9]+);/g, (full, name) => {
      if (Object.hasOwn(VTEX_HTML_NAMED_ENTITIES, name)) {
        return VTEX_HTML_NAMED_ENTITIES[name];
      }
      const lower = name.toLowerCase();
      if (Object.hasOwn(VTEX_HTML_NAMED_ENTITIES, lower)) {
        return VTEX_HTML_NAMED_ENTITIES[lower];
      }
      return full;
    });
}

export function decodeVtexHtmlEntities(input: string): string {
  if (!input || !input.includes("&")) return input || "";
  return decodeVtexHtmlEntitiesOnce(decodeVtexHtmlEntitiesOnce(input));
}

export function smartTruncate(text: string, max: number): string {
  if (max <= 0 || !text) return "";
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  if (max <= 12) return trimmed.slice(0, max);

  const window = trimmed.slice(0, max - 1);
  const sentenceFloor = Math.floor(max * 0.58);
  let lastSentenceEnd = -1;
  for (let i = window.length - 1; i >= sentenceFloor; i--) {
    const ch = window[i];
    if (ch === "." || ch === "!" || ch === "?") {
      const next = trimmed[i + 1];
      if (!next || /\s/.test(next)) {
        lastSentenceEnd = i;
        break;
      }
    }
  }
  if (lastSentenceEnd >= sentenceFloor) {
    return window.slice(0, lastSentenceEnd + 1).trim();
  }

  const wordFloor = Math.floor(max * 0.45);
  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace >= wordFloor ? window.slice(0, lastSpace) : window;
  const cleaned = cut.replace(/[\s,;:\-–—•|(\/]+$/u, "").trim();
  return `${cleaned || cut.trim()}…`;
}

export const plainText = (raw: unknown, max = 1000) => {
  if (typeof raw !== "string") return "";
  const stripped = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<li\b[^>]*>/gi, " • ")
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  const decoded = decodeVtexHtmlEntities(stripped)
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/(?:\s*•\s*){2,}/g, " • ")
    .replace(/\s+/g, " ")
    .trim();
  return smartTruncate(decoded, max);
};
export function sameStorefront(raw: string, config: VtexSettings): boolean {
  try {
    const value = new URL(raw),
      expected = new URL(config.storefrontOrigin);
    return (
      value.protocol === "https:" &&
      !value.username &&
      !value.password &&
      !value.port &&
      value.hostname.replace(/^www\./, "") === expected.hostname.replace(/^www\./, "")
    );
  } catch {
    return false;
  }
}
/** Fonte pública oficial; não contém credenciais, CEP nem dados privados do checkout. */
export function projectVtexForChannel(raw: VtexResult, config: VtexSettings): VtexResult {
  const policy = config.channels[raw.channel];
  if (!policy.catalog)
    return {
      ...raw,
      status: "policy_blocked",
      products: [],
      selectedSkuId: null,
      shipping: [],
      shippingStatus: "blocked",
    };
  const redact = (value: string) =>
    /R\$|\b(?:pre[cç]o|custa|reais|desconto)\b|\bvalor de venda\b/i.test(value) ||
    (!policy.price && /\bvalor\b/i.test(value)) ||
    (!policy.shipping && /\b(?:frete|prazo de entrega|entrega em)\b/i.test(value)) ||
    (!policy.availability && /\b(?:estoque|dispon[ií]vel|pronta entrega)\b/i.test(value))
      ? ""
      : value;
  return {
    ...raw,
    products: raw.products.map((product) => ({
      ...product,
      name: redact(product.name) || `Produto ${product.id}`,
      description: redact(product.description),
      specifications: Object.fromEntries(
        Object.entries(product.specifications).filter(([key, value]) => redact(`${key} ${value}`)),
      ),
      skus: product.skus.map((sku) => ({
        ...sku,
        name: redact(sku.name) || `Variante ${sku.id}`,
        priceCents: policy.price ? sku.priceCents : null,
        available: policy.availability ? sku.available : null,
      })),
    })),
    shipping: policy.shipping ? raw.shipping : [],
    shippingStatus: policy.shipping ? raw.shippingStatus : "blocked",
  };
}
export const vtexEvidenceSchema = z
  .object({
    source: z.literal("vtex"),
    status: z.enum([
      "matched",
      "choices",
      "not_found",
      "unavailable",
      "disabled",
      "policy_blocked",
    ]),
    checkedAt: z.string().datetime(),
    channel: z.enum(["livechat", "whatsapp"]),
    selectedSkuId: z
      .string()
      .regex(/^\d{1,20}$/)
      .nullable(),
    productName: z.string().max(300),
    productUrl: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
        );
      })
      .nullable(),
    shippingStatus: z.enum([
      "not_requested",
      "needs_postal_code",
      "needs_sku",
      "available",
      "unavailable",
      "blocked",
    ]),
    diagnostic: z
      .enum([
        "timeout",
        "rate_limited",
        "upstream_error",
        "invalid_response",
        "invalid_query",
        "credentials_unavailable",
      ])
      .nullable(),
  })
  .strict();
export type VtexEvidence = z.infer<typeof vtexEvidenceSchema>;
export function readVtexEvidence(raw: unknown): VtexEvidence | null {
  const result = vtexEvidenceSchema.safeParse(raw);
  return result.success ? result.data : null;
}
