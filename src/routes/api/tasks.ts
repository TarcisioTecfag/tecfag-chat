import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { contacts, conversations, tasks as dbTasks } from "../../db/schema";
import { rdRequest, buildPhoneSearchTerms, getCachedDeal, getCachedContact, getCachedUsers } from "../../lib/rdCrmService";
import { eq, and } from "drizzle-orm";
import { requireSession } from "../../lib/auth-session";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Cache do endpoint de listagem de tarefas para evitar múltiplos cliques rápidos (TTL: 15s)
const tasksListCache = new Map<string, { data: any[]; expiresAt: number }>();
const LIST_CACHE_TTL = 15 * 1000; // 15 segundos

export const Route = createFileRoute("/api/tasks")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/tasks
       * 
       * Lista tarefas do RD CRM para o operador autenticado
       * e enriquece com dados de contato do Valem Chat.
       * Salva e persiste os dados na tabela local 'tasks'.
       */
      GET: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const url = new URL(request.url);
          // E-mail do operador: se fornecido e o operador for admin pode filtrar outro; senão usa o da sessão
          const queryEmail = url.searchParams.get("email");
          const email = (session.operator.role === "admin" && queryEmail) ? queryEmail : session.operator.email;

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

          // Mapear status amigável para o formato do RD CRM v2
          const rdStatus = status === "done" ? "done" : "pending";

          await rdRequest(tenantId, "PUT", `/tasks/${taskId}`, { status: rdStatus });

          // Atualiza também na base local com isolamento de tenant
          try {
            await db
              .update(dbTasks)
              .set({ status: rdStatus, updatedAt: new Date() })
              .where(and(eq(dbTasks.id, taskId), eq(dbTasks.tenantId, tenantId)));
          } catch (syncErr: any) {
            console.warn(`[Tasks API] Aviso ao atualizar tarefa local ${taskId}:`, syncErr.message);
          }

          return new Response(JSON.stringify({ success: true }), {
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
