import { createFileRoute } from "@tanstack/react-router";
import {
  getChatUpload,
  isAllowedChatUploadMime,
  saveChatUpload,
} from "../../lib/livechat/chat-upload-store";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/chat-upload")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const fileId = (url.searchParams.get("file") || "").trim();
        const found = getChatUpload(fileId);
        if (!found) {
          return new Response(JSON.stringify({ error: "Arquivo não encontrado." }), {
            status: 404,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }
        return new Response(found.buffer as unknown as BodyInit, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": found.mimeType,
            "Cache-Control": "public, max-age=86400",
          },
        });
      },

      POST: async ({ request }) => {
        try {
          const contentType = request.headers.get("content-type") || "";
          if (!contentType.includes("multipart/form-data")) {
            return new Response(JSON.stringify({ error: "Envie multipart/form-data." }), {
              status: 400,
              headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            });
          }

          const formData = await request.formData();
          const file = formData.get("file");
          if (!(file instanceof File)) {
            return new Response(JSON.stringify({ error: "Nenhum arquivo enviado." }), {
              status: 400,
              headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            });
          }

          if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
            return new Response(JSON.stringify({ error: "Arquivo excede o limite de 15MB." }), {
              status: 400,
              headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            });
          }

          const mimeType = (file.type || "").toLowerCase().trim();
          if (!isAllowedChatUploadMime(mimeType)) {
            return new Response(
              JSON.stringify({ error: "Tipo de arquivo não permitido. Use JPG, PNG, GIF, WEBP ou PDF." }),
              {
                status: 400,
                headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
              },
            );
          }

          const buffer = Buffer.from(await file.arrayBuffer());
          const saved = saveChatUpload({
            buffer,
            mimeType,
            originalName: file.name,
          });

          return new Response(
            JSON.stringify({
              url: saved.url,
              fileId: saved.fileId,
              fileName: saved.fileName,
              mimeType: saved.mimeType,
            }),
            {
              status: 200,
              headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            },
          );
        } catch (err: any) {
          return new Response(
            JSON.stringify({ error: err?.message || "Falha no upload do arquivo." }),
            {
              status: 400,
              headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            },
          );
        }
      },
    },
  },
});
