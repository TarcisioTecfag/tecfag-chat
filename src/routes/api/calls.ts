import { createFileRoute } from "@tanstack/react-router";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { callSessions, messages } from "../../db/schema";
import { requireSession } from "../../lib/auth-session";
import {
  requireConversationAccess,
  requireConversationWriteAccess,
} from "../../lib/access-control/conversation-access";
import {
  createRoom,
  getRoomStatus,
  addSignal,
  getSignals,
  endRoom,
} from "../../lib/call-signaling";
import { transcribeAudio, formatCallNote } from "../../lib/call-transcriber";
import { getDealContext, DealContextError } from "../../lib/crm/conversation-deal-context";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, {
    ...init,
    headers: { ...corsHeaders, ...((init.headers as Record<string, string>) || {}) },
  });

/** O link do cliente é uma capacidade aleatória de 128 bits, limitada à sala em
 * memória. Não dá acesso à transcrição, ao chat ou a outro tenant. */
export const Route = createFileRoute("/api/calls")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const roomId = url.searchParams.get("roomId") || "";
        const room = getRoomStatus(roomId);
        if (!room) return json({ error: "Sala não encontrada ou expirada." }, { status: 404 });
        const role = url.searchParams.get("role") || "client";
        if (!["agent", "client"].includes(role))
          return json({ error: "Papel inválido." }, { status: 400 });
        if (role === "agent") {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          if (room.tenantId !== session.tenantId || room.operatorId !== session.operator.id)
            return json({ error: "Sala não encontrada." }, { status: 404 });
          const denied = await requireConversationAccess(session, room.conversationId);
          if (denied) return denied;
        }
        if (url.searchParams.get("action") === "signal") {
          const after = Number(url.searchParams.get("after") || "0");
          if (!Number.isFinite(after) || after < 0)
            return json({ error: "Cursor inválido." }, { status: 400 });
          return json(
            { signals: getSignals(roomId, after, role as "agent" | "client"), status: room.status },
            { headers: { "Cache-Control": "no-store" } },
          );
        }
        return json({ roomId, status: room.status }, { headers: { "Cache-Control": "no-store" } });
      },
      POST: async ({ request }) => {
        try {
          const action = new URL(request.url).searchParams.get("action");
          // Sinalização pública tem capacidade própria; não aceita tenant/conversa do cliente.
          if (action === "signal") {
            const body = await request.json();
            const room = typeof body.roomId === "string" ? getRoomStatus(body.roomId) : null;
            if (!room) return json({ error: "Sala não encontrada ou expirada." }, { status: 404 });
            if (
              !["agent", "client"].includes(body.role) ||
              ![
                "client:joined",
                "call:connected",
                "webrtc:ice",
                "webrtc:offer",
                "webrtc:answer",
                "call:ended",
              ].includes(body.type)
            )
              return json({ error: "Sinal inválido." }, { status: 400 });
            if (body.role === "agent") {
              const auth = await requireSession(request);
              if ("response" in auth) return auth.response;
              const { session } = auth;
              if (room.tenantId !== session.tenantId || room.operatorId !== session.operator.id)
                return json({ error: "Sala não encontrada." }, { status: 404 });
              const denied = await requireConversationAccess(session, room.conversationId);
              if (denied) return denied;
            }
            if (
              (body.type === "client:joined" && body.role !== "client") ||
              (body.type === "webrtc:offer" && body.role !== "agent") ||
              (body.type === "webrtc:answer" && body.role !== "client")
            )
              return json({ error: "Sinal inválido para este participante." }, { status: 400 });
            if (room.status === "ended") return json({ error: "Sala encerrada." }, { status: 409 });
            if (body.type === "client:joined") {
              await db
                .update(callSessions)
                .set({ status: "connecting" })
                .where(
                  and(
                    eq(callSessions.tenantId, room.tenantId),
                    eq(callSessions.roomId, room.roomId),
                    eq(callSessions.status, "waiting"),
                  ),
                );
            } else if (body.type === "call:connected") {
              await db
                .update(callSessions)
                .set({ status: "active", startedAt: new Date() })
                .where(
                  and(
                    eq(callSessions.tenantId, room.tenantId),
                    eq(callSessions.roomId, room.roomId),
                    inArray(callSessions.status, ["waiting", "connecting"]),
                  ),
                );
            } else if (body.type === "call:ended") {
              await db
                .update(callSessions)
                .set({ status: "ended", endedAt: new Date() })
                .where(
                  and(
                    eq(callSessions.tenantId, room.tenantId),
                    eq(callSessions.roomId, room.roomId),
                  ),
                );
            }
            const ok = addSignal(room.roomId, body.role, body.type, body.data);
            if (body.type === "call:ended") endRoom(room.roomId);
            return json({ success: ok });
          }
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          if (!action) {
            const body = await request.json();
            if (typeof body.conversationId !== "string" || !body.conversationId)
              return json({ error: "Atendimento inválido." }, { status: 400 });
            const denied = await requireConversationWriteAccess(session, body.conversationId);
            if (denied) return denied;
            const roomId = `call-${crypto.randomUUID()}`;
            const sessionId = `cs-${crypto.randomUUID()}`;
            await db.transaction(async (tx) => {
              const state = await getDealContext(
                tx,
                tenantId,
                body.conversationId,
                session.operator.id,
              );
              if (
                state.conversation.operatorId !== session.operator.id ||
                state.conversation.queueState !== "meus"
              )
                throw new DealContextError(
                  "O responsável pelo atendimento mudou.",
                  "FORBIDDEN",
                  403,
                );
              await tx.insert(callSessions).values({
                id: sessionId,
                tenantId,
                conversationId: body.conversationId,
                operatorId: session.operator.id,
                roomId,
                status: "waiting",
              });
            });
            createRoom(
              roomId,
              { tenantId, conversationId: body.conversationId, operatorId: session.operator.id },
              async () => {
                await db
                  .update(callSessions)
                  .set({ status: "missed", endedAt: new Date() })
                  .where(
                    and(
                      eq(callSessions.tenantId, tenantId),
                      eq(callSessions.id, sessionId),
                      eq(callSessions.status, "waiting"),
                    ),
                  );
              },
            );
            const appUrl = process.env.PUBLIC_APP_URL || new URL(request.url).origin;
            return json({
              success: true,
              roomId,
              sessionId,
              callLink: `${appUrl}/call/${roomId}`,
            });
          }
          if (!["end", "transcribe"].includes(action))
            return json({ error: "Ação inválida." }, { status: 400 });
          const form = action === "transcribe" ? await request.formData() : null;
          const body = form ? null : await request.json();
          const roomId = form ? form.get("roomId") : body?.roomId;
          if (typeof roomId !== "string" || !roomId)
            return json({ error: "Sala inválida." }, { status: 400 });
          const [call] = await db
            .select()
            .from(callSessions)
            .where(and(eq(callSessions.tenantId, tenantId), eq(callSessions.roomId, roomId)))
            .limit(1);
          if (!call || call.operatorId !== session.operator.id)
            return json({ error: "Sala não encontrada." }, { status: 404 });
          const denied = await requireConversationAccess(session, call.conversationId);
          if (denied) return denied;
          if (action === "end") {
            await db
              .update(callSessions)
              .set({ status: "ended", endedAt: call.endedAt || new Date() })
              .where(and(eq(callSessions.tenantId, tenantId), eq(callSessions.id, call.id)));
            endRoom(roomId);
            return json({ success: true });
          }
          const audio = form!.get("audio");
          const duration = Number(form!.get("duration") || "0");
          if (
            !(audio instanceof File) ||
            !Number.isFinite(duration) ||
            duration < 0 ||
            duration > 86400 ||
            audio.size > 50 * 1024 * 1024
          )
            return json({ error: "Áudio ou duração inválidos." }, { status: 400 });
          if (call.transcriptionMessageId)
            return json({
              success: true,
              transcription: call.transcription,
              transcriptionMessageId: call.transcriptionMessageId,
            });
          await db
            .update(callSessions)
            .set({
              status: "ended",
              endedAt: call.endedAt || new Date(),
              durationSeconds: Math.floor(duration),
            })
            .where(and(eq(callSessions.tenantId, tenantId), eq(callSessions.id, call.id)));
          endRoom(roomId);
          const transcription = await transcribeAudio(
            Buffer.from(await audio.arrayBuffer()),
            audio.name || "recording.webm",
            tenantId,
          );
          let transcriptionMessageId: string | null = null;
          if (transcription) {
            transcriptionMessageId = `call-note-${call.id}`;
            await db.transaction(async (tx) => {
              await tx
                .insert(messages)
                .values({
                  id: transcriptionMessageId!,
                  tenantId,
                  conversationId: call.conversationId,
                  senderType: "system",
                  senderName: "Sistema — Ligação",
                  content: formatCallNote(transcription, session.operator.name, duration),
                  isInternalNote: true,
                  direction: "outbound",
                  provider: "system",
                  metaDetails: {
                    attendanceActor: {
                      name: session.operator.name,
                      operatorId: session.operator.id,
                    },
                  },
                })
                .onConflictDoNothing();
              await tx
                .update(callSessions)
                .set({ transcription, transcriptionMessageId })
                .where(and(eq(callSessions.tenantId, tenantId), eq(callSessions.id, call.id)));
            });
          }
          return json({ success: true, transcription, transcriptionMessageId });
        } catch (error) {
          if (error instanceof DealContextError)
            return json({ error: error.message, code: error.code }, { status: error.statusCode });
          console.error("[Calls]", error);
          return json({ error: "Não foi possível concluir a ação da ligação." }, { status: 500 });
        }
      },
    },
  },
});
