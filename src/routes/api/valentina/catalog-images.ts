import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { knowledgeFiles, knowledgeFolders } from "../../../db/schema";
import { eq, and } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { requireSession } from "../../../lib/auth-session";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEDIA_DIR = path.resolve(__dirname, "../../../../public/knowledge-media");

export interface CatalogImageItem {
  id: string;
  name: string;
  displayName?: string;
  sku: string;
  category?: string;
  folderId?: string | null;
  mediaUrl: string;
  thumbnailUrl: string;
  mimeType: string;
  size: string;
  type: string;
  uploadedAt: string;
}

function normalizeForSearch(str: string): string {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function extractSkuOrModel(fileName: string): { displayName: string; sku: string } {
  const displayName = fileName.replace(/\.(jpg|jpeg|png|webp|gif)$/i, "").trim();

  // 1. Padrão numérico entre colchetes ou no início (ex: "[180013] Válvula...")
  const numericSkuMatch = displayName.match(/^\[?(\d{4,8})\]?/);
  if (numericSkuMatch) {
    return { displayName, sku: numericSkuMatch[1] };
  }

  // 2. Padrão de código/modelo de máquina Tecfag após " - " (ex: "Seladora Contínua - FR900", "Arqueadora - AP8060C")
  const dashParts = displayName.split(/\s+-\s+/);
  if (dashParts.length >= 2) {
    const candidate = dashParts[dashParts.length - 1].trim();
    if (
      candidate.length >= 2 &&
      candidate.length <= 22 &&
      (/\d/.test(candidate) || /^[A-Z0-9\s./-]{2,14}$/.test(candidate))
    ) {
      return { displayName, sku: candidate };
    }
  }

  return { displayName, sku: "" };
}

interface CachedTenantCatalog {
  timestamp: number;
  items: CatalogImageItem[];
  categories: Array<{ name: string; count: number }>;
  byId: Map<string, { id: string; name: string }>;
  byNormalizedName: Map<string, { id: string; name: string }>;
}

const catalogCacheByTenant = new Map<string, CachedTenantCatalog>();
const CATALOG_SERVER_CACHE_TTL_MS = 45_000;

export function invalidateCatalogImagesCache(tenantId?: string) {
  if (tenantId) {
    catalogCacheByTenant.delete(tenantId);
  } else {
    catalogCacheByTenant.clear();
  }
}

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export const Route = createFileRoute("/api/valentina/catalog-images")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const url = new URL(request.url);
        const action = url.searchParams.get("action");
        const fileId = url.searchParams.get("fileId");
        const fileNameParam = url.searchParams.get("fileName");
        const search = normalizeForSearch(url.searchParams.get("search") || "");

        // ─── ENDPOINT 1: STREAMING DIRETO DE IMAGEM (RAW IMAGE — ZERO TOAST SE EM DISCO) ───
        if (action === "rawImage" && (fileId || fileNameParam)) {
          try {
            let meta: { id: string; name: string } | undefined;
            const cachedTenant = catalogCacheByTenant.get(tenantId);

            if (fileId && cachedTenant?.byId.has(fileId)) {
              meta = cachedTenant.byId.get(fileId);
            } else if (fileNameParam && cachedTenant) {
              meta = cachedTenant.byNormalizedName.get(normalizeForSearch(fileNameParam));
            }

            // 1.1 Se não estava no cache em memória, busca APENAS { id, name } (SEM a coluna 'content' de 230KB!)
            if (!meta) {
              if (fileId) {
                const [row] = await db
                  .select({ id: knowledgeFiles.id, name: knowledgeFiles.name })
                  .from(knowledgeFiles)
                  .where(and(eq(knowledgeFiles.id, fileId), eq(knowledgeFiles.tenantId, tenantId)));
                if (row) meta = row;
              } else if (fileNameParam) {
                const [exactRow] = await db
                  .select({ id: knowledgeFiles.id, name: knowledgeFiles.name })
                  .from(knowledgeFiles)
                  .where(and(eq(knowledgeFiles.name, fileNameParam), eq(knowledgeFiles.tenantId, tenantId)));
                if (exactRow) {
                  meta = exactRow;
                } else {
                  const allRows = await db
                    .select({ id: knowledgeFiles.id, name: knowledgeFiles.name })
                    .from(knowledgeFiles)
                    .where(eq(knowledgeFiles.tenantId, tenantId));
                  const targetNorm = normalizeForSearch(fileNameParam.replace(/\.(jpg|jpeg|png|webp|gif)$/i, ""));
                  meta = allRows.find((r) => {
                    const rNorm = normalizeForSearch(r.name.replace(/\.(jpg|jpeg|png|webp|gif)$/i, ""));
                    return rNorm === targetNorm || rNorm.includes(targetNorm) || targetNorm.includes(rNorm);
                  });
                }
              }
            }

            if (!meta) {
              return new Response("Imagem não encontrada", { status: 404, headers: corsHeaders });
            }

            const etag = `"kf-${meta.id}"`;
            if (request.headers.get("if-none-match") === etag) {
              return new Response(null, {
                status: 304,
                headers: {
                  ...corsHeaders,
                  ETag: etag,
                  "Cache-Control": "public, max-age=604800, immutable",
                },
              });
            }

            const ext = (meta.name.split(".").pop() || "jpg").toLowerCase();
            const mimeType = MIME_MAP[ext] || "image/jpeg";
            const safeFileName = `${meta.id}.${ext}`;
            const diskPath = path.join(MEDIA_DIR, safeFileName);

            // 1.2 Tenta servir do disco físico ANTES de tocar na coluna TOAST 'content' do PostgreSQL!
            if (fs.existsSync(diskPath)) {
              const fileBuffer = await fs.promises.readFile(diskPath);
              return new Response(fileBuffer, {
                headers: {
                  ...corsHeaders,
                  "Content-Type": mimeType,
                  ETag: etag,
                  "Cache-Control": "public, max-age=604800, immutable",
                },
              });
            }

            // 1.3 Cache miss em disco: busca 'content' no PostgreSQL apenas para este 1 arquivo e hidrata o disco
            const [fileWithContent] = await db
              .select({ content: knowledgeFiles.content })
              .from(knowledgeFiles)
              .where(and(eq(knowledgeFiles.id, meta.id), eq(knowledgeFiles.tenantId, tenantId)));

            const content = fileWithContent?.content || "";
            const b64Start = content.indexOf("[BASE64:");
            if (b64Start !== -1) {
              const b64End = content.indexOf("]", b64Start + 8);
              const base64Str = b64End !== -1 ? content.slice(b64Start + 8, b64End) : content.slice(b64Start + 8);
              const imgBuffer = Buffer.from(base64Str, "base64");
              try {
                if (!fs.existsSync(MEDIA_DIR)) await fs.promises.mkdir(MEDIA_DIR, { recursive: true });
                await fs.promises.writeFile(diskPath, imgBuffer);
              } catch {}
              return new Response(imgBuffer, {
                headers: {
                  ...corsHeaders,
                  "Content-Type": mimeType,
                  ETag: etag,
                  "Cache-Control": "public, max-age=604800, immutable",
                },
              });
            }

            return new Response("Conteúdo de imagem indisponível", { status: 404, headers: corsHeaders });
          } catch (err: any) {
            console.error("[catalog-images.ts] Erro ao servir imagem bruta:", err);
            return new Response("Erro ao carregar imagem", { status: 500, headers: corsHeaders });
          }
        }

        // ─── ENDPOINT 2: DADOS PARA ANEXAÇÃO (GET FILE BASE64) ────────────────
        if (action === "getFileData" && fileId) {
          try {
            const [meta] = await db
              .select({ id: knowledgeFiles.id, name: knowledgeFiles.name })
              .from(knowledgeFiles)
              .where(and(eq(knowledgeFiles.id, fileId), eq(knowledgeFiles.tenantId, tenantId)));

            if (!meta) {
              return new Response(JSON.stringify({ error: "Arquivo não encontrado" }), {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            const ext = (meta.name.split(".").pop() || "jpg").toLowerCase();
            const mimeType = MIME_MAP[ext] || "image/jpeg";
            const safeFileName = `${meta.id}.${ext}`;
            const diskPath = path.join(MEDIA_DIR, safeFileName);

            let base64 = "";
            if (fs.existsSync(diskPath)) {
              const buf = await fs.promises.readFile(diskPath);
              base64 = buf.toString("base64");
            } else {
              const [fileWithContent] = await db
                .select({ content: knowledgeFiles.content })
                .from(knowledgeFiles)
                .where(and(eq(knowledgeFiles.id, fileId), eq(knowledgeFiles.tenantId, tenantId)));
              const content = fileWithContent?.content || "";
              const b64Start = content.indexOf("[BASE64:");
              if (b64Start !== -1) {
                const b64End = content.indexOf("]", b64Start + 8);
                base64 = b64End !== -1 ? content.slice(b64Start + 8, b64End) : content.slice(b64Start + 8);
              }
            }

            return new Response(
              JSON.stringify({
                id: meta.id,
                name: meta.name,
                mimeType,
                base64,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          } catch (err: any) {
            return new Response(JSON.stringify({ error: err.message }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        // ─── ENDPOINT 3: LISTAGEM LEVE E INSTANTÂNEA DE METADADOS ────────────
        try {
          const forceRefresh = url.searchParams.get("refresh") === "1";
          let cached = catalogCacheByTenant.get(tenantId);

          if (!cached || forceRefresh || Date.now() - cached.timestamp > CATALOG_SERVER_CACHE_TTL_MS) {
            const folders = await db
              .select({
                id: knowledgeFolders.id,
                name: knowledgeFolders.name,
              })
              .from(knowledgeFolders)
              .where(eq(knowledgeFolders.tenantId, tenantId));

            const folderMap = new Map<string, string>();
            for (const folder of folders) {
              folderMap.set(folder.id, folder.name);
            }

            // Busca APENAS colunas leves de metadados (SEM a coluna 'content')
            const files = await db
              .select({
                id: knowledgeFiles.id,
                folderId: knowledgeFiles.folderId,
                name: knowledgeFiles.name,
                size: knowledgeFiles.size,
                type: knowledgeFiles.type,
                format: knowledgeFiles.format,
                uploadedAt: knowledgeFiles.uploadedAt,
              })
              .from(knowledgeFiles)
              .where(eq(knowledgeFiles.tenantId, tenantId));

            const allItems: CatalogImageItem[] = [];
            const categoryCounts = new Map<string, number>();
            const byId = new Map<string, { id: string; name: string }>();
            const byNormalizedName = new Map<string, { id: string; name: string }>();

            for (const f of files) {
              const ext = (f.name.split(".").pop() || "").toLowerCase();
              const isImageExt = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
              const isImage = f.type === "image" || isImageExt;

              if (!isImage) continue;

              byId.set(f.id, { id: f.id, name: f.name });
              byNormalizedName.set(normalizeForSearch(f.name), { id: f.id, name: f.name });

              const { displayName, sku } = extractSkuOrModel(f.name);
              byNormalizedName.set(normalizeForSearch(displayName), { id: f.id, name: f.name });

              const rawFolderName = f.folderId ? folderMap.get(f.folderId) || "" : "";
              const category =
                rawFolderName && rawFolderName.toLowerCase() !== "geral" ? rawFolderName : "";

              if (category) {
                categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
              }

              const mimeType = MIME_MAP[ext] || "image/jpeg";
              const safeFileName = `${f.id}.${ext || "jpg"}`;

              allItems.push({
                id: f.id,
                name: f.name,
                displayName,
                sku,
                category,
                folderId: f.folderId,
                mediaUrl: `/knowledge-media/${safeFileName}`,
                thumbnailUrl: `/api/valentina/catalog-images?action=rawImage&fileId=${f.id}`,
                mimeType,
                size: f.size || "100 KB",
                type: f.type || "image",
                uploadedAt: new Date(f.uploadedAt).toLocaleDateString("pt-BR"),
              });
            }

            allItems.sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name, "pt-BR"));

            const categories = Array.from(categoryCounts.entries())
              .map(([name, count]) => ({ name, count }))
              .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

            cached = {
              timestamp: Date.now(),
              items: allItems,
              categories,
              byId,
              byNormalizedName,
            };
            catalogCacheByTenant.set(tenantId, cached);
          }

          let filteredItems = cached.items;
          if (search) {
            const terms = search.split(/\s+/).filter(Boolean);
            filteredItems = cached.items.filter((item) => {
              const searchable = normalizeForSearch(
                `${item.name} ${item.displayName || ""} ${item.sku} ${item.category || ""}`
              );
              return terms.every((term) => searchable.includes(term));
            });
          }

          return new Response(
            JSON.stringify({
              items: filteredItems,
              total: filteredItems.length,
              categories: cached.categories,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } catch (error: any) {
          console.error("[catalog-images.ts] Erro ao listar fotos:", error);
          return new Response(JSON.stringify({ error: error.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
