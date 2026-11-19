import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import {
  contacts,
  conversations,
  crmDealActivities,
  crmDeals,
  crmDealContacts,
  crmPipelines,
  crmStages,
  crmAccounts,
  operators,
} from "../../db/schema";
import { eq, and, sql, desc, inArray, or, gte, lte, type SQL } from "drizzle-orm";
import { requireSession } from "../../lib/auth-session";
import { crmService } from "../../lib/crm/crm-service";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export interface KanbanTasksQueryOptions {
  operatorId?: string | null;
  email?: string | null;
  isAdmin?: boolean;
  all?: boolean;
  scope?: "all_visible" | "mine" | "delegated" | "all";
  filterOperatorId?: string | null;
  fromDate?: Date | null;
  toDate?: Date | null;
  includeUpcomingAlertWindow?: boolean;
  statusFilter?: "all" | "open" | "overdue" | "completed" | null;
  typeFilter?: string | null;
  searchQuery?: string | null;
  limit?: number | null;
  offset?: number | null;
  includeSummary?: boolean;
  /** Cap máximo interno (default 500 para API pública; rotas executivas podem usar até 1500) */
  maxLimit?: number;
  /** Ordenação: due_asc (padrão calendário) ou pending_priority (pendentes/atrasadas primeiro) */
  orderMode?: "due_asc" | "pending_priority";
}

export interface KanbanTasksSummary {
  pendingCount: number;
  overdueCount: number;
  completedCount: number;
  totalCount: number;
}

function extractRows<T = any>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as any).rows)) {
    return (result as any).rows as T[];
  }
  return [];
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length <= size) return items.length ? [items] : [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Constrói as condições estritas de isolamento multi-tenant, escopo e propriedade
 * compartilhadas entre listagem, resumo de contadores e ações em lote.
 */
export function buildKanbanTasksVisibilityConditions(
  tenantId: string,
  options: Pick<
    KanbanTasksQueryOptions,
    "operatorId" | "isAdmin" | "all" | "scope" | "filterOperatorId"
  >,
): SQL[] {
  const conditions: SQL[] = [
    eq(crmDealActivities.tenantId, tenantId),
    sql`${crmDealActivities.type} NOT IN ('note', 'system_event')`,
    sql`${crmDealActivities.status} != 'cancelled'`,
  ];

  const canSeeAll = Boolean(options.isAdmin && (options.all || options.scope === "all"));

  const isAssignedToOpSql = (opId: string) =>
    or(
      eq(crmDealActivities.assignedToOperatorId, opId),
      sql`${crmDealActivities.assignedToOperatorIds} @> ${JSON.stringify([opId])}::jsonb`,
    )!;

  if (options.filterOperatorId && options.filterOperatorId !== "all") {
    conditions.push(
      or(
        isAssignedToOpSql(options.filterOperatorId),
        and(
          sql`${crmDealActivities.assignedToOperatorId} IS NULL`,
          or(
            eq(crmDealActivities.operatorId, options.filterOperatorId),
            eq(crmDeals.operatorId, options.filterOperatorId),
          ),
        ),
      )!,
    );
  } else if (!canSeeAll && options.operatorId) {
    if (options.scope === "mine") {
      conditions.push(
        or(
          isAssignedToOpSql(options.operatorId),
          and(
            sql`${crmDealActivities.assignedToOperatorId} IS NULL`,
            or(
              eq(crmDealActivities.operatorId, options.operatorId),
              eq(crmDeals.operatorId, options.operatorId),
            ),
          ),
        )!,
      );
    } else if (options.scope === "delegated") {
      conditions.push(
        and(
          eq(crmDealActivities.operatorId, options.operatorId),
          or(
            and(
              sql`${crmDealActivities.assignedToOperatorId} IS NOT NULL`,
              sql`${crmDealActivities.assignedToOperatorId} != ${options.operatorId}`,
            ),
            sql`jsonb_array_length(${crmDealActivities.assignedToOperatorIds}) > 1`,
            and(
              sql`jsonb_array_length(${crmDealActivities.assignedToOperatorIds}) = 1`,
              sql`NOT (${crmDealActivities.assignedToOperatorIds} @> ${JSON.stringify([options.operatorId])}::jsonb)`,
            ),
          ),
        )!,
      );
    } else {
      conditions.push(
        or(
          isAssignedToOpSql(options.operatorId),
          eq(crmDealActivities.operatorId, options.operatorId),
          eq(crmDeals.operatorId, options.operatorId),
        )!,
      );
    }
  }

  return conditions;
}

/**
 * Calcula em banco (O(log N) via índice) os contadores globais de tarefas pendentes,
 * atrasadas e concluídas do escopo selecionado, sem trafegar linhas completas.
 */
export async function getKanbanTasksSummary(
  tenantId: string,
  options: KanbanTasksQueryOptions,
): Promise<KanbanTasksSummary> {
  const baseConditions = buildKanbanTasksVisibilityConditions(tenantId, options);

  const [agg] = await db
    .select({
      pendingCount: sql<number>`COUNT(*) FILTER (WHERE ${crmDealActivities.status} != 'completed')::int`,
      overdueCount: sql<number>`COUNT(*) FILTER (WHERE ${crmDealActivities.status} != 'completed' AND ${crmDealActivities.dueDate} IS NOT NULL AND ${crmDealActivities.dueDate} < NOW())::int`,
      completedCount: sql<number>`COUNT(*) FILTER (WHERE ${crmDealActivities.status} = 'completed')::int`,
      totalCount: sql<number>`COUNT(*)::int`,
    })
    .from(crmDealActivities)
    .innerJoin(
      crmDeals,
      and(eq(crmDealActivities.dealId, crmDeals.id), eq(crmDeals.tenantId, tenantId)),
    )
    .where(and(...baseConditions));

  return {
    pendingCount: Number(agg?.pendingCount ?? 0),
    overdueCount: Number(agg?.overdueCount ?? 0),
    completedCount: Number(agg?.completedCount ?? 0),
    totalCount: Number(agg?.totalCount ?? 0),
  };
}

/**
 * Consulta otimizada de tarefas e compromissos comerciais nativos do Kanban/CRM (crm_deal_activities):
 * - Zero leitura/serialização de avatares Base64 de operadores em linhas de tarefas;
 * - Query principal enxuta 1:1 (crm_deal_activities -> crm_deals -> crm_accounts) sem multiplicação cartesiana;
 * - Resolução O(1) em memória para operadores, funis e etapas;
 * - Suporte a janela temporal (from/to), busca server-side e paginação (limit/offset);
 * - Lookup DISTINCT ON indexado para contato principal da negociação e conversa mais recente.
 */
export async function getNativeKanbanTasksWithMeta(
  tenantId: string,
  options: KanbanTasksQueryOptions,
) {
  const baseConditions = buildKanbanTasksVisibilityConditions(tenantId, options);
  const filterConditions: SQL[] = [...baseConditions];

  if (options.fromDate || options.toDate) {
    const rangeParts: SQL[] = [];
    if (options.fromDate && !Number.isNaN(options.fromDate.getTime())) {
      rangeParts.push(gte(crmDealActivities.dueDate, options.fromDate));
    }
    if (options.toDate && !Number.isNaN(options.toDate.getTime())) {
      rangeParts.push(lte(crmDealActivities.dueDate, options.toDate));
    }
    if (rangeParts.length > 0) {
      const dateRangeSql = rangeParts.length === 1 ? rangeParts[0] : and(...rangeParts)!;
      if (options.includeUpcomingAlertWindow) {
        filterConditions.push(
          or(
            dateRangeSql,
            and(
              eq(crmDealActivities.status, "pending"),
              sql`${crmDealActivities.dueDate} >= NOW() - INTERVAL '5 minutes'`,
              sql`${crmDealActivities.dueDate} <= NOW() + INTERVAL '20 minutes'`,
            ),
          )!,
        );
      } else {
        filterConditions.push(dateRangeSql);
      }
    }
  }

  if (options.statusFilter && options.statusFilter !== "all") {
    if (options.statusFilter === "open") {
      filterConditions.push(sql`${crmDealActivities.status} != 'completed'`);
    } else if (options.statusFilter === "overdue") {
      filterConditions.push(
        and(
          sql`${crmDealActivities.status} != 'completed'`,
          sql`${crmDealActivities.dueDate} IS NOT NULL`,
          sql`${crmDealActivities.dueDate} < NOW()`,
        )!,
      );
    } else if (options.statusFilter === "completed") {
      filterConditions.push(eq(crmDealActivities.status, "completed"));
    }
  }

  if (options.typeFilter && options.typeFilter !== "all") {
    filterConditions.push(eq(crmDealActivities.type, options.typeFilter));
  }

  const trimmedSearch = (options.searchQuery || "").trim();
  if (trimmedSearch) {
    const escaped = trimmedSearch.replace(/[%_\\]/g, "\\$&");
    const likePattern = `%${escaped}%`;
    filterConditions.push(
      or(
        sql`${crmDealActivities.title} ILIKE ${likePattern}`,
        sql`COALESCE(${crmDealActivities.description}, '') ILIKE ${likePattern}`,
        sql`${crmDeals.title} ILIKE ${likePattern}`,
        sql`COALESCE(${crmAccounts.name}, '') ILIKE ${likePattern}`,
        sql`COALESCE(${crmAccounts.tradeName}, '') ILIKE ${likePattern}`,
        sql`EXISTS (
          SELECT 1
          FROM ${crmDealContacts} cdc
          INNER JOIN ${contacts} c
            ON c.id = cdc.contact_id
           AND c.tenant_id = ${tenantId}
          WHERE cdc.deal_id = ${crmDeals.id}
            AND cdc.tenant_id = ${tenantId}
            AND (c.name ILIKE ${likePattern} OR COALESCE(c.phone, '') ILIKE ${likePattern})
        )`,
      )!,
    );
  }

  const hasPagination = typeof options.limit === "number" && options.limit > 0;
  const maxAllowedLimit =
    typeof options.maxLimit === "number" && options.maxLimit > 0
      ? Math.min(Math.floor(options.maxLimit), 2000)
      : 500;
  const safeLimit = hasPagination
    ? Math.min(Math.max(1, Math.floor(options.limit!)), maxAllowedLimit)
    : null;
  const safeOffset =
    typeof options.offset === "number" && options.offset > 0 ? Math.floor(options.offset) : 0;

  const orderByClauses =
    options.orderMode === "pending_priority"
      ? [
          sql`CASE WHEN ${crmDealActivities.status} = 'completed' THEN 1 ELSE 0 END ASC`,
          sql`CASE WHEN ${crmDealActivities.status} != 'completed' THEN ${crmDealActivities.dueDate} END ASC NULLS LAST`,
          desc(crmDealActivities.dueDate),
          desc(crmDealActivities.createdAt),
        ]
      : [
          sql`${crmDealActivities.dueDate} ASC NULLS LAST`,
          desc(crmDealActivities.createdAt),
        ];

  let mainQuery = db
    .select({
      id: crmDealActivities.id,
      title: crmDealActivities.title,
      type: crmDealActivities.type,
      status: crmDealActivities.status,
      dueDate: crmDealActivities.dueDate,
      completedAt: crmDealActivities.completedAt,
      description: crmDealActivities.description,
      createdAt: crmDealActivities.createdAt,
      conversationId: crmDealActivities.conversationId,
      dealId: crmDealActivities.dealId,
      dealTitle: crmDeals.title,
      dealValue: crmDeals.value,
      dealStatus: crmDeals.status,
      dealOperatorId: crmDeals.operatorId,
      pipelineId: crmDeals.pipelineId,
      stageId: crmDeals.stageId,
      accountId: crmDeals.accountId,
      accountName: crmAccounts.name,
      accountTradeName: crmAccounts.tradeName,
      accountPhone: crmAccounts.phone,
      assignedOperatorId: crmDealActivities.assignedToOperatorId,
      assignedOperatorIds: crmDealActivities.assignedToOperatorIds,
      creatorOperatorId: crmDealActivities.operatorId,
    })
    .from(crmDealActivities)
    .innerJoin(
      crmDeals,
      and(eq(crmDealActivities.dealId, crmDeals.id), eq(crmDeals.tenantId, tenantId)),
    )
    .leftJoin(
      crmAccounts,
      and(eq(crmDeals.accountId, crmAccounts.id), eq(crmAccounts.tenantId, tenantId)),
    )
    .where(and(...filterConditions))
    .orderBy(...orderByClauses)
    .$dynamic();

  if (safeLimit !== null) {
    // Busca +1 registro para determinar hasMore sem precisar de COUNT extra quando não solicitado
    mainQuery = mainQuery.limit(safeLimit + 1).offset(safeOffset);
  }

  const countMatchingPromise = hasPagination
    ? trimmedSearch
      ? db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(crmDealActivities)
          .innerJoin(
            crmDeals,
            and(eq(crmDealActivities.dealId, crmDeals.id), eq(crmDeals.tenantId, tenantId)),
          )
          .leftJoin(
            crmAccounts,
            and(eq(crmDeals.accountId, crmAccounts.id), eq(crmAccounts.tenantId, tenantId)),
          )
          .where(and(...filterConditions))
      : db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(crmDealActivities)
          .innerJoin(
            crmDeals,
            and(eq(crmDealActivities.dealId, crmDeals.id), eq(crmDeals.tenantId, tenantId)),
          )
          .where(and(...filterConditions))
    : Promise.resolve(null);

  const summaryPromise = options.includeSummary
    ? getKanbanTasksSummary(tenantId, options)
    : Promise.resolve(null);

  const [fetchedRows, tenantOperators, tenantPipelines, tenantStages, matchingCountRows, summary] =
    await Promise.all([
      mainQuery,
      db
        .select({
          id: operators.id,
          name: operators.name,
          email: operators.email,
        })
        .from(operators)
        .where(eq(operators.tenantId, tenantId)),
      db
        .select({
          id: crmPipelines.id,
          name: crmPipelines.name,
        })
        .from(crmPipelines)
        .where(eq(crmPipelines.tenantId, tenantId)),
      db
        .select({
          id: crmStages.id,
          name: crmStages.name,
        })
        .from(crmStages)
        .where(eq(crmStages.tenantId, tenantId)),
      countMatchingPromise,
      summaryPromise,
    ]);

  const hasMore = safeLimit !== null && fetchedRows.length > safeLimit;
  const rows = safeLimit !== null ? fetchedRows.slice(0, safeLimit) : fetchedRows;
  const totalMatching =
    matchingCountRows && matchingCountRows[0]
      ? Number(matchingCountRows[0].count ?? rows.length)
      : rows.length;

  const operatorsById = new Map(tenantOperators.map((op) => [op.id, op]));
  const pipelinesById = new Map(tenantPipelines.map((p) => [p.id, p.name]));
  const stagesById = new Map(tenantStages.map((s) => [s.id, s.name]));

  // Busca determinística de 1 contato principal por dealId presente na página/janela atual
  const uniqueDealIds = Array.from(new Set(rows.map((r) => r.dealId).filter(Boolean)));
  const primaryContactByDealId = new Map<
    string,
    { contactId: string; contactName: string | null; contactPhone: string | null }
  >();

  if (uniqueDealIds.length > 0) {
    const dealChunks = chunkArray(uniqueDealIds, 1000);
    const contactResults = await Promise.all(
      dealChunks.map((dealChunk) => {
        const idParams = sql.join(
          dealChunk.map((id) => sql`${id}`),
          sql`, `,
        );
        return db.execute(sql`
          SELECT DISTINCT ON (cdc.deal_id)
            cdc.deal_id AS "dealId",
            cdc.contact_id AS "contactId",
            c.name AS "contactName",
            c.phone AS "contactPhone"
          FROM crm_deal_contacts cdc
          INNER JOIN contacts c
            ON c.id = cdc.contact_id
           AND c.tenant_id = ${tenantId}
          WHERE cdc.tenant_id = ${tenantId}
            AND cdc.deal_id IN (${idParams})
          ORDER BY cdc.deal_id, cdc.is_primary DESC, cdc.created_at ASC
        `);
      }),
    );
    for (const contactRes of contactResults) {
      for (const row of extractRows<{
        dealId: string;
        contactId: string;
        contactName: string | null;
        contactPhone: string | null;
      }>(contactRes)) {
        if (row.dealId && !primaryContactByDealId.has(row.dealId)) {
          primaryContactByDealId.set(row.dealId, {
            contactId: row.contactId,
            contactName: row.contactName || null,
            contactPhone: row.contactPhone || null,
          });
        }
      }
    }
  }

  // Para tarefas sem conversationId explícito, busca a conversa mais recente por contato (DISTINCT ON indexado)
  const missingConvContactIds = Array.from(
    new Set(
      rows
        .filter((r) => !r.conversationId)
        .map((r) => primaryContactByDealId.get(r.dealId)?.contactId)
        .filter((cid): cid is string => Boolean(cid)),
    ),
  );

  const contactToConvMap = new Map<string, string>();
  if (missingConvContactIds.length > 0) {
    const contactChunks = chunkArray(missingConvContactIds, 1000);
    const convResults = await Promise.all(
      contactChunks.map((contactChunk) => {
        const contactParams = sql.join(
          contactChunk.map((id) => sql`${id}`),
          sql`, `,
        );
        return db.execute(sql`
          SELECT DISTINCT ON (contact_id)
            contact_id AS "contactId",
            id
          FROM conversations
          WHERE tenant_id = ${tenantId}
            AND contact_id IN (${contactParams})
          ORDER BY contact_id, updated_at DESC
        `);
      }),
    );
    for (const convRes of convResults) {
      for (const c of extractRows<{ contactId: string; id: string }>(convRes)) {
        if (c.contactId && !contactToConvMap.has(c.contactId)) {
          contactToConvMap.set(c.contactId, c.id);
        }
      }
    }
  }

  const tasks = rows.map((r) => {
    const primaryContact = primaryContactByDealId.get(r.dealId);
    const contactId = primaryContact?.contactId || null;
    const contactName = primaryContact?.contactName || null;
    const contactPhone = primaryContact?.contactPhone || null;

    const companyName = r.accountTradeName || r.accountName || null;
    const clientName = contactName || companyName || null;
    const clientPhone = contactPhone || r.accountPhone || null;
    const resolvedConvId =
      r.conversationId || (contactId ? contactToConvMap.get(contactId) || null : null);

    const assignedOp = r.assignedOperatorId ? operatorsById.get(r.assignedOperatorId) : undefined;
    const creatorOp = r.creatorOperatorId ? operatorsById.get(r.creatorOperatorId) : undefined;
    const dealOwnerOp = r.dealOperatorId ? operatorsById.get(r.dealOperatorId) : undefined;

    const rawAssignedIds =
      Array.isArray(r.assignedOperatorIds) && r.assignedOperatorIds.length > 0
        ? r.assignedOperatorIds.filter(Boolean)
        : r.assignedOperatorId
        ? [r.assignedOperatorId]
        : [];
    const uniqueAssignedIds = Array.from(new Set(rawAssignedIds));
    const resolvedAssignedOperators = uniqueAssignedIds
      .map((id) => operatorsById.get(id))
      .filter((op): op is NonNullable<typeof op> => Boolean(op))
      .map((op) => ({
        id: op.id,
        name: op.name,
        email: op.email || null,
        avatar: null as string | null,
      }));
    const resolvedAssignedNames = resolvedAssignedOperators.map((op) => op.name);
    const combinedAssignedName =
      resolvedAssignedNames.length > 0
        ? resolvedAssignedNames.join(", ")
        : assignedOp?.name || null;

    const effectiveOperatorId = r.assignedOperatorId || r.creatorOperatorId || r.dealOperatorId || null;
    const effectiveOperatorName =
      combinedAssignedName || creatorOp?.name || dealOwnerOp?.name || "Sem operador";
    const effectiveOperatorEmail =
      assignedOp?.email || creatorOp?.email || dealOwnerOp?.email || null;

    const assignedOperatorsList =
      resolvedAssignedOperators.length > 0
        ? resolvedAssignedOperators
        : effectiveOperatorId
        ? [
            {
              id: effectiveOperatorId,
              name: effectiveOperatorName,
              email: effectiveOperatorEmail,
              avatar: null as string | null,
            },
          ]
        : [];

    const parsedNumericValue =
      r.dealValue !== null && r.dealValue !== undefined && !Number.isNaN(Number(r.dealValue))
        ? Number(r.dealValue)
        : null;

    return {
      id: r.id,
      name: r.title || "Sem título",
      type: r.type || "task",
      status: r.status === "completed" ? ("done" as const) : ("pending" as const),
      dueDate: r.dueDate ? r.dueDate.toISOString() : null,
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      description: r.description || null,
      createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      deal: {
        id: r.dealId,
        name: r.dealTitle,
        value: r.dealValue,
        numericValue: parsedNumericValue,
        status: (r.dealStatus || "open") as "open" | "won" | "lost",
        pipelineId: r.pipelineId,
        pipelineName: (r.pipelineId && pipelinesById.get(r.pipelineId)) || null,
        stageId: r.stageId,
        stageName: (r.stageId && stagesById.get(r.stageId)) || null,
      },
      client: {
        name: clientName,
        phone: clientPhone,
        companyName,
        accountId: r.accountId || null,
      },
      chatContactId: contactId,
      chatConversationId: resolvedConvId,
      source: "kanban" as const,
      operatorId: effectiveOperatorId,
      operatorName: effectiveOperatorName,
      operatorEmail: effectiveOperatorEmail,
      operatorAvatar: null as string | null,
      assignedOperatorId: r.assignedOperatorId || null,
      assignedOperatorIds:
        uniqueAssignedIds.length > 0
          ? uniqueAssignedIds
          : effectiveOperatorId
          ? [effectiveOperatorId]
          : [],
      assignedOperatorName: combinedAssignedName,
      assignedOperatorNames: resolvedAssignedNames,
      assignedOperators: assignedOperatorsList,
      isShared: uniqueAssignedIds.length > 1,
      creatorOperatorId: r.creatorOperatorId || null,
      creatorOperatorName: creatorOp?.name || null,
      dealOperatorId: r.dealOperatorId || null,
      dealOwnerName: dealOwnerOp?.name || null,
    };
  });

  return {
    tasks,
    summary,
    totalMatching,
    hasMore,
  };
}

export async function getNativeKanbanTasks(
  tenantId: string,
  options: KanbanTasksQueryOptions,
) {
  const result = await getNativeKanbanTasksWithMeta(tenantId, options);
  return result.tasks;
}

export const Route = createFileRoute("/api/tasks")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /**
       * GET /api/tasks
       * Lista tarefas e compromissos locais (crm_deal_activities) do tenant,
       * suportando janela temporal (from/to), contadores globais (includeSummary=true)
       * e paginação/busca server-side (limit/offset/statusFilter/type/q).
       */
      GET: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;

          const url = new URL(request.url);
          const viewAll = url.searchParams.get("all") === "true";
          const scopeParam = (url.searchParams.get("scope") || "all_visible") as
            | "all_visible"
            | "mine"
            | "delegated"
            | "all";
          const filterOperatorId =
            url.searchParams.get("operatorId") ||
            url.searchParams.get("operatorFilterId") ||
            null;
          const isAdmin =
            session.operator.role === "admin" ||
            Boolean(session.permissions?.monitor?.canAccessTeamTasks);

          const fromRaw = url.searchParams.get("from");
          const toRaw = url.searchParams.get("to");
          const fromDate = fromRaw ? new Date(fromRaw) : null;
          const toDate = toRaw ? new Date(toRaw) : null;
          const includeSummary = url.searchParams.get("includeSummary") === "true";
          const includeUpcomingAlertWindow = url.searchParams.get("upcomingAlert") === "true";

          const statusFilter = (url.searchParams.get("statusFilter") || null) as
            | "all"
            | "open"
            | "overdue"
            | "completed"
            | null;
          const typeFilter = url.searchParams.get("type") || null;
          const searchQuery = url.searchParams.get("q") || null;
          const limitParam = url.searchParams.get("limit");
          const offsetParam = url.searchParams.get("offset");
          const limit = limitParam !== null ? Number(limitParam) : null;
          const offset = offsetParam !== null ? Number(offsetParam) : null;

          const result = await getNativeKanbanTasksWithMeta(tenantId, {
            operatorId: session.operator.id,
            email: session.operator.email,
            isAdmin,
            all: viewAll,
            scope: scopeParam,
            filterOperatorId: isAdmin ? filterOperatorId : null,
            fromDate: fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : null,
            toDate: toDate && !Number.isNaN(toDate.getTime()) ? toDate : null,
            includeUpcomingAlertWindow,
            statusFilter,
            typeFilter,
            searchQuery,
            limit: limit !== null && Number.isFinite(limit) ? limit : null,
            offset: offset !== null && Number.isFinite(offset) ? offset : null,
            includeSummary,
          });

          return new Response(
            JSON.stringify({
              tasks: result.tasks,
              ...(result.summary ? { summary: result.summary } : {}),
              totalMatching: result.totalMatching,
              hasMore: result.hasMore,
              configured: true,
              source: "kanban",
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        } catch (fatalErr: any) {
          console.error("[Tasks API] Erro fatal no GET:", fatalErr);
          return new Response(JSON.stringify({ error: fatalErr.message || "Erro interno" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      /**
       * PUT /api/tasks
       * Atualiza uma tarefa local (concluir com confirmação/nota/próximo passo, editar, reagendar, cancelar ou reagendar em lote).
       * Tarefas já concluídas NÃO podem ser reativadas.
       */
      PUT: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const isAdmin =
            session.operator.role === "admin" ||
            Boolean(session.permissions?.monitor?.canAccessTeamTasks);
          if (!isAdmin && !session.permissions?.views?.tasks && !session.permissions?.views?.crm) {
            return Response.json(
              { error: "Permissão insuficiente.", code: "FORBIDDEN" },
              { status: 403 },
            );
          }

          const body = await request.json();

          // Ação em lote: Reagendar várias tarefas pendentes/atrasadas (por IDs explícitos ou todas atrasadas do escopo)
          if (body.action === "bulk_reschedule") {
            const taskIds: string[] = Array.isArray(body.taskIds) ? body.taskIds : [];
            const rescheduleAllOverdue = body.rescheduleAllOverdue === true;
            const dueDateRaw: string | undefined = body.dueDate;
            if ((!taskIds.length && !rescheduleAllOverdue) || !dueDateRaw) {
              return new Response(
                JSON.stringify({
                  error: "Selecione ao menos uma tarefa e informe a nova data.",
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }

            const parsedTargetDue = new Date(dueDateRaw);
            if (Number.isNaN(parsedTargetDue.getTime())) {
              return new Response(
                JSON.stringify({ error: "Data de reagendamento inválida." }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }

            // Reagendamento massivo em lote via SQL transacional (evita milhares de round-trips sequenciais)
            if (rescheduleAllOverdue || taskIds.length > 30) {
              const scopeParam = (body.scope || "all_visible") as
                | "all_visible"
                | "mine"
                | "delegated"
                | "all";
              const filterOpId = isAdmin ? body.operatorFilterId || null : null;
              const viewAll = Boolean(isAdmin && (body.all === true || scopeParam === "all") && !filterOpId);

              const visibilityConds = buildKanbanTasksVisibilityConditions(tenantId, {
                operatorId: session.operator.id,
                isAdmin,
                all: viewAll,
                scope: scopeParam,
                filterOperatorId: filterOpId,
              });

              const candidateConds: SQL[] = [
                ...visibilityConds,
                sql`${crmDealActivities.status} != 'completed'`,
              ];

              if (rescheduleAllOverdue) {
                candidateConds.push(
                  sql`${crmDealActivities.dueDate} IS NOT NULL`,
                  sql`${crmDealActivities.dueDate} < NOW()`,
                );
              } else {
                candidateConds.push(inArray(crmDealActivities.id, taskIds));
              }

              const matchingRows = await db
                .select({
                  id: crmDealActivities.id,
                  dealId: crmDealActivities.dealId,
                })
                .from(crmDealActivities)
                .innerJoin(
                  crmDeals,
                  and(eq(crmDealActivities.dealId, crmDeals.id), eq(crmDeals.tenantId, tenantId)),
                )
                .where(and(...candidateConds));

              if (matchingRows.length === 0) {
                return new Response(JSON.stringify({ success: true, updatedCount: 0 }), {
                  headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
              }

              const now = new Date();
              const idsToUpdate = matchingRows.map((r) => r.id);
              const dealIdsToTouch = Array.from(new Set(matchingRows.map((r) => r.dealId)));

              await db.transaction(async (tx) => {
                await tx.execute(
                  sql`SELECT set_config('app.rd_activity_actor', ${session.operator.id || ""}, true)`,
                );
                for (const idBatch of chunkArray(idsToUpdate, 1000)) {
                  await tx
                    .update(crmDealActivities)
                    .set({ dueDate: parsedTargetDue, updatedAt: now })
                    .where(
                      and(
                        eq(crmDealActivities.tenantId, tenantId),
                        inArray(crmDealActivities.id, idBatch),
                      ),
                    );
                }
                for (const dealBatch of chunkArray(dealIdsToTouch, 1000)) {
                  await tx
                    .update(crmDeals)
                    .set({ lastActivityAt: now, updatedAt: now })
                    .where(
                      and(
                        eq(crmDeals.tenantId, tenantId),
                        inArray(crmDeals.id, dealBatch),
                      ),
                    );
                }
              });

              return new Response(
                JSON.stringify({ success: true, updatedCount: idsToUpdate.length }),
                {
                  headers: { ...corsHeaders, "Content-Type": "application/json" },
                },
              );
            }

            const targetActivities = await db
              .select()
              .from(crmDealActivities)
              .where(
                and(
                  eq(crmDealActivities.tenantId, tenantId),
                  inArray(crmDealActivities.id, taskIds),
                ),
              );

            let updatedCount = 0;
            for (const act of targetActivities) {
              if (act.status === "completed") continue;
              const isShared =
                Array.isArray(act.assignedToOperatorIds) &&
                act.assignedToOperatorIds.includes(session.operator.id);
              if (
                !isAdmin &&
                act.operatorId !== session.operator.id &&
                act.assignedToOperatorId !== session.operator.id &&
                !isShared
              ) {
                continue;
              }
              await crmService.updateDealActivity(
                tenantId,
                act.dealId,
                act.id,
                session.operator.id,
                { dueDate: parsedTargetDue },
              );
              updatedCount++;
            }

            return new Response(JSON.stringify({ success: true, updatedCount }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const taskId = body.taskId || body.id;
          if (!taskId) {
            return new Response(JSON.stringify({ error: "taskId é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const [kanbanActivity] = await db
            .select()
            .from(crmDealActivities)
            .where(and(eq(crmDealActivities.id, taskId), eq(crmDealActivities.tenantId, tenantId)))
            .limit(1);

          if (!kanbanActivity) {
            return new Response(JSON.stringify({ error: "Tarefa não encontrada." }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const isSharedAssignee =
            Array.isArray(kanbanActivity.assignedToOperatorIds) &&
            kanbanActivity.assignedToOperatorIds.includes(session.operator.id);

          if (
            !isAdmin &&
            kanbanActivity.operatorId !== session.operator.id &&
            kanbanActivity.assignedToOperatorId !== session.operator.id &&
            !isSharedAssignee
          ) {
            // Verifica se o operador é dono da negociação
            const [dealRow] = await db
              .select({ operatorId: crmDeals.operatorId })
              .from(crmDeals)
              .where(
                and(
                  eq(crmDeals.id, kanbanActivity.dealId),
                  eq(crmDeals.tenantId, tenantId),
                ),
              )
              .limit(1);
            if (!dealRow || dealRow.operatorId !== session.operator.id) {
              return Response.json(
                { error: "Permissão insuficiente para alterar esta tarefa." },
                { status: 403 },
              );
            }
          }

          // REGRA ESTRITA: Tarefa já concluída não pode voltar para pendente
          if (
            kanbanActivity.status === "completed" &&
            body.status &&
            body.status !== "done" &&
            body.status !== "completed"
          ) {
            return new Response(
              JSON.stringify({
                error: "Esta tarefa já está concluída e não pode ser reativada.",
                code: "COMPLETED_TASK_CANNOT_REOPEN",
              }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          const updates: {
            status?: "pending" | "completed" | "cancelled";
            title?: string;
            description?: string | null;
            dueDate?: Date | string | null;
            type?: "task" | "call" | "meeting" | "whatsapp" | "email" | "lunch" | "visit";
            assignedToOperatorId?: string | null;
            assignedToOperatorIds?: string[] | null;
            completionNote?: string | null;
          } = {};

          if (body.status !== undefined) {
            if (body.status === "done" || body.status === "completed") {
              updates.status = "completed";
            } else if (body.status === "cancelled") {
              updates.status = "cancelled";
            } else {
              updates.status = "pending";
            }
          }

          if (body.title !== undefined) updates.title = body.title;
          if (body.description !== undefined) updates.description = body.description;
          if (body.dueDate !== undefined)
            updates.dueDate = body.dueDate ? new Date(body.dueDate) : null;
          if (body.type !== undefined) updates.type = body.type;
          if (body.assignedToOperatorId !== undefined)
            updates.assignedToOperatorId = body.assignedToOperatorId;
          if (Array.isArray(body.assignedToOperatorIds)) {
            updates.assignedToOperatorIds = body.assignedToOperatorIds;
          }
          if (typeof body.completionNote === "string" && body.completionNote.trim()) {
            updates.completionNote = body.completionNote.trim();
          }

          const updatedActivity = await crmService.updateDealActivity(
            tenantId,
            kanbanActivity.dealId,
            kanbanActivity.id,
            session.operator.id,
            updates,
          );

          // Se o operador agendou o próximo passo no modal de conclusão, cria a nova atividade
          let createdNextTask = null;
          if (
            updates.status === "completed" &&
            body.nextTask &&
            typeof body.nextTask.title === "string" &&
            body.nextTask.title.trim() &&
            body.nextTask.dueDate
          ) {
            try {
              const inheritedOperatorIds =
                Array.isArray(body.nextTask.assignedToOperatorIds) &&
                body.nextTask.assignedToOperatorIds.length > 0
                  ? body.nextTask.assignedToOperatorIds
                  : Array.isArray(kanbanActivity.assignedToOperatorIds) &&
                    kanbanActivity.assignedToOperatorIds.length > 0
                  ? kanbanActivity.assignedToOperatorIds
                  : undefined;

              createdNextTask = await crmService.createDealActivity(
                tenantId,
                kanbanActivity.dealId,
                session.operator.id,
                {
                  assignedToOperatorId:
                    body.nextTask.assignedToOperatorId ||
                    kanbanActivity.assignedToOperatorId ||
                    session.operator.id,
                  assignedToOperatorIds: inheritedOperatorIds,
                  type: body.nextTask.type || "task",
                  title: body.nextTask.title.trim(),
                  description: body.nextTask.description?.trim() || undefined,
                  dueDate: new Date(body.nextTask.dueDate),
                  conversationId: kanbanActivity.conversationId || null,
                },
              );
            } catch (nextErr: any) {
              console.warn("[Tasks API] Aviso ao criar próxima tarefa:", nextErr.message);
            }
          }

          return new Response(
            JSON.stringify({
              success: true,
              source: "kanban",
              activity: updatedActivity,
              nextTask: createdNextTask,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        } catch (e: any) {
          console.error("[Tasks API] Erro PUT:", e.message);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      /**
       * DELETE /api/tasks
       * Exclui uma tarefa local (crm_deal_activities).
       */
      DELETE: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const isAdmin =
            session.operator.role === "admin" ||
            Boolean(session.permissions?.monitor?.canAccessTeamTasks);
          if (!isAdmin && !session.permissions?.views?.tasks && !session.permissions?.views?.crm) {
            return Response.json(
              { error: "Permissão insuficiente.", code: "FORBIDDEN" },
              { status: 403 },
            );
          }

          const url = new URL(request.url);
          let taskId = url.searchParams.get("taskId") || url.searchParams.get("id");
          if (!taskId) {
            const body = await request.json().catch(() => ({}));
            taskId = body.taskId || body.id;
          }

          if (!taskId) {
            return new Response(JSON.stringify({ error: "taskId é obrigatório" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const [kanbanActivity] = await db
            .select()
            .from(crmDealActivities)
            .where(and(eq(crmDealActivities.id, taskId), eq(crmDealActivities.tenantId, tenantId)))
            .limit(1);

          if (!kanbanActivity) {
            return new Response(JSON.stringify({ error: "Tarefa não encontrada." }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const isSharedAssignee =
            Array.isArray(kanbanActivity.assignedToOperatorIds) &&
            kanbanActivity.assignedToOperatorIds.includes(session.operator.id);

          if (
            !isAdmin &&
            kanbanActivity.operatorId !== session.operator.id &&
            kanbanActivity.assignedToOperatorId !== session.operator.id &&
            !isSharedAssignee
          ) {
            return Response.json(
              { error: "Permissão insuficiente para excluir esta tarefa." },
              { status: 403 },
            );
          }

          await crmService.deleteDealActivity(
            tenantId,
            kanbanActivity.dealId,
            kanbanActivity.id,
            session.operator.id,
          );

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[Tasks API] Erro DELETE:", e.message);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
