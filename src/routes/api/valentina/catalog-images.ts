import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { knowledgeFiles } from "../../../db/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
  sku: string;
  mediaUrl: string;
  thumbnailUrl: string;
  mimeType: string;
  size: string;
  type: string;
  uploadedAt: string;
}

export const Route = createFileRoute("/api/valentina/catalog-images")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") || "valem";
        const action = url.searchParams.get("action");
        const fileId = url.searchParams.get("fileId");
        const search = (url.searchParams.get("search") || "").trim().toLowerCase();

        // ─── ENDPOINT 1: STREAMING DIRETO DE IMAGEM (RAW IMAGE) ───────────────
        if (action === "rawImage" && fileId) {
          try {
            const [file] = await db
              .select({ id: knowledgeFiles.id, name: knowledgeFiles.name, content: knowledgeFiles.content })
              .from(knowledgeFiles)
              .where(eq(knowledgeFiles.id, fileId));

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
              .where(eq(knowledgeFiles.id, fileId));

            if (!file) {
              return new Response(JSON.stringify({ error: "Arquivo não encontrado" }), {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            const content = file.content || "";
            const b64Start = content.indexOf("[BASE64:");
            let base64 = "";
            if (b64Start !== -1) {
              const b64End = content.indexOf("]", b64Start + 8);
              base64 = b64End !== -1 ? content.slice(b64Start + 8, b64End) : content.slice(b64Start + 8);
            }

            return new Response(
              JSON.stringify({
                id: file.id,
                name: file.name,
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
          // Busca APENAS colunas leves de metadados (SEM a coluna 'content')
          const files = await db
            .select({
              id: knowledgeFiles.id,
              name: knowledgeFiles.name,
              size: knowledgeFiles.size,
              type: knowledgeFiles.type,
              format: knowledgeFiles.format,
              uploadedAt: knowledgeFiles.uploadedAt,
            })
            .from(knowledgeFiles)
            .where(eq(knowledgeFiles.tenantId, tenantId));

          const realFiles: CatalogImageItem[] = [];

          for (const f of files) {
            const ext = (f.name.split(".").pop() || "").toLowerCase();
            const isImageExt = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
            const isImage = f.format === "real" || f.type === "image" || isImageExt;

            if (!isImage) continue;

            // Extrai SKU (ex: "[180013]" ou números entre 4 e 8 dígitos no nome)
            const skuMatch = f.name.match(/\[?(\d{4,8})\]?/);
            const sku = skuMatch ? skuMatch[1] : "";

            // Filtro de pesquisa opcional
            if (search) {
              const nameLower = f.name.toLowerCase();
              const skuLower = sku.toLowerCase();
              const terms = search.split(/\s+/).filter(Boolean);
              const matchesAll = terms.every(
                (term) => nameLower.includes(term) || skuLower.includes(term)
              );
              if (!matchesAll) continue;
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
              sku,
              mediaUrl: `/knowledge-media/${safeFileName}`,
              thumbnailUrl: `/api/valentina/catalog-images?tenantId=${tenantId}&action=rawImage&fileId=${f.id}`,
              mimeType,
              size: f.size || "100 KB",
              type: f.type || "image",
              uploadedAt: new Date(f.uploadedAt).toLocaleDateString("pt-BR"),
            });
          }

          // Ordenação alfabética
          realFiles.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

          return new Response(JSON.stringify({ items: realFiles, total: realFiles.length }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
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
