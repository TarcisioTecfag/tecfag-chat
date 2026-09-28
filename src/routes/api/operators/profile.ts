import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db/index.js";
import { operators } from "../../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireSession, sanitizeOperator } from "../../../lib/auth-session.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * PATCH /api/operators/profile
 *
 * Permite que o operador autenticado atualize os próprios dados de perfil:
 * nome, email, avatar e status de disponibilidade.
 *
 * NÃO permite alterar: role, groupId, tenantId, password ou qualquer
 * dado de outro operador. Para essas operações, use POST /api/operators
 * (requer role admin).
 */
export const Route = createFileRoute("/api/operators/profile" as any)({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      PATCH: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const operatorId = session.operator.id;

          const body = await request.json().catch(() => ({}));

          // Campos que um atendente pode alterar no próprio perfil.
          // role, groupId, tenantId, passwordHash são ignorados mesmo que enviados.
          const { name, email, avatar, status } = body;

          if (!name && !email && !avatar && !status) {
            return new Response(
              JSON.stringify({ error: "Nenhum campo de perfil fornecido para atualização." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Construir objeto de atualização apenas com campos presentes
          const updateFields: Record<string, any> = { updatedAt: new Date() };
          if (name !== undefined) updateFields.name = name;
          if (email !== undefined) updateFields.email = email;
          if (avatar !== undefined) updateFields.avatar = avatar;
          if (status !== undefined) updateFields.status = status;

          // Atualizar apenas o operador da própria sessão, no próprio tenant
          const [updated] = await db
            .update(operators)
            .set(updateFields)
            .where(and(eq(operators.id, operatorId), eq(operators.tenantId, tenantId)))
            .returning();

          if (!updated) {
            return new Response(
              JSON.stringify({ error: "Operador não encontrado." }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          return new Response(JSON.stringify(sanitizeOperator(updated)), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[PATCH /api/operators/profile] Erro:", err);
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
