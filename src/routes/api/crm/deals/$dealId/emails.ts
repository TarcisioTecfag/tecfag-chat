import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../../lib/crm/crm-service";
import { db } from "../../../../../db";
import { channelConfigs, crmDeals } from "../../../../../db/schema";
import { eq, and } from "drizzle-orm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/crm/deals/$dealId/emails")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/crm/deals/:dealId/emails
       * Lista os e-mails registrados na negociação com remetente, destinatário e data comprovada.
       */
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canViewCrm");
          if (permError) return permError;

          const { dealId } = params as { dealId: string };

          const [deal] = await db
            .select({ id: crmDeals.id })
            .from(crmDeals)
            .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
            .limit(1);

          if (!deal) {
            return new Response(
              JSON.stringify({ error: "Negociação não encontrada para este tenant.", code: "NOT_FOUND" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const emails = await crmService.getDealEmails(tenantId, dealId);
          const [dealContacts, smtpConfig] = await Promise.all([
            crmService.getDealContacts(tenantId, dealId),
            db.query.channelConfigs.findFirst({
              where: eq(channelConfigs.tenantId, tenantId),
              columns: { smtpHost: true, smtpPort: true, smtpUser: true, smtpPass: true, smtpFrom: true },
            }),
          ]);
          const recipients = dealContacts
            .filter((item) => item.contact.email?.trim())
            .map((item) => ({
              contactId: item.contactId,
              name: item.contact.name,
              email: item.contact.email!.trim(),
              isPrimary: item.isPrimary,
            }));
          const sender = smtpConfig?.smtpFrom?.trim() || smtpConfig?.smtpUser?.trim() || "";
          const smtpConfigured = Boolean(smtpConfig?.smtpHost && smtpConfig?.smtpPort && smtpConfig?.smtpUser && smtpConfig?.smtpPass && sender);

          return new Response(JSON.stringify({ emails, recipients, sender, smtpConfigured }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (error) {
          return handleCrmError(error, corsHeaders);
        }
      },

      /**
       * POST /api/crm/deals/:dealId/emails
       * Registra um e-mail trocado referente à negociação.
       */
      POST: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const permError = requireCrmPermission(session, "canEditDeals");
          if (permError) return permError;

          const { dealId } = params as { dealId: string };
          const body = await request.json().catch(() => ({}));

          if (!body.toAddress || !body.toAddress.includes("@")) {
            return new Response(
              JSON.stringify({ error: "E-mail de destino (toAddress) inválido.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (!body.fromAddress || !body.fromAddress.includes("@")) {
            return new Response(
              JSON.stringify({ error: "E-mail de remetente (fromAddress) inválido.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (!body.subject || typeof body.subject !== "string" || !body.subject.trim()) {
            return new Response(
              JSON.stringify({ error: "Assunto do e-mail (subject) é obrigatório.", code: "BAD_REQUEST" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const email = await crmService.logDealEmail(tenantId, dealId, session.operator.id, {
            direction: body.direction === "inbound" ? "inbound" : "outbound",
            fromAddress: body.fromAddress,
            toAddress: body.toAddress,
            ccAddresses: Array.isArray(body.ccAddresses) ? body.ccAddresses : [],
            subject: body.subject,
            bodyText: body.bodyText || null,
            bodyHtml: body.bodyHtml || null,
            sentAt: body.sentAt ? new Date(body.sentAt) : new Date(),
            metadata: { source: "manual" },
          });

          return new Response(JSON.stringify({ email, message: "E-mail registrado com sucesso." }), {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (error) {
          return handleCrmError(error, corsHeaders);
        }
      },
    },
  },
});
