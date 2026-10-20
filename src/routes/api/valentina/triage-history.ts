import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { requireSession } from "../../../lib/auth-session";
import { getAiPersona } from "../../../lib/ai-persona";
import {
  HistoryInputError,
  historyPageInput,
  type HistoryMode,
} from "../../../lib/triage/triage-history-pagination";
import {
  HistoryNotFoundError,
  historyQueryScope,
  listHistoryConversations,
  listHistoryCycles,
  listHistoryEvents,
} from "../../../lib/triage/triage-history-store";

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
export const Route = createFileRoute("/api/valentina/triage-history")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const tenantId = auth.session.tenantId;
        if (getAiPersona(tenantId).triagePolicy !== "industrial")
          return new Response(JSON.stringify({ error: "Recurso indisponível." }), {
            status: 404,
            headers,
          });
        try {
          const params = new URL(request.url).searchParams;
          const mode = (params.get("mode") || "conversations") as HistoryMode;
          if (!["conversations", "cycles", "events"].includes(mode))
            throw new HistoryInputError("Consulta inválida.");
          const conversationId = params.get("conversationId") || "";
          const cycleId = params.get("cycleId") || "";
          const query = (params.get("q") || "").trim();
          if (
            query.length > 100 ||
            (mode !== "conversations" && (!conversationId || conversationId.length > 240)) ||
            (mode === "events" && (!cycleId || cycleId.length > 600))
          )
            throw new HistoryInputError("Identificador ou busca inválidos.");
          const scope =
            mode === "conversations"
              ? historyQueryScope(tenantId, { query })
              : historyQueryScope(tenantId, { conversationId });
          const page = historyPageInput(
            mode,
            mode === "events" ? `${scope}:${cycleId}` : scope,
            params.get("cursor"),
            params.get("limit"),
          );
          const result =
            mode === "conversations"
              ? await listHistoryConversations(db, tenantId, query, page)
              : mode === "cycles"
                ? await listHistoryCycles(db, tenantId, conversationId, page)
                : await listHistoryEvents(db, tenantId, conversationId, cycleId, page);
          return new Response(JSON.stringify(result), { headers });
        } catch (error) {
          if (error instanceof HistoryInputError)
            return new Response(JSON.stringify({ error: error.message }), { status: 400, headers });
          if (error instanceof HistoryNotFoundError)
            return new Response(JSON.stringify({ error: "Atendimento não encontrado." }), {
              status: 404,
              headers,
            });
          console.error("[triage-history] Falha na consulta do histórico");
          return new Response(
            JSON.stringify({ error: "Histórico temporariamente indisponível." }),
            { status: 503, headers },
          );
        }
      },
    },
  },
});
