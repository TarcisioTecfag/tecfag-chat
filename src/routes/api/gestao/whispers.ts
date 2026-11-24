import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../lib/auth-session";
import {
  listOperatorWhispers,
  sendOperatorWhisper,
} from "../../../lib/valentina/operator-whisper-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function canManageOperatorWhispers(session: any): boolean {
  if (session?.operator?.role === "admin") return true;
  if (session?.permissions?.views?.monitor !== true) return false;
  const mon = session?.permissions?.monitor;
  return Boolean(
    mon?.canAccessLive === true ||
      mon?.canAccessAlerts === true ||
      mon?.canAccessAudits === true ||
      mon?.canAccessTasks === true,
  );
}

/**
 * GET /api/gestao/whispers
 * Lista sussurros/cobranças enviados aos vendedores do tenant (com status de leitura e ciência).
 *
 * POST /api/gestao/whispers
 * Dispara sussurro/cobrança híbrida via Fagner/Valentina (+ espelho na conversa quando vinculada).
 */
export const Route = createFileRoute("/api/gestao/whispers")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (!canManageOperatorWhispers(session)) {
          return new Response(
            JSON.stringify({
              error: "Permissão insuficiente para consultar sussurros de supervisão.",
              code: "FORBIDDEN",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const url = new URL(request.url);
        try {
          const result = await listOperatorWhispers({
            tenantId,
            operatorId: url.searchParams.get("operatorId"),
            operatorName: url.searchParams.get("operatorName"),
            dealId: url.searchParams.get("dealId"),
            conversationId: url.searchParams.get("conversationId"),
            priority: url.searchParams.get("priority"),
            status: url.searchParams.get("status"),
            dateFrom: url.searchParams.get("dateFrom"),
            dateTo: url.searchParams.get("dateTo"),
            limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 30,
          });
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          return new Response(
            JSON.stringify({ error: err?.message || "Erro ao listar sussurros." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      },

      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (!canManageOperatorWhispers(session)) {
          return new Response(
            JSON.stringify({
              error: "Permissão insuficiente para enviar sussurro de supervisão.",
              code: "FORBIDDEN",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        try {
          const body = (await request.json().catch(() => ({}))) as Record<string, any>;
          const source =
            body.source === "ui_crm" || body.source === "ui_monitor"
              ? body.source
              : "ui_monitor";

          const result = await sendOperatorWhisper({
            tenantId,
            message: String(body.message || ""),
            title: body.title ?? null,
            operatorId: body.operatorId ?? null,
            operatorName: body.operatorName ?? null,
            operatorEmail: body.operatorEmail ?? null,
            operatorIds: Array.isArray(body.operatorIds) ? body.operatorIds : null,
            sectorId: body.sectorId ?? null,
            sectorName: body.sectorName ?? null,
            dealId: body.dealId ?? null,
            conversationId: body.conversationId ?? null,
            priority: body.priority ?? "normal",
            senderName:
              typeof body.senderName === "string" && body.senderName.trim()
                ? body.senderName.trim()
                : session.operator.name,
            senderOperatorId: session.operator.id,
            senderRole: session.operator.role,
            asAiOnly: body.asAiOnly === true,
            rewriteWithAi: body.rewriteWithAi === true,
            tone: body.tone ?? "consultivo",
            mirrorInConversation:
              typeof body.mirrorInConversation === "boolean"
                ? body.mirrorInConversation
                : undefined,
            assignConversation: body.assignConversation === true,
            source,
          });

          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          const message = err?.message || "Erro ao enviar sussurro.";
          const status = /não encontrad|obrigatór|inválid|ambígu|exceder|incompatív|exige/i.test(
            message,
          )
            ? 400
            : 500;
          return new Response(JSON.stringify({ error: message }), {
            status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
