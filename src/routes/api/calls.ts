/**
 * /api/calls
 * REST endpoints para gerenciar sessões de chamada WebRTC
 *
 * POST   /api/calls              → Cria sala + registra no DB + retorna link
 * GET    /api/calls?roomId=xxx   → Estado atual da sala
 * POST   /api/calls/transcribe   → Recebe áudio, transcreve e insere nota no chat
 */

import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { callSessions, messages, conversations } from "../../db/schema";
import { eq } from "drizzle-orm";
import { createRoom, getRoomStatus, initCallSignaling } from "../../lib/call-signaling";
import { transcribeAudio, formatCallNote } from "../../lib/call-transcriber";

// ── Inicialização lazy do Socket.io ────────────────────────────────────────────────────
// O Socket.io é acoplado ao servidor HTTP do processo Node.js atual.
// Usamos globalThis para garantir que seja inicializado apenas uma vez.
function ensureSocketIO() {
  if ((globalThis as any).__socketIOInitialized) return;
  try {
    // Acessa o servidor HTTP nativo via globalThis (injetado pelo Nitro/Node.js)
    const server = (globalThis as any).__nitroServer
      ?? (globalThis as any).__server
      ?? null;
    if (server) {
      initCallSignaling(server);
      (globalThis as any).__socketIOInitialized = true;
      console.log("[Calls] Socket.io inicializado com sucesso");
    } else {
      console.warn("[Calls] Servidor HTTP não disponível ainda para Socket.io");
    }
  } catch (e) {
    console.error("[Calls] Erro ao inicializar Socket.io:", e);
  }
}

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

      // ── GET /api/calls?roomId=xxx — Estado da sala ─────────────────────────
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const roomId = url.searchParams.get("roomId");

        if (!roomId) return json({ error: "roomId é obrigatório" }, 400);

        // Consultar estado em memória (Socket.io)
        const roomInMemory = getRoomStatus(roomId);

        // Consultar banco de dados
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

      // ── POST /api/calls — Cria nova sala de chamada ────────────────────────
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const action = url.searchParams.get("action");

        // Roteamento interno por query param
        if (action === "transcribe") {
          return handleTranscribe(request);
        }
        if (action === "end") {
          return handleEnd(request);
        }

        // Criação de sala (default)
        return handleCreate(request);
      },
    },
  },
});

// ── Criar sala ────────────────────────────────────────────────────────────────

async function handleCreate(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const { tenantId, conversationId, operatorId, operatorName } = body;

    if (!tenantId || !conversationId || !operatorId) {
      return json({ error: "tenantId, conversationId e operatorId são obrigatórios" }, 400);
    }

    // Gerar ID único para a sala
    const roomId = `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sessionId = `cs-${Date.now()}`;

    // Criar sala no signaling server (em memória)
    createRoom(roomId);

    // Registrar sessão no banco
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

    // Buscar sessão no banco
    const session = await db.query.callSessions.findFirst({
      where: (t, { eq: dEq }) => dEq(t.roomId, roomId),
    });

    if (!session) return json({ error: "Sessão não encontrada" }, 404);

    // Atualizar status da sessão como encerrada
    await db
      .update(callSessions)
      .set({ status: "ended", endedAt: new Date(), durationSeconds: duration })
      .where(eq(callSessions.roomId, roomId));

    // ── Transcrição com Groq Whisper ──────────────────────────────────────────
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    const transcription = await transcribeAudio(audioBuffer, audioFile.name || "recording.webm");

    let transcriptionMessageId: string | null = null;

    if (transcription) {
      // Salvar transcrição na sessão
      await db
        .update(callSessions)
        .set({ transcription })
        .where(eq(callSessions.roomId, roomId));

      // ── Inserir nota interna no chat ─────────────────────────────────────────
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

      // Atualizar última mensagem da conversa
      await db
        .update(conversations)
        .set({ lastMessageText: `📞 Ligação encerrada • ${Math.floor(duration / 60)}min`, lastMessageTime: new Date() })
        .where(eq(conversations.id, session.conversationId));

      // Salvar ID da nota na sessão
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

// ── Encerrar sala forçado ─────────────────────────────────────────────────────

async function handleEnd(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const { roomId } = body;

    if (!roomId) return json({ error: "roomId é obrigatório" }, 400);

    await db
      .update(callSessions)
      .set({ status: "ended", endedAt: new Date() })
      .where(eq(callSessions.roomId, roomId));

    return json({ success: true });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
}
