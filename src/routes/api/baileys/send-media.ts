import { createFileRoute } from "@tanstack/react-router";
import { SessionManager, resolveRealJid } from "../../../lib/baileys/session-manager";
import { db } from "../../../db";
import { messages, conversations, contacts, mediaFiles } from "../../../db/schema";
import { eq, and } from "drizzle-orm";

import { requireSession } from "../../../lib/auth-session";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/baileys/send-media")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: corsHeaders }),

      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          const formData = await request.formData();
          const tenantId = session.tenantId; // Sempre derivado da sessão autenticada
          const phone = formData.get("phone") as string;
          const conversationId = formData.get("conversationId") as string;
          const senderName = (formData.get("senderName") as string) || session.operator.name;
          const file = formData.get("file") as File | null;

          if (!file) {
            return new Response(
              JSON.stringify({ error: "file é obrigatório" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const sessionManager = SessionManager.getInstance();
          const sock = sessionManager.getSession(tenantId);

          if (!sock || sessionManager.getStatus(tenantId) !== "connected") {
            return new Response(
              JSON.stringify({ error: "WhatsApp não conectado" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Resolver o JID pelo conversationId → contato
          let jid: string;
          let contactId: string | undefined;

          if (conversationId) {
            try {
              const conv = await db.query.conversations.findFirst({
                where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, conversationId), dEq(t.tenantId, tenantId)),
              });
              contactId = conv?.contactId;
            } catch {}
          }

          let contact: any;
          if (contactId) {
            contact = await db.query.contacts.findFirst({
              where: (t, { eq: dEq, and: dAnd }) => dAnd(dEq(t.id, contactId!), dEq(t.tenantId, tenantId)),
            });
          }

          if (contact?.whatsappJid) {
            jid = contact.whatsappJid;
            console.log(`[Baileys SendMedia] Usando JID salvo do contato: ${jid}`);
          } else {
            // Resolve o JID real via onWhatsApp e salva no banco de dados para envios futuros
            const cleanPhone = phone.replace(/\D/g, "");
            jid = await resolveRealJid(sock, cleanPhone);
            console.log(`[Baileys SendMedia] JID resolvido via WhatsApp: ${jid}`);

            if (contactId && jid) {
              try {
                await db.update(contacts)
                  .set({ whatsappJid: jid })
                  .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)));
                console.log(`[Baileys SendMedia] JID ${jid} salvo no contato ${contactId}`);
              } catch (err: any) {
                console.error(`[Baileys SendMedia] Erro ao salvar JID no contato:`, err.message);
              }
            }
          }

          const mime = file.type || "application/octet-stream";
          const fileName = file.name || "arquivo";
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // Determinar tipo de mensagem Baileys pelo MIME ou extensão do arquivo
          const ext = fileName.split(".").pop()?.toLowerCase() || "";
          const isAudio = mime.startsWith("audio/") || ["mp3","ogg","webm","m4a","aac","oga","opus","wav"].includes(ext);
          const isSticker = mime === "image/webp" || ext === "webp";
          const isImage = mime.startsWith("image/") && !isSticker;
          const isVideo = mime.startsWith("video/") && !isAudio;

          // Normalizar MIME de áudio para o formato que o WhatsApp/Baileys aceita
          let audioMime = mime;
          if (isAudio) {
            if (ext === "ogg" || ext === "oga" || mime.includes("ogg")) {
              audioMime = "audio/ogg; codecs=opus";
            } else if (ext === "webm" || mime.includes("webm")) {
              audioMime = "audio/webm";
            } else if (ext === "mp3" || mime.includes("mpeg")) {
              audioMime = "audio/mpeg";
            } else if (ext === "mp4" || ext === "m4a") {
              audioMime = "audio/mp4";
            }
          }

          // Determinar tipo de mensagem Baileys pelo MIME
          let sentMsg: any;
          if (isSticker) {
            sentMsg = await sock.sendMessage(jid, {
              sticker: buffer,
            });
          } else if (isImage) {
            sentMsg = await sock.sendMessage(jid, {
              image: buffer,
              mimetype: mime,
              caption: "",
            });
          } else if (isVideo) {
            sentMsg = await sock.sendMessage(jid, {
              video: buffer,
              mimetype: mime,
              caption: "",
            });
          } else if (isAudio) {
            sentMsg = await sock.sendMessage(jid, {
              audio: buffer,
              mimetype: audioMime,
              ptt: true, // true = mensagem de voz, false = arquivo de áudio
            });
          } else {
            // Qualquer outro tipo: PDF, Excel, Word, etc.
            sentMsg = await sock.sendMessage(jid, {
              document: buffer,
              mimetype: mime,
              fileName,
            });
          }

          // Salvar no DB
          if (conversationId && sentMsg?.key.id) {
            let mediaType = "document";
            if (isSticker) mediaType = "sticker";
            else if (mime.startsWith("image/")) mediaType = "image";
            else if (mime.startsWith("video/")) mediaType = "video";
            else if (mime.startsWith("audio/")) mediaType = "audio";

            const dbContent = mediaType === "document"
              ? `[MEDIA:document]${sentMsg.key.id}:${fileName}`
              : `[MEDIA:${mediaType}]${sentMsg.key.id}`;

            const displayContent = isSticker
              ? "💟 Figurinha"
              : mime.startsWith("image/")
              ? "📷 Imagem"
              : mime.startsWith("video/")
              ? "🎥 Vídeo"
              : mime.startsWith("audio/")
              ? "🎵 Áudio"
              : `📄 ${fileName}`;

            await db.insert(messages).values({
              id: sentMsg.key.id,
              tenantId,
              conversationId,
              senderType: "agent",
              senderName: senderName || "Operador",
              content: dbContent,
              isInternalNote: false,
              sentAt: new Date(),
            }).onConflictDoNothing();

            await db.update(conversations)
              .set({ lastMessageText: displayContent, lastMessageTime: new Date() })
              .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));

            // Persistir a mídia permanentemente no banco de dados (Base64)
            try {
              const base64Data = buffer.toString("base64");
              await db.insert(mediaFiles).values({
                id: sentMsg.key.id,
                tenantId,
                conversationId: conversationId || null,
                fileName: fileName || null,
                mimeType: mime,
                base64Data,
                createdAt: new Date(),
              }).onConflictDoNothing();
              console.log(`Mídia enviada ${sentMsg.key.id} persistida no banco com sucesso!`);
            } catch (dbErr) {
              console.error(`Erro ao salvar mídia enviada no banco ${sentMsg.key.id}:`, dbErr);
            }

            // Salvar no cache local em disco
            try {
              const fs = await import("fs");
              const path = await import("path");
              const mediaDir = path.join(process.cwd(), "media");
              if (!fs.existsSync(mediaDir)) {
                fs.mkdirSync(mediaDir, { recursive: true });
              }
              fs.writeFileSync(path.join(mediaDir, sentMsg.key.id), buffer);
              fs.writeFileSync(path.join(mediaDir, `${sentMsg.key.id}.mime`), mime);
            } catch (fsErr) {
              console.error("Erro ao salvar cache local de mídia enviada:", fsErr);
            }
          }

          return new Response(
            JSON.stringify({ success: true, messageId: sentMsg?.key.id }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("[send-media] Erro ao enviar mídia:", e);
          return new Response(
            JSON.stringify({ error: e.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
