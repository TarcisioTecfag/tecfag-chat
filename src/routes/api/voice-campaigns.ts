// src/routes/api/voice-campaigns.ts
// API endpoints para criação, listagem e controle de campanhas em massa de voz

import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { voiceCampaigns, voiceCampaignLeads } from "../../db/schema";
import { eq, desc } from "drizzle-orm";

export const Route = createFileRoute("/api/voice-campaigns")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId") || "valem";
        const campaignId = url.searchParams.get("id");

        try {
          if (campaignId) {
            const [campaign] = await db
              .select()
              .from(voiceCampaigns)
              .where(eq(voiceCampaigns.id, campaignId));

            if (!campaign) {
              return new Response(JSON.stringify({ error: "Campanha não encontrada" }), { status: 404 });
            }

            const leads = await db
              .select()
              .from(voiceCampaignLeads)
              .where(eq(voiceCampaignLeads.campaignId, campaignId));

            return new Response(JSON.stringify({ campaign, leads }), {
              headers: { "Content-Type": "application/json" },
            });
          }

          const campaignsList = await db
            .select()
            .from(voiceCampaigns)
            .where(eq(voiceCampaigns.tenantId, tenantId))
            .orderBy(desc(voiceCampaigns.createdAt));

          return new Response(JSON.stringify({ campaigns: campaignsList }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[VoiceCampaigns API] Erro ao buscar campanhas:", err?.message || err);
          return new Response(JSON.stringify({ error: "Erro interno do servidor" }), { status: 500 });
        }
      },

      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { tenantId = "valem", name, intervalSeconds = 30, leads = [] } = body;

          if (!name || !Array.isArray(leads) || leads.length === 0) {
            return new Response(JSON.stringify({ error: "Nome e lista de leads são obrigatórios" }), { status: 400 });
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

          return new Response(JSON.stringify({ success: true, campaignId, totalLeads: leads.length }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err: any) {
          console.error("[VoiceCampaigns API] Erro ao criar campanha:", err?.message || err);
          return new Response(JSON.stringify({ error: "Erro ao criar campanha" }), { status: 500 });
        }
      },
    },
  },
});
