import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import {
  contacts,
  conversations,
  crmDealActivities,
  crmDeals,
  crmDealContacts,
  crmStages,
  crmAccounts,
  operators,
} from "../../db/schema";
import { eq, and, sql, desc, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireSession } from "../../lib/auth-session";
import { crmService } from "../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * Consulta tarefas e compromissos comerciais nativos do Kanban/CRM (crm_deal_activities)
 * com joins em negociações, contatos (priorizando isPrimary), contas, etapas e operadores,
 * assegurando isolamento estrito de tenant e excluindo tarefas canceladas.
 */
export async function getNativeKanbanTasks(
  tenantId: string,
  options: {
    operatorId?: string | null;
    email?: string | null;
    isAdmin?: boolean;
    all?: boolean;
    scope?: "all_visible" | "mine" | "delegated" | "all";
    filterOperatorId?: string | null;
  }
) {
  const conditions = [
    eq(crmDealActivities.tenantId, tenantId),
    sql`${crmDealActivities.type} NOT IN ('note', 'system_event')`,
    sql`${crmDealActivities.status} != 'cancelled'`,
  ];

  const canSeeAll = Boolean(options.isAdmin && (options.all || options.scope === "all"));

  const isAssignedToOpSql = (opId: string) =>
    or(
      eq(crmDealActivities.assignedToOperatorId, opId),
      sql`${crmDealActivities.assignedToOperatorIds} @> ${JSON.stringify([opId])}::jsonb`
    )!;

  if (options.filterOperatorId && options.filterOperatorId !== "all") {
    conditions.push(
      or(
        isAssignedToOpSql(options.filterOperatorId),
        and(
          sql`${crmDealActivities.assignedToOperatorId} IS NULL`,
          or(
            eq(crmDealActivities.operatorId, options.filterOperatorId),
            eq(crmDeals.operatorId, options.filterOperatorId)
          )
        )
      )!
    );
  } else if (!canSeeAll && options.operatorId) {
    if (options.scope === "mine") {
      conditions.push(
        or(
          isAssignedToOpSql(options.operatorId),
          and(
            sql`${crmDealActivities.assignedToOperatorId} IS NULL`,
            or(
              eq(crmDealActivities.operatorId, options.operatorId),
              eq(crmDeals.operatorId, options.operatorId)
            )
          )
        )!
      );
    } else if (options.scope === "delegated") {
      conditions.push(
        and(
          eq(crmDealActivities.operatorId, options.operatorId),
          or(
            and(
              sql`${crmDealActivities.assignedToOperatorId} IS NOT NULL`,
              sql`${crmDealActivities.assignedToOperatorId} != ${options.operatorId}`
            ),
            sql`jsonb_array_length(${crmDealActivities.assignedToOperatorIds}) > 1`,
            and(
              sql`jsonb_array_length(${crmDealActivities.assignedToOperatorIds}) = 1`,
              sql`NOT (${crmDealActivities.assignedToOperatorIds} @> ${JSON.stringify([options.operatorId])}::jsonb)`
            )
          )
        )!
      );
    } else {
      conditions.push(
        or(
          isAssignedToOpSql(options.operatorId),
          eq(crmDealActivities.operatorId, options.operatorId),
          eq(crmDeals.operatorId, options.operatorId)
        )!
      );
    }
  }

  const assignedOp = alias(operators, "task_assigned_op");
  const creatorOp = alias(operators, "task_creator_op");
  const dealOwnerOp = alias(operators, "task_deal_owner_op");

  const [rows, tenantOperators] = await Promise.all([
    db
      .select({
        id: crmDealActivities.id,
        title: crmDealActivities.title,
        type: crmDealActivities.type,
        status: crmDealActivities.status,
        dueDate: crmDealActivities.dueDate,
        completedAt: crmDealActivities.completedAt,
        description: crmDealActivities.description,
        createdAt: crmDealActivities.createdAt,
        conversationId: crmDealActivities.conversationId,
        dealId: crmDealActivities.dealId,
        dealTitle: crmDeals.title,
        dealValue: crmDeals.value,
        dealOperatorId: crmDeals.operatorId,
        pipelineId: crmDeals.pipelineId,
        stageId: crmDeals.stageId,
        stageName: crmStages.name,
        contactId: crmDealContacts.contactId,
        contactIsPrimary: crmDealContacts.isPrimary,
        contactName: contacts.name,
        contactPhone: contacts.phone,
        accountId: crmDeals.accountId,
        accountName: crmAccounts.name,
        accountTradeName: crmAccounts.tradeName,
        accountPhone: crmAccounts.phone,
        assignedOperatorId: crmDealActivities.assignedToOperatorId,
        assignedOperatorIds: crmDealActivities.assignedToOperatorIds,
        assignedOperatorName: assignedOp.name,
        assignedOperatorEmail: assignedOp.email,
        assignedOperatorAvatar: assignedOp.avatar,
        creatorOperatorId: crmDealActivities.operatorId,
        creatorOperatorName: creatorOp.name,
        creatorOperatorEmail: creatorOp.email,
        creatorOperatorAvatar: creatorOp.avatar,
        dealOwnerName: dealOwnerOp.name,
        dealOwnerEmail: dealOwnerOp.email,
        dealOwnerAvatar: dealOwnerOp.avatar,
      })
      .from(crmDealActivities)
      .innerJoin(crmDeals, and(eq(crmDealActivities.dealId, crmDeals.id), eq(crmDeals.tenantId, tenantId)))
      .leftJoin(crmStages, eq(crmDeals.stageId, crmStages.id))
      .leftJoin(
        crmDealContacts,
        and(eq(crmDealActivities.dealId, crmDealContacts.dealId), eq(crmDealContacts.tenantId, tenantId))
      )
      .leftJoin(contacts, and(eq(crmDealContacts.contactId, contacts.id), eq(contacts.tenantId, tenantId)))
      .leftJoin(crmAccounts, and(eq(crmDeals.accountId, crmAccounts.id), eq(crmAccounts.tenantId, tenantId)))
      .leftJoin(assignedOp, eq(crmDealActivities.assignedToOperatorId, assignedOp.id))
      .leftJoin(creatorOp, eq(crmDealActivities.operatorId, creatorOp.id))
      .leftJoin(dealOwnerOp, eq(crmDeals.operatorId, dealOwnerOp.id))
      .where(and(...conditions))
      .orderBy(
        sql`${crmDealActivities.dueDate} ASC NULLS LAST`,
        desc(crmDealContacts.isPrimary),
        desc(crmDealActivities.createdAt)
      ),
    db
      .select({
        id: operators.id,
        name: operators.name,
        email: operators.email,
        avatar: operators.avatar,
      })
      .from(operators)
      .where(eq(operators.tenantId, tenantId)),
  ]);

  const operatorsById = new Map(tenantOperators.map((op) => [op.id, op]));

  // Deduplica linhas por ID da atividade (priorizando o contato principal graças ao ORDER BY isPrimary DESC)
  const uniqueActivitiesMap = new Map<string, (typeof rows)[0]>();
  for (const r of rows) {
    if (!uniqueActivitiesMap.has(r.id)) {
      uniqueActivitiesMap.set(r.id, r);
    }
  }
  const uniqueRows = Array.from(uniqueActivitiesMap.values());

  // Para tarefas sem conversationId explícito, encontrar a conversa mais recente do contato
  const missingConvContactIds = [
    ...new Set(
      uniqueRows
        .filter((r) => !r.conversationId && r.contactId)
        .map((r) => r.contactId!)
    ),
  ];

  const contactToConvMap = new Map<string, string>();
  if (missingConvContactIds.length > 0) {
    const convRows = await db
      .select({
        id: conversations.id,
        contactId: conversations.contactId,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          inArray(conversations.contactId, missingConvContactIds)
        )
      )
      .orderBy(desc(conversations.updatedAt));

    for (const c of convRows) {
      if (c.contactId && !contactToConvMap.has(c.contactId)) {
        contactToConvMap.set(c.contactId, c.id);
      }
    }
  }

  return uniqueRows.map((r) => {
    const clientName = r.contactName || r.accountTradeName || r.accountName || null;
    const clientPhone = r.contactPhone || r.accountPhone || null;
    const resolvedConvId = r.conversationId || (r.contactId ? contactToConvMap.get(r.contactId) || null : null);

    const rawAssignedIds =
      Array.isArray(r.assignedOperatorIds) && r.assignedOperatorIds.length > 0
        ? r.assignedOperatorIds.filter(Boolean)
        : r.assignedOperatorId
        ? [r.assignedOperatorId]
        : [];
    const uniqueAssignedIds = Array.from(new Set(rawAssignedIds));
    const resolvedAssignedNames = uniqueAssignedIds
      .map((id) => operatorsById.get(id)?.name)
      .filter(Boolean) as string[];
    const combinedAssignedName =
      resolvedAssignedNames.length > 0
        ? resolvedAssignedNames.join(", ")
        : r.assignedOperatorName || null;

    const effectiveOperatorId = r.assignedOperatorId || r.creatorOperatorId || r.dealOperatorId || null;
    const effectiveOperatorName =
      combinedAssignedName || r.creatorOperatorName || r.dealOwnerName || "Sem operador";
    const effectiveOperatorEmail = r.assignedOperatorEmail || r.creatorOperatorEmail || r.dealOwnerEmail || null;
    const effectiveOperatorAvatar = r.assignedOperatorAvatar || r.creatorOperatorAvatar || r.dealOwnerAvatar || null;

    return {
      id: r.id,
      name: r.title || "Sem título",
      type: r.type || "task",
      status: r.status === "completed" ? ("done" as const) : ("pending" as const),
      dueDate: r.dueDate ? r.dueDate.toISOString() : null,
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      description: r.description || null,
      createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      deal: {
        id: r.dealId,
        name: r.dealTitle,
        value: r.dealValue,
        pipelineId: r.pipelineId,
        stageId: r.stageId,
        stageName: r.stageName,
      },
      client: {
        name: clientName,
        phone: clientPhone,
      },
      chatContactId: r.contactId || null,
      chatConversationId: resolvedConvId,
      source: "kanban" as const,
      operatorId: effectiveOperatorId,
      operatorName: effectiveOperatorName,
      operatorEmail: effectiveOperatorEmail,
      operatorAvatar: effectiveOperatorAvatar,
      assignedOperatorId: r.assignedOperatorId || null,
      assignedOperatorIds:
        uniqueAssignedIds.length > 0
          ? uniqueAssignedIds
          : effectiveOperatorId
          ? [effectiveOperatorId]
          : [],
      assignedOperatorName: combinedAssignedName,
      assignedOperatorNames: resolvedAssignedNames,
      isShared: uniqueAssignedIds.length > 1,
      creatorOperatorId: r.creatorOperatorId || null,
      creatorOperatorName: r.creatorOperatorName || null,
      dealOperatorId: r.dealOperatorId || null,
    };
  });
}

export const Route = createFileRoute("/api/tasks")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/tasks
       * Lista todas as tarefas e compromissos locais (crm_deal_activities) do tenant.
       */
      GET: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const url = new URL(request.url);
          const viewAll = url.searchParams.get("all") === "true";
          const scopeParam = (url.searchParams.get("scope") || "all_visible") as
            | "all_visible"
            | "mine"
            | "delegated"
            | "all";
          const filterOperatorId =
            url.searchParams.get("operatorId") ||
            url.searchParams.get("operatorFilterId") ||
            null;
          const isAdmin = session.operator.role === "admin" || Boolean(session.permissions?.monitor?.canAccessTeamTasks);

          const kanbanTasks = await getNativeKanbanTasks(tenantId, {
            operatorId: session.operator.id,
            email: session.operator.email,
            isAdmin,
            all: viewAll,
            scope: scopeParam,
            filterOperatorId: isAdmin ? filterOperatorId : null,
          });

          return new Response(JSON.stringify({ tasks: kanbanTasks, configured: true, source: "kanban" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (fatalErr: any) {
          console.error("[Tasks API] Erro fatal no GET:", fatalErr);
          return new Response(JSON.stringify({ error: fatalErr.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      /**
       * PUT /api/tasks
       * Atualiza uma tarefa local (concluir com confirmação/nota/próximo passo, editar, reagendar, cancelar ou reagendar em lote).
       * Tarefas já concluídas NÃO podem ser reativadas.
       */
      PUT: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const isAdmin = session.operator.role === "admin" || Boolean(session.permissions?.monitor?.canAccessTeamTasks);
          if (!isAdmin && !session.permissions?.views?.tasks && !session.permissions?.views?.crm) {
            return Response.json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, { status: 403 });
          }

          const body = await request.json();

          // Ação em lote: Reagendar várias tarefas pendentes/atrasadas
          if (body.action === "bulk_reschedule") {
            const taskIds: string[] = Array.isArray(body.taskIds) ? body.taskIds : [];
            const dueDateRaw: string | undefined = body.dueDate;
            if (!taskIds.length || !dueDateRaw) {
              return new Response(
                JSON.stringify({ error: "Selecione ao menos uma tarefa e informe a nova data." }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            const targetActivities = await db
              .select()
              .from(crmDealActivities)
              .where(
                and(
                  eq(crmDealActivities.tenantId, tenantId),
                  inArray(crmDealActivities.id, taskIds)
                )
              );

            let updatedCount = 0;
            for (const act of targetActivities) {
              if (act.status === "completed") continue;
              const isShared =
                Array.isArray(act.assignedToOperatorIds) &&
                act.assignedToOperatorIds.includes(session.operator.id);
              if (
                !isAdmin &&
                act.operatorId !== session.operator.id &&
                act.assignedToOperatorId !== session.operator.id &&
                !isShared
              ) {
                continue;
              }
              await crmService.updateDealActivity(
                tenantId,
                act.dealId,
                act.id,
                session.operator.id,
                { dueDate: new Date(dueDateRaw) }
              );
              updatedCount++;
            }

            return new Response(JSON.stringify({ success: true, updatedCount }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const taskId = body.taskId || body.id;
          if (!taskId) {
            return new Response(
              JSON.stringify({ error: "taskId é obrigatório" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const [kanbanActivity] = await db
            .select()
            .from(crmDealActivities)
            .where(and(eq(crmDealActivities.id, taskId), eq(crmDealActivities.tenantId, tenantId)))
            .limit(1);

          if (!kanbanActivity) {
            return new Response(
              JSON.stringify({ error: "Tarefa não encontrada." }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const isSharedAssignee =
            Array.isArray(kanbanActivity.assignedToOperatorIds) &&
            kanbanActivity.assignedToOperatorIds.includes(session.operator.id);

          if (
            !isAdmin &&
            kanbanActivity.operatorId !== session.operator.id &&
            kanbanActivity.assignedToOperatorId !== session.operator.id &&
            !isSharedAssignee
          ) {
            // Verifica se o operador é dono da negociação
            const [dealRow] = await db
              .select({ operatorId: crmDeals.operatorId })
              .from(crmDeals)
              .where(and(eq(crmDeals.id, kanbanActivity.dealId), eq(crmDeals.tenantId, tenantId)))
              .limit(1);
            if (!dealRow || dealRow.operatorId !== session.operator.id) {
              return Response.json({ error: "Permissão insuficiente para alterar esta tarefa." }, { status: 403 });
            }
          }

          // REGRA ESTRITA: Tarefa já concluída não pode voltar para pendente
          if (
            kanbanActivity.status === "completed" &&
            body.status &&
            body.status !== "done" &&
            body.status !== "completed"
          ) {
            return new Response(
              JSON.stringify({
                error: "Esta tarefa já está concluída e não pode ser reativada.",
                code: "COMPLETED_TASK_CANNOT_REOPEN",
              }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const updates: {
            status?: "pending" | "completed" | "cancelled";
            title?: string;
            description?: string | null;
            dueDate?: Date | string | null;
            type?: "task" | "call" | "meeting" | "whatsapp" | "email" | "lunch" | "visit";
            assignedToOperatorId?: string | null;
            assignedToOperatorIds?: string[] | null;
          } = {};

          if (body.status !== undefined) {
            if (body.status === "done" || body.status === "completed") {
              updates.status = "completed";
            } else if (body.status === "cancelled") {
              updates.status = "cancelled";
            } else {
              updates.status = "pending";
            }
          }

          if (body.title !== undefined) updates.title = body.title;
          if (body.description !== undefined) updates.description = body.description;
          if (body.dueDate !== undefined) updates.dueDate = body.dueDate ? new Date(body.dueDate) : null;
          if (body.type !== undefined) updates.type = body.type;
          if (body.assignedToOperatorId !== undefined) updates.assignedToOperatorId = body.assignedToOperatorId;
          if (Array.isArray(body.assignedToOperatorIds)) {
            updates.assignedToOperatorIds = body.assignedToOperatorIds;
          }

          const updatedActivity = await crmService.updateDealActivity(
            tenantId,
            kanbanActivity.dealId,
            kanbanActivity.id,
            session.operator.id,
            updates
          );

          // Se o operador registrou uma anotação de conclusão, cria nota histórica na negociação
          if (updates.status === "completed" && typeof body.completionNote === "string" && body.completionNote.trim()) {
            try {
              await crmService.createDealActivity(
                tenantId,
                kanbanActivity.dealId,
                session.operator.id,
                {
                  type: "note",
                  title: `Conclusão da tarefa: ${kanbanActivity.title}`,
                  description: body.completionNote.trim(),
                }
              );
            } catch (noteErr: any) {
              console.warn("[Tasks API] Aviso ao registrar nota de conclusão:", noteErr.message);
            }
          }

          // Se o operador agendou o próximo passo no modal de conclusão, cria a nova atividade
          let createdNextTask = null;
          if (
            updates.status === "completed" &&
            body.nextTask &&
            typeof body.nextTask.title === "string" &&
            body.nextTask.title.trim() &&
            body.nextTask.dueDate
          ) {
            try {
              const inheritedOperatorIds =
                Array.isArray(body.nextTask.assignedToOperatorIds) && body.nextTask.assignedToOperatorIds.length > 0
                  ? body.nextTask.assignedToOperatorIds
                  : Array.isArray(kanbanActivity.assignedToOperatorIds) &&
                    kanbanActivity.assignedToOperatorIds.length > 0
                  ? kanbanActivity.assignedToOperatorIds
                  : undefined;

              createdNextTask = await crmService.createDealActivity(
                tenantId,
                kanbanActivity.dealId,
                session.operator.id,
                {
                  assignedToOperatorId:
                    body.nextTask.assignedToOperatorId ||
                    kanbanActivity.assignedToOperatorId ||
                    session.operator.id,
                  assignedToOperatorIds: inheritedOperatorIds,
                  type: body.nextTask.type || "task",
                  title: body.nextTask.title.trim(),
                  description: body.nextTask.description?.trim() || undefined,
                  dueDate: new Date(body.nextTask.dueDate),
                  conversationId: kanbanActivity.conversationId || null,
                }
              );
            } catch (nextErr: any) {
              console.warn("[Tasks API] Aviso ao criar próxima tarefa:", nextErr.message);
            }
          }

          return new Response(
            JSON.stringify({
              success: true,
              source: "kanban",
              activity: updatedActivity,
              nextTask: createdNextTask,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("[Tasks API] Erro PUT:", e.message);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      /**
       * DELETE /api/tasks
       * Exclui uma tarefa local (crm_deal_activities).
       */
      DELETE: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const isAdmin = session.operator.role === "admin" || Boolean(session.permissions?.monitor?.canAccessTeamTasks);
          if (!isAdmin && !session.permissions?.views?.tasks && !session.permissions?.views?.crm) {
            return Response.json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, { status: 403 });
          }

          const url = new URL(request.url);
          let taskId = url.searchParams.get("taskId") || url.searchParams.get("id");
          if (!taskId) {
            const body = await request.json().catch(() => ({}));
            taskId = body.taskId || body.id;
          }

          if (!taskId) {
            return new Response(
              JSON.stringify({ error: "taskId é obrigatório" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const [kanbanActivity] = await db
            .select()
            .from(crmDealActivities)
            .where(and(eq(crmDealActivities.id, taskId), eq(crmDealActivities.tenantId, tenantId)))
            .limit(1);

          if (!kanbanActivity) {
            return new Response(
              JSON.stringify({ error: "Tarefa não encontrada." }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const isSharedAssignee =
            Array.isArray(kanbanActivity.assignedToOperatorIds) &&
            kanbanActivity.assignedToOperatorIds.includes(session.operator.id);

          if (
            !isAdmin &&
            kanbanActivity.operatorId !== session.operator.id &&
            kanbanActivity.assignedToOperatorId !== session.operator.id &&
            !isSharedAssignee
          ) {
            return Response.json({ error: "Permissão insuficiente para excluir esta tarefa." }, { status: 403 });
          }

          await crmService.deleteDealActivity(
            tenantId,
            kanbanActivity.dealId,
            kanbanActivity.id,
            session.operator.id
          );

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[Tasks API] Erro DELETE:", e.message);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});

