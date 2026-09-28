import { createFileRoute } from "@tanstack/react-router";
import { outboundQueue } from "../../../lib/whatsapp/outbound";
import { requireSession } from "../../../lib/auth-session";
import { db } from "../../../db";
import { conversations, contacts, mediaFiles } from "../../../db/schema";
import { eq, and } from "drizzle-orm";
import fs from "fs";
import path from "path";

export const Route = createFileRoute("/api/whatsapp/send")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204 }),

      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          let conversationId: string | undefined;
          let text: string | undefined;
          let mediaUrl: string | undefined;
          let mediaType: "document" | "image" | "video" | "audio" | undefined;
          let fileName: string | undefined;
          let quotedMessageId: string | undefined;
          let clientMessageId: string | undefined;
          let isInternalNote: boolean = false;

          const contentType = request.headers.get("content-type") || "";
          if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            conversationId = (formData.get("conversationId") as string) || undefined;
            text = (formData.get("text") as string) || "";
            clientMessageId = (formData.get("clientMessageId") as string) || undefined;
            quotedMessageId = (formData.get("quotedMessageId") as string) || undefined;
            isInternalNote = formData.get("isInternalNote") === "true";

            const file = formData.get("file") as File | null;
            if (file) {
              const fileId = `media-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
              const mime = file.type || "application/octet-stream";
              fileName = file.name || "arquivo";
              const arrayBuffer = await file.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);

              const ext = fileName.split(".").pop()?.toLowerCase() || "";
              if (mime.startsWith("image/")) mediaType = "image";
              else if (mime.startsWith("audio/") || ["mp3","ogg","webm","m4a","aac","oga","opus","wav"].includes(ext)) mediaType = "audio";
              else if (mime.startsWith("video/")) mediaType = "video";
              else mediaType = "document";

              // Salva no banco de dados (mediaFiles)
              try {
                await db.insert(mediaFiles).values({
                  id: fileId,
                  tenantId: session.tenantId,
                  conversationId: conversationId || null,
                  fileName,
                  mimeType: mime,
                  fileSize: buffer.length,
                  base64Data: buffer.toString("base64"),
                  createdAt: new Date(),
                }).onConflictDoNothing();
              } catch (dbErr) {
                console.error("[WhatsApp Send] Erro ao persistir mídia no banco:", dbErr);
              }

              // Salva no cache em disco
              try {
                const mediaDir = path.join(process.cwd(), "media");
                if (!fs.existsSync(mediaDir)) {
                  fs.mkdirSync(mediaDir, { recursive: true });
                }
                fs.writeFileSync(path.join(mediaDir, fileId), buffer);
                fs.writeFileSync(path.join(mediaDir, `${fileId}.mime`), mime);
              } catch (fsErr) {
                console.error("[WhatsApp Send] Erro ao salvar arquivo em disco:", fsErr);
              }

              mediaUrl = `/api/baileys/media?messageId=${fileId}`;
            }
          } else {
            const body = await request.json();
            conversationId = body.conversationId;
            text = body.text;
            mediaUrl = body.mediaUrl;
            mediaType = body.mediaType as any;
            fileName = body.fileName;
            quotedMessageId = body.quotedMessageId;
            clientMessageId = body.clientMessageId;
            isInternalNote = !!body.isInternalNote;
          }

          // conversationId é obrigatório — o recipientPhone é obtido do banco (não do cliente)
          if (!conversationId) {
            return new Response(
              JSON.stringify({ error: "conversationId é obrigatório" }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          // Buscar conversa verificando que pertence ao tenant da sessão
          const [conv] = await db
            .select({
              id: conversations.id,
              contactId: conversations.contactId,
              tenantId: conversations.tenantId,
              operatorId: conversations.operatorId,
              queueState: conversations.queueState,
            })
            .from(conversations)
            .where(
              and(
                eq(conversations.id, conversationId),
                eq(conversations.tenantId, session.tenantId)
              )
            );

          if (!conv) {
            return new Response(
              JSON.stringify({ error: "Conversa não encontrada.", code: "NOT_FOUND" }),
              { status: 404, headers: { "Content-Type": "application/json" } }
            );
          }

          // Verificar permissão de escrita: admin e supervisor podem enviar para qualquer conversa do tenant.
          // Atendentes comuns só podem enviar na conversa que lhes pertence (operatorId).
          // canViewAllChats é permissão de LEITURA — não autoriza envio.
          const isAdmin = session.operator.role === "admin";
          const isSupervisor = session.operator.role === "supervisor";
          const isOwner = conv.operatorId === session.operator.id;

          if (!isAdmin && !isSupervisor && !isOwner) {
            return new Response(
              JSON.stringify({ error: "Sem permissão para responder nesta conversa.", code: "FORBIDDEN" }),
              { status: 403, headers: { "Content-Type": "application/json" } }
            );
          }

          // Notas internas não precisam de telefone de destino
          let recipientPhone: string | undefined;
          if (!isInternalNote) {
            // Obter telefone do contato no SERVIDOR — nunca confiar no body do cliente
            if (!conv.contactId) {
              return new Response(
                JSON.stringify({ error: "Conversa sem contato associado." }),
                { status: 400, headers: { "Content-Type": "application/json" } }
              );
            }

            const [contact] = await db
              .select({ phone: contacts.phone })
              .from(contacts)
              .where(
                and(
                  eq(contacts.id, conv.contactId),
                  eq(contacts.tenantId, session.tenantId)
                )
              );

            if (!contact?.phone) {
              return new Response(
                JSON.stringify({ error: "Contato sem número de telefone cadastrado." }),
                { status: 400, headers: { "Content-Type": "application/json" } }
              );
            }

            recipientPhone = contact.phone;
          }

          const result = await outboundQueue.enqueueAndSend({
            idempotencyKey: clientMessageId,
            tenantId: session.tenantId,
            conversationId,
            recipientPhone: recipientPhone || "",
            text,
            mediaUrl,
            mediaType,
            fileName,
            quotedMessageId,
            operatorId: session.operator.id,
            isInternalNote: !!isInternalNote,
          });

          return new Response(JSON.stringify(result), {
            status: result.success ? 200 : 400,
            headers: { "Content-Type": "application/json" },
          });

        } catch (err: any) {
          console.error("[WhatsApp Send Route] Erro:", err);
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
