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
        const search = normalizeForSearch(url.searchParams.get("search") || "");

        // ─── ENDPOINT 1: STREAMING DIRETO DE IMAGEM (RAW IMAGE) ───────────────
        if (action === "rawImage" && fileId) {
          try {
            const [file] = await db
              .select({ id: knowledgeFiles.id, name: knowledgeFiles.name, content: knowledgeFiles.content })
              .from(knowledgeFiles)
              .where(and(eq(knowledgeFiles.id, fileId), eq(knowledgeFiles.tenantId, tenantId)));

            if (!file) {
              return new Response("Imagem não encontrada", { status: 404, headers: corsHeaders });
            }

            const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
            const mimeMap: Record<string, string> = {
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              png: "image/png",
              webp: "image/webp",
              gif: "image/gif",
            };
            const mimeType = mimeMap[ext] || "image/jpeg";

            // 1. Tenta servir do disco físico
            const safeFileName = `${file.id}.${ext}`;
            const diskPath = path.join(MEDIA_DIR, safeFileName);
            if (fs.existsSync(diskPath)) {
              const fileBuffer = fs.readFileSync(diskPath);
              return new Response(fileBuffer, {
                headers: {
                  ...corsHeaders,
                  "Content-Type": mimeType,
                  "Cache-Control": "public, max-age=86400",
                },
              });
            }

            // 2. Extração rápida de Base64 sem regex pesado
            const content = file.content || "";
            const b64Start = content.indexOf("[BASE64:");
            if (b64Start !== -1) {
              const b64End = content.indexOf("]", b64Start + 8);
              const base64Str = b64End !== -1 ? content.slice(b64Start + 8, b64End) : content.slice(b64Start + 8);
              const imgBuffer = Buffer.from(base64Str, "base64");
              try {
                if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
                fs.writeFileSync(diskPath, imgBuffer);
              } catch {}
              return new Response(imgBuffer, {
                headers: {
                  ...corsHeaders,
                  "Content-Type": mimeType,
                  "Cache-Control": "public, max-age=86400",
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
            const [file] = await db
              .select({ id: knowledgeFiles.id, name: knowledgeFiles.name, content: knowledgeFiles.content })
              .from(knowledgeFiles)
              .where(and(eq(knowledgeFiles.id, fileId), eq(knowledgeFiles.tenantId, tenantId)));

            if (!file) {
              return new Response(JSON.stringify({ error: "Arquivo não encontrado" }), {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
            const mimeMap: Record<string, string> = {
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              png: "image/png",
              webp: "image/webp",
              gif: "image/gif",
            };
            const mimeType = mimeMap[ext] || "image/jpeg";

            const content = file.content || "";
            const b64Start = content.indexOf("[BASE64:");
            let base64 = "";
            if (b64Start !== -1) {
              const b64End = content.indexOf("]", b64Start + 8);
              base64 = b64End !== -1 ? content.slice(b64Start + 8, b64End) : content.slice(b64Start + 8);
            }

            // Fallback: se não tinha base64 na string content mas existe no disco
            if (!base64) {
              const safeFileName = `${file.id}.${ext}`;
              const diskPath = path.join(MEDIA_DIR, safeFileName);
              if (fs.existsSync(diskPath)) {
                base64 = fs.readFileSync(diskPath).toString("base64");
              }
            }

            return new Response(
              JSON.stringify({
                id: file.id,
                name: file.name,
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

          const realFiles: CatalogImageItem[] = [];
          const categoryCounts = new Map<string, number>();

          for (const f of files) {
            const ext = (f.name.split(".").pop() || "").toLowerCase();
            const isImageExt = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
            const isImage = f.type === "image" || isImageExt;

            if (!isImage) continue;

            const { displayName, sku } = extractSkuOrModel(f.name);
            const rawFolderName = f.folderId ? folderMap.get(f.folderId) || "" : "";
            const category =
              rawFolderName && rawFolderName.toLowerCase() !== "geral" ? rawFolderName : "";

            // Filtro de pesquisa opcional (insensível a acentos)
            if (search) {
              const searchable = normalizeForSearch(`${f.name} ${displayName} ${sku} ${category}`);
              const terms = search.split(/\s+/).filter(Boolean);
              const matchesAll = terms.every((term) => searchable.includes(term));
              if (!matchesAll) continue;
            }

            if (category) {
              categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
            }

            const mimeMap: Record<string, string> = {
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              png: "image/png",
              webp: "image/webp",
              gif: "image/gif",
            };
            const mimeType = mimeMap[ext] || "image/jpeg";
            const safeFileName = `${f.id}.${ext || "jpg"}`;

            realFiles.push({
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

          // Ordenação alfabética natural (pt-BR)
          realFiles.sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name, "pt-BR"));

          const categories = Array.from(categoryCounts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

          return new Response(
            JSON.stringify({
              items: realFiles,
              total: realFiles.length,
              categories,
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
