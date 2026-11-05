import { createFileRoute } from "@tanstack/react-router";
import { getEnrichedSiteVisitorsOverview } from "@/lib/livechat/livechatStorage";
import { requireSession } from "@/lib/auth-session";
import { canMonitorAllSiteVisitors } from "@/lib/access-control/channel-permissions";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/livechat/visitors")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
      GET: async ({ request }: { request: Request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (!canMonitorAllSiteVisitors(session)) return Response.json({ error: "Permissão insuficiente." }, { status: 403 });

        try {
          const url = new URL(request.url, "http://localhost");
          const includeRecent = url.searchParams.get("includeRecent") === "1";
          const period = url.searchParams.get("period");
          const limitParam = Number(url.searchParams.get("limit") || 100);
          const { visitors, summary } = await getEnrichedSiteVisitorsOverview(tenantId, {
            includeRecent,
            period,
            limit: Number.isFinite(limitParam) ? limitParam : 100,
          });
          return new Response(JSON.stringify({ visitors, summary }), {
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
