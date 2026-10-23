import { createFileRoute } from "@tanstack/react-router";
import { SessionManager } from "../../../lib/baileys/session-manager";
import { requireSession } from "../../../lib/auth-session";
import { conversationReadCondition } from "../../../lib/access-control/conversation-access";
import { db } from "../../../db";
import { contacts, conversations } from "../../../db/schema";
import { and, eq, or, sql } from "drizzle-orm";

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
          const jid = typeof body.jid === "string" && !body.jid.includes("@") ? `${body.jid.replace(/\D/g, "")}@s.whatsapp.net` : body.jid;

          if (!conversationId && (typeof jid !== "string" || !/^\d{8,20}@(s\.whatsapp\.net|lid|c\.us)$/.test(jid))) {
            return new Response(JSON.stringify({ error: "jid é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const phone = typeof jid === "string" && !jid.endsWith("@lid") ? jid.split("@")[0] : null;
          const [visible] = await db.select({ jid: contacts.whatsappJid, phone: contacts.phone }).from(conversations).innerJoin(contacts, and(
            eq(contacts.id, conversations.contactId), eq(contacts.tenantId, session.tenantId),
          )).where(and(eq(conversations.tenantId, session.tenantId), conversationReadCondition(session),
            conversationId ? eq(conversations.id, conversationId) : or(eq(contacts.whatsappJid, jid), phone ? sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${phone}` : undefined),
            sql`coalesce(${contacts.mainChannel}, 'whatsapp') = 'whatsapp'`,
          )).limit(1);
          if (!visible) return Response.json({ error: "Conversa não encontrada." }, { status: 404 });
          if (!visible.jid && !visible.phone) return Response.json({ error: "Contato sem identidade WhatsApp." }, { status: 400 });
          const resolvedJid = visible.jid || `${visible.phone!.replace(/\D/g, "")}@s.whatsapp.net`;
          const sessionManager = SessionManager.getInstance();
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
