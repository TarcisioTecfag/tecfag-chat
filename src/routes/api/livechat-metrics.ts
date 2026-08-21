import { createAPIFileRoute } from "@tanstack/start/api";
import { getLiveChatMetrics } from "@/lib/livechat/livechatStorage";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const APIRoute = createAPIFileRoute("/api/livechat/metrics")({
  GET: async ({ request }) => {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get("tenantId");
    if (!tenantId) return json({ error: "tenantId é obrigatório" }, 400);
    const hours = parseInt(url.searchParams.get("hours") || "24", 10);
    const metrics = await getLiveChatMetrics(tenantId, hours);
    return json(metrics);
  },
});