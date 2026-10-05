import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db/index.js";
import { channelConfigs, contacts, conversations } from "../../db/schema.js";
import { eq, and, count, desc, ilike, or, sql } from "drizzle-orm";
import { shouldIgnoreJid } from "../../lib/baileys/jid-validator.js";
import { requireSession } from "../../lib/auth-session.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/contacts")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin" && !session.permissions?.views?.contacts) {
          return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
        }

        const url = new URL(request.url);
        const search = (url.searchParams.get("search") || "").trim().slice(0, 100);
        const channel = url.searchParams.get("channel");
        if (channel && !["whatsapp", "instagram", "messenger", "livechat"].includes(channel)) {
          return Response.json({ error: "Canal inválido." }, { status: 400 });
        }
        const rawLimit = Number(url.searchParams.get("limit"));
        const rawOffset = Number(url.searchParams.get("offset"));
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 100) : 50;
        const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
        const conditions = [eq(contacts.tenantId, tenantId)];
        if (session.operator.role !== "admin" && session.permissions?.contacts?.contactScope === "wallet_only") {
          conditions.push(eq(contacts.walletOperatorId, session.operator.id));
        }
        if (channel) conditions.push(eq(contacts.mainChannel, channel));
        if (search) {
          const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
          const digits = search.replace(/\D/g, "");
          conditions.push(or(
            ilike(contacts.name, pattern), ilike(contacts.email, pattern),
            ilike(contacts.whatsappUsername, pattern),
            ilike(contacts.phone, pattern), ilike(contacts.cnpj, pattern), ilike(contacts.cpf, pattern),
            ilike(contacts.responsibleName, pattern),
            sql`${contacts.tags}::text ILIKE ${pattern}`,
            digits.length >= 4 ? sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') LIKE ${`%${digits}%`}` : undefined,
          )!);
        }
        const where = and(...conditions);
        try {
          const [items, totals] = await Promise.all([
            db.select({
              id: contacts.id, name: contacts.name, phone: contacts.phone,
              whatsappUsername: contacts.whatsappUsername,
              email: contacts.email, cnpj: contacts.cnpj, cpf: contacts.cpf,
              avatar: contacts.avatar, tags: contacts.tags,
              mainChannel: contacts.mainChannel, walletOperatorId: contacts.walletOperatorId,
              responsibleName: contacts.responsibleName,
              latestConversationId: sql<string | null>`(
                SELECT conv.id FROM conversations conv
                WHERE conv.contact_id = ${contacts.id} AND conv.tenant_id = ${tenantId}
                ORDER BY conv.last_message_time DESC, conv.created_at DESC LIMIT 1
              )`,
              latestOperatorId: sql<string | null>`(
                SELECT conv.operator_id FROM conversations conv
                WHERE conv.contact_id = ${contacts.id} AND conv.tenant_id = ${tenantId}
                ORDER BY conv.last_message_time DESC, conv.created_at DESC LIMIT 1
              )`,
            }).from(contacts).where(where).orderBy(desc(contacts.createdAt), desc(contacts.id)).limit(limit).offset(offset),
            db.select({ total: count() }).from(contacts).where(where),
          ]);
          return Response.json({ contacts: items, total: totals[0]?.total || 0, limit, offset });
        } catch (error) {
          console.error("[GET /api/contacts] Erro ao listar contatos:", error);
          return Response.json({ error: "Não foi possível listar os contatos." }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId; // SEMPRE da sessão — nunca do body
          if (session.operator.role !== "admin" && !session.permissions?.contacts?.canCreateContact) {
            return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
          }

          const body = await request.json().catch(() => ({}));
          const { name, phone, email, cnpj, channel } = body;

          if (typeof name !== "string" || !name.trim() || name.trim().length > 200) {
            return new Response(
              JSON.stringify({ error: "Campo obrigatório ausente: name." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const normalizedPhone = typeof phone === "string" ? phone.replace(/\D/g, "") : "";
          const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
          if ((phone && (typeof phone !== "string" || phone.length > 40)) ||
              (normalizedPhone && normalizedPhone.length < 8) ||
              (email != null && typeof email !== "string") ||
              normalizedEmail.length > 254 ||
              (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) ||
              (channel && !["whatsapp", "instagram", "messenger", "livechat"].includes(channel)) ||
              (cnpj && (typeof cnpj !== "string" || cnpj.length > 32))) {
            return Response.json({ error: "Dados do contato inválidos." }, { status: 400 });
          }
          if (phone && shouldIgnoreJid(phone)) {
            return new Response(
              JSON.stringify({ error: "Telefone inválido: grupos, status e listas de transmissão não são aceitos como contato." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const finalContactId = `cont-${crypto.randomUUID()}`;
          const finalConversationId = `conv-${crypto.randomUUID()}`;

          const [channelConfig] = await db.select({ activeProvider: channelConfigs.activeProvider })
            .from(channelConfigs).where(eq(channelConfigs.tenantId, tenantId)).limit(1);
          const requiresExplicitCapture = channelConfig?.activeProvider === "meta";

          const duplicate = await db.transaction(async (tx) => {
            if (normalizedPhone || normalizedEmail) {
              await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${normalizedPhone || normalizedEmail}))`);
            }
            const identity = normalizedPhone.length >= 8
              ? sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${normalizedPhone}`
              : normalizedEmail ? ilike(contacts.email, normalizedEmail) : undefined;
            if (identity) {
              const [existing] = await tx.select({ id: contacts.id, name: contacts.name })
                .from(contacts).where(and(eq(contacts.tenantId, tenantId), identity)).limit(1);
              if (existing) return existing;
            }
            const now = new Date();
            await tx.insert(contacts).values({
              id: finalContactId, tenantId, name: name.trim(),
              phone: normalizedPhone || null, email: normalizedEmail || null,
              cnpj: cnpj ? cnpj.replace(/\D/g, "") : null,
              mainChannel: channel || "whatsapp",
              walletOperatorId: requiresExplicitCapture ? null : session.operator.id,
              responsibleName: requiresExplicitCapture ? "Na Fila" : session.operator.name,
              createdAt: now,
            });
            await tx.insert(conversations).values({
              id: finalConversationId, tenantId, contactId: finalContactId,
              operatorId: requiresExplicitCapture ? null : session.operator.id,
              queueState: requiresExplicitCapture ? "fila" : "meus",
              lastMessageText: requiresExplicitCapture ? "Contato criado. Aguardando captura do atendimento." : "Contato criado e atendimento iniciado.",
              lastMessageTime: now, version: 1, updatedAt: now, createdAt: now,
            });
            return null;
          });
          if (duplicate) {
            return Response.json({ error: `Contato já cadastrado: ${duplicate.name}.`, code: "CONTACT_EXISTS", contactId: duplicate.id }, { status: 409 });
          }

          return new Response(
            JSON.stringify({
              success: true,
              contactId: finalContactId,
              conversationId: finalConversationId,
              queueState: requiresExplicitCapture ? "fila" : "meus",
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
