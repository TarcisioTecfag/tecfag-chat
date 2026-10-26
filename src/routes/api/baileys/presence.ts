import { createFileRoute } from "@tanstack/react-router";
import { SessionManager } from "../../../lib/baileys/session-manager";
import { requireSession } from "../../../lib/auth-session";
import { conversationReadCondition } from "../../../lib/access-control/conversation-access";
import { db } from "../../../db";
import { contacts, conversations } from "../../../db/schema";
import { and, eq, or, sql, isNull } from "drizzle-orm";
import { connectionPeerJid } from "../../../lib/whatsapp/connection-contacts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/baileys/presence")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          const body = await request.json();
          const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
          if (conversationId === "valentina") {
            return new Response(JSON.stringify({ success: true, skipped: true }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          const jid = typeof body.jid === "string" && !body.jid.includes("@") ? `${body.jid.replace(/\D/g, "")}@s.whatsapp.net` : body.jid;

          if (!conversationId && (typeof jid !== "string" || !/^\d{8,20}@(s\.whatsapp\.net|lid|c\.us)$/.test(jid))) {
            return new Response(JSON.stringify({ error: "jid é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const phone = typeof jid === "string" && !jid.endsWith("@lid") ? jid.split("@")[0] : null;
          const [visible] = await db.select({ jid: contacts.whatsappJid, phone: contacts.phone, contactId: contacts.id, whatsappConnectionId: conversations.whatsappConnectionId }).from(conversations).innerJoin(contacts, and(
            eq(contacts.id, conversations.contactId), eq(contacts.tenantId, session.tenantId),
          )).where(and(eq(conversations.tenantId, session.tenantId), conversationReadCondition(session),
            conversationId ? eq(conversations.id, conversationId) : and(isNull(conversations.whatsappConnectionId), or(eq(contacts.whatsappJid, jid), phone ? sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${phone}` : undefined)),
          )).limit(1);
          if (!visible) return Response.json({ error: "Conversa não encontrada." }, { status: 404 });
          const scopedJid = visible.whatsappConnectionId ? await connectionPeerJid(session.tenantId, visible.whatsappConnectionId, visible.contactId) : visible.jid;
          if (!scopedJid && !visible.phone) return Response.json({ error: "Contato sem identidade WhatsApp." }, { status: 400 });
          const resolvedJid = scopedJid || `${visible.phone!.replace(/\D/g, "")}@s.whatsapp.net`;
          const sessionManager = SessionManager.forConnection(session.tenantId, visible.whatsappConnectionId);
          await sessionManager.subscribePresence(session.tenantId, resolvedJid);

          return new Response(JSON.stringify({ success: true, jid }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[POST /api/baileys/presence] Erro:", e);
          return new Response(
            JSON.stringify({ error: "Erro ao subscrever presença", details: e?.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
