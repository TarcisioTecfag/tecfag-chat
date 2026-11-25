import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, notInArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  extractAuditOriginFromStoredRecord,
  formatAuditTimestampBrt,
  normalizeAuditActorType,
  normalizeAuditSourceChannel,
} from "../audit/audit-context";
import { ensureAuditOriginSchema } from "../audit/audit-schema";
import {
  commercialSettings,
  contacts,
  crmActionHistory,
  crmDealActivities,
  crmDealContacts,
  crmDealEvents,
  crmDeals,
  crmPipelines,
  crmStageSettings,
  crmStages,
  metaMessageTemplates,
  operators,
} from "../../db/schema";
import { DEFAULT_MATURITY_RULES, type MaturityRule } from "../commercial/metrics";
import {
  fieldAppliesToPipeline,
  isFieldRequiredForStage,
  listCustomFields,
  missingStageFields,
  type CustomFieldDefinition,
  type CustomFieldValues,
  type StageContext,
} from "../crm/custom-fields";
import { getCatalogPolicy, listAvailableCatalogOptions } from "../crm/catalogs";
import {
  filterMetaTemplatesForContext,
  getMetaTemplatesRestrictByStage,
  listMetaTemplateGroups,
} from "../whatsapp/meta-templates";
import type { McpToolDefinition, McpWriteActorContext } from "./valem-tecfag-mcp-write-tools";

const TENANT_ID_PROP = {
  type: "string",
  enum: ["tecfag", "valem"],
  default: "tecfag",
  description: "Tenant alvo ('tecfag' ou 'valem'). Ignorado quando a chave MCP está travada em um tenant.",
};

const DEFAULT_ACTIVITY_BLOCK_MINUTES = 15;
const COOLING_CYCLE_RATIO = 0.8;
const LIMIT_CYCLE_RATIO = 1.1;

export const MCP_WAVE1_TOOLS: McpToolDefinition[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // ONDA 1 (SÓ MCP) — ITEM 9 (PARCIAL): REGRAS DA ETAPA LIDAS DO CRM
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "get_stage_rules",
    access: "read",
    description:
      "Lê diretamente do CRM as regras oficiais de uma etapa: objetivo/descrição/esfriamento (crm_stage_settings), campos obrigatórios cumulativos (stage_onwards + lista da etapa), motivos de perda permitidos na etapa, templates Meta liberados na etapa, faixas de ciclo por ticket (esfria 80% / limite 110%) e SLA configurado.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        dealId: {
          type: "string",
          description:
            "Opcional: ID de um card existente para resolver automaticamente funil, etapa e valor do card no cálculo de ciclo.",
        },
        pipelineId: { type: "string", description: "ID do funil (crm_pipelines.id)." },
        pipelineName: { type: "string", description: "Nome do funil (alternativa a pipelineId)." },
        stageId: { type: "string", description: "ID da etapa (crm_stages.id)." },
        stageName: { type: "string", description: "Nome da etapa (alternativa a stageId)." },
        dealValue: {
          type: "number",
          description:
            "Opcional: valor em BRL para calcular imediatamente a faixa de ciclo aplicável (esfria 80% e limite 110%).",
        },
        includeInactiveTemplates: {
          type: "boolean",
          default: false,
          description: "Quando true, inclui templates Meta fora do status APPROVED (padrão: false).",
        },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ONDA 1 (SÓ MCP) — ITEM 11 (PARCIAL): PRÉ-VALIDAÇÃO DE ETAPA & AGENDA
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "validate_deal_stage_transition",
    access: "read",
    description:
      "Pré-valida (dry-run, sem alterar dados) um card antes de mudar de etapa: executa a validação oficial de campos obrigatórios cumulativos (missingStageFields), lista tarefas/atividades atrasadas e verifica se há próxima atividade agendada, ordenando os bloqueios do mais antigo para o mais novo.",
    inputSchema: {
      type: "object",
      required: ["dealId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        dealId: { type: "string", description: "ID do card/negociação (crm_deals.id)." },
        targetPipelineId: {
          type: "string",
          description: "Opcional: ID do funil destino (padrão: funil atual do card).",
        },
        targetPipelineName: {
          type: "string",
          description: "Opcional: nome do funil destino.",
        },
        targetStageId: {
          type: "string",
          description: "Opcional: ID da etapa destino (padrão: etapa atual do card).",
        },
        targetStageName: {
          type: "string",
          description: "Opcional: nome da etapa destino.",
        },
      },
    },
  },
  {
    name: "check_operator_schedule_conflict",
    access: "read",
    description:
      "Cruza a agenda de atividades pendentes de um operador para um horário proposto e informa se existe conflito de horário, devolvendo exatamente qual lead/card e atividade ocupam aquele horário.",
    inputSchema: {
      type: "object",
      required: ["operatorId", "scheduledAt"],
      properties: {
        tenantId: TENANT_ID_PROP,
        operatorId: { type: "string", description: "ID do operador cuja agenda será consultada." },
        scheduledAt: {
          type: "string",
          description: "Data e hora propostas em formato ISO 8601 (ex: '2026-11-20T15:00:00-03:00').",
        },
        durationMinutes: {
          type: "number",
          default: 15,
          description: "Duração da atividade proposta em minutos (padrão: 15, mínimo 5, máximo 480).",
        },
        excludeActivityId: {
          type: "string",
          description: "Opcional: ID de uma atividade a ignorar (útil ao reagendar a própria atividade).",
        },
        excludeDealId: {
          type: "string",
          description: "Opcional: ID de um card cujas atividades serão ignoradas na checagem.",
        },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ONDA 1 (SÓ MCP) — ITEM 13 (PARCIAL): FILA DA ETAPA & TEMPO DE ESPERA
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "get_stage_queue",
    access: "read",
    description:
      "Lista a fila de cards abertos em uma etapa (ex: ATENDER / E6) com responsável atual, hora exata de entrada na etapa (via crm_deal_events), tempo de espera em minutos e sinalização de prazo estourado (padrão: SLA configurado no CRM ou 15 min), ordenada do maior tempo de espera para o menor.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        pipelineId: { type: "string", description: "ID do funil (crm_pipelines.id)." },
        pipelineName: { type: "string", description: "Nome do funil (ex: 'FUNIL CWR')." },
        stageId: { type: "string", description: "ID da etapa alvo (crm_stages.id)." },
        stageName: { type: "string", description: "Nome da etapa alvo (ex: 'ATENDER')." },
        slaMinutes: {
          type: "number",
          description: "Limite de espera em minutos para marcar prazo estourado (padrão: SLA do tenant ou 15).",
        },
        operatorId: { type: "string", description: "Opcional: filtra a fila por um responsável específico." },
        onlyBreached: {
          type: "boolean",
          default: false,
          description: "Quando true, retorna apenas os cards que já estouraram o prazo (slaBreached=true).",
        },
        includeTestDeals: {
          type: "boolean",
          default: false,
          description: "Quando true, inclui cards marcados como isTest=true (padrão: false).",
        },
        limit: {
          type: "number",
          default: 50,
          description: "Máximo de cards retornados (1 a 200, padrão: 50).",
        },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ONDA 1 (SÓ MCP) — ITEM 17 (PARCIAL): CONSULTA DO LOG DE AUDITORIA DO CARD
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "get_deal_audit_log",
    access: "read",
    description:
      "Consulta o log de auditoria completo de um card (crm_deal_events e crm_action_history): quem agiu (human/ai/system), canal (crm_ui/api/mcp/webhook/import), nome do autor, chave MCP, IP de origem, data/hora exata (ISO e BRT), mudanças de etapa, status e metadados.",
    inputSchema: {
      type: "object",
      required: ["dealId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        dealId: { type: "string", description: "ID do card/negociação (crm_deals.id)." },
        eventTypes: {
          type: "array",
          items: { type: "string" },
          description:
            "Opcional: filtra por tipos de evento (ex: ['stage_changed', 'status_changed', 'created']).",
        },
        actorType: {
          type: "string",
          enum: ["human", "ai", "system"],
          description: "Opcional: filtra por quem agiu ('human', 'ai' ou 'system').",
        },
        sourceChannel: {
          type: "string",
          enum: ["crm_ui", "api", "mcp", "webhook", "import"],
          description: "Opcional: filtra pelo canal de origem ('crm_ui', 'api', 'mcp', 'webhook', 'import').",
        },
        includeAdminActions: {
          type: "boolean",
          default: true,
          description:
            "Quando true (padrão), inclui também ações administrativas de crm_action_history que referenciem este card.",
        },
        order: {
          type: "string",
          enum: ["desc", "asc"],
          default: "desc",
          description: "Ordenação cronológica dos eventos ('desc' = mais recente primeiro; 'asc' = mais antigo primeiro).",
        },
        limit: {
          type: "number",
          default: 100,
          description: "Máximo de eventos retornados (1 a 300, padrão: 100).",
        },
        offset: {
          type: "number",
          default: 0,
          description: "Deslocamento para paginação dos eventos (padrão: 0).",
        },
      },
    },
  },
  {
    name: "search_crm_audit_logs",
    access: "read",
    description:
      "Consulta o log unificado de auditoria do CRM e Atendimento para TODAS as entidades (deal, contact, account, task, note, conversation), filtrável por quem agiu (human/ai/system), canal (crm_ui/api/mcp/webhook/import), IP, entidade, operador e período, retornando data/hora exata (ISO e BRT), autor, chave MCP e detalhes.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        entityType: {
          type: "string",
          description: "Opcional: tipo da entidade ('deal', 'contact', 'account', 'task', 'note', 'conversation', etc.).",
        },
        entityId: {
          type: "string",
          description: "Opcional: ID exato do registro auditado (dealId, contactId, accountId, taskId, conversationId).",
        },
        action: {
          type: "string",
          description: "Opcional: código da ação (ex: 'create_deal', 'update_deal', 'create_contact', 'transfer_conversation').",
        },
        actorType: {
          type: "string",
          enum: ["human", "ai", "system"],
          description: "Opcional: filtra por quem agiu ('human', 'ai' ou 'system').",
        },
        sourceChannel: {
          type: "string",
          enum: ["crm_ui", "api", "mcp", "webhook", "import"],
          description: "Opcional: filtra por canal ('crm_ui', 'api', 'mcp', 'webhook', 'import').",
        },
        operatorId: {
          type: "string",
          description: "Opcional: ID do operador humano autor da ação.",
        },
        clientIp: {
          type: "string",
          description: "Opcional: filtro parcial ou exato pelo endereço IP de origem.",
        },
        search: {
          type: "string",
          description: "Opcional: busca livre em nome do autor, entidade, ID, chave MCP ou detalhes.",
        },
        startDate: {
          type: "string",
          description: "Opcional: data/hora inicial ISO 8601 ou YYYY-MM-DD.",
        },
        endDate: {
          type: "string",
          description: "Opcional: data/hora final ISO 8601 ou YYYY-MM-DD.",
        },
        order: {
          type: "string",
          enum: ["desc", "asc"],
          default: "desc",
          description: "Ordenação cronológica ('desc' = mais recente primeiro; 'asc' = mais antigo primeiro).",
        },
        limit: {
          type: "number",
          default: 50,
          description: "Máximo de registros retornados (1 a 200, padrão: 50).",
        },
        offset: {
          type: "number",
          default: 0,
          description: "Deslocamento para paginação (padrão: 0).",
        },
      },
    },
  },
];

export const MCP_WAVE1_TOOL_LABELS_PT: Record<string, string> = {
  get_stage_rules: "Regras Oficiais da Etapa (CRM)",
  validate_deal_stage_transition: "Pré-Validação de Transição de Etapa (CRM)",
  check_operator_schedule_conflict: "Checagem de Conflito de Agenda do Operador",
  get_stage_queue: "Fila de Espera e SLA da Etapa (CRM)",
  get_deal_audit_log: "Log de Auditoria do Card (CRM)",
  search_crm_audit_logs: "Consulta Unificada de Auditoria (CRM & Chat)",
};

const WAVE1_TOOL_NAMES = new Set(MCP_WAVE1_TOOLS.map((t) => t.name));

export function isWave1McpTool(name: string): boolean {
  return WAVE1_TOOL_NAMES.has(name);
}

function asTrimmedString(val: unknown): string | undefined {
  if (typeof val !== "string") return undefined;
  const trimmed = val.trim();
  return trimmed.length ? trimmed : undefined;
}

function asFiniteNumber(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string" && val.trim() !== "") {
    const n = Number(val.trim().replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function clampInt(val: unknown, fallback: number, min: number, max: number): number {
  const n = asFiniteNumber(val);
  if (n === undefined) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function roundOneDecimal(val: number): number {
  return Math.round(val * 10) / 10;
}

function normalizeMaturityRules(raw: unknown): MaturityRule[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_MATURITY_RULES;
  const valid = raw
    .filter(
      (item): item is MaturityRule =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as any).days === "number" &&
        Number.isFinite((item as any).days) &&
        (item as any).days > 0 &&
        ((item as any).maxValue === null ||
          (typeof (item as any).maxValue === "number" && Number.isFinite((item as any).maxValue))),
    )
    .map((item) => ({ days: item.days, maxValue: item.maxValue }));
  return valid.length > 0 ? valid : DEFAULT_MATURITY_RULES;
}

export function computeCycleTierForValue(value: number, rules: MaturityRule[]) {
  if (!Number.isFinite(value) || value <= 0 || !rules.length) return null;
  const tierIndex = rules.findIndex((rule) => rule.maxValue === null || value <= rule.maxValue);
  if (tierIndex < 0) return null;
  const tier = rules[tierIndex];
  return {
    tierIndex: tierIndex + 1,
    dealValue: value,
    maxValue: tier.maxValue,
    cycleDays: tier.days,
    coolingAtDays: roundOneDecimal(tier.days * COOLING_CYCLE_RATIO),
    limitAtDays: roundOneDecimal(tier.days * LIMIT_CYCLE_RATIO),
    coolingRatio: COOLING_CYCLE_RATIO,
    limitRatio: LIMIT_CYCLE_RATIO,
  };
}

async function resolveStageForTenant(
  tenantId: string,
  opts: {
    pipelineId?: string;
    pipelineName?: string;
    stageId?: string;
    stageName?: string;
  },
) {
  let pipeline: { id: string; name: string; isDefault: boolean } | null = null;

  if (opts.pipelineId) {
    const [found] = await db
      .select({ id: crmPipelines.id, name: crmPipelines.name, isDefault: crmPipelines.isDefault })
      .from(crmPipelines)
      .where(and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, opts.pipelineId)))
      .limit(1);
    if (!found) {
      throw new Error(`Funil '${opts.pipelineId}' não encontrado no tenant '${tenantId}'.`);
    }
    pipeline = found;
  } else if (opts.pipelineName) {
    const allPipes = await db
      .select({ id: crmPipelines.id, name: crmPipelines.name, isDefault: crmPipelines.isDefault })
      .from(crmPipelines)
      .where(eq(crmPipelines.tenantId, tenantId));
    const needle = opts.pipelineName.toLowerCase();
    const found =
      allPipes.find((p) => p.name.toLowerCase() === needle) ||
      allPipes.find((p) => p.name.toLowerCase().includes(needle));
    if (!found) {
      throw new Error(`Funil '${opts.pipelineName}' não encontrado no tenant '${tenantId}'.`);
    }
    pipeline = found;
  }

  if (opts.stageId) {
    const [stage] = await db
      .select()
      .from(crmStages)
      .where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.id, opts.stageId)))
      .limit(1);
    if (!stage) {
      throw new Error(`Etapa '${opts.stageId}' não encontrada no tenant '${tenantId}'.`);
    }
    if (pipeline && stage.pipelineId !== pipeline.id) {
      throw new Error(`Etapa '${opts.stageId}' não pertence ao funil '${pipeline.name}'.`);
    }
    if (!pipeline) {
      const [foundPipe] = await db
        .select({ id: crmPipelines.id, name: crmPipelines.name, isDefault: crmPipelines.isDefault })
        .from(crmPipelines)
        .where(and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, stage.pipelineId)))
        .limit(1);
      if (!foundPipe) {
        throw new Error(`Funil '${stage.pipelineId}' não encontrado no tenant '${tenantId}'.`);
      }
      pipeline = foundPipe;
    }
    const allStages = await db
      .select()
      .from(crmStages)
      .where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.pipelineId, pipeline.id)))
      .orderBy(asc(crmStages.orderIndex), asc(crmStages.createdAt));
    return { pipeline, stage, allStages };
  }

  if (!opts.stageName) {
    throw new Error("Informe 'stageId', 'stageName' ou 'dealId' para identificar a etapa.");
  }

  if (!pipeline) {
    const stageRows = await db
      .select({
        stage: crmStages,
        pipelineName: crmPipelines.name,
        pipelineIsDefault: crmPipelines.isDefault,
      })
      .from(crmStages)
      .innerJoin(
        crmPipelines,
        and(eq(crmPipelines.id, crmStages.pipelineId), eq(crmPipelines.tenantId, tenantId)),
      )
      .where(eq(crmStages.tenantId, tenantId))
      .orderBy(asc(crmPipelines.orderIndex), asc(crmStages.orderIndex));

    const needle = opts.stageName.toLowerCase();
    const exactMatches = stageRows.filter((r) => r.stage.name.toLowerCase() === needle);
    const partialMatches =
      exactMatches.length > 0
        ? exactMatches
        : stageRows.filter((r) => r.stage.name.toLowerCase().includes(needle));

    if (partialMatches.length === 0) {
      throw new Error(`Etapa '${opts.stageName}' não encontrada no tenant '${tenantId}'.`);
    }
    if (partialMatches.length > 1) {
      const candidates = partialMatches
        .slice(0, 6)
        .map((m) => `${m.pipelineName} / ${m.stage.name} (${m.stage.id})`)
        .join("; ");
      throw new Error(
        `Etapa '${opts.stageName}' existe em mais de um funil. Informe 'pipelineId' ou 'pipelineName'. Candidatas: ${candidates}`,
      );
    }
    const chosen = partialMatches[0];
    pipeline = {
      id: chosen.stage.pipelineId,
      name: chosen.pipelineName,
      isDefault: chosen.pipelineIsDefault,
    };
    const allStages = await db
      .select()
      .from(crmStages)
      .where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.pipelineId, pipeline.id)))
      .orderBy(asc(crmStages.orderIndex), asc(crmStages.createdAt));
    return { pipeline, stage: chosen.stage, allStages };
  }

  const allStages = await db
    .select()
    .from(crmStages)
    .where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.pipelineId, pipeline.id)))
    .orderBy(asc(crmStages.orderIndex), asc(crmStages.createdAt));

  const needle = opts.stageName.toLowerCase();
  const stage =
    allStages.find((s) => s.name.toLowerCase() === needle) ||
    allStages.find((s) => s.name.toLowerCase().includes(needle));
  if (!stage) {
    throw new Error(
      `Etapa '${opts.stageName}' não encontrada no funil '${pipeline.name}' (tenant '${tenantId}').`,
    );
  }
  return { pipeline, stage, allStages };
}

function buildRequiredFieldsSummary(
  stage: typeof crmStages.$inferSelect,
  allStages: Array<typeof crmStages.$inferSelect>,
  definitions: CustomFieldDefinition[],
) {
  const stageById = new Map(allStages.map((s) => [s.id, s]));
  const applicable = definitions.filter((f) => fieldAppliesToPipeline(f, stage.pipelineId));
  const defById = new Map(applicable.map((f) => [f.id, f]));
  const stageContext: StageContext = {
    stageId: stage.id,
    orderIndex: stage.orderIndex,
    allStages: allStages.map((s) => ({
      id: s.id,
      orderIndex: s.orderIndex,
      pipelineId: s.pipelineId,
    })),
  };

  const explicitIds = Array.isArray(stage.requiredFields) ? stage.requiredFields : [];
  const seen = new Set<string>();
  const requiredFields: Array<{
    id: string;
    name: string;
    fieldType: string;
    requiredRule: string;
    requiredFromStageId: string | null;
    requiredFromStageName: string | null;
    options: Array<{ id: string; label: string }>;
    source: "stage_list" | "stage_onwards" | "always";
  }> = [];

  for (const id of explicitIds) {
    const def = defById.get(id);
    if (def && !seen.has(def.id)) {
      seen.add(def.id);
      requiredFields.push({
        id: def.id,
        name: def.name,
        fieldType: def.fieldType,
        requiredRule: def.requiredRule || "always",
        requiredFromStageId: def.requiredFromStageId ?? null,
        requiredFromStageName: def.requiredFromStageId
          ? (stageById.get(def.requiredFromStageId)?.name ?? null)
          : null,
        options: Array.isArray(def.options) ? (def.options as Array<{ id: string; label: string }>) : [],
        source: "stage_list",
      });
    }
  }

  for (const def of applicable) {
    if (seen.has(def.id)) continue;
    if (isFieldRequiredForStage(def, stageContext)) {
      seen.add(def.id);
      requiredFields.push({
        id: def.id,
        name: def.name,
        fieldType: def.fieldType,
        requiredRule: def.requiredRule || "always",
        requiredFromStageId: def.requiredFromStageId ?? null,
        requiredFromStageName: def.requiredFromStageId
          ? (stageById.get(def.requiredFromStageId)?.name ?? null)
          : null,
        options: Array.isArray(def.options) ? (def.options as Array<{ id: string; label: string }>) : [],
        source: def.requiredRule === "stage_onwards" ? "stage_onwards" : "always",
      });
    }
  }

  return {
    stageContext,
    applicableCount: applicable.length,
    requiredFields,
  };
}

export async function executeWave1McpTool(
  name: string,
  args: Record<string, unknown>,
  tenantId: string,
  _actor: McpWriteActorContext,
): Promise<unknown> {
  switch (name) {
    // ── 1. GET STAGE RULES (READ — ITEM 9 PARCIAL) ───────────────────────────
    case "get_stage_rules": {
      const dealId = asTrimmedString(args.dealId);
      let pipelineId = asTrimmedString(args.pipelineId);
      let pipelineName = asTrimmedString(args.pipelineName);
      let stageId = asTrimmedString(args.stageId);
      let stageName = asTrimmedString(args.stageName);
      let dealValue = asFiniteNumber(args.dealValue);
      let resolvedFromDeal: { id: string; title: string; value: number | null; status: string } | null = null;

      if (dealId) {
        const [deal] = await db
          .select({
            id: crmDeals.id,
            title: crmDeals.title,
            pipelineId: crmDeals.pipelineId,
            stageId: crmDeals.stageId,
            value: crmDeals.value,
            status: crmDeals.status,
          })
          .from(crmDeals)
          .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, dealId)))
          .limit(1);
        if (!deal) {
          throw new Error(`Negociação '${dealId}' não encontrada no tenant '${tenantId}'.`);
        }
        const parsedDealVal = deal.value !== null && deal.value !== undefined ? Number(deal.value) : null;
        resolvedFromDeal = {
          id: deal.id,
          title: deal.title,
          value: parsedDealVal !== null && Number.isFinite(parsedDealVal) ? parsedDealVal : null,
          status: deal.status,
        };
        if (!pipelineId && !pipelineName && !stageId) {
          pipelineId = deal.pipelineId;
        }
        if (!stageId && !stageName) {
          stageId = deal.stageId;
        }
        if (dealValue === undefined && resolvedFromDeal.value !== null) {
          dealValue = resolvedFromDeal.value;
        }
      }

      const { pipeline, stage, allStages } = await resolveStageForTenant(tenantId, {
        pipelineId,
        pipelineName,
        stageId,
        stageName,
      });

      const includeInactiveTemplates = args.includeInactiveTemplates === true;

      const [
        stageSettingsRows,
        dealCustomFields,
        lossReasonPolicy,
        lossReasonOptions,
        rawTemplates,
        templateGroups,
        templatesRestrictByStage,
        commSettingsRows,
      ] = await Promise.all([
        db
          .select()
          .from(crmStageSettings)
          .where(and(eq(crmStageSettings.tenantId, tenantId), eq(crmStageSettings.stageId, stage.id)))
          .limit(1),
        listCustomFields(tenantId, "deal"),
        getCatalogPolicy(tenantId, "loss_reason"),
        listAvailableCatalogOptions(tenantId, "loss_reason", {
          pipelineId: pipeline.id,
          stageId: stage.id,
        }),
        db
          .select({
            id: metaMessageTemplates.id,
            metaTemplateId: metaMessageTemplates.metaTemplateId,
            name: metaMessageTemplates.name,
            language: metaMessageTemplates.language,
            category: metaMessageTemplates.category,
            status: metaMessageTemplates.status,
            bodyText: metaMessageTemplates.bodyText,
            bindings: metaMessageTemplates.bindings,
            customGroups: metaMessageTemplates.customGroups,
            allPipelines: metaMessageTemplates.allPipelines,
            pipelineIds: metaMessageTemplates.pipelineIds,
            stageIds: metaMessageTemplates.stageIds,
          })
          .from(metaMessageTemplates)
          .where(eq(metaMessageTemplates.tenantId, tenantId))
          .orderBy(asc(metaMessageTemplates.name)),
        listMetaTemplateGroups(tenantId),
        getMetaTemplatesRestrictByStage(tenantId),
        db
          .select({
            maturityRules: commercialSettings.maturityRules,
            slaLimitMinutes: commercialSettings.slaLimitMinutes,
          })
          .from(commercialSettings)
          .where(eq(commercialSettings.tenantId, tenantId))
          .limit(1),
      ]);

      const stageSettings = stageSettingsRows[0] ?? null;
      const fieldsSummary = buildRequiredFieldsSummary(stage, allStages, dealCustomFields);

      const eligibleTemplates = includeInactiveTemplates
        ? rawTemplates
        : rawTemplates.filter((t) => String(t.status || "").toUpperCase() === "APPROVED");

      const stageTemplates = filterMetaTemplatesForContext(
        eligibleTemplates,
        templateGroups,
        templatesRestrictByStage,
        { pipelineId: pipeline.id, stageId: stage.id },
      );

      const commSettings = commSettingsRows[0] ?? null;
      const maturityRules = normalizeMaturityRules(commSettings?.maturityRules);
      const slaLimitMinutes =
        typeof commSettings?.slaLimitMinutes === "number" && commSettings.slaLimitMinutes > 0
          ? commSettings.slaLimitMinutes
          : 15;

      const cycleTiers = maturityRules.map((rule, index) => ({
        tierIndex: index + 1,
        maxValue: rule.maxValue,
        cycleDays: rule.days,
        coolingAtDays: roundOneDecimal(rule.days * COOLING_CYCLE_RATIO),
        limitAtDays: roundOneDecimal(rule.days * LIMIT_CYCLE_RATIO),
      }));

      const applicableCycle =
        dealValue !== undefined ? computeCycleTierForValue(dealValue, maturityRules) : null;

      return {
        tenantId,
        resolvedFromDeal,
        pipeline,
        stage: {
          id: stage.id,
          name: stage.name,
          orderIndex: stage.orderIndex,
          isWinStage: stage.isWinStage,
          isLossStage: stage.isLossStage,
          abbreviation: stageSettings?.abbreviation ?? null,
          objective: stageSettings?.objective ?? null,
          description: stageSettings?.description ?? null,
          coolingEnabled: stageSettings?.coolingEnabled ?? true,
          coolingDays: stageSettings?.coolingDays ?? 10,
        },
        requiredFields: {
          count: fieldsSummary.requiredFields.length,
          totalPipelineCustomFields: fieldsSummary.applicableCount,
          items: fieldsSummary.requiredFields,
        },
        lossReasons: {
          restrictByStage: lossReasonPolicy.restrictByStage,
          count: lossReasonOptions.length,
          items: lossReasonOptions.map((o) => ({
            id: o.id,
            name: o.name,
            isStandard: o.isStandard,
          })),
        },
        metaTemplates: {
          restrictByStage: templatesRestrictByStage,
          onlyApproved: !includeInactiveTemplates,
          count: stageTemplates.length,
          items: stageTemplates.map((t) => ({
            id: t.id,
            metaTemplateId: t.metaTemplateId,
            name: t.name,
            language: t.language,
            category: t.category,
            status: t.status,
            bodyText: t.bodyText,
            bindings: t.bindings,
            customGroups: t.customGroups,
          })),
        },
        generalRules: {
          slaLimitMinutes,
          coolingRatio: COOLING_CYCLE_RATIO,
          limitRatio: LIMIT_CYCLE_RATIO,
          cycleTiers,
          applicableCycle,
        },
      };
    }

    // ── 2. VALIDATE DEAL STAGE TRANSITION (READ — ITEM 11 PARCIAL) ───────────
    case "validate_deal_stage_transition": {
      const dealId = asTrimmedString(args.dealId);
      if (!dealId) {
        throw new Error("Campo obrigatório: 'dealId'.");
      }

      const [deal] = await db
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, dealId)))
        .limit(1);
      if (!deal) {
        throw new Error(`Negociação '${dealId}' não encontrada no tenant '${tenantId}'.`);
      }

      const targetPipelineId = asTrimmedString(args.targetPipelineId);
      const targetPipelineName = asTrimmedString(args.targetPipelineName);
      const targetStageId = asTrimmedString(args.targetStageId);
      const targetStageName = asTrimmedString(args.targetStageName);

      const resolvedTarget = await resolveStageForTenant(tenantId, {
        pipelineId: targetPipelineId ?? (!targetPipelineName && !targetStageId ? deal.pipelineId : undefined),
        pipelineName: targetPipelineName,
        stageId: targetStageId ?? (!targetStageName ? deal.stageId : undefined),
        stageName: targetStageName,
      });

      const [dealCustomFields, pendingActivities] = await Promise.all([
        listCustomFields(tenantId, "deal"),
        db
          .select({
            id: crmDealActivities.id,
            type: crmDealActivities.type,
            title: crmDealActivities.title,
            status: crmDealActivities.status,
            dueDate: crmDealActivities.dueDate,
            assignedToOperatorId: crmDealActivities.assignedToOperatorId,
            createdAt: crmDealActivities.createdAt,
          })
          .from(crmDealActivities)
          .where(
            and(
              eq(crmDealActivities.tenantId, tenantId),
              eq(crmDealActivities.dealId, dealId),
              eq(crmDealActivities.status, "pending"),
              notInArray(crmDealActivities.type, ["note", "system_event"]),
            ),
          )
          .orderBy(asc(crmDealActivities.dueDate), asc(crmDealActivities.createdAt)),
      ]);

      const fieldsSummary = buildRequiredFieldsSummary(
        resolvedTarget.stage,
        resolvedTarget.allStages,
        dealCustomFields,
      );

      const customValues =
        deal.customFields && typeof deal.customFields === "object" && !Array.isArray(deal.customFields)
          ? (deal.customFields as CustomFieldValues)
          : {};

      const missingNames = missingStageFields(
        Array.isArray(resolvedTarget.stage.requiredFields) ? resolvedTarget.stage.requiredFields : [],
        dealCustomFields,
        customValues,
        resolvedTarget.pipeline.id,
        fieldsSummary.stageContext,
      );
      const missingNameSet = new Set(missingNames);
      const missingFieldsDetailed = fieldsSummary.requiredFields.filter((f) =>
        missingNameSet.has(f.name),
      );

      const now = new Date();
      const overdueActivities = pendingActivities
        .filter((a) => a.dueDate !== null && a.dueDate.getTime() < now.getTime())
        .map((a) => ({
          id: a.id,
          type: a.type,
          title: a.title,
          dueDate: a.dueDate!.toISOString(),
          overdueMinutes: Math.max(1, Math.round((now.getTime() - a.dueDate!.getTime()) / 60_000)),
          assignedToOperatorId: a.assignedToOperatorId,
        }));

      const upcomingActivities = pendingActivities
        .filter((a) => a.dueDate === null || a.dueDate.getTime() >= now.getTime())
        .map((a) => ({
          id: a.id,
          type: a.type,
          title: a.title,
          dueDate: a.dueDate ? a.dueDate.toISOString() : null,
          assignedToOperatorId: a.assignedToOperatorId,
        }));

      const hasFutureScheduledActivity = upcomingActivities.some((a) => a.dueDate !== null);

      type BlockerItem = {
        code: "overdue_activity" | "missing_scheduled_activity" | "missing_required_fields";
        severity: "blocking" | "warning";
        since: string;
        message: string;
        details?: Record<string, unknown>;
      };

      const blockers: BlockerItem[] = [];

      for (const act of overdueActivities) {
        blockers.push({
          code: "overdue_activity",
          severity: "warning",
          since: act.dueDate,
          message: `Atividade atrasada há ${act.overdueMinutes} min: "${act.title}".`,
          details: { activityId: act.id, type: act.type, dueDate: act.dueDate },
        });
      }

      if (deal.status === "open" && !hasFutureScheduledActivity) {
        blockers.push({
          code: "missing_scheduled_activity",
          severity: "warning",
          since: (deal.lastActivityAt ?? deal.createdAt).toISOString(),
          message: "Card aberto sem próxima atividade futura agendada.",
        });
      }

      if (missingNames.length > 0) {
        blockers.push({
          code: "missing_required_fields",
          severity: "blocking",
          since: now.toISOString(),
          message: `Campos obrigatórios faltando para a etapa '${resolvedTarget.stage.name}': ${missingNames.join(", ")}.`,
          details: { missingFieldNames: missingNames },
        });
      }

      blockers.sort((a, b) => new Date(a.since).getTime() - new Date(b.since).getTime());

      const canMoveInCrmNow = missingNames.length === 0;
      const canTransitionCleanly = blockers.length === 0;

      return {
        tenantId,
        dealId: deal.id,
        dealTitle: deal.title,
        dealStatus: deal.status,
        currentPipelineId: deal.pipelineId,
        currentStageId: deal.stageId,
        targetPipelineId: resolvedTarget.pipeline.id,
        targetPipelineName: resolvedTarget.pipeline.name,
        targetStageId: resolvedTarget.stage.id,
        targetStageName: resolvedTarget.stage.name,
        canMoveInCrmNow,
        canTransitionCleanly,
        missingFieldsCount: missingNames.length,
        missingFields: missingNames,
        missingFieldsDetailed,
        overdueActivitiesCount: overdueActivities.length,
        overdueActivities,
        upcomingActivitiesCount: upcomingActivities.length,
        upcomingActivities,
        hasFutureScheduledActivity,
        blockers,
      };
    }

    // ── 3. CHECK OPERATOR SCHEDULE CONFLICT (READ — ITEM 11 PARCIAL) ─────────
    case "check_operator_schedule_conflict": {
      const operatorId = asTrimmedString(args.operatorId);
      const scheduledAtRaw = asTrimmedString(args.scheduledAt);
      if (!operatorId || !scheduledAtRaw) {
        throw new Error("Campos obrigatórios: 'operatorId' e 'scheduledAt'.");
      }

      const proposedStart = new Date(scheduledAtRaw);
      if (Number.isNaN(proposedStart.getTime())) {
        throw new Error(`Data inválida em 'scheduledAt': '${scheduledAtRaw}'. Use formato ISO 8601.`);
      }

      const durationMinutes = clampInt(args.durationMinutes, DEFAULT_ACTIVITY_BLOCK_MINUTES, 5, 480);
      const proposedEnd = new Date(proposedStart.getTime() + durationMinutes * 60_000);
      const excludeActivityId = asTrimmedString(args.excludeActivityId);
      const excludeDealId = asTrimmedString(args.excludeDealId);

      const [op] = await db
        .select({ id: operators.id, name: operators.name, email: operators.email })
        .from(operators)
        .where(and(eq(operators.tenantId, tenantId), eq(operators.id, operatorId)))
        .limit(1);
      if (!op) {
        throw new Error(`Operador '${operatorId}' não encontrado no tenant '${tenantId}'.`);
      }

      // Janela ampla para capturar qualquer atividade cujo bloco de 15 min sobreponha [proposedStart, proposedEnd)
      const windowStart = new Date(proposedStart.getTime() - 2 * 60 * 60_000);
      const windowEnd = new Date(proposedEnd.getTime() + DEFAULT_ACTIVITY_BLOCK_MINUTES * 60_000);

      const candidates = await db
        .select({
          id: crmDealActivities.id,
          dealId: crmDealActivities.dealId,
          type: crmDealActivities.type,
          title: crmDealActivities.title,
          dueDate: crmDealActivities.dueDate,
          assignedToOperatorId: crmDealActivities.assignedToOperatorId,
          assignedToOperatorIds: crmDealActivities.assignedToOperatorIds,
        })
        .from(crmDealActivities)
        .where(
          and(
            eq(crmDealActivities.tenantId, tenantId),
            eq(crmDealActivities.status, "pending"),
            notInArray(crmDealActivities.type, ["note", "system_event"]),
            isNotNull(crmDealActivities.dueDate),
            gte(crmDealActivities.dueDate, windowStart),
            lte(crmDealActivities.dueDate, windowEnd),
          ),
        )
        .orderBy(asc(crmDealActivities.dueDate));

      const overlapping = candidates
        .filter((act) => {
          if (excludeActivityId && act.id === excludeActivityId) return false;
          if (excludeDealId && act.dealId === excludeDealId) return false;
          const assignees = Array.isArray(act.assignedToOperatorIds) ? act.assignedToOperatorIds : [];
          const isForOperator =
            act.assignedToOperatorId === operatorId || assignees.includes(operatorId);
          if (!isForOperator || !act.dueDate) return false;

          const actStart = act.dueDate.getTime();
          const actEnd = actStart + DEFAULT_ACTIVITY_BLOCK_MINUTES * 60_000;
          return actStart < proposedEnd.getTime() && actEnd > proposedStart.getTime();
        })
        .map((act) => {
          const actStart = act.dueDate!.getTime();
          const actEnd = actStart + DEFAULT_ACTIVITY_BLOCK_MINUTES * 60_000;
          const overlapMs =
            Math.min(actEnd, proposedEnd.getTime()) - Math.max(actStart, proposedStart.getTime());
          return {
            ...act,
            assumedEnd: new Date(actEnd),
            overlapMinutes: Math.max(1, Math.round(overlapMs / 60_000)),
          };
        });

      const dealIds = Array.from(new Set(overlapping.map((o) => o.dealId)));
      const dealsMap = new Map<string, { id: string; title: string; stageId: string; status: string }>();
      const primaryContactByDeal = new Map<
        string,
        { id: string; name: string; phone: string | null }
      >();

      if (dealIds.length > 0) {
        const [dealRows, contactRows] = await Promise.all([
          db
            .select({
              id: crmDeals.id,
              title: crmDeals.title,
              stageId: crmDeals.stageId,
              status: crmDeals.status,
            })
            .from(crmDeals)
            .where(and(eq(crmDeals.tenantId, tenantId), inArray(crmDeals.id, dealIds))),
          db
            .select({
              dealId: crmDealContacts.dealId,
              isPrimary: crmDealContacts.isPrimary,
              contactId: contacts.id,
              contactName: contacts.name,
              contactPhone: contacts.phone,
            })
            .from(crmDealContacts)
            .innerJoin(
              contacts,
              and(eq(contacts.id, crmDealContacts.contactId), eq(contacts.tenantId, tenantId)),
            )
            .where(
              and(eq(crmDealContacts.tenantId, tenantId), inArray(crmDealContacts.dealId, dealIds)),
            )
            .orderBy(desc(crmDealContacts.isPrimary), asc(crmDealContacts.createdAt)),
        ]);

        for (const d of dealRows) dealsMap.set(d.id, d);
        for (const c of contactRows) {
          if (!primaryContactByDeal.has(c.dealId)) {
            primaryContactByDeal.set(c.dealId, {
              id: c.contactId,
              name: c.contactName,
              phone: c.contactPhone ?? null,
            });
          }
        }
      }

      const conflicts = overlapping.map((item) => {
        const deal = dealsMap.get(item.dealId);
        const contact = primaryContactByDeal.get(item.dealId);
        return {
          activityId: item.id,
          activityType: item.type,
          activityTitle: item.title,
          scheduledAt: item.dueDate!.toISOString(),
          assumedEndAt: item.assumedEnd.toISOString(),
          assumedDurationMinutes: DEFAULT_ACTIVITY_BLOCK_MINUTES,
          overlapMinutes: item.overlapMinutes,
          dealId: item.dealId,
          dealTitle: deal?.title ?? null,
          dealStageId: deal?.stageId ?? null,
          dealStatus: deal?.status ?? null,
          leadContactId: contact?.id ?? null,
          leadContactName: contact?.name ?? null,
          leadContactPhone: contact?.phone ?? null,
        };
      });

      return {
        tenantId,
        operatorId: op.id,
        operatorName: op.name,
        proposedStart: proposedStart.toISOString(),
        proposedEnd: proposedEnd.toISOString(),
        durationMinutes,
        assumedExistingBlockMinutes: DEFAULT_ACTIVITY_BLOCK_MINUTES,
        hasConflict: conflicts.length > 0,
        conflictCount: conflicts.length,
        conflicts,
      };
    }

    // ── 4. GET STAGE QUEUE (READ — ITEM 13 PARCIAL) ──────────────────────────
    case "get_stage_queue": {
      const { pipeline, stage } = await resolveStageForTenant(tenantId, {
        pipelineId: asTrimmedString(args.pipelineId),
        pipelineName: asTrimmedString(args.pipelineName),
        stageId: asTrimmedString(args.stageId),
        stageName: asTrimmedString(args.stageName),
      });

      const operatorId = asTrimmedString(args.operatorId);
      const onlyBreached = args.onlyBreached === true;
      const includeTestDeals = args.includeTestDeals === true;
      const limit = clampInt(args.limit, 50, 1, 200);

      let slaMinutes = asFiniteNumber(args.slaMinutes);
      if (slaMinutes === undefined || slaMinutes <= 0) {
        const [comm] = await db
          .select({ slaLimitMinutes: commercialSettings.slaLimitMinutes })
          .from(commercialSettings)
          .where(eq(commercialSettings.tenantId, tenantId))
          .limit(1);
        slaMinutes =
          typeof comm?.slaLimitMinutes === "number" && comm.slaLimitMinutes > 0
            ? comm.slaLimitMinutes
            : 15;
      }

      const conditions = [
        eq(crmDeals.tenantId, tenantId),
        eq(crmDeals.pipelineId, pipeline.id),
        eq(crmDeals.stageId, stage.id),
        eq(crmDeals.status, "open"),
      ];
      if (!includeTestDeals) {
        conditions.push(eq(crmDeals.isTest, false));
      }
      if (operatorId) {
        conditions.push(eq(crmDeals.operatorId, operatorId));
      }

      const openDeals = await db
        .select({
          id: crmDeals.id,
          title: crmDeals.title,
          operatorId: crmDeals.operatorId,
          value: crmDeals.value,
          source: crmDeals.source,
          campaign: crmDeals.campaign,
          createdAt: crmDeals.createdAt,
          updatedAt: crmDeals.updatedAt,
          lastActivityAt: crmDeals.lastActivityAt,
        })
        .from(crmDeals)
        .where(and(...conditions));

      const dealIds = openDeals.map((d) => d.id);
      const operatorIds = Array.from(
        new Set(openDeals.map((d) => d.operatorId).filter((id): id is string => Boolean(id))),
      );

      const enteredAtByDeal = new Map<string, { at: Date; source: "stage_changed_event" | "deal_created_at" }>();
      const opMap = new Map<string, { id: string; name: string; email: string }>();
      const contactByDeal = new Map<string, { id: string; name: string; phone: string | null }>();

      if (dealIds.length > 0) {
        const [stageEventRows, opRows, contactRows] = await Promise.all([
          db
            .select({
              dealId: crmDealEvents.dealId,
              enteredAt: sql<Date>`MAX(${crmDealEvents.createdAt})`,
            })
            .from(crmDealEvents)
            .where(
              and(
                eq(crmDealEvents.tenantId, tenantId),
                inArray(crmDealEvents.dealId, dealIds),
                eq(crmDealEvents.eventType, "stage_changed"),
                eq(crmDealEvents.toStageId, stage.id),
              ),
            )
            .groupBy(crmDealEvents.dealId),
          operatorIds.length > 0
            ? db
                .select({ id: operators.id, name: operators.name, email: operators.email })
                .from(operators)
                .where(and(eq(operators.tenantId, tenantId), inArray(operators.id, operatorIds)))
            : Promise.resolve([]),
          db
            .select({
              dealId: crmDealContacts.dealId,
              contactId: contacts.id,
              contactName: contacts.name,
              contactPhone: contacts.phone,
            })
            .from(crmDealContacts)
            .innerJoin(
              contacts,
              and(eq(contacts.id, crmDealContacts.contactId), eq(contacts.tenantId, tenantId)),
            )
            .where(
              and(eq(crmDealContacts.tenantId, tenantId), inArray(crmDealContacts.dealId, dealIds)),
            )
            .orderBy(desc(crmDealContacts.isPrimary), asc(crmDealContacts.createdAt)),
        ]);

        for (const ev of stageEventRows) {
          if (ev.enteredAt) {
            enteredAtByDeal.set(ev.dealId, {
              at: new Date(ev.enteredAt),
              source: "stage_changed_event",
            });
          }
        }
        for (const o of opRows) opMap.set(o.id, o);
        for (const c of contactRows) {
          if (!contactByDeal.has(c.dealId)) {
            contactByDeal.set(c.dealId, {
              id: c.contactId,
              name: c.contactName,
              phone: c.contactPhone ?? null,
            });
          }
        }
      }

      const nowMs = Date.now();
      const allQueueItems = openDeals
        .map((deal) => {
          const entered = enteredAtByDeal.get(deal.id) ?? {
            at: deal.createdAt,
            source: "deal_created_at" as const,
          };
          const waitMinutes = Math.max(0, Math.round((nowMs - entered.at.getTime()) / 60_000));
          const slaBreached = waitMinutes >= slaMinutes!;
          const op = deal.operatorId ? opMap.get(deal.operatorId) : undefined;
          const contact = contactByDeal.get(deal.id);
          return {
            dealId: deal.id,
            title: deal.title,
            value: deal.value !== null && deal.value !== undefined ? Number(deal.value) : 0,
            source: deal.source,
            campaign: deal.campaign,
            operatorId: deal.operatorId,
            operatorName: op?.name ?? null,
            operatorEmail: op?.email ?? null,
            contactId: contact?.id ?? null,
            contactName: contact?.name ?? null,
            contactPhone: contact?.phone ?? null,
            stageEnteredAt: entered.at.toISOString(),
            stageEnteredSource: entered.source,
            waitMinutes,
            slaMinutes: slaMinutes!,
            slaBreached,
            overdueByMinutes: slaBreached ? Math.max(0, waitMinutes - slaMinutes!) : 0,
            lastActivityAt: deal.lastActivityAt ? deal.lastActivityAt.toISOString() : null,
          };
        })
        .sort((a, b) => b.waitMinutes - a.waitMinutes);

      const breachedCount = allQueueItems.filter((i) => i.slaBreached).length;
      const filtered = onlyBreached ? allQueueItems.filter((i) => i.slaBreached) : allQueueItems;
      const sliced = filtered.slice(0, limit);

      return {
        tenantId,
        pipeline,
        stage: {
          id: stage.id,
          name: stage.name,
          orderIndex: stage.orderIndex,
        },
        slaMinutes,
        onlyBreached,
        totalOpenInStage: allQueueItems.length,
        breachedCount,
        withinSlaCount: allQueueItems.length - breachedCount,
        oldestWaitMinutes: allQueueItems[0]?.waitMinutes ?? 0,
        returnedCount: sliced.length,
        queue: sliced,
      };
    }

    // ── 5. GET DEAL AUDIT LOG (READ — ITEM 17 PARCIAL) ───────────────────────
    case "get_deal_audit_log": {
      await ensureAuditOriginSchema().catch(() => {});
      const dealId = asTrimmedString(args.dealId);
      if (!dealId) {
        throw new Error("Campo obrigatório: 'dealId'.");
      }

      const eventTypes = Array.isArray(args.eventTypes)
        ? args.eventTypes.map((e) => String(e || "").trim()).filter(Boolean)
        : [];
      const actorTypeFilter = args.actorType ? normalizeAuditActorType(args.actorType) : null;
      const sourceChannelFilter = args.sourceChannel ? normalizeAuditSourceChannel(args.sourceChannel) : null;
      const includeAdminActions = args.includeAdminActions !== false;
      const orderDir = args.order === "asc" ? "asc" : "desc";
      const limit = clampInt(args.limit, 100, 1, 300);
      const offset = clampInt(args.offset, 0, 0, 10_000);

      const [deal] = await db
        .select({
          id: crmDeals.id,
          title: crmDeals.title,
          status: crmDeals.status,
          pipelineId: crmDeals.pipelineId,
          stageId: crmDeals.stageId,
          lossReason: crmDeals.lossReason,
          pausedReason: crmDeals.pausedReason,
          createdAt: crmDeals.createdAt,
          updatedAt: crmDeals.updatedAt,
        })
        .from(crmDeals)
        .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, dealId)))
        .limit(1);

      const adminActionRows = includeAdminActions
        ? await db
            .select()
            .from(crmActionHistory)
            .where(
              and(
                eq(crmActionHistory.tenantId, tenantId),
                or(
                  eq(crmActionHistory.entityId, dealId),
                  sql`${crmActionHistory.details}::text LIKE ${`%${dealId}%`}`,
                ),
                actorTypeFilter ? eq(crmActionHistory.actorType, actorTypeFilter) : undefined,
                sourceChannelFilter ? eq(crmActionHistory.sourceChannel, sourceChannelFilter) : undefined,
              ),
            )
            .orderBy(orderDir === "asc" ? asc(crmActionHistory.createdAt) : desc(crmActionHistory.createdAt))
            .limit(100)
        : [];

      const matchingAdminActions = adminActionRows.filter((row) => {
        if (row.entityId === dealId) return true;
        const d = row.details as Record<string, unknown> | null;
        if (!d || typeof d !== "object") return false;
        if (d.dealId === dealId) return true;
        if (Array.isArray(d.dealIds) && d.dealIds.includes(dealId)) return true;
        if (Array.isArray(d.deals) && d.deals.some((x: any) => x?.id === dealId)) return true;
        return false;
      });

      if (!deal && matchingAdminActions.length === 0) {
        throw new Error(`Negociação '${dealId}' não encontrada no tenant '${tenantId}'.`);
      }

      const eventConditions = [
        eq(crmDealEvents.tenantId, tenantId),
        eq(crmDealEvents.dealId, dealId),
      ];
      if (eventTypes.length > 0) {
        eventConditions.push(inArray(crmDealEvents.eventType, eventTypes));
      }
      if (actorTypeFilter) {
        eventConditions.push(eq(crmDealEvents.actorType, actorTypeFilter));
      }
      if (sourceChannelFilter) {
        eventConditions.push(eq(crmDealEvents.sourceChannel, sourceChannelFilter));
      }

      const [countRow, rawEvents] = deal
        ? await Promise.all([
            db
              .select({ total: sql<number>`COUNT(*)::int` })
              .from(crmDealEvents)
              .where(and(...eventConditions)),
            db
              .select()
              .from(crmDealEvents)
              .where(and(...eventConditions))
              .orderBy(orderDir === "asc" ? asc(crmDealEvents.createdAt) : desc(crmDealEvents.createdAt))
              .limit(limit)
              .offset(offset),
          ])
        : [[{ total: 0 }], []];

      const totalEvents = Number(countRow[0]?.total ?? 0);

      const opIds = Array.from(
        new Set(rawEvents.map((e) => e.operatorId).filter((id): id is string => Boolean(id))),
      );
      const stageIds = Array.from(
        new Set(
          rawEvents
            .flatMap((e) => [e.fromStageId, e.toStageId])
            .filter((id): id is string => Boolean(id)),
        ),
      );

      const [opRows, stageRows] = await Promise.all([
        opIds.length > 0
          ? db
              .select({ id: operators.id, name: operators.name, email: operators.email })
              .from(operators)
              .where(and(eq(operators.tenantId, tenantId), inArray(operators.id, opIds)))
          : Promise.resolve([]),
        stageIds.length > 0
          ? db
              .select({ id: crmStages.id, name: crmStages.name })
              .from(crmStages)
              .where(and(eq(crmStages.tenantId, tenantId), inArray(crmStages.id, stageIds)))
          : Promise.resolve([]),
      ]);

      const opMap = new Map(opRows.map((o) => [o.id, o]));
      const stageMap = new Map(stageRows.map((s) => [s.id, s.name]));

      const events = rawEvents.map((ev) => {
        const meta =
          ev.metadata && typeof ev.metadata === "object" && !Array.isArray(ev.metadata)
            ? (ev.metadata as Record<string, unknown>)
            : {};
        const op = ev.operatorId ? opMap.get(ev.operatorId) : undefined;
        const origin = extractAuditOriginFromStoredRecord(
          {
            actorType: ev.actorType,
            sourceChannel: ev.sourceChannel,
            actorName: ev.actorName,
            clientIp: ev.clientIp,
            mcpKeyId: ev.mcpKeyId,
            mcpKeyLabel: ev.mcpKeyLabel,
            operatorId: ev.operatorId,
            operatorName: op?.name ?? null,
            metadata: meta,
          },
          tenantId,
        );
        const lossReason =
          typeof meta.lossReason === "string"
            ? meta.lossReason
            : ev.toStatus === "lost"
              ? (deal?.lossReason ?? null)
              : null;

        return {
          id: ev.id,
          eventType: ev.eventType,
          createdAt: ev.createdAt.toISOString(),
          createdAtBrt: formatAuditTimestampBrt(ev.createdAt),
          actorType: origin.actorType,
          actorTypeLabel: origin.actorTypeLabel,
          sourceChannel: origin.sourceChannel,
          sourceChannelLabel: origin.sourceChannelLabel,
          actorName: origin.actorName,
          clientIp: origin.clientIp,
          mcpKeyId: origin.mcpKeyId,
          mcpKeyLabel: origin.mcpKeyLabel,
          operatorId: ev.operatorId,
          operatorName: origin.sourceChannel === "mcp" ? origin.actorName : (op?.name ?? origin.actorName),
          operatorEmail: op?.email ?? null,
          fromStageId: ev.fromStageId,
          fromStageName: ev.fromStageId ? (stageMap.get(ev.fromStageId) ?? null) : null,
          toStageId: ev.toStageId,
          toStageName: ev.toStageId ? (stageMap.get(ev.toStageId) ?? null) : null,
          fromStatus: ev.fromStatus,
          toStatus: ev.toStatus,
          lossReason,
          metadata: meta,
        };
      });

      return {
        tenantId,
        dealId,
        dealExists: Boolean(deal),
        dealTitle: deal?.title ?? null,
        currentStatus: deal?.status ?? null,
        currentPipelineId: deal?.pipelineId ?? null,
        currentStageId: deal?.stageId ?? null,
        currentLossReason: deal?.lossReason ?? null,
        currentPausedReason: deal?.pausedReason ?? null,
        order: orderDir,
        limit,
        offset,
        totalEvents,
        returnedEvents: events.length,
        events,
        adminActionsCount: matchingAdminActions.length,
        adminActions: matchingAdminActions.map((a) => {
          const origin = extractAuditOriginFromStoredRecord(
            {
              actorType: a.actorType,
              sourceChannel: a.sourceChannel,
              clientIp: a.clientIp,
              mcpKeyId: a.mcpKeyId,
              mcpKeyLabel: a.mcpKeyLabel,
              operatorId: a.operatorId,
              operatorName: a.operatorName,
              details: a.details as Record<string, unknown>,
            },
            tenantId,
          );
          return {
            id: a.id,
            action: a.action,
            entityType: a.entityType,
            entityId: a.entityId ?? null,
            actorType: origin.actorType,
            actorTypeLabel: origin.actorTypeLabel,
            sourceChannel: origin.sourceChannel,
            sourceChannelLabel: origin.sourceChannelLabel,
            actorName: origin.actorName || a.operatorName,
            clientIp: origin.clientIp,
            mcpKeyId: origin.mcpKeyId,
            mcpKeyLabel: origin.mcpKeyLabel,
            operatorId: a.operatorId,
            operatorName: a.operatorName,
            createdAt: a.createdAt.toISOString(),
            createdAtBrt: formatAuditTimestampBrt(a.createdAt),
            details: a.details,
          };
        }),
      };
    }

    // ── 6. SEARCH CRM AUDIT LOGS (READ — AUDITORIA UNIFICADA 6 ENTIDADES) ────
    case "search_crm_audit_logs": {
      await ensureAuditOriginSchema().catch(() => {});
      const entityType = asTrimmedString(args.entityType);
      const entityId = asTrimmedString(args.entityId);
      const action = asTrimmedString(args.action);
      const actorType = args.actorType ? normalizeAuditActorType(args.actorType) : null;
      const sourceChannel = args.sourceChannel ? normalizeAuditSourceChannel(args.sourceChannel) : null;
      const operatorId = asTrimmedString(args.operatorId);
      const clientIp = asTrimmedString(args.clientIp);
      const search = asTrimmedString(args.search);
      const startDateRaw = asTrimmedString(args.startDate);
      const endDateRaw = asTrimmedString(args.endDate);
      const orderDir = args.order === "asc" ? "asc" : "desc";
      const limit = clampInt(args.limit, 50, 1, 200);
      const offset = clampInt(args.offset, 0, 0, 50_000);

      let startDate: Date | undefined;
      if (startDateRaw) {
        const parsed = new Date(startDateRaw.includes("T") ? startDateRaw : `${startDateRaw}T00:00:00-03:00`);
        if (Number.isNaN(parsed.getTime())) {
          throw new Error(`Data inválida em 'startDate': '${startDateRaw}'.`);
        }
        startDate = parsed;
      }

      let endDate: Date | undefined;
      if (endDateRaw) {
        const parsed = new Date(endDateRaw.includes("T") ? endDateRaw : `${endDateRaw}T23:59:59.999-03:00`);
        if (Number.isNaN(parsed.getTime())) {
          throw new Error(`Data inválida em 'endDate': '${endDateRaw}'.`);
        }
        endDate = parsed;
      }

      const conditions = [eq(crmActionHistory.tenantId, tenantId)];
      if (entityType) conditions.push(eq(crmActionHistory.entityType, entityType));
      if (entityId) {
        conditions.push(
          or(
            eq(crmActionHistory.entityId, entityId),
            sql`CAST(${crmActionHistory.details} AS text) ILIKE ${`%${entityId}%`}`,
          )!,
        );
      }
      if (action) conditions.push(eq(crmActionHistory.action, action));
      if (actorType) conditions.push(eq(crmActionHistory.actorType, actorType));
      if (sourceChannel) conditions.push(eq(crmActionHistory.sourceChannel, sourceChannel));
      if (operatorId) conditions.push(eq(crmActionHistory.operatorId, operatorId));
      if (clientIp) conditions.push(ilike(crmActionHistory.clientIp, `%${clientIp}%`));
      if (startDate) conditions.push(gte(crmActionHistory.createdAt, startDate));
      if (endDate) conditions.push(lte(crmActionHistory.createdAt, endDate));
      if (search) {
        const pattern = `%${search}%`;
        conditions.push(
          or(
            ilike(crmActionHistory.operatorName, pattern),
            ilike(crmActionHistory.action, pattern),
            ilike(crmActionHistory.entityType, pattern),
            ilike(crmActionHistory.entityId, pattern),
            ilike(crmActionHistory.clientIp, pattern),
            ilike(crmActionHistory.mcpKeyLabel, pattern),
            sql`CAST(${crmActionHistory.details} AS text) ILIKE ${pattern}`,
          )!,
        );
      }

      const rows = await db
        .select()
        .from(crmActionHistory)
        .where(and(...conditions))
        .orderBy(orderDir === "asc" ? asc(crmActionHistory.createdAt) : desc(crmActionHistory.createdAt))
        .limit(limit + 1)
        .offset(offset);

      const hasMore = rows.length > limit;
      const entries = rows.slice(0, limit).map((row) => {
        const origin = extractAuditOriginFromStoredRecord(
          {
            actorType: row.actorType,
            sourceChannel: row.sourceChannel,
            clientIp: row.clientIp,
            mcpKeyId: row.mcpKeyId,
            mcpKeyLabel: row.mcpKeyLabel,
            operatorId: row.operatorId,
            operatorName: row.operatorName,
            details: row.details as Record<string, unknown>,
          },
          tenantId,
        );
        return {
          id: row.id,
          entityType: row.entityType,
          entityId: row.entityId ?? null,
          action: row.action,
          itemCount: row.itemCount,
          actorType: origin.actorType,
          actorTypeLabel: origin.actorTypeLabel,
          sourceChannel: origin.sourceChannel,
          sourceChannelLabel: origin.sourceChannelLabel,
          actorName: origin.actorName || row.operatorName,
          operatorId: row.operatorId,
          clientIp: origin.clientIp,
          mcpKeyId: origin.mcpKeyId,
          mcpKeyLabel: origin.mcpKeyLabel,
          createdAt: row.createdAt.toISOString(),
          createdAtBrt: formatAuditTimestampBrt(row.createdAt),
          details: row.details,
        };
      });

      return {
        tenantId,
        filters: {
          entityType: entityType ?? null,
          entityId: entityId ?? null,
          action: action ?? null,
          actorType: actorType ?? null,
          sourceChannel: sourceChannel ?? null,
          operatorId: operatorId ?? null,
          clientIp: clientIp ?? null,
          startDate: startDate?.toISOString() ?? null,
          endDate: endDate?.toISOString() ?? null,
        },
        order: orderDir,
        limit,
        offset,
        returnedEntries: entries.length,
        hasMore,
        entries,
      };
    }

    default:
      throw new Error(`Ferramenta Onda 1 desconhecida: '${name}'.`);
  }
}
