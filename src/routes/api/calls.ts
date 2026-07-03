/**
 * /api/calls
 * REST endpoints para gerenciar sessões de chamada WebRTC via polling.
 *
 * POST   /api/calls                    → Cria sala + registra no DB + retorna link
 * GET    /api/calls?roomId=xxx         → Estado atual da sala
 * GET    /api/calls?action=signal&...  → Polling de sinais WebRTC (offer/answer/ICE)
 * POST   /api/calls?action=signal     → Envia sinal WebRTC
 * POST   /api/calls?action=transcribe  → Recebe áudio, transcreve e insere nota no chat
 * POST   /api/calls?action=end         → Encerra sala forçado
 */

import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { callSessions, messages, conversations } from "../../db/schema";
import { eq } from "drizzle-orm";
import { createRoom, getRoomStatus, addSignal, getSignals, endRoom } from "../../lib/call-signaling";
import { transcribeAudio, formatCallNote } from "../../lib/call-transcriber";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/calls")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ── GET /api/calls — Estado da sala OU polling de sinais ────────────────
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const action = url.searchParams.get("action");

        if (action === "signal") {
          return handlePollSignals(url);
        }

        // GET sem action → estado da sala
        const roomId = url.searchParams.get("roomId");
        if (!roomId) return json({ error: "roomId é obrigatório" }, 400);

        const roomInMemory = getRoomStatus(roomId);
        const session = await db.query.callSessions.findFirst({
          where: (t, { eq: dEq }) => dEq(t.roomId, roomId),
        });

        if (!session) return json({ error: "Sala não encontrada" }, 404);

        return json({
          roomId,
          status: roomInMemory?.status ?? session.status,
          durationSeconds: session.durationSeconds,
          transcription: session.transcription,
        });
      },

      // ── POST /api/calls — Criar sala, sinalizar, transcrever, encerrar ───────
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const action = url.searchParams.get("action");

        if (action === "signal")    return handleSendSignal(request);
        if (action === "transcribe") return handleTranscribe(request);
        if (action === "end")        return handleEnd(request);

        return handleCreate(request);
      },
    },
  },
});

// ── Polling de sinais WebRTC ──────────────────────────────────────────────────
// GET /api/calls?action=signal&roomId=xxx&after=timestamp&role=agent|client

function handlePollSignals(url: URL): Response {
  const roomId = url.searchParams.get("roomId");
  const after  = parseInt(url.searchParams.get("after") ?? "0", 10);
  const role   = (url.searchParams.get("role") ?? "client") as "agent" | "client";

  if (!roomId) return json({ error: "roomId é obrigatório" }, 400);

  const room = getRoomStatus(roomId);
  if (!room) return json({ error: "Sala não encontrada ou expirada" }, 404);

  const signals = getSignals(roomId, after, role);
  return json({ signals, status: room.status });
}

// ── Enviar sinal WebRTC ───────────────────────────────────────────────────────
// POST /api/calls?action=signal  body: { roomId, role, type, data }

async function handleSendSignal(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const { roomId, role, type, data } = body;

    if (!roomId || !role || !type) {
      return json({ error: "roomId, role e type são obrigatórios" }, 400);
    }

    const ok = addSignal(roomId, role as "agent" | "client", type, data);
    if (!ok) return json({ error: "Sala não encontrada ou encerrada" }, 404);

    return json({ success: true });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
}

// ── Criar sala ────────────────────────────────────────────────────────────────

async function handleCreate(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const { tenantId, conversationId, operatorId, operatorName } = body;

    if (!tenantId || !conversationId || !operatorId) {
      return json({ error: "tenantId, conversationId e operatorId são obrigatórios" }, 400);
    }

    const roomId = `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sessionId = `cs-${Date.now()}`;

    createRoom(roomId);

    await db.insert(callSessions).values({
      id: sessionId,
      tenantId,
      conversationId,
      operatorId,
      roomId,
      status: "waiting",
      createdAt: new Date(),
    });

    const appUrl = process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
    const callLink = `${appUrl}/call/${roomId}`;

    console.log(`[Calls] Sala criada: ${roomId} | Operador: ${operatorName} | Link: ${callLink}`);

    return json({ success: true, roomId, sessionId, callLink });
  } catch (e: any) {
    console.error("[Calls] Erro ao criar sala:", e);
    return json({ error: e.message }, 500);
  }
}

// ── Transcrever áudio e inserir nota no chat ──────────────────────────────────

async function handleTranscribe(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;
    const roomId = formData.get("roomId") as string;
    const durationStr = formData.get("duration") as string;
    const operatorName = (formData.get("operatorName") as string) ?? "Agente";

    if (!audioFile || !roomId) {
      return json({ error: "audio e roomId são obrigatórios" }, 400);
    }

    const duration = parseInt(durationStr ?? "0", 10);

    const session = await db.query.callSessions.findFirst({
      where: (t, { eq: dEq }) => dEq(t.roomId, roomId),
    });

    if (!session) return json({ error: "Sessão não encontrada" }, 404);

    await db
      .update(callSessions)
      .set({ status: "ended", endedAt: new Date(), durationSeconds: duration })
      .where(eq(callSessions.roomId, roomId));

    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    const transcription = await transcribeAudio(audioBuffer, audioFile.name || "recording.webm");

    let transcriptionMessageId: string | null = null;

    if (transcription) {
      await db
        .update(callSessions)
        .set({ transcription })
        .where(eq(callSessions.roomId, roomId));

      const noteContent = formatCallNote(transcription, operatorName, duration);
      transcriptionMessageId = `call-note-${Date.now()}`;

      await db.insert(messages).values({
        id: transcriptionMessageId,
        tenantId: session.tenantId,
        conversationId: session.conversationId,
        senderType: "system",
        senderName: "Sistema — Ligação",
        content: noteContent,
        isInternalNote: true,
        sentAt: new Date(),
      });

      await db
        .update(conversations)
        .set({
          lastMessageText: `📞 Ligação encerrada • ${Math.floor(duration / 60)}min`,
          lastMessageTime: new Date(),
        })
        .where(eq(conversations.id, session.conversationId));

      await db
        .update(callSessions)
        .set({ transcriptionMessageId })
        .where(eq(callSessions.roomId, roomId));
    }

    return json({ success: true, transcription, transcriptionMessageId });
  } catch (e: any) {
    console.error("[Calls] Erro ao transcrever:", e);
    return json({ error: e.message }, 500);
  }
}

// ── Encerrar sala ─────────────────────────────────────────────────────────────

async function handleEnd(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const { roomId } = body;

    if (!roomId) return json({ error: "roomId é obrigatório" }, 400);

    endRoom(roomId);

    await db
      .update(callSessions)
      .set({ status: "ended", endedAt: new Date() })
      .where(eq(callSessions.roomId, roomId));

    return json({ success: true });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
}
