import { and, desc, eq, gte, ilike, lte, ne, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  crmPipelines,
  crmStages,
  metaMessageTemplates,
  operators,
  rdMarketingEvents,
  rdMarketingFlows,
  rdMarketingJourneyEndpoints,
  rdMarketingJourneyNotifications,
  rdMarketingLogs,
  rdMarketingSyncSettings,
} from "../../db/schema";
import { decodeFlowWebhookToken } from "../rd-marketing/api-crypto";
import { extractLeads, readPath } from "../rd-marketing/mapping";
import { extractDetailedConversionUtm } from "../rd-marketing/attribution";
import type { McpToolDefinition } from "./valem-tecfag-mcp-write-tools";

const TENANT_ID_PROP = {
  type: "string",
  enum: ["tecfag", "valem"],
  default: "tecfag",
  description:
    "Tenant alvo ('tecfag' ou 'valem'). Ignorado quando a chave MCP está travada em um tenant.",
};

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumberInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function parseOptionalDate(value: unknown): Date | null {
  const text = asTrimmedString(value);
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00-03:00` : text;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseOptionalEndDate(value: unknown): Date | null {
  const text = asTrimmedString(value);
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T23:59:59.999-03:00` : text;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function maskFlowWebhookToken(token: string | null): {
  tokenMasked: string | null;
  tokenSuffix: string | null;
} {
  if (!token || token.length < 16) {
    return { tokenMasked: null, tokenSuffix: null };
  }
  return {
    tokenMasked: `${token.slice(0, 8)}...${token.slice(-8)}`,
    tokenSuffix: token.slice(-8),
  };
}

export function summarizeRdEventPayload(payload: unknown): {
  leadsCount: number;
  eventType: string | null;
  eventIdentifier: string | null;
  leads: Array<{
    name: string | null;
    email: string | null;
    phone: string | null;
    uuid: string | null;
    firstConversionIdentifier: string | null;
    lastConversionIdentifier: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
  }>;
} {
  const root =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const eventType = asTrimmedString(root.event_type) ?? null;
  const eventIdentifier = asTrimmedString(root.event_identifier) ?? null;

  let extracted: Record<string, unknown>[] = [];
  try {
    extracted = extractLeads(payload);
  } catch {
    extracted = [];
  }

  const leads = extracted.slice(0, 10).map((lead) => {
    const firstConv = readPath(lead, "first_conversion");
    const lastConv = readPath(lead, "last_conversion");
    const utm = extractDetailedConversionUtm(lastConv || firstConv || lead);
    return {
      name: asTrimmedString(lead.name) ?? null,
      email: asTrimmedString(lead.email) ?? null,
      phone:
        asTrimmedString(lead.mobile_phone) ??
        asTrimmedString(lead.personal_phone) ??
        asTrimmedString(lead.phone) ??
        null,
      uuid: asTrimmedString(lead.uuid) ?? null,
      firstConversionIdentifier:
        asTrimmedString(readPath(lead, "first_conversion.content.identificador")) ?? null,
      lastConversionIdentifier:
        asTrimmedString(readPath(lead, "last_conversion.content.identificador")) ??
        asTrimmedString(readPath(lead, "rd_event.event_identifier")) ??
        null,
      utmSource: utm.utmSource,
      utmMedium: utm.utmMedium,
      utmCampaign: utm.utmCampaign,
    };
  });

  return {
    leadsCount: extracted.length,
    eventType,
    eventIdentifier,
    leads,
  };
}

export const MCP_RD_MARKETING_TOOLS: McpToolDefinition[] = [
  {
    name: "list_rd_marketing_flows",
    access: "read",
    description:
      "Lista todos os fluxos de entrada (webhooks) do RD Station Marketing cadastrados no tenant (`rd_marketing_flows`), com nome, status ativo/pausado, funil/etapa/operador de destino, sufixo mascarado do token (`tokenMasked` / `tokenSuffix`, sem expor o segredo completo), mapeamentos, contadores reais de eventos (processados, pendentes, erros) e opcionalmente endpoints de jornada e configurações de sincronização.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        query: {
          type: "string",
          description:
            "Busca opcional por trecho do nome do fluxo, ID do fluxo ou sufixo do token (ex: 'Black November', 'Personnalité', '418b4f1b').",
        },
        enabled: {
          type: "boolean",
          description: "Filtra por fluxos ativos (true) ou pausados (false).",
        },
        includeMappings: {
          type: "boolean",
          default: true,
          description: "Quando true (padrão), inclui os mapeamentos de campos e regras do fluxo.",
        },
        includeJourneyEndpoints: {
          type: "boolean",
          default: true,
          description:
            "Quando true (padrão), inclui os endpoints de jornada (Conversões/Oportunidades) e configurações gerais de sync (sem credenciais).",
        },
      },
    },
  },
  {
    name: "list_rd_marketing_events",
    access: "read",
    description:
      "Consulta a caixa de entrada de eventos recebidos nos webhooks do RD Station Marketing (`rd_marketing_events`), com status (`pending`, `processing`, `processed`, `error`), tentativas, mensagem de erro, outcomes por lead e resumo estruturado do lead (nome, e-mail, telefone, identificador de conversão e UTMs). Permite buscar por nome/e-mail/telefone/identificador no payload.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        flowId: {
          type: "string",
          description: "Filtra eventos de um flowId específico.",
        },
        flowName: {
          type: "string",
          description: "Filtra eventos pelo nome (parcial, case-insensitive) do fluxo.",
        },
        status: {
          type: "string",
          enum: ["pending", "processing", "processed", "error"],
          description: "Filtra pelo status de processamento do evento.",
        },
        query: {
          type: "string",
          description:
            "Busca textual no payload ou mensagem de erro (ex: nome do lead, e-mail, telefone, identificador de conversão ou campanha).",
        },
        createdFrom: {
          type: "string",
          description: "Data/hora inicial opcional (YYYY-MM-DD ou ISO 8601).",
        },
        createdTo: {
          type: "string",
          description: "Data/hora final opcional (YYYY-MM-DD ou ISO 8601).",
        },
        includePayload: {
          type: "boolean",
          default: false,
          description: "Quando true, inclui o JSON completo do payload recebido.",
        },
        limit: {
          type: "number",
          default: 25,
          description: "Quantidade máxima de eventos retornados (padrão 25, máx 100).",
        },
      },
    },
  },
  {
    name: "list_rd_marketing_logs",
    access: "read",
    description:
      "Consulta os logs de auditoria e diagnóstico do RD Station Marketing (`rd_marketing_logs`), permitindo filtrar por fluxo (`flowId` ou `flowName`), status (`created`, `duplicate`, `error`, `queued`, `diagnostic`), texto na mensagem/`dealId` e intervalo de datas.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        flowId: {
          type: "string",
          description: "Filtra logs de um flowId específico.",
        },
        flowName: {
          type: "string",
          description: "Filtra logs pelo nome (parcial, case-insensitive) do fluxo.",
        },
        status: {
          type: "string",
          enum: ["created", "duplicate", "error", "queued", "diagnostic"],
          description: "Filtra por status do log.",
        },
        includeDiagnostics: {
          type: "boolean",
          default: false,
          description:
            "Quando false (padrão), oculta amostras mascaradas de status 'diagnostic' (exceto se status='diagnostic' for passado).",
        },
        query: {
          type: "string",
          description: "Busca textual na mensagem do log ou no dealId vinculado.",
        },
        createdFrom: {
          type: "string",
          description: "Data/hora inicial opcional (YYYY-MM-DD ou ISO 8601).",
        },
        createdTo: {
          type: "string",
          description: "Data/hora final opcional (YYYY-MM-DD ou ISO 8601).",
        },
        limit: {
          type: "number",
          default: 50,
          description: "Quantidade máxima de logs retornados (padrão 50, máx 200).",
        },
      },
    },
  },
  {
    name: "search_rd_marketing_journey_notifications",
    access: "read",
    description:
      "Pesquisa notificações recebidas pelos webhooks globais de Jornada do RD Station Marketing (`rd_marketing_journey_notifications`, ex.: Conversões e Oportunidades), permitindo rastrear exatamente qual `identifier`, `eventType`, e-mail, telefone e timestamp a RD Station enviou para um lead específico.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        query: {
          type: "string",
          description:
            "Busca textual por e-mail, telefone, rdUuid, identificador de conversão ou trecho do payload (`data`).",
        },
        eventType: {
          type: "string",
          description: "Filtra pelo tipo de evento (ex: 'CONVERSION', 'OPPORTUNITY').",
        },
        identifier: {
          type: "string",
          description: "Filtra por trecho do identificador de conversão/evento.",
        },
        receivedFrom: {
          type: "string",
          description: "Data/hora inicial opcional sobre receivedAt (YYYY-MM-DD ou ISO 8601).",
        },
        receivedTo: {
          type: "string",
          description: "Data/hora final opcional sobre receivedAt (YYYY-MM-DD ou ISO 8601).",
        },
        includeData: {
          type: "boolean",
          default: true,
          description: "Quando true (padrão), inclui o objeto `data` sanitizado da notificação.",
        },
        limit: {
          type: "number",
          default: 30,
          description: "Quantidade máxima de notificações retornadas (padrão 30, máx 100).",
        },
      },
    },
  },
];

export const MCP_RD_MARKETING_TOOL_LABELS_PT: Record<string, string> = {
  list_rd_marketing_flows: "Listagem de Fluxos RD Station Marketing",
  list_rd_marketing_events: "Consulta de Eventos Webhook RD Marketing",
  list_rd_marketing_logs: "Consulta de Logs RD Station Marketing",
  search_rd_marketing_journey_notifications: "Busca de Notificações de Jornada RD Marketing",
};

const RD_MARKETING_TOOL_NAMES = new Set(MCP_RD_MARKETING_TOOLS.map((t) => t.name));

export function isRdMarketingMcpTool(name: string): boolean {
  return RD_MARKETING_TOOL_NAMES.has(name);
}

export async function executeRdMarketingMcpTool(
  name: string,
  args: Record<string, unknown>,
  tenantId: "tecfag" | "valem",
): Promise<unknown> {
  switch (name) {
    case "list_rd_marketing_flows": {
      const query = asTrimmedString(args.query)?.toLowerCase();
      const enabledFilter = typeof args.enabled === "boolean" ? args.enabled : undefined;
      const includeMappings = args.includeMappings !== false;
      const includeJourneyEndpoints = args.includeJourneyEndpoints !== false;

      const [
        rawFlows,
        pipelines,
        stages,
        ops,
        templates,
        eventStats,
        logStats,
        journeyEndpoints,
        syncSettingsRows,
      ] = await Promise.all([
        db
          .select({
            id: rdMarketingFlows.id,
            tokenEncrypted: rdMarketingFlows.tokenEncrypted,
            settings: rdMarketingFlows.settings,
            createdAt: rdMarketingFlows.createdAt,
            updatedAt: rdMarketingFlows.updatedAt,
          })
          .from(rdMarketingFlows)
          .where(eq(rdMarketingFlows.tenantId, tenantId))
          .orderBy(desc(rdMarketingFlows.updatedAt), desc(rdMarketingFlows.createdAt)),
        db
          .select({ id: crmPipelines.id, name: crmPipelines.name })
          .from(crmPipelines)
          .where(eq(crmPipelines.tenantId, tenantId)),
        db
          .select({
            id: crmStages.id,
            name: crmStages.name,
            pipelineId: crmStages.pipelineId,
          })
          .from(crmStages)
          .where(eq(crmStages.tenantId, tenantId)),
        db
          .select({ id: operators.id, name: operators.name })
          .from(operators)
          .where(eq(operators.tenantId, tenantId)),
        db
          .select({
            id: metaMessageTemplates.id,
            name: metaMessageTemplates.name,
            status: metaMessageTemplates.status,
          })
          .from(metaMessageTemplates)
          .where(eq(metaMessageTemplates.tenantId, tenantId)),
        db
          .select({
            flowId: rdMarketingEvents.flowId,
            totalEvents: sql<number>`count(*)::int`,
            processedEvents: sql<number>`count(*) filter (where ${rdMarketingEvents.status} = 'processed')::int`,
            pendingEvents: sql<number>`count(*) filter (where ${rdMarketingEvents.status} in ('pending', 'processing'))::int`,
            errorEvents: sql<number>`count(*) filter (where ${rdMarketingEvents.status} = 'error')::int`,
            lastEventAt: sql<Date | null>`max(${rdMarketingEvents.createdAt})`,
          })
          .from(rdMarketingEvents)
          .where(eq(rdMarketingEvents.tenantId, tenantId))
          .groupBy(rdMarketingEvents.flowId),
        db
          .select({
            flowId: rdMarketingLogs.flowId,
            createdDealsCount: sql<number>`count(*) filter (where ${rdMarketingLogs.status} = 'created')::int`,
            duplicateLogsCount: sql<number>`count(*) filter (where ${rdMarketingLogs.status} = 'duplicate')::int`,
            errorLogsCount: sql<number>`count(*) filter (where ${rdMarketingLogs.status} = 'error')::int`,
            lastLogAt: sql<Date | null>`max(${rdMarketingLogs.createdAt}) filter (where ${rdMarketingLogs.status} <> 'diagnostic')`,
          })
          .from(rdMarketingLogs)
          .where(eq(rdMarketingLogs.tenantId, tenantId))
          .groupBy(rdMarketingLogs.flowId),
        includeJourneyEndpoints
          ? db
              .select({
                id: rdMarketingJourneyEndpoints.id,
                kind: rdMarketingJourneyEndpoints.kind,
                label: rdMarketingJourneyEndpoints.label,
                enabled: rdMarketingJourneyEndpoints.enabled,
                remoteId: rdMarketingJourneyEndpoints.remoteId,
                registrationStatus: rdMarketingJourneyEndpoints.registrationStatus,
                lastError: rdMarketingJourneyEndpoints.lastError,
                createdAt: rdMarketingJourneyEndpoints.createdAt,
              })
              .from(rdMarketingJourneyEndpoints)
              .where(eq(rdMarketingJourneyEndpoints.tenantId, tenantId))
              .orderBy(desc(rdMarketingJourneyEndpoints.createdAt))
          : Promise.resolve([]),
        includeJourneyEndpoints
          ? db
              .select({
                outboundEnabled: rdMarketingSyncSettings.outboundEnabled,
                outboundScope: rdMarketingSyncSettings.outboundScope,
                currency: rdMarketingSyncSettings.currency,
                activityEnabled: rdMarketingSyncSettings.activityEnabled,
                publicBaseUrl: rdMarketingSyncSettings.publicBaseUrl,
                updatedAt: rdMarketingSyncSettings.updatedAt,
              })
              .from(rdMarketingSyncSettings)
              .where(eq(rdMarketingSyncSettings.tenantId, tenantId))
              .limit(1)
          : Promise.resolve([]),
      ]);

      const pipelineById = new Map(pipelines.map((p) => [p.id, p.name]));
      const stageById = new Map(stages.map((s) => [s.id, s]));
      const operatorById = new Map(ops.map((o) => [o.id, o.name]));
      const templateById = new Map(templates.map((t) => [t.id, t]));
      const eventStatsByFlow = new Map(eventStats.map((s) => [s.flowId, s]));
      const logStatsByFlow = new Map(logStats.map((s) => [s.flowId, s]));

      const enriched = rawFlows.map((row) => {
        const token = decodeFlowWebhookToken(tenantId, row.tokenEncrypted);
        const { tokenMasked, tokenSuffix } = maskFlowWebhookToken(token);
        const settings = row.settings;
        const evStat = eventStatsByFlow.get(row.id);
        const lgStat = logStatsByFlow.get(row.id);
        const tpl = settings.whatsappTemplateId
          ? templateById.get(settings.whatsappTemplateId)
          : null;

        return {
          id: row.id,
          name: settings.name,
          enabled: Boolean(settings.enabled),
          tokenMasked,
          tokenSuffix,
          hasStoredToken: Boolean(row.tokenEncrypted),
          pipeline: {
            id: settings.pipelineId,
            name: pipelineById.get(settings.pipelineId) ?? null,
          },
          stage: {
            id: settings.stageId,
            name: stageById.get(settings.stageId)?.name ?? null,
          },
          operator: settings.operatorId
            ? {
                id: settings.operatorId,
                name: operatorById.get(settings.operatorId) ?? null,
              }
            : null,
          whatsappTemplate: settings.whatsappTemplateId
            ? {
                id: settings.whatsappTemplateId,
                name: tpl?.name ?? null,
                status: tpl?.status ?? null,
              }
            : null,
          deduplication: settings.deduplication,
          eventIdPath: settings.eventIdPath,
          attributionConversion: settings.attributionConversion ?? "first",
          campaignFromFlow: Boolean(settings.campaignFromFlow),
          requireAttribution: Boolean(settings.requireAttribution),
          ...(includeMappings ? { mappings: settings.mappings } : {}),
          stats: {
            totalEvents: evStat?.totalEvents ?? 0,
            processedEvents: evStat?.processedEvents ?? 0,
            pendingEvents: evStat?.pendingEvents ?? 0,
            errorEvents: evStat?.errorEvents ?? 0,
            createdDealsCount: lgStat?.createdDealsCount ?? 0,
            duplicateLogsCount: lgStat?.duplicateLogsCount ?? 0,
            errorLogsCount: lgStat?.errorLogsCount ?? 0,
            lastEventAt: evStat?.lastEventAt ?? null,
            lastLogAt: lgStat?.lastLogAt ?? null,
          },
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      });

      const filtered = enriched.filter((flow) => {
        if (enabledFilter !== undefined && flow.enabled !== enabledFilter) return false;
        if (query) {
          const hay = [
            flow.id,
            flow.name,
            flow.tokenSuffix ?? "",
            flow.tokenMasked ?? "",
            flow.pipeline.name ?? "",
            flow.stage.name ?? "",
          ]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(query)) return false;
        }
        return true;
      });

      return {
        tenantId,
        totalFlowsInTenant: rawFlows.length,
        enabledCount: enriched.filter((f) => f.enabled).length,
        pausedCount: enriched.filter((f) => !f.enabled).length,
        returnedCount: filtered.length,
        flows: filtered,
        ...(includeJourneyEndpoints
          ? {
              journeyEndpoints,
              syncSettings: syncSettingsRows[0] ?? null,
            }
          : {}),
      };
    }

    case "list_rd_marketing_events": {
      const flowIdFilter = asTrimmedString(args.flowId);
      const flowNameFilter = asTrimmedString(args.flowName)?.toLowerCase();
      const statusFilter = asTrimmedString(args.status);
      const query = asTrimmedString(args.query);
      const createdFrom = parseOptionalDate(args.createdFrom);
      const createdTo = parseOptionalEndDate(args.createdTo);
      const includePayload = args.includePayload === true;
      const limit = asNumberInRange(args.limit, 25, 1, 100);

      const tenantFlows = await db
        .select({
          id: rdMarketingFlows.id,
          name: sql<string>`${rdMarketingFlows.settings}->>'name'`,
        })
        .from(rdMarketingFlows)
        .where(eq(rdMarketingFlows.tenantId, tenantId));

      const flowNameById = new Map(tenantFlows.map((f) => [f.id, f.name]));

      let matchedFlowIds: string[] | null = null;
      if (flowNameFilter) {
        matchedFlowIds = tenantFlows
          .filter((f) => (f.name || "").toLowerCase().includes(flowNameFilter))
          .map((f) => f.id);
        if (matchedFlowIds.length === 0) {
          return {
            tenantId,
            returnedCount: 0,
            events: [],
          };
        }
      }

      const conditions = [eq(rdMarketingEvents.tenantId, tenantId)];
      if (flowIdFilter) conditions.push(eq(rdMarketingEvents.flowId, flowIdFilter));
      if (matchedFlowIds) {
        conditions.push(
          or(...matchedFlowIds.map((fid) => eq(rdMarketingEvents.flowId, fid)))!,
        );
      }
      if (statusFilter) conditions.push(eq(rdMarketingEvents.status, statusFilter));
      if (createdFrom) conditions.push(gte(rdMarketingEvents.createdAt, createdFrom));
      if (createdTo) conditions.push(lte(rdMarketingEvents.createdAt, createdTo));
      if (query) {
        const pattern = `%${query}%`;
        conditions.push(
          or(
            sql`${rdMarketingEvents.payload}::text ILIKE ${pattern}`,
            ilike(rdMarketingEvents.errorMessage, pattern),
            ilike(rdMarketingEvents.id, pattern),
          )!,
        );
      }

      const rows = await db
        .select({
          id: rdMarketingEvents.id,
          flowId: rdMarketingEvents.flowId,
          status: rdMarketingEvents.status,
          attempts: rdMarketingEvents.attempts,
          outcomes: rdMarketingEvents.outcomes,
          errorMessage: rdMarketingEvents.errorMessage,
          nextRetryAt: rdMarketingEvents.nextRetryAt,
          createdAt: rdMarketingEvents.createdAt,
          updatedAt: rdMarketingEvents.updatedAt,
          payload: rdMarketingEvents.payload,
          flowSettingsName: sql<string | null>`${rdMarketingEvents.settings}->>'name'`,
        })
        .from(rdMarketingEvents)
        .where(and(...conditions))
        .orderBy(desc(rdMarketingEvents.createdAt))
        .limit(limit);

      return {
        tenantId,
        returnedCount: rows.length,
        events: rows.map((row) => ({
          id: row.id,
          flowId: row.flowId,
          flowName: flowNameById.get(row.flowId) ?? row.flowSettingsName ?? null,
          status: row.status,
          attempts: row.attempts,
          outcomes: row.outcomes,
          errorMessage: row.errorMessage,
          nextRetryAt: row.nextRetryAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          leadSummary: summarizeRdEventPayload(row.payload),
          ...(includePayload ? { payload: row.payload } : {}),
        })),
      };
    }

    case "list_rd_marketing_logs": {
      const flowIdFilter = asTrimmedString(args.flowId);
      const flowNameFilter = asTrimmedString(args.flowName)?.toLowerCase();
      const statusFilter = asTrimmedString(args.status);
      const includeDiagnostics = args.includeDiagnostics === true;
      const query = asTrimmedString(args.query);
      const createdFrom = parseOptionalDate(args.createdFrom);
      const createdTo = parseOptionalEndDate(args.createdTo);
      const limit = asNumberInRange(args.limit, 50, 1, 200);

      const tenantFlows = await db
        .select({
          id: rdMarketingFlows.id,
          name: sql<string>`${rdMarketingFlows.settings}->>'name'`,
        })
        .from(rdMarketingFlows)
        .where(eq(rdMarketingFlows.tenantId, tenantId));

      const flowNameById = new Map(tenantFlows.map((f) => [f.id, f.name]));

      let matchedFlowIds: string[] | null = null;
      if (flowNameFilter) {
        matchedFlowIds = tenantFlows
          .filter((f) => (f.name || "").toLowerCase().includes(flowNameFilter))
          .map((f) => f.id);
        if (matchedFlowIds.length === 0) {
          return {
            tenantId,
            returnedCount: 0,
            logs: [],
          };
        }
      }

      const conditions = [eq(rdMarketingLogs.tenantId, tenantId)];
      if (flowIdFilter) conditions.push(eq(rdMarketingLogs.flowId, flowIdFilter));
      if (matchedFlowIds) {
        conditions.push(
          or(...matchedFlowIds.map((fid) => eq(rdMarketingLogs.flowId, fid)))!,
        );
      }
      if (statusFilter) {
        conditions.push(eq(rdMarketingLogs.status, statusFilter));
      } else if (!includeDiagnostics) {
        conditions.push(ne(rdMarketingLogs.status, "diagnostic"));
      }
      if (createdFrom) conditions.push(gte(rdMarketingLogs.createdAt, createdFrom));
      if (createdTo) conditions.push(lte(rdMarketingLogs.createdAt, createdTo));
      if (query) {
        const pattern = `%${query}%`;
        conditions.push(
          or(
            ilike(rdMarketingLogs.message, pattern),
            ilike(rdMarketingLogs.dealId, pattern),
          )!,
        );
      }

      const rows = await db
        .select({
          id: rdMarketingLogs.id,
          flowId: rdMarketingLogs.flowId,
          status: rdMarketingLogs.status,
          dealId: rdMarketingLogs.dealId,
          message: rdMarketingLogs.message,
          createdAt: rdMarketingLogs.createdAt,
        })
        .from(rdMarketingLogs)
        .where(and(...conditions))
        .orderBy(desc(rdMarketingLogs.createdAt))
        .limit(limit);

      return {
        tenantId,
        returnedCount: rows.length,
        logs: rows.map((row) => ({
          id: row.id,
          flowId: row.flowId,
          flowName: flowNameById.get(row.flowId) ?? null,
          status: row.status,
          dealId: row.dealId,
          message: row.message,
          createdAt: row.createdAt,
        })),
      };
    }

    case "search_rd_marketing_journey_notifications": {
      const query = asTrimmedString(args.query);
      const eventTypeFilter = asTrimmedString(args.eventType)?.toUpperCase();
      const identifierFilter = asTrimmedString(args.identifier);
      const receivedFrom = parseOptionalDate(args.receivedFrom);
      const receivedTo = parseOptionalEndDate(args.receivedTo);
      const includeData = args.includeData !== false;
      const limit = asNumberInRange(args.limit, 30, 1, 100);

      const conditions = [eq(rdMarketingJourneyNotifications.tenantId, tenantId)];
      if (eventTypeFilter) {
        conditions.push(eq(rdMarketingJourneyNotifications.eventType, eventTypeFilter));
      }
      if (identifierFilter) {
        conditions.push(
          ilike(rdMarketingJourneyNotifications.identifier, `%${identifierFilter}%`),
        );
      }
      if (receivedFrom) {
        conditions.push(gte(rdMarketingJourneyNotifications.receivedAt, receivedFrom));
      }
      if (receivedTo) {
        conditions.push(lte(rdMarketingJourneyNotifications.receivedAt, receivedTo));
      }
      if (query) {
        const pattern = `%${query}%`;
        conditions.push(
          or(
            ilike(rdMarketingJourneyNotifications.email, pattern),
            ilike(rdMarketingJourneyNotifications.phone, pattern),
            ilike(rdMarketingJourneyNotifications.identifier, pattern),
            ilike(rdMarketingJourneyNotifications.rdUuid, pattern),
            sql`${rdMarketingJourneyNotifications.data}::text ILIKE ${pattern}`,
          )!,
        );
      }

      const [rows, endpoints] = await Promise.all([
        db
          .select({
            id: rdMarketingJourneyNotifications.id,
            endpointId: rdMarketingJourneyNotifications.endpointId,
            contactId: rdMarketingJourneyNotifications.contactId,
            rdUuid: rdMarketingJourneyNotifications.rdUuid,
            email: rdMarketingJourneyNotifications.email,
            phone: rdMarketingJourneyNotifications.phone,
            eventType: rdMarketingJourneyNotifications.eventType,
            eventKey: rdMarketingJourneyNotifications.eventKey,
            identifier: rdMarketingJourneyNotifications.identifier,
            occurredAt: rdMarketingJourneyNotifications.occurredAt,
            receivedAt: rdMarketingJourneyNotifications.receivedAt,
            data: rdMarketingJourneyNotifications.data,
          })
          .from(rdMarketingJourneyNotifications)
          .where(and(...conditions))
          .orderBy(desc(rdMarketingJourneyNotifications.receivedAt))
          .limit(limit),
        db
          .select({
            id: rdMarketingJourneyEndpoints.id,
            kind: rdMarketingJourneyEndpoints.kind,
            label: rdMarketingJourneyEndpoints.label,
          })
          .from(rdMarketingJourneyEndpoints)
          .where(eq(rdMarketingJourneyEndpoints.tenantId, tenantId)),
      ]);

      const endpointById = new Map(endpoints.map((ep) => [ep.id, ep]));

      return {
        tenantId,
        returnedCount: rows.length,
        notifications: rows.map((row) => ({
          id: row.id,
          endpoint: row.endpointId
            ? {
                id: row.endpointId,
                kind: endpointById.get(row.endpointId)?.kind ?? null,
                label: endpointById.get(row.endpointId)?.label ?? null,
              }
            : null,
          contactId: row.contactId,
          rdUuid: row.rdUuid,
          email: row.email,
          phone: row.phone,
          eventType: row.eventType,
          eventKey: row.eventKey,
          identifier: row.identifier,
          occurredAt: row.occurredAt,
          receivedAt: row.receivedAt,
          ...(includeData ? { data: row.data } : {}),
        })),
      };
    }

    default:
      throw new Error(`Ferramenta RD Marketing desconhecida: '${name}'.`);
  }
}
