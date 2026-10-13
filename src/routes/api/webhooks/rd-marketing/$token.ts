import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../../../../db";
import { rdMarketingFlows, rdMarketingLogs } from "../../../../db/schema";
import { CrmError } from "../../../../lib/crm/crm-service";
import { hashToken, receiveLeads } from "../../../../lib/rd-marketing/service";
import { integrationError, readIntegrationJson } from "../../../../lib/rd-marketing/http";

export const Route = createFileRoute("/api/webhooks/rd-marketing/$token")({
  server: {
    handlers: {
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
          const results = await receiveLeads(flow, await readIntegrationJson(request));
          return Response.json({ results });
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
