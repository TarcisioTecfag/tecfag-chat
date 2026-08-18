// src/routes/api/voice-agenda.ts
// API endpoints para listagem, agendamento, reagendamento e gestao da Agenda de Ligacoes da Valentina

import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { voiceAgenda } from "../../db/schema";
import { eq, and, asc } from "drizzle-orm";

const corsHeaders = { "Content-Type": "application/json" };
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

export const Route = createFileRoute("/api/voice-agenda")({
  server: {
    handlers: {

      // ── GET — lista agendamentos do tenant ──────────────────────────────────
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) return json({ error: "tenantId e obrigatorio" }, 400);

        const statusFilter = url.searchParams.get("status");
        const typeFilter = url.searchParams.get("type");

        try {
          let list = await db
            .select()
            .from(voiceAgenda)
            .where(eq(voiceAgenda.tenantId, tenantId))
            .orderBy(asc(voiceAgenda.scheduledAt));

          if (statusFilter && statusFilter !== "all") {
            list = list.filter((item) => item.status === statusFilter);
          }
          if (typeFilter && typeFilter !== "all") {
            list = list.filter((item) => item.type === typeFilter);
          }

          return json({ agenda: list });
        } catch (err: any) {
          console.error("[VoiceAgenda] Erro ao buscar agenda:", err?.message);
          return json({ error: "Erro ao buscar agenda" }, 500);
        }
      },

      // ── POST — cria agendamento(s) ──────────────────────────────────────────
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId, items, ...singleItem } = body;
          if (!tenantId) return json({ error: "tenantId e obrigatorio" }, 400);

          // Insercao em lote (importacao de lista Excel)
          if (Array.isArray(items) && items.length > 0) {
            const rows = items.map((it: any) => ({
              tenantId,
              clientName: it.clientName || it.name || "Cliente sem Nome",
              clientPhone: it.clientPhone || it.phone || "",
              company: it.company || "",
              scheduledAt: new Date(it.scheduledAt || Date.now()),
              type: it.type || "excel_list",
              status: "pending" as const,
              priority: it.priority || "normal",
              notes: it.notes || "Importado via planilha",
              campaignName: it.campaignName || "Lista Excel",
              assignedAgent: "Valentina",
              createdAt: new Date(),
              updatedAt: new Date(),
            }));

            await db.insert(voiceAgenda).values(rows);
            return json({ success: true, count: rows.length }, 201);
          }

          // Insercao individual
          const row = {
            tenantId,
            clientName: singleItem.clientName || "Cliente sem Nome",
            clientPhone: singleItem.clientPhone || "",
            company: singleItem.company || "",
            scheduledAt: new Date(singleItem.scheduledAt || Date.now()),
            type: singleItem.type || "follow_up",
            status: (singleItem.status || "pending") as any,
            priority: singleItem.priority || "normal",
            notes: singleItem.notes || "",
            campaignName: singleItem.campaignName,
            assignedAgent: singleItem.assignedAgent || "Valentina",
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const [inserted] = await db.insert(voiceAgenda).values(row).returning();
          return json({ success: true, item: inserted }, 201);
        } catch (err: any) {
          console.error("[VoiceAgenda] Erro ao criar agendamento:", err?.message);
          return json({ error: "Erro ao criar agendamento" }, 500);
        }
      },

      // ── PUT — atualiza agendamento ──────────────────────────────────────────
      PUT: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId, id, ...updates } = body;
          if (!tenantId) return json({ error: "tenantId e obrigatorio" }, 400);
          if (!id) return json({ error: "id e obrigatorio" }, 400);

          const dbUpdates: any = { ...updates, updatedAt: new Date() };
          if (updates.scheduledAt) {
            dbUpdates.scheduledAt = new Date(updates.scheduledAt);
          }

          await db
            .update(voiceAgenda)
            .set(dbUpdates)
            .where(and(eq(voiceAgenda.id, id), eq(voiceAgenda.tenantId, tenantId)));

          return json({ success: true });
        } catch (err: any) {
          console.error("[VoiceAgenda] Erro ao atualizar:", err?.message);
          return json({ error: "Erro ao atualizar" }, 500);
        }
      },

      // ── DELETE — remove agendamento ─────────────────────────────────────────
      DELETE: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const tenantId = url.searchParams.get("tenantId");
          if (!tenantId) return json({ error: "tenantId e obrigatorio" }, 400);

          const id = url.searchParams.get("id");
          if (!id) return json({ error: "id e obrigatorio" }, 400);

          await db
            .delete(voiceAgenda)
            .where(and(eq(voiceAgenda.id, id), eq(voiceAgenda.tenantId, tenantId)));

          return json({ success: true });
        } catch (err: any) {
          console.error("[VoiceAgenda] Erro ao remover:", err?.message);
          return json({ error: "Erro ao remover agendamento" }, 500);
        }
      },
    },
  },
});
