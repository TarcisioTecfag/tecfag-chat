import { createFileRoute } from "@tanstack/react-router";
import { SessionManager } from "../../../lib/baileys/session-manager";
import { db } from "../../../db";
import { messages, conversations, contacts } from "../../../db/schema";
import { eq } from "drizzle-orm";

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
          const formData = await request.formData();
          const tenantId = formData.get("tenantId") as string;
          const phone = formData.get("phone") as string;
          const conversationId = formData.get("conversationId") as string;
          const senderName = formData.get("senderName") as string;
          const file = formData.get("file") as File | null;

          if (!tenantId || !file) {
            return new Response(
              JSON.stringify({ error: "tenantId e file são obrigatórios" }),
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
          if (conversationId) {
            try {
              const conv = await db.query.conversations.findFirst({
                where: (t, { eq: dEq }) => dEq(t.id, conversationId),
              });
              if (conv?.contactId) {
                const contact = await db.query.contacts.findFirst({
                  where: (t, { eq: dEq }) => dEq(t.id, conv.contactId),
                });
                jid = contact?.whatsappJid || `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
              } else {
                jid = `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
              }
            } catch {
              jid = `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
            }
          } else {
            jid = `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
          }

          const mime = file.type || "application/octet-stream";
          const fileName = file.name || "arquivo";
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // Determinar tipo de mensagem Baileys pelo MIME
          let sentMsg: any;
          if (mime.startsWith("image/")) {
            sentMsg = await sock.sendMessage(jid, {
              image: buffer,
              mimetype: mime,
              caption: "",
            });
          } else if (mime.startsWith("video/")) {
            sentMsg = await sock.sendMessage(jid, {
              video: buffer,
              mimetype: mime,
              caption: "",
            });
          } else if (mime.startsWith("audio/")) {
            sentMsg = await sock.sendMessage(jid, {
              audio: buffer,
              mimetype: mime,
              ptt: false,
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
            const displayContent = mime.startsWith("image/")
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
              content: displayContent,
              isInternalNote: false,
              sentAt: new Date(),
            }).onConflictDoNothing();

            await db.update(conversations)
              .set({ lastMessageText: displayContent, lastMessageTime: new Date() })
              .where(eq(conversations.id, conversationId));
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
