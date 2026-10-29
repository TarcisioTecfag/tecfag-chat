/**
 * Extrai todos os produtos da loja VTEX da Tecfag (Nome, Descrição limpa, Valor, SKU e Categoria)
 * e gera o arquivo de seed `scripts/data/tecfag-vtex-products-seed.json` para carga automática no deploy.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VTEX_ACCOUNT = "tecfag";
const SALES_CHANNEL = "1";
const SELLER_ID = "1";
const OUTPUT_FILE = path.join(__dirname, "data", "tecfag-vtex-products-seed.json");

const HTML_NAMED_ENTITIES = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  ndash: "–",
  mdash: "—",
  bull: "•",
  hellip: "…",
  deg: "°",
  ordm: "º",
  ordf: "ª",
  sup2: "²",
  sup3: "³",
  times: "×",
  divide: "÷",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
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
};

function decodeHtmlEntitiesOnce(input) {
  return String(input || "")
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    })
    .replace(/&([a-zA-Z0-9]+);/g, (full, name) => {
      if (name in HTML_NAMED_ENTITIES) return HTML_NAMED_ENTITIES[name];
      const lower = name.toLowerCase();
      if (lower in HTML_NAMED_ENTITIES) return HTML_NAMED_ENTITIES[lower];
      return full;
    });
}

function decodeHtmlEntities(input) {
  if (!input) return "";
  return decodeHtmlEntitiesOnce(decodeHtmlEntitiesOnce(input));
}

function cleanHtmlText(html, maxChars = 4000) {
  if (!html) return "";
  const text = decodeHtmlEntities(
    String(html)
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
    .filter((line) => line.length > 0)
    .join("\n");

  return text.slice(0, maxChars).trim();
}

function cleanCategory(rawCategories) {
  if (!Array.isArray(rawCategories) || rawCategories.length === 0) return null;
  const first = String(rawCategories[0] || "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  return first.length > 0 ? first.join(" > ") : null;
}

function extractProductRecord(row) {
  const productId = String(row?.productId || "").trim();
  const rawName = cleanHtmlText(row?.productName || "", 300).replace(/\s+/g, " ");
  if (!productId || !rawName) return null;

  const items = Array.isArray(row?.items) ? row.items : [];
  let chosenItem = items[0] || null;
  let chosenPrice = 0;

  for (const item of items) {
    const sellers = Array.isArray(item?.sellers) ? item.sellers : [];
    const seller =
      sellers.find((s) => String(s?.sellerId || "") === SELLER_ID) ||
      sellers.find((s) => s?.sellerDefault) ||
      sellers[0];
    const offer = seller?.commertialOffer || {};
    const price = Number(offer.Price || 0);
    const listPrice = Number(offer.ListPrice || 0);
    const candidatePrice = price > 0 ? price : listPrice > 0 ? listPrice : 0;
    if (candidatePrice > 0) {
      chosenItem = item;
      chosenPrice = candidatePrice;
      break;
    }
  }

  const refList = Array.isArray(chosenItem?.referenceId) ? chosenItem.referenceId : [];
  const sku =
    String(
      refList.find((r) => r?.Key === "RefId")?.Value ||
        refList[0]?.Value ||
        row?.productReference ||
        chosenItem?.itemId ||
        productId
    ).trim() || null;

  const rawDesc =
    row?.description ||
    (Array.isArray(row?.["Descrição"]) ? row["Descrição"][0] : "") ||
    row?.metaTagDescription ||
    "";
  const description = cleanHtmlText(rawDesc, 4000) || null;
  const category = cleanCategory(row?.categories);
  const unitPrice = Number.isFinite(chosenPrice) && chosenPrice >= 0 ? chosenPrice.toFixed(2) : "0.00";

  return {
    id: `prod-vtex-${productId}`,
    vtexProductId: productId,
    name: rawName,
    sku,
    description,
    unitPrice,
    unit: "UN",
    category,
    isActive: true,
  };
}

async function main() {
  console.log(`🛒 Buscando catálogo completo na VTEX (${VTEX_ACCOUNT})...`);
  const allRaw = [];
  const step = 50;

  for (let from = 0; from < 2500; from += step) {
    const to = from + step - 1;
    const url = `https://${VTEX_ACCOUNT}.vtexcommercestable.com.br/api/catalog_system/pub/products/search?sc=${SALES_CHANNEL}&_from=${from}&_to=${to}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Tecfag-CRM-Sync/1.0",
      },
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`Falha ao consultar VTEX (${from}-${to}): HTTP ${res.status}`);
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    allRaw.push(...batch);
    process.stdout.write(`\r  → Recebidos ${allRaw.length} produtos...`);
    if (batch.length < step) break;
  }

  console.log("\n✅ Download concluído. Processando produtos...");

  const byId = new Map();
  for (const row of allRaw) {
    const rec = extractProductRecord(row);
    if (rec && !byId.has(rec.id)) {
      byId.set(rec.id, rec);
    }
  }

  const products = Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR")
  );

  const dir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const payload = {
    generatedAt: new Date().toISOString(),
    account: VTEX_ACCOUNT,
    total: products.length,
    products,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log(`🎉 Seed salvo em ${OUTPUT_FILE} com ${products.length} produtos únicos!`);
}

main().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
