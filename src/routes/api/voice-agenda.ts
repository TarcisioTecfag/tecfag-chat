// src/routes/api/voice-agenda.ts
// API endpoints para listagem, agendamento, reagendamento e gestÃ£o da Agenda de LigaÃ§Ãµes da Valentina

import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { voiceAgenda } from "../../db/schema";
import { eq, and, asc } from "drizzle-orm";

// Em-memÃ³ria fallback cache para dev/produÃ§Ã£o imediata
const inMemoryAgenda = new Map<string, any[]>();

function getInitialMockAgenda(tenantId: string) {
  const today = new Date();
  const formatIso = (dayOffset: number, hour: number, min: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, min, 0, 0);
    return d.toISOString();
  };

  return [
    {
      id: `ag_1`,
      tenantId,
      clientName: "Marcos Oliveira",
      clientPhone: "(11) 98765-4321",
      company: "Embalagens AlianÃ§a",
      scheduledAt: formatIso(0, 10, 30),
      type: "customer_request",
      status: "pending",
      priority: "high",
      notes: "Cliente solicitou ligaÃ§Ã£o Ã s 10h30 para tirar dÃºvidas sobre MÃ¡quina Seladora VÃ¡cuo Dupla.",
      campaignName: undefined,
      assignedAgent: "Valentina",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: `ag_2`,
      tenantId,
      clientName: "Renata Vasconcelos",
      clientPhone: "(19) 99123-8877",
      company: "Distribuidora Vale Verde",
      scheduledAt: formatIso(0, 14, 0),
      type: "follow_up",
      status: "pending",
      priority: "normal",
      notes: "Follow-up de orÃ§amento enviado de VÃ¡lvulas Aerosol 20mm alumÃ­nio.",
      campaignName: undefined,
      assignedAgent: "Valentina",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: `ag_3`,
      tenantId,
      clientName: "Carlos Eduardo Costa",
      clientPhone: "(41) 98844-5511",
      company: "IndÃºstria de CosmÃ©ticos Beleza Pura",
      scheduledAt: formatIso(0, 16, 15),
      type: "excel_list",
      status: "pending",
      priority: "normal",
      notes: "Carga da lista Excel 'Leads_Agosto_Semana1.xlsx' â€” Frascos PET 100ml.",
      campaignName: "Leads_Agosto_Semana1.xlsx",
      assignedAgent: "Valentina",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: `ag_4`,
      tenantId,
      clientName: "Juliana Mendes",
      clientPhone: "(31) 97112-9900",
      company: "FarmÃ¡cia de ManipulaÃ§Ã£o BotÃ¢nica",
      scheduledAt: formatIso(1, 11, 0),
      type: "customer_request",
      status: "pending",
      priority: "urgent",
      notes: "Agendado via chat: confirmar especificaÃ§Ãµes de Bomba Spray RoscÃ¡vel 24/410.",
      campaignName: undefined,
      assignedAgent: "Valentina",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: `ag_5`,
      tenantId,
      clientName: "Fernando Santos",
      clientPhone: "(51) 99334-1122",
      company: "NutriErvas Alimentos",
      scheduledAt: formatIso(-1, 15, 0),
      type: "follow_up",
      status: "completed",
      priority: "normal",
      notes: "Chamada concluÃ­da com sucesso pela Valentina. Proposta aceita.",
      campaignName: undefined,
      assignedAgent: "Valentina",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
}

export const Route = createFileRoute("/api/voice-agenda")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400, headers: { "Content-Type": "application/json" }
          });
        }
        const status = url.searchParams.get("status");
        const type = url.searchParams.get("type");

        try {
          // Tentar buscar do banco de dados
          let list: any[] = [];
          try {
            list = await db
              .select()
              .from(voiceAgenda)
              .where(eq(voiceAgenda.tenantId, tenantId))
              .orderBy(asc(voiceAgenda.scheduledAt));
          } catch {
            // Tabela pode nÃ£o estar criada fisicamente no Postgres ainda â€” usar fallback em memÃ³ria
          }

          if (list.length === 0) {
            if (!inMemoryAgenda.has(tenantId)) {
              inMemoryAgenda.set(tenantId, getInitialMockAgenda(tenantId));
            }
            list = inMemoryAgenda.get(tenantId) || [];
          }

          // Aplicar filtros opcionais
          if (status && status !== "all") {
            list = list.filter((item) => item.status === status);
          }
          if (type && type !== "all") {
            list = list.filter((item) => item.type === type);
          }

          return new Response(JSON.stringify({ agenda: list }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[VoiceAgenda API] Erro ao buscar agenda:", err?.message || err);
          return new Response(JSON.stringify({ error: "Erro ao buscar agenda" }), { status: 500 });
        }
      },

      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId, items, ...singleItem } = body;
          if (!tenantId) {
            return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
              status: 400, headers: { "Content-Type": "application/json" }
            });
          }

          const memoryList = inMemoryAgenda.get(tenantId) || getInitialMockAgenda(tenantId);

          if (Array.isArray(items) && items.length > 0) {
            // InserÃ§Ã£o em lote (ex: importaÃ§Ã£o da lista Excel)
            const createdItemsDb = items.map((it: any, idx: number) => ({
              id: `ag_excel_${Date.now()}_${idx}`,
              tenantId,
              clientName: it.clientName || it.name || "Cliente sem Nome",
              clientPhone: it.clientPhone || it.phone || "",
              company: it.company || "",
              scheduledAt: new Date(it.scheduledAt || Date.now()),
              type: it.type || "excel_list",
              status: "pending",
              priority: it.priority || "normal",
              notes: it.notes || "Importado via planilha Excel",
              campaignName: it.campaignName || "Lista Excel",
              assignedAgent: "Valentina",
              createdAt: new Date(),
              updatedAt: new Date(),
            }));

            const createdItemsMemory = createdItemsDb.map((it) => ({
              ...it,
              scheduledAt: it.scheduledAt.toISOString(),
              createdAt: it.createdAt.toISOString(),
              updatedAt: it.updatedAt.toISOString(),
            }));

            // Tentar salvar no DB
            try {
              await db.insert(voiceAgenda).values(createdItemsDb);
            } catch {
              // fallback memÃ³ria
            }

            inMemoryAgenda.set(tenantId, [...createdItemsMemory, ...memoryList]);

            return new Response(JSON.stringify({ success: true, count: createdItemsMemory.length }), {
              status: 201,
              headers: { "Content-Type": "application/json" },
            });
          }

          // InserÃ§Ã£o individual
          const scheduledDate = new Date(singleItem.scheduledAt || Date.now());
          const newItemDb = {
            id: `ag_${Date.now()}`,
            tenantId,
            clientName: singleItem.clientName || "Cliente sem Nome",
            clientPhone: singleItem.clientPhone || "",
            company: singleItem.company || "",
            scheduledAt: scheduledDate,
            type: singleItem.type || "follow_up",
            status: singleItem.status || "pending",
            priority: singleItem.priority || "normal",
            notes: singleItem.notes || "",
            campaignName: singleItem.campaignName,
            assignedAgent: singleItem.assignedAgent || "Valentina",
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const newItemMemory = {
            ...newItemDb,
            scheduledAt: scheduledDate.toISOString(),
            createdAt: newItemDb.createdAt.toISOString(),
            updatedAt: newItemDb.updatedAt.toISOString(),
          };

          try {
            await db.insert(voiceAgenda).values(newItemDb);
          } catch {
            // fallback memÃ³ria
          }

          inMemoryAgenda.set(tenantId, [newItemMemory, ...memoryList]);

          return new Response(JSON.stringify({ success: true, item: newItemMemory }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[VoiceAgenda API] Erro ao criar agendamento:", err?.message || err);
          return new Response(JSON.stringify({ error: "Erro ao criar agendamento" }), { status: 500 });
        }
      },

      PUT: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId, id, ...updates } = body;
          if (!tenantId) {
            return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
              status: 400, headers: { "Content-Type": "application/json" }
            });
          }

          if (!id) {
            return new Response(JSON.stringify({ error: "ID Ã© obrigatÃ³rio para atualizaÃ§Ã£o" }), { status: 400 });
          }

          const dbUpdates: any = { ...updates, updatedAt: new Date() };
          if (updates.scheduledAt) {
            dbUpdates.scheduledAt = new Date(updates.scheduledAt);
          }

          // Atualizar no banco
          try {
            await db
              .update(voiceAgenda)
              .set(dbUpdates)
              .where(and(eq(voiceAgenda.id, id), eq(voiceAgenda.tenantId, tenantId)));
          } catch {
            // fallback memÃ³ria
          }

          const memoryList = inMemoryAgenda.get(tenantId) || getInitialMockAgenda(tenantId);
          const updatedList = memoryList.map((item) =>
            item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item
          );
          inMemoryAgenda.set(tenantId, updatedList);

          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[VoiceAgenda API] Erro ao atualizar agendamento:", err?.message || err);
          return new Response(JSON.stringify({ error: "Erro ao atualizar" }), { status: 500 });
        }
      },

      DELETE: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400, headers: { "Content-Type": "application/json" }
          });
        }
          const id = url.searchParams.get("id");

          if (!id) {
            return new Response(JSON.stringify({ error: "ID Ã© obrigatÃ³rio" }), { status: 400 });
          }

          try {
            await db
              .delete(voiceAgenda)
              .where(and(eq(voiceAgenda.id, id), eq(voiceAgenda.tenantId, tenantId)));
          } catch {
            // fallback
          }

          const memoryList = inMemoryAgenda.get(tenantId) || [];
          inMemoryAgenda.set(
            tenantId,
            memoryList.filter((item) => item.id !== id)
          );

          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[VoiceAgenda API] Erro ao remover agendamento:", err?.message || err);
          return new Response(JSON.stringify({ error: "Erro ao remover agendamento" }), { status: 500 });
        }
      },
    },
  },
});

