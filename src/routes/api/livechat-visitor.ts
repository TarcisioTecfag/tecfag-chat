import { createAPIFileRoute } from "@tanstack/start/api";
import { getVisitorById, getVisitorPageviews, getChatHistory, getOrCreateActiveChat } from "@/lib/livechat/livechatStorage";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const APIRoute = createAPIFileRoute("/api/livechat/visitor/$visitorId")({
  GET: async ({ request, params }) => {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get("tenantId");
    if (!tenantId) return json({ error: "tenantId é obrigatório" }, 400);
    const { visitorId } = params;
    const visitor = await getVisitorById(tenantId, visitorId);
    if (!visitor) return json({ error: "Visitante não encontrado" }, 404);
    const pageviews = await getVisitorPageviews(tenantId, visitorId);
    const chat = await getOrCreateActiveChat(tenantId, visitorId);
    const messages = await getChatHistory(tenantId, chat.id, 50);
    return json({ visitor, pageviews, chat, messages });
  },
});