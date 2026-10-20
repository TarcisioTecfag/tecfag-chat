import { and, desc, eq, exists, ilike, lt, or, sql } from "drizzle-orm";
import { agentFlowStates, contacts, conversations, messages } from "../../db/schema";
import type { IndustrialDatabase } from "./industrial-rodizio-store";
import {
  buildJournalSnapshot,
  readJournalSnapshot,
  type JournalFlow,
} from "./industrial-triage-journal";
import { historyNextCursor, type historyPageInput } from "./triage-history-pagination";

type Page = ReturnType<typeof historyPageInput>;
export class HistoryNotFoundError extends Error {}
const historyScope = (tenantId: string, conversationId: string) =>
  JSON.stringify([tenantId, conversationId]);
export function historyQueryScope(
  tenantId: string,
  input: { conversationId?: string; query?: string },
) {
  return input.conversationId
    ? historyScope(tenantId, input.conversationId)
    : JSON.stringify([tenantId, input.query || ""]);
}
export async function listHistoryConversations(
  database: IndustrialDatabase,
  tenantId: string,
  query: string,
  page: Page,
) {
  const pattern = `%${query.replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
  const createdTime = sql`date_trunc('milliseconds', ${conversations.createdAt})`;
  const rows = await database
    .select({
      id: conversations.id,
      name: contacts.name,
      channel: contacts.mainChannel,
      createdAt: createdTime.mapWith(conversations.createdAt),
      queueState: conversations.queueState,
    })
    .from(conversations)
    .innerJoin(
      contacts,
      and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, tenantId)),
    )
    .where(
      and(
        eq(conversations.tenantId, tenantId),
        lt(conversations.createdAt, new Date(page.asOf)),
        page.cursor
          ? sql`(${createdTime}, ${conversations.id}) < (${page.cursor.time}::timestamp, ${page.cursor.id})`
          : undefined,
        query ? or(ilike(contacts.name, pattern), ilike(contacts.phone, pattern)) : undefined,
        or(
          exists(
            database
              .select({ id: agentFlowStates.id })
              .from(agentFlowStates)
              .where(
                and(
                  eq(agentFlowStates.tenantId, tenantId),
                  eq(agentFlowStates.conversationId, conversations.id),
                  eq(agentFlowStates.agentType, "sdr"),
                ),
              ),
          ),
          exists(
            database
              .select({ id: messages.id })
              .from(messages)
              .where(
                and(
                  eq(messages.tenantId, tenantId),
                  eq(messages.conversationId, conversations.id),
                  eq(messages.isInternalNote, true),
                  sql`${messages.metaDetails}->'industrialTriage'->>'version' = '1'`,
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(desc(createdTime), desc(conversations.id))
    .limit(page.limit + 1);
  const items = rows
    .slice(0, page.limit)
    .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  const last = items.at(-1);
  return {
    items,
    pageInfo: {
      asOf: page.asOf,
      hasMore: rows.length > page.limit,
      nextCursor:
        rows.length > page.limit && last
          ? historyNextCursor("conversations", historyQueryScope(tenantId, { query }), page.asOf, {
              time: last.createdAt,
              id: last.id,
            })
          : null,
      order: "conversation_created_desc",
    },
  };
}
export async function assertHistoryConversation(
  database: IndustrialDatabase,
  tenantId: string,
  conversationId: string,
) {
  const [conversation] = await database
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
    .limit(1);
  if (!conversation) throw new HistoryNotFoundError();
}

/** Journal, linhas antigas ainda existentes e resumos legados são unidos sem escrever na leitura. */
export async function listHistoryCycles(
  database: IndustrialDatabase,
  tenantId: string,
  conversationId: string,
  page: Page,
) {
  await assertHistoryConversation(database, tenantId, conversationId);
  const [current] = await database
    .select({ id: agentFlowStates.id, startedAt: agentFlowStates.startedAt })
    .from(agentFlowStates)
    .where(
      and(
        eq(agentFlowStates.tenantId, tenantId),
        eq(agentFlowStates.conversationId, conversationId),
        eq(agentFlowStates.agentType, "sdr"),
      ),
    )
    .orderBy(desc(agentFlowStates.startedAt), desc(agentFlowStates.id))
    .limit(1);
  const currentCycleId = current ? `${current.id}:${current.startedAt.toISOString()}` : null;
  const flowTime = sql`to_char(${agentFlowStates.startedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  const rows = await database.execute<{
    cycle_id: string;
    started_at: string;
    payload: unknown;
    source: string;
  }>(sql`
    WITH journal AS (
      SELECT DISTINCT ON (${messages.metaDetails}->'industrialTriage'->>'cycleId')
        ${messages.metaDetails}->'industrialTriage'->>'cycleId' cycle_id,
        ${messages.metaDetails}->'industrialTriage'->'snapshot' payload,
        CASE WHEN ${messages.metaDetails}->'industrialTriage'->>'kind' = 'legacy_summary' THEN 'legacy_summary' ELSE 'journal' END source,
        CASE WHEN ${messages.metaDetails}->'industrialTriage'->>'kind' = 'legacy_summary' THEN 0 ELSE 1 END priority
      FROM ${messages} WHERE ${and(eq(messages.tenantId, tenantId), eq(messages.conversationId, conversationId), eq(messages.isInternalNote, true))}
        AND ${messages.metaDetails}->'industrialTriage'->>'version' = '1'
        AND ${messages.sentAt} <= ${page.asOf}::timestamp
      ORDER BY ${messages.metaDetails}->'industrialTriage'->>'cycleId', priority DESC, ${messages.sentAt} DESC, ${messages.id} DESC
    ), live AS (
      SELECT ${agentFlowStates.id} || ':' || ${flowTime} cycle_id,
        jsonb_build_object('id', ${agentFlowStates.id}, 'conversationId', ${agentFlowStates.conversationId}, 'tenantId', ${agentFlowStates.tenantId}, 'startedAt', ${flowTime},
          'lastInteractionAt', to_char(${agentFlowStates.lastInteractionAt}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'completedAt', to_char(${agentFlowStates.completedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'outcome', ${agentFlowStates.outcome}, 'currentStep', ${agentFlowStates.currentStep}, 'collectedData', ${agentFlowStates.collectedData}, 'metadata', ${agentFlowStates.metadata}) payload,
        'flow'::text source, 2 priority
      FROM ${agentFlowStates} WHERE ${and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.conversationId, conversationId), eq(agentFlowStates.agentType, "sdr"))}
    ), legacy AS (
      SELECT (item->>'id') || ':' || (item->>'startedAt') cycle_id,
        item || jsonb_build_object('flowId', item->>'id', 'cycleId', (item->>'id') || ':' || (item->>'startedAt')) payload,
        'legacy_summary'::text source, 0 priority
      FROM ${agentFlowStates}, LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(${agentFlowStates.metadata}->'previousTriages') = 'array' THEN ${agentFlowStates.metadata}->'previousTriages' ELSE '[]'::jsonb END) item
      WHERE ${and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.conversationId, conversationId), eq(agentFlowStates.agentType, "sdr"))}
        AND item->>'id' IS NOT NULL AND item->>'startedAt' IS NOT NULL
    ), candidates AS (SELECT * FROM journal UNION ALL SELECT * FROM live UNION ALL SELECT * FROM legacy),
    chosen AS (SELECT DISTINCT ON (cycle_id) cycle_id, payload, source FROM candidates WHERE cycle_id IS NOT NULL ORDER BY cycle_id, priority DESC),
    dated AS (SELECT cycle_id, payload, source, payload->>'startedAt' started_at FROM chosen)
    SELECT * FROM dated WHERE started_at <= ${page.asOf}
      ${page.cursor ? sql`AND (started_at, cycle_id) < (${page.cursor.time}, ${page.cursor.id})` : sql``}
    ORDER BY started_at DESC, cycle_id DESC LIMIT ${page.limit + 1}
  `);
  const selected = rows.slice(0, page.limit);
  const items = selected
    .map((row) => ({
      snapshot:
        row.source === "flow"
          ? buildJournalSnapshot(row.payload as JournalFlow)
          : readJournalSnapshot(row.payload),
      source: row.source,
      isCurrent: row.cycle_id === currentCycleId,
      dataAvailable: row.source !== "legacy_summary",
    }))
    .filter((row) => row.snapshot);
  const last = selected.at(-1);
  return {
    items,
    pageInfo: {
      asOf: page.asOf,
      hasMore: rows.length > page.limit,
      nextCursor:
        rows.length > page.limit && last
          ? historyNextCursor("cycles", historyScope(tenantId, conversationId), page.asOf, {
              time: last.started_at,
              id: last.cycle_id,
            })
          : null,
    },
  };
}
export async function listHistoryEvents(
  database: IndustrialDatabase,
  tenantId: string,
  conversationId: string,
  cycleId: string,
  page: Page,
) {
  await assertHistoryConversation(database, tenantId, conversationId);
  const eventTime = sql`date_trunc('milliseconds', ${messages.sentAt})`;
  const rows = await database
    .select({
      id: messages.id,
      text: messages.content,
      sentAt: eventTime.mapWith(messages.sentAt),
      details: messages.metaDetails,
    })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, tenantId),
        eq(messages.conversationId, conversationId),
        eq(messages.isInternalNote, true),
        sql`${messages.metaDetails}->'industrialTriage'->>'version' = '1'`,
        sql`${messages.metaDetails}->'industrialTriage'->>'cycleId' = ${cycleId}`,
        sql`${messages.sentAt} <= ${page.asOf}::timestamp`,
        page.cursor
          ? sql`(date_trunc('milliseconds', ${messages.sentAt}), ${messages.id}) > (${page.cursor.time}::timestamp, ${page.cursor.id})`
          : undefined,
      ),
    )
    .orderBy(eventTime, messages.id)
    .limit(page.limit + 1);
  const selected = rows.slice(0, page.limit);
  const items = selected.map((row) => {
    const journal = (row.details as Record<string, unknown>).industrialTriage as Record<
      string,
      unknown
    >;
    return {
      id: row.id,
      text: row.text.slice(0, 12_000),
      at: row.sentAt.toISOString(),
      kind: typeof journal.kind === "string" ? journal.kind.slice(0, 40) : "unknown",
      snapshot: readJournalSnapshot(journal.snapshot),
    };
  });
  const last = selected.at(-1);
  return {
    items,
    pageInfo: {
      asOf: page.asOf,
      hasMore: rows.length > page.limit,
      nextCursor:
        rows.length > page.limit && last
          ? historyNextCursor(
              "events",
              `${historyScope(tenantId, conversationId)}:${cycleId}`,
              page.asOf,
              { time: last.sentAt.toISOString(), id: last.id },
            )
          : null,
    },
  };
}
