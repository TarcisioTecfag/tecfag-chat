import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { channelConfigs } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";

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
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        if (queryTenantId && queryTenantId !== tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
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

          // Retorna apenas os campos pertinentes a relatórios e SMTP (NUNCA devolve a senha em texto puro)
          const reportSettings = {
            reportDailyWhatsapp: config.reportDailyWhatsapp,
            reportDailyEmail: config.reportDailyEmail,
            reportWeeklyWhatsapp: config.reportWeeklyWhatsapp,
            reportWeeklyEmail: config.reportWeeklyEmail,
            reportWhatsappNumbers: config.reportWhatsappNumbers || "",
            reportEmailAddresses: config.reportEmailAddresses || "",
            reportRequiresApproval: config.reportRequiresApproval ?? false,
            smtpHost: config.smtpHost || "",
            smtpPort: config.smtpPort || null,
            smtpUser: config.smtpUser || "",
            hasSmtpPass: Boolean(config.smtpPass),
            smtpPass: "", // Senha nunca é exposta ao frontend por segurança
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
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        // Gravação de configurações de SMTP e relatórios exige papel de administrador
        if (session.operator.role !== "admin") {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente. Apenas administradores podem configurar SMTP e relatórios.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        try {
          const body = await request.json();
          const {
            tenantId: bodyTenantId,
            reportDailyWhatsapp,
            reportDailyEmail,
            reportWeeklyWhatsapp,
            reportWeeklyEmail,
            reportWhatsappNumbers,
            reportEmailAddresses,
            reportRequiresApproval,
            smtpHost,
            smtpPort,
            smtpUser,
            smtpPass,
            smtpFrom
          } = body;

          if (bodyTenantId && bodyTenantId !== tenantId) {
            return new Response(
              JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Se a senha não for informada no body (string vazia ou undefined), mantém a senha já gravada
          const updateData: Record<string, any> = {
            reportDailyWhatsapp: !!reportDailyWhatsapp,
            reportDailyEmail: !!reportDailyEmail,
            reportWeeklyWhatsapp: !!reportWeeklyWhatsapp,
            reportWeeklyEmail: !!reportWeeklyEmail,
            reportWhatsappNumbers: reportWhatsappNumbers || null,
            reportEmailAddresses: reportEmailAddresses || null,
            reportRequiresApproval: !!reportRequiresApproval,
            smtpHost: smtpHost || null,
            smtpPort: smtpPort ? parseInt(smtpPort) : null,
            smtpUser: smtpUser || null,
            smtpFrom: smtpFrom || null,
            updatedAt: new Date(),
          };

          if (smtpPass && smtpPass.trim().length > 0) {
            updateData.smtpPass = smtpPass.trim();
          }

          await db
            .update(channelConfigs)
            .set(updateData)
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
