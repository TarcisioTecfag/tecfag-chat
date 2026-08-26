import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { knowledgeFiles } from "../../../db/schema";
import { eq } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const REAL_MEDIA_PATTERN = /^\[FORMATO_REAL:(\/knowledge-media\/[^\]]+)\]/;
const BASE64_PATTERN = /\[BASE64:([A-Za-z0-9+/=]+)\]/;

export interface CatalogImageItem {
  id: string;
  name: string;
  sku: string;
  mediaUrl: string;
  base64Data?: string;
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
        const search = (url.searchParams.get("search") || "").trim().toLowerCase();
        const includeBase64 = url.searchParams.get("includeBase64") !== "false";

        try {
          const files = await db
            .select()
            .from(knowledgeFiles)
            .where(eq(knowledgeFiles.tenantId, tenantId));

          const realFiles: CatalogImageItem[] = [];

          for (const f of files) {
            if (f.format !== "real" || !f.content) continue;

            const contentFull = f.content || "";
            const b64SplitIdx = contentFull.indexOf("[BASE64:");
            const contentPrefix = b64SplitIdx >= 0 ? contentFull.substring(0, b64SplitIdx) : contentFull;

            const urlMatch = contentPrefix.match(REAL_MEDIA_PATTERN);
            const mediaUrl = urlMatch ? urlMatch[1] : `/knowledge-media/${f.id}.jpg`;

            // Extrai SKU (ex: "[180013]" ou números no início do nome)
            const skuMatch = f.name.match(/\[?(\d{4,8})\]?/);
            const sku = skuMatch ? skuMatch[1] : "";

            // Filtro de pesquisa
            if (search) {
              const nameLower = f.name.toLowerCase();
              const skuLower = sku.toLowerCase();
              const terms = search.split(/\s+/).filter(Boolean);
              const matchesAll = terms.every(
                (term) => nameLower.includes(term) || skuLower.includes(term)
              );
              if (!matchesAll) continue;
            }

            // Deriva mimeType
            const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
            const mimeMap: Record<string, string> = {
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              png: "image/png",
              webp: "image/webp",
              gif: "image/gif",
            };
            const mimeType = mimeMap[ext] || "image/jpeg";

            let base64Data: string | undefined = undefined;
            if (includeBase64) {
              const b64Match = contentFull.match(BASE64_PATTERN);
              base64Data = b64Match ? b64Match[1] : undefined;
            }

            realFiles.push({
              id: f.id,
              name: f.name,
              sku,
              mediaUrl,
              base64Data,
              mimeType,
              size: f.size || "100 KB",
              type: f.type || "image",
              uploadedAt: new Date(f.uploadedAt).toLocaleDateString("pt-BR"),
            });
          }

          // Ordenação por nome
          realFiles.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

          return new Response(JSON.stringify({ items: realFiles, total: realFiles.length }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (error: any) {
          console.error("[catalog-images.ts] Erro ao listar fotos reais:", error);
          return new Response(JSON.stringify({ error: error.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
