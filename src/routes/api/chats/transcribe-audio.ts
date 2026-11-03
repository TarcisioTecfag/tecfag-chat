import { createFileRoute } from "@tanstack/react-router";
import { and, eq, like, or } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { db } from "../../../db";
import { mediaFiles, messages } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { requireConversationAccess } from "../../../lib/access-control/conversation-access";
import { transcribeAndPersistMessageAudio } from "../../../lib/call-transcriber";

export const Route = createFileRoute("/api/chats/transcribe-audio")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204 }),

      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        try {
          const body = await request.json().catch(() => ({}));
          const rawMessageId = typeof body.messageId === "string" ? body.messageId.trim() : "";
          const rawMediaId = typeof body.mediaId === "string" ? body.mediaId.trim() : "";

          if (!rawMessageId && !rawMediaId) {
            return Response.json({ error: "Identificador da mensagem ou mídia é obrigatório." }, { status: 400 });
          }

          const lookupId = rawMessageId || rawMediaId;
          const mediaLookupPrefix = `[MEDIA:audio]${rawMediaId || rawMessageId}`;

          const [msg] = await db
            .select()
            .from(messages)
            .where(
              and(
                eq(messages.tenantId, tenantId),
                or(
                  eq(messages.id, lookupId),
                  like(messages.content, `${mediaLookupPrefix}%`),
                ),
              ),
            )
            .limit(1);

          if (!msg) {
            return Response.json({ error: "Mensagem de áudio não encontrada." }, { status: 404 });
          }

          const denied = await requireConversationAccess(session, msg.conversationId);
          if (denied) return denied;

          if (msg.mediaInterpretation && msg.mediaInterpretation.trim().length > 0) {
            return Response.json({
              success: true,
              messageId: msg.id,
              conversationId: msg.conversationId,
              transcription: msg.mediaInterpretation.trim(),
            });
          }

          // Extrair o mediaFileId a partir do conteúdo [MEDIA:audio]<mediaId>(:<fileName>)?
          const mediaMatch = (msg.content || "").match(/^\[MEDIA:audio\]([^:\n]+)(?::([^\n]+))?/);
          const targetMediaId = mediaMatch?.[1]?.trim() || rawMediaId || msg.id;
          const targetFileName = mediaMatch?.[2]?.trim() || `${targetMediaId}.ogg`;

          let audioBuffer: Buffer | null = null;
          let mimeType = "audio/ogg";

          const [mediaRecord] = await db
            .select()
            .from(mediaFiles)
            .where(and(eq(mediaFiles.tenantId, tenantId), eq(mediaFiles.id, targetMediaId)))
            .limit(1);

          const localDiskPath = path.join(process.cwd(), "media", targetMediaId);
          const localMimePath = path.join(process.cwd(), "media", `${targetMediaId}.mime`);

          if (mediaRecord?.base64Data) {
            audioBuffer = Buffer.from(mediaRecord.base64Data, "base64");
            mimeType = mediaRecord.mimeType || mimeType;
          } else if (fs.existsSync(localDiskPath)) {
            audioBuffer = fs.readFileSync(localDiskPath);
            if (fs.existsSync(localMimePath)) {
              mimeType = fs.readFileSync(localMimePath, "utf-8").trim() || mimeType;
            }
          }

          if (!audioBuffer || audioBuffer.length === 0) {
            return Response.json(
              { error: "Arquivo de áudio não encontrado para transcrição." },
              { status: 404 },
            );
          }

          const transcription = await transcribeAndPersistMessageAudio({
            tenantId,
            messageId: msg.id,
            conversationId: msg.conversationId,
            audioBuffer,
            mimeType,
            fileName: mediaRecord?.fileName || targetFileName,
          });

          if (!transcription) {
            return Response.json(
              { error: "Não foi possível transcrever este áudio no momento." },
              { status: 502 },
            );
          }

          return Response.json({
            success: true,
            messageId: msg.id,
            conversationId: msg.conversationId,
            transcription,
          });
        } catch (err: any) {
          console.error("[transcribe-audio] Erro:", err);
          return Response.json(
            { error: err?.message || "Erro interno ao transcrever áudio." },
            { status: 500 },
          );
        }
      },
    },
  },
});
