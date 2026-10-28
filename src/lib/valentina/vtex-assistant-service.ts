// ══════════════════════════════════════════════════════════════════════════════
// 🛒 VTEX ASSISTANT SERVICE — INTEGRAÇÃO EM TEMPO REAL & LEITURA COMPLETA DE PÁGINA
// Conecta o Assistente Fagner (Operadores, Diretoria e Assistente Inline) à
// loja VTEX da Tecfag (https://www.tecfag.com.br), trazendo:
// 1. Preços públicos em tempo real, disponibilidade, SKUs e simulação de frete;
// 2. Leitura integral da página do produto na VTEX (API Catalog System +
//    parsing completo do HTML/JSON-LD/OpenGraph da URL /p no site);
// 3. Dados estruturados para o balão separado com Preview Oficial VTEX + Link.
// ══════════════════════════════════════════════════════════════════════════════

import { db } from "../../db";
import defaultTecfagCatalog from "../triage/tecfag-default-catalog.json";
import { readVtexConfig, credentialsForVtex } from "../vtex/store";
import { defaultVtexSettings, type VtexCredentials, type VtexSettings } from "../vtex/contract";
import type { VtexProductPreviewItem, KnowledgeSourceItem } from "../mockData";
import { expandInternalCatalogCodesInText } from "./knowledge-service";

interface CatalogEntry {
  id: string;
  name: string;
  sku?: string;
  code?: string;
  line?: string;
  production?: string;
  description?: string;
  aliases?: string[];
  active?: boolean;
}

export interface FullVtexProductRecord {
  productId: string;
  skuId: string;
  name: string;
  skuName: string | null;
  referenceCode: string | null;
  internalCode: string | null;
  modelCode: string | null;
  brand: string | null;
  category: string | null;
  url: string;
  imageUrl: string | null;
  additionalImages: string[];
  priceCents: number | null;
  listPriceCents: number | null;
  priceFormatted: string | null;
  listPriceFormatted: string | null;
  available: boolean | null;
  availableQuantity: number | null;
  description: string;
  metaDescription: string | null;
  specifications: Record<string, string[]>;
  specificationsSummary: Array<{ label: string; value: string }>;
  fullPageContent: string | null;
  pageJsonLdSummary: string | null;
  pageReadComplete: boolean;
  shippingOptions?: Array<{
    id: string;
    name: string;
    priceFormatted: string;
    estimate: string | null;
  }>;
  checkedAt: string;
}

export interface VtexAssistantLookupResult {
  invoked: boolean;
  wantsFullPageRead: boolean;
  wantsPriceOrCommercial: boolean;
  wantsProductLink: boolean;
  shouldSendSeparatePreviewBubble: boolean;
  products: FullVtexProductRecord[];
  previews: VtexProductPreviewItem[];
  knowledgeSources: KnowledgeSourceItem[];
  promptContext: string;
}

// Cache rápido em memória para evitar chamadas duplicadas em rajada (TTL: 90s)
const vtexProductCache = new Map<
  string,
  { timestamp: number; record: FullVtexProductRecord }
>();
const VTEX_CACHE_TTL_MS = 90_000;

function normalizeText(value: string): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function decodeHtmlEntities(input: string): string {
  return (input || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&bull;/gi, "•")
    .replace(/&deg;/gi, "°")
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });
}

function cleanHtmlToStructuredText(html: string, maxChars = 8000): string {
  if (!html) return "";
  const text = decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "• ")
      .replace(/<td\b[^>]*>/gi, " | ")
      .replace(/<[^>]+>/g, " ")
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 1)
    .join("\n");

  return text.slice(0, maxChars).trim();
}

export function formatBrlCents(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined || !Number.isFinite(cents) || cents <= 0) {
    return null;
  }
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

async function resolveVtexAssistantSettings(tenantId: string): Promise<{
  settings: VtexSettings;
  credentials?: VtexCredentials;
}> {
  try {
    const state = await readVtexConfig(db as any, tenantId);
    let credentials: VtexCredentials | undefined;
    if (state.settings.useCredentials && state.credentialsEncrypted) {
      try {
        credentials = credentialsForVtex(tenantId, state);
      } catch {
        credentials = undefined;
      }
    }
    if (tenantId === "tecfag") {
      return {
        settings: {
          ...state.settings,
          enabled: true,
          account: state.settings.account || "tecfag",
          storefrontOrigin: state.settings.storefrontOrigin || "https://www.tecfag.com.br",
          salesChannel: state.settings.salesChannel || "1",
          sellerId: state.settings.sellerId || "1",
          timeoutMs: Math.max(state.settings.timeoutMs || 5000, 5000),
        },
        credentials,
      };
    }
    return { settings: state.settings, credentials };
  } catch {
    const fallback = defaultVtexSettings();
    if (tenantId === "tecfag") {
      return {
        settings: {
          ...fallback,
          enabled: true,
          account: "tecfag",
          storefrontOrigin: "https://www.tecfag.com.br",
          salesChannel: "1",
          sellerId: "1",
          timeoutMs: 5000,
        },
      };
    }
    return { settings: fallback };
  }
}

function vtexHeaders(credentials?: VtexCredentials): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "Tecfag-Fagner-Assistant/1.0",
    ...(credentials
      ? {
          "X-VTEX-API-AppKey": credentials.appKey,
          "X-VTEX-API-AppToken": credentials.appToken,
        }
      : {}),
  };
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 5000
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Faz a leitura direta da página web pública do produto na VTEX (`https://www.tecfag.com.br/<slug>/p`),
 * extraindo OpenGraph (`og:image`, `og:description`), JSON-LD (`application/ld+json`) e o
 * texto visível integral da página (descrições longas, tabelas técnicas, benefícios e observações).
 */
export async function fetchFullVtexProductPage(
  productUrl: string,
  timeoutMs = 5000
): Promise<{
  ogImage: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  jsonLdSummary: string | null;
  fullPageText: string | null;
  success: boolean;
}> {
  if (!productUrl || !/^https?:\/\//i.test(productUrl)) {
    return {
      ogImage: null,
      ogTitle: null,
      ogDescription: null,
      jsonLdSummary: null,
      fullPageText: null,
      success: false,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(productUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ogImage: null,
        ogTitle: null,
        ogDescription: null,
        jsonLdSummary: null,
        fullPageText: null,
        success: false,
      };
    }

    const html = await res.text();
    if (!html || html.length < 100) {
      return {
        ogImage: null,
        ogTitle: null,
        ogDescription: null,
        jsonLdSummary: null,
        fullPageText: null,
        success: false,
      };
    }

    const extractMeta = (prop: string): string | null => {
      const rx1 = new RegExp(
        `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
        "i"
      );
      const rx2 = new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
        "i"
      );
      const m = html.match(rx1) || html.match(rx2);
      return m?.[1] ? decodeHtmlEntities(m[1]).trim() : null;
    };

    const ogImage = extractMeta("og:image") || extractMeta("twitter:image");
    const ogTitle = extractMeta("og:title") || extractMeta("twitter:title");
    const ogDescription =
      extractMeta("og:description") || extractMeta("description");

    // Extrair blocos JSON-LD (Product / Offer)
    const jsonLdBlocks: string[] = [];
    const ldRegex =
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let ldMatch: RegExpExecArray | null;
    while ((ldMatch = ldRegex.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(ldMatch[1].trim());
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (
            item &&
            (item["@type"] === "Product" ||
              item.name ||
              item.description ||
              item.offers)
          ) {
            const summaryParts: string[] = [];
            if (item.name) summaryParts.push(`Produto: ${item.name}`);
            if (item.sku) summaryParts.push(`SKU: ${item.sku}`);
            if (item.mpn) summaryParts.push(`MPN/Ref: ${item.mpn}`);
            if (item.brand?.name) summaryParts.push(`Marca: ${item.brand.name}`);
            if (item.description) {
              summaryParts.push(
                `Descrição estruturada: ${cleanHtmlToStructuredText(String(item.description), 2500)}`
              );
            }
            const offer =
              item.offers?.offers?.[0] ||
              (Array.isArray(item.offers) ? item.offers[0] : item.offers);
            if (offer?.price) {
              summaryParts.push(`Preço na página: R$ ${offer.price}`);
            }
            if (summaryParts.length > 0) {
              jsonLdBlocks.push(summaryParts.join(" | "));
            }
          }
        }
      } catch {
        // Ignora JSON-LD malformado
      }
    }

    // Remove cabeçalho/rodapé/menus genéricos para focar no conteúdo real da página do produto
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyHtml = (bodyMatch ? bodyMatch[1] : html)
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ");

    const rawLines = cleanHtmlToStructuredText(bodyHtml, 14000)
      .split("\n")
      .filter((line) => {
        const norm = normalizeText(line);
        if (norm.length < 3) return false;
        // Filtra ruídos comuns de menu de e-commerce
        if (
          /^(meus pedidos|minha conta|carrinho|entrar|cadastre-se|todos os departamentos|politica de privacidade|termos de uso|atendimento ao cliente)$/i.test(
            norm
          )
        ) {
          return false;
        }
        return true;
      });

    // Deduplica linhas idênticas consecutivas
    const dedupedLines: string[] = [];
    for (const line of rawLines) {
      if (dedupedLines[dedupedLines.length - 1] !== line) {
        dedupedLines.push(line);
      }
    }

    const fullPageText = dedupedLines.join("\n").slice(0, 7500).trim();

    return {
      ogImage,
      ogTitle,
      ogDescription,
      jsonLdSummary: jsonLdBlocks.length > 0 ? jsonLdBlocks.join("\n") : null,
      fullPageText: fullPageText || null,
      success: Boolean(fullPageText || jsonLdBlocks.length > 0 || ogDescription),
    };
  } catch {
    return {
      ogImage: null,
      ogTitle: null,
      ogDescription: null,
      jsonLdSummary: null,
      fullPageText: null,
      success: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

function cleanVtexImageUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  // Converte URL de imagem VTEX com redimensionamento estreito (/ids/155642-55-55/) para alta resolução
  return trimmed.replace(/\/arquivos\/ids\/(\d+)-\d+-\d+\//i, "/arquivos/ids/$1/");
}

function parseVtexApiProductRow(
  row: Record<string, any>,
  settings: VtexSettings,
  preferredSkuId?: string | null,
  catalogEntry?: CatalogEntry | null
): FullVtexProductRecord | null {
  const productId = String(row.productId || "").trim();
  const name = String(row.productName || "").trim();
  if (!productId || !name) return null;

  const linkText = String(row.linkText || "").trim();
  const origin = (settings.storefrontOrigin || "https://www.tecfag.com.br").replace(
    /\/+$/,
    ""
  );
  const url = linkText ? `${origin}/${linkText.replace(/^\/+|\/+$/g, "")}/p` : origin;

  // Extrair todas as especificações sem truncamento de 20 chaves
  const specifications: Record<string, string[]> = {};
  const specificationsSummary: Array<{ label: string; value: string }> = [];
  const allSpecNames = Array.isArray(row.allSpecifications)
    ? row.allSpecifications
    : [];

  for (const key of allSpecNames) {
    if (typeof key !== "string" || !key.trim()) continue;
    const rawValues = Array.isArray(row[key]) ? row[key] : [];
    const values = rawValues
      .map((item: unknown) =>
        typeof item === "string"
          ? cleanHtmlToStructuredText(item, 1500)
          : String(item || "").trim()
      )
      .filter(Boolean);
    if (values.length > 0) {
      specifications[key] = values;
      specificationsSummary.push({
        label: key.trim(),
        value: values.join(", ").slice(0, 350),
      });
    }
  }

  // Extrair SKUs, imagens e oferta comercial
  const rawItems = Array.isArray(row.items) ? row.items : [];
  if (rawItems.length === 0) return null;

  const chosenItem =
    (preferredSkuId &&
      rawItems.find((it: any) => String(it.itemId || "") === String(preferredSkuId))) ||
    rawItems.find((it: any) => {
      const sellers = Array.isArray(it?.sellers) ? it.sellers : [];
      const s =
        sellers.find((sel: any) => String(sel.sellerId || "") === settings.sellerId) ||
        sellers.find((sel: any) => sel.sellerDefault) ||
        sellers[0];
      return Number(s?.commertialOffer?.Price || 0) > 0;
    }) ||
    rawItems[0];

  const skuId = String(chosenItem.itemId || "").trim();
  const skuName = String(chosenItem.nameComplete || chosenItem.name || name).trim();
  const refArray = Array.isArray(chosenItem.referenceId) ? chosenItem.referenceId : [];
  const referenceCode =
    String(refArray[0]?.Value || chosenItem.ean || row.productReference || "").trim() ||
    null;

  // Extrair imagens oficiais da VTEX
  const rawImages = Array.isArray(chosenItem.images) ? chosenItem.images : [];
  const additionalImages: string[] = [];
  for (const img of rawImages) {
    const cleaned = cleanVtexImageUrl(img?.imageUrl);
    if (cleaned && !additionalImages.includes(cleaned)) {
      additionalImages.push(cleaned);
    }
  }
  const imageUrl = additionalImages[0] || null;

  // Extrair preço e estoque do seller
  const sellers = Array.isArray(chosenItem.sellers) ? chosenItem.sellers : [];
  const seller =
    sellers.find((sel: any) => String(sel.sellerId || "") === settings.sellerId) ||
    sellers.find((sel: any) => sel.sellerDefault) ||
    sellers[0];
  const offer = (seller?.commertialOffer || {}) as Record<string, any>;

  const rawPrice = Number(offer.Price);
  const rawListPrice = Number(offer.ListPrice);
  const rawQty = Number(offer.AvailableQuantity);

  const priceCents =
    Number.isFinite(rawPrice) && rawPrice > 0 ? Math.round(rawPrice * 100) : null;
  const listPriceCents =
    Number.isFinite(rawListPrice) && rawListPrice > 0
      ? Math.round(rawListPrice * 100)
      : null;
  const availableQuantity =
    Number.isFinite(rawQty) && rawQty >= 0 ? Math.trunc(rawQty) : null;
  const available =
    typeof offer.IsAvailable === "boolean"
      ? offer.IsAvailable
      : availableQuantity !== null
      ? availableQuantity > 0
      : priceCents !== null;

  const rawDescription = String(row.description || "").trim();
  const metaDescription = String(row.metaTagDescription || "").trim() || null;
  const cleanedDescription = cleanHtmlToStructuredText(
    rawDescription || metaDescription || catalogEntry?.description || "",
    9000
  );

  const categories = Array.isArray(row.categories) ? row.categories : [];
  const primaryCategory =
    typeof categories[0] === "string"
      ? categories[0].replace(/^\/+|\/+$/g, "").replace(/\//g, " > ")
      : catalogEntry?.line || null;

  const internalCode =
    catalogEntry?.code ||
    (referenceCode && /^PAMQ/i.test(referenceCode) ? referenceCode : null);
  const modelCode =
    catalogEntry?.name?.split(/\s+[-–—]\s+/)[0]?.trim() || null;

  return {
    productId,
    skuId,
    name,
    skuName,
    referenceCode,
    internalCode,
    modelCode,
    brand: typeof row.brand === "string" ? row.brand.trim() : "Tecfag",
    category: primaryCategory,
    url,
    imageUrl,
    additionalImages,
    priceCents,
    listPriceCents,
    priceFormatted: formatBrlCents(priceCents),
    listPriceFormatted: formatBrlCents(listPriceCents),
    available,
    availableQuantity,
    description: cleanedDescription,
    metaDescription,
    specifications,
    specificationsSummary,
    fullPageContent: null,
    pageJsonLdSummary: null,
    pageReadComplete: false,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Detecta se a pergunta do operador ou gestor envolve consulta de máquina/produto,
 * preço/valor, estoque/disponibilidade, frete, link da máquina no site ou leitura da página na VTEX.
 */
export function isVtexOrProductAssistantQuery(
  userQuery: string,
  recentHistoryText = ""
): {
  shouldQueryVtex: boolean;
  wantsFullPageRead: boolean;
  wantsPriceOrCommercial: boolean;
  wantsProductLink: boolean;
  postalCode: string | null;
} {
  const raw = `${userQuery || ""}`.trim();
  const norm = normalizeText(raw);
  const combinedNorm = normalizeText(`${raw} ${recentHistoryText || ""}`);

  const wantsProductLink =
    /\b(link|url|site|pagina|página|abrir no site|mandar o link|manda o link|link da maquina|link do produto|link na vtex|ver no site|preview)\b/i.test(
      norm
    );

  const wantsFullPageRead =
    wantsProductLink ||
    /\b(mais informac|mais detalhe|tudo sobre|pagina toda|página toda|pagina inteira|página inteira|ler a pagina|le a pagina|leia a pagina|na vtex|no site|ficha completa|especificac|descricao completa|descrição completa|sobre a maquina|sobre o equipamento|sobre o modelo|me fala sobre|me explica sobre)\b/i.test(
      norm
    );

  const wantsPriceOrCommercial =
    /\b(preco|preço|precos|preços|valor|valores|quanto custa|qual o custo|cotacao|cotação|orcamento|orçamento|estoque|disponivel|disponível|disponibilidade|pronta entrega|frete|entrega|sku|vtex|loja)\b/i.test(
      norm
    );

  const hasExplicitMachineToken =
    /\b(maquina|maquinas|equipamento|equipamentos|seladora|envasadora|rotuladora|datador|empacotadora|dosadora|arqueadora|tunel|encolhimento|vacuo|encapsuladora|blister|cartonadora|enfardad|fechadora|stretch|inkjet|laser|pratic\s*seal|vsf|apf|bsf|dzf?|dbf|dcgy|fql|pamq[a-z0-9]+|sku\s*\d+|[a-z]{2,5}[-_\s]?\d{2,5}[a-z0-9-]*)\b/i.test(
      combinedNorm
    );

  const hasVtexUrl = /tecfag\.com\.br\/[^\s/]+\/p\b/i.test(raw);
  const cepMatch = raw.match(/\b(\d{5})-?(\d{3})\b/);
  const postalCode = cepMatch ? `${cepMatch[1]}${cepMatch[2]}` : null;

  // Ignora perguntas puramente sobre fila/clientes do CRM sem relação com máquinas
  const isPureQueueOrSystemHowTo =
    /\b(clientes?\s+aguardando|fila\s+de\s+espera|como\s+eu\s+transfiro|como\s+posso\s+transferir|como\s+assumo|como\s+finalizo|concluir\s+diretriz)\b/i.test(
      norm
    ) && !wantsPriceOrCommercial && !wantsProductLink && !hasVtexUrl;

  const shouldQueryVtex =
    !isPureQueueOrSystemHowTo &&
    (hasVtexUrl ||
      wantsProductLink ||
      (wantsPriceOrCommercial && hasExplicitMachineToken) ||
      (wantsFullPageRead && hasExplicitMachineToken) ||
      /\b(vtex|sku\s*\d+|quanto\s+custa|qual\s+o\s+(?:preco|preço|valor))\b/i.test(norm));

  return {
    shouldQueryVtex,
    wantsFullPageRead,
    wantsPriceOrCommercial,
    wantsProductLink,
    postalCode,
  };
}

/**
 * Localiza candidatos no Catálogo Oficial Tecfag (1.037 máquinas) para obter o SKU exato da VTEX,
 * código interno PAMQ e nome oficial do equipamento.
 */
function findCatalogCandidatesForVtex(
  userQuery: string,
  recentHistoryText = "",
  maxCandidates = 3
): CatalogEntry[] {
  const catalog = (defaultTecfagCatalog as CatalogEntry[]).filter(
    (item) => item && item.active !== false
  );
  if (catalog.length === 0) return [];

  const expandedUser = expandInternalCatalogCodesInText(userQuery || "");
  const expandedHistory = expandInternalCatalogCodesInText(recentHistoryText || "");
  const normUser = normalizeText(expandedUser);
  const compactUser = normUser.replace(/[^a-z0-9]/g, "");

  // Se a pergunta atual usa pronomes ("qual o valor dela?", "me passa o link dela", "preciso de mais informações dessa máquina"),
  // usa também os modelos recentes do histórico
  const isPronounFollowUp =
    /\b(dela|dele|dessa\s+maquina|desse\s+modelo|desse\s+equipamento|dessa\s+ai|esse\s+modelo|essa\s+maquina|o\s+link|o\s+preco|o\s+valor)\b/i.test(
      normUser
    );

  const searchSource = isPronounFollowUp
    ? `${expandedUser} ${expandedHistory.slice(-1600)}`
    : expandedUser;
  const normSource = normalizeText(searchSource);
  const compactSource = normSource.replace(/[^a-z0-9]/g, "");

  // SKU explícito (ex: "SKU 865")
  const explicitSkuMatch = searchSource.match(/\bsku\s*[:#-]?\s*(\d{1,8})\b/i);
  const explicitSku = explicitSkuMatch ? explicitSkuMatch[1] : null;

  const modelRegexMatches =
    normSource.match(/\b[a-z]{1,6}[-_\s]?\d{1,5}(?:[-_\s]?[a-z0-9]{1,5})*\b/g) || [];
  const compactModels = Array.from(
    new Set(
      modelRegexMatches
        .map((m) => m.replace(/[^a-z0-9]/g, ""))
        .filter((m) => m.length >= 3 && !/^(?:220v|110v|380v|24h|48h)$/.test(m))
    )
  );

  const stopwords = new Set([
    "como",
    "qual",
    "quais",
    "quanto",
    "custa",
    "valor",
    "preco",
    "precos",
    "maquina",
    "maquinas",
    "equipamento",
    "sobre",
    "mais",
    "informacoes",
    "informacao",
    "detalhes",
    "preciso",
    "quero",
    "saber",
    "passa",
    "manda",
    "link",
    "site",
    "pagina",
    "vtex",
    "loja",
    "para",
    "com",
    "uma",
    "uns",
    "dos",
    "das",
    "que",
    "tem",
    "voce",
    "fagner",
  ]);

  const queryTerms = Array.from(
    new Set(
      normSource
        .split(/[^a-z0-9]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2 && !stopwords.has(t))
    )
  );

  const scored: Array<{ item: CatalogEntry; score: number }> = [];

  for (const item of catalog) {
    const itemSku = String(item.sku || "").trim();
    const itemCodeNorm = normalizeText(item.code || "").replace(/[^a-z0-9]/g, "");
    const itemNameNorm = normalizeText(item.name || "");
    const itemNameCompact = itemNameNorm.replace(/[^a-z0-9]/g, "");
    const firstSegment = itemNameNorm.split(/\s+[-–—]\s+/)[0]?.trim() || "";
    const firstSegmentCompact = firstSegment.replace(/[^a-z0-9]/g, "");

    let score = 0;

    if (explicitSku && itemSku === explicitSku) {
      score += 2500;
    }
    if (itemCodeNorm && itemCodeNorm.length >= 5 && compactSource.includes(itemCodeNorm)) {
      score += compactUser.includes(itemCodeNorm) ? 2000 : 1400;
    }

    for (const cm of compactModels) {
      if (firstSegmentCompact && firstSegmentCompact === cm) {
        score += compactUser.includes(cm) ? 1600 : 1100;
      } else if (itemNameCompact.includes(cm)) {
        score += compactUser.includes(cm) ? 900 : 600;
      }
    }

    for (const term of queryTerms) {
      if (term === "vsf" && /\bvsf\b/.test(itemNameNorm)) {
        // Prioriza a VSF pura ("Envasadora semiautomática de Pós VSF - 220V") quando perguntam "VSF" sem sufixo
        score += /\bvsf\s*-\s*\d/.test(itemNameNorm) ? 550 : 1200;
      } else if (firstSegmentCompact && firstSegmentCompact === term && term.length >= 3) {
        score += 1100;
      } else if (itemNameNorm.includes(term)) {
        score += /\d/.test(term) ? 240 : 85;
      }
    }

    // Bônus se o item possui SKU VTEX mapeado
    if (score > 0 && itemSku) {
      score += 90;
    }

    if (score >= 160) {
      scored.push({ item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // Deduplica por SKU ou nome base para não buscar 3 voltagens idênticas se houver outros modelos
  const picked: CatalogEntry[] = [];
  const seenKeys = new Set<string>();
  for (const { item } of scored) {
    const key = item.sku || item.code || item.id;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    picked.push(item);
    if (picked.length >= maxCandidates) break;
  }

  return picked;
}

/**
 * Executa a busca completa na VTEX + leitura integral da página web do produto no site,
 * retornando o contexto rico para o prompt do Fagner e os cards `VtexProductPreviewItem`
 * para exibição em balão separado.
 */
export async function lookupVtexProductsForAssistant(options: {
  tenantId: string;
  userQuery: string;
  recentHistoryText?: string;
  forceLookup?: boolean;
}): Promise<VtexAssistantLookupResult> {
  const {
    tenantId,
    userQuery,
    recentHistoryText = "",
    forceLookup = false,
  } = options;

  const emptyResult: VtexAssistantLookupResult = {
    invoked: false,
    wantsFullPageRead: false,
    wantsPriceOrCommercial: false,
    wantsProductLink: false,
    shouldSendSeparatePreviewBubble: false,
    products: [],
    previews: [],
    knowledgeSources: [],
    promptContext: "",
  };

  if (tenantId !== "tecfag") {
    return emptyResult;
  }

  const intent = isVtexOrProductAssistantQuery(userQuery, recentHistoryText);
  if (!forceLookup && !intent.shouldQueryVtex) {
    return emptyResult;
  }

  const { settings, credentials } = await resolveVtexAssistantSettings(tenantId);
  const baseApiUrl = `https://${encodeURIComponent(settings.account)}.vtexcommercestable.com.br`;
  const headers = vtexHeaders(credentials);

  const products: FullVtexProductRecord[] = [];
  const seenProductIds = new Set<string>();

  // 1. Verifica se o operador colou um link direto da VTEX (ex: https://www.tecfag.com.br/envasadora.../p)
  const urlSlugMatch = `${userQuery} ${recentHistoryText}`.match(
    /tecfag\.com\.br\/([^\s/?#]+)\/p\b/i
  );
  if (urlSlugMatch?.[1]) {
    const slug = urlSlugMatch[1].trim();
    const searchUrl = `${baseApiUrl}/api/catalog_system/pub/products/search/${encodeURIComponent(slug)}/p?sc=${encodeURIComponent(settings.salesChannel)}`;
    const payload = await fetchJsonWithTimeout(
      searchUrl,
      { method: "GET", headers },
      settings.timeoutMs
    );
    const rows = Array.isArray(payload) ? payload : [];
    for (const row of rows) {
      const parsed = parseVtexApiProductRow(row, settings, null, null);
      if (parsed && !seenProductIds.has(parsed.productId)) {
        seenProductIds.add(parsed.productId);
        products.push(parsed);
      }
    }
  }

  // 2. Verifica se há um SKU explícito na mensagem (ex: "SKU 865")
  const explicitSkuMatch = userQuery.match(/\bsku\s*[:#-]?\s*(\d{1,8})\b/i);
  if (explicitSkuMatch?.[1] && products.length === 0) {
    const skuId = explicitSkuMatch[1];
    const searchUrl = `${baseApiUrl}/api/catalog_system/pub/products/search?fq=skuId:${encodeURIComponent(skuId)}&sc=${encodeURIComponent(settings.salesChannel)}`;
    const payload = await fetchJsonWithTimeout(
      searchUrl,
      { method: "GET", headers },
      settings.timeoutMs
    );
    const rows = Array.isArray(payload) ? payload : [];
    for (const row of rows) {
      const parsed = parseVtexApiProductRow(row, settings, skuId, null);
      if (parsed && !seenProductIds.has(parsed.productId)) {
        seenProductIds.add(parsed.productId);
        products.push(parsed);
      }
    }
  }

  // 3. Cruza com o Catálogo Oficial Tecfag (1.037 itens) para buscar pelo SKU exato ou nome
  const catalogCandidates = findCatalogCandidatesForVtex(
    userQuery,
    recentHistoryText,
    3
  );

  for (const candidate of catalogCandidates) {
    if (products.length >= 3) break;
    const sku = String(candidate.sku || "").trim();
    const cacheKey = `${tenantId}:${sku || candidate.code || candidate.name}`;
    const cached = vtexProductCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < VTEX_CACHE_TTL_MS) {
      if (!seenProductIds.has(cached.record.productId)) {
        seenProductIds.add(cached.record.productId);
        products.push({ ...cached.record });
      }
      continue;
    }

    let foundRecord: FullVtexProductRecord | null = null;

    if (sku) {
      const skuSearchUrl = `${baseApiUrl}/api/catalog_system/pub/products/search?fq=skuId:${encodeURIComponent(sku)}&sc=${encodeURIComponent(settings.salesChannel)}`;
      const payload = await fetchJsonWithTimeout(
        skuSearchUrl,
        { method: "GET", headers },
        settings.timeoutMs
      );
      const rows = Array.isArray(payload) ? payload : [];
      if (rows[0]) {
        foundRecord = parseVtexApiProductRow(rows[0], settings, sku, candidate);
      }
    }

    if (!foundRecord && candidate.name) {
      const cleanSearchTerm = candidate.name
        .replace(/\(.*?\)/g, " ")
        .replace(/\b(?:220v|110v|380v|monofasic[oa]|trifasic[oa])\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 65);
      const ftUrl = `${baseApiUrl}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(cleanSearchTerm)}&_from=0&_to=3&sc=${encodeURIComponent(settings.salesChannel)}`;
      const payload = await fetchJsonWithTimeout(
        ftUrl,
        { method: "GET", headers },
        settings.timeoutMs
      );
      const rows = Array.isArray(payload) ? payload : [];
      if (rows[0]) {
        foundRecord = parseVtexApiProductRow(
          rows[0],
          settings,
          sku || null,
          candidate
        );
      }
    }

    if (foundRecord) {
      vtexProductCache.set(cacheKey, {
        timestamp: Date.now(),
        record: foundRecord,
      });
      if (!seenProductIds.has(foundRecord.productId)) {
        seenProductIds.add(foundRecord.productId);
        products.push(foundRecord);
      }
    }
  }

  // 4. Fallback: Busca full-text direta na VTEX se não achou pelo catálogo local
  if (products.length === 0) {
    const cleanedQuery = userQuery
      .replace(
        /\b(qual|quais|quanto|custa|valor|preco|preço|da|do|de|na|no|vtex|site|link|me|passa|manda|fala|sobre|mais|informacoes|informações|detalhes|preciso|saber|ler|pagina|página|inteira|toda|maquina|máquina|equipamento)\b/gi,
        " "
      )
      .replace(/[?!.,;:"']/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (cleanedQuery.length >= 2) {
      const ftUrl = `${baseApiUrl}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(cleanedQuery.slice(0, 70))}&_from=0&_to=3&sc=${encodeURIComponent(settings.salesChannel)}`;
      const payload = await fetchJsonWithTimeout(
        ftUrl,
        { method: "GET", headers },
        settings.timeoutMs
      );
      const rows = Array.isArray(payload) ? payload : [];
      for (const row of rows.slice(0, 2)) {
        const parsed = parseVtexApiProductRow(row, settings, null, null);
        if (parsed && !seenProductIds.has(parsed.productId)) {
          seenProductIds.add(parsed.productId);
          products.push(parsed);
        }
      }
    }
  }

  if (products.length === 0) {
    return emptyResult;
  }

  // 5. Leitura completa da página do produto principal na VTEX (HTML + JSON-LD + OpenGraph)
  // e simulação opcional de frete se o operador informou um CEP
  await Promise.all(
    products.slice(0, 2).map(async (product, idx) => {
      if (idx === 0 || intent.wantsFullPageRead) {
        const pageData = await fetchFullVtexProductPage(
          product.url,
          settings.timeoutMs
        );
        if (pageData.success) {
          product.fullPageContent = pageData.fullPageText;
          product.pageJsonLdSummary = pageData.jsonLdSummary;
          product.pageReadComplete = true;
          if (!product.imageUrl && pageData.ogImage) {
            product.imageUrl = cleanVtexImageUrl(pageData.ogImage);
          }
          if (!product.description && pageData.ogDescription) {
            product.description = pageData.ogDescription;
          }
        }
      }

      if (idx === 0 && intent.postalCode && product.skuId) {
        const simUrl = `${baseApiUrl}/api/checkout/pub/orderForms/simulation?sc=${encodeURIComponent(settings.salesChannel)}`;
        const simPayload = await fetchJsonWithTimeout(
          simUrl,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              items: [
                {
                  id: product.skuId,
                  quantity: 1,
                  seller: settings.sellerId || "1",
                },
              ],
              postalCode: intent.postalCode,
              country: "BRA",
            }),
          },
          settings.timeoutMs
        );
        const slas = Array.isArray(simPayload?.logisticsInfo?.[0]?.slas)
          ? simPayload.logisticsInfo[0].slas
          : [];
        if (slas.length > 0) {
          product.shippingOptions = slas.slice(0, 4).map((sla: any) => ({
            id: String(sla.id || "frete"),
            name: String(sla.name || sla.id || "Transportadora"),
            priceFormatted:
              formatBrlCents(
                Number.isFinite(Number(sla.price)) ? Math.round(Number(sla.price)) : null
              ) || "R$ 0,00",
            estimate: typeof sla.shippingEstimate === "string" ? sla.shippingEstimate : null,
          }));
        }
      }
    })
  );

  // 6. Construir os objetos `VtexProductPreviewItem` para o balão separado de preview e `KnowledgeSourceItem`
  const previews: VtexProductPreviewItem[] = products.map((p) => {
    const rawDesc =
      p.description ||
      p.metaDescription ||
      (p.fullPageContent ? p.fullPageContent.slice(0, 400) : "") ||
      "Equipamento industrial disponível na loja oficial Tecfag (VTEX).";
    const snippet =
      rawDesc.length > 260 ? `${rawDesc.slice(0, 257).trim()}...` : rawDesc;

    return {
      productId: p.productId,
      skuId: p.skuId,
      name: p.name,
      skuName: p.skuName,
      referenceCode: p.referenceCode,
      internalCode: p.internalCode,
      modelCode: p.modelCode,
      brand: p.brand,
      category: p.category,
      url: p.url,
      imageUrl: p.imageUrl,
      additionalImages: p.additionalImages.slice(0, 4),
      priceCents: p.priceCents,
      listPriceCents: p.listPriceCents,
      priceFormatted: p.priceFormatted,
      listPriceFormatted: p.listPriceFormatted,
      available: p.available,
      availableQuantity: p.availableQuantity,
      descriptionSnippet: snippet,
      fullDescription: p.description ? p.description.slice(0, 3000) : null,
      specificationsSummary: p.specificationsSummary.slice(0, 8),
      pageReadComplete: p.pageReadComplete,
      checkedAt: p.checkedAt,
    };
  });

  const knowledgeSources: KnowledgeSourceItem[] = products.map((p) => ({
    id: `vtex-live-${p.productId}-${p.skuId}`,
    kind: "vtex",
    title: `${p.name} (SKU ${p.skuId})`,
    code: p.internalCode
      ? `${p.internalCode} • SKU ${p.skuId}`
      : `SKU ${p.skuId}`,
    model: p.modelCode || p.skuName || p.name,
    folderOrCategory: p.pageReadComplete
      ? "Loja Oficial VTEX Ao Vivo • Leitura Completa da Página (/p)"
      : "Loja Oficial VTEX Ao Vivo • API Catalog System",
    excerptOrDetail: [
      p.priceFormatted ? `Preço público: ${p.priceFormatted}` : "Preço sob consulta",
      p.available ? "Disponível na loja" : "Indisponível / Sob encomenda",
      p.description ? p.description.slice(0, 180) : "",
    ]
      .filter(Boolean)
      .join(" • "),
    mediaUrl: p.imageUrl || undefined,
    url: p.url,
    verified: true,
  }));

  // 7. Montar o bloco de contexto detalhado para o prompt do Gemini
  const contextLines: string[] = [
    "══════════════════════════════════════════════════════════════════════════════",
    "🛒 DADOS EM TEMPO REAL DA LOJA VTEX & LEITURA COMPLETA DA PÁGINA DO PRODUTO NO SITE (www.tecfag.com.br)",
    "══════════════════════════════════════════════════════════════════════════════",
    "ATENÇÃO: Você acabou de consultar ao vivo a loja oficial da Tecfag na VTEX e leu a página completa do produto no site.",
    "Use estas informações reais (preço público atual, SKU, disponibilidade, especificações da página e descrição completa) combinadas com o Manual Técnico em PDF para responder com precisão total ao operador/gestor.",
    "IMPORTANTE SOBRE O LINK E PREVIEW: O sistema já enviará automaticamente um BALÃO SEPARADO DE MENSAGEM logo após a sua resposta com o Card de Preview Oficial da VTEX (contendo a foto da máquina na VTEX, preço, descritivo e botão clicável para abrir a página no site). Portanto, na sua resposta principal, traga todas as explicações técnicas, comerciais e valores, e avise que o link direto com a prévia da página está logo abaixo no balão separado!",
    "",
  ];

  for (const p of products) {
    contextLines.push(`▶ PRODUTO VTEX ENCONTRADO: "${p.name}"`);
    contextLines.push(
      `  • SKU VTEX: ${p.skuId} | ID Produto: ${p.productId}${p.internalCode ? ` | Código Interno ERP: ${p.internalCode}` : ""}${p.referenceCode ? ` | Ref: ${p.referenceCode}` : ""}`
    );
    contextLines.push(`  • Link Direto da Página no Site: ${p.url}`);
    if (p.imageUrl) {
      contextLines.push(`  • Imagem de Preview Oficial VTEX: ${p.imageUrl}`);
    }
    contextLines.push(
      `  • Preço Público Consultado na VTEX: ${p.priceFormatted || "Sob consulta na loja"}${p.listPriceFormatted && p.listPriceFormatted !== p.priceFormatted ? ` (Preço de tabela: ${p.listPriceFormatted})` : ""}`
    );
    contextLines.push(
      `  • Status de Estoque / Disponibilidade na VTEX: ${p.available ? `Disponível (${p.availableQuantity ?? "em estoque"})` : "Indisponível / Sob consulta"}`
    );
    if (p.category) {
      contextLines.push(`  • Categoria na Loja: ${p.category}`);
    }
    if (p.description) {
      contextLines.push(`  • Descrição Oficial na VTEX:\n${p.description.slice(0, 3500)}`);
    }
    if (p.specificationsSummary.length > 0) {
      contextLines.push(`  • Especificações Técnicas Cadastradas na VTEX:`);
      for (const spec of p.specificationsSummary) {
        contextLines.push(`    - ${spec.label}: ${spec.value}`);
      }
    }
    if (p.shippingOptions && p.shippingOptions.length > 0) {
      contextLines.push(
        `  • Simulação de Frete VTEX (CEP ${intent.postalCode}):`
      );
      for (const sh of p.shippingOptions) {
        contextLines.push(
          `    - ${sh.name}: ${sh.priceFormatted}${sh.estimate ? ` (Prazo: ${sh.estimate})` : ""}`
        );
      }
    }
    if (p.pageJsonLdSummary) {
      contextLines.push(`  • Dados Estruturados da Página (JSON-LD): ${p.pageJsonLdSummary}`);
    }
    if (p.fullPageContent) {
      contextLines.push(
        `  • Conteúdo Integral Lido da Página Web (${p.url}):\n${p.fullPageContent.slice(0, 4500)}`
      );
    }
    contextLines.push("");
  }

  return {
    invoked: true,
    wantsFullPageRead: intent.wantsFullPageRead,
    wantsPriceOrCommercial: intent.wantsPriceOrCommercial,
    wantsProductLink: intent.wantsProductLink,
    shouldSendSeparatePreviewBubble: previews.length > 0,
    products,
    previews,
    knowledgeSources,
    promptContext: contextLines.join("\n"),
  };
}
