import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import { crmDealActivities, crmDealEvents, crmDeals, messages } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { requireConversationWriteAccess } from "../../../lib/access-control/conversation-access";
import {
  getDealContext,
  assertDealContextVersion,
  DealContextError,
} from "../../../lib/crm/conversation-deal-context";

export const Route = createFileRoute("/api/chats/tag-task")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const body = await request.json();
          const { conversationId, tagName, taskType = "task", dueDate, dueTime = "09:00" } = body;
          if (typeof conversationId !== "string" || !conversationId)
            return Response.json({ error: "Atendimento inválido." }, { status: 400 });
          const denied = await requireConversationWriteAccess(session, conversationId);
          if (denied) return denied;
          if (!session.permissions.chat.canManageTags)
            return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
          if (
            typeof conversationId !== "string" ||
            typeof tagName !== "string" ||
            !tagName.trim() ||
            !["task", "call", "meeting", "email", "lunch", "whatsapp", "visit"].includes(taskType)
          )
            return Response.json(
              { error: "Atendimento, nome ou tipo de tarefa inválido." },
              { status: 400 },
            );
          if (
            typeof dueDate !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
            typeof dueTime !== "string" ||
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime)
          )
            return Response.json({ error: "Data ou horário inválido." }, { status: 400 });
          const dueAt = new Date(`${dueDate}T${dueTime}:00-03:00`);
          if (Number.isNaN(dueAt.getTime()))
            return Response.json({ error: "Data inválida." }, { status: 400 });
          const result = await db.transaction(async (tx) => {
            const state = await getDealContext(tx, tenantId, conversationId, session.operator.id);
            if (
              state.conversation.operatorId !== session.operator.id ||
              state.conversation.queueState !== "meus"
            )
              throw new DealContextError("O responsável pelo atendimento mudou.", "FORBIDDEN", 403);
            assertDealContextVersion(state.context, body.expectedContextVersion);
            const deal = state.deals.find((d) => d.id === state.context.currentDealId);
            if (!deal)
              throw new DealContextError(
                "Selecione a negociação deste atendimento antes de criar a tarefa.",
                "DEAL_CONTEXT_REQUIRED",
              );
            const activityId = `task-${crypto.randomUUID()}`;
            const messageId = `sys-${crypto.randomUUID()}`;
            const now = new Date();
            await tx.insert(crmDealActivities).values({
              id: activityId,
              tenantId,
              dealId: deal.id,
              conversationId,
              type: taskType,
              title: tagName.trim(),
              dueDate: dueAt,
              operatorId: session.operator.id,
              assignedToOperatorId: deal.operatorId || session.operator.id,
            });
            await tx
              .update(crmDeals)
              .set({ lastActivityAt: now, updatedAt: now })
              .where(and(eq(crmDeals.id, deal.id), eq(crmDeals.tenantId, tenantId)));
            await tx.insert(crmDealEvents).values({
              id: `evt-${crypto.randomUUID()}`,
              tenantId,
              dealId: deal.id,
              operatorId: session.operator.id,
              eventType: "activity_created",
              metadata: { activityId, conversationId, messageId, title: tagName.trim() },
            });
            await tx.insert(messages).values({
              id: messageId,
              tenantId,
              conversationId,
              senderType: "system",
              senderName: "Sistema",
              metaDetails: { attendanceActor: { name: session.operator.name, operatorId: session.operator.id }, activityId },
              content: `Tarefa criada na negociação “${deal.title}”: ${tagName.trim()}.`,
              isInternalNote: true,
              direction: "outbound",
              status: "accepted",
            });
            return { activityId };
          });
          return Response.json({ success: true, taskCreated: true, activityId: result.activityId });
        } catch (error) {
          if (error instanceof DealContextError)
            return Response.json(
              { error: error.message, code: error.code },
              { status: error.statusCode },
            );
          console.error("[TagTask]", error);
          return Response.json({ error: "Não foi possível criar a tarefa." }, { status: 500 });
        }
      },
    },
  },
});
