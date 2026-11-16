import { createFileRoute } from "@tanstack/react-router";
import {
  auditMarketingApiCall,
  jsonMarketingResponse,
  optionsMarketingResponse,
  requireMarketingApiAccess,
} from "../../../../lib/marketing/api-auth";
import { MARKETING_SECTOR_LABELS } from "../../../../lib/marketing/crm-attribution";

export const Route = createFileRoute("/api/v1/marketing/")({
  server: {
    handlers: {
      OPTIONS: async () => optionsMarketingResponse(),

      GET: async ({ request }) => {
        const auth = await requireMarketingApiAccess(request);
        if ("response" in auth) return auth.response;

        const payload = {
          service: "crm-marketing-api",
          version: "1.0.0",
          tenant_id: auth.tenantId,
          authenticated_key: auth.access.keyLabel || auth.access.authMode,
          sectors_dictionary: MARKETING_SECTOR_LABELS,
          defaults: {
            include_tests: false,
            include_legacy: true,
            messages_metadata_only: true,
            default_limit: 200,
            max_limit: 1000,
          },
          endpoints: [
            { path: "/api/v1/marketing/deals", description: "Negociações (cards) com aliases RD/Kondado, chaves de cruzamento, UTMs, setores e regra única de venda" },
            { path: "/api/v1/marketing/deal-stage-history", description: "Histórico linear de etapas por negociação (start_date, end_date, duration_seconds)" },
            { path: "/api/v1/marketing/contacts", description: "Contatos (leads) com e-mails, telefones (últimos 9 dígitos), CPF/CNPJ e primeiro toque" },
            { path: "/api/v1/marketing/conversations", description: "Conversas em massa com métricas de SLA (tempo de 1ª resposta humana/bot, % sem resposta, % só bot)" },
            { path: "/api/v1/marketing/messages", description: "Mensagens em massa (apenas metadados por padrão; ?include_content=true opcional)" },
            { path: "/api/v1/marketing/activities", description: "Atividades comerciais (tarefas, notas, ligações e reuniões)" },
            { path: "/api/v1/marketing/triages", description: "Triagens do bot SDR com estado, desfecho, funil alvo e dados coletados" },
            { path: "/api/v1/marketing/goals", description: "Metas mensais por consultor e divisão + calendário de dias úteis" },
            { path: "/api/v1/marketing/audit-batch", description: "Atalho de auditoria qualitativa em lote (15–50 leads) com card + etapas + triagem + transcrição" },
          ],
        };

        await auditMarketingApiCall({
          auth,
          endpointName: "index",
          endpointLabel: "Catálogo de Endpoints",
          queryArgs: {},
          returnedCount: payload.endpoints.length,
        });

        return jsonMarketingResponse(payload);
      },
    },
  },
});
