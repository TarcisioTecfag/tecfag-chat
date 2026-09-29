import { createFileRoute } from "@tanstack/react-router";
import fs from "fs";
import path from "path";
import { db } from "../../../db";
import { mediaFiles } from "../../../db/schema";
import { eq, and } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";

export const Route = createFileRoute("/api/baileys/media")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      },
      GET: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const url = new URL(request.url);
        const messageId = url.searchParams.get("messageId");

        if (!messageId) {
          return new Response(JSON.stringify({ error: "messageId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Consultar registro validando que pertence ao tenant autenticado
        const mediaRecord = await db.query.mediaFiles.findFirst({
          where: (table, { eq: dEq, and: dAnd }) =>
            dAnd(dEq(table.id, messageId), dEq(table.tenantId, tenantId)),
        });

        if (!mediaRecord) {
          return new Response(JSON.stringify({ error: "Mídia não encontrada" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const mediaDir = path.join(process.cwd(), "media");
        const filePath = path.join(mediaDir, messageId);
        const mimePath = path.join(mediaDir, `${messageId}.mime`);

        let buffer: Buffer;
        let contentType = mediaRecord.mimeType || "application/octet-stream";

        if (fs.existsSync(filePath)) {
          try {
            buffer = fs.readFileSync(filePath);
            if (fs.existsSync(mimePath)) {
              contentType = fs.readFileSync(mimePath, "utf-8").trim();
            }
          } catch (e: any) {
            console.error(`Erro ao ler mídia do disco:`, e);
            if (mediaRecord.base64Data) {
              buffer = Buffer.from(mediaRecord.base64Data, "base64");
            } else {
              return new Response(JSON.stringify({ error: "Erro ao ler arquivo" }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          }
        } else {
          try {
            if (!mediaRecord.base64Data) {
              return new Response(JSON.stringify({ error: "Conteúdo da mídia indisponível" }), {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            buffer = Buffer.from(mediaRecord.base64Data, "base64");

            // Recriar o arquivo em disco localmente para servir como cache
            try {
              if (!fs.existsSync(mediaDir)) {
                fs.mkdirSync(mediaDir, { recursive: true });
              }
              fs.writeFileSync(filePath, buffer);
              fs.writeFileSync(mimePath, contentType);
            } catch (cacheErr) {
              console.error(`Erro ao gravar cache da mídia ${messageId}:`, cacheErr);
            }
          } catch (dbErr: any) {
            console.error(`Erro ao processar mídia no banco ${messageId}:`, dbErr);
            return new Response(JSON.stringify({ error: "Erro ao carregar mídia" }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        return new Response(new Uint8Array(buffer), {
          headers: {
            ...corsHeaders,
            "Content-Type": contentType,
            "Cache-Control": "private, max-age=31536000",
          },
        });
      },
    },
  },
});
