import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { channelConfigs } from "../../../db/schema";
import { eq } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/settings/reports")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");

        if (!tenantId) {
          return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          const config = await db.query.channelConfigs.findFirst({
            where: eq(channelConfigs.tenantId, tenantId),
          });

          if (!config) {
            return new Response(JSON.stringify({ error: "Configurações de canal não encontradas para o tenant" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Retorna apenas os campos pertinentes a relatórios e SMTP
          const reportSettings = {
            reportDailyWhatsapp: config.reportDailyWhatsapp,
            reportDailyEmail: config.reportDailyEmail,
            reportWeeklyWhatsapp: config.reportWeeklyWhatsapp,
            reportWeeklyEmail: config.reportWeeklyEmail,
            reportWhatsappNumbers: config.reportWhatsappNumbers || "",
            reportEmailAddresses: config.reportEmailAddresses || "",
            smtpHost: config.smtpHost || "",
            smtpPort: config.smtpPort || null,
            smtpUser: config.smtpUser || "",
            smtpPass: config.smtpPass || "",
            smtpFrom: config.smtpFrom || "",
          };

          return new Response(JSON.stringify(reportSettings), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[settings/reports] Erro GET:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const {
            tenantId,
            reportDailyWhatsapp,
            reportDailyEmail,
            reportWeeklyWhatsapp,
            reportWeeklyEmail,
            reportWhatsappNumbers,
            reportEmailAddresses,
            smtpHost,
            smtpPort,
            smtpUser,
            smtpPass,
            smtpFrom
          } = body;

          if (!tenantId) {
            return new Response(JSON.stringify({ error: "tenantId é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Atualiza as configurações no banco
          await db
            .update(channelConfigs)
            .set({
              reportDailyWhatsapp: !!reportDailyWhatsapp,
              reportDailyEmail: !!reportDailyEmail,
              reportWeeklyWhatsapp: !!reportWeeklyWhatsapp,
              reportWeeklyEmail: !!reportWeeklyEmail,
              reportWhatsappNumbers: reportWhatsappNumbers || null,
              reportEmailAddresses: reportEmailAddresses || null,
              smtpHost: smtpHost || null,
              smtpPort: smtpPort ? parseInt(smtpPort) : null,
              smtpUser: smtpUser || null,
              smtpPass: smtpPass || null,
              smtpFrom: smtpFrom || null,
              updatedAt: new Date(),
            })
            .where(eq(channelConfigs.tenantId, tenantId));

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[settings/reports] Erro POST:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
