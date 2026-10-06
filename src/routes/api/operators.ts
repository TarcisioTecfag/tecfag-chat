import { createFileRoute } from "@tanstack/react-router";
import { recordCrmAction } from "../../lib/crm/action-history";
import { db } from "../../db/index.js";
import {
  operators,
  conversations,
  internalMessages,
  accessGroups,
  platformAccounts,
  crmDeals,
  contacts,
  crmDealActivities,
} from "../../db/schema.js";
import { eq, and, or } from "drizzle-orm";
import {
  requireSession,
  sanitizeOperator,
  revokeAllOperatorSessions,
} from "../../lib/auth-session.js";
import { hashPassword, needsPasswordMigration } from "../../lib/auth-crypto.js";
import { revokeAccountSessions } from "../../lib/platform-access.js";

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
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const url = new URL(request.url);
        const action = url.searchParams.get("action");
        const id = url.searchParams.get("id");

        // GET ?action=count-linked&id=<operatorId> — auditoria detalhada de patrimônio e vínculos
        if (action === "count-linked" && id) {
          try {
            const [targetOp] = await db
              .select({ id: operators.id, name: operators.name })
              .from(operators)
              .where(and(eq(operators.id, id), eq(operators.tenantId, tenantId)))
              .limit(1);

            // 1. Conversas no Chat
            const linkedConvs = await db
              .select({ id: conversations.id, queueState: conversations.queueState })
              .from(conversations)
              .where(
                and(
                  eq(conversations.tenantId, tenantId),
                  eq(conversations.operatorId as any, id)
                )
              );
            const activeConvs = linkedConvs.filter((c) => c.queueState !== "finalizados").length;

            // 2. Negociações no CRM (Kanban)
            const linkedDeals = await db
              .select({ id: crmDeals.id, status: crmDeals.status })
              .from(crmDeals)
              .where(
                and(
                  eq(crmDeals.tenantId, tenantId),
                  eq(crmDeals.operatorId, id)
                )
              );
            const openDeals = linkedDeals.filter((d) => d.status === "open").length;

            // 3. Contatos na Carteira
            const contactCondition = targetOp?.name
              ? and(
                  eq(contacts.tenantId, tenantId),
                  or(eq(contacts.walletOperatorId, id), eq(contacts.responsibleName, targetOp.name))
                )
              : and(
                  eq(contacts.tenantId, tenantId),
                  eq(contacts.walletOperatorId, id)
                );

            const linkedContacts = await db
              .select({ id: contacts.id })
              .from(contacts)
              .where(contactCondition);

            // 4. Tarefas e Atividades do CRM
            const linkedActivities = await db
              .select({ id: crmDealActivities.id, status: crmDealActivities.status })
              .from(crmDealActivities)
              .where(
                and(
                  eq(crmDealActivities.tenantId, tenantId),
                  or(
                    eq(crmDealActivities.operatorId, id),
                    eq(crmDealActivities.assignedToOperatorId, id)
                  )
                )
              );
            const pendingTasks = linkedActivities.filter((a) => a.status === "pending").length;

            const totalItems = linkedConvs.length + linkedDeals.length + linkedContacts.length + linkedActivities.length;

            return new Response(
              JSON.stringify({
                total: linkedConvs.length, // retrocompatibilidade
                active: activeConvs,      // retrocompatibilidade
                operatorName: targetOp?.name || "",
                conversations: {
                  total: linkedConvs.length,
                  active: activeConvs,
                },
                deals: {
                  total: linkedDeals.length,
                  open: openDeals,
                },
                contacts: {
                  total: linkedContacts.length,
                },
                tasks: {
                  total: linkedActivities.length,
                  pending: pendingTasks,
                },
                totalItems,
              }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          } catch (e: any) {
            console.error("[GET /api/operators?action=count-linked] Erro:", e);
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
            .where(eq(operators.tenantId, tenantId));

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
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          // Apenas admin pode criar/editar operadores
          if (session.operator.role !== "admin") {
            return new Response(
              JSON.stringify({ error: "Permissão insuficiente.", code: "FORBIDDEN" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const body = await request.json().catch(() => ({}));
          const { id, name, email, passwordHash, password, role, avatar, status, groupId } = body;

          if (!id || !name || !email) {
            return new Response(
              JSON.stringify({ error: "id, name e email são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Verificar se o operador já existe
          const existing = await db.query.operators.findFirst({
            where: and(eq(operators.id, id), eq(operators.tenantId, tenantId)),
          });
          if (groupId) {
            const group = await db.query.accessGroups.findFirst({
              where: and(eq(accessGroups.id, groupId), eq(accessGroups.tenantId, tenantId)),
            });
            if (!group) return new Response(JSON.stringify({ error: "Grupo não encontrado neste tenant." }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Tratar senha: se veio 'password' ou 'passwordHash' em texto simples, migrar para scrypt
          const incomingSecret = password || passwordHash;
          let safePasswordHash: string | undefined = undefined;
          if (incomingSecret) {
            safePasswordHash = needsPasswordMigration(incomingSecret)
              ? hashPassword(incomingSecret)
              : incomingSecret;
          }

          if (existing) {
            if (existing.accountId && existing.email !== email.trim().toLowerCase()) {
              return new Response(JSON.stringify({ error: "O e-mail de uma conta multiempresa deve ser alterado pela gestão de acesso global." }), {
                status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
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
              if (existing.accountId) {
                await db.update(platformAccounts).set({ passwordHash: safePasswordHash })
                  .where(eq(platformAccounts.id, existing.accountId));
                await revokeAccountSessions(existing.accountId);
              } else {
                await revokeAllOperatorSessions(existing.id);
              }
            }

            await db
              .update(operators)
              .set(updatePayload)
              .where(and(eq(operators.id, id), eq(operators.tenantId, tenantId)));

            const updatedOp = await db.query.operators.findFirst({
              where: and(eq(operators.id, id), eq(operators.tenantId, tenantId)),
            });
            return new Response(
              JSON.stringify({ success: true, operator: sanitizeOperator(updatedOp) }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          } else {
            // Criar novo operador: senha obrigatória para novos registros
            if (!safePasswordHash) {
              return new Response(
                JSON.stringify({ error: "password é obrigatório para criar um novo operador.", code: "BAD_REQUEST" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            // Criar novo operador vinculado incondicionalmente ao tenant da sessão
            await db.insert(operators).values({
              id,
              tenantId,
              name,
              email: email.trim().toLowerCase(),
              passwordHash: safePasswordHash,
              role: role || "agent",
              avatar: avatar || null,
              status: status || "disponivel",
              groupId: groupId || null,
              isOnline: true,
              createdAt: new Date(),
            });

            const createdOp = await db.query.operators.findFirst({
              where: and(eq(operators.id, id), eq(operators.tenantId, tenantId)),
            });
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
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        // Apenas admin pode excluir operadores
        if (session.operator.role !== "admin") {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        const transferToOperatorId = url.searchParams.get("transferToOperatorId"); // ID do operador de destino (Opção A)

        if (!id) {
          return new Response(JSON.stringify({ error: "id é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (id === session.operator.id) {
          return new Response(JSON.stringify({ error: "Você não pode excluir sua própria conta.", code: "BAD_REQUEST" }), {
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
          if (existing.accountId) {
            return new Response(JSON.stringify({ error: "Remova o acesso multiempresa antes de excluir este operador." }), {
              status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Se fornecido operador de destino para transferência, validar existência no mesmo tenant
          let destOp: any = null;
          if (transferToOperatorId && transferToOperatorId !== "unassign" && transferToOperatorId !== "none") {
            if (transferToOperatorId === id) {
              return new Response(JSON.stringify({ error: "O operador de destino deve ser diferente do operador a ser excluído." }), {
                status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            destOp = await db.query.operators.findFirst({
              where: and(eq(operators.id, transferToOperatorId), eq(operators.tenantId, tenantId)),
            });
            if (!destOp) {
              return new Response(JSON.stringify({ error: "Operador de destino não encontrado neste tenant." }), {
                status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          }

          let transferredDealsCount = 0;
          let transferredContactsCount = 0;
          let transferredConvsCount = 0;
          let transferredTasksCount = 0;

          if (destOp) {
            // ── OPÇÃO A: TRANSFERIR CUSTÓDIA DE TODO O PATRIMÔNIO ──────────
            // 1. Reatribuir Negociações do CRM
            const dealsRes = await db
              .update(crmDeals)
              .set({ operatorId: destOp.id, updatedAt: new Date() })
              .where(and(eq(crmDeals.operatorId, id), eq(crmDeals.tenantId, tenantId)))
              .returning({ id: crmDeals.id });
            transferredDealsCount = dealsRes.length;

            // 2. Reatribuir Contatos na Carteira
            const contactsRes = await db
              .update(contacts)
              .set({ walletOperatorId: destOp.id, responsibleName: destOp.name })
              .where(
                and(
                  eq(contacts.tenantId, tenantId),
                  or(eq(contacts.walletOperatorId, id), eq(contacts.responsibleName, existing.name))
                )
              )
              .returning({ id: contacts.id });
            transferredContactsCount = contactsRes.length;

            // 3. Reatribuir Conversas do Chat
            const convsRes = await db
              .update(conversations)
              .set({ operatorId: destOp.id, updatedAt: new Date() })
              .where(and(eq(conversations.operatorId as any, id), eq(conversations.tenantId, tenantId)))
              .returning({ id: conversations.id });
            transferredConvsCount = convsRes.length;

            // 4. Reatribuir Tarefas e Atividades do CRM
            const tasksRes = await db
              .update(crmDealActivities)
              .set({ operatorId: destOp.id, assignedToOperatorId: destOp.id, updatedAt: new Date() })
              .where(
                and(
                  eq(crmDealActivities.tenantId, tenantId),
                  or(eq(crmDealActivities.operatorId, id), eq(crmDealActivities.assignedToOperatorId, id))
                )
              )
              .returning({ id: crmDealActivities.id });
            transferredTasksCount = tasksRes.length;
          } else {
            // ── OPÇÃO B: DESVINCULAR COM HIGIENIZAÇÃO EXPLÍCITA ─────────────
            // 1. Negociações ficam sem vendedor
            await db
              .update(crmDeals)
              .set({ operatorId: null, updatedAt: new Date() })
              .where(and(eq(crmDeals.operatorId, id), eq(crmDeals.tenantId, tenantId)));

            // 2. Contatos são devolvidos para a fila geral sem dono órfão
            await db
              .update(contacts)
              .set({ walletOperatorId: null, responsibleName: "Na Fila" })
              .where(
                and(
                  eq(contacts.tenantId, tenantId),
                  or(eq(contacts.walletOperatorId, id), eq(contacts.responsibleName, existing.name))
                )
              );

            // 3. Conversas vão para a fila geral
            await db
              .update(conversations)
              .set({ operatorId: null, queueState: "fila", updatedAt: new Date() })
              .where(and(eq(conversations.operatorId as any, id), eq(conversations.tenantId, tenantId)));

            // 4. Atividades / Tarefas perdem o responsável
            await db
              .update(crmDealActivities)
              .set({ operatorId: null, assignedToOperatorId: null, updatedAt: new Date() })
              .where(
                and(
                  eq(crmDealActivities.tenantId, tenantId),
                  or(eq(crmDealActivities.operatorId, id), eq(crmDealActivities.assignedToOperatorId, id))
                )
              );
          }

          // Revogar todas as sessões do operador deletado
          await revokeAllOperatorSessions(existing.id);

          // Limpar internalMessages do operador
          await db
            .delete(internalMessages)
            .where(and(eq(internalMessages.operatorId, id), eq(internalMessages.tenantId, tenantId)));

          // Deletar o operador
          await db
            .delete(operators)
            .where(and(eq(operators.id, id), eq(operators.tenantId, tenantId)));

          // Registrar na auditoria do CRM
          await recordCrmAction({
            tenantId,
            operatorId: session.operator.id,
            operatorName: session.operator.name,
            action: destOp ? "transfer_and_delete_operator" : "delete_operator",
            entityType: "operator",
            itemCount: 1,
            details: {
              deletedOperator: { id, name: existing.name },
              transferredTo: destOp ? { id: destOp.id, name: destOp.name } : null,
              stats: {
                deals: transferredDealsCount,
                contacts: transferredContactsCount,
                conversations: transferredConvsCount,
                tasks: transferredTasksCount,
              },
            },
          });

          return new Response(
            JSON.stringify({
              success: true,
              transferredTo: destOp ? { id: destOp.id, name: destOp.name } : null,
              stats: {
                deals: transferredDealsCount,
                contacts: transferredContactsCount,
                conversations: transferredConvsCount,
                tasks: transferredTasksCount,
              },
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
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
