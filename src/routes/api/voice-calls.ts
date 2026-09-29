// src/routes/api/voice-calls.ts
// API endpoints para listagem, filtros e gestão de chamadas de voz

import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { voiceCalls, voiceCallMessages } from "../../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireSession } from "../../lib/auth-session";

export const Route = createFileRoute("/api/voice-calls")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const url = new URL(request.url);
        const callId = url.searchParams.get("id");

        try {
          if (callId) {
            // Retorna chamada específica validando estritamente pertinência ao tenant
            const [call] = await db
              .select()
              .from(voiceCalls)
              .where(and(eq(voiceCalls.id, callId), eq(voiceCalls.tenantId, tenantId)));

            if (!call) {
              return new Response(JSON.stringify({ error: "Chamada não encontrada" }), { status: 404 });
            }

            const messagesList = await db
              .select()
              .from(voiceCallMessages)
              .where(and(eq(voiceCallMessages.callId, callId), eq(voiceCallMessages.tenantId, tenantId)))
              .orderBy(voiceCallMessages.timestamp);

            return new Response(JSON.stringify({ call, messages: messagesList }), {
              headers: { "Content-Type": "application/json" },
            });
          }

          // Lista todas as chamadas do tenant ordenadas por data recente
          const callsList = await db
            .select()
            .from(voiceCalls)
            .where(eq(voiceCalls.tenantId, tenantId))
            .orderBy(desc(voiceCalls.createdAt))
            .limit(50);

          return new Response(JSON.stringify({ calls: callsList }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[VoiceCalls API] Erro ao buscar chamadas:", err?.message || err);
          return new Response(JSON.stringify({ error: "Erro interno do servidor" }), { status: 500 });
        }
      },
    },
  },
});
