import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../../../../db";
import { rdMarketingFlows, rdMarketingLogs } from "../../../../db/schema";
import { CrmError } from "../../../../lib/crm/crm-service";
import { hashToken } from "../../../../lib/rd-marketing/service";
import { claimRdEvent, processRdEvent, storeRdWebhook } from "../../../../lib/rd-marketing/inbox";
import { integrationError, readIntegrationJson } from "../../../../lib/rd-marketing/http";

export const Route = createFileRoute("/api/webhooks/rd-marketing/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        // Diagnóstico sem gravar eventos: o mesmo segredo do recebimento autentica a consulta.
        const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
        if (!/^[a-f0-9]{64}$/.test(params.token))
          return Response.json({ error: "Webhook inválido." }, { status: 401, headers });
        try {
          const [flow] = await db
            .select({ settings: rdMarketingFlows.settings })
            .from(rdMarketingFlows)
            .where(eq(rdMarketingFlows.tokenHash, hashToken(params.token)))
            .limit(1);
          if (!flow) return Response.json({ error: "Webhook inválido." }, { status: 401, headers });
          return Response.json(
            {
              status: flow.settings.enabled ? "ready" : "paused",
              integrationName: flow.settings.name,
            },
            { headers },
          );
        } catch (error) {
          const response = integrationError(error);
          for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
          return response;
        }
      },
      POST: async ({ request, params }) => {
        // Rota pública: segredo aleatório identifica um único fluxo e seu tenant no servidor.
        // Tenant, funil, etapa e responsável presentes no payload nunca são autoridade.
        if (!/^[a-f0-9]{64}$/.test(params.token))
          return Response.json({ error: "Webhook inválido." }, { status: 401 });
        let flow: typeof rdMarketingFlows.$inferSelect | undefined;
        try {
          [flow] = await db
            .select()
            .from(rdMarketingFlows)
            .where(eq(rdMarketingFlows.tokenHash, hashToken(params.token)))
            .limit(1);
          if (!flow) return Response.json({ error: "Webhook inválido." }, { status: 401 });
          if (!flow.settings.enabled) throw new CrmError("Fluxo desativado.", "FLOW_DISABLED", 409);
          const receipt = await storeRdWebhook(flow, await readIntegrationJson(request));
          if (!process.env.IS_TEST && process.env.NODE_ENV !== "test") {
            const tenantId = flow.tenantId;
            void claimRdEvent(tenantId, receipt.eventId)
              .then((claimed) => (claimed ? processRdEvent(claimed) : undefined))
              .catch((err) => console.error("[RD Marketing] Erro ao processar evento recebido:", err));
          }
          return Response.json(receipt, { status: 202 });
        } catch (error) {
          const response = integrationError(error);
          if (flow) {
            const data = await response.clone().json();
            try {
              await db.insert(rdMarketingLogs).values({
                id: randomUUID(),
                tenantId: flow.tenantId,
                flowId: flow.id,
                status: "error",
                message: data.error,
              });
            } catch {
              console.error("[RD Marketing] Não foi possível registrar a falha de recebimento.");
            }
          }
          return response;
        }
      },
    },
  },
});
