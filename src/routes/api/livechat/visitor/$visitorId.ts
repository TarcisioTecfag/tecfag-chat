import { createFileRoute } from "@tanstack/react-router";
import {
  getVisitorById,
  getVisitorPageviews,
  getChatHistory,
  getOrCreateActiveChat,
} from "@/lib/livechat/livechatStorage";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/livechat/visitor/$visitorId")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
      GET: async ({ request, params }: { request: Request; params: { visitorId: string } }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { visitorId } = params;
        try {
          const visitor = await getVisitorById(tenantId, visitorId);
          if (!visitor) {
            return new Response(JSON.stringify({ error: "Visitante não encontrado" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          const pageviews = await getVisitorPageviews(tenantId, visitorId);
          const chat = await getOrCreateActiveChat(tenantId, visitorId);
          const messages = await getChatHistory(tenantId, chat.id, 50);
          return new Response(JSON.stringify({ visitor, pageviews, chat, messages }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e?.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});