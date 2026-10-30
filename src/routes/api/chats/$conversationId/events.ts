import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, lt, notExists, or, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { attendanceEvents, messages } from "../../../../db/schema";
import { requireSession } from "../../../../lib/auth-session";
import {
  requireConversationAccess,
  requireConversationWriteAccess,
} from "../../../../lib/access-control/conversation-access";
import {
  getDealContext,
  assertDealContextVersion,
  DealContextError,
} from "../../../../lib/crm/conversation-deal-context";
import { recordAttendanceEvent } from "../../../../lib/attendance-events";

export const Route = createFileRoute("/api/chats/$conversationId/events")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        const denied = await requireConversationAccess(session, params.conversationId);
        if (denied) return denied;
        const url = new URL(request.url);
        const cursorRaw = url.searchParams.get("cursor");
        let cursor: { at: Date; id: string } | undefined;
        if (cursorRaw) {
          try {
            const value = JSON.parse(cursorRaw);
            if (
              typeof value.id !== "string" ||
              !value.id ||
              value.id.length > 300 ||
              typeof value.at !== "string"
            )
              throw Error();
            const at = new Date(value.at);
            if (!Number.isFinite(+at)) throw Error();
            cursor = { at, id: value.id };
          } catch {
            return Response.json({ error: "Cursor inválido." }, { status: 400 });
          }
        }
        const events = await db
          .select({
            id: attendanceEvents.id,
            eventType: attendanceEvents.eventType,
            description: attendanceEvents.description,
            actorName: attendanceEvents.actorName,
            createdAt: attendanceEvents.createdAt,
            dealId: attendanceEvents.dealId,
            pendingBinding: attendanceEvents.pendingBinding,
          })
          .from(attendanceEvents)
          .where(
            and(
              eq(attendanceEvents.tenantId, tenantId),
              eq(attendanceEvents.conversationId, params.conversationId),
              sql`${attendanceEvents.eventType} NOT IN ('message.sending', 'message.accepted', 'message.delivered', 'message.read')`,
              cursor
                ? or(
                    lt(attendanceEvents.createdAt, cursor.at),
                    and(
                      eq(attendanceEvents.createdAt, cursor.at),
                      lt(attendanceEvents.id, cursor.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(attendanceEvents.createdAt), desc(attendanceEvents.id))
          .limit(51);
        // Compatibilidade histórica sem fabricar eventos retroativos nem enviá-los ao CRM.
        const legacyTimestamp = sql`date_trunc('milliseconds', ${messages.sentAt})`;
        const legacy = await db
          .select({
            id: messages.id,
            description: messages.content,
            actorName: messages.senderName,
            createdAt: messages.sentAt,
          })
          .from(messages)
          .where(
            and(
              eq(messages.tenantId, tenantId),
              eq(messages.conversationId, params.conversationId),
              or(eq(messages.senderType, "system"), eq(messages.isInternalNote, true)),
              cursor
                ? or(
                    lt(legacyTimestamp, cursor.at),
                    and(eq(legacyTimestamp, cursor.at), lt(messages.id, cursor.id)),
                  )
                : undefined,
              notExists(
                db
                  .select({ id: attendanceEvents.id })
                  .from(attendanceEvents)
                  .where(
                    and(
                      eq(attendanceEvents.tenantId, tenantId),
                      eq(attendanceEvents.conversationId, params.conversationId),
                      eq(
                        attendanceEvents.sourceKey,
                        sql`'message:' || ${messages.id} || ':created'`,
                      ),
                    ),
                  ),
              ),
              sql`coalesce(${messages.metaDetails}->>'attendanceSkip', '') <> 'true'`,
            ),
          )
          .orderBy(desc(legacyTimestamp), desc(messages.id))
          .limit(51);
        const merged = [
          ...events,
          ...legacy.map((row) => ({
            ...row,
            eventType: "legacy.recorded",
            dealId: null,
            pendingBinding: false,
            legacy: true,
          })),
        ].sort((a, b) => +b.createdAt - +a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
        const page = merged.slice(0, 50);
        const last = page.at(-1);
        return Response.json(
          {
            events: page,
            nextCursor:
              merged.length > 50 && last
                ? JSON.stringify({ at: last.createdAt.toISOString(), id: last.id })
                : null,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
      POST: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const denied = await requireConversationWriteAccess(session, params.conversationId);
          if (denied) return denied;
          const body = await request.json();
          // Somente intenções da UI. A conclusão real vem da escrita autoritativa no servidor.
          if (
            body.eventType !== "note.form_opened" ||
            typeof body.actionId !== "string" ||
            !/^[a-zA-Z0-9-]{1,100}$/.test(body.actionId)
          )
            return Response.json({ error: "Evento inválido." }, { status: 400 });
          if (!session.permissions.chat.canSendInternalNotes)
            return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
          await db.transaction(async (tx) => {
            const state = await getDealContext(
              tx,
              tenantId,
              params.conversationId,
              session.operator.id,
            );
            if (
              state.conversation.operatorId !== session.operator.id ||
              state.conversation.queueState !== "meus"
            )
              throw new DealContextError("O responsável pelo atendimento mudou.", "FORBIDDEN", 403);
            assertDealContextVersion(state.context, body.expectedContextVersion);
            await recordAttendanceEvent(tx, {
              tenantId,
              conversationId: params.conversationId,
              sourceKey: `ui:${body.actionId}`,
              eventType: body.eventType,
              actorName: session.operator.name,
              operatorId: session.operator.id,
              description: `${session.operator.name} abriu o formulário de nota interna.`,
            });
          });
          return Response.json({ success: true });
        } catch (error) {
          if (error instanceof DealContextError)
            return Response.json(
              { error: error.message, code: error.code },
              { status: error.statusCode },
            );
          console.error("[attendance-events]", error);
          return Response.json({ error: "Não foi possível registrar a ação." }, { status: 500 });
        }
      },
    },
  },
});
