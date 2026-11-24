import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../lib/auth-session";
import { acknowledgeOperatorWhisper } from "../../../lib/valentina/operator-whisper-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * POST /api/valentina/whisper-ack
 * Permite que o operador autenticado confirme ciência ("Ciente") de um sussurro recebido.
 * Isolamento rigoroso: somente o próprio destinatário no mesmo tenant pode confirmar ciência.
 */
export const Route = createFileRoute("/api/valentina/whisper-ack")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        try {
          const body = (await request.json().catch(() => ({}))) as {
            whisperId?: string;
            note?: string | null;
          };
          const whisperId = String(body.whisperId || "").trim();
          if (!whisperId) {
            return new Response(
              JSON.stringify({ error: "whisperId é obrigatório." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          const result = await acknowledgeOperatorWhisper({
            tenantId,
            operatorId: session.operator.id,
            whisperId,
            note: body.note ?? null,
          });

          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          const msg = err?.message || "Erro ao confirmar ciência do sussurro.";
          const status = /não encontrado|obrigatór|não é um sussurro/i.test(msg) ? 404 : 400;
          return new Response(JSON.stringify({ error: msg }), {
            status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
