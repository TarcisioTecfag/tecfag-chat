import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { contacts } from "../../../db/schema";
import { and, eq } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";

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

          const { contactId } = params as { contactId: string };
          const body = await request.json() as {
            name?: string;
            phone?: string;
            email?: string;
            cnpj?: string;
            cpf?: string;
            tags?: string[];
            cnpjDetails?: any;
            accountId?: string | null;
            accountChangeReason?: string;
          };

          // 1. Se alteração de cliente/conta compradora foi solicitada
          if (body.accountId !== undefined) {
            const { crmService } = await import("../../../lib/crm/crm-service");
            await crmService.updateContactAccount(
              session.tenantId,
              contactId,
              body.accountId,
              body.accountChangeReason,
              session.operator.id
            );
          }

          // Monta apenas os demais campos enviados
          const updates: Record<string, any> = {};
          if ("name"  in body) updates.name  = body.name;
          if ("phone" in body) updates.phone = body.phone;
          if ("email" in body) updates.email = body.email;
          if ("cnpj"  in body) updates.cnpj  = body.cnpj;
          if ("cpf"   in body) updates.cpf   = body.cpf;
          if ("tags"  in body) updates.tags  = body.tags;
          if ("cnpjDetails" in body) updates.cnpjDetails = body.cnpjDetails;

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
          const statusCode = e?.statusCode || 500;
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
