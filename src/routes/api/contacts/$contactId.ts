import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { contacts } from "../../../db/schema";
import { eq } from "drizzle-orm";

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
      // Body: { phone?, email?, cnpj?, cpf? }
      PATCH: async ({ request, params }) => {
        try {
          const { contactId } = params as { contactId: string };
          const body = await request.json() as {
            name?: string;
            phone?: string;
            email?: string;
            cnpj?: string;
            cpf?: string;
            tags?: string[];
          };

          // Monta apenas os campos enviados
          const updates: Record<string, any> = {};
          if ("name"  in body) updates.name  = body.name;
          if ("phone" in body) updates.phone = body.phone;
          if ("email" in body) updates.email = body.email;
          if ("cnpj"  in body) updates.cnpj  = body.cnpj;
          if ("cpf"   in body) updates.cpf   = body.cpf;
          if ("tags"  in body) updates.tags  = body.tags;

          if (Object.keys(updates).length === 0) {
            return new Response(JSON.stringify({ error: "Nenhum campo para atualizar" }), {
              status: 400,
              headers: { ...CORS, "Content-Type": "application/json" },
            });
          }

          await db.update(contacts).set(updates).where(eq(contacts.id, contactId));

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("Erro ao atualizar contato:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
      },

      // ── GET /api/contacts/:contactId ────────────────────────────────────────
      GET: async ({ params }) => {
        try {
          const { contactId } = params as { contactId: string };
          const [contact] = await db
            .select()
            .from(contacts)
            .where(eq(contacts.id, contactId));

          if (!contact) {
            return new Response(JSON.stringify({ error: "Contato não encontrado" }), {
              status: 404,
              headers: { ...CORS, "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify(contact), {
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
