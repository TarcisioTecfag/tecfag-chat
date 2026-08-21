// ══════════════════════════════════════════════════════════════════════════════
// 🛍️ TRAY CATALOG SERVICE
// Busca produtos e variações na API REST da Tray Commerce.
// Auth: OAuth2 (access_token com TTL ~3h, auto-refresh via refresh_token).
// Rate limit: 180 req/min, 10.000 req/dia.
// api_address: https://valemvalvulaseembalagens.corpsuite.com.br/web_api
// ══════════════════════════════════════════════════════════════════════════════

import { db } from "../../db";
import { lcTrayConfig } from "../../db/schema";
import { eq } from "drizzle-orm";

export interface TrayProduct {
  id: number;
  name: string;
  price: number;
  priceMin?: number;
  stock: number;
  imageUrl?: string;
  productUrl?: string;
  description?: string;
  brand?: string;
  sku?: string;
}

export interface TrayVariant {
  id: number;
  productId: number;
  sku?: string;
  price?: number;
  stock?: number;
  attributes: Record<string, string>;
}

// ── Mock data para homologação sem credenciais Tray ───────────────────────────
const MOCK_PRODUCTS: TrayProduct[] = [
  {
    id: 1001,
    name: "Válvula Spray 24/410 - 80mm",
    price: 0.89,
    priceMin: 0.75,
    stock: 48000,
    imageUrl: "https://placehold.co/200x200?text=Valvula+Spray",
    productUrl: "https://valemvalvulaseembalagens.corpsuite.com.br/valvula-spray-24-410",
    description: "Válvula spray para frascos com rosca 24/410.",
    brand: "Valem",
    sku: "VAL-24-410-80",
  },
  {
    id: 1002,
    name: "Frasco PET 200ml Tampa Rosca",
    price: 1.45,
    stock: 22000,
    imageUrl: "https://placehold.co/200x200?text=Frasco+PET",
    productUrl: "https://valemvalvulaseembalagens.corpsuite.com.br/frasco-pet-200ml",
    description: "Frasco PET 200ml transparente com tampa de rosca 24/410.",
    brand: "Valem",
    sku: "FRA-PET-200-RT",
  },
  {
    id: 1003,
    name: "Válvula Pump 28/410 Dosadora",
    price: 1.20,
    stock: 15000,
    imageUrl: "https://placehold.co/200x200?text=Pump+28",
    productUrl: "https://valemvalvulaseembalagens.corpsuite.com.br/valvula-pump-28-410",
    description: "Válvula pump dosadora 28/410 para sabonete e loção.",
    brand: "Valem",
    sku: "VAL-PUMP-28-410",
  },
];

async function getTrayConfig(tenantId: string) {
  const [config] = await db
    .select()
    .from(lcTrayConfig)
    .where(eq(lcTrayConfig.tenantId, tenantId))
    .limit(1);
  return config ?? null;
}

async function refreshAccessToken(config: NonNullable<Awaited<ReturnType<typeof getTrayConfig>>>): Promise<string | null> {
  if (!config.apiAddress || !config.refreshToken) return null;
  try {
    const url = `${config.apiAddress}/auth?refresh_token=${config.refreshToken}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;
    const data: any = await res.json();
    const newToken: string = data?.access_token;
    const expiresAt = data?.date_expiration_access_token
      ? new Date(data.date_expiration_access_token)
      : new Date(Date.now() + 3 * 60 * 60 * 1000);
    await db.update(lcTrayConfig).set({ accessToken: newToken, accessTokenExpiresAt: expiresAt, updatedAt: new Date() }).where(eq(lcTrayConfig.tenantId, config.tenantId));
    return newToken;
  } catch { return null; }
}

async function getValidAccessToken(tenantId: string): Promise<string | null> {
  const config = await getTrayConfig(tenantId);
  if (!config?.accessToken) return null;
  const now = new Date();
  if (config.accessTokenExpiresAt && config.accessTokenExpiresAt.getTime() - now.getTime() < 10 * 60 * 1000) {
    return refreshAccessToken(config);
  }
  return config.accessToken;
}

async function trayGet(apiAddress: string, token: string, path: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${apiAddress}${path}${sep}access_token=${token}`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Tray API ${res.status}: ${path}`);
  return res.json();
}

export async function searchProducts(tenantId: string, searchTerm: string, limit = 3): Promise<TrayProduct[]> {
  try {
    const token = await getValidAccessToken(tenantId);
    if (!token) {
      console.log("[TrayCatalog] Sem credenciais — usando mock.");
      const q = searchTerm.toLowerCase();
      return MOCK_PRODUCTS.filter(p => p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q)).slice(0, limit);
    }
    const config = await getTrayConfig(tenantId);
    if (!config) return [];
    const data = await trayGet(config.apiAddress, token, `/products?name=${encodeURIComponent(searchTerm)}&limit=${limit}&status=1`);
    return (data?.Products || []).map((p: any) => ({
      id: Number(p.Product?.id),
      name: p.Product?.name || "",
      price: parseFloat(p.Product?.price || "0"),
      priceMin: parseFloat(p.Product?.price_min || "0"),
      stock: parseInt(p.Product?.stock_total || "0", 10),
      imageUrl: p.Product?.images?.[0]?.https || undefined,
      productUrl: p.Product?.url || undefined,
      description: p.Product?.description || undefined,
      brand: p.Product?.brand || undefined,
      sku: p.Product?.reference || undefined,
    }));
  } catch (e: any) {
    console.error("[TrayCatalog] Erro na busca:", e?.message);
    return MOCK_PRODUCTS.slice(0, limit);
  }
}

export async function getProductVariants(tenantId: string, productId: number): Promise<TrayVariant[]> {
  try {
    const token = await getValidAccessToken(tenantId);
    if (!token) return [];
    const config = await getTrayConfig(tenantId);
    if (!config) return [];
    const data = await trayGet(config.apiAddress, token, `/products/${productId}/variants`);
    return (data?.Variants || []).map((v: any) => ({
      id: Number(v.Variant?.id), productId,
      sku: v.Variant?.sku, price: parseFloat(v.Variant?.price || "0"),
      stock: parseInt(v.Variant?.stock || "0", 10), attributes: v.Variant?.attributes || {},
    }));
  } catch (e: any) {
    console.error("[TrayCatalog] Erro variações:", e?.message);
    return [];
  }
}

export function extractSearchTermFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const slug = pathname.split("/").filter(Boolean).pop() || "";
    return slug.replace(/-/g, " ").replace(/\b\d{4,}\b/g, "").trim().slice(0, 60);
  } catch { return ""; }
}