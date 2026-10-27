import { createFileRoute } from "@tanstack/react-router";
import { getVisitorJourneyDetail } from "@/lib/livechat/livechatStorage";
import { requireSession } from "@/lib/auth-session";
import { canMonitorAllSiteVisitors } from "@/lib/access-control/channel-permissions";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/livechat/journey")({
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

        const canAccess =
          session.permissions?.views?.contacts === true ||
          session.permissions?.views?.chat === true ||
          canMonitorAllSiteVisitors(session);

        if (!canAccess) {
          return new Response(JSON.stringify({ error: "Permissão insuficiente.", code: "FORBIDDEN" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const url = new URL(request.url, "http://localhost");
        const visitorId = url.searchParams.get("visitorId");
        const contactId = url.searchParams.get("contactId");

        if (!visitorId && !contactId) {
          return new Response(
            JSON.stringify({ error: "Informe visitorId ou contactId.", code: "BAD_REQUEST" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        try {
          const detail = await getVisitorJourneyDetail(tenantId, { visitorId, contactId });
          return new Response(JSON.stringify(detail), {
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
