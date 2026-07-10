import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { contacts, conversations } from "../../db/schema";
import { rdRequest, buildPhoneSearchTerms, getCachedDeal, getCachedContact } from "../../lib/rdCrmService";
import { eq } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Cache do endpoint de listagem de tarefas para evitar múltiplos cliques rápidos (TTL: 15s)
const tasksListCache = new Map<string, { data: any[]; expiresAt: number }>();
const LIST_CACHE_TTL = 15 * 1000; // 15 segundos

export const Route = createFileRoute("/api/tasks")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/tasks?tenantId=xxx
       * 
       * Lista tarefas do RD CRM para o tenant e enriquece com dados de contato
       * e conversas do Valem Chat. Segue o mesmo padrão de busca de contatos 
       * do fagner/rdCrmService.ts (buildPhoneSearchTerms).
       */
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");

        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // 1. Tenta recuperar do cache de listagem
        const cached = tasksListCache.get(tenantId);
        if (cached && cached.expiresAt > Date.now()) {
          console.log(`[Tasks API] Retornando listagem de tarefas do cache para tenant: ${tenantId}`);
          return new Response(JSON.stringify({ tasks: cached.data }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          // 2. Busca tarefas no RD CRM via API v2 (limite 200)
          const rdTasks = await rdRequest<any[]>(
            tenantId,
            "GET",
            "/tasks?page[size]=200"
          );

          if (!rdTasks || !Array.isArray(rdTasks) || rdTasks.length === 0) {
            return new Response(JSON.stringify({ tasks: [] }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // 3. Para cada tarefa, buscar o deal e seus contatos de forma otimizada (caches e try/catch isolados)
          const enrichedTasks = await Promise.all(
            rdTasks.map(async (task: any) => {
              let dealName: string | null = null;
              let clientName: string | null = null;
              let clientPhone: string | null = null;
              let chatContactId: string | null = null;
              let chatConversationId: string | null = null;

              // Buscar dados do deal (se a tarefa tem deal_id)
              if (task.deal_id) {
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

              // 4. Se temos telefone, buscar no banco local (contacts + conversations)
              if (clientPhone) {
                const phoneTerms = buildPhoneSearchTerms(clientPhone);
                try {
                  // Busca contato local por qualquer variante do telefone
                  for (const term of phoneTerms) {
                    const localContact = await db.query.contacts.findFirst({
                      where: eq(contacts.phone, term),
                    });
                    if (localContact) {
                      chatContactId = localContact.id;
                      // Busca conversa ativa desse contato
                      const conv = await db.query.conversations.findFirst({
                        where: eq(conversations.contactId, localContact.id),
                      });
                      if (conv) chatConversationId = conv.id;
                      break;
                    }
                  }
                } catch (err: any) {
                  console.warn(`[Tasks API] Erro ao buscar telefone local ${clientPhone}:`, err.message);
                }
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
          tasksListCache.set(tenantId, { data: enrichedTasks, expiresAt: Date.now() + LIST_CACHE_TTL });

          return new Response(JSON.stringify({ tasks: enrichedTasks }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[Tasks API] Erro:", e.message);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      /**
       * PUT /api/tasks
       * 
       * Atualiza o status de uma tarefa no RD CRM.
       * Body: { tenantId, taskId, status: "done" | "pending" }
       * 
       * Segue o mesmo padrão rdRequest() com wrapper { data: body }.
       */
      PUT: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId, taskId, status } = body;

          if (!tenantId || !taskId || !status) {
            return new Response(
              JSON.stringify({ error: "tenantId, taskId e status são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Mapear status amigável para o formato do RD CRM v2
          const rdStatus = status === "done" ? "done" : "pending";

          await rdRequest(tenantId, "PUT", `/tasks/${taskId}`, { status: rdStatus });

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
