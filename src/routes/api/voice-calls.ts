// src/routes/api/voice-calls.ts
// API endpoints para listagem, filtros e gestão de chamadas de voz

import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { voiceCalls, voiceCallMessages } from "../../db/schema";
import { eq, desc } from "drizzle-orm";

export const Route = createFileRoute("/api/voice-calls")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400, headers: { "Content-Type": "application/json" }
          });
        }
        const callId = url.searchParams.get("id");

        try {
          if (callId) {
            // Retorna chamada específica com seu transcript completo
            const [call] = await db
              .select()
              .from(voiceCalls)
              .where(eq(voiceCalls.id, callId));

            if (!call) {
              return new Response(JSON.stringify({ error: "Chamada não encontrada" }), { status: 404 });
            }

            const messagesList = await db
              .select()
              .from(voiceCallMessages)
              .where(eq(voiceCallMessages.callId, callId))
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
