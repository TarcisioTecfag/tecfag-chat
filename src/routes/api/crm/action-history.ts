import { createFileRoute } from "@tanstack/react-router";
import { and, asc, desc, eq, gte, ilike, inArray, like, lte, or, sql } from "drizzle-orm";
import { db } from "../../../db";
import { crmActionHistory } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import {
  extractAuditOriginFromStoredRecord,
  formatAuditTimestampBrt,
  normalizeAuditActorType,
  normalizeAuditSourceChannel,
} from "../../../lib/audit/audit-context";
import { ensureAuditOriginSchema } from "../../../lib/audit/audit-schema";
import {
  type ActionEntityGroup,
  BULK_ACTION_CODES,
  findMatchingActionCodes,
  findMatchingEntityTypes,
  getEntityTypesForGroup,
} from "../../../lib/crm/action-history-meta";

const VALID_KINDS = new Set(["deletion", "bulk", "export"]);
const VALID_ENTITY_GROUPS = new Set([
  "all",
  "deals",
  "pipelines",
  "customers",
  "catalogs",
  "team",
  "ai_voice",
]);

export const Route = createFileRoute("/api/crm/action-history")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (session.operator.role !== "admin") {
          return Response.json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, { status: 403 });
        }

        await ensureAuditOriginSchema().catch(() => {});

        const url = new URL(request.url);
        const kind = url.searchParams.get("kind");
        const actionFilter = url.searchParams.get("action")?.trim() || "";
        const entityGroup = (url.searchParams.get("entityGroup")?.trim() || "all") as ActionEntityGroup;
        const entityTypeFilter = url.searchParams.get("entityType")?.trim() || "";
        const entityIdFilter = url.searchParams.get("entityId")?.trim() || "";
        const actorTypeRaw = url.searchParams.get("actorType")?.trim() || "";
        const sourceChannelRaw = url.searchParams.get("sourceChannel")?.trim() || "";
        const clientIpFilter = url.searchParams.get("clientIp")?.trim() || "";
        const operatorFilter = url.searchParams.get("operator")?.trim() || "";
        const searchQuery = (url.searchParams.get("q") ?? url.searchParams.get("search") ?? "").trim();
        const dateFromRaw = url.searchParams.get("dateFrom")?.trim() || "";
        const dateToRaw = url.searchParams.get("dateTo")?.trim() || "";
        const offset = Number(url.searchParams.get("offset") || 0);
        const rawLimit = Number(url.searchParams.get("limit") || 50);
        const limit = Number.isSafeInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 200 ? rawLimit : 50;

        if (kind && kind !== "all" && !VALID_KINDS.has(kind)) {
          return Response.json({ error: "Filtro inválido." }, { status: 400 });
        }
        if (entityGroup && !VALID_ENTITY_GROUPS.has(entityGroup)) {
          return Response.json({ error: "Grupo de entidade inválido." }, { status: 400 });
        }
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
          return Response.json({ error: "Página inválida." }, { status: 400 });
        }

        const actorTypeFilter =
          actorTypeRaw && actorTypeRaw !== "all" ? normalizeAuditActorType(actorTypeRaw) : null;
        const sourceChannelFilter =
          sourceChannelRaw && sourceChannelRaw !== "all"
            ? normalizeAuditSourceChannel(sourceChannelRaw)
            : null;

        const groupEntityTypes =
          entityGroup && entityGroup !== "all" ? getEntityTypesForGroup(entityGroup) : [];

        let dateFrom: Date | undefined;
        if (dateFromRaw) {
          const parsed = new Date(dateFromRaw.includes("T") ? dateFromRaw : `${dateFromRaw}T00:00:00`);
          if (!Number.isNaN(parsed.getTime())) dateFrom = parsed;
        }

        let dateTo: Date | undefined;
        if (dateToRaw) {
          const parsed = new Date(dateToRaw.includes("T") ? dateToRaw : `${dateToRaw}T23:59:59.999`);
          if (!Number.isNaN(parsed.getTime())) dateTo = parsed;
        }

        let searchCondition = undefined;
        if (searchQuery) {
          const pattern = `%${searchQuery}%`;
          const matchingActions = findMatchingActionCodes(searchQuery);
          const matchingEntities = findMatchingEntityTypes(searchQuery);

          searchCondition = or(
            ilike(crmActionHistory.operatorName, pattern),
            ilike(crmActionHistory.action, pattern),
            ilike(crmActionHistory.entityType, pattern),
            ilike(crmActionHistory.entityId, pattern),
            ilike(crmActionHistory.clientIp, pattern),
            ilike(crmActionHistory.mcpKeyLabel, pattern),
            sql`CAST(${crmActionHistory.details} AS text) ILIKE ${pattern}`,
            matchingActions.length > 0 ? inArray(crmActionHistory.action, matchingActions) : undefined,
            matchingEntities.length > 0 ? inArray(crmActionHistory.entityType, matchingEntities) : undefined,
          );
        }

        try {
          const [rows, operatorRows, actionRows] = await Promise.all([
            db
              .select()
              .from(crmActionHistory)
              .where(
                and(
                  eq(crmActionHistory.tenantId, tenantId),
                  kind === "export" ? eq(crmActionHistory.action, "export") : undefined,
                  kind === "deletion"
                    ? or(
                        like(crmActionHistory.action, "delete_%"),
                        like(crmActionHistory.action, "archive_%"),
                      )
                    : undefined,
                  kind === "bulk"
                    ? inArray(crmActionHistory.action, [...BULK_ACTION_CODES])
                    : undefined,
                  actionFilter && actionFilter !== "all"
                    ? eq(crmActionHistory.action, actionFilter)
                    : undefined,
                  entityTypeFilter && entityTypeFilter !== "all"
                    ? eq(crmActionHistory.entityType, entityTypeFilter)
                    : undefined,
                  entityIdFilter
                    ? eq(crmActionHistory.entityId, entityIdFilter)
                    : undefined,
                  actorTypeFilter
                    ? eq(crmActionHistory.actorType, actorTypeFilter)
                    : undefined,
                  sourceChannelFilter
                    ? eq(crmActionHistory.sourceChannel, sourceChannelFilter)
                    : undefined,
                  clientIpFilter
                    ? ilike(crmActionHistory.clientIp, `%${clientIpFilter}%`)
                    : undefined,
                  groupEntityTypes.length > 0
                    ? inArray(crmActionHistory.entityType, groupEntityTypes)
                    : undefined,
                  operatorFilter && operatorFilter !== "all"
                    ? eq(crmActionHistory.operatorName, operatorFilter)
                    : undefined,
                  dateFrom ? gte(crmActionHistory.createdAt, dateFrom) : undefined,
                  dateTo ? lte(crmActionHistory.createdAt, dateTo) : undefined,
                  searchCondition,
                ),
              )
              .orderBy(desc(crmActionHistory.createdAt), desc(crmActionHistory.id))
              .limit(limit + 1)
              .offset(offset),
            db
              .selectDistinct({ operatorName: crmActionHistory.operatorName })
              .from(crmActionHistory)
              .where(eq(crmActionHistory.tenantId, tenantId))
              .orderBy(asc(crmActionHistory.operatorName)),
            db
              .selectDistinct({ action: crmActionHistory.action })
              .from(crmActionHistory)
              .where(eq(crmActionHistory.tenantId, tenantId))
              .orderBy(asc(crmActionHistory.action)),
          ]);

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
              ...row,
              actorType: origin.actorType,
              actorTypeLabel: origin.actorTypeLabel,
              sourceChannel: origin.sourceChannel,
              sourceChannelLabel: origin.sourceChannelLabel,
              actorName: origin.actorName || row.operatorName,
              clientIp: origin.clientIp,
              mcpKeyId: origin.mcpKeyId,
              mcpKeyLabel: origin.mcpKeyLabel,
              createdAtBrt: formatAuditTimestampBrt(row.createdAt),
            };
          });

          return Response.json({
            entries,
            hasMore: rows.length > limit,
            operators: operatorRows.map((r) => r.operatorName).filter(Boolean),
            actions: actionRows.map((r) => r.action).filter(Boolean),
          });
        } catch (error) {
          console.error("[CRM Action History] Erro ao consultar:", error);
          return Response.json(
            { error: "Não foi possível carregar o histórico." },
            { status: 500 },
          );
        }
      },
    },
  },
});
