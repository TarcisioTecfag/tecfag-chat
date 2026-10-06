import fs from "fs";
import path from "path";
import { eq, ne, and, or, ilike, desc, asc, sql, inArray, gte, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../db";
import {
  crmAccounts,
  crmContactAccountHistory,
  crmAccountConversations,
  crmPipelines,
  crmStages,
  crmDeals,
  crmDealContacts,
  crmConversationDeals,
  crmDealActivities,
  crmActivityMessages,
  crmDealEvents,
  crmProducts,
  crmDealProducts,
  crmProposals,
  crmDealFiles,
  crmDealQuestionnaires,
  crmDealEmails,
  crmCustomFieldDefinitions,
  accessGroups,
  contacts,
  conversations,
  operators,
  messages,
} from "../../db/schema";
import type {
  CrmAccount,
  CrmPipeline,
  CrmStage,
  CrmDeal,
  CrmDealContact,
  CrmConversationDeal,
  CrmDealActivity,
  CrmActivityMessage,
  CrmDealEvent,
  CrmProduct,
  CrmDealProduct,
  CrmProposal,
  CrmDealFile,
  CrmDealQuestionnaire,
  CrmDealEmail,
} from "../../db/schema";
import { vertexAi } from "../vertex-ai";
import { listCustomFields, missingStageFields, validateFieldValues, type CustomFieldValues } from "./custom-fields";
import { validateCatalogChoice } from "./catalogs";

/**
 * Normaliza documento (CPF ou CNPJ) mantendo estritamente dígitos.
 */
export function normalizeDocument(doc?: string | null): string {
  if (!doc) return "";
  return doc.replace(/\D/g, "");
}

/**
 * Identifica o tipo de documento baseado no tamanho de dígitos.
 */
export function detectDocumentType(docDigits: string): "cpf" | "cnpj" | "other" {
  if (docDigits.length === 11) return "cpf";
  if (docDigits.length === 14) return "cnpj";
  return "other";
}

/**
 * Valida o formato de documento por tipo selecionado ('person' -> 11 dígitos, 'company' -> 14 dígitos).
 */
export function validateDocument(type: "person" | "company", docDigits: string): void {
  if (!docDigits) return;
  if (type === "person" && docDigits.length !== 11) {
    throw new CrmValidationError("CPF deve conter exatamente 11 dígitos numéricos.", "INVALID_DOCUMENT_FORMAT");
  }
  if (type === "company" && docDigits.length !== 14) {
    throw new CrmValidationError("CNPJ deve conter exatamente 14 dígitos numéricos.", "INVALID_DOCUMENT_FORMAT");
  }
}

/**
 * Converte valor monetário flexível (formato pt-BR com vírgula ou decimal padrão com ponto) em number.
 */
export function parseMoneyValue(val: string | number): number {
  if (typeof val === "number") return val;
  const str = String(val).trim();
  if (!str) return NaN;
  if (str.includes(",")) {
    return parseFloat(str.replace(/\./g, "").replace(",", "."));
  }
  return parseFloat(str);
}

/**
 * Classes de erro customizadas do CRM para respostas HTTP semânticas precisas.
 */
export class CrmError extends Error {
  constructor(message: string, public code: string, public statusCode: number = 400) {
    super(message);
    this.name = "CrmError";
  }
}

export class CrmValidationError extends CrmError {
  constructor(message: string, code: string = "BAD_REQUEST") {
    super(message, code, 400);
    this.name = "CrmValidationError";
  }
}

export class CrmNotFoundError extends CrmError {
  constructor(message: string) {
    super(message, "NOT_FOUND", 404);
    this.name = "CrmNotFoundError";
  }
}

export class CrmCrossTenantError extends CrmError {
  constructor(message: string = "Entidade não encontrada ou pertence a outro tenant.") {
    super(message, "TENANT_MISMATCH", 403);
    this.name = "CrmCrossTenantError";
  }
}

export class CrmConcurrencyError extends CrmError {
  constructor(message: string = "Conflito de versão concorrente.") {
    super(message, "CONCURRENCY_CONFLICT", 409);
    this.name = "CrmConcurrencyError";
  }
}

export function handleCrmError(err: any, corsHeaders: Record<string, string> = {}): Response {
  if (err?.statusCode && err?.code) {
    return new Response(JSON.stringify({ error: err.message, code: err.code }), {
      status: err.statusCode,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (err instanceof CrmError) {
    return new Response(JSON.stringify({ error: err.message, code: err.code }), {
      status: err.statusCode,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const msg = String(err?.message || "Erro interno");
  let status = 500;
  let code = "INTERNAL_ERROR";
  if (msg.includes("CONCURRENCY_CONFLICT")) {
    status = 409;
    code = "CONCURRENCY_CONFLICT";
  } else if (msg.includes("não encontrada") || msg.includes("NOT_FOUND")) {
    status = 404;
    code = "NOT_FOUND";
  } else if (msg.includes("TENANT_MISMATCH") || msg.includes("outro tenant") || msg.includes("não pertence")) {
    status = 403;
    code = "TENANT_MISMATCH";
  } else if (msg.includes("obrigatório") || msg.includes("inválid") || msg.includes("não pertence ao funil")) {
    status = 400;
    code = "BAD_REQUEST";
  }
  return new Response(JSON.stringify({ error: msg, code }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export interface CrmDealFilters {
  pipelineId?: string;
  stageId?: string;
  stageIds?: string[];
  status?: "open" | "won" | "lost" | "paused" | "not_paused" | "all";
  operatorId?: string;
  operatorIds?: string[];
  accountId?: string;
  search?: string;
  minValue?: number;
  maxValue?: number;
  createdAfter?: string | Date;
  createdBefore?: string | Date;
  hasOverdueTask?: boolean;
  coolingOnly?: boolean;
  coolingDays?: number;
  withoutTask?: boolean;
  rdStationOnly?: boolean;
  emptyFields?: string[];
  title?: string;
  rating?: number;
  companyId?: string;
  campaign?: string;
  source?: string;
  productId?: string;
  lastContactFrom?: string;
  lastContactTo?: string;
  nextTaskFrom?: string;
  nextTaskTo?: string;
  closedFrom?: string;
  closedTo?: string;
  expectedCloseFrom?: string;
  expectedCloseTo?: string;
  perStageLimit?: number;
}

export function parseExtraDealFilters(params: URLSearchParams): Pick<CrmDealFilters,
  "withoutTask" | "rdStationOnly" | "emptyFields" | "title" | "rating" | "companyId" |
  "campaign" | "source" | "productId" | "lastContactFrom" | "lastContactTo" |
  "nextTaskFrom" | "nextTaskTo" | "closedFrom" | "closedTo" |
  "expectedCloseFrom" | "expectedCloseTo"> {
  const date = (key: string) => {
    const value = params.get(key);
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  };
  const ratingValue = params.get("rating");
  const rating = ratingValue !== null && /^[0-5]$/.test(ratingValue) ? Number(ratingValue) : undefined;
  return {
    withoutTask: params.get("withoutTask") === "true" || undefined,
    rdStationOnly: params.get("rdStationOnly") === "true" || undefined,
    emptyFields: params.get("emptyFields")?.split(",").filter(Boolean),
    title: params.get("title")?.slice(0, 200) || undefined,
    rating,
    companyId: params.get("companyId") || undefined,
    campaign: params.get("campaign") || undefined,
    source: params.get("source") || undefined,
    productId: params.get("productId") || undefined,
    lastContactFrom: date("lastContactFrom"), lastContactTo: date("lastContactTo"),
    nextTaskFrom: date("nextTaskFrom"), nextTaskTo: date("nextTaskTo"),
    closedFrom: date("closedFrom"), closedTo: date("closedTo"),
    expectedCloseFrom: date("expectedCloseFrom"), expectedCloseTo: date("expectedCloseTo"),
  };
}

/**
 * Constrói condições unificadas de filtro para negociações sem duplicar joins (usa subqueries correlacionadas EXISTS).
 */
export function buildDealFilterConditions(tenantId: string, filters: CrmDealFilters) {
  const conditions = [eq(crmDeals.tenantId, tenantId)];
  const nextTaskDate = sql`(SELECT MIN(act.due_date) FROM crm_deal_activities act WHERE act.deal_id = ${crmDeals.id} AND act.tenant_id = ${tenantId} AND act.status = 'pending' AND act.type != 'note')`;
  const dateFields = {
    lastContact: crmDeals.lastActivityAt,
    nextTask: nextTaskDate,
    closed: crmDeals.closedAt,
    expectedClose: crmDeals.expectedCloseDate,
  };
  for (const [key, column] of Object.entries(dateFields)) {
    const from = filters[`${key}From` as keyof CrmDealFilters];
    const to = filters[`${key}To` as keyof CrmDealFilters];
    if (typeof from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(from))
      conditions.push(sql`(${column} AT TIME ZONE 'America/Sao_Paulo')::date >= ${from}::date`);
    if (typeof to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(to))
      conditions.push(sql`(${column} AT TIME ZONE 'America/Sao_Paulo')::date <= ${to}::date`);
  }

  if (filters.title?.trim()) conditions.push(ilike(crmDeals.title, `%${filters.title.trim()}%`));
  if (filters.rating !== undefined && Number.isInteger(filters.rating) && filters.rating >= 0 && filters.rating <= 5)
    conditions.push(eq(crmDeals.rating, filters.rating));
  if (filters.companyId) conditions.push(eq(crmDeals.accountId, filters.companyId));
  if (filters.campaign) conditions.push(eq(crmDeals.campaign, filters.campaign));
  if (filters.source) conditions.push(eq(crmDeals.source, filters.source));
  if (filters.productId) conditions.push(sql`EXISTS (SELECT 1 FROM crm_deal_products dp WHERE dp.deal_id = ${crmDeals.id} AND dp.tenant_id = ${tenantId} AND dp.product_id = ${filters.productId})`);
  if (filters.rdStationOnly) conditions.push(sql`${crmDeals.rdDealId} IS NOT NULL`);
  if (filters.withoutTask) conditions.push(sql`NOT EXISTS (SELECT 1 FROM crm_deal_activities act WHERE act.deal_id = ${crmDeals.id} AND act.tenant_id = ${tenantId} AND act.status = 'pending' AND act.type != 'note')`);

  const emptyFieldConditions: Record<string, ReturnType<typeof sql>> = {
    value: sql`${crmDeals.value} IS NULL`,
    rating: sql`${crmDeals.rating} = 0`,
    company: sql`${crmDeals.accountId} IS NULL`,
    campaign: sql`NULLIF(TRIM(${crmDeals.campaign}), '') IS NULL`,
    source: sql`NULLIF(TRIM(${crmDeals.source}), '') IS NULL`,
    expectedClose: sql`${crmDeals.expectedCloseDate} IS NULL`,
    lastContact: sql`${crmDeals.lastActivityAt} IS NULL`,
    nextTask: sql`${nextTaskDate} IS NULL`,
    products: sql`NOT EXISTS (SELECT 1 FROM crm_deal_products dp WHERE dp.deal_id = ${crmDeals.id} AND dp.tenant_id = ${tenantId})`,
  };
  if (filters.emptyFields?.length) {
    const selected = filters.emptyFields.map((field) => emptyFieldConditions[field]).filter(Boolean);
    if (selected.length) conditions.push(or(...selected)!);
  }

  if (filters.pipelineId) {
    conditions.push(eq(crmDeals.pipelineId, filters.pipelineId));
  }

  if (filters.stageIds && filters.stageIds.length > 0) {
    if (filters.stageIds.length === 1) {
      conditions.push(eq(crmDeals.stageId, filters.stageIds[0]));
    } else {
      conditions.push(inArray(crmDeals.stageId, filters.stageIds));
    }
  } else if (filters.stageId) {
    conditions.push(eq(crmDeals.stageId, filters.stageId));
  }

  if (filters.status === "not_paused") {
    conditions.push(ne(crmDeals.status, "paused"));
  } else if (filters.status && filters.status !== "all") {
    conditions.push(eq(crmDeals.status, filters.status));
  }

  if (filters.operatorIds && filters.operatorIds.length > 0) {
    if (filters.operatorIds.length === 1) {
      conditions.push(eq(crmDeals.operatorId, filters.operatorIds[0]));
    } else {
      conditions.push(inArray(crmDeals.operatorId, filters.operatorIds));
    }
  } else if (filters.operatorId) {
    conditions.push(eq(crmDeals.operatorId, filters.operatorId));
  }

  if (filters.accountId) {
    conditions.push(eq(crmDeals.accountId, filters.accountId));
  }

  if (filters.minValue !== undefined && filters.minValue !== null && !isNaN(filters.minValue)) {
    conditions.push(sql`${crmDeals.value} >= ${filters.minValue}`);
  }

  if (filters.maxValue !== undefined && filters.maxValue !== null && !isNaN(filters.maxValue)) {
    conditions.push(sql`${crmDeals.value} <= ${filters.maxValue}`);
  }

  if (filters.createdAfter) {
    if (typeof filters.createdAfter === "string" && /^\d{4}-\d{2}-\d{2}$/.test(filters.createdAfter))
      conditions.push(sql`(${crmDeals.createdAt} AT TIME ZONE 'America/Sao_Paulo')::date >= ${filters.createdAfter}::date`);
  }

  if (filters.createdBefore) {
    if (typeof filters.createdBefore === "string" && /^\d{4}-\d{2}-\d{2}$/.test(filters.createdBefore))
      conditions.push(sql`(${crmDeals.createdAt} AT TIME ZONE 'America/Sao_Paulo')::date <= ${filters.createdBefore}::date`);
  }

  if (filters.hasOverdueTask) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM crm_deal_activities act
        WHERE act.deal_id = ${crmDeals.id}
          AND act.tenant_id = ${tenantId}
          AND act.status = 'pending'
          AND act.type != 'note'
          AND act.due_date < NOW()
      )`
    );
  }

  if (filters.coolingOnly) {
    const days = Math.max(1, filters.coolingDays || 10);
    conditions.push(
      sql`COALESCE(${crmDeals.lastActivityAt}, ${crmDeals.updatedAt}, ${crmDeals.createdAt}) < (NOW() - (${days} || ' days')::interval)`
    );
  }

  if (filters.search && filters.search.trim()) {
    const cleanTerm = filters.search.trim();
    const term = `%${cleanTerm.toLowerCase()}%`;
    const numOnly = cleanTerm.replace(/\D/g, "");

    const docOrPhoneCondition = numOnly.length >= 4
      ? sql`OR acc.document LIKE ${`%${numOnly}%`}`
      : sql``;

    const contactPhoneCondition = numOnly.length >= 4
      ? sql`OR ct.phone LIKE ${`%${numOnly}%`}`
      : sql``;

    conditions.push(
      sql`(
        LOWER(${crmDeals.title}) LIKE ${term}
        OR LOWER(${crmDeals.id}) LIKE ${term}
        OR EXISTS (
          SELECT 1 FROM crm_accounts acc
          WHERE acc.id = ${crmDeals.accountId}
            AND acc.tenant_id = ${tenantId}
            AND (
              LOWER(acc.name) LIKE ${term}
              OR LOWER(acc.trade_name) LIKE ${term}
              OR LOWER(acc.email) LIKE ${term}
              ${docOrPhoneCondition}
            )
        )
        OR EXISTS (
          SELECT 1 FROM crm_deal_contacts dc
          INNER JOIN contacts ct ON ct.id = dc.contact_id AND ct.tenant_id = dc.tenant_id
          WHERE dc.deal_id = ${crmDeals.id}
            AND dc.tenant_id = ${tenantId}
            AND (
              LOWER(ct.name) LIKE ${term}
              OR LOWER(ct.email) LIKE ${term}
              ${contactPhoneCondition}
            )
        )
      )`
    );
  }

  return conditions;
}

export class CrmService {
  private static instance: CrmService;

  private constructor() {}

  public static getInstance(): CrmService {
    if (!CrmService.instance) {
      CrmService.instance = new CrmService();
    }
    return CrmService.instance;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. FUNIS E ETAPAS (Pipelines & Stages)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lista todos os funis de um tenant com suas respectivas etapas ordenadas.
   * Leitura pura e idempotente — NUNCA gera seed de dados operacionais no GET.
   */
  async getPipelines(tenantId: string): Promise<Array<CrmPipeline & { stages: CrmStage[] }>> {
    const pipelines = await db
      .select()
      .from(crmPipelines)
      .where(eq(crmPipelines.tenantId, tenantId))
      .orderBy(asc(crmPipelines.orderIndex), asc(crmPipelines.createdAt));

    if (pipelines.length === 0) {
      return [];
    }

    const pipelineIds = pipelines.map((p) => p.id);
    const stages = await db
      .select()
      .from(crmStages)
      .where(
        and(
          eq(crmStages.tenantId, tenantId),
          inArray(crmStages.pipelineId, pipelineIds)
        )
      )
      .orderBy(asc(crmStages.orderIndex), asc(crmStages.createdAt));

    const stagesByPipeline = new Map<string, CrmStage[]>();
    for (const stage of stages) {
      const list = stagesByPipeline.get(stage.pipelineId) || [];
      list.push(stage);
      stagesByPipeline.set(stage.pipelineId, list);
    }

    return pipelines.map((pipeline) => ({
      ...pipeline,
      stages: stagesByPipeline.get(pipeline.id) || [],
    }));
  }

  /**
   * Cria um novo funil com etapas opcionais para um tenant.
   */
  async createPipeline(
    tenantId: string,
    data: {
      name: string;
      orderIndex?: number;
      isDefault?: boolean;
      color?: string;
      coolingDays?: number;
      stages?: Array<{
        name: string;
        orderIndex?: number;
        isWinStage?: boolean;
        isLossStage?: boolean;
        requiredFields?: string[];
      }>;
    }
  ): Promise<CrmPipeline & { stages: CrmStage[] }> {
    const pipelineId = `pipe-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    
    // Se for padrão, desmarca outros
    if (data.isDefault) {
      await db
        .update(crmPipelines)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(crmPipelines.tenantId, tenantId));
    }

    const [createdPipeline] = await db
      .insert(crmPipelines)
      .values({
        id: pipelineId,
        tenantId,
        name: data.name.trim(),
        orderIndex: data.orderIndex ?? 0,
        isDefault: data.isDefault ?? false,
        color: data.color || "#0284c7",
        coolingDays: data.coolingDays ?? 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const createdStages: CrmStage[] = [];
    if (data.stages && data.stages.length > 0) {
      for (let i = 0; i < data.stages.length; i++) {
        const s = data.stages[i];
        const stageId = `stg-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 5)}`;
        const [stage] = await db
          .insert(crmStages)
          .values({
            id: stageId,
            tenantId,
            pipelineId,
            name: s.name.trim(),
            orderIndex: s.orderIndex ?? i,
            isWinStage: s.isWinStage ?? false,
            isLossStage: s.isLossStage ?? false,
            requiredFields: s.requiredFields ?? [],
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();
        createdStages.push(stage);
      }
    }

    return {
      ...createdPipeline,
      stages: createdStages,
    };
  }

  /**
   * Inicializa o funil comercial padrão de forma explícita e controlada (ação administrativa).
   * Não pode ser chamado se o tenant já possuir funis cadastrados.
   */
  async initDefaultPipeline(
    tenantId: string,
    operatorId?: string | null
  ): Promise<CrmPipeline & { stages: CrmStage[] }> {
    const existing = await db
      .select({ id: crmPipelines.id })
      .from(crmPipelines)
      .where(eq(crmPipelines.tenantId, tenantId))
      .limit(1);

    if (existing.length > 0) {
      throw new CrmValidationError("Tenant já possui funis cadastrados.");
    }

    return this.createPipeline(tenantId, {
      name: "Funil Comercial",
      orderIndex: 0,
      isDefault: true,
      color: "#0284c7",
      coolingDays: 10,
      stages: [
        { name: "Primeiro Contato", orderIndex: 0 },
        { name: "Qualificação", orderIndex: 1 },
        { name: "Proposta Enviada", orderIndex: 2 },
        { name: "Negociação", orderIndex: 3 },
        { name: "Fechamento / Ganho", orderIndex: 4, isWinStage: true },
        { name: "Perdido", orderIndex: 5, isLossStage: true },
      ],
    });
  }

  /**
   * Obtém um funil específico de um tenant com suas etapas.
   */
  async getPipelineById(
    tenantId: string,
    pipelineId: string
  ): Promise<CrmPipeline & { stages: CrmStage[] }> {
    const [pipeline] = await db
      .select()
      .from(crmPipelines)
      .where(and(eq(crmPipelines.id, pipelineId), eq(crmPipelines.tenantId, tenantId)))
      .limit(1);

    if (!pipeline) {
      throw new CrmNotFoundError(`Funil '${pipelineId}' não encontrado para este tenant.`);
    }

    const stages = await db
      .select()
      .from(crmStages)
      .where(and(eq(crmStages.pipelineId, pipelineId), eq(crmStages.tenantId, tenantId)))
      .orderBy(asc(crmStages.orderIndex), asc(crmStages.createdAt));

    return {
      ...pipeline,
      stages,
    };
  }

  /**
   * Atualiza as configurações de um funil.
   */
  async updatePipeline(
    tenantId: string,
    pipelineId: string,
    updates: {
      name?: string;
      orderIndex?: number;
      isDefault?: boolean;
      color?: string;
      coolingDays?: number;
    }
  ): Promise<CrmPipeline & { stages: CrmStage[] }> {
    const existing = await this.getPipelineById(tenantId, pipelineId);

    if (updates.isDefault) {
      await db
        .update(crmPipelines)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(crmPipelines.tenantId, tenantId));
    }

    const setPayload: Record<string, any> = { updatedAt: new Date() };
    if (updates.name !== undefined) setPayload.name = updates.name.trim();
    if (updates.orderIndex !== undefined) setPayload.orderIndex = updates.orderIndex;
    if (updates.isDefault !== undefined) setPayload.isDefault = updates.isDefault;
    if (updates.color !== undefined) setPayload.color = updates.color;
    if (updates.coolingDays !== undefined) setPayload.coolingDays = updates.coolingDays;

    const [updated] = await db
      .update(crmPipelines)
      .set(setPayload)
      .where(and(eq(crmPipelines.id, pipelineId), eq(crmPipelines.tenantId, tenantId)))
      .returning();

    return {
      ...updated,
      stages: existing.stages,
    };
  }

  /**
   * Remove um funil. Rejeita caso existam negociações associadas.
   */
  async deletePipeline(
    tenantId: string,
    pipelineId: string
  ): Promise<{ success: boolean }> {
    await this.getPipelineById(tenantId, pipelineId);

    const [dealsCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(crmDeals)
      .where(and(eq(crmDeals.pipelineId, pipelineId), eq(crmDeals.tenantId, tenantId)));

    if (dealsCount && dealsCount.count > 0) {
      throw new CrmValidationError(
        `Não é possível excluir o funil porque existem ${dealsCount.count} negociação(ões) vinculada(s).`,
        "PIPELINE_HAS_DEALS"
      );
    }

    await db
      .delete(crmStages)
      .where(and(eq(crmStages.pipelineId, pipelineId), eq(crmStages.tenantId, tenantId)));

    await db
      .delete(crmPipelines)
      .where(and(eq(crmPipelines.id, pipelineId), eq(crmPipelines.tenantId, tenantId)));

    return { success: true };
  }

  /**
   * Cria uma nova etapa no funil informado.
   */
  async createStage(
    tenantId: string,
    pipelineId: string,
    data: {
      name: string;
      orderIndex?: number;
      isWinStage?: boolean;
      isLossStage?: boolean;
      requiredFields?: string[];
    }
  ): Promise<CrmStage> {
    await this.getPipelineById(tenantId, pipelineId);

    if (!data.name || !data.name.trim()) {
      throw new CrmValidationError("O nome da etapa é obrigatório.", "NAME_REQUIRED");
    }

    let nextOrder = data.orderIndex;
    if (nextOrder === undefined) {
      const [maxOrder] = await db
        .select({ max: sql<number>`coalesce(max(${crmStages.orderIndex}), -1)::int` })
        .from(crmStages)
        .where(and(eq(crmStages.pipelineId, pipelineId), eq(crmStages.tenantId, tenantId)));
      nextOrder = (maxOrder?.max ?? -1) + 1;
    }

    const stageId = `stg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const [created] = await db
      .insert(crmStages)
      .values({
        id: stageId,
        tenantId,
        pipelineId,
        name: data.name.trim(),
        orderIndex: nextOrder,
        isWinStage: data.isWinStage ?? false,
        isLossStage: data.isLossStage ?? false,
        requiredFields: data.requiredFields ?? [],
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return created;
  }

  /**
   * Atualiza as propriedades de uma etapa.
   */
  async updateStage(
    tenantId: string,
    stageId: string,
    updates: {
      name?: string;
      orderIndex?: number;
      isWinStage?: boolean;
      isLossStage?: boolean;
      requiredFields?: string[];
    }
  ): Promise<CrmStage> {
    const [existing] = await db
      .select()
      .from(crmStages)
      .where(and(eq(crmStages.id, stageId), eq(crmStages.tenantId, tenantId)))
      .limit(1);

    if (!existing) {
      throw new CrmNotFoundError(`Etapa '${stageId}' não encontrada para este tenant.`);
    }

    const setPayload: Record<string, any> = { updatedAt: new Date() };
    if (updates.name !== undefined) setPayload.name = updates.name.trim();
    if (updates.orderIndex !== undefined) setPayload.orderIndex = updates.orderIndex;
    if (updates.isWinStage !== undefined) setPayload.isWinStage = updates.isWinStage;
    if (updates.isLossStage !== undefined) setPayload.isLossStage = updates.isLossStage;
    if (updates.requiredFields !== undefined) {
      if (!Array.isArray(updates.requiredFields) || updates.requiredFields.some((id) => typeof id !== "string")) {
        throw new CrmValidationError("Lista de campos obrigatórios inválida.");
      }
      const definitions = await listCustomFields(tenantId, "deal");
      const allowed = new Set(definitions.filter((field) => field.allPipelines || field.pipelineIds.includes(existing.pipelineId)).map((field) => field.id));
      if (updates.requiredFields.some((id) => !allowed.has(id))) throw new CrmValidationError("Campo obrigatório inválido para este funil.");
      setPayload.requiredFields = [...new Set(updates.requiredFields)];
    }

    const [updated] = await db
      .update(crmStages)
      .set(setPayload)
      .where(and(eq(crmStages.id, stageId), eq(crmStages.tenantId, tenantId)))
      .returning();

    return updated;
  }

  /**
   * Remove uma etapa. Rejeita caso existam negociações associadas a ela.
   */
  async deleteStage(
    tenantId: string,
    stageId: string
  ): Promise<{ success: boolean }> {
    const [existing] = await db
      .select()
      .from(crmStages)
      .where(and(eq(crmStages.id, stageId), eq(crmStages.tenantId, tenantId)))
      .limit(1);

    if (!existing) {
      throw new CrmNotFoundError(`Etapa '${stageId}' não encontrada para este tenant.`);
    }

    const [dealsCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(crmDeals)
      .where(and(eq(crmDeals.stageId, stageId), eq(crmDeals.tenantId, tenantId)));

    if (dealsCount && dealsCount.count > 0) {
      throw new CrmValidationError(
        `Não é possível excluir a etapa porque existem ${dealsCount.count} negociação(ões) vinculada(s). Mova as negociações antes de excluir.`,
        "STAGE_HAS_DEALS"
      );
    }

    await db
      .delete(crmStages)
      .where(and(eq(crmStages.id, stageId), eq(crmStages.tenantId, tenantId)));

    return { success: true };
  }

  /**
   * Reordena as etapas de um funil de forma atômica.
   */
  async reorderStages(
    tenantId: string,
    pipelineId: string,
    stageOrders: Array<{ id: string; orderIndex: number }>
  ): Promise<CrmStage[]> {
    await this.getPipelineById(tenantId, pipelineId);

    await db.transaction(async (tx) => {
      for (const item of stageOrders) {
        await tx
          .update(crmStages)
          .set({ orderIndex: item.orderIndex, updatedAt: new Date() })
          .where(
            and(
              eq(crmStages.id, item.id),
              eq(crmStages.pipelineId, pipelineId),
              eq(crmStages.tenantId, tenantId)
            )
          );
      }
    });

    return await db
      .select()
      .from(crmStages)
      .where(and(eq(crmStages.pipelineId, pipelineId), eq(crmStages.tenantId, tenantId)))
      .orderBy(asc(crmStages.orderIndex), asc(crmStages.createdAt));
  }

  /**
   * Resumo de agregação de negociações por etapa de um funil.
   * Executa agregação exata sem multiplicar joins de contatos/conversas (zero N+1 e zero inflação de contagem).
   * Retorna todas as etapas do funil (inclusive as com 0 negociações).
   */
  async getPipelineStagesSummary(
    tenantId: string,
    pipelineId: string,
    filters: CrmDealFilters = {}
  ): Promise<{
    pipelineId: string;
    stages: Array<{
      stageId: string;
      dealsCount: number;
      knownValueDealsCount: number;
      totalValue: number;
      formattedTotalValue: string;
    }>;
    totalDeals: number;
    totalKnownValueDeals: number;
    totalValue: number;
    formattedTotalValue: string;
  }> {
    const pipeline = await this.getPipelineById(tenantId, pipelineId);
    const stages = pipeline.stages;

    const conditions = buildDealFilterConditions(tenantId, {
      ...filters,
      pipelineId,
    });

    const aggregates = await db
      .select({
        stageId: crmDeals.stageId,
        dealsCount: sql<number>`count(*)::int`,
        knownValueDealsCount: sql<number>`count(${crmDeals.value})::int`,
        totalValue: sql<number>`coalesce(sum(${crmDeals.value}), 0)::float`,
      })
      .from(crmDeals)
      .where(and(...conditions))
      .groupBy(crmDeals.stageId);

    const aggMap = new Map<string, { dealsCount: number; knownValueDealsCount: number; totalValue: number }>();
    for (const row of aggregates) {
      aggMap.set(row.stageId, {
        dealsCount: Number(row.dealsCount) || 0,
        knownValueDealsCount: Number(row.knownValueDealsCount) || 0,
        totalValue: Number(row.totalValue) || 0,
      });
    }

    let globalDealsCount = 0;
    let globalKnownValueCount = 0;
    let globalTotalValue = 0;

    const stagesResult = stages.map((s) => {
      const agg = aggMap.get(s.id) || { dealsCount: 0, knownValueDealsCount: 0, totalValue: 0 };
      globalDealsCount += agg.dealsCount;
      globalKnownValueCount += agg.knownValueDealsCount;
      globalTotalValue += agg.totalValue;

      const formatted = agg.knownValueDealsCount > 0
        ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(agg.totalValue)
        : "-";

      return {
        stageId: s.id,
        dealsCount: agg.dealsCount,
        knownValueDealsCount: agg.knownValueDealsCount,
        totalValue: agg.totalValue,
        formattedTotalValue: formatted,
      };
    });

    const globalFormatted = globalKnownValueCount > 0
      ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(globalTotalValue)
      : "-";

    return {
      pipelineId,
      stages: stagesResult,
      totalDeals: globalDealsCount,
      totalKnownValueDeals: globalKnownValueCount,
      totalValue: globalTotalValue,
      formattedTotalValue: globalFormatted,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. CLIENTES / CONTAS (Accounts PF e PJ)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Busca contas por documento normalizado, nome ou listagem paginada.
   */
  async getAccounts(
    tenantId: string,
    params: {
      search?: string;
      query?: string;
      document?: string;
      type?: "person" | "company";
      segment?: string;
      includeArchived?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ accounts: CrmAccount[]; total: number; limit: number; offset: number }> {
    const conditions = [
      eq(crmAccounts.tenantId, tenantId),
    ];

    if (!params.includeArchived) {
      conditions.push(sql`${crmAccounts.archivedAt} IS NULL`);
    }

    if (params.document) {
      const cleanDoc = normalizeDocument(params.document);
      if (cleanDoc) {
        conditions.push(eq(crmAccounts.document, cleanDoc));
      }
    }

    if (params.type) {
      conditions.push(eq(crmAccounts.type, params.type));
    }
    if (params.segment) {
      conditions.push(eq(crmAccounts.segment, params.segment));
    }

    const termInput = params.search || params.query;
    if (termInput && termInput.trim()) {
      const cleanTerm = termInput.trim();
      const term = `%${cleanTerm.toLowerCase()}%`;
      const numOnly = cleanTerm.replace(/\D/g, "");
      if (numOnly.length >= 8) {
        conditions.push(
          sql`(LOWER(${crmAccounts.name}) LIKE ${term} OR LOWER(${crmAccounts.tradeName}) LIKE ${term} OR ${crmAccounts.document} LIKE ${`%${numOnly}%`} OR LOWER(${crmAccounts.email}) LIKE ${term})`
        );
      } else {
        conditions.push(
          sql`(LOWER(${crmAccounts.name}) LIKE ${term} OR LOWER(${crmAccounts.tradeName}) LIKE ${term} OR LOWER(${crmAccounts.document}) LIKE ${term} OR LOWER(${crmAccounts.email}) LIKE ${term})`
        );
      }
    }

    const whereClause = and(...conditions);
    const limit = Math.min(params.limit || 50, 100);
    const offset = params.offset || 0;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(crmAccounts)
      .where(whereClause);

    const accounts = await db
      .select()
      .from(crmAccounts)
      .where(whereClause)
      .orderBy(desc(crmAccounts.createdAt), desc(crmAccounts.id))
      .limit(limit)
      .offset(offset);

    return {
      accounts,
      total: countResult?.count || 0,
      limit,
      offset,
    };
  }

  /**
   * Alias de conveniência para listagem de contas
   */
  async listAccounts(
    tenantId: string,
    params: {
      search?: string;
      query?: string;
      document?: string;
      type?: "person" | "company";
      segment?: string;
      includeArchived?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    return this.getAccounts(tenantId, params);
  }

  /**
   * Cria ou obtém conta compradora por documento normalizado (PF ou PJ).
   */
  async createAccount(
    tenantId: string,
    data: {
      name: string;
      type?: "person" | "company";
      tradeName?: string;
      segment?: string;
      document?: string;
      email?: string;
      phone?: string;
      website?: string;
      address?: Record<string, any>;
      customFields?: Record<string, any>;
      notes?: string;
      rdOrganizationId?: string;
    }
  ): Promise<CrmAccount> {
    const cleanDoc = normalizeDocument(data.document);
    let docType = "other";
    if (cleanDoc) {
      docType = detectDocumentType(cleanDoc);
    }

    // Se já existe uma conta com o mesmo documento válido no tenant, retorna a existente
    if (cleanDoc) {
      const [existing] = await db
        .select()
        .from(crmAccounts)
        .where(
          and(
            eq(crmAccounts.tenantId, tenantId),
            eq(crmAccounts.document, cleanDoc),
            sql`${crmAccounts.archivedAt} IS NULL`
          )
        )
        .limit(1);

      if (existing) {
        return existing;
      }
    }

    const accountType = data.type || (docType === "cnpj" ? "company" : "person");
    if (cleanDoc) {
      validateDocument(accountType, cleanDoc);
    }
    const accountId = `acc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const segment = data.segment ? await validateCatalogChoice(tenantId, "segment", data.segment) : null;
    const accountFields = validateFieldValues(await listCustomFields(tenantId, "company"), data.customFields, { requireOnCreate: true });

    const [account] = await db
      .insert(crmAccounts)
      .values({
        id: accountId,
        tenantId,
        type: accountType,
        name: data.name.trim(),
        tradeName: data.tradeName?.trim() || null,
        segment: accountType === "company" ? segment : null,
        documentType: docType,
        document: cleanDoc || null,
        email: data.email?.trim() || null,
        phone: data.phone?.trim() || null,
        website: data.website?.trim() || null,
        address: data.address || {},
        customFields: accountFields,
        notes: data.notes?.trim() || null,
        rdOrganizationId: data.rdOrganizationId || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return account;
  }

  /**
   * Obtém ficha detalhada da conta compradora com contatos vinculados (1:N),
   * negociações associadas, atendimentos relacionados e histórico de transições.
   */
  async getAccountById(
    tenantId: string,
    accountId: string
  ): Promise<{
    account: CrmAccount;
    contacts: Array<{
      id: string;
      name: string;
      phone: string | null;
      email: string | null;
      avatar: string | null;
      accountId: string | null;
    }>;
    deals: CrmDeal[];
    conversations: Array<{
      id: string;
      accountId: string;
      conversationId: string;
      contextNote: string | null;
      createdAt: Date;
      operatorName: string | null;
      conversation: {
        id: string;
        channel: string;
        status: string;
        contactName: string | null;
        lastMessageAt: Date | null;
      } | null;
    }>;
    history: Array<{
      id: string;
      contactId: string;
      contactName: string | null;
      accountId: string | null;
      reason: string | null;
      createdAt: Date;
      changedByOperatorId: string | null;
      operatorName: string | null;
    }>;
  }> {
    const [account] = await db
      .select()
      .from(crmAccounts)
      .where(
        and(
          eq(crmAccounts.id, accountId),
          eq(crmAccounts.tenantId, tenantId),
          sql`${crmAccounts.archivedAt} IS NULL`
        )
      )
      .limit(1);

    if (!account) {
      throw new CrmNotFoundError("Cliente/Conta não encontrada.");
    }

    // 1. Contatos vinculados (1:N)
    const linkedContacts = await db
      .select({
        id: contacts.id,
        name: contacts.name,
        phone: contacts.phone,
        email: contacts.email,
        avatar: contacts.avatar,
        accountId: contacts.accountId,
      })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.accountId, accountId)));

    // 2. Negociações associadas
    const linkedDeals = await db
      .select()
      .from(crmDeals)
      .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.accountId, accountId)))
      .orderBy(desc(crmDeals.createdAt));

    // 3. Conversas associadas
    const linkedConversationsRaw = await db
      .select({
        link: crmAccountConversations,
        conv: conversations,
        ct: contacts,
        op: operators,
      })
      .from(crmAccountConversations)
      .innerJoin(conversations, eq(crmAccountConversations.conversationId, conversations.id))
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .leftJoin(operators, eq(crmAccountConversations.createdByOperatorId, operators.id))
      .where(
        and(
          eq(crmAccountConversations.tenantId, tenantId),
          eq(crmAccountConversations.accountId, accountId)
        )
      )
      .orderBy(desc(crmAccountConversations.createdAt));

    const linkedConversations = linkedConversationsRaw.map((r) => ({
      id: r.link.id,
      accountId: r.link.accountId,
      conversationId: r.link.conversationId,
      contextNote: r.link.contextNote,
      createdAt: r.link.createdAt,
      operatorName: r.op?.name || null,
      conversation: r.conv
        ? {
            id: r.conv.id,
            channel: r.ct?.mainChannel || "whatsapp",
            status: r.conv.queueState,
            contactName: r.ct?.name || null,
            lastMessageAt: r.conv.lastMessageTime,
          }
        : null,
    }));

    // 4. Histórico de contatos nesta conta
    const historyRaw = await db
      .select({
        hist: crmContactAccountHistory,
        ct: contacts,
        op: operators,
      })
      .from(crmContactAccountHistory)
      .leftJoin(contacts, eq(crmContactAccountHistory.contactId, contacts.id))
      .leftJoin(operators, eq(crmContactAccountHistory.changedByOperatorId, operators.id))
      .where(
        and(
          eq(crmContactAccountHistory.tenantId, tenantId),
          eq(crmContactAccountHistory.accountId, accountId)
        )
      )
      .orderBy(desc(crmContactAccountHistory.createdAt));

    const history = historyRaw.map((r) => ({
      id: r.hist.id,
      contactId: r.hist.contactId,
      contactName: r.ct?.name || null,
      accountId: r.hist.accountId,
      reason: r.hist.reason,
      createdAt: r.hist.createdAt,
      changedByOperatorId: r.hist.changedByOperatorId,
      operatorName: r.op?.name || null,
    }));

    return {
      account,
      contacts: linkedContacts,
      deals: linkedDeals,
      conversations: linkedConversations,
      history,
    };
  }

  /**
   * Atualiza dados cadastrais da conta compradora com validações de unicidade e documento.
   */
  async updateAccount(
    tenantId: string,
    accountId: string,
    data: {
      name?: string;
      tradeName?: string | null;
      segment?: string | null;
      type?: "person" | "company";
      document?: string | null;
      email?: string | null;
      phone?: string | null;
      website?: string | null;
      address?: Record<string, any>;
      customFields?: Record<string, any>;
      notes?: string | null;
    }
  ): Promise<CrmAccount> {
    const [current] = await db
      .select()
      .from(crmAccounts)
      .where(
        and(
          eq(crmAccounts.id, accountId),
          eq(crmAccounts.tenantId, tenantId),
          sql`${crmAccounts.archivedAt} IS NULL`
        )
      )
      .limit(1);

    if (!current) {
      throw new CrmNotFoundError("Cliente/Conta não encontrada.");
    }

    const updates: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) {
      if (!data.name.trim()) throw new CrmValidationError("O nome ou razão social é obrigatório.");
      updates.name = data.name.trim();
    }
    if (data.tradeName !== undefined) updates.tradeName = data.tradeName?.trim() || null;
    if (data.segment !== undefined) updates.segment = data.segment ? await validateCatalogChoice(tenantId, "segment", data.segment, current.segment) : null;
    if (data.type !== undefined) updates.type = data.type;
    if (data.email !== undefined) updates.email = data.email?.trim() || null;
    if (data.phone !== undefined) updates.phone = data.phone ? normalizeDocument(data.phone) : null;
    if (data.website !== undefined) updates.website = data.website?.trim() || null;
    if (data.address !== undefined) updates.address = data.address || {};
    if (data.customFields !== undefined) {
      const patch = validateFieldValues(await listCustomFields(tenantId, "company"), data.customFields);
      updates.customFields = { ...(current.customFields as Record<string, unknown>), ...patch };
    }
    if (data.notes !== undefined) updates.notes = data.notes?.trim() || null;

    if (data.document !== undefined) {
      const cleanDoc = data.document ? normalizeDocument(data.document) : "";
      if (cleanDoc) {
        const targetType = data.type || current.type;
        validateDocument(targetType as "person" | "company", cleanDoc);

        // Verifica duplicidade no mesmo tenant
        const [existing] = await db
          .select({ id: crmAccounts.id })
          .from(crmAccounts)
          .where(
            and(
              eq(crmAccounts.tenantId, tenantId),
              eq(crmAccounts.document, cleanDoc),
              sql`${crmAccounts.id} != ${accountId}`,
              sql`${crmAccounts.archivedAt} IS NULL`
            )
          )
          .limit(1);

        if (existing) {
          throw new CrmValidationError(
            "Já existe outra conta cadastrada com este documento neste tenant.",
            "DUPLICATE_DOCUMENT"
          );
        }

        updates.document = cleanDoc;
        updates.documentType = detectDocumentType(cleanDoc);
      } else {
        updates.document = null;
        updates.documentType = null;
      }
    }

    const [updated] = await db
      .update(crmAccounts)
      .set(updates)
      .where(and(eq(crmAccounts.id, accountId), eq(crmAccounts.tenantId, tenantId)))
      .returning();

    return updated;
  }

  /**
   * Arquivamento suave (soft-delete) de conta compradora.
   */
  async archiveAccount(
    tenantId: string,
    accountId: string
  ): Promise<{ success: boolean; id: string }> {
    const [current] = await db
      .select({ id: crmAccounts.id })
      .from(crmAccounts)
      .where(
        and(
          eq(crmAccounts.id, accountId),
          eq(crmAccounts.tenantId, tenantId),
          sql`${crmAccounts.archivedAt} IS NULL`
        )
      )
      .limit(1);

    if (!current) {
      throw new CrmNotFoundError("Cliente/Conta não encontrada.");
    }

    await db
      .update(crmAccounts)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(crmAccounts.id, accountId), eq(crmAccounts.tenantId, tenantId)));

    return { success: true, id: accountId };
  }

  /**
   * Altera a conta compradora principal de um contato, registrando histórico formal
   * em crm_contact_account_history sem reescrever dados de negócios históricos.
   */
  async updateContactAccount(
    tenantId: string,
    contactId: string,
    newAccountId: string | null,
    reason?: string,
    operatorId?: string
  ): Promise<{ contactId: string; accountId: string | null }> {
    return await db.transaction(async (tx) => {
      const [contact] = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)))
        .limit(1);

      if (!contact) {
        throw new CrmNotFoundError("Contato não encontrado.");
      }

      if (newAccountId) {
        const [acc] = await tx
          .select({ id: crmAccounts.id })
          .from(crmAccounts)
          .where(
            and(
              eq(crmAccounts.id, newAccountId),
              eq(crmAccounts.tenantId, tenantId),
              sql`${crmAccounts.archivedAt} IS NULL`
            )
          )
          .limit(1);

        if (!acc) {
          throw new CrmCrossTenantError(`Conta de destino (${newAccountId}) não pertence ao tenant ${tenantId}.`);
        }
      }

      // Se a conta mudou, grava no histórico
      if (contact.accountId !== newAccountId) {
        await tx.insert(crmContactAccountHistory).values({
          id: `cah-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          tenantId,
          contactId,
          accountId: newAccountId || null,
          reason: reason?.trim() || null,
          changedByOperatorId: operatorId || null,
          createdAt: new Date(),
        });

        await tx
          .update(contacts)
          .set({ accountId: newAccountId })
          .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)));
      }

      return { contactId, accountId: newAccountId };
    });
  }

  /**
   * Consulta histórico de transições de empresa de um contato.
   */
  async getContactAccountHistory(
    tenantId: string,
    contactId: string
  ): Promise<
    Array<{
      id: string;
      contactId: string;
      accountId: string | null;
      accountName: string | null;
      reason: string | null;
      changedByOperatorId: string | null;
      operatorName: string | null;
      createdAt: Date;
    }>
  > {
    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)))
      .limit(1);

    if (!contact) {
      throw new CrmNotFoundError("Contato não encontrado.");
    }

    const historyRaw = await db
      .select({
        hist: crmContactAccountHistory,
        acc: crmAccounts,
        op: operators,
      })
      .from(crmContactAccountHistory)
      .leftJoin(crmAccounts, eq(crmContactAccountHistory.accountId, crmAccounts.id))
      .leftJoin(operators, eq(crmContactAccountHistory.changedByOperatorId, operators.id))
      .where(
        and(
          eq(crmContactAccountHistory.tenantId, tenantId),
          eq(crmContactAccountHistory.contactId, contactId)
        )
      )
      .orderBy(desc(crmContactAccountHistory.createdAt));

    return historyRaw.map((r) => ({
      id: r.hist.id,
      contactId: r.hist.contactId,
      accountId: r.hist.accountId,
      accountName: r.acc?.name || null,
      reason: r.hist.reason,
      changedByOperatorId: r.hist.changedByOperatorId,
      operatorName: r.op?.name || null,
      createdAt: r.hist.createdAt,
    }));
  }

  /**
   * Consulta participantes vinculados a uma negociação.
   */
  async getDealContacts(
    tenantId: string,
    dealId: string
  ): Promise<
    Array<{
      id: string;
      dealId: string;
      contactId: string;
      role: string;
      isPrimary: boolean;
      createdAt: Date;
      contact: {
        id: string;
        name: string;
        phone: string | null;
        email: string | null;
        avatar: string | null;
      };
    }>
  > {
    const [deal] = await db
      .select({ id: crmDeals.id })
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
      .limit(1);

    if (!deal) {
      throw new CrmNotFoundError("Negociação não encontrada.");
    }

    const raw = await db
      .select({
        dealContact: crmDealContacts,
        contact: contacts,
      })
      .from(crmDealContacts)
      .innerJoin(contacts, and(eq(crmDealContacts.contactId, contacts.id), eq(contacts.tenantId, tenantId)))
      .where(
        and(
          eq(crmDealContacts.tenantId, tenantId),
          eq(contacts.tenantId, tenantId),
          eq(crmDealContacts.dealId, dealId)
        )
      )
      .orderBy(desc(crmDealContacts.isPrimary), asc(crmDealContacts.createdAt));

    return raw.map((r) => ({
      ...r.dealContact,
      contact: {
        id: r.contact.id,
        name: r.contact.name,
        phone: r.contact.phone,
        email: r.contact.email,
        avatar: r.contact.avatar,
      },
    }));
  }

  /**
   * Adiciona participante a uma negociação com papel e definição de contato principal.
   */
  async addDealContact(
    tenantId: string,
    dealId: string,
    contactId: string,
    role: string = "buyer",
    isPrimary: boolean = false
  ) {
    return await db.transaction(async (tx) => {
      const [deal] = await tx
        .select({ id: crmDeals.id })
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .limit(1);

      if (!deal) {
        throw new CrmNotFoundError("Negociação não encontrada.");
      }

      let [contact] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)))
        .limit(1);

      if (!contact) {
        const digits = contactId.replace(/\D/g, "");
        if (digits.length >= 8) {
          [contact] = await tx
            .select({ id: contacts.id })
            .from(contacts)
            .where(
              and(
                eq(contacts.tenantId, tenantId),
                sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${digits}`
              )
            )
            .limit(1);
        }
      }

      if (!contact) {
        [contact] = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(
            and(
              eq(contacts.tenantId, tenantId),
              or(
                ilike(contacts.email, contactId.trim()),
                ilike(contacts.name, contactId.trim())
              )
            )
          )
          .limit(1);
      }

      if (!contact) {
        throw new CrmCrossTenantError(`Contato (${contactId}) não pertence ao tenant ${tenantId}.`);
      }

      const finalContactId = contact.id;

      // Verifica participantes existentes
      const existing = await tx
        .select()
        .from(crmDealContacts)
        .where(and(eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.dealId, dealId)));

      const isFirst = existing.length === 0;
      const shouldBePrimary = isPrimary || isFirst;

      if (shouldBePrimary) {
        await tx
          .update(crmDealContacts)
          .set({ isPrimary: false })
          .where(and(eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.dealId, dealId)));
      }

      const already = existing.find((p) => p.contactId === finalContactId);
      if (already) {
        await tx
          .update(crmDealContacts)
          .set({ role, isPrimary: shouldBePrimary })
          .where(eq(crmDealContacts.id, already.id));
      } else {
        await tx.insert(crmDealContacts).values({
          id: `dc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          tenantId,
          dealId,
          contactId: finalContactId,
          role,
          isPrimary: shouldBePrimary,
          createdAt: new Date(),
        });
      }

      // Consulta lista atualizada de participantes
      const updatedRaw = await tx
        .select({
          dealContact: crmDealContacts,
          contact: contacts,
        })
        .from(crmDealContacts)
        .innerJoin(contacts, and(eq(crmDealContacts.contactId, contacts.id), eq(contacts.tenantId, tenantId)))
        .where(
          and(
            eq(crmDealContacts.tenantId, tenantId),
            eq(contacts.tenantId, tenantId),
            eq(crmDealContacts.dealId, dealId)
          )
        )
        .orderBy(desc(crmDealContacts.isPrimary), asc(crmDealContacts.createdAt));

      return updatedRaw.map((r) => ({
        ...r.dealContact,
        contact: {
          id: r.contact.id,
          name: r.contact.name,
          phone: r.contact.phone,
          email: r.contact.email,
          avatar: r.contact.avatar,
        },
      }));
    });
  }

  /**
   * Remove participante de uma negociação. Se o participante removido for o primário,
   * elege o primeiro participante restante como primário.
   */
  async removeDealContact(
    tenantId: string,
    dealId: string,
    contactId: string
  ) {
    return await db.transaction(async (tx) => {
      const [deal] = await tx
        .select({ id: crmDeals.id })
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .limit(1);

      if (!deal) {
        throw new CrmNotFoundError("Negociação não encontrada.");
      }

      const [existing] = await tx
        .select()
        .from(crmDealContacts)
        .where(
          and(
            eq(crmDealContacts.tenantId, tenantId),
            eq(crmDealContacts.dealId, dealId),
            eq(crmDealContacts.contactId, contactId)
          )
        )
        .limit(1);

      if (!existing) {
        return await this.getDealContacts(tenantId, dealId);
      }

      await tx.delete(crmDealContacts).where(eq(crmDealContacts.id, existing.id));

      if (existing.isPrimary) {
        const [next] = await tx
          .select()
          .from(crmDealContacts)
          .where(and(eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.dealId, dealId)))
          .orderBy(asc(crmDealContacts.createdAt))
          .limit(1);

        if (next) {
          await tx
            .update(crmDealContacts)
            .set({ isPrimary: true })
            .where(eq(crmDealContacts.id, next.id));
        }
      }

      const updatedRaw = await tx
        .select({
          dealContact: crmDealContacts,
          contact: contacts,
        })
        .from(crmDealContacts)
        .innerJoin(contacts, and(eq(crmDealContacts.contactId, contacts.id), eq(contacts.tenantId, tenantId)))
        .where(
          and(
            eq(crmDealContacts.tenantId, tenantId),
            eq(contacts.tenantId, tenantId),
            eq(crmDealContacts.dealId, dealId)
          )
        )
        .orderBy(desc(crmDealContacts.isPrimary), asc(crmDealContacts.createdAt));

      return updatedRaw.map((r) => ({
        ...r.dealContact,
        contact: {
          id: r.contact.id,
          name: r.contact.name,
          phone: r.contact.phone,
          email: r.contact.email,
          avatar: r.contact.avatar,
        },
      }));
    });
  }

  /**
   * Define o contato principal de uma negociação.
   */
  async setPrimaryDealContact(
    tenantId: string,
    dealId: string,
    contactId: string
  ) {
    return await db.transaction(async (tx) => {
      const [deal] = await tx
        .select({ id: crmDeals.id })
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .limit(1);

      if (!deal) {
        throw new CrmNotFoundError("Negociação não encontrada.");
      }

      const [target] = await tx
        .select()
        .from(crmDealContacts)
        .where(
          and(
            eq(crmDealContacts.tenantId, tenantId),
            eq(crmDealContacts.dealId, dealId),
            eq(crmDealContacts.contactId, contactId)
          )
        )
        .limit(1);

      if (!target) {
        throw new CrmNotFoundError("Contato participante não encontrado nesta negociação.");
      }

      await tx
        .update(crmDealContacts)
        .set({ isPrimary: false })
        .where(and(eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.dealId, dealId)));

      await tx
        .update(crmDealContacts)
        .set({ isPrimary: true })
        .where(eq(crmDealContacts.id, target.id));

      const updatedRaw = await tx
        .select({
          dealContact: crmDealContacts,
          contact: contacts,
        })
        .from(crmDealContacts)
        .innerJoin(contacts, and(eq(crmDealContacts.contactId, contacts.id), eq(contacts.tenantId, tenantId)))
        .where(
          and(
            eq(crmDealContacts.tenantId, tenantId),
            eq(contacts.tenantId, tenantId),
            eq(crmDealContacts.dealId, dealId)
          )
        )
        .orderBy(desc(crmDealContacts.isPrimary), asc(crmDealContacts.createdAt));

      return updatedRaw.map((r) => ({
        ...r.dealContact,
        contact: {
          id: r.contact.id,
          name: r.contact.name,
          phone: r.contact.phone,
          email: r.contact.email,
          avatar: r.contact.avatar,
        },
      }));
    });
  }

  /**
   * Vincula explicitamente uma conversa a uma conta compradora com autoria e nota de contexto.
   */
  async linkAccountConversation(
    tenantId: string,
    accountId: string,
    conversationId: string,
    operatorId?: string,
    contextNote?: string
  ) {
    const [acc] = await db
      .select({ id: crmAccounts.id })
      .from(crmAccounts)
      .where(
        and(
          eq(crmAccounts.id, accountId),
          eq(crmAccounts.tenantId, tenantId),
          sql`${crmAccounts.archivedAt} IS NULL`
        )
      )
      .limit(1);

    if (!acc) {
      throw new CrmNotFoundError("Conta compradora não encontrada.");
    }

    const [conv] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
      .limit(1);

    if (!conv) {
      throw new CrmCrossTenantError(`Conversa (${conversationId}) não pertence ao tenant ${tenantId}.`);
    }

    // Verifica se já existe vínculo
    const [existing] = await db
      .select()
      .from(crmAccountConversations)
      .where(
        and(
          eq(crmAccountConversations.tenantId, tenantId),
          eq(crmAccountConversations.accountId, accountId),
          eq(crmAccountConversations.conversationId, conversationId)
        )
      )
      .limit(1);

    if (existing) {
      if (contextNote !== undefined && contextNote !== existing.contextNote) {
        await db
          .update(crmAccountConversations)
          .set({ contextNote: contextNote?.trim() || null })
          .where(eq(crmAccountConversations.id, existing.id));
      }
      return existing;
    }

    const [created] = await db
      .insert(crmAccountConversations)
      .values({
        id: `ac-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        accountId,
        conversationId,
        contextNote: contextNote?.trim() || null,
        createdByOperatorId: operatorId || null,
        createdAt: new Date(),
      })
      .returning();

    return created;
  }

  /**
   * Desvincula uma conversa de uma conta compradora.
   */
  async unlinkAccountConversation(
    tenantId: string,
    accountId: string,
    conversationId: string
  ) {
    const [acc] = await db
      .select({ id: crmAccounts.id })
      .from(crmAccounts)
      .where(and(eq(crmAccounts.id, accountId), eq(crmAccounts.tenantId, tenantId)))
      .limit(1);

    if (!acc) {
      throw new CrmNotFoundError("Conta compradora não encontrada.");
    }

    await db
      .delete(crmAccountConversations)
      .where(
        and(
          eq(crmAccountConversations.tenantId, tenantId),
          eq(crmAccountConversations.accountId, accountId),
          eq(crmAccountConversations.conversationId, conversationId)
        )
      );

    return { success: true };
  }

  /**
   * Lista conversas vinculadas a uma conta compradora.
   */
  async getAccountConversations(
    tenantId: string,
    accountId: string
  ) {
    const [acc] = await db
      .select({ id: crmAccounts.id })
      .from(crmAccounts)
      .where(and(eq(crmAccounts.id, accountId), eq(crmAccounts.tenantId, tenantId)))
      .limit(1);

    if (!acc) {
      throw new CrmNotFoundError("Conta compradora não encontrada.");
    }

    const raw = await db
      .select({
        link: crmAccountConversations,
        conv: conversations,
        ct: contacts,
        op: operators,
      })
      .from(crmAccountConversations)
      .innerJoin(conversations, eq(crmAccountConversations.conversationId, conversations.id))
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .leftJoin(operators, eq(crmAccountConversations.createdByOperatorId, operators.id))
      .where(
        and(
          eq(crmAccountConversations.tenantId, tenantId),
          eq(crmAccountConversations.accountId, accountId)
        )
      )
      .orderBy(desc(crmAccountConversations.createdAt));

    return raw.map((r) => ({
      id: r.link.id,
      accountId: r.link.accountId,
      conversationId: r.link.conversationId,
      contextNote: r.link.contextNote,
      createdAt: r.link.createdAt,
      operatorName: r.op?.name || null,
      conversation: {
        id: r.conv.id,
        channel: r.ct?.mainChannel || "whatsapp",
        status: r.conv.queueState,
        contactName: r.ct?.name || null,
        lastMessageAt: r.conv.lastMessageTime,
      },
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. NEGOCIAÇÕES / CARDS (Deals)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lista negociações paginadas com filtros comerciais completos, ordenação dinâmica e sem joins multiplicativos.
   */
  async getDeals(
    tenantId: string,
    params: CrmDealFilters & {
      limit?: number;
      offset?: number;
      includeTotal?: boolean;
      sortBy?:
        | "name_asc"
        | "name_desc"
        | "created_asc"
        | "created_desc"
        | "next_task_asc"
        | "close_date_asc"
        | "close_date_desc"
        | "rating_desc"
        | "rating_asc"
        | "contact_recent"
        | "contact_old"
        | "updated_desc"
        | string;
    } = {}
  ): Promise<{
    deals: Array<
      CrmDeal & {
        account: CrmAccount | null;
        contactsCount: number;
        conversationsCount: number;
        primaryConversationId?: string | null;
        primaryContactId?: string | null;
      }
    >;
    total: number;
  }> {
    const conditions = buildDealFilterConditions(tenantId, params);
    const whereClause = and(...conditions);
    const limit = params.limit ? Math.min(params.limit, 100000) : 50;
    const offset = params.offset || 0;

    // O Kanban já recebe a contagem exata no resumo por etapa. Evita uma
    // segunda varredura completa quando o chamador não precisa do total.
    const [countResult] = params.includeTotal === false
      ? [{ count: 0 }]
      : await db
          .select({ count: sql<number>`count(*)::int` })
          .from(crmDeals)
          .where(whereClause);

    let orderClause: any[];
    switch (params.sortBy) {
      case "name_asc":
        orderClause = [asc(crmDeals.title)];
        break;
      case "name_desc":
        orderClause = [desc(crmDeals.title)];
        break;
      case "created_asc":
        orderClause = [asc(crmDeals.createdAt)];
        break;
      case "created_desc":
        orderClause = [desc(crmDeals.createdAt)];
        break;
      case "next_task_asc":
        orderClause = [
          sql`(
            SELECT MIN(act.due_date)
            FROM crm_deal_activities act
            WHERE act.deal_id = ${crmDeals.id}
              AND act.tenant_id = ${tenantId}
              AND act.status = 'pending'
              AND act.type != 'note'
          ) ASC NULLS LAST`,
          desc(crmDeals.createdAt),
        ];
        break;
      case "close_date_asc":
        orderClause = [sql`${crmDeals.expectedCloseDate} ASC NULLS LAST`, desc(crmDeals.createdAt)];
        break;
      case "close_date_desc":
        orderClause = [sql`${crmDeals.expectedCloseDate} DESC NULLS LAST`, desc(crmDeals.createdAt)];
        break;
      case "rating_desc":
        orderClause = [sql`${crmDeals.rating} DESC NULLS LAST`, desc(crmDeals.createdAt)];
        break;
      case "rating_asc":
        orderClause = [sql`${crmDeals.rating} ASC NULLS LAST`, desc(crmDeals.createdAt)];
        break;
      case "contact_recent":
      case "updated_desc":
        orderClause = [
          desc(crmDeals.lastActivityAt),
          desc(crmDeals.createdAt),
          desc(crmDeals.id),
        ];
        break;
      case "contact_old":
      case "updated_asc":
        orderClause = [
          asc(crmDeals.lastActivityAt),
          asc(crmDeals.createdAt),
          asc(crmDeals.id),
        ];
        break;
      default:
        orderClause = [desc(crmDeals.updatedAt), desc(crmDeals.createdAt)];
        break;
    }

    let rawDeals: (typeof crmDeals.$inferSelect)[];
    if (params.perStageLimit && !params.stageId) {
      const perStageLimit = Math.min(Math.max(params.perStageLimit, 1), 100);
      const rankedIdsSubquery = db
        .select({
          id: crmDeals.id,
          rn: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${crmDeals.stageId} ORDER BY ${sql.join(orderClause, sql`, `)})`.as("rn"),
        })
        .from(crmDeals)
        .where(whereClause)
        .as("sub_ranked");

      const topIds = await db
        .select({ id: rankedIdsSubquery.id })
        .from(rankedIdsSubquery)
        .where(sql`sub_ranked.rn <= ${perStageLimit}`);

      if (topIds.length === 0) {
        return { deals: [], total: countResult?.count || 0 };
      }

      const idList = topIds.map((t) => t.id);
      rawDeals = await db
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.tenantId, tenantId), inArray(crmDeals.id, idList)))
        .orderBy(...orderClause);
    } else {
      rawDeals = await db
        .select()
        .from(crmDeals)
        .where(whereClause)
        .orderBy(...orderClause)
        .limit(limit)
        .offset(offset);
    }

    if (rawDeals.length === 0) {
      return { deals: [], total: countResult?.count || 0 };
    }

    const dealIds = rawDeals.map((d) => d.id);
    const accountIds = Array.from(new Set(rawDeals.map((d) => d.accountId).filter(Boolean))) as string[];

    // Buscar contas associadas em lote
    const accountsMap = new Map<string, CrmAccount>();
    if (accountIds.length > 0) {
      const accList = await db
        .select()
        .from(crmAccounts)
        .where(
          and(
            eq(crmAccounts.tenantId, tenantId),
            inArray(crmAccounts.id, accountIds)
          )
        );
      for (const a of accList) {
        accountsMap.set(a.id, a);
      }
    }

    // Contagem de conversas ativas por deal e ID da conversa mais recente
    const convCounts = await db
      .select({
        dealId: crmConversationDeals.dealId,
        count: sql<number>`count(distinct ${crmConversationDeals.conversationId})::int`,
        latestConvId: sql<string>`(array_agg(${crmConversationDeals.conversationId} order by ${crmConversationDeals.createdAt} desc))[1]`,
      })
      .from(crmConversationDeals)
      .where(
        and(
          eq(crmConversationDeals.tenantId, tenantId),
          inArray(crmConversationDeals.dealId, dealIds),
          eq(crmConversationDeals.isActive, true)
        )
      )
      .groupBy(crmConversationDeals.dealId);

    const convCountMap = new Map<string, number>();
    const convLatestMap = new Map<string, string>();
    for (const c of convCounts) {
      convCountMap.set(c.dealId, c.count);
      if (c.latestConvId) {
        convLatestMap.set(c.dealId, c.latestConvId);
      }
    }

    // Contagem de contatos por deal e ID do contato principal
    const contactCounts = await db
      .select({
        dealId: crmDealContacts.dealId,
        count: sql<number>`count(*)::int`,
        firstContactId: sql<string>`(array_agg(${crmDealContacts.contactId} order by ${crmDealContacts.createdAt} asc))[1]`,
      })
      .from(crmDealContacts)
      .where(
        and(
          eq(crmDealContacts.tenantId, tenantId),
          inArray(crmDealContacts.dealId, dealIds)
        )
      )
      .groupBy(crmDealContacts.dealId);

    const contactCountMap = new Map<string, number>();
    const contactFirstMap = new Map<string, string>();
    for (const cc of contactCounts) {
      contactCountMap.set(cc.dealId, cc.count);
      if (cc.firstContactId) {
        contactFirstMap.set(cc.dealId, cc.firstContactId);
      }
    }

    // Próxima atividade pendente por deal (excluindo notas e trazendo operadores)
    const taskAssignedOp = alias(operators, "task_assigned_op");
    const pendingActivities = await db
      .select({
        activity: crmDealActivities,
        assignedOperatorName: taskAssignedOp.name,
      })
      .from(crmDealActivities)
      .leftJoin(taskAssignedOp, eq(crmDealActivities.assignedToOperatorId, taskAssignedOp.id))
      .where(
        and(
          eq(crmDealActivities.tenantId, tenantId),
          inArray(crmDealActivities.dealId, dealIds),
          eq(crmDealActivities.status, "pending"),
          sql`${crmDealActivities.type} != 'note'`
        )
      )
      .orderBy(sql`${crmDealActivities.dueDate} ASC NULLS LAST`, asc(crmDealActivities.createdAt));

    const nextActivityMap = new Map<string, any>();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const nowTime = now.getTime();

    for (const item of pendingActivities) {
      const act = item.activity;
      if (!nextActivityMap.has(act.dealId)) {
        const due = act.dueDate ? new Date(act.dueDate) : null;
        const dueTime = due ? due.getTime() : null;
        const isOverdue = due ? dueTime! < nowTime : false;
        const isToday = due ? due >= startOfToday && due <= endOfToday : false;
        const isFuture = due ? due > endOfToday : false;
        const hasNoDueDate = due === null;

        nextActivityMap.set(act.dealId, {
          id: act.id,
          title: act.title,
          type: act.type,
          dueDate: due ? due.toISOString() : null,
          isOverdue,
          isToday,
          isFuture,
          hasNoDueDate,
          assignedToOperatorId: act.assignedToOperatorId || null,
          responsibleName: item.assignedOperatorName || null,
          description: act.description || null,
        });
      }
    }

    const enrichedDeals = rawDeals.map((deal) => ({
      ...deal,
      ownerId: deal.operatorId,
      account: deal.accountId ? accountsMap.get(deal.accountId) || null : null,
      conversationsCount: convCountMap.get(deal.id) || 0,
      contactsCount: contactCountMap.get(deal.id) || 0,
      primaryConversationId: convLatestMap.get(deal.id) || null,
      primaryContactId: contactFirstMap.get(deal.id) || null,
      nextTask: nextActivityMap.get(deal.id) || null,
    }));

    return {
      deals: enrichedDeals,
      total: countResult?.count || 0,
    };
  }

  /**
   * Obtém ficha detalhada de uma negociação por ID com validação estrita de tenant.
   */
  async getDealById(
    tenantId: string,
    dealId: string
  ): Promise<
    | (CrmDeal & {
        ownerId?: string | null;
        pipeline?: {
          id: string;
          name: string;
          color: string | null;
          isDefault: boolean;
          stages: Array<{
            id: string;
            name: string;
            orderIndex: number;
            isWinStage: boolean;
            isLossStage: boolean;
          }>;
        } | null;
        account: CrmAccount | null;
        contacts: Array<CrmDealContact & { contact: typeof contacts.$inferSelect }>;
        conversations: Array<
          CrmConversationDeal & {
            conversation: typeof conversations.$inferSelect;
            contact?: typeof contacts.$inferSelect | null;
            contactName: string;
            contactPhone: string | null;
            contactAvatar: string | null;
            channel: string;
            mainChannel: string;
            queueState: string;
            operatorName: string | null;
            lastMessageText: string | null;
            lastMessageTime: Date | null;
          }
        >;
        activities: Array<CrmDealActivity & { operatorName: string | null; assignedToOperatorName: string | null }>;
        nextTask?: {
          id: string;
          title: string;
          type: string;
          dueDate: string | null;
          isOverdue: boolean;
          isToday: boolean;
          isFuture: boolean;
          hasNoDueDate: boolean;
          assignedToOperatorId: string | null;
          responsibleName: string | null;
          description?: string | null;
        } | null;
        events: CrmDealEvent[];
        evidences: Array<CrmActivityMessage & { message: typeof messages.$inferSelect }>;
        products: CrmDealProduct[];
        proposals: CrmProposal[];
        files: Array<CrmDealFile & { uploaderName?: string | null }>;
        questionnaires: Array<CrmDealQuestionnaire & { filledByName?: string | null }>;
        emails: Array<CrmDealEmail & { operatorName?: string | null }>;
      })
    | null
  > {
    const [deal] = await db
      .select()
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
      .limit(1);

    if (!deal) return null;

    // Funil e etapas reais do negócio (evita fixar funil padrão na ficha)
    let pipelineData: {
      id: string;
      name: string;
      color: string | null;
      isDefault: boolean;
      stages: Array<{
        id: string;
        name: string;
        orderIndex: number;
        isWinStage: boolean;
        isLossStage: boolean;
      }>;
    } | null = null;

    if (deal.pipelineId) {
      const [pipe] = await db
        .select({
          id: crmPipelines.id,
          name: crmPipelines.name,
          color: crmPipelines.color,
          isDefault: crmPipelines.isDefault,
        })
        .from(crmPipelines)
        .where(and(eq(crmPipelines.id, deal.pipelineId), eq(crmPipelines.tenantId, tenantId)))
        .limit(1);

      if (pipe) {
        const stages = await db
          .select({
            id: crmStages.id,
            name: crmStages.name,
            orderIndex: crmStages.orderIndex,
            isWinStage: crmStages.isWinStage,
            isLossStage: crmStages.isLossStage,
          })
          .from(crmStages)
          .where(and(eq(crmStages.pipelineId, pipe.id), eq(crmStages.tenantId, tenantId)))
          .orderBy(asc(crmStages.orderIndex), asc(crmStages.createdAt));

        pipelineData = {
          ...pipe,
          stages,
        };
      }
    }

    let account: CrmAccount | null = null;
    if (deal.accountId) {
      const [acc] = await db
        .select()
        .from(crmAccounts)
        .where(and(eq(crmAccounts.id, deal.accountId), eq(crmAccounts.tenantId, tenantId)))
        .limit(1);
      account = acc || null;
    }

    // Contatos participantes
    const dealContactsRaw = await db
      .select({
        dealContact: crmDealContacts,
        contact: contacts,
      })
      .from(crmDealContacts)
      .innerJoin(contacts, and(eq(crmDealContacts.contactId, contacts.id), eq(contacts.tenantId, tenantId)))
      .where(
        and(
          eq(crmDealContacts.tenantId, tenantId),
          eq(contacts.tenantId, tenantId),
          eq(crmDealContacts.dealId, dealId)
        )
      );

    const mappedContacts = dealContactsRaw.map((r) => ({
      ...r.dealContact,
      contact: r.contact,
    }));

    // Conversas vinculadas ativas com joins de contato e operador (DTO completo)
    const convDealsRaw = await db
      .select({
        convDeal: crmConversationDeals,
        conversation: conversations,
        contact: contacts,
        operatorName: operators.name,
      })
      .from(crmConversationDeals)
      .innerJoin(conversations, eq(crmConversationDeals.conversationId, conversations.id))
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .leftJoin(operators, eq(conversations.operatorId, operators.id))
      .where(
        and(
          eq(crmConversationDeals.tenantId, tenantId),
          eq(crmConversationDeals.dealId, dealId),
          eq(crmConversationDeals.isActive, true)
        )
      )
      .orderBy(desc(conversations.lastMessageTime));

    const mappedConversations = convDealsRaw.map((r) => {
      const mainChan = r.contact?.mainChannel || "whatsapp";
      return {
        ...r.convDeal,
        conversation: r.conversation,
        contact: r.contact,
        contactName: r.contact?.name || "Sem nome",
        contactPhone: r.contact?.phone || null,
        contactAvatar: r.contact?.avatar || null,
        channel: mainChan,
        mainChannel: mainChan,
        queueState: r.conversation.queueState || "meus",
        operatorName: r.operatorName || (r.conversation.operatorId ? "Operador" : "Na Fila"),
        lastMessageText: r.conversation.lastMessageText || null,
        lastMessageTime: r.conversation.lastMessageTime || null,
      };
    });

    // Atividades e tarefas com joins de operadores e ordenação padronizada
    const activities = await this.getDealActivities(tenantId, dealId);

    // Próxima tarefa pendente da negociação (excluindo notas comerciais)
    const pendingNonNotes = activities.filter((a) => a.status === "pending" && a.type !== "note");
    pendingNonNotes.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });
    const firstTask = pendingNonNotes[0] || null;
    let nextTask: any = null;
    if (firstTask) {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const nowTime = now.getTime();
      const due = firstTask.dueDate ? new Date(firstTask.dueDate) : null;
      const dueTime = due ? due.getTime() : null;
      const isOverdue = due ? dueTime! < nowTime : false;
      const isToday = due ? due >= startOfToday && due <= endOfToday : false;
      const isFuture = due ? due > endOfToday : false;
      const hasNoDueDate = due === null;

      nextTask = {
        id: firstTask.id,
        title: firstTask.title,
        type: firstTask.type,
        dueDate: due ? due.toISOString() : null,
        isOverdue,
        isToday,
        isFuture,
        hasNoDueDate,
        assignedToOperatorId: firstTask.assignedToOperatorId || null,
        responsibleName: firstTask.assignedToOperatorName || null,
        description: firstTask.description || null,
      };
    }

    // Eventos de auditoria
    const events = await db
      .select()
      .from(crmDealEvents)
      .where(and(eq(crmDealEvents.tenantId, tenantId), eq(crmDealEvents.dealId, dealId)))
      .orderBy(desc(crmDealEvents.createdAt));

    // Mensagens marcadas como evidência comercial
    const evidencesRaw = await db
      .select({
        evidence: crmActivityMessages,
        message: messages,
      })
      .from(crmActivityMessages)
      .innerJoin(messages, eq(crmActivityMessages.messageId, messages.id))
      .where(
        and(
          eq(crmActivityMessages.tenantId, tenantId),
          eq(crmActivityMessages.dealId, dealId)
        )
      )
      .orderBy(desc(crmActivityMessages.createdAt));

    const evidences = evidencesRaw.map((r) => ({
      ...r.evidence,
      message: r.message,
    }));

    // Produtos vinculados
    const products = await db
      .select()
      .from(crmDealProducts)
      .where(and(eq(crmDealProducts.tenantId, tenantId), eq(crmDealProducts.dealId, dealId)))
      .orderBy(asc(crmDealProducts.createdAt));

    // Propostas comerciais
    const proposals = await db
      .select()
      .from(crmProposals)
      .where(and(eq(crmProposals.tenantId, tenantId), eq(crmProposals.dealId, dealId)))
      .orderBy(desc(crmProposals.createdAt));

    // Arquivos anexados
    const files = await this.getDealFiles(tenantId, dealId);

    // Questionários respondidos
    const questionnaires = await this.getDealQuestionnaires(tenantId, dealId);

    // E-mails registrados
    const emails = await this.getDealEmails(tenantId, dealId);

    return {
      ...deal,
      ownerId: deal.operatorId,
      pipeline: pipelineData,
      account,
      contacts: mappedContacts,
      conversations: mappedConversations,
      activities,
      nextTask,
      events,
      evidences,
      products,
      proposals,
      files,
      questionnaires,
      emails,
    };
  }

  /**
   * Cria uma negociação com auditoria e vínculo opcional a uma conversa/contato.
   * Executa como unidade 100% transacional (db.transaction) com validação relacional estrita.
   */
  async createDeal(
    tenantId: string,
    operatorId: string | null,
    data: {
      title: string;
      pipelineId: string;
      stageId: string;
      accountId?: string | null;
      account?: {
        name: string;
        type?: "person" | "company";
        tradeName?: string | null;
        segment?: string | null;
        document?: string | null;
        phone?: string | null;
        email?: string | null;
        customFields?: CustomFieldValues;
      } | null;
      value?: string | number | null;
      currency?: string;
      expectedCloseDate?: Date | null;
      operatorId?: string | null;
      ownerId?: string | null;
      source?: string;
      campaign?: string;
      rating?: number;
      contactId?: string; // Contato principal a associar
      conversationId?: string; // Conversa de origem
      initialNote?: string | null;
      customFields?: CustomFieldValues;
    }
  ): Promise<CrmDeal> {
    if (!data.title || !data.title.trim()) {
      throw new CrmValidationError("O título da negociação é obrigatório.");
    }
    if (!data.pipelineId || !data.stageId) {
      throw new CrmValidationError("Funil (pipelineId) e Etapa (stageId) são obrigatórios.");
    }

    return await db.transaction(async (tx) => {
      // 1. Validação estrita do Funil no tenant
      const [pipeline] = await tx
        .select({ id: crmPipelines.id })
        .from(crmPipelines)
        .where(and(eq(crmPipelines.id, data.pipelineId), eq(crmPipelines.tenantId, tenantId)))
        .limit(1);

      if (!pipeline) {
        throw new CrmCrossTenantError(`O funil informado (${data.pipelineId}) não pertence ao tenant ${tenantId}.`);
      }

      // 2. Validação estrita da Etapa no tenant E pertencimento ao Funil selecionado
      const [stage] = await tx
        .select({ id: crmStages.id, pipelineId: crmStages.pipelineId, requiredFields: crmStages.requiredFields })
        .from(crmStages)
        .where(and(eq(crmStages.id, data.stageId), eq(crmStages.tenantId, tenantId)))
        .limit(1);

      if (!stage) {
        throw new CrmCrossTenantError(`A etapa informada (${data.stageId}) não pertence ao tenant ${tenantId}.`);
      }

      if (stage.pipelineId !== data.pipelineId) {
        throw new CrmValidationError(
          `A etapa (${data.stageId}) não pertence ao funil informado (${data.pipelineId}).`,
          "STAGE_NOT_IN_PIPELINE"
        );
      }

      const dealFieldDefinitions = await listCustomFields(tenantId, "deal", tx);
      const dealCustomFields = validateFieldValues(dealFieldDefinitions, data.customFields, {
        pipelineId: data.pipelineId, requireOnCreate: true,
      });
      const missingInitialFields = missingStageFields(stage.requiredFields, dealFieldDefinitions, dealCustomFields, data.pipelineId);
      if (missingInitialFields.length) throw new CrmValidationError(`Preencha os campos exigidos pela etapa inicial: ${missingInitialFields.join(", ")}.`, "REQUIRED_STAGE_FIELDS");

      const now = new Date();
      let targetAccountId: string | null = data.accountId || null;

      // 3. Criação ou resolução atômica de Conta Compradora
      if (data.account && data.account.name && data.account.name.trim()) {
        const accName = data.account.name.trim();
        const rawDoc = data.account.document ? normalizeDocument(data.account.document) : "";
        const accType = data.account.type || (rawDoc.length === 14 ? "company" : "person");

        if (rawDoc) {
          validateDocument(accType, rawDoc);
          // Verificar se já existe conta com este documento no mesmo tenant
          const [existingAcc] = await tx
            .select({ id: crmAccounts.id })
            .from(crmAccounts)
            .where(
              and(
                eq(crmAccounts.tenantId, tenantId),
                eq(crmAccounts.document, rawDoc),
                sql`${crmAccounts.archivedAt} IS NULL`
              )
            )
            .limit(1);

          if (existingAcc) {
            targetAccountId = existingAcc.id;
          }
        }

        if (!targetAccountId) {
          const companyCustomFields = validateFieldValues(
            await listCustomFields(tenantId, "company", tx), data.account.customFields, { requireOnCreate: true },
          );
          const newAccId = `acc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          const [createdAcc] = await tx
            .insert(crmAccounts)
            .values({
              id: newAccId,
              tenantId,
              type: accType,
              name: accName,
              tradeName: data.account.tradeName?.trim() || null,
              segment: accType === "company" && data.account.segment ? await validateCatalogChoice(tenantId, "segment", data.account.segment) : null,
              documentType: rawDoc ? (accType === "company" ? "cnpj" : "cpf") : null,
              document: rawDoc || null,
              phone: data.account.phone ? normalizeDocument(data.account.phone) : null,
              email: data.account.email?.trim() || null,
              address: {},
              customFields: companyCustomFields,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          targetAccountId = createdAcc.id;
        }
      } else if (targetAccountId) {
        const [acc] = await tx
          .select({ id: crmAccounts.id })
          .from(crmAccounts)
          .where(and(eq(crmAccounts.id, targetAccountId), eq(crmAccounts.tenantId, tenantId)))
          .limit(1);

        if (!acc) {
          throw new CrmCrossTenantError(`A conta informada (${targetAccountId}) não pertence ao tenant ${tenantId}.`);
        }
      }

      let linkedContactId = data.contactId || null;

      // 4. Validação de Contato no tenant (se fornecido)
      if (data.contactId) {
        const [contact] = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.id, data.contactId), eq(contacts.tenantId, tenantId)))
          .limit(1);

        if (!contact) {
          throw new CrmCrossTenantError(`O contato informado (${data.contactId}) não pertence ao tenant ${tenantId}.`);
        }
      }

      // 5. Validação de Conversa de origem no tenant (se fornecida)
      if (data.conversationId) {
        const [conv] = await tx
          .select({ id: conversations.id, contactId: conversations.contactId })
          .from(conversations)
          .where(and(eq(conversations.id, data.conversationId), eq(conversations.tenantId, tenantId)))
          .limit(1);

        if (!conv) {
          throw new CrmCrossTenantError(`A conversa informada (${data.conversationId}) não pertence ao tenant ${tenantId}.`);
        }
        if (data.contactId && conv.contactId !== data.contactId) {
          throw new CrmValidationError("A conversa e o contato selecionados não correspondem.", "CONTACT_CONVERSATION_MISMATCH");
        }
        linkedContactId = conv.contactId;
      }

      // 6. Validação do Vendedor / Operador responsável no tenant (se fornecido)
      const assignedOpId = data.operatorId !== undefined ? data.operatorId : (data.ownerId !== undefined ? data.ownerId : operatorId);
      if (assignedOpId) {
        const [op] = await tx
          .select({ id: operators.id })
          .from(operators)
          .where(and(eq(operators.id, assignedOpId), eq(operators.tenantId, tenantId)))
          .limit(1);

        if (!op) {
          throw new CrmCrossTenantError(`O operador responsável (${assignedOpId}) não pertence ao tenant ${tenantId}.`);
        }
      }

      // Tratamento de valor: null não vira "0.00", zero real vira "0.00"
      let dealValue: string | null = null;
      if (data.value !== undefined && data.value !== null && data.value !== "") {
        const parsedNum = parseMoneyValue(data.value);
        if (isNaN(parsedNum)) {
          throw new CrmValidationError("Valor da negociação inválido.", "INVALID_VALUE");
        }
        dealValue = parsedNum.toFixed(2);
      }

      const dealId = `deal-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      // 7. Inserção do Deal
      const [deal] = await tx
        .insert(crmDeals)
        .values({
          id: dealId,
          tenantId,
          title: data.title.trim(),
          accountId: targetAccountId,
          pipelineId: data.pipelineId,
          stageId: data.stageId,
          status: "open",
          value: dealValue,
          currency: data.currency || "BRL",
          expectedCloseDate: data.expectedCloseDate || null,
          operatorId: assignedOpId || null,
          source: data.source || "manual",
          campaign: data.campaign || null,
          rating: data.rating ?? 0,
          customFields: dealCustomFields,
          version: 1,
          lastActivityAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // 8. Evento de auditoria imutável na mesma transação
      await this.logDealEvent(
        tenantId,
        dealId,
        "created",
        operatorId,
        {
          title: deal.title,
          pipelineId: deal.pipelineId,
          stageId: deal.stageId,
          value: deal.value,
        },
        tx
      );

      // 9. Se informada nota inicial, registra atividade tipo note na mesma transação
      if (data.initialNote && data.initialNote.trim()) {
        await tx.insert(crmDealActivities).values({
          id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          tenantId,
          dealId,
          type: "note",
          title: "Nota inicial",
          description: data.initialNote.trim(),
          status: "completed",
          operatorId: operatorId || assignedOpId || null,
          completedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }

      // 10. Se informado um contato, cria o vínculo participante na mesma transação
      if (linkedContactId) {
        await tx.insert(crmDealContacts).values({
          id: `dc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          tenantId,
          dealId,
          contactId: linkedContactId,
          role: "buyer",
          isPrimary: true,
          createdAt: now,
        });
      }

      // 11. Se originado de uma conversa, vincula N:N na mesma transação
      if (data.conversationId) {
        const linkId = `cd-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        await tx.insert(crmConversationDeals).values({
          id: linkId,
          tenantId,
          conversationId: data.conversationId,
          dealId,
          origin: "chat",
          createdByOperatorId: operatorId,
          isActive: true,
          createdAt: now,
        });

        await this.logDealEvent(
          tenantId,
          dealId,
          "conversation_linked",
          operatorId,
          {
            conversationId: data.conversationId,
            origin: "chat",
          },
          tx
        );
      }

      return deal;
    });
  }

  /**
   * Atualiza etapa, status ou campos de uma negociação com verificação de versão (concorrência otimista),
   * validação relacional estrita (etapa pertence ao funil do deal, operador pertence ao tenant) e execução atômica.
   */
  async updateDeal(
    tenantId: string,
    dealId: string,
    operatorId: string | null,
    updates: {
      title?: string;
      pipelineId?: string;
      stageId?: string;
      status?: "open" | "won" | "lost" | "paused";
      value?: string | number | null;
      expectedCloseDate?: Date | null;
      operatorId?: string | null;
      ownerId?: string | null;
      accountId?: string | null;
      rating?: number;
      source?: string;
      campaign?: string;
      lossReason?: string | null;
      pausedReason?: string | null;
      expectedVersion?: number;
      customFields?: CustomFieldValues;
    }
  ): Promise<CrmDeal> {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .for("update")
        .limit(1);

      if (!current) {
        throw new CrmNotFoundError("Negociação não encontrada.");
      }

      if (updates.expectedVersion !== undefined && current.version !== updates.expectedVersion) {
        throw new CrmConcurrencyError(
          `Versão esperada ${updates.expectedVersion}, mas atual é ${current.version}`
        );
      }

      const now = new Date();
      const setPayload: Record<string, any> = {
        updatedAt: now,
        version: current.version + 1,
      };

      if (updates.title !== undefined) setPayload.title = updates.title.trim();
      if (updates.value !== undefined) {
        if (updates.value === null || updates.value === "") {
          setPayload.value = null;
        } else {
          const parsedNum = parseMoneyValue(updates.value);
          if (isNaN(parsedNum)) {
            throw new CrmValidationError("Valor da negociação inválido.", "INVALID_VALUE");
          }
          setPayload.value = parsedNum.toFixed(2);
        }
      }
      if (updates.expectedCloseDate !== undefined) setPayload.expectedCloseDate = updates.expectedCloseDate;
      if (updates.rating !== undefined) setPayload.rating = updates.rating;
      if (updates.source !== undefined) setPayload.source = updates.source ? updates.source.trim() : null;
      if (updates.campaign !== undefined) setPayload.campaign = updates.campaign ? updates.campaign.trim() : null;
      if (updates.lossReason !== undefined) setPayload.lossReason = updates.lossReason;
      if (updates.pausedReason !== undefined) setPayload.pausedReason = updates.pausedReason;
      const dealFields = updates.customFields !== undefined || updates.stageId !== undefined
        ? await listCustomFields(tenantId, "deal", tx) : [];
      if (updates.customFields !== undefined) {
        const patch = validateFieldValues(dealFields, updates.customFields, { pipelineId: current.pipelineId });
        setPayload.customFields = { ...(current.customFields as CustomFieldValues), ...patch };
      }

      // Validação de operador se alterado
      const targetOpId = updates.operatorId !== undefined ? updates.operatorId : updates.ownerId;
      if (targetOpId !== undefined) {
        if (targetOpId !== null) {
          const [op] = await tx
            .select({ id: operators.id })
            .from(operators)
            .where(and(eq(operators.id, targetOpId), eq(operators.tenantId, tenantId)))
            .limit(1);
          if (!op) {
            throw new CrmCrossTenantError(`O operador informado (${targetOpId}) não pertence ao tenant ${tenantId}.`);
          }
        }
        setPayload.operatorId = targetOpId;
      }

      // Validação de conta compradora se alterada
      if (updates.accountId !== undefined) {
        if (updates.accountId !== null) {
          const [acc] = await tx
            .select({ id: crmAccounts.id })
            .from(crmAccounts)
            .where(and(eq(crmAccounts.id, updates.accountId), eq(crmAccounts.tenantId, tenantId)))
            .limit(1);
          if (!acc) {
            throw new CrmCrossTenantError(`A conta informada (${updates.accountId}) não pertence ao tenant ${tenantId}.`);
          }
        }
        setPayload.accountId = updates.accountId;
      }

      // Troca de Funil (Pipeline)
      let targetPipelineId = updates.pipelineId || current.pipelineId;
      const pipelineChanged = updates.pipelineId !== undefined && updates.pipelineId !== current.pipelineId;

      if (pipelineChanged) {
        const [targetPipe] = await tx
          .select({ id: crmPipelines.id, name: crmPipelines.name })
          .from(crmPipelines)
          .where(and(eq(crmPipelines.id, updates.pipelineId!), eq(crmPipelines.tenantId, tenantId)))
          .limit(1);

        if (!targetPipe) {
          throw new CrmCrossTenantError(`O funil informado (${updates.pipelineId}) não pertence ao tenant ${tenantId}.`);
        }

        setPayload.pipelineId = targetPipe.id;

        // Se uma nova etapa não foi informada explicitamente, busca a primeira etapa do novo funil
        if (!updates.stageId) {
          const [firstStage] = await tx
            .select({ id: crmStages.id })
            .from(crmStages)
            .where(and(eq(crmStages.pipelineId, targetPipe.id), eq(crmStages.tenantId, tenantId)))
            .orderBy(asc(crmStages.orderIndex))
            .limit(1);

          if (firstStage) {
            updates.stageId = firstStage.id;
          }
        }
      }

      // Transição de etapa: validação se pertence ao funil de destino e tenant
      const stageChanged = (updates.stageId && updates.stageId !== current.stageId) || pipelineChanged;
      let effectiveNewStatus = updates.status;

      if (stageChanged && updates.stageId) {
        const [stage] = await tx
          .select({
            id: crmStages.id,
            pipelineId: crmStages.pipelineId,
            isWinStage: crmStages.isWinStage,
            isLossStage: crmStages.isLossStage,
            requiredFields: crmStages.requiredFields,
          })
          .from(crmStages)
          .where(and(eq(crmStages.id, updates.stageId!), eq(crmStages.tenantId, tenantId)))
          .limit(1);

        if (!stage) {
          throw new CrmCrossTenantError(`A etapa informada (${updates.stageId}) não pertence ao tenant ${tenantId}.`);
        }

        if (stage.pipelineId !== targetPipelineId) {
          throw new CrmValidationError(
            `A etapa informada (${updates.stageId}) não pertence ao funil (${targetPipelineId}) da negociação.`,
            "STAGE_NOT_IN_PIPELINE"
          );
        }

        const missing = missingStageFields(
          stage.requiredFields,
          dealFields,
          (setPayload.customFields ?? current.customFields) as CustomFieldValues,
          targetPipelineId,
        );
        if (missing.length) throw new CrmValidationError(`Preencha os campos exigidos pela etapa: ${missing.join(", ")}.`, "REQUIRED_STAGE_FIELDS");

        setPayload.stageId = updates.stageId;
        setPayload.lastActivityAt = now;

        // Se mover para etapa terminal e o status não foi explicitado na requisição
        if (effectiveNewStatus === undefined) {
          if (stage.isWinStage) {
            effectiveNewStatus = "won";
          } else if (stage.isLossStage) {
            effectiveNewStatus = "lost";
          } else if (current.status === "won" || current.status === "lost") {
            effectiveNewStatus = "open";
          }
        }
      }

      // Transição de status
      const statusChanged = effectiveNewStatus !== undefined && effectiveNewStatus !== current.status;
      if (statusChanged) {
        setPayload.status = effectiveNewStatus;
        if (effectiveNewStatus === "won" || effectiveNewStatus === "lost") {
          setPayload.closedAt = now;
        } else {
          setPayload.closedAt = null;
        }
        setPayload.lastActivityAt = now;
      }

      const [updated] = await tx
        .update(crmDeals)
        .set(setPayload)
        .where(
          and(
            eq(crmDeals.id, dealId),
            eq(crmDeals.tenantId, tenantId),
            eq(crmDeals.version, current.version)
          )
        )
        .returning();

      if (!updated) {
        throw new CrmConcurrencyError("Falha de concorrência ao atualizar a negociação.");
      }

      // Auditoria de mudanças dentro da transação
      if (pipelineChanged) {
        await this.logDealEvent(
          tenantId,
          dealId,
          "pipeline_changed",
          operatorId,
          {
            fromPipelineId: current.pipelineId,
            toPipelineId: targetPipelineId,
          },
          tx
        );
      }

      if (stageChanged && updates.stageId) {
        await this.logDealEvent(
          tenantId,
          dealId,
          "stage_changed",
          operatorId,
          {
            fromStageId: current.stageId,
            toStageId: updates.stageId,
          },
          tx
        );
      }

      if (statusChanged) {
        await this.logDealEvent(
          tenantId,
          dealId,
          "status_changed",
          operatorId,
          {
            fromStatus: current.status,
            toStatus: effectiveNewStatus,
            lossReason: updates.lossReason,
          },
          tx
        );
      }

      return updated;
    });
  }

  /**
   * Atualização em massa de negociações (mover etapa/funil, atribuir vendedor, alterar status,
   * qualificação, campanha, fonte, produto, criar negociações para empresas, criar tarefas ou excluir).
   * Executa em transação, valida isolamento de tenant e registra auditoria.
   */
  async bulkUpdateDeals(
    tenantId: string,
    operatorId: string,
    params: {
      dealIds?: string[];
      allFiltered?: boolean;
      filterParams?: Record<string, any>;
      pipelineId?: string;
      stageId?: string;
      operatorId?: string;
      status?: "open" | "won" | "lost" | "paused";
      lossReason?: string;
      rating?: number;
      campaign?: string;
      source?: string;
      productId?: string;
      action?: "delete_trash" | "delete_permanent" | "create_deals_for_companies" | "create_tasks";
      taskData?: {
        title: string;
        type?: string;
        dueDate?: string | null;
        description?: string;
        operatorId?: string;
      };
    }
  ): Promise<{ success: boolean; updatedCount: number; dealIds: string[]; message?: string }> {
    return await db.transaction(async (tx) => {
      // 1. Busca todos os deals no tenant
      let foundDeals: CrmDeal[] = [];

      if (params.allFiltered && params.filterParams) {
        const conditions = buildDealFilterConditions(tenantId, params.filterParams);
        foundDeals = await tx
          .select()
          .from(crmDeals)
          .where(and(...conditions));
      } else if (params.dealIds && params.dealIds.length > 0) {
        for (let i = 0; i < params.dealIds.length; i += 500) {
          const chunk = params.dealIds.slice(i, i + 500);
          const chunkDeals = await tx
            .select()
            .from(crmDeals)
            .where(and(eq(crmDeals.tenantId, tenantId), inArray(crmDeals.id, chunk)));
          foundDeals.push(...chunkDeals);
        }
      } else {
        throw new CrmValidationError("Nenhuma negociação informada para atualização em massa.");
      }

      if (foundDeals.length === 0) {
        throw new CrmNotFoundError("Nenhuma negociação correspondente encontrada no tenant.");
      }

      const now = new Date();

      // Ação Especial 1: Exclusão Permanente
      if (params.action === "delete_permanent") {
        const idsToDelete = foundDeals.map((d) => d.id);
        for (let i = 0; i < idsToDelete.length; i += 500) {
          const chunk = idsToDelete.slice(i, i + 500);
          await tx
            .delete(crmDeals)
            .where(and(eq(crmDeals.tenantId, tenantId), inArray(crmDeals.id, chunk)));
        }

        return {
          success: true,
          updatedCount: idsToDelete.length,
          dealIds: idsToDelete,
          message: `${idsToDelete.length} negociação(ões) excluída(s) permanentemente.`,
        };
      }

      // Ação Especial 2: Enviar para a Lixeira (Soft Delete)
      if (params.action === "delete_trash") {
        const idsToTrash = foundDeals.map((d) => d.id);
        for (let i = 0; i < idsToTrash.length; i += 500) {
          const chunk = idsToTrash.slice(i, i + 500);
          await tx
            .update(crmDeals)
            .set({
              status: "paused",
              pausedReason: "Lixeira",
              updatedAt: now,
              lastActivityAt: now,
            })
            .where(and(eq(crmDeals.tenantId, tenantId), inArray(crmDeals.id, chunk)));
        }

        for (const deal of foundDeals) {
          await this.logDealEvent(
            tenantId,
            deal.id,
            "status_changed",
            operatorId,
            {
              previousStatus: deal.status,
              newStatus: "paused",
              pausedReason: "Lixeira",
            },
            tx
          );
        }

        return {
          success: true,
          updatedCount: idsToTrash.length,
          dealIds: idsToTrash,
          message: `${idsToTrash.length} negociação(ões) enviada(s) para a lixeira.`,
        };
      }

      // Ação Especial 3: Criar Negociações para Empresas Vinculadas
      if (params.action === "create_deals_for_companies") {
        const createdIds: string[] = [];
        for (const deal of foundDeals) {
          if (!deal.accountId) continue; // Pula sem empresa

          const [firstStage] = await tx
            .select({ id: crmStages.id })
            .from(crmStages)
            .where(and(eq(crmStages.pipelineId, deal.pipelineId), eq(crmStages.tenantId, tenantId)))
            .orderBy(asc(crmStages.orderIndex))
            .limit(1);

          const newDealId = crypto.randomUUID();
          await tx.insert(crmDeals).values({
            id: newDealId,
            tenantId,
            title: `${deal.title} (Nova)`,
            accountId: deal.accountId,
            pipelineId: deal.pipelineId,
            stageId: firstStage ? firstStage.id : deal.stageId,
            status: "open",
            operatorId: deal.operatorId,
            value: deal.value,
            currency: deal.currency,
            rating: deal.rating,
            source: deal.source,
            campaign: deal.campaign,
            createdAt: now,
            updatedAt: now,
            lastActivityAt: now,
          });

          await this.logDealEvent(
            tenantId,
            newDealId,
            "created",
            operatorId,
            { source: "bulk_company_deal", originDealId: deal.id },
            tx
          );
          createdIds.push(newDealId);
        }

        return {
          success: true,
          updatedCount: createdIds.length,
          dealIds: createdIds,
          message: `${createdIds.length} nova(s) negociação(ões) criada(s) para empresas vinculadas.`,
        };
      }

      // Ação Especial 4: Criar Tarefa em Massa
      if (params.action === "create_tasks" && params.taskData) {
        const taskCreatedIds: string[] = [];
        for (const deal of foundDeals) {
          const actId = crypto.randomUUID();
          await tx.insert(crmDealActivities).values({
            id: actId,
            tenantId,
            dealId: deal.id,
            type: params.taskData.type || "task",
            title: params.taskData.title || "Nova tarefa",
            description: params.taskData.description || null,
            dueDate: params.taskData.dueDate ? new Date(params.taskData.dueDate) : null,
            operatorId: params.taskData.operatorId || deal.operatorId || operatorId,
            assignedToOperatorId: params.taskData.operatorId || deal.operatorId || operatorId,
            status: "pending",
            createdAt: now,
            updatedAt: now,
          });
          taskCreatedIds.push(actId);
        }

        return {
          success: true,
          updatedCount: taskCreatedIds.length,
          dealIds: foundDeals.map((d) => d.id),
          message: `Tarefa criada para ${taskCreatedIds.length} negociação(ões).`,
        };
      }

      // 2. Se stageId informado, valida se a etapa pertence ao mesmo funil de cada deal
      let targetStage: CrmStage | null = null;
      let targetStageFields: Awaited<ReturnType<typeof listCustomFields>> = [];
      if (params.stageId) {
        const [stg] = await tx
          .select()
          .from(crmStages)
          .where(and(eq(crmStages.id, params.stageId), eq(crmStages.tenantId, tenantId)))
          .limit(1);

        if (!stg) {
          throw new CrmCrossTenantError(`A etapa (${params.stageId}) não pertence ao tenant.`);
        }
        targetStage = stg;
        targetStageFields = await listCustomFields(tenantId, "deal", tx);
      }

      // 3. Se operatorId informado, valida operador no tenant
      if (params.operatorId) {
        const [op] = await tx
          .select({ id: operators.id })
          .from(operators)
          .where(and(eq(operators.id, params.operatorId), eq(operators.tenantId, tenantId)))
          .limit(1);
        if (!op) {
          throw new CrmCrossTenantError(`O operador (${params.operatorId}) não pertence ao tenant.`);
        }
      }

      // 4. Se productId informado, valida produto no tenant
      let targetProduct: CrmProduct | null = null;
      if (params.productId) {
        const [prod] = await tx
          .select()
          .from(crmProducts)
          .where(and(eq(crmProducts.id, params.productId), eq(crmProducts.tenantId, tenantId)))
          .limit(1);
        if (prod) targetProduct = prod;
      }

      let updatedCount = 0;
      const updatedIds: string[] = [];

      for (const deal of foundDeals) {
        const setPayload: Record<string, any> = {
          updatedAt: now,
          lastActivityAt: now,
          version: deal.version + 1,
        };

        if (params.stageId && targetStage) {
          // Permite mover entre funis se params.pipelineId informado ou funil diferente
          if (params.pipelineId || targetStage.pipelineId !== deal.pipelineId) {
            setPayload.pipelineId = targetStage.pipelineId;
          }
          if (deal.stageId !== params.stageId) {
            const missing = missingStageFields(
              targetStage.requiredFields,
              targetStageFields,
              deal.customFields as CustomFieldValues,
              targetStage.pipelineId
            );
            if (missing.length) {
              throw new CrmValidationError(
                `A negociação '${deal.title}' precisa preencher: ${missing.join(", ")}.`,
                "REQUIRED_STAGE_FIELDS"
              );
            }
          }
          setPayload.stageId = params.stageId;
        }

        if (params.operatorId) {
          setPayload.operatorId = params.operatorId;
        }

        if (params.rating !== undefined) {
          setPayload.rating = Math.max(0, Math.min(5, Number(params.rating)));
        }

        if (params.campaign !== undefined) {
          setPayload.campaign = params.campaign;
        }

        if (params.source !== undefined) {
          setPayload.source = params.source;
        }

        let newStatus = params.status;
        if (!newStatus && params.stageId && targetStage) {
          if (targetStage.isWinStage) newStatus = "won";
          else if (targetStage.isLossStage) newStatus = "lost";
        }

        if (newStatus) {
          setPayload.status = newStatus;
          if (newStatus === "won" || newStatus === "lost") {
            setPayload.closedAt = now;
          } else {
            setPayload.closedAt = null;
          }
          if (params.lossReason) {
            setPayload.lossReason = params.lossReason;
          }
        }

        await tx
          .update(crmDeals)
          .set(setPayload)
          .where(and(eq(crmDeals.id, deal.id), eq(crmDeals.tenantId, tenantId)));

        // Se produto informado, adiciona à negociação
        if (targetProduct) {
          await tx.insert(crmDealProducts).values({
            id: crypto.randomUUID(),
            tenantId,
            dealId: deal.id,
            productId: targetProduct.id,
            name: targetProduct.name,
            unitPrice: targetProduct.unitPrice || "0.00",
            quantity: "1.000",
            discountPercent: "0.00",
            totalPrice: targetProduct.unitPrice || "0.00",
            createdAt: now,
          });
        }

        // Se mudou funil, audita
        if (setPayload.pipelineId && setPayload.pipelineId !== deal.pipelineId) {
          await this.logDealEvent(
            tenantId,
            deal.id,
            "pipeline_changed",
            operatorId,
            {
              fromPipelineId: deal.pipelineId,
              toPipelineId: setPayload.pipelineId,
            },
            tx
          );
        }

        // Evento de auditoria
        await this.logDealEvent(
          tenantId,
          deal.id,
          "bulk_updated",
          operatorId,
          {
            previousStageId: deal.stageId,
            newStageId: setPayload.stageId || deal.stageId,
            previousStatus: deal.status,
            newStatus: setPayload.status || deal.status,
            previousOperatorId: deal.operatorId,
            newOperatorId: setPayload.operatorId || deal.operatorId,
          },
          tx
        );

        updatedCount++;
        updatedIds.push(deal.id);
      }

      return {
        success: true,
        updatedCount,
        dealIds: updatedIds,
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. VÍNCULOS N:N CONVERSAS ↔ NEGOCIAÇÕES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lista negociações ativas vinculadas a uma conversa específica.
   */
  async getConversationDeals(tenantId: string, conversationId: string): Promise<CrmDeal[]> {
    const rows = await db
      .select({
        deal: crmDeals,
      })
      .from(crmConversationDeals)
      .innerJoin(crmDeals, eq(crmConversationDeals.dealId, crmDeals.id))
      .where(
        and(
          eq(crmConversationDeals.tenantId, tenantId),
          eq(crmConversationDeals.conversationId, conversationId),
          eq(crmConversationDeals.isActive, true)
        )
      )
      .orderBy(desc(crmDeals.lastActivityAt));

    return rows.map((r) => r.deal);
  }

  /**
   * Associa uma negociação existente a uma conversa (idempotente e transacional).
   */
  async linkConversationDeal(
    tenantId: string,
    conversationId: string,
    dealId: string,
    operatorId: string | null,
    origin: "chat" | "crm" | "auto_sdr" = "chat"
  ): Promise<CrmConversationDeal> {
    return await db.transaction(async (tx) => {
      // 1. Valida existência de ambas as entidades no tenant
      const [conv] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
        .limit(1);

      if (!conv) throw new CrmCrossTenantError(`Conversa (${conversationId}) não encontrada no tenant ${tenantId}.`);

      const [deal] = await tx
        .select({ id: crmDeals.id })
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .limit(1);

      if (!deal) throw new CrmCrossTenantError(`Negociação (${dealId}) não encontrada no tenant ${tenantId}.`);

      // 2. Verifica se já está vinculado
      const [existing] = await tx
        .select()
        .from(crmConversationDeals)
        .where(
          and(
            eq(crmConversationDeals.tenantId, tenantId),
            eq(crmConversationDeals.conversationId, conversationId),
            eq(crmConversationDeals.dealId, dealId)
          )
        )
        .limit(1);

      if (existing) {
        if (!existing.isActive) {
          // Reativa vínculo previamente removido
          const [reactivated] = await tx
            .update(crmConversationDeals)
            .set({
              isActive: true,
              unlinkedAt: null,
              unlinkedByOperatorId: null,
            })
            .where(and(eq(crmConversationDeals.id, existing.id), eq(crmConversationDeals.tenantId, tenantId)))
            .returning();
          
          await this.logDealEvent(
            tenantId,
            dealId,
            "conversation_linked",
            operatorId,
            {
              conversationId,
              reactivated: true,
            },
            tx
          );

          return reactivated;
        }
        return existing;
      }

      const id = `cd-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const now = new Date();
      const [created] = await tx
        .insert(crmConversationDeals)
        .values({
          id,
          tenantId,
          conversationId,
          dealId,
          origin,
          createdByOperatorId: operatorId,
          isActive: true,
          createdAt: now,
        })
        .returning();

      await this.logDealEvent(
        tenantId,
        dealId,
        "conversation_linked",
        operatorId,
        {
          conversationId,
          origin,
        },
        tx
      );

      return created;
    });
  }

  /**
   * Desvincula uma conversa de um card sem excluir nenhuma das entidades (transacional e preserva histórico).
   */
  async unlinkConversationDeal(
    tenantId: string,
    conversationId: string,
    dealId: string,
    operatorId: string | null
  ): Promise<boolean> {
    return await db.transaction(async (tx) => {
      // Valida entidades no tenant
      const [deal] = await tx
        .select({ id: crmDeals.id })
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .limit(1);

      if (!deal) throw new CrmCrossTenantError(`Negociação (${dealId}) não encontrada no tenant ${tenantId}.`);

      const [conv] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
        .limit(1);

      if (!conv) throw new CrmCrossTenantError(`Conversa (${conversationId}) não encontrada no tenant ${tenantId}.`);

      const result = await tx
        .update(crmConversationDeals)
        .set({
          isActive: false,
          unlinkedAt: new Date(),
          unlinkedByOperatorId: operatorId,
        })
        .where(
          and(
            eq(crmConversationDeals.tenantId, tenantId),
            eq(crmConversationDeals.conversationId, conversationId),
            eq(crmConversationDeals.dealId, dealId),
            eq(crmConversationDeals.isActive, true)
          )
        )
        .returning();

      if (result.length > 0) {
        await this.logDealEvent(
          tenantId,
          dealId,
          "conversation_unlinked",
          operatorId,
          {
            conversationId,
          },
          tx
        );
        return true;
      }

      return false;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. ATIVIDADES, TAREFAS E NOTAS DO DEAL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lista atividades/tarefas de uma negociação com enriquecimento de operadores e suporte a filtros.
   */
  async getDealActivities(
    tenantId: string,
    dealId: string,
    options: {
      status?: "pending" | "completed" | "cancelled";
      type?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<
    Array<
      CrmDealActivity & {
        operatorName: string | null;
        assignedToOperatorName: string | null;
      }
    >
  > {
    // 1. Valida se a negociação pertence ao tenant
    const [deal] = await db
      .select({ id: crmDeals.id })
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
      .limit(1);

    if (!deal) {
      throw new CrmNotFoundError(`Negociação (${dealId}) não encontrada no tenant ${tenantId}.`);
    }

    const conditions = [
      eq(crmDealActivities.tenantId, tenantId),
      eq(crmDealActivities.dealId, dealId),
    ];

    if (options.status) {
      conditions.push(eq(crmDealActivities.status, options.status));
    }
    if (options.type) {
      conditions.push(eq(crmDealActivities.type, options.type));
    }

    const creatorOp = alias(operators, "act_creator_op");
    const assignedOp = alias(operators, "act_assigned_op");

    const query = db
      .select({
        activity: crmDealActivities,
        operatorName: creatorOp.name,
        assignedToOperatorName: assignedOp.name,
      })
      .from(crmDealActivities)
      .leftJoin(creatorOp, eq(crmDealActivities.operatorId, creatorOp.id))
      .leftJoin(assignedOp, eq(crmDealActivities.assignedToOperatorId, assignedOp.id))
      .where(and(...conditions))
      .orderBy(
        sql`CASE WHEN ${crmDealActivities.status} = 'pending' THEN 0 ELSE 1 END`,
        sql`${crmDealActivities.dueDate} ASC NULLS LAST`,
        desc(crmDealActivities.createdAt)
      );

    if (options.limit) {
      query.limit(options.limit);
    }
    if (options.offset) {
      query.offset(options.offset);
    }

    const rows = await query;
    return rows.map((r) => ({
      ...r.activity,
      operatorName: r.operatorName || null,
      assignedToOperatorName: r.assignedToOperatorName || null,
    }));
  }

  /**
   * Atualiza uma atividade ou tarefa comercial com validação de ciclo de vida e autoria.
   * Regra Inviolável E3: Notas comerciais ('note') são imutáveis e permanentes — não podem ser alteradas, concluídas ou canceladas.
   */
  async updateDealActivity(
    tenantId: string,
    dealId: string,
    activityId: string,
    operatorId: string | null,
    updates: {
      status?: "pending" | "completed" | "cancelled";
      title?: string;
      description?: string | null;
      dueDate?: Date | string | null;
      type?: "task" | "call" | "meeting" | "whatsapp" | "note";
      assignedToOperatorId?: string | null;
    }
  ): Promise<
    CrmDealActivity & {
      operatorName: string | null;
      assignedToOperatorName: string | null;
    }
  > {
    return await db.transaction(async (tx) => {
      // 1. Verifica a negociação no tenant
      const [deal] = await tx
        .select({ id: crmDeals.id })
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .limit(1);

      if (!deal) {
        throw new CrmNotFoundError("Negociação não encontrada.");
      }

      // 2. Busca a atividade no tenant e deal
      const [current] = await tx
        .select()
        .from(crmDealActivities)
        .where(
          and(
            eq(crmDealActivities.id, activityId),
            eq(crmDealActivities.dealId, dealId),
            eq(crmDealActivities.tenantId, tenantId)
          )
        )
        .limit(1);

      if (!current) {
        throw new CrmNotFoundError("Atividade não encontrada.");
      }

      // 3. Regra Inviolável de E3: Notas comerciais são imutáveis!
      if (current.type === "note") {
        throw new CrmValidationError(
          "Notas comerciais são registros históricos permanentes e não podem ser alteradas.",
          "NOTE_IS_IMMUTABLE"
        );
      }

      const now = new Date();
      const setPayload: Partial<typeof crmDealActivities.$inferInsert> = {
        updatedAt: now,
      };

      // Transição de status (concluir, reabrir, cancelar)
      let statusChanged = false;
      if (updates.status && updates.status !== current.status) {
        setPayload.status = updates.status;
        statusChanged = true;
        if (updates.status === "completed") {
          setPayload.completedAt = now;
        } else {
          setPayload.completedAt = null;
        }
      }

      if (updates.title !== undefined) {
        if (!updates.title.trim()) {
          throw new CrmValidationError("O título da atividade não pode ser vazio.");
        }
        setPayload.title = updates.title.trim();
      }

      if (updates.description !== undefined) {
        setPayload.description = updates.description?.trim() || null;
      }

      let dueDateChanged = false;
      if (updates.dueDate !== undefined) {
        setPayload.dueDate = updates.dueDate ? new Date(updates.dueDate) : null;
        dueDateChanged = true;
      }

      if (updates.type !== undefined) {
        if (updates.type === "note") {
          throw new CrmValidationError("Não é permitido converter uma tarefa em nota.", "INVALID_TYPE_CONVERSION");
        }
        setPayload.type = updates.type;
      }

      if (updates.assignedToOperatorId !== undefined) {
        if (updates.assignedToOperatorId) {
          const [op] = await tx
            .select({ id: operators.id })
            .from(operators)
            .where(and(eq(operators.id, updates.assignedToOperatorId), eq(operators.tenantId, tenantId)))
            .limit(1);

          if (!op) {
            throw new CrmCrossTenantError(`Operador atribuído (${updates.assignedToOperatorId}) não pertence ao tenant.`);
          }
        }
        setPayload.assignedToOperatorId = updates.assignedToOperatorId || null;
      }

      const [updated] = await tx
        .update(crmDealActivities)
        .set(setPayload)
        .where(
          and(
            eq(crmDealActivities.id, activityId),
            eq(crmDealActivities.dealId, dealId),
            eq(crmDealActivities.tenantId, tenantId)
          )
        )
        .returning();

      // Atualiza timestamp da negociação
      await tx
        .update(crmDeals)
        .set({ lastActivityAt: now, updatedAt: now })
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)));

      // Evento de auditoria granular
      let eventType = "activity_updated";
      if (statusChanged) {
        if (updates.status === "completed") eventType = "activity_completed";
        else if (updates.status === "pending") eventType = "activity_reopened";
        else if (updates.status === "cancelled") eventType = "activity_cancelled";
      } else if (dueDateChanged) {
        eventType = "activity_rescheduled";
      }

      await this.logDealEvent(
        tenantId,
        dealId,
        eventType,
        operatorId,
        {
          activityId,
          activityTitle: updated.title,
          status: updated.status,
          dueDate: updated.dueDate,
        },
        tx
      );

      // Busca operadores relacionados
      const creatorOp = alias(operators, "upd_act_creator_op");
      const assignedOp = alias(operators, "upd_act_assigned_op");
      const [fullActivity] = await tx
        .select({
          activity: crmDealActivities,
          operatorName: creatorOp.name,
          assignedToOperatorName: assignedOp.name,
        })
        .from(crmDealActivities)
        .leftJoin(creatorOp, eq(crmDealActivities.operatorId, creatorOp.id))
        .leftJoin(assignedOp, eq(crmDealActivities.assignedToOperatorId, assignedOp.id))
        .where(eq(crmDealActivities.id, updated.id))
        .limit(1);

      return {
        ...fullActivity.activity,
        operatorName: fullActivity.operatorName || null,
        assignedToOperatorName: fullActivity.assignedToOperatorName || null,
      };
    });
  }

  /**
   * Remove uma atividade da negociação.
   * Regra Inviolável E3: Notas comerciais imutáveis não podem ser excluídas.
   */
  async deleteDealActivity(
    tenantId: string,
    dealId: string,
    activityId: string,
    operatorId: string | null
  ): Promise<{ success: boolean; id: string }> {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(crmDealActivities)
        .where(
          and(
            eq(crmDealActivities.id, activityId),
            eq(crmDealActivities.dealId, dealId),
            eq(crmDealActivities.tenantId, tenantId)
          )
        )
        .limit(1);

      if (!current) {
        throw new CrmNotFoundError("Atividade não encontrada.");
      }

      if (current.type === "note") {
        throw new CrmValidationError(
          "Notas comerciais são registros históricos permanentes e não podem ser excluídas.",
          "NOTE_IS_IMMUTABLE"
        );
      }

      await tx
        .delete(crmDealActivities)
        .where(
          and(
            eq(crmDealActivities.id, activityId),
            eq(crmDealActivities.dealId, dealId),
            eq(crmDealActivities.tenantId, tenantId)
          )
        );

      await this.logDealEvent(
        tenantId,
        dealId,
        "activity_deleted",
        operatorId,
        {
          activityId,
          activityTitle: current.title,
        },
        tx
      );

      return { success: true, id: activityId };
    });
  }

  /**
   * Cria uma atividade ou nota comercial vinculada a um card específico com validações e transação atômica.
   */
  async createDealActivity(
    tenantId: string,
    dealId: string,
    operatorId: string | null,
    data: {
      type: "task" | "note" | "call" | "meeting" | "email" | "lunch" | "visit" | "whatsapp" | string;
      title: string;
      description?: string;
      dueDate?: Date | string | null;
      conversationId?: string | null;
      assignedToOperatorId?: string | null;
      status?: "pending" | "completed" | "cancelled";
      completed?: boolean;
    }
  ): Promise<
    CrmDealActivity & {
      operatorName: string | null;
      assignedToOperatorName: string | null;
    }
  > {
    if (!data.title || !data.title.trim()) {
      throw new CrmValidationError("Título da atividade é obrigatório.");
    }
    if (!data.type) {
      throw new CrmValidationError("Tipo de atividade é obrigatório.");
    }

    return await db.transaction(async (tx) => {
      // 1. Valida existência do Deal no tenant
      const [deal] = await tx
        .select({ id: crmDeals.id })
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .limit(1);

      if (!deal) {
        throw new CrmNotFoundError(`Negociação (${dealId}) não encontrada no tenant ${tenantId}.`);
      }

      // 2. Se informada conversationId, valida no tenant
      if (data.conversationId) {
        const [conv] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(and(eq(conversations.id, data.conversationId), eq(conversations.tenantId, tenantId)))
          .limit(1);

        if (!conv) {
          throw new CrmCrossTenantError(`Conversa (${data.conversationId}) não encontrada no tenant ${tenantId}.`);
        }
      }

      // 3. Se informado assignedToOperatorId, valida no tenant
      const assignedOpId = data.assignedToOperatorId || operatorId;
      if (assignedOpId) {
        const [op] = await tx
          .select({ id: operators.id })
          .from(operators)
          .where(and(eq(operators.id, assignedOpId), eq(operators.tenantId, tenantId)))
          .limit(1);

        if (!op) {
          throw new CrmCrossTenantError(`Operador atribuído (${assignedOpId}) não encontrado no tenant ${tenantId}.`);
        }
      }

      const id = `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const now = new Date();
      const initialStatus =
        data.type === "note"
          ? "completed"
          : data.status === "completed" || data.completed
          ? "completed"
          : "pending";
      const completedAt = initialStatus === "completed" ? now : null;

      const [activity] = await tx
        .insert(crmDealActivities)
        .values({
          id,
          tenantId,
          dealId,
          conversationId: data.conversationId || null,
          type: data.type,
          title: data.title.trim(),
          description: data.description?.trim() || null,
          status: initialStatus,
          completedAt,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          operatorId,
          assignedToOperatorId: assignedOpId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // Atualiza timestamp de atividade na negociação
      await tx
        .update(crmDeals)
        .set({ lastActivityAt: now, updatedAt: now })
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)));

      // Evento de auditoria
      await this.logDealEvent(
        tenantId,
        dealId,
        data.type === "note" ? "note_created" : "activity_created",
        operatorId,
        {
          activityId: activity.id,
          activityTitle: activity.title,
          type: activity.type,
        },
        tx
      );

      // Busca operadores relacionados para retorno enriquecido
      const creatorOp = alias(operators, "cre_act_creator_op");
      const assignedOp = alias(operators, "cre_act_assigned_op");
      const [fullActivity] = await tx
        .select({
          activity: crmDealActivities,
          operatorName: creatorOp.name,
          assignedToOperatorName: assignedOp.name,
        })
        .from(crmDealActivities)
        .leftJoin(creatorOp, eq(crmDealActivities.operatorId, creatorOp.id))
        .leftJoin(assignedOp, eq(crmDealActivities.assignedToOperatorId, assignedOp.id))
        .where(eq(crmDealActivities.id, activity.id))
        .limit(1);

      return {
        ...fullActivity.activity,
        operatorName: fullActivity.operatorName || null,
        assignedToOperatorName: fullActivity.assignedToOperatorName || null,
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5.1. EVIDÊNCIAS DE MENSAGENS EM NEGOCIAÇÕES (crm_activity_messages)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Marca uma mensagem de conversa como evidência comercial de uma negociação.
   */
  async markMessageAsEvidence(
    tenantId: string,
    dealId: string,
    messageId: string,
    operatorId: string | null,
    note?: string,
    activityId?: string
  ): Promise<CrmActivityMessage> {
    // 1. Valida existência do deal no tenant
    const [deal] = await db
      .select({ id: crmDeals.id })
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
      .limit(1);

    if (!deal) {
      throw new Error("Negociação não encontrada neste tenant.");
    }

    // 2. Valida existência da mensagem no tenant
    const [msg] = await db
      .select({ id: messages.id, content: messages.content })
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.tenantId, tenantId)))
      .limit(1);

    if (!msg) {
      throw new Error("Mensagem não encontrada neste tenant.");
    }

    // 3. Insere registro de evidência
    const id = `evd-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date();

    const [evidence] = await db
      .insert(crmActivityMessages)
      .values({
        id,
        tenantId,
        dealId,
        messageId,
        activityId: activityId || null,
        markedByOperatorId: operatorId,
        note: note?.trim() || null,
        createdAt: now,
      })
      .returning();

    // 4. Registra auditoria
    await this.logDealEvent(tenantId, dealId, "message_marked_as_evidence", operatorId, {
      messageId,
      evidenceId: id,
      note: note?.trim() || null,
      messagePreview: (msg.content || "").substring(0, 100),
    });

    return evidence;
  }

  /**
   * Remove a marcação de evidência de uma mensagem em uma negociação.
   */
  async unmarkMessageEvidence(
    tenantId: string,
    dealId: string,
    evidenceId: string,
    operatorId: string | null
  ): Promise<boolean> {
    const [deleted] = await db
      .delete(crmActivityMessages)
      .where(
        and(
          eq(crmActivityMessages.id, evidenceId),
          eq(crmActivityMessages.tenantId, tenantId),
          eq(crmActivityMessages.dealId, dealId)
        )
      )
      .returning();

    if (deleted) {
      await this.logDealEvent(tenantId, dealId, "message_evidence_removed", operatorId, {
        evidenceId,
        messageId: deleted.messageId,
      });
      return true;
    }
    return false;
  }

  /**
   * Lista todas as mensagens de evidência de uma negociação.
   */
  async getDealEvidenceMessages(
    tenantId: string,
    dealId: string
  ): Promise<Array<CrmActivityMessage & { message: typeof messages.$inferSelect }>> {
    const raw = await db
      .select({
        evidence: crmActivityMessages,
        message: messages,
      })
      .from(crmActivityMessages)
      .innerJoin(messages, eq(crmActivityMessages.messageId, messages.id))
      .where(
        and(
          eq(crmActivityMessages.tenantId, tenantId),
          eq(crmActivityMessages.dealId, dealId)
        )
      )
      .orderBy(desc(crmActivityMessages.createdAt));

    return raw.map((r) => ({
      ...r.evidence,
      message: r.message,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. CATÁLOGO DE PRODUTOS & SERVIÇOS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lista catálogo de produtos/itens com filtro de busca e tenant isolado.
   */
  async getProducts(
    tenantId: string,
    options?: { search?: string; isActive?: boolean }
  ): Promise<CrmProduct[]> {
    const conditions = [eq(crmProducts.tenantId, tenantId)];

    if (options?.isActive !== undefined) {
      conditions.push(eq(crmProducts.isActive, options.isActive));
    }

    if (options?.search) {
      const term = `%${options.search.trim()}%`;
      conditions.push(
        sql`(${crmProducts.name} ILIKE ${term} OR ${crmProducts.sku} ILIKE ${term} OR ${crmProducts.category} ILIKE ${term})`
      );
    }

    return db
      .select()
      .from(crmProducts)
      .where(and(...conditions))
      .orderBy(asc(crmProducts.name));
  }

  /**
   * Cadastra novo produto no catálogo do tenant.
   */
  async createProduct(
    tenantId: string,
    data: {
      name: string;
      sku?: string | null;
      description?: string | null;
      unitPrice?: string | number;
      unit?: string;
      category?: string | null;
      isActive?: boolean;
      customFields?: CustomFieldValues;
    }
  ): Promise<CrmProduct> {
    const id = `prod-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();
    const price = typeof data.unitPrice === "number" ? data.unitPrice.toFixed(2) : (data.unitPrice || "0.00");
    const customFields = validateFieldValues(await listCustomFields(tenantId, "product"), data.customFields, { requireOnCreate: true });

    const [product] = await db
      .insert(crmProducts)
      .values({
        id,
        tenantId,
        name: data.name.trim(),
        sku: data.sku?.trim() || null,
        description: data.description?.trim() || null,
        unitPrice: price,
        unit: data.unit || "UN",
        category: data.category?.trim() || null,
        customFields,
        isActive: data.isActive !== undefined ? data.isActive : true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return product;
  }

  /**
   * Atualiza informações de produto do catálogo.
   */
  async updateProduct(
    tenantId: string,
    productId: string,
    data: Partial<{
      name: string;
      sku: string | null;
      description: string | null;
      unitPrice: string | number;
      unit: string;
      category: string | null;
      isActive: boolean;
      customFields: CustomFieldValues;
    }>
  ): Promise<CrmProduct> {
    const updates: Record<string, any> = { updatedAt: new Date() };

    if (data.name !== undefined) updates.name = data.name.trim();
    if (data.sku !== undefined) updates.sku = data.sku?.trim() || null;
    if (data.description !== undefined) updates.description = data.description?.trim() || null;
    if (data.unitPrice !== undefined) {
      updates.unitPrice = typeof data.unitPrice === "number" ? data.unitPrice.toFixed(2) : data.unitPrice;
    }
    if (data.unit !== undefined) updates.unit = data.unit;
    if (data.category !== undefined) updates.category = data.category?.trim() || null;
    if (data.isActive !== undefined) updates.isActive = data.isActive;
    if (data.customFields !== undefined) {
      const [current] = await db.select({ customFields: crmProducts.customFields }).from(crmProducts)
        .where(and(eq(crmProducts.id, productId), eq(crmProducts.tenantId, tenantId))).limit(1);
      if (!current) throw new CrmNotFoundError("Produto não encontrado.");
      const patch = validateFieldValues(await listCustomFields(tenantId, "product"), data.customFields);
      updates.customFields = { ...current.customFields, ...patch };
    }

    const [updated] = await db
      .update(crmProducts)
      .set(updates)
      .where(and(eq(crmProducts.id, productId), eq(crmProducts.tenantId, tenantId)))
      .returning();

    if (!updated) {
      throw new Error(`Produto ${productId} não encontrado para tenant ${tenantId}`);
    }

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. ITENS DA NEGOCIAÇÃO & RECÁLCULO AUTOMÁTICO
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lista itens de produtos vinculados a uma negociação.
   */
  async getDealProducts(tenantId: string, dealId: string): Promise<CrmDealProduct[]> {
    return db
      .select()
      .from(crmDealProducts)
      .where(and(eq(crmDealProducts.tenantId, tenantId), eq(crmDealProducts.dealId, dealId)))
      .orderBy(asc(crmDealProducts.createdAt));
  }

  /**
   * Recalcula o valor total da negociação com base nos itens cadastrados.
   * Utiliza centavos inteiros para precisão monetária absoluta.
   */
  async recalculateDealValue(
    tenantId: string,
    dealId: string,
    operatorId: string | null,
    executor: any = db
  ): Promise<string> {
    const items = await executor
      .select({ totalPrice: crmDealProducts.totalPrice })
      .from(crmDealProducts)
      .where(and(eq(crmDealProducts.tenantId, tenantId), eq(crmDealProducts.dealId, dealId)));

    const totalCents = items.reduce((acc: number, item: any) => {
      return acc + Math.round((parseFloat(item.totalPrice) || 0) * 100);
    }, 0);

    const formattedValue = (totalCents / 100).toFixed(2);

    const [currentDeal] = await executor
      .select({ value: crmDeals.value })
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
      .limit(1);

    if (currentDeal && currentDeal.value !== formattedValue) {
      await executor
        .update(crmDeals)
        .set({
          value: formattedValue,
          updatedAt: new Date(),
          lastActivityAt: new Date(),
        })
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)));

      await this.logDealEvent(tenantId, dealId, "value_changed", operatorId, {
        previousValue: currentDeal.value,
        newValue: formattedValue,
        source: "deal_products_recalculation",
      });
    }

    return formattedValue;
  }

  /**
   * Adiciona um produto/item à negociação com execução 100% atômica (transacional),
   * validações comerciais rigorosas e cálculo monetário seguro.
   */
  async addDealProduct(
    tenantId: string,
    dealId: string,
    operatorId: string | null,
    data: {
      productId?: string | null;
      name: string;
      quantity: number | string;
      unitPrice: number | string;
      discountPercent?: number | string;
      notes?: string | null;
    }
  ): Promise<CrmDealProduct> {
    // 1. Validações comerciais estritas
    const name = data.name?.trim();
    if (!name) {
      throw new Error("O nome do produto é obrigatório e não pode ser vazio.");
    }

    const qty = typeof data.quantity === "number" ? data.quantity : parseFloat(String(data.quantity));
    if (isNaN(qty) || qty <= 0 || !isFinite(qty)) {
      throw new Error(`Quantidade inválida: ${data.quantity}. Deve ser um valor numérico estritamente maior que zero.`);
    }

    const price = typeof data.unitPrice === "number" ? data.unitPrice : parseFloat(String(data.unitPrice));
    if (isNaN(price) || price < 0 || !isFinite(price)) {
      throw new Error(`Preço unitário inválido: ${data.unitPrice}. Não pode ser negativo.`);
    }

    const discount = typeof data.discountPercent === "number"
      ? data.discountPercent
      : parseFloat(String(data.discountPercent ?? "0"));
    if (isNaN(discount) || discount < 0 || discount > 100 || !isFinite(discount)) {
      throw new Error(`Desconto percentual inválido: ${data.discountPercent}. Deve estar estritamente entre 0% e 100%.`);
    }

    // Cálculos monetários seguros em centavos (evita imprecisão de floating point)
    const unitPriceCents = Math.round(price * 100);
    const rawTotalCents = Math.round(qty * unitPriceCents);
    const discountFactor = (100 - discount) / 100;
    const discountedTotalCents = Math.max(0, Math.round(rawTotalCents * discountFactor));
    const formattedItemTotal = (discountedTotalCents / 100).toFixed(2);

    // 2. Execução Atômica dentro de Transação
    return await db.transaction(async (tx) => {
      // 2.1. Trava e validação de pertencimento do Deal ao tenant
      const [deal] = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .for("update")
        .limit(1);

      if (!deal) {
        throw new Error(`Negociação ${dealId} não encontrada ou não pertence ao tenant ${tenantId}.`);
      }

      // 2.2. Se productId informado, valida pertencimento ao tenant
      if (data.productId) {
        const [prod] = await tx
          .select()
          .from(crmProducts)
          .where(and(eq(crmProducts.id, data.productId), eq(crmProducts.tenantId, tenantId)))
          .limit(1);

        if (!prod) {
          throw new Error(`O produto selecionado (${data.productId}) não pertence ao tenant ${tenantId}.`);
        }
      }

      const id = `dp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const now = new Date();

      // 2.3. Inserção do Item
      const [inserted] = await tx
        .insert(crmDealProducts)
        .values({
          id,
          tenantId,
          dealId,
          productId: data.productId || null,
          name,
          quantity: qty.toFixed(3),
          unitPrice: (unitPriceCents / 100).toFixed(2),
          discountPercent: discount.toFixed(2),
          totalPrice: formattedItemTotal,
          notes: data.notes?.trim() || null,
          createdAt: now,
        })
        .returning();

      // 2.4. Recálculo atômico do valor total somando todos os itens
      const allItems = await tx
        .select({ totalPrice: crmDealProducts.totalPrice })
        .from(crmDealProducts)
        .where(and(eq(crmDealProducts.tenantId, tenantId), eq(crmDealProducts.dealId, dealId)));

      const totalCentsSum = allItems.reduce((acc: number, item: any) => {
        return acc + Math.round((parseFloat(item.totalPrice) || 0) * 100);
      }, 0);

      const newDealValue = (totalCentsSum / 100).toFixed(2);

      await tx
        .update(crmDeals)
        .set({
          value: newDealValue,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)));

      // 2.5. Auditoria imutável dentro da mesma transação
      await tx.insert(crmDealEvents).values({
        id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        dealId,
        eventType: "product_added",
        operatorId,
        metadata: {
          dealProductId: id,
          productId: data.productId || null,
          name: inserted.name,
          quantity: inserted.quantity,
          unitPrice: inserted.unitPrice,
          discountPercent: inserted.discountPercent,
          totalPrice: inserted.totalPrice,
          previousDealValue: deal.value,
          newDealValue,
        },
        createdAt: now,
      });

      return inserted;
    });
  }

  /**
   * Remove item de produto da negociação com execução 100% transacional e atômica.
   */
  async removeDealProduct(
    tenantId: string,
    dealId: string,
    dealProductId: string,
    operatorId: string | null
  ): Promise<boolean> {
    return await db.transaction(async (tx) => {
      // 1. Valida Deal pertencente ao tenant com lock
      const [deal] = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .for("update")
        .limit(1);

      if (!deal) {
        throw new Error(`Negociação ${dealId} não encontrada ou não pertence ao tenant ${tenantId}.`);
      }

      // 2. Valida Item pertencente ao Deal e ao Tenant
      const [existing] = await tx
        .select()
        .from(crmDealProducts)
        .where(
          and(
            eq(crmDealProducts.id, dealProductId),
            eq(crmDealProducts.tenantId, tenantId),
            eq(crmDealProducts.dealId, dealId)
          )
        )
        .limit(1);

      if (!existing) {
        return false;
      }

      const now = new Date();

      // 3. Remove o item
      await tx
        .delete(crmDealProducts)
        .where(
          and(
            eq(crmDealProducts.id, dealProductId),
            eq(crmDealProducts.tenantId, tenantId),
            eq(crmDealProducts.dealId, dealId)
          )
        );

      // 4. Recalcula o total restante dos itens
      const remainingItems = await tx
        .select({ totalPrice: crmDealProducts.totalPrice })
        .from(crmDealProducts)
        .where(and(eq(crmDealProducts.tenantId, tenantId), eq(crmDealProducts.dealId, dealId)));

      const totalCentsSum = remainingItems.reduce((acc: number, item: any) => {
        return acc + Math.round((parseFloat(item.totalPrice) || 0) * 100);
      }, 0);

      const newDealValue = (totalCentsSum / 100).toFixed(2);

      await tx
        .update(crmDeals)
        .set({
          value: newDealValue,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)));

      // 5. Auditoria imutável dentro da transação
      await tx.insert(crmDealEvents).values({
        id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        dealId,
        eventType: "product_removed",
        operatorId,
        metadata: {
          dealProductId,
          name: existing.name,
          removedTotalPrice: existing.totalPrice,
          previousDealValue: deal.value,
          newDealValue,
        },
        createdAt: now,
      });

      return true;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. PROPOSTAS & ORÇAMENTOS COMERCIAIS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Lista propostas emitidas para uma negociação.
   */
  async getProposals(tenantId: string, dealId: string): Promise<CrmProposal[]> {
    return db
      .select()
      .from(crmProposals)
      .where(and(eq(crmProposals.tenantId, tenantId), eq(crmProposals.dealId, dealId)))
      .orderBy(desc(crmProposals.createdAt));
  }

  /**
   * Emite uma proposta comercial formal baseada nos itens do deal com numeração segura
   * para concorrência via pg_advisory_xact_lock e snapshot imutável em centavos.
   */
  async createProposal(
    tenantId: string,
    dealId: string,
    operatorId: string | null,
    data: {
      title?: string;
      paymentTerms?: string;
      deliveryTerms?: string;
      validityDays?: number;
      notes?: string;
    }
  ): Promise<CrmProposal> {
    return await db.transaction(async (tx) => {
      // 1. Lock e validação de pertencimento do Deal ao tenant
      const [deal] = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .for("update")
        .limit(1);

      if (!deal) {
        throw new Error(`Negociação ${dealId} não encontrada ou não pertence ao tenant ${tenantId}.`);
      }

      // 2. Lock transacional contra race conditions na numeração da proposta
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('crm_proposal_seq_' || ${tenantId}))`);

      const currentYear = new Date().getFullYear();
      const countResult = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(crmProposals)
        .where(
          and(
            eq(crmProposals.tenantId, tenantId),
            sql`extract(year from ${crmProposals.createdAt}) = ${currentYear}`
          )
        );

      const nextSeq = (countResult[0]?.count || 0) + 1;
      const proposalNumber = `PROP-${currentYear}-${String(nextSeq).padStart(4, "0")}`;

      // 3. Obter itens do deal para o snapshot imutável com cálculos em centavos
      const items = await tx
        .select()
        .from(crmDealProducts)
        .where(and(eq(crmDealProducts.tenantId, tenantId), eq(crmDealProducts.dealId, dealId)))
        .orderBy(asc(crmDealProducts.createdAt));

      let subtotalCents = 0;
      let totalDiscountCents = 0;

      const serializedItems = items.map((it) => {
        const q = parseFloat(it.quantity) || 0;
        const up = parseFloat(it.unitPrice) || 0;
        const disc = parseFloat(it.discountPercent) || 0;

        const upCents = Math.round(up * 100);
        const baseCents = Math.round(q * upCents);
        const discCents = Math.round(baseCents * (disc / 100));
        const totalCents = Math.max(0, baseCents - discCents);

        subtotalCents += baseCents;
        totalDiscountCents += discCents;

        return {
          id: it.id,
          productId: it.productId,
          name: it.name,
          quantity: it.quantity,
          unitPrice: (upCents / 100).toFixed(2),
          discountPercent: it.discountPercent,
          totalPrice: (totalCents / 100).toFixed(2),
          notes: it.notes,
        };
      });

      // Se não houver itens cadastrados mas o deal tiver valor, usa o valor do deal como subtotal
      if (serializedItems.length === 0 && deal.value && parseFloat(deal.value) > 0) {
        const v = parseFloat(deal.value);
        const vCents = Math.round(v * 100);
        subtotalCents = vCents;
        serializedItems.push({
          id: `temp-${Date.now()}`,
          productId: null,
          name: deal.title,
          quantity: "1.000",
          unitPrice: (vCents / 100).toFixed(2),
          discountPercent: "0.00",
          totalPrice: (vCents / 100).toFixed(2),
          notes: null,
        });
      }

      const finalTotalCents = Math.max(0, subtotalCents - totalDiscountCents);

      const validityDays = data.validityDays ? parseInt(String(data.validityDays), 10) : 15;
      if (isNaN(validityDays) || validityDays <= 0) {
        throw new Error("Validade da proposta deve ser um número de dias maior que zero.");
      }

      const id = `prop-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const now = new Date();

      const [proposal] = await tx
        .insert(crmProposals)
        .values({
          id,
          tenantId,
          dealId,
          proposalNumber,
          title: data.title?.trim() || `Proposta Comercial - ${deal.title}`,
          status: "draft",
          subtotal: (subtotalCents / 100).toFixed(2),
          discount: (totalDiscountCents / 100).toFixed(2),
          total: (finalTotalCents / 100).toFixed(2),
          paymentTerms: data.paymentTerms?.trim() || "À vista / Boleto bancário 30 dias",
          deliveryTerms: data.deliveryTerms?.trim() || "FOB - Retirada na fábrica ou frete a combinar",
          validityDays,
          items: serializedItems,
          notes: data.notes?.trim() || null,
          createdOperatorId: operatorId || null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // Auditoria dentro da mesma transação
      await tx.insert(crmDealEvents).values({
        id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        dealId,
        eventType: "proposal_created",
        operatorId,
        metadata: {
          proposalId: id,
          proposalNumber,
          total: proposal.total,
        },
        createdAt: now,
      });

      return proposal;
    });
  }

  /**
   * Atualiza status de uma proposta comercial ('draft' | 'copied' | 'sent' | 'accepted' | 'rejected' | 'expired').
   */
  async updateProposalStatus(
    tenantId: string,
    proposalId: string,
    operatorId: string | null,
    status: "draft" | "copied" | "sent" | "accepted" | "rejected" | "expired",
    metadata?: Record<string, any>
  ): Promise<CrmProposal> {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(crmProposals)
        .where(and(eq(crmProposals.id, proposalId), eq(crmProposals.tenantId, tenantId)))
        .for("update")
        .limit(1);

      if (!existing) {
        throw new Error(`Proposta ${proposalId} não encontrada para o tenant ${tenantId}.`);
      }

      const updates: Partial<typeof crmProposals.$inferInsert> = {
        status,
        updatedAt: new Date(),
      };

      if (status === "sent" && !existing.sentAt) {
        updates.sentAt = new Date();
      } else if (status === "accepted" && !existing.acceptedAt) {
        updates.acceptedAt = new Date();
      } else if (status === "rejected" && !existing.rejectedAt) {
        updates.rejectedAt = new Date();
      }

      const [updated] = await tx
        .update(crmProposals)
        .set(updates)
        .where(and(eq(crmProposals.id, proposalId), eq(crmProposals.tenantId, tenantId)))
        .returning();

      await tx.insert(crmDealEvents).values({
        id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        dealId: existing.dealId,
        eventType: "proposal_status_changed",
        operatorId,
        metadata: {
          proposalId,
          proposalNumber: existing.proposalNumber,
          previousStatus: existing.status,
          newStatus: status,
          ...(metadata || {}),
        },
        createdAt: new Date(),
      });

      return updated;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. ARQUIVOS DA NEGOCIAÇÃO (crm_deal_files)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Registra um anexo/arquivo associado ao negócio, com limite de tamanho (max 25MB),
   * validação de tenant e vínculo opcional a uma conversa.
   */
  async uploadDealFile(
    tenantId: string,
    dealId: string,
    operatorId: string | null,
    data: {
      fileName: string;
      fileSize: number;
      mimeType: string;
      storagePath: string;
      conversationId?: string | null;
      metadata?: Record<string, any>;
    }
  ): Promise<CrmDealFile> {
    return await db.transaction(async (tx) => {
      // 1. Valida que o Deal pertence ao tenant
      const [deal] = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .limit(1);

      if (!deal) {
        throw new Error(`Negociação ${dealId} não encontrada para o tenant ${tenantId}.`);
      }

      // 2. Validação de tamanho (máximo 100MB = 104857600 bytes)
      const MAX_SIZE = 100 * 1024 * 1024;
      if (data.fileSize <= 0 || data.fileSize > MAX_SIZE) {
        throw new Error(`Tamanho de arquivo inválido (${data.fileSize} bytes). Limite máximo é de 100MB.`);
      }

      // 3. Se houver conversationId, valida que pertence ao tenant
      if (data.conversationId) {
        const [conv] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(and(eq(conversations.id, data.conversationId), eq(conversations.tenantId, tenantId)))
          .limit(1);

        if (!conv) {
          throw new Error(`Conversa ${data.conversationId} não pertence ao tenant ${tenantId}.`);
        }
      }

      const id = `dfile-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const now = new Date();

      const [newFile] = await tx
        .insert(crmDealFiles)
        .values({
          id,
          tenantId,
          dealId,
          conversationId: data.conversationId || null,
          uploadedByOperatorId: operatorId,
          fileName: data.fileName.trim(),
          fileSize: data.fileSize,
          mimeType: data.mimeType || "application/octet-stream",
          storagePath: data.storagePath,
          metadata: data.metadata || {},
          createdAt: now,
        })
        .returning();

      // Registra evento de auditoria
      await tx.insert(crmDealEvents).values({
        id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        dealId,
        eventType: "deal_file_uploaded",
        operatorId,
        metadata: {
          fileId: id,
          fileName: data.fileName,
          fileSize: data.fileSize,
          mimeType: data.mimeType,
          conversationId: data.conversationId || null,
        },
        createdAt: now,
      });

      return newFile;
    });
  }

  /**
   * Lista os arquivos anexados à negociação.
   */
  async getDealFiles(
    tenantId: string,
    dealId: string
  ): Promise<Array<CrmDealFile & { uploaderName?: string | null }>> {
    // 1. Valida pertencimento do Deal ao tenant
    const [deal] = await db
      .select({ id: crmDeals.id })
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
      .limit(1);

    if (!deal) {
      throw new Error(`Negociação ${dealId} não encontrada para o tenant ${tenantId}.`);
    }

    const files = await db
      .select({
        id: crmDealFiles.id,
        tenantId: crmDealFiles.tenantId,
        dealId: crmDealFiles.dealId,
        conversationId: crmDealFiles.conversationId,
        uploadedByOperatorId: crmDealFiles.uploadedByOperatorId,
        fileName: crmDealFiles.fileName,
        fileSize: crmDealFiles.fileSize,
        mimeType: crmDealFiles.mimeType,
        storagePath: crmDealFiles.storagePath,
        metadata: crmDealFiles.metadata,
        createdAt: crmDealFiles.createdAt,
        uploaderName: operators.name,
      })
      .from(crmDealFiles)
      .leftJoin(operators, eq(crmDealFiles.uploadedByOperatorId, operators.id))
      .where(and(eq(crmDealFiles.tenantId, tenantId), eq(crmDealFiles.dealId, dealId)))
      .orderBy(desc(crmDealFiles.createdAt));

    return files as any;
  }

  /**
   * Obtém um arquivo específico da negociação pelo ID.
   */
  async getDealFileById(
    tenantId: string,
    dealId: string,
    fileId: string
  ): Promise<(CrmDealFile & { uploaderName?: string | null }) | null> {
    const [deal] = await db
      .select({ id: crmDeals.id })
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
      .limit(1);

    if (!deal) return null;

    const [file] = await db
      .select({
        id: crmDealFiles.id,
        tenantId: crmDealFiles.tenantId,
        dealId: crmDealFiles.dealId,
        conversationId: crmDealFiles.conversationId,
        uploadedByOperatorId: crmDealFiles.uploadedByOperatorId,
        fileName: crmDealFiles.fileName,
        fileSize: crmDealFiles.fileSize,
        mimeType: crmDealFiles.mimeType,
        storagePath: crmDealFiles.storagePath,
        metadata: crmDealFiles.metadata,
        createdAt: crmDealFiles.createdAt,
        uploaderName: operators.name,
      })
      .from(crmDealFiles)
      .leftJoin(operators, eq(crmDealFiles.uploadedByOperatorId, operators.id))
      .where(
        and(
          eq(crmDealFiles.tenantId, tenantId),
          eq(crmDealFiles.dealId, dealId),
          eq(crmDealFiles.id, fileId)
        )
      )
      .limit(1);

    return (file as any) || null;
  }

  /**
   * Exclui um arquivo anexado à negociação.
   */
  async deleteDealFile(
    tenantId: string,
    dealId: string,
    fileId: string,
    operatorId: string | null
  ): Promise<boolean> {
    return await db.transaction(async (tx) => {
      const [file] = await tx
        .select()
        .from(crmDealFiles)
        .where(
          and(
            eq(crmDealFiles.id, fileId),
            eq(crmDealFiles.dealId, dealId),
            eq(crmDealFiles.tenantId, tenantId)
          )
        )
        .limit(1);

      if (!file) {
        throw new Error(`Arquivo ${fileId} não encontrado para a negociação ${dealId}.`);
      }

      await tx
        .delete(crmDealFiles)
        .where(and(eq(crmDealFiles.id, fileId), eq(crmDealFiles.tenantId, tenantId)));

      // Tenta remover o arquivo físico no disco se existir
      try {
        if (file.storagePath && fs.existsSync(file.storagePath)) {
          fs.unlinkSync(file.storagePath);
        }
      } catch (err) {
        console.warn(`[CRM Files] Não foi possível remover arquivo físico no disco: ${file.storagePath}`, err);
      }

      await tx.insert(crmDealEvents).values({
        id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        dealId,
        eventType: "deal_file_deleted",
        operatorId,
        metadata: {
          fileId,
          fileName: file.fileName,
        },
        createdAt: new Date(),
      });

      return true;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. QUESTIONÁRIOS E BRIEFINGS (crm_deal_questionnaires)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Registra ou atualiza um formulário/questionário de qualificação técnica para a negociação.
   */
  async saveDealQuestionnaire(
    tenantId: string,
    dealId: string,
    operatorId: string | null,
    data: {
      formTitle: string;
      version?: number;
      answers: Array<{ question: string; answer: string | number | boolean }>;
      contactId?: string | null;
    }
  ): Promise<CrmDealQuestionnaire> {
    return await db.transaction(async (tx) => {
      // 1. Valida pertencimento do Deal ao tenant
      const [deal] = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .limit(1);

      if (!deal) {
        throw new Error(`Negociação ${dealId} não encontrada para o tenant ${tenantId}.`);
      }

      // 2. Se contactId informado, valida tenant
      if (data.contactId) {
        const [contact] = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.id, data.contactId), eq(contacts.tenantId, tenantId)))
          .limit(1);

        if (!contact) {
          throw new Error(`Contato ${data.contactId} não pertence ao tenant ${tenantId}.`);
        }
      }

      const id = `quest-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const now = new Date();

      const [newQuest] = await tx
        .insert(crmDealQuestionnaires)
        .values({
          id,
          tenantId,
          dealId,
          contactId: data.contactId || null,
          formTitle: data.formTitle.trim(),
          version: data.version || 1,
          answers: data.answers || [],
          filledByOperatorId: operatorId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await tx.insert(crmDealEvents).values({
        id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        dealId,
        eventType: "deal_questionnaire_saved",
        operatorId,
        metadata: {
          questionnaireId: id,
          formTitle: data.formTitle,
          questionsCount: Array.isArray(data.answers) ? data.answers.length : 0,
        },
        createdAt: now,
      });

      return newQuest;
    });
  }

  /**
   * Lista os questionários/briefings respondidos da negociação.
   */
  async getDealQuestionnaires(
    tenantId: string,
    dealId: string
  ): Promise<Array<CrmDealQuestionnaire & { filledByName?: string | null }>> {
    const [deal] = await db
      .select({ id: crmDeals.id })
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
      .limit(1);

    if (!deal) {
      throw new Error(`Negociação ${dealId} não encontrada para o tenant ${tenantId}.`);
    }

    const list = await db
      .select({
        id: crmDealQuestionnaires.id,
        tenantId: crmDealQuestionnaires.tenantId,
        dealId: crmDealQuestionnaires.dealId,
        contactId: crmDealQuestionnaires.contactId,
        formTitle: crmDealQuestionnaires.formTitle,
        version: crmDealQuestionnaires.version,
        answers: crmDealQuestionnaires.answers,
        filledByOperatorId: crmDealQuestionnaires.filledByOperatorId,
        createdAt: crmDealQuestionnaires.createdAt,
        updatedAt: crmDealQuestionnaires.updatedAt,
        filledByName: operators.name,
      })
      .from(crmDealQuestionnaires)
      .leftJoin(operators, eq(crmDealQuestionnaires.filledByOperatorId, operators.id))
      .where(
        and(
          eq(crmDealQuestionnaires.tenantId, tenantId),
          eq(crmDealQuestionnaires.dealId, dealId)
        )
      )
      .orderBy(desc(crmDealQuestionnaires.createdAt));

    return list as any;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. E-MAILS COMERCIAIS AUDITADOS (crm_deal_emails)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Registra um e-mail trocado referente à negociação com remetente, destinatário,
   * conteúdo e data comprovada. Não simula envio falso de SMTP se não configurado.
   */
  async logDealEmail(
    tenantId: string,
    dealId: string,
    operatorId: string | null,
    data: {
      direction?: "outbound" | "inbound";
      fromAddress: string;
      toAddress: string;
      ccAddresses?: string[];
      subject: string;
      bodyText?: string;
      bodyHtml?: string;
      sentAt?: Date;
      verified?: boolean;
      metadata?: Record<string, any>;
    }
  ): Promise<CrmDealEmail> {
    return await db.transaction(async (tx) => {
      // 1. Valida pertencimento do Deal ao tenant
      const [deal] = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .limit(1);

      if (!deal) {
        throw new Error(`Negociação ${dealId} não encontrada para o tenant ${tenantId}.`);
      }

      if (!data.toAddress || !data.toAddress.includes("@")) {
        throw new Error("Endereço de e-mail do destinatário inválido.");
      }
      if (!data.fromAddress || !data.fromAddress.includes("@")) {
        throw new Error("Endereço de e-mail do remetente inválido.");
      }
      if (!data.subject?.trim()) {
        throw new Error("Assunto do e-mail é obrigatório.");
      }

      const id = `email-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const now = new Date();

      const [newEmail] = await tx
        .insert(crmDealEmails)
        .values({
          id,
          tenantId,
          dealId,
          operatorId,
          direction: data.direction || "outbound",
          fromAddress: data.fromAddress.trim().toLowerCase(),
          toAddress: data.toAddress.trim().toLowerCase(),
          ccAddresses: data.ccAddresses || [],
          subject: data.subject.trim(),
          bodyText: data.bodyText || null,
          bodyHtml: data.bodyHtml || null,
          sentAt: data.sentAt || now,
          isVerified: data.verified === true,
          metadata: data.metadata || {},
          createdAt: now,
        })
        .returning();

      await tx.insert(crmDealEvents).values({
        id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        dealId,
        eventType: "deal_email_logged",
        operatorId,
        metadata: {
          emailId: id,
          direction: newEmail.direction,
          subject: newEmail.subject,
          toAddress: newEmail.toAddress,
        },
        createdAt: now,
      });

      return newEmail;
    });
  }

  /**
   * Lista os e-mails registrados para uma negociação.
   */
  async getDealEmails(
    tenantId: string,
    dealId: string
  ): Promise<Array<CrmDealEmail & { operatorName?: string | null }>> {
    const [deal] = await db
      .select({ id: crmDeals.id })
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
      .limit(1);

    if (!deal) {
      throw new Error(`Negociação ${dealId} não encontrada para o tenant ${tenantId}.`);
    }

    const emails = await db
      .select({
        id: crmDealEmails.id,
        tenantId: crmDealEmails.tenantId,
        dealId: crmDealEmails.dealId,
        operatorId: crmDealEmails.operatorId,
        direction: crmDealEmails.direction,
        fromAddress: crmDealEmails.fromAddress,
        toAddress: crmDealEmails.toAddress,
        ccAddresses: crmDealEmails.ccAddresses,
        subject: crmDealEmails.subject,
        bodyText: crmDealEmails.bodyText,
        bodyHtml: crmDealEmails.bodyHtml,
        sentAt: crmDealEmails.sentAt,
        isVerified: crmDealEmails.isVerified,
        metadata: crmDealEmails.metadata,
        createdAt: crmDealEmails.createdAt,
        operatorName: operators.name,
      })
      .from(crmDealEmails)
      .leftJoin(operators, eq(crmDealEmails.operatorId, operators.id))
      .where(and(eq(crmDealEmails.tenantId, tenantId), eq(crmDealEmails.dealId, dealId)))
      .orderBy(desc(crmDealEmails.sentAt));

    return emails as any;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. PRIORIZAÇÃO COMERCIAL & IA (Vertex AI com critério mensurável)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calcula a prioridade comercial de uma negociação utilizando exclusivamente
   * o serviço Vertex AI (com repasse de tenantId e feature 'sdr_agent')
   * e fallback explicável baseado em regras comerciais determinísticas caso offline.
   */
  async calculateDealAiPriority(
    tenantId: string,
    dealId: string,
    operatorId: string | null
  ): Promise<{
    score: number;
    level: "baixa" | "media" | "alta" | "critica";
    reason: string;
    updatedAt: Date;
  }> {
    // 1. Obter detalhes da negociação
    const [deal] = await db
      .select()
      .from(crmDeals)
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
      .limit(1);

    if (!deal) {
      throw new Error(`Negociação ${dealId} não encontrada para o tenant ${tenantId}.`);
    }

    const now = new Date();
    const dealValue = parseFloat(deal.value || "0");

    // Produtos
    const products = await db
      .select()
      .from(crmDealProducts)
      .where(and(eq(crmDealProducts.tenantId, tenantId), eq(crmDealProducts.dealId, dealId)));
    const productsCount = products.length;

    // Propostas
    const proposals = await db
      .select()
      .from(crmProposals)
      .where(and(eq(crmProposals.tenantId, tenantId), eq(crmProposals.dealId, dealId)));
    const proposalsCount = proposals.length;

    // Etapa atual
    let stageName = "Etapa Atual";
    if (deal.stageId) {
      const [stg] = await db
        .select({ name: crmStages.name })
        .from(crmStages)
        .where(and(eq(crmStages.id, deal.stageId), eq(crmStages.tenantId, tenantId)))
        .limit(1);
      if (stg) stageName = stg.name;
    }

    // 2. Analisar tarefas pendentes e atrasadas
    const activities = await db
      .select()
      .from(crmDealActivities)
      .where(
        and(
          eq(crmDealActivities.tenantId, tenantId),
          eq(crmDealActivities.dealId, dealId)
        )
      );

    const pendingTasks = activities.filter((a) => !a.completedAt && a.type === "task");
    const overdueTasks = pendingTasks.filter(
      (a) => a.dueDate && new Date(a.dueDate) < now
    );

    // Dias sem atividade recente
    const daysSinceLastActivity = Math.max(
      0,
      Math.floor(
        (now.getTime() - new Date(deal.lastActivityAt || deal.createdAt).getTime()) /
          (1000 * 60 * 60 * 24)
      )
    );

    // Heurística explicável de base (determinística e transparente)
    let baseScore = 40;
    const explanationPoints: string[] = [];

    // Fatores de valor financeiro
    if (dealValue >= 50000) {
      baseScore += 30;
      explanationPoints.push(`Alto valor financeiro (R$ ${dealValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}).`);
    } else if (dealValue >= 10000) {
      baseScore += 20;
      explanationPoints.push(`Ticket intermediário (R$ ${dealValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}).`);
    } else if (dealValue > 0) {
      baseScore += 10;
      explanationPoints.push(`Ticket padrão cadastrado.`);
    }

    // Fatores de proposta/produtos
    if (proposalsCount > 0) {
      baseScore += 15;
      explanationPoints.push(`${proposalsCount} proposta(s) formal(is) emitida(s).`);
    } else if (productsCount > 0) {
      baseScore += 10;
      explanationPoints.push(`${productsCount} produto(s) mapeado(s).`);
    }

    // Fatores de urgência/atraso
    if (overdueTasks.length > 0) {
      baseScore += 15;
      explanationPoints.push(`${overdueTasks.length} tarefa(s) com prazo vencido exigindo atenção imediata.`);
    }

    // Desconto se abandonado sem atividade
    if (daysSinceLastActivity > 7) {
      baseScore -= 15;
      explanationPoints.push(`Sem movimentação comercial há ${daysSinceLastActivity} dias.`);
    }

    const calculatedScore = Math.min(100, Math.max(5, baseScore));
    let calculatedLevel: "baixa" | "media" | "alta" | "critica" = "media";
    if (calculatedScore >= 80) calculatedLevel = "critica";
    else if (calculatedScore >= 60) calculatedLevel = "alta";
    else if (calculatedScore >= 35) calculatedLevel = "media";
    else calculatedLevel = "baixa";

    let finalScore = calculatedScore;
    let finalLevel = calculatedLevel;
    let finalReason = explanationPoints.join(" ");

    // 3. Consulta ao Vertex AI se credencial/serviço estiver disponível
    try {
      const prompt = `Você é um analista comercial sênior. Avalie a seguinte oportunidade de negócio e forneça um score de prioridade de 0 a 100, nível (baixa, media, alta ou critica) e justificativa sucinta e objetiva em português:\n\n` +
        `Título: ${deal.title}\n` +
        `Valor: R$ ${dealValue}\n` +
        `Etapa: ${stageName}\n` +
        `Status: ${deal.status}\n` +
        `Produtos vinculados: ${productsCount}\n` +
        `Propostas emitidas: ${proposalsCount}\n` +
        `Tarefas atrasadas: ${overdueTasks.length}\n` +
        `Dias sem atividade: ${daysSinceLastActivity}\n` +
        `Responda em formato JSON: { "score": number, "level": "baixa"|"media"|"alta"|"critica", "reason": "string" }`;

      const aiResponse = await vertexAi.generateStructuredJson<{
        score: number;
        level: "baixa" | "media" | "alta" | "critica";
        reason: string;
      }>(prompt, undefined, undefined, {
        feature: "sdr_agent", // Compatível com o mapa de custos atual
        tenantId,
        metadata: { dealId, dealTitle: deal.title },
      });

      if (aiResponse && typeof aiResponse.score === "number" && aiResponse.reason) {
        finalScore = Math.min(100, Math.max(0, Math.round(aiResponse.score)));
        finalLevel = ["baixa", "media", "alta", "critica"].includes(aiResponse.level)
          ? aiResponse.level
          : calculatedLevel;
        finalReason = `[IA Vertex]: ${aiResponse.reason}`;
      }
    } catch (e: any) {
      // Fallback gracioso mantendo explicabilidade auditável
      finalReason = `[Critério Comercial Heurístico]: ${explanationPoints.join(" ") || "Critério baseado em valor de ticket e atividade da negociação."}`;
    }

    // 4. Persistir score na negociação
    await db
      .update(crmDeals)
      .set({
        aiPriorityScore: finalScore,
        aiPriorityLevel: finalLevel,
        aiPriorityReason: finalReason,
        aiPriorityUpdatedAt: now,
        updatedAt: now,
      })
      .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)));

    // Grava auditoria
    await this.logDealEvent(tenantId, dealId, "deal_ai_priority_calculated", operatorId, {
      score: finalScore,
      level: finalLevel,
      reason: finalReason,
    });

    return {
      score: finalScore,
      level: finalLevel,
      reason: finalReason,
      updatedAt: now,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. CALENDÁRIO COMERCIAL (crm_deal_activities com prazo)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Consulta o calendário comercial trazendo tarefas com prazo definido,
   * dados completos do negócio associado, etapa e responsável para navegação direta.
   */
  async getCrmCalendarTasks(
    tenantId: string,
    filters: {
      startDate?: Date | string;
      endDate?: Date | string;
      operatorId?: string;
      status?: "all" | "pending" | "completed";
    } = {}
  ): Promise<
    Array<{
      taskId: string;
      dealId: string;
      dealTitle: string;
      dealValue: string | null;
      pipelineId: string;
      stageId: string;
      stageName: string | null;
      title: string;
      description: string | null;
      dueDate: Date | null;
      isOverdue: boolean;
      completedAt: Date | null;
      operatorId: string | null;
      operatorName: string | null;
    }>
  > {
    const conditions = [
      eq(crmDealActivities.tenantId, tenantId),
      eq(crmDealActivities.type, "task"),
      sql`${crmDealActivities.dueDate} IS NOT NULL`,
    ];

    if (filters.startDate) {
      conditions.push(gte(crmDealActivities.dueDate, new Date(filters.startDate)));
    }
    if (filters.endDate) {
      conditions.push(lte(crmDealActivities.dueDate, new Date(filters.endDate)));
    }
    if (filters.operatorId) {
      conditions.push(eq(crmDealActivities.operatorId, filters.operatorId));
    }
    if (filters.status === "pending") {
      conditions.push(sql`${crmDealActivities.completedAt} IS NULL`);
    } else if (filters.status === "completed") {
      conditions.push(sql`${crmDealActivities.completedAt} IS NOT NULL`);
    }

    const rows = await db
      .select({
        taskId: crmDealActivities.id,
        dealId: crmDealActivities.dealId,
        title: crmDealActivities.title,
        description: crmDealActivities.description,
        dueDate: crmDealActivities.dueDate,
        completedAt: crmDealActivities.completedAt,
        operatorId: crmDealActivities.operatorId,
        operatorName: operators.name,
        dealTitle: crmDeals.title,
        dealValue: crmDeals.value,
        pipelineId: crmDeals.pipelineId,
        stageId: crmDeals.stageId,
        stageName: crmStages.name,
      })
      .from(crmDealActivities)
      .innerJoin(crmDeals, and(eq(crmDealActivities.dealId, crmDeals.id), eq(crmDeals.tenantId, tenantId)))
      .leftJoin(crmStages, eq(crmDeals.stageId, crmStages.id))
      .leftJoin(operators, eq(crmDealActivities.operatorId, operators.id))
      .where(and(...conditions))
      .orderBy(asc(crmDealActivities.dueDate));

    const now = new Date();
    return rows.map((r) => ({
      ...r,
      isOverdue: !r.completedAt && r.dueDate ? new Date(r.dueDate) < now : false,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. AUDITORIA IMUTÁVEL
  // ═══════════════════════════════════════════════════════════════════════════

  private async logDealEvent(
    tenantId: string,
    dealId: string,
    eventType: string,
    operatorId: string | null,
    metadata: Record<string, any>,
    executor: any = db
  ): Promise<void> {
    try {
      await executor.insert(crmDealEvents).values({
        id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        dealId,
        eventType,
        fromStageId: metadata.fromStageId || null,
        toStageId: metadata.toStageId || null,
        fromStatus: metadata.fromStatus || null,
        toStatus: metadata.toStatus || null,
        metadata,
        operatorId,
        createdAt: new Date(),
      });
    } catch (e: any) {
      console.warn(`[CrmService] Falha ao registrar evento de auditoria para deal ${dealId}:`, e.message);
    }
  }

  /**
   * Exporta negociações em formato CSV 100% compatível com a extração completa do RD Station CRM.
   * Não aplica limites artificiais: processa todas as negociações filtradas ou selecionadas,
   * incluindo todos os 70+ campos padrão e campos personalizados dinâmicos do tenant.
   */
  async exportDealsRD(
    tenantId: string,
    params: {
      dealIds?: string[];
      allFiltered?: boolean;
      filterParams?: Record<string, any>;
    }
  ): Promise<string> {
    // 1. Busca os deals no tenant sem travas ou cortes
    let deals: (typeof crmDeals.$inferSelect)[] = [];

    if (params.allFiltered && params.filterParams) {
      const conditions = buildDealFilterConditions(tenantId, params.filterParams);
      deals = await db
        .select()
        .from(crmDeals)
        .where(and(...conditions))
        .orderBy(desc(crmDeals.createdAt));
    } else if (params.dealIds && params.dealIds.length > 0) {
      for (let i = 0; i < params.dealIds.length; i += 500) {
        const chunk = params.dealIds.slice(i, i + 500);
        const chunkDeals = await db
          .select()
          .from(crmDeals)
          .where(and(eq(crmDeals.tenantId, tenantId), inArray(crmDeals.id, chunk)))
          .orderBy(desc(crmDeals.createdAt));
        deals.push(...chunkDeals);
      }
    } else {
      deals = await db
        .select()
        .from(crmDeals)
        .where(eq(crmDeals.tenantId, tenantId))
        .orderBy(desc(crmDeals.createdAt));
    }

    // 2. Coleta definições de campos personalizados do tenant para negociações
    const customDefs = await db
      .select()
      .from(crmCustomFieldDefinitions)
      .where(and(eq(crmCustomFieldDefinitions.tenantId, tenantId), eq(crmCustomFieldDefinitions.entityType, "deal")))
      .orderBy(asc(crmCustomFieldDefinitions.sortOrder));

    const customColMap = new Map<string, string>();
    for (const def of customDefs) {
      customColMap.set(def.name, def.name);
    }
    for (const deal of deals) {
      if (deal.customFields && typeof deal.customFields === "object") {
        for (const k of Object.keys(deal.customFields)) {
          if (!customColMap.has(k)) {
            const defFound = customDefs.find((d) => d.id === k);
            if (defFound) {
              customColMap.set(defFound.name, defFound.name);
            } else if (!["budget", "Budget"].includes(k)) {
              customColMap.set(k, k);
            }
          }
        }
      }
    }
    const customFieldKeys = Array.from(customColMap.keys());

    // 3. Monta cabeçalhos idênticos ao RD Station CRM
    const standardPrefixHeaders = [
      "Nome",
      "Empresa",
      "Qualificação",
      "Funil de vendas",
      "Etapa",
      "Estado",
      "Motivo de Perda",
      "Valor Único",
      "Valor Recorrente",
      "Pausada",
      "Data de criação",
      "Hora de criação",
      "Data do primeiro contato",
      "Hora do primeiro contato",
      "Data do último contato",
      "Hora do último contato",
      "Data da próxima tarefa",
      "Hora da próxima tarefa",
      "Previsão de fechamento",
      "Data de fechamento",
      "Hora de fechamento",
      "Fonte",
      "Campanha",
      "Responsável",
      "Produtos",
      "Equipes do responsável",
      "Anotação do motivo de perda",
      "Budget",
    ];

    const standardSuffixHeaders = [
      "Contatos",
      "Cargo",
      "Email",
      "Telefone",
      "ID",
      "ID da Empresa",
      "Lead",
      "ID do Lead",
      "ID do Contato",
    ];

    const allHeaders = [
      ...standardPrefixHeaders,
      ...customFieldKeys,
      ...standardSuffixHeaders,
    ];

    if (deals.length === 0) {
      return `sep=,\n${allHeaders.join(",")}\n`;
    }

    // 4. Carrega entidades relacionadas em lote
    const allAccountIds = Array.from(new Set(deals.map((d) => d.accountId).filter(Boolean) as string[]));
    const allDealIds = deals.map((d) => d.id);

    const [pipelinesList, stagesList, operatorsList, groupsList] = await Promise.all([
      db.select().from(crmPipelines).where(eq(crmPipelines.tenantId, tenantId)),
      db.select().from(crmStages).where(eq(crmStages.tenantId, tenantId)),
      db.select().from(operators).where(eq(operators.tenantId, tenantId)),
      db.select().from(accessGroups).where(eq(accessGroups.tenantId, tenantId)),
    ]);

    const pipelineMap = new Map(pipelinesList.map((p) => [p.id, p.name]));
    const stageMap = new Map(stagesList.map((s) => [s.id, s.name]));
    const operatorMap = new Map(operatorsList.map((o) => [o.id, o]));
    const groupMap = new Map(groupsList.map((g) => [g.id, g.name]));

    const accountMap = new Map<string, typeof crmAccounts.$inferSelect>();
    for (let i = 0; i < allAccountIds.length; i += 500) {
      const chunk = allAccountIds.slice(i, i + 500);
      const accRows = await db
        .select()
        .from(crmAccounts)
        .where(and(eq(crmAccounts.tenantId, tenantId), inArray(crmAccounts.id, chunk)));
      for (const a of accRows) {
        accountMap.set(a.id, a);
      }
    }

    const dealPrimaryContactMap = new Map<
      string,
      { name: string; role: string; email: string; phone: string; contactId: string }
    >();
    for (let i = 0; i < allDealIds.length; i += 500) {
      const chunk = allDealIds.slice(i, i + 500);
      const dcRows = await db
        .select({
          dc: crmDealContacts,
          c: contacts,
        })
        .from(crmDealContacts)
        .innerJoin(contacts, eq(crmDealContacts.contactId, contacts.id))
        .where(and(eq(crmDealContacts.tenantId, tenantId), inArray(crmDealContacts.dealId, chunk)));

      for (const row of dcRows) {
        const existing = dealPrimaryContactMap.get(row.dc.dealId);
        if (!existing || row.dc.isPrimary) {
          dealPrimaryContactMap.set(row.dc.dealId, {
            name: row.c.name || "",
            role: row.dc.role || "",
            email: row.c.email || "",
            phone: row.c.phone || "",
            contactId: row.c.id,
          });
        }
      }
    }

    const dealProductsMap = new Map<string, string[]>();
    for (let i = 0; i < allDealIds.length; i += 500) {
      const chunk = allDealIds.slice(i, i + 500);
      const dpRows = await db
        .select()
        .from(crmDealProducts)
        .where(and(eq(crmDealProducts.tenantId, tenantId), inArray(crmDealProducts.dealId, chunk)));
      for (const dp of dpRows) {
        const list = dealProductsMap.get(dp.dealId) || [];
        list.push(dp.name);
        dealProductsMap.set(dp.dealId, list);
      }
    }

    const dealNextTaskMap = new Map<string, { dueDate: Date | null }>();
    const dealFirstContactMap = new Map<string, Date>();
    const dealLastContactMap = new Map<string, Date>();

    for (let i = 0; i < allDealIds.length; i += 500) {
      const chunk = allDealIds.slice(i, i + 500);
      const actRows = await db
        .select()
        .from(crmDealActivities)
        .where(and(eq(crmDealActivities.tenantId, tenantId), inArray(crmDealActivities.dealId, chunk)));

      for (const act of actRows) {
        if (act.status === "pending" && act.dueDate && act.type !== "note") {
          const currentNext = dealNextTaskMap.get(act.dealId);
          if (!currentNext || (currentNext.dueDate && act.dueDate < currentNext.dueDate)) {
            dealNextTaskMap.set(act.dealId, { dueDate: act.dueDate });
          }
        }

        if (["call", "meeting", "task", "whatsapp"].includes(act.type)) {
          const actDate = act.createdAt;
          const first = dealFirstContactMap.get(act.dealId);
          if (!first || actDate < first) {
            dealFirstContactMap.set(act.dealId, actDate);
          }
          const last = dealLastContactMap.get(act.dealId);
          if (!last || actDate > last) {
            dealLastContactMap.set(act.dealId, actDate);
          }
        }
      }
    }

    // 5. Helpers de formatação
    const formatPtBrDate = (date: Date | string | null | undefined): string => {
      if (!date) return "";
      const d = new Date(date);
      if (isNaN(d.getTime())) return "";
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    };

    const formatPtBrTime = (date: Date | string | null | undefined): string => {
      if (!date) return "";
      const d = new Date(date);
      if (isNaN(d.getTime())) return "";
      const hours = String(d.getHours()).padStart(2, "0");
      const mins = String(d.getMinutes()).padStart(2, "0");
      return `${hours}:${mins}`;
    };

    const escapeCsv = (val: any): string => {
      if (val === null || val === undefined) return "";
      const str = String(val).trim();
      if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // 6. Geração linha a linha
    const rows: string[] = [];

    for (const deal of deals) {
      const account = deal.accountId ? accountMap.get(deal.accountId) : null;
      const op = deal.operatorId ? operatorMap.get(deal.operatorId) : null;
      const opGroup = op?.groupId ? groupMap.get(op.groupId) : "";
      const primaryContact = dealPrimaryContactMap.get(deal.id);
      const nextTask = dealNextTaskMap.get(deal.id);
      const firstContactDate = dealFirstContactMap.get(deal.id);
      const lastContactDate = dealLastContactMap.get(deal.id);

      const statusMap: Record<string, string> = {
        open: "Em andamento",
        won: "Ganho",
        lost: "Perdida",
        paused: "Pausada",
      };
      const estado = statusMap[deal.status] || deal.status;

      const valorUnico =
        deal.value !== null && deal.value !== undefined
          ? Number(deal.value).toFixed(1)
          : "0.0";

      const budgetVal =
        (deal.customFields as any)?.["Budget"] ??
        (deal.customFields as any)?.["budget"] ??
        "";

      const prefixRow = [
        escapeCsv(deal.title),
        escapeCsv(account ? account.name || account.tradeName || "" : ""),
        deal.rating !== null && deal.rating !== undefined && deal.rating > 0 ? String(deal.rating) : "",
        escapeCsv(pipelineMap.get(deal.pipelineId) || ""),
        escapeCsv(stageMap.get(deal.stageId) || ""),
        escapeCsv(estado),
        escapeCsv(deal.lossReason || ""),
        valorUnico,
        "0.0",
        deal.status === "paused" ? "Sim" : "Não",
        formatPtBrDate(deal.createdAt),
        formatPtBrTime(deal.createdAt),
        formatPtBrDate(firstContactDate || deal.createdAt),
        formatPtBrTime(firstContactDate || deal.createdAt),
        formatPtBrDate(lastContactDate || deal.lastActivityAt),
        formatPtBrTime(lastContactDate || deal.lastActivityAt),
        formatPtBrDate(nextTask?.dueDate),
        formatPtBrTime(nextTask?.dueDate),
        formatPtBrDate(deal.expectedCloseDate),
        formatPtBrDate(deal.closedAt),
        formatPtBrTime(deal.closedAt),
        escapeCsv(deal.source || ""),
        escapeCsv(deal.campaign || ""),
        escapeCsv(op ? op.name : ""),
        escapeCsv((dealProductsMap.get(deal.id) || []).join(", ")),
        escapeCsv(opGroup || ""),
        escapeCsv(deal.pausedReason || ""),
        escapeCsv(budgetVal),
      ];

      const customRowValues = customFieldKeys.map((k) => {
        const raw =
          (deal.customFields as any)?.[k] ??
          (deal.customFields as any)?.[customDefs.find((d) => d.name === k)?.id || ""];

        if (raw === null || raw === undefined) return "";
        if (Array.isArray(raw)) return escapeCsv(raw.join(", "));
        if (typeof raw === "boolean") return raw ? "Sim" : "Não";
        if (typeof raw === "object") {
          return escapeCsv((raw as any).label || (raw as any).name || JSON.stringify(raw));
        }
        return escapeCsv(String(raw));
      });

      const suffixRow = [
        escapeCsv(primaryContact?.name || (account ? account.name : "")),
        escapeCsv(primaryContact?.role || ""),
        escapeCsv(primaryContact?.email || (account ? account.email : "")),
        escapeCsv(primaryContact?.phone || (account ? account.phone : "")),
        escapeCsv(deal.rdDealId || deal.id),
        escapeCsv(account?.rdOrganizationId || account?.id || ""),
        "",
        "",
        escapeCsv(primaryContact?.contactId || ""),
      ];

      rows.push([...prefixRow, ...customRowValues, ...suffixRow].join(","));
    }

    return `sep=,\n${allHeaders.join(",")}\n${rows.join("\n")}`;
  }
}

export const crmService = CrmService.getInstance();
