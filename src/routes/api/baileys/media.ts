import { createFileRoute } from "@tanstack/react-router";
import fs from "fs";
import path from "path";

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

        const url = new URL(request.url);
        const messageId = url.searchParams.get("messageId");

        if (!messageId) {
          return new Response(JSON.stringify({ error: "messageId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const mediaDir = path.join(process.cwd(), "media");
        const filePath = path.join(mediaDir, messageId);
        const mimePath = path.join(mediaDir, `${messageId}.mime`);

        // Verificar se a mídia existe no disco
        if (!fs.existsSync(filePath)) {
          return new Response(JSON.stringify({ error: "Mídia não encontrada ou expirada" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          // Ler os bytes da mídia
          const buffer = fs.readFileSync(filePath);

          // Obter mimetype salvo
          let contentType = "application/octet-stream";
          if (fs.existsSync(mimePath)) {
            contentType = fs.readFileSync(mimePath, "utf-8").trim();
          }

          return new Response(buffer, {
            headers: {
              ...corsHeaders,
              "Content-Type": contentType,
              "Cache-Control": "public, max-age=31536000",
            },
          });
        } catch (e: any) {
          console.error(`Erro ao ler arquivo de mídia ${messageId}:`, e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
