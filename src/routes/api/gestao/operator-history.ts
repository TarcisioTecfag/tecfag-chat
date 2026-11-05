import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../lib/auth-session";
import { conversationReadRules } from "../../../lib/access-control/conversation-policy";
import { computeOperatorDailyHistory } from "../../../lib/operator-ranking-analytics";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/gestao/operator-history")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const rules = conversationReadRules(session);
        const views = session.permissions?.views;
        const monitor = session.permissions?.monitor;
        const analytics = session.permissions?.analytics;
        const canInspectOthers =
          !rules.ownOnly &&
          rules.others &&
          ((views?.monitor === true && monitor?.canAccessRanking === true) ||
            (views?.analytics === true && analytics?.canAccessOverview === true));

        if (!rules.enabled && !canInspectOthers) {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente para consultar histórico de operador.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        if (queryTenantId && queryTenantId !== tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const requestedOperatorId = url.searchParams.get("operatorId");
        if (requestedOperatorId && requestedOperatorId !== session.operator.id && !canInspectOthers) {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente para consultar histórico de outro operador.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const operatorId = requestedOperatorId || session.operator.id;

        try {
          const formattedHistory = await computeOperatorDailyHistory({
            tenantId,
            operatorId,
          });

          return new Response(JSON.stringify(formattedHistory), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[gestao/operator-history] ERRO:", e?.message);
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
