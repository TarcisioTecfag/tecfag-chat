import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { requireSession } from "../../../lib/auth-session";
import { getAiPersona } from "../../../lib/ai-persona";
import {
  approveIndustrialTriage,
  assumeIndustrialTriageManually,
  completeIndustrialTriageWithoutTransfer,
  IndustrialApprovalError,
  loadIndustrialApprovalOptions,
  type ApprovalActor,
} from "../../../lib/triage/industrial-approval-store";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function buildActor(session: any): ApprovalActor {
  return {
    id: session.operator.id,
    name: session.operator.name,
    role: session.operator.role,
    canAccessSdr: session.permissions?.valentina?.canAccessSdr === true,
  };
}

export const Route = createFileRoute("/api/valentina/triage-approval")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        const actor = buildActor(session);

        if (actor.role !== "admin" && !actor.canAccessSdr) {
          return Response.json(
            { error: "Permissão insuficiente para acessar opções de aprovação SDR.", code: "FORBIDDEN" },
            { status: 403, headers },
          );
        }

        if (getAiPersona(tenantId).triagePolicy !== "industrial") {
          return Response.json(
            { error: "Aprovação Human-in-the-Loop indisponível para este perfil." },
            { status: 404, headers },
          );
        }

        try {
          const options = await loadIndustrialApprovalOptions(db, tenantId);
          return Response.json(options, { status: 200, headers });
        } catch (err: any) {
          console.error("[api/valentina/triage-approval] Erro no GET:", err?.message || err);
          return Response.json(
            { error: "Não foi possível carregar opções de aprovação." },
            { status: 500, headers },
          );
        }
      },

      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        const actor = buildActor(session);

        if (actor.role !== "admin" && !actor.canAccessSdr) {
          return Response.json(
            { error: "Permissão insuficiente para aprovar ou concluir triagens.", code: "FORBIDDEN" },
            { status: 403, headers },
          );
        }

        if (getAiPersona(tenantId).triagePolicy !== "industrial") {
          return Response.json(
            { error: "Aprovação Human-in-the-Loop indisponível para este perfil." },
            { status: 404, headers },
          );
        }

        let body: any;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Payload JSON inválido." }, { status: 400, headers });
        }

        const action = typeof body?.action === "string" ? body.action.trim() : "";
        const conversationId =
          typeof body?.conversationId === "string" ? body.conversationId.trim() : "";

        if (!conversationId) {
          return Response.json(
            { error: "conversationId é obrigatório." },
            { status: 400, headers },
          );
        }

        try {
          if (action === "approve") {
            const result = await approveIndustrialTriage(db, tenantId, actor, {
              conversationId,
              sectorId: typeof body.sectorId === "string" && body.sectorId.trim() ? body.sectorId.trim() : null,
              operatorId: typeof body.operatorId === "string" ? body.operatorId.trim() : "",
              pipelineId: typeof body.pipelineId === "string" && body.pipelineId.trim() ? body.pipelineId.trim() : null,
              stageId: typeof body.stageId === "string" && body.stageId.trim() ? body.stageId.trim() : null,
              targetFunnel: typeof body.targetFunnel === "string" ? body.targetFunnel.trim() : null,
              sendClientConfirmation: body.sendClientConfirmation !== false,
              note: typeof body.note === "string" ? body.note.trim() : null,
            });
            return Response.json(result, { status: 200, headers });
          }

          if (action === "dismiss") {
            const result = await completeIndustrialTriageWithoutTransfer(db, tenantId, actor, {
              conversationId,
              reason: typeof body.reason === "string" ? body.reason.trim() : null,
              finishConversation: body.finishConversation !== false,
              dealAction:
                body.dealAction === "mark_lost" || body.dealAction === "move_stage"
                  ? body.dealAction
                  : "keep",
              targetPipelineId:
                typeof body.targetPipelineId === "string" ? body.targetPipelineId.trim() : null,
              targetStageId:
                typeof body.targetStageId === "string" ? body.targetStageId.trim() : null,
            });
            return Response.json(result, { status: 200, headers });
          }

          if (action === "assume") {
            const result = await assumeIndustrialTriageManually(db, tenantId, actor, conversationId);
            return Response.json(result, { status: 200, headers });
          }

          return Response.json(
            { error: "Ação inválida. Use 'approve', 'dismiss' ou 'assume'." },
            { status: 400, headers },
          );
        } catch (err: any) {
          if (err instanceof IndustrialApprovalError) {
            return Response.json({ error: err.message }, { status: err.status, headers });
          }
          console.error("[api/valentina/triage-approval] Erro no POST:", err?.message || err);
          return Response.json(
            { error: err?.message || "Erro ao processar aprovação da triagem." },
            { status: 500, headers },
          );
        }
      },
    },
  },
});
