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
import { eq, and, or, ne, sql } from "drizzle-orm";
import {
  requireSession,
  sanitizeOperator,
  revokeAllOperatorSessions,
} from "../../lib/auth-session.js";
import { hashPassword, needsPasswordMigration } from "../../lib/auth-crypto.js";
import { revokeAccountSessions } from "../../lib/platform-access.js";
import {
  computeOperatorPresenceSnapshot,
  markOperatorOffline,
} from "../../lib/operator-presence.js";
import {
  computeTenantOperatorsOnboardingMap,
  forceCompleteOperatorOnboarding,
} from "../../lib/onboarding/service.js";
import { SessionManager } from "../../lib/baileys/session-manager.js";

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

          const wizardMap = await computeTenantOperatorsOnboardingMap(tenantId, list);

          // NUNCA expor passwordHash em respostas da API!
          const sanitizedList = list.map((op) => {
            const base = sanitizeOperator(op);
            const presence = computeOperatorPresenceSnapshot(op, tenantId, session.operator.id);
            const wizard = wizardMap.get(op.id);
            return {
              ...base,
              isOnline: presence.isOnline,
              lastSeenAt: presence.lastSeenAt,
              usageSecondsToday: presence.usageSecondsToday,
              mustChangePassword: !!op.mustChangePassword,
              wizardCompletionPct: wizard?.wizardCompletionPct ?? 0,
              wizardCompletedSteps: wizard?.wizardCompletedSteps ?? 0,
              wizardTotalSteps: wizard?.wizardTotalSteps ?? 0,
              wizardStatus: wizard?.wizardStatus ?? "not_started",
              wizardCompletedAt: wizard?.wizardCompletedAt ?? null,
            };
          });

          return new Response(JSON.stringify(sanitizedList), {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
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

          const body = await request.json().catch(() => ({}));
          const { action, id, name, email, passwordHash, password, role, avatar, status, groupId } = body;

          if (!id || typeof id !== "string") {
            return new Response(
              JSON.stringify({ error: "id é obrigatório" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // ── AÇÃO ESPECIAL 1: Completar Wizard Automaticamente ──────────────
          if (action === "complete-wizard") {
            const targetOp = await db.query.operators.findFirst({
              where: and(eq(operators.id, id), eq(operators.tenantId, tenantId)),
            });
            if (!targetOp) {
              return new Response(
                JSON.stringify({ error: "Operador não encontrado neste ambiente.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            await forceCompleteOperatorOnboarding(tenantId, id);
            const wizardMap = await computeTenantOperatorsOnboardingMap(tenantId, [targetOp]);
            const wizard = wizardMap.get(id);

            const sm = SessionManager.getInstance();
            sm.notifyPublic(tenantId, { type: "onboarding_updated", operatorId: id });
            sm.notifyPublic(tenantId, { type: "operators_updated" });

            return new Response(
              JSON.stringify({
                success: true,
                operatorId: id,
                wizard: wizard ?? {
                  wizardCompletionPct: 100,
                  wizardCompletedSteps: 0,
                  wizardTotalSteps: 0,
                  wizardStatus: "completed",
                  wizardCompletedAt: new Date().toISOString(),
                },
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // ── AÇÃO ESPECIAL 2: Habilitar/Desabilitar Redefinição de Senha + Logout Imediato ──
          if (action === "require-password-reset") {
            const targetOp = await db.query.operators.findFirst({
              where: and(eq(operators.id, id), eq(operators.tenantId, tenantId)),
            });
            if (!targetOp) {
              return new Response(
                JSON.stringify({ error: "Operador não encontrado neste ambiente.", code: "NOT_FOUND" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            const nextEnabled =
              typeof body.enabled === "boolean" ? body.enabled : !targetOp.mustChangePassword;

            await db
              .update(operators)
              .set({
                mustChangePassword: nextEnabled,
                ...(nextEnabled ? { isOnline: false } : {}),
              })
              .where(and(eq(operators.id, id), eq(operators.tenantId, tenantId)));

            if (targetOp.accountId) {
              await db
                .update(operators)
                .set({
                  mustChangePassword: nextEnabled,
                  ...(nextEnabled ? { isOnline: false } : {}),
                })
                .where(eq(operators.accountId, targetOp.accountId));
            }

            const sm = SessionManager.getInstance();

            if (nextEnabled) {
              await markOperatorOffline(tenantId, id);
              if (targetOp.accountId) {
                await revokeAccountSessions(targetOp.accountId);
              } else {
                await revokeAllOperatorSessions(id);
              }
              sm.notifyPublic(tenantId, {
                type: "force_logout",
                operatorId: id,
                reason: "password_reset_required",
              });
            }

            sm.notifyPublic(tenantId, { type: "operators_updated" });

            return new Response(
              JSON.stringify({
                success: true,
                operatorId: id,
                mustChangePassword: nextEnabled,
                forcedLogout: nextEnabled,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const canManageOperators =
            session.operator.role === "admin" ||
            session.operator.groupId === "group-admin" ||
            Boolean(session.permissions?.security?.canManageUsers) ||
            Boolean(session.permissions?.security?.canResetUserPasswords);

          if (!canManageOperators) {
            return new Response(
              JSON.stringify({ error: "Permissão insuficiente.", code: "FORBIDDEN" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Verificar se o operador já existe
          const existing = await db.query.operators.findFirst({
            where: and(eq(operators.id, id), eq(operators.tenantId, tenantId)),
          });

          const finalName = typeof name === "string" && name.trim().length > 0 ? name.trim() : existing?.name;
          const finalEmail =
            typeof email === "string" && email.trim().length > 0
              ? email.trim().toLowerCase()
              : existing?.email?.trim().toLowerCase();

          if (!finalName || !finalEmail) {
            return new Response(
              JSON.stringify({ error: "id, name e email são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Verificar duplicidade de e-mail no mesmo tenant
          const duplicateInTenant = await db.query.operators.findFirst({
            where: and(
              eq(operators.tenantId, tenantId),
              sql`lower(${operators.email}) = ${finalEmail}`,
              ne(operators.id, id),
            ),
          });
          if (duplicateInTenant) {
            return new Response(
              JSON.stringify({ error: "Já existe outro operador cadastrado com este e-mail neste ambiente." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const finalGroupId = groupId !== undefined ? (groupId || null) : (existing?.groupId ?? null);

          if (finalGroupId) {
            const group = await db.query.accessGroups.findFirst({
              where: and(eq(accessGroups.id, finalGroupId), eq(accessGroups.tenantId, tenantId)),
            });
            if (!group) return new Response(JSON.stringify({ error: "Grupo não encontrado neste tenant." }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Tratar senha: se veio 'password' ou 'passwordHash' em texto simples, migrar para scrypt
          const incomingSecret =
            typeof password === "string" && password.trim().length > 0
              ? password.trim()
              : typeof passwordHash === "string" && passwordHash.trim().length > 0
                ? passwordHash.trim()
                : undefined;
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

            const previousEmail = existing.email.trim().toLowerCase();
            if (existing.accountId && finalEmail !== previousEmail) {
              const conflictingGlobalAccount = await db.query.platformAccounts.findFirst({
                where: and(
                  sql`lower(${platformAccounts.email}) = ${finalEmail}`,
                  ne(platformAccounts.id, existing.accountId),
                ),
              });
              if (conflictingGlobalAccount) {
                return new Response(
                  JSON.stringify({ error: "Este e-mail já está vinculado a outra conta global na plataforma." }),
                  { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
              }
              await db
                .update(platformAccounts)
                .set({ email: finalEmail })
                .where(eq(platformAccounts.id, existing.accountId));
              await db
                .update(operators)
                .set({ email: finalEmail })
                .where(eq(operators.accountId, existing.accountId));
            }

            const resolvedRole =
              finalGroupId === "group-admin"
                ? "admin"
                : role || (existing.groupId === "group-admin" && finalGroupId !== "group-admin" ? "agent" : existing.role || "agent");

            // Atualizar operador existente preservando tenantId
            const updatePayload: any = {
              name: finalName,
              email: finalEmail,
              role: resolvedRole,
              avatar: avatar !== undefined ? avatar : existing.avatar,
              status: status || existing.status,
              groupId: finalGroupId,
            };

            if (safePasswordHash) {
              updatePayload.passwordHash = safePasswordHash;
              const keepCurrentSessionId =
                existing.id === session.operator.id ? session.sessionId : undefined;

              // Atualizar senha em platformAccounts se vinculada por accountId ou por e-mail
              if (existing.accountId) {
                await db
                  .update(platformAccounts)
                  .set({ passwordHash: safePasswordHash })
                  .where(eq(platformAccounts.id, existing.accountId));
                await db
                  .update(operators)
                  .set({ passwordHash: safePasswordHash })
                  .where(eq(operators.accountId, existing.accountId));
                await revokeAccountSessions(existing.accountId, keepCurrentSessionId);
              } else {
                const matchedPlatformAccount = await db.query.platformAccounts.findFirst({
                  where: or(
                    sql`lower(${platformAccounts.email}) = ${previousEmail}`,
                    sql`lower(${platformAccounts.email}) = ${finalEmail}`,
                  ),
                });
                if (matchedPlatformAccount) {
                  await db
                    .update(platformAccounts)
                    .set({ passwordHash: safePasswordHash })
                    .where(eq(platformAccounts.id, matchedPlatformAccount.id));
                }
                await revokeAllOperatorSessions(existing.id, keepCurrentSessionId);
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

            const resolvedRole =
              finalGroupId === "group-admin" ? "admin" : (role || "agent");

            // Criar novo operador vinculado incondicionalmente ao tenant da sessão
            await db.insert(operators).values({
              id,
              tenantId,
              name: finalName,
              email: finalEmail,
              passwordHash: safePasswordHash,
              role: resolvedRole,
              avatar: avatar || null,
              status: status || "disponivel",
              groupId: finalGroupId,
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

        const canDeleteOperators =
          session.operator.role === "admin" ||
          session.operator.groupId === "group-admin" ||
          Boolean(session.permissions?.security?.canManageUsers);

        if (!canDeleteOperators) {
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
