import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../../../db";
import { agentConfigs, knowledgeFiles } from "../../../db/schema";
import { getAiPersona } from "../../../lib/ai-persona";
import { parseSiteChannelSettings } from "../../../lib/livechat/site-channel-policy";
import {
  isValidSiteMediaTenantId,
  parseCatalogMediaFileParam,
  SITE_CATALOG_IMAGE_MIME_MAP,
} from "../../../lib/livechat/site-media-url";

/**
 * Rota pública read-only para servir imagens de catálogo (`format = "real"`,
 * apenas MIME de imagem) exibidas no widget do site.
 *
 * Segurança & Multi-tenant:
 * - Valida explicitamente `tenantId` + habilitação do canal Site para o tenant.
 * - Restringe `file`/`fileId` estritamente ao padrão `kf-...` (sem path traversal).
 * - Filtra obrigatoriamente `eq(knowledgeFiles.tenantId, tenantId)` e `format = "real"`.
 * - Serve EXCLUSIVAMENTE extensões de imagem (`png`, `jpg`, `jpeg`, `webp`, `gif`),
 *   jamais PDFs, manuais ou documentos internos.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEDIA_DIR = path.resolve(__dirname, "../../../../public/knowledge-media");

const tenantSiteEnabledCache = new Map<string, { enabled: boolean; expiresAt: number }>();
const SITE_ENABLED_CACHE_TTL_MS = 30_000;

async function isTenantSiteChannelEnabled(tenantId: string): Promise<boolean> {
  const cached = tenantSiteEnabledCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.enabled;
  }
  const persona = getAiPersona(tenantId);
  const [sdrRow] = await db
    .select({ config: agentConfigs.config })
    .from(agentConfigs)
    .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.agentType, "sdr")))
    .limit(1);
  const config = (sdrRow?.config as Record<string, unknown>) || {};
  const enabled =
    persona.triagePolicy === "industrial"
      ? parseSiteChannelSettings(true, config).enabled
      : Boolean(sdrRow);
  tenantSiteEnabledCache.set(tenantId, {
    enabled,
    expiresAt: Date.now() + SITE_ENABLED_CACHE_TTL_MS,
  });
  return enabled;
}

export const Route = createFileRoute("/api/livechat/catalog-media")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = (url.searchParams.get("tenantId") || "").trim();
        const rawFile = url.searchParams.get("file") || url.searchParams.get("fileId") || "";

        if (!isValidSiteMediaTenantId(tenantId)) {
          return new Response("Tenant inválido", { status: 400, headers: corsHeaders });
        }

        const parsed = parseCatalogMediaFileParam(rawFile);
        if (!parsed) {
          return new Response("Arquivo inválido", { status: 400, headers: corsHeaders });
        }

        try {
          const siteEnabled = await isTenantSiteChannelEnabled(tenantId);
          if (!siteEnabled) {
            return new Response("Canal do site indisponível", { status: 404, headers: corsHeaders });
          }

          const [meta] = await db
            .select({
              id: knowledgeFiles.id,
              name: knowledgeFiles.name,
              format: knowledgeFiles.format,
              type: knowledgeFiles.type,
            })
            .from(knowledgeFiles)
            .where(
              and(
                eq(knowledgeFiles.tenantId, tenantId),
                eq(knowledgeFiles.id, parsed.fileId),
                eq(knowledgeFiles.format, "real"),
              ),
            )
            .limit(1);

          if (!meta) {
            return new Response("Imagem não encontrada", { status: 404, headers: corsHeaders });
          }

          const extFromName = (meta.name.split(".").pop() || parsed.ext || "").toLowerCase();
          const mimeType = SITE_CATALOG_IMAGE_MIME_MAP[extFromName];
          if (!mimeType) {
            return new Response("Tipo de arquivo não permitido", { status: 403, headers: corsHeaders });
          }

          const etag = `"kf-${tenantId}-${meta.id}"`;
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

          const safeFileName = `${meta.id}.${extFromName}`;
          const diskPath = path.join(MEDIA_DIR, safeFileName);
          if (diskPath.startsWith(MEDIA_DIR) && fs.existsSync(diskPath)) {
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

          const [fileWithContent] = await db
            .select({ content: knowledgeFiles.content })
            .from(knowledgeFiles)
            .where(and(eq(knowledgeFiles.tenantId, tenantId), eq(knowledgeFiles.id, meta.id)))
            .limit(1);

          const content = fileWithContent?.content || "";
          const b64Start = content.indexOf("[BASE64:");
          if (b64Start === -1) {
            return new Response("Conteúdo de imagem indisponível", { status: 404, headers: corsHeaders });
          }
          const b64End = content.indexOf("]", b64Start + 8);
          const base64Str =
            b64End !== -1 ? content.slice(b64Start + 8, b64End) : content.slice(b64Start + 8);
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
        } catch (err: any) {
          console.error("[livechat/catalog-media] Erro ao servir imagem pública:", err?.message || err);
          return new Response("Erro ao carregar imagem", { status: 500, headers: corsHeaders });
        }
      },
    },
  },
});
