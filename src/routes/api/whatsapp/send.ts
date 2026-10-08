import { createFileRoute } from "@tanstack/react-router";
import { outboundQueue } from "../../../lib/whatsapp/outbound";
import { requireSession } from "../../../lib/auth-session";
import { db } from "../../../db";
import { conversations, contacts, mediaFiles, channelConfigs } from "../../../db/schema";
import { eq, and } from "drizzle-orm";
import { metaAdapter } from "../../../lib/whatsapp/adapters/meta";
import { resolveMetaTemplateValues } from "../../../lib/whatsapp/meta-template-common";
import { convertAudioToOggOpus, metaAudioNeedsConversion } from "../../../lib/whatsapp/audio-convert";
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
          let templateName: string | undefined;
          let templateLanguage: string | undefined;
          let templateComponents: any[] | undefined;
          let isInternalNote: boolean = false;
          let pendingFile: { id: string; buffer: Buffer; mime: string; name: string } | undefined;

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
              let mime = file.type || "application/octet-stream";
              fileName = file.name || "arquivo";
              const arrayBuffer = await file.arrayBuffer();
              let buffer: Buffer = Buffer.from(arrayBuffer) as any;

              const ext = fileName.split(".").pop()?.toLowerCase() || "";
              if (mime.startsWith("image/")) mediaType = "image";
              else if (mime.startsWith("audio/") || ["mp3","ogg","webm","m4a","aac","oga","opus","wav"].includes(ext)) mediaType = "audio";
              else if (mime.startsWith("video/")) mediaType = "video";
              else mediaType = "document";

              // Converte áudios para OGG/Opus padrão WhatsApp (evita erro de reprodução no app do cliente)
              if (mediaType === "audio" && (metaAudioNeedsConversion(mime) || ext === "webm" || mime.includes("webm"))) {
                try {
                  const converted = await convertAudioToOggOpus(buffer);
                  buffer = converted as any;
                  mime = "audio/ogg; codecs=opus";
                  fileName = `${fileName.replace(/\.[^./\\]+$/, "") || "audio"}.ogg`;
                  console.log(`[WhatsApp Send] Áudio convertido com sucesso para OGG/Opus (${buffer.length} bytes)`);
                } catch (convErr) {
                  console.warn("[WhatsApp Send] Conversão para OGG/Opus falhou, mantendo buffer original:", convErr);
                }
              }

              pendingFile = { id: fileId, buffer, mime, name: fileName };
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
            templateName = typeof body.templateName === "string" ? body.templateName.trim() : undefined;
            templateLanguage = typeof body.templateLanguage === "string" ? body.templateLanguage.trim() : undefined;
            templateComponents = Array.isArray(body.templateComponents) ? body.templateComponents : undefined;
            isInternalNote = !!body.isInternalNote;
          }

          // conversationId é obrigatório — o recipientPhone é obtido do banco (não do cliente)
          if (!conversationId) {
            return new Response(
              JSON.stringify({ error: "conversationId é obrigatório" }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          if (templateName && (!/^[a-z0-9_]{1,512}$/.test(templateName) || !/^[a-z]{2}_[A-Z]{2}$/.test(templateLanguage || "pt_BR"))) {
            return Response.json({ error: "Nome ou idioma do template inválido." }, { status: 400 });
          }
          if (templateName && isInternalNote) return Response.json({ error: "Template oficial não pode ser nota interna." }, { status: 400 });

          // Verificar se o canal está em transição ('switching') de provedor
          if (!isInternalNote) {
            const [channelConfig] = await db
              .select({ connectionStatus: channelConfigs.connectionStatus, activeProvider: channelConfigs.activeProvider })
              .from(channelConfigs)
              .where(eq(channelConfigs.tenantId, session.tenantId));

            if (channelConfig?.connectionStatus === "switching") {
              return new Response(
                JSON.stringify({
                  error: "O canal está alternando de provedor no momento. Aguarde alguns instantes e tente novamente.",
                  code: "PROVIDER_SWITCHING",
                }),
                { status: 409, headers: { "Content-Type": "application/json" } }
              );
            }
            if (templateName && channelConfig?.activeProvider !== "meta") {
              return Response.json({ error: "Templates oficiais exigem o canal Meta ativo." }, { status: 400 });
            }
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

          // O envio exige captura prévia, inclusive para administradores e supervisores.
          // Permissão para ver o histórico ou assumir não envia mensagens por si só.
          if (conv.queueState !== "meus" || conv.operatorId !== session.operator.id) {
            return new Response(
              JSON.stringify({ error: "Sem permissão para responder nesta conversa.", code: "FORBIDDEN" }),
              { status: 403, headers: { "Content-Type": "application/json" } }
            );
          }
          if (isInternalNote && session.operator.role !== "admin" && session.permissions.chat.canSendInternalNotes !== true) {
            return Response.json({ error: "Sem permissão para enviar notas internas.", code: "FORBIDDEN" }, { status: 403 });
          }

          // Persistir anexos apenas depois de validar tenant e responsável.
          if (pendingFile) {
            try {
              await db.insert(mediaFiles).values({
                id: pendingFile.id,
                tenantId: session.tenantId,
                conversationId,
                fileName: pendingFile.name,
                mimeType: pendingFile.mime,
                fileSize: pendingFile.buffer.length,
                base64Data: pendingFile.buffer.toString("base64"),
                createdAt: new Date(),
              }).onConflictDoNothing();
            } catch (dbErr) {
              console.error("[WhatsApp Send] Erro ao persistir mídia no banco:", dbErr);
            }
            try {
              const mediaDir = path.join(process.cwd(), "media");
              if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
              fs.writeFileSync(path.join(mediaDir, pendingFile.id), pendingFile.buffer);
              fs.writeFileSync(path.join(mediaDir, `${pendingFile.id}.mime`), pendingFile.mime);
            } catch (fsErr) {
              console.error("[WhatsApp Send] Erro ao salvar arquivo em disco:", fsErr);
            }
          }

          // Notas internas não precisam de telefone de destino
          let recipientPhone: string | undefined;
          let recipientUserId: string | undefined;
          let recipientName: string | undefined;
          if (!isInternalNote) {
            // Obter telefone do contato no SERVIDOR — nunca confiar no body do cliente
            if (!conv.contactId) {
              return new Response(
                JSON.stringify({ error: "Conversa sem contato associado." }),
                { status: 400, headers: { "Content-Type": "application/json" } }
              );
            }

            const [contact] = await db
              .select({ phone: contacts.phone, whatsappUserId: contacts.whatsappUserId, name: contacts.name })
              .from(contacts)
              .where(
                and(
                  eq(contacts.id, conv.contactId),
                  eq(contacts.tenantId, session.tenantId)
                )
              );

            const [activeChannel] = await db.select({ activeProvider: channelConfigs.activeProvider })
              .from(channelConfigs).where(eq(channelConfigs.tenantId, session.tenantId)).limit(1);
            recipientUserId = activeChannel?.activeProvider === "meta" ? contact?.whatsappUserId || undefined : undefined;
            if (!contact?.phone && !recipientUserId) {
              return new Response(
                JSON.stringify({ error: "Contato sem identificador WhatsApp disponível para envio." }),
                { status: 400, headers: { "Content-Type": "application/json" } }
              );
            }

            recipientPhone = contact?.phone || undefined;
            recipientName = contact?.name || undefined;
          }

          if (templateName) {
            const approved = await metaAdapter.listApprovedTemplates(session.tenantId);
            const selected = approved.find((item) => item.name === templateName && item.language === (templateLanguage || "pt_BR"));
            if (!selected?.supported) return Response.json({ error: "Template não aprovado ou formato não suportado." }, { status: 400 });
            const supplied = templateComponents?.find((item: any) => item?.type === "body")?.parameters;
            let values: string[];
            try {
              values = resolveMetaTemplateValues(selected.variableCount, selected.bindings, supplied,
                { customerName: recipientName, operatorName: session.operator.name });
            } catch (error) {
              return Response.json({ error: error instanceof Error ? error.message : "Variáveis inválidas." }, { status: 400 });
            }
            const resolved = values.map((value) => ({ type: "text" as const, text: value }));
            templateComponents = resolved.length ? [{ type: "body", parameters: resolved }] : [];
            text = selected.bodyText.replace(/\{\{(\d+)\}\}/g, (_, number) => resolved[Number(number) - 1]?.text || `{{${number}}}`);
            mediaUrl = undefined;
            mediaType = undefined;
          }

          const result = await outboundQueue.enqueueAndSend({
            idempotencyKey: clientMessageId,
            tenantId: session.tenantId,
            conversationId,
            recipientPhone: recipientPhone || "",
            recipientUserId,
            text,
            mediaUrl,
            mediaType,
            fileName,
            quotedMessageId,
            templateName,
            templateLanguage,
            templateComponents,
            operatorId: session.operator.id,
            senderName: session.operator.name,
            isInternalNote: !!isInternalNote,
          });

          return new Response(JSON.stringify({ ...result, ...(templateName && result.success ? { renderedText: text } : {}) }), {
            status: result.success ? 200 : result.code === "META_TEMPLATE_REQUIRED" ? 409 : 400,
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
