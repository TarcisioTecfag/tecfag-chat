import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db/index.js";
import { operators, conversations, internalMessages } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import {
  getAuthSession,
  sanitizeOperator,
  validateTenantAccess,
  revokeAllOperatorSessions,
} from "../../lib/auth-session.js";
import { hashPassword, needsPasswordMigration } from "../../lib/auth-crypto.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/operators")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
      GET: async ({ request }) => {
        const session = await getAuthSession(request);
        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");

        // Se autenticado por sessão, a sessão é a autoridade
        const effectiveTenantId = session ? session.tenantId : queryTenantId;

        if (!effectiveTenantId) {
          return new Response(
            JSON.stringify({ error: "Sessão inválida ou tenantId ausente.", code: "UNAUTHORIZED" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Se a sessão existe e solicitou outro tenant, rejeita com 404 (sem vazar dados)
        if (session) {
          const tenantCheck = validateTenantAccess(session, queryTenantId);
          if (tenantCheck) return tenantCheck;
        }

        const action = url.searchParams.get("action");
        const id = url.searchParams.get("id");

        // GET ?action=count-linked&id=<operatorId> — conta conversas vinculadas
        if (action === "count-linked" && id) {
          try {
            const linked = await db
              .select({ id: conversations.id, queueState: conversations.queueState })
              .from(conversations)
              .where(
                and(
                  eq(conversations.tenantId, effectiveTenantId),
                  eq(conversations.operatorId as any, id)
                )
              );

            const active = linked.filter((c) => c.queueState !== "finalizados").length;
            return new Response(JSON.stringify({ total: linked.length, active }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          } catch (e: any) {
            return new Response(JSON.stringify({ error: e.message }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        try {
          const list = await db
            .select()
            .from(operators)
            .where(eq(operators.tenantId, effectiveTenantId));

          // NUNCA expor passwordHash em respostas da API!
          const sanitizedList = list.map((op) => sanitizeOperator(op));

          return new Response(JSON.stringify(sanitizedList), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[GET /api/operators] Erro ao listar operadores:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
      POST: async ({ request }) => {
        try {
          const session = await getAuthSession(request);
          const body = await request.json().catch(() => ({}));
          const { id, name, email, passwordHash, password, role, avatar, status, groupId } = body;

          // Autoridade de tenant: sessão do servidor (ou body se bootstrap inicial)
          const tenantId = session ? session.tenantId : body.tenantId;

          if (!tenantId) {
            return new Response(
              JSON.stringify({ error: "Sessão inválida ou tenantId ausente.", code: "UNAUTHORIZED" }),
              { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (session && body.tenantId && body.tenantId !== session.tenantId) {
            return new Response(
              JSON.stringify({ error: "Não é permitido manipular operadores de outro tenant.", code: "FORBIDDEN" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (!id || !name || !email) {
            return new Response(
              JSON.stringify({ error: "id, name e email são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Verificar se o operador já existe
          const existing = await db.query.operators.findFirst({
            where: eq(operators.id, id),
          });

          // Tratar senha: se veio 'password' ou 'passwordHash' em texto simples, migrar para scrypt
          const incomingSecret = password || passwordHash;
          let safePasswordHash: string | undefined = undefined;
          if (incomingSecret) {
            safePasswordHash = needsPasswordMigration(incomingSecret)
              ? hashPassword(incomingSecret)
              : incomingSecret;
          }

          if (existing) {
            // SEGURANÇA: Impedir que um operador existente tenha seu tenant alterado!
            if (existing.tenantId !== tenantId) {
              return new Response(
                JSON.stringify({ error: "Operador não encontrado neste tenant.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            // Atualizar operador existente preservando tenantId
            const updatePayload: any = {
              name,
              email: email.trim().toLowerCase(),
              role: role || existing.role,
              avatar: avatar !== undefined ? avatar : existing.avatar,
              status: status || existing.status,
              groupId: groupId !== undefined ? groupId : existing.groupId,
            };

            if (safePasswordHash) {
              updatePayload.passwordHash = safePasswordHash;
              // Revogar sessões antigas deste operador por segurança
              await revokeAllOperatorSessions(existing.id);
            }

            await db
              .update(operators)
              .set(updatePayload)
              .where(and(eq(operators.id, id), eq(operators.tenantId, tenantId)));

            const updatedOp = await db.query.operators.findFirst({ where: eq(operators.id, id) });
            return new Response(
              JSON.stringify({ success: true, operator: sanitizeOperator(updatedOp) }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          } else {
            // Criar novo operador vinculado incondicionalmente ao tenant da sessão
            const newPassword = safePasswordHash || hashPassword("123456");

            await db.insert(operators).values({
              id,
              tenantId,
              name,
              email: email.trim().toLowerCase(),
              passwordHash: newPassword,
              role: role || "agent",
              avatar: avatar || null,
              status: status || "disponivel",
              groupId: groupId || null,
              isOnline: true,
              createdAt: new Date(),
            });

            const createdOp = await db.query.operators.findFirst({ where: eq(operators.id, id) });
            return new Response(
              JSON.stringify({ success: true, operator: sanitizeOperator(createdOp) }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        } catch (e: any) {
          console.error("[POST /api/operators] Erro ao salvar operador no DB:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
      DELETE: async ({ request }) => {
        const session = await getAuthSession(request);
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        const queryTenantId = url.searchParams.get("tenantId");

        const tenantId = session ? session.tenantId : queryTenantId;

        if (!tenantId) {
          return new Response(
            JSON.stringify({ error: "Sessão inválida ou tenantId ausente.", code: "UNAUTHORIZED" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (!id) {
          return new Response(JSON.stringify({ error: "id é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          const existing = await db.query.operators.findFirst({
            where: and(eq(operators.id, id), eq(operators.tenantId, tenantId)),
          });

          if (!existing) {
            return new Response(
              JSON.stringify({ error: "Operador não encontrado.", code: "NOT_FOUND" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Revogar todas as sessões do operador deletado
          await revokeAllOperatorSessions(existing.id);

          // Desvincular conversas vinculadas ao operador
          await db
            .update(conversations)
            .set({ operatorId: null })
            .where(
              and(
                eq(conversations.tenantId, tenantId),
                eq(conversations.operatorId as any, id)
              )
            );

          // Limpar internalMessages do operador
          await db
            .delete(internalMessages)
            .where(eq(internalMessages.operatorId, id));

          await db
            .delete(operators)
            .where(and(eq(operators.id, id), eq(operators.tenantId, tenantId)));

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[DELETE /api/operators] Erro ao excluir operador:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
