import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import {
  contacts,
  conversations,
  tasks as dbTasks,
  crmDealActivities,
  crmDeals,
  crmDealContacts,
  crmStages,
  crmAccounts,
  operators,
} from "../../db/schema";
import {
  rdRequest,
  buildPhoneSearchTerms,
  getCachedDeal,
  getCachedContact,
  getCachedUsers,
  isRdCrmConfigured,
} from "../../lib/rdCrmService";
import { eq, and, sql, desc, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireSession } from "../../lib/auth-session";
import { crmService } from "../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Cache do endpoint de listagem de tarefas para evitar múltiplos cliques rápidos (TTL: 15s)
const tasksListCache = new Map<string, { data: any[]; expiresAt: number }>();
const LIST_CACHE_TTL = 15 * 1000; // 15 segundos

/**
 * Consulta tarefas e compromissos comerciais nativos do Kanban/CRM (crm_deal_activities)
 * com joins em negociações, contatos, contas, etapas e operadores, assegurando isolamento estrito de tenant.
 */
async function getNativeKanbanTasks(
  tenantId: string,
  options: {
    operatorId?: string | null;
    email?: string | null;
    isAdmin?: boolean;
    all?: boolean;
  }
) {
  const conditions = [
    eq(crmDealActivities.tenantId, tenantId),
    sql`${crmDealActivities.type} NOT IN ('note', 'system_event')`,
  ];

  // Se não for solicitado 'all' explicitamente por um administrador, filtra estritamente por tarefas do operador logado
  if (!(options.all && options.isAdmin) && options.operatorId) {
    conditions.push(
      or(
        eq(crmDealActivities.assignedToOperatorId, options.operatorId),
        eq(crmDealActivities.operatorId, options.operatorId),
        eq(crmDeals.operatorId, options.operatorId)
      )!
    );
  }

  const assignedOp = alias(operators, "task_assigned_op");
  const creatorOp = alias(operators, "task_creator_op");

  const rows = await db
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
      pipelineId: crmDeals.pipelineId,
      stageId: crmDeals.stageId,
      stageName: crmStages.name,
      contactId: crmDealContacts.contactId,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      accountId: crmDeals.accountId,
      accountName: crmAccounts.name,
      accountTradeName: crmAccounts.tradeName,
      accountPhone: crmAccounts.phone,
      assignedOperatorId: crmDealActivities.assignedToOperatorId,
      assignedOperatorName: assignedOp.name,
      creatorOperatorId: crmDealActivities.operatorId,
      creatorOperatorName: creatorOp.name,
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
    .where(and(...conditions))
    .orderBy(sql`${crmDealActivities.dueDate} ASC NULLS LAST`, desc(crmDealActivities.createdAt));

  // Deduplica linhas por ID da atividade (caso um negócio tenha mais de um contato associado)
  const uniqueActivitiesMap = new Map<string, typeof rows[0]>();
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

    return {
      id: r.id,
      name: r.title || "Sem título",
      type: r.type || "task",
      status: r.status === "completed" ? "done" : "pending",
      dueDate: r.dueDate ? r.dueDate.toISOString() : null,
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
      operatorId: r.assignedOperatorId || r.creatorOperatorId || null,
      operatorName: r.assignedOperatorName || r.creatorOperatorName || null,
    };
  });
}

export const Route = createFileRoute("/api/tasks")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/tasks
       * 
       * Lista tarefas e compromissos. Se o RD CRM estiver integrado, busca da API do RD;
       * caso contrário, reconhece e utiliza diretamente as tarefas e compromissos do nosso Kanban nativo.
       */
      GET: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const url = new URL(request.url);
          const queryEmail = url.searchParams.get("email");
          const viewAll = url.searchParams.get("all") === "true";
          const isAdmin = session.operator.role === "admin";
          const email = (isAdmin && queryEmail) ? queryEmail : session.operator.email;

          // 1. Verifica se a integração com o RD Station CRM está configurada para este tenant
          const rdConfigured = await isRdCrmConfigured(tenantId);

          if (!rdConfigured) {
            // RD CRM NÃO integrado: reconhece e usa exclusivamente tarefas e compromissos do nosso Kanban
            const kanbanTasks = await getNativeKanbanTasks(tenantId, {
              operatorId: session.operator.id,
              email,
              isAdmin,
              all: viewAll,
            });

            return new Response(JSON.stringify({ tasks: kanbanTasks, configured: false, source: "kanban" }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

        const debug = url.searchParams.get("debug");
        if (debug === "true") {
          const debugInfo: any = {
            tenantId,
            email,
            timestamp: new Date().toISOString(),
          };

          try {
            const users = await getCachedUsers(tenantId);
            debugInfo.usersCount = users.length;
            debugInfo.users = users;
          } catch (e: any) {
            debugInfo.usersError = e.message;
          }

          try {
            const rawTasks = await rdRequest(tenantId, "GET", "/tasks?sort[updated_at]=desc&page[size]=50");
            debugInfo.tasksCount = Array.isArray(rawTasks) ? rawTasks.length : 0;
            debugInfo.tasks = rawTasks;
          } catch (e: any) {
            debugInfo.tasksError = e.message;
          }

          return new Response(JSON.stringify(debugInfo), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const cacheKey = `${tenantId}:${email || "all"}`;

        // 1. Tenta recuperar do cache de listagem
        const cached = tasksListCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          console.log(`[Tasks API] Retornando listagem de tarefas do cache para key: ${cacheKey}`);
          return new Response(JSON.stringify({ tasks: cached.data }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Helper local para obter as tarefas persistidas no banco
        const getLocalPersistedTasks = async () => {
          const conditions = [eq(dbTasks.tenantId, tenantId)];
          if (email) {
            conditions.push(eq(dbTasks.operatorEmail, email.toLowerCase()));
          }
          const stored = await db.select().from(dbTasks).where(and(...conditions));
          return stored.map((t) => ({
            id: t.id,
            name: t.name,
            type: t.type,
            status: t.status,
            dueDate: t.dueDate ? t.dueDate.toISOString() : null,
            description: t.description,
            createdAt: t.createdAt ? t.createdAt.toISOString() : null,
            deal: t.dealId ? { id: t.dealId, name: t.dealName } : null,
            client: { name: t.clientName, phone: t.clientPhone },
            chatContactId: t.chatContactId,
            chatConversationId: t.chatConversationId,
          }));
        };

        try {
          // 2. E-mail do operador local para busca correspondente no CRM
          const localEmail = email ? email.toLowerCase() : "";
          const crmTargetEmail = localEmail;

          // Mapeia o e-mail para o ID de usuário do RD Station CRM
          let crmUserId: string | null = null;
          if (crmTargetEmail) {
            try {
              const users = await getCachedUsers(tenantId);
              const matchedUser = users.find((u: any) => u.email?.toLowerCase() === crmTargetEmail);
              if (matchedUser) {
                crmUserId = matchedUser.id;
              }
            } catch (e: any) {
              console.warn("[Tasks API] Falha ao mapear usuário por e-mail no CRM:", e.message);
            }
          }

          // 3. Busca tarefas no RD CRM via API v2 (Se mapeamos o ID do dono, filtramos no endpoint, ordenado por data de modificação mais recente)
          const queryPath = crmUserId 
            ? `/tasks?user_id=${crmUserId}&sort[updated_at]=desc&page[size]=200` 
            : `/tasks?sort[updated_at]=desc&page[size]=200`;
          const rdTasks = await rdRequest<any[]>(
            tenantId,
            "GET",
            queryPath
          );

          if (!rdTasks || !Array.isArray(rdTasks)) {
            return new Response(JSON.stringify({ tasks: [] }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Filtragem extra em memória de segurança (caso o parâmetro user_id não seja mapeado perfeitamente no CRM)
          const filteredTasks = crmUserId
            ? rdTasks.filter((t: any) => {
                const ownerIds = t.owner_ids || [];
                return ownerIds.includes(crmUserId) || t.user_id === crmUserId;
              })
            : rdTasks;

          if (filteredTasks.length === 0) {
            return new Response(JSON.stringify({ tasks: [] }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // 4. Para cada tarefa, buscar o deal e seus contatos de forma otimizada (caches e try/catch isolados)
          const enrichedTasks = await Promise.all(
            filteredTasks.map(async (task: any) => {
              let dealName: string | null = null;
              let clientName: string | null = null;
              let clientPhone: string | null = null;
              let chatContactId: string | null = null;
              let chatConversationId: string | null = null;

              // Buscar dados do deal (se a tarefa tem deal_id E está ativa/pendente)
              const isClosed = task.status === "completed" || task.status === "done" || task.status === "canceled";
              if (task.deal_id && !isClosed) {
                try {
                  const deal = await getCachedDeal(tenantId, task.deal_id);
                  if (deal) {
                    dealName = deal.name || null;

                    // Buscar contatos do deal
                    const dealContacts = deal.contacts || deal.contact_ids || [];
                    const contactIdList: string[] = Array.isArray(dealContacts)
                      ? dealContacts.map((c: any) => (typeof c === "string" ? c : c.id)).filter(Boolean)
                      : [];

                    // Buscar dados do primeiro contato
                    for (const cId of contactIdList.slice(0, 1)) {
                      try {
                        const contact = await getCachedContact(tenantId, cId);
                        if (contact) {
                          clientName = contact.name || null;
                          const phones = contact.phones || [];
                          if (phones.length > 0) {
                            clientPhone = phones[0].phone || null;
                          }
                        }
                      } catch (err: any) {
                        console.warn(`[Tasks API] Erro ao enriquecer contato ${cId}:`, err.message);
                      }
                    }
                  }
                } catch (err: any) {
                  console.warn(`[Tasks API] Erro ao enriquecer deal ${task.deal_id}:`, err.message);
                }
              }

              // 5. Se temos telefone, buscar no banco local com filtro estrito de tenant
              // NOTA MANDATÓRIA (Fase 0): Tarefas importadas do RD com conversa desconhecida permanecem
              // com chatConversationId = null até vinculação explícita. É proibido inferir conversas por telefone.
              if (clientPhone) {
                const phoneTerms = buildPhoneSearchTerms(clientPhone);
                try {
                  for (const term of phoneTerms) {
                    const localContact = await db.query.contacts.findFirst({
                      where: and(eq(contacts.tenantId, tenantId), eq(contacts.phone, term)),
                    });
                    if (localContact) {
                      chatContactId = localContact.id;
                      // Mantém conversa sem vínculo até haver evidência explícita
                      chatConversationId = null;
                      break;
                    }
                  }
                } catch (err: any) {
                  console.warn(`[Tasks API] Erro ao buscar telefone local ${clientPhone}:`, err.message);
                }
              }

              // 6. Persistência de Dados no Banco Local (Salva/Sincroniza para uso futuro)
              try {
                await db
                  .insert(dbTasks)
                  .values({
                    id: task.id,
                    tenantId,
                    name: task.name || "Sem título",
                    type: task.type || "task",
                    status: task.status || "pending",
                    dueDate: task.due_date ? new Date(task.due_date) : null,
                    description: task.description || null,
                    dealId: task.deal_id || null,
                    dealName,
                    clientName,
                    clientPhone,
                    chatContactId,
                    chatConversationId,
                    operatorEmail: email ? email.toLowerCase() : null,
                    createdAt: task.created_at ? new Date(task.created_at) : null,
                    updatedAt: new Date(),
                  })
                  .onConflictDoUpdate({
                    target: dbTasks.id,
                    set: {
                      name: task.name || "Sem título",
                      type: task.type || "task",
                      status: task.status || "pending",
                      dueDate: task.due_date ? new Date(task.due_date) : null,
                      description: task.description || null,
                      dealId: task.deal_id || null,
                      dealName,
                      clientName,
                      clientPhone,
                      chatContactId,
                      chatConversationId,
                      operatorEmail: email ? email.toLowerCase() : null,
                      updatedAt: new Date(),
                    },
                  });
              } catch (dbErr: any) {
                console.error(`[Tasks API] Falha ao persistir tarefa ${task.id} no banco local:`, dbErr.message);
              }

              return {
                id: task.id,
                name: task.name || "Sem título",
                type: task.type || "task",
                status: task.status || "pending",
                dueDate: task.due_date || null,
                description: task.description || null,
                createdAt: task.created_at || null,
                deal: task.deal_id ? { id: task.deal_id, name: dealName } : null,
                client: { name: clientName, phone: clientPhone },
                chatContactId,
                chatConversationId,
              };
            })
          );

          // Salva no cache de listagem
          tasksListCache.set(cacheKey, { data: enrichedTasks, expiresAt: Date.now() + LIST_CACHE_TTL });

          return new Response(JSON.stringify({ tasks: enrichedTasks }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.warn("[Tasks API] Falha ao buscar da API da RD CRM, buscando do banco local persistido:", e.message);
          try {
            // Em caso de falha da API (ex: 429 ou rede offline), buscamos do banco local persistido!
            const localTasks = await getLocalPersistedTasks();
            return new Response(JSON.stringify({ tasks: localTasks }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          } catch (localErr: any) {
            console.error("[Tasks API] Falha crítica ao ler banco local:", localErr.message);
            return new Response(JSON.stringify({ error: e.message }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
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
       * 
       * Atualiza o status de uma tarefa no RD CRM e na base local.
       * Body: { taskId, status: "done" | "pending" }
       */
      PUT: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const body = await request.json();
          const { taskId, status } = body;

          if (!taskId || !status) {
            return new Response(
              JSON.stringify({ error: "taskId e status são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // 1. Verifica se a tarefa pertence ao Kanban nativo (crm_deal_activities)
          const [kanbanActivity] = await db
            .select()
            .from(crmDealActivities)
            .where(and(eq(crmDealActivities.id, taskId), eq(crmDealActivities.tenantId, tenantId)))
            .limit(1);

          if (kanbanActivity) {
            const newStatus = status === "done" || status === "completed" ? "completed" : "pending";
            await crmService.updateDealActivity(
              tenantId,
              kanbanActivity.dealId,
              kanbanActivity.id,
              session.operator.id,
              { status: newStatus }
            );

            return new Response(JSON.stringify({ success: true, source: "kanban" }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // 2. Se não for do Kanban nativo, sincroniza com RD CRM (se configurado) e base local
          const rdConfigured = await isRdCrmConfigured(tenantId);
          const rdStatus = status === "done" ? "done" : "pending";

          if (rdConfigured) {
            try {
              await rdRequest(tenantId, "PUT", `/tasks/${taskId}`, { status: rdStatus });
            } catch (err: any) {
              console.warn(`[Tasks API] Erro ao sincronizar status no RD CRM:`, err.message);
            }
          }

          // Atualiza também na base local com isolamento de tenant
          try {
            await db
              .update(dbTasks)
              .set({ status: rdStatus, updatedAt: new Date() })
              .where(and(eq(dbTasks.id, taskId), eq(dbTasks.tenantId, tenantId)));
          } catch (syncErr: any) {
            console.warn(`[Tasks API] Aviso ao atualizar tarefa local ${taskId}:`, syncErr.message);
          }

          return new Response(JSON.stringify({ success: true, source: "rd" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[Tasks API] Erro PUT:", e.message);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
