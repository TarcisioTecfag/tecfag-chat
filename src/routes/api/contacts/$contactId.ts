import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { contacts } from "../../../db/schema";
import { and, eq, ilike, ne, or, sql } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";
import { listCustomFields, validateFieldValues } from "../../../lib/crm/custom-fields";
import { normalizeCanonicalPhone, buildPhoneSearchTerms } from "../../../lib/utils";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/contacts/$contactId")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      // ── PATCH /api/contacts/:contactId ──────────────────────────────────────
      // Body: { name?, phone?, email?, cnpj?, cpf?, tags?, cnpjDetails?, accountId?, accountChangeReason? }
      PATCH: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;
          if (session.operator.role !== "admin" &&
              !session.permissions?.contacts?.canEditContact &&
              !session.permissions?.chat?.canEditClientInfo &&
              !session.permissions?.crm?.canEditDeals) {
            return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
          }

          const { contactId } = params as { contactId: string };
          const body = await request.json().catch(() => null) as {
            name?: string;
            phone?: string;
            whatsappUsername?: string | null;
            email?: string;
            cnpj?: string;
            cpf?: string;
            tags?: string[];
            cnpjDetails?: any;
            accountId?: string | null;
            accountChangeReason?: string;
            customFields?: Record<string, unknown>;
          } | null;
          if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Dados inválidos." }, { status: 400 });

          const [currentContact] = await db.select({ id: contacts.id, customFields: contacts.customFields, walletOperatorId: contacts.walletOperatorId })
            .from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.tenantId, session.tenantId))).limit(1);
          if (!currentContact) return Response.json({ error: "Contato não encontrado." }, { status: 404 });
          if (session.operator.role !== "admin" && session.permissions?.contacts?.contactScope === "wallet_only" && currentContact.walletOperatorId !== session.operator.id) {
            return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
          }

          // Monta apenas os demais campos enviados
          const updates: Record<string, any> = {};
          if ("name" in body) {
            if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 200) return Response.json({ error: "Nome inválido." }, { status: 400 });
            updates.name = body.name.trim();
          }
          if ("phone" in body) {
            if (body.phone != null && typeof body.phone !== "string") return Response.json({ error: "Telefone inválido." }, { status: 400 });
            updates.phone = body.phone ? normalizeCanonicalPhone(body.phone) || null : null;
            if (updates.phone && (updates.phone.length < 8 || updates.phone.length > 40)) return Response.json({ error: "Telefone inválido." }, { status: 400 });
          }
          if ("whatsappUsername" in body) {
            if (body.whatsappUsername != null && typeof body.whatsappUsername !== "string") return Response.json({ error: "Nome de usuário do WhatsApp inválido." }, { status: 400 });
            const username = body.whatsappUsername?.trim().replace(/^@/, "") || "";
            if (username && !/^(?=.{3,35}$)(?=.*[a-zA-Z])[a-zA-Z0-9._]+$/.test(username)) {
              return Response.json({ error: "Nome de usuário do WhatsApp inválido." }, { status: 400 });
            }
            updates.whatsappUsername = username || null;
          }
          if ("email" in body) {
            if (body.email != null && typeof body.email !== "string") return Response.json({ error: "E-mail inválido." }, { status: 400 });
            updates.email = body.email?.trim().toLowerCase() || null;
            if (updates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) return Response.json({ error: "E-mail inválido." }, { status: 400 });
          }
          if ("cnpj" in body) {
            if (body.cnpj != null && typeof body.cnpj !== "string") return Response.json({ error: "CNPJ inválido." }, { status: 400 });
            updates.cnpj = body.cnpj ? body.cnpj.replace(/\D/g, "") || null : null;
          }
          if ("cpf" in body) {
            if (body.cpf != null && typeof body.cpf !== "string") return Response.json({ error: "CPF inválido." }, { status: 400 });
            updates.cpf = body.cpf ? body.cpf.replace(/\D/g, "") || null : null;
          }
          if ("tags" in body) {
            if (!Array.isArray(body.tags) || !body.tags.every((tag) => typeof tag === "string" && tag.length <= 100)) return Response.json({ error: "Marcadores inválidos." }, { status: 400 });
            updates.tags = body.tags;
          }
          if ("cnpjDetails" in body) updates.cnpjDetails = body.cnpjDetails;
          if (body.customFields !== undefined) {
            const patch = validateFieldValues(await listCustomFields(session.tenantId, "contact"), body.customFields);
            updates.customFields = { ...currentContact.customFields, ...patch };
          }

          if (updates.phone || (!updates.phone && updates.email)) {
            const phoneTerms = updates.phone ? buildPhoneSearchTerms(updates.phone) : [];
            const identity = phoneTerms.length > 0
              ? or(...phoneTerms.map((term) => sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${term}`))
              : ilike(contacts.email, updates.email);
            const [duplicate] = await db.select({ id: contacts.id, name: contacts.name }).from(contacts)
              .where(and(eq(contacts.tenantId, session.tenantId), ne(contacts.id, contactId), identity)).limit(1);
            if (duplicate) return Response.json({ error: `Outro contato já usa esses dados: ${duplicate.name}.`, code: "CONTACT_EXISTS", contactId: duplicate.id }, { status: 409 });
          }

          if (body.accountId !== undefined) {
            const { crmService } = await import("../../../lib/crm/crm-service");
            await crmService.updateContactAccount(session.tenantId, contactId, body.accountId, body.accountChangeReason, session.operator.id);
          }

          if (Object.keys(updates).length > 0) {
            await db
              .update(contacts)
              .set(updates)
              .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, session.tenantId)));
          }

          const [updatedContact] = await db
            .select()
            .from(contacts)
            .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, session.tenantId)))
            .limit(1);

          return new Response(JSON.stringify({ success: true, contact: updatedContact }), {
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("Erro ao atualizar contato:", e);
          const statusCode = e?.constraint === "contacts_tenant_phone_identity" ? 409 : e?.statusCode || 500;
          return new Response(JSON.stringify({ error: e.message, code: e?.code }), {
            status: statusCode,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
      },

      // ── GET /api/contacts/:contactId ────────────────────────────────────────
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const session = auth.session;

          const { contactId } = params as { contactId: string };
          const [contact] = await db
            .select()
            .from(contacts)
            .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, session.tenantId)));

          if (!contact) {
            return new Response(JSON.stringify({ error: "Contato não encontrado" }), {
              status: 404,
              headers: { ...CORS, "Content-Type": "application/json" },
            });
          }

          let account = null;
          if (contact.accountId) {
            const { crmAccounts } = await import("../../../db/schema");
            const [acc] = await db
              .select()
              .from(crmAccounts)
              .where(and(eq(crmAccounts.id, contact.accountId), eq(crmAccounts.tenantId, session.tenantId)))
              .limit(1);
            account = acc || null;
          }

          return new Response(JSON.stringify({ ...contact, account }), {
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
