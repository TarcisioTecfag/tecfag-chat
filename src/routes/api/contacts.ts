import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db/index.js";
import { contacts, conversations, operators } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { shouldIgnoreJid } from "../../lib/baileys/jid-validator.js";
import { requireSession } from "../../lib/auth-session.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/contacts")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId; // SEMPRE da sessão — nunca do body

          const body = await request.json().catch(() => ({}));
          const { name, phone, email, cnpj, channel, operatorId, queueState, contactId, conversationId } = body;

          if (!name) {
            return new Response(
              JSON.stringify({ error: "Campo obrigatório ausente: name." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (phone && shouldIgnoreJid(phone)) {
            return new Response(
              JSON.stringify({ error: "Telefone inválido: grupos, status e listas de transmissão não são aceitos como contato." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const finalContactId = contactId || `cont-${Date.now()}`;
          const finalConversationId = conversationId || `conv-${Date.now()}`;

          // Se operador foi informado, validar que pertence ao mesmo tenant
          let respName = "Na Fila";
          let validOperatorId = null;

          if (operatorId) {
            const op = await db.query.operators.findFirst({
              where: and(eq(operators.id, operatorId), eq(operators.tenantId, tenantId)),
            });
            if (op) {
              validOperatorId = op.id;
              if (queueState === "meus" || !queueState) {
                respName = op.name;
              }
            }
          }

          // 1. Criar Contato no Banco
          await db.insert(contacts).values({
            id: finalContactId,
            tenantId,
            name,
            phone: phone || null,
            email: email || null,
            cnpj: cnpj || null,
            mainChannel: channel || "whatsapp",
            walletOperatorId: validOperatorId,
            responsibleName: respName,
            createdAt: new Date(),
          });

          // 2. Criar Conversa no Banco vinculada atomicamente ao mesmo tenant
          await db.insert(conversations).values({
            id: finalConversationId,
            tenantId,
            contactId: finalContactId,
            operatorId: validOperatorId,
            queueState: queueState || "meus",
            lastMessageText: "Contato criado e atendimento iniciado.",
            lastMessageTime: new Date(),
            version: 1,
            updatedAt: new Date(),
            createdAt: new Date(),
          });

          return new Response(
            JSON.stringify({
              success: true,
              contactId: finalContactId,
              conversationId: finalConversationId,
            }),
            {
              status: 201,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } catch (e: any) {
          console.error("[POST /api/contacts] Erro ao criar contato e conversa no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
