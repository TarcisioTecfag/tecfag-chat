import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../../db";
import { requireSession } from "../../../../lib/auth-session";
import {
  requireConversationAccess,
  requireConversationWriteAccess,
} from "../../../../lib/access-control/conversation-access";
import {
  canReadCrmDeal,
  requireCrmDealAccess,
} from "../../../../lib/access-control/crm-record-access";
import {
  getDealContext,
  selectDealContext,
  DealContextError,
  findActiveGraceDeal,
  getDealPostCloseGraceExpiresAt,
} from "../../../../lib/crm/conversation-deal-context";

const failure = (error: unknown) =>
  error instanceof DealContextError
    ? Response.json({ error: error.message, code: error.code }, { status: error.statusCode })
    : (console.error("[deal-context]", error),
      Response.json(
        { error: "Não foi possível atualizar a negociação do atendimento." },
        { status: 500 },
      ));

export const Route = createFileRoute("/api/chats/$conversationId/deal-context")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const denied = await requireConversationAccess(session, params.conversationId);
          if (denied) return denied;
          const state = await db.transaction((tx) =>
            getDealContext(tx, tenantId, params.conversationId, session.operator.id),
          );
          const visible = state.deals.filter(deal => canReadCrmDeal(session, deal));
          const editable =
            state.conversation.queueState === "meus" &&
            state.conversation.operatorId === session.operator.id;
          const currentDeal = visible.find((d) => d.id === state.context.currentDealId) || null;
          const graceDeal = !currentDeal
            ? findActiveGraceDeal(visible, [state.context.currentDealId, state.context.previousDealId])
            : null;
          const gracePeriodActive = Boolean(graceDeal);
          return Response.json(
            {
              version: state.context.version,
              currentDeal,
              previousDeal: visible.find((d) => d.id === state.context.previousDealId) || null,
              hasCurrentDeal: Boolean(state.context.currentDealId),
              selectionRequired: !state.context.currentDealId && !gracePeriodActive,
              gracePeriodActive,
              graceDeal: graceDeal
                ? {
                    id: graceDeal.id,
                    title: graceDeal.title,
                    status: graceDeal.status,
                    closedAt: graceDeal.closedAt ?? null,
                  }
                : null,
              graceExpiresAt: getDealPostCloseGraceExpiresAt(graceDeal),
              editable,
              deals: visible,
              contactId: state.conversation.contactId,
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (error) {
          return failure(error);
        }
      },
      PATCH: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const denied = await requireConversationWriteAccess(session, params.conversationId);
          if (denied) return denied;
          const body = await request.json();
          if (body.dealId !== null && (typeof body.dealId !== "string" || !body.dealId))
            return Response.json({ error: "Negociação inválida." }, { status: 400 });
          if (body.dealId) {
            const deniedDeal = await requireCrmDealAccess(session, body.dealId);
            if (deniedDeal) return deniedDeal;
          }
          const context = await db.transaction(async (tx) => {
            const state = await getDealContext(
              tx,
              tenantId,
              params.conversationId,
              session.operator.id,
            );
            // A autorização é reavaliada sob o mesmo lock que grava a escolha.
            if (
              state.conversation.operatorId !== session.operator.id ||
              state.conversation.queueState !== "meus"
            )
              throw new DealContextError("O responsável pelo atendimento mudou.", "FORBIDDEN", 403);
            return selectDealContext(
              tx,
              tenantId,
              params.conversationId,
              body.dealId,
              session.operator.id,
              body.expectedVersion,
            );
          });
          return Response.json({ success: true, version: context.version });
        } catch (error) {
          return failure(error);
        }
      },
    },
  },
});
