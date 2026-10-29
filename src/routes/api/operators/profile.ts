import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db/index.js";
import { operators, platformAccounts } from "../../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import {
  requireSession,
  sanitizeOperator,
  revokeAllOperatorSessions,
} from "../../../lib/auth-session.js";
import { hashPassword, needsPasswordMigration } from "../../../lib/auth-crypto.js";
import { revokeAccountSessions } from "../../../lib/platform-access.js";
import { SessionManager } from "../../../lib/baileys/session-manager.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * PATCH /api/operators/profile
 *
 * Permite que o operador autenticado atualize os próprios dados de perfil:
 * nome, email, avatar, status de disponibilidade e a própria senha.
 *
 * NÃO permite alterar: role, groupId, tenantId ou qualquer dado de outro operador.
 */
export const Route = createFileRoute("/api/operators/profile")({
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
          // role, groupId e tenantId são ignorados mesmo que enviados.
          const { name, email, avatar, status, password } = body;
          if (email !== undefined && typeof email !== "string") {
            return new Response(JSON.stringify({ error: "E-mail inválido." }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          if (
            session.accountId &&
            email !== undefined &&
            email.trim().toLowerCase() !== session.operator.email.trim().toLowerCase()
          ) {
            return new Response(JSON.stringify({ error: "O e-mail de uma conta multiempresa não pode ser alterado no perfil local." }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const cleanPassword =
            typeof password === "string" && password.trim().length > 0 && password.trim() !== "********"
              ? password.trim()
              : undefined;

          if (!name && !email && avatar === undefined && !status && !cleanPassword) {
            return new Response(
              JSON.stringify({ error: "Nenhum campo de perfil fornecido para atualização." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Construir objeto de atualização apenas com campos presentes
          const updateFields: Record<string, any> = {};
          if (name !== undefined) updateFields.name = name.trim();
          if (email !== undefined) updateFields.email = email.trim().toLowerCase();
          if (avatar !== undefined) updateFields.avatar = avatar;
          if (status !== undefined) updateFields.status = status;

          if (cleanPassword) {
            const safePasswordHash = needsPasswordMigration(cleanPassword)
              ? hashPassword(cleanPassword)
              : cleanPassword;
            updateFields.passwordHash = safePasswordHash;
            updateFields.mustChangePassword = false;

            if (session.accountId) {
              await db
                .update(platformAccounts)
                .set({ passwordHash: safePasswordHash })
                .where(eq(platformAccounts.id, session.accountId));
              await db
                .update(operators)
                .set({ passwordHash: safePasswordHash, mustChangePassword: false })
                .where(eq(operators.accountId, session.accountId));
              await revokeAccountSessions(session.accountId, session.sessionId);
            } else {
              const targetEmail = (email ?? session.operator.email).trim().toLowerCase();
              await db
                .update(platformAccounts)
                .set({ passwordHash: safePasswordHash })
                .where(sql`lower(${platformAccounts.email}) = ${targetEmail}`);
              await revokeAllOperatorSessions(operatorId, session.sessionId);
            }
          }

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

          SessionManager.getInstance().notifyPublic(tenantId, { type: "operators_updated" });

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
