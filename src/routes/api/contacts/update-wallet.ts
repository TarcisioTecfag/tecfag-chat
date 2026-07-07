import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { contacts } from "../../../db/schema";
import { eq } from "drizzle-orm";

export const Route = createFileRoute("/api/contacts/update-wallet")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      },
      POST: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        try {
          const body = await request.json();
          const { contactId, walletOperatorId } = body;

          if (!contactId) {
            return new Response(JSON.stringify({ error: "contactId é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Atualizar o walletOperatorId no banco de dados
          await db
            .update(contacts)
            .set({
              walletOperatorId: walletOperatorId || null,
            })
            .where(eq(contacts.id, contactId));

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("Erro ao atualizar carteira do contato no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
