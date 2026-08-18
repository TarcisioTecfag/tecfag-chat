// src/routes/api/voice-campaigns.ts
// API endpoints para criação, listagem e controle de campanhas em massa de voz

import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { voiceCampaigns, voiceCampaignLeads } from "../../db/schema";
import { eq, desc, and, sql } from "drizzle-orm";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const Route = createFileRoute("/api/voice-campaigns")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const campaignId = url.searchParams.get("id");

        if (!tenantId) return json({ error: "tenantId é obrigatório" }, 400);

        try {
          if (campaignId) {
            const [campaign] = await db
              .select()
              .from(voiceCampaigns)
              .where(
                and(
                  eq(voiceCampaigns.id, campaignId),
                  eq(voiceCampaigns.tenantId, tenantId)
                )
              );

            if (!campaign) {
              return json({ error: "Campanha não encontrada" }, 404);
            }

            const leads = await db
              .select()
              .from(voiceCampaignLeads)
              .where(
                and(
                  eq(voiceCampaignLeads.campaignId, campaignId),
                  eq(voiceCampaignLeads.tenantId, tenantId)
                )
              );

            return json({ campaign, leads });
          }

          const campaignsList = await db
            .select()
            .from(voiceCampaigns)
            .where(eq(voiceCampaigns.tenantId, tenantId))
            .orderBy(desc(voiceCampaigns.createdAt));

          return json({ campaigns: campaignsList });
        } catch (err: any) {
          console.error("[VoiceCampaigns API] Erro ao buscar campanhas:", err?.message || err);
          return json({ error: "Erro interno do servidor" }, 500);
        }
      },

      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId, name, intervalSeconds = 30, leads = [], objectiveId } = body;

          if (!tenantId) return json({ error: "tenantId é obrigatório" }, 400);

          if (!name || !Array.isArray(leads) || leads.length === 0) {
            return json({ error: "Nome e lista de leads são obrigatórios" }, 400);
          }

          const campaignId = `camp_${Date.now()}`;

          await db.insert(voiceCampaigns).values({
            id: campaignId,
            tenantId,
            name,
            totalLeads: leads.length,
            calledLeads: 0,
            qualifiedLeads: 0,
            intervalSeconds,
            objectiveId: objectiveId || null,
            status: "draft",
            createdAt: new Date(),
          });

          const leadRecords = leads.map((lead: any, idx: number) => ({
            id: `lead_${campaignId}_${idx}`,
            tenantId,
            campaignId,
            name: lead.name || lead.nome || "",
            phone: lead.phone || lead.telefone || "",
            company: lead.company || lead.empresa || "",
            productInterest: lead.productInterest || lead.produto_interesse || "",
            notes: lead.notes || lead.observacoes || "",
            status: "pending",
            attempts: 0,
            createdAt: new Date(),
          }));

          await db.insert(voiceCampaignLeads).values(leadRecords);

          return json({ success: true, campaignId, totalLeads: leads.length }, 201);
        } catch (err: any) {
          console.error("[VoiceCampaigns API] Erro ao criar campanha:", err?.message || err);
          return json({ error: "Erro ao criar campanha" }, 500);
        }
      },

      PATCH: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId, campaignId, status, leadId, leadStatus } = body;

          if (!tenantId) return json({ error: "tenantId é obrigatório" }, 400);

          // Atualizar status da campanha
          if (campaignId && status) {
            await db
              .update(voiceCampaigns)
              .set({ status })
              .where(
                and(
                  eq(voiceCampaigns.id, campaignId),
                  eq(voiceCampaigns.tenantId, tenantId)
                )
              );
          }

          // Atualizar status de um lead específico (+ incrementar tentativas)
          if (leadId && leadStatus) {
            await db
              .update(voiceCampaignLeads)
              .set({
                status: leadStatus,
                attempts: sql`${voiceCampaignLeads.attempts} + 1`,
              })
              .where(
                and(
                  eq(voiceCampaignLeads.id, leadId),
                  eq(voiceCampaignLeads.tenantId, tenantId)
                )
              );
          }

          return json({ success: true });
        } catch (err: any) {
          console.error("[VoiceCampaigns API] Erro no PATCH:", err?.message || err);
          return json({ error: "Erro ao atualizar campanha" }, 500);
        }
      },
    },
  },
});
