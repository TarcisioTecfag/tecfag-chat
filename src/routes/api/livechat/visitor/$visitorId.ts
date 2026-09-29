import { createFileRoute } from "@tanstack/react-router";
import {
  getVisitorById,
  getVisitorPageviews,
  getChatHistory,
  getOrCreateActiveChat,
} from "@/lib/livechat/livechatStorage";
import { requireSession } from "@/lib/auth-session";

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
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

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