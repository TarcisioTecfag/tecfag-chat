import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { requireSession } from "../../../lib/auth-session";
import { getAiPersona } from "../../../lib/ai-persona";
import {
  IndustrialReviewError,
  readIndustrialReview,
  saveIndustrialReview,
} from "../../../lib/triage/industrial-review-store";
import type { ReviewActor } from "../../../lib/triage/industrial-review-contract";

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
async function handle(request: Request, write: boolean) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const tenantId = session.tenantId;
  if (getAiPersona(tenantId).triagePolicy !== "industrial")
    return Response.json({ error: "Recurso indisponível." }, { status: 404, headers });
  const permissions = session.permissions;
  const actor: ReviewActor = {
    id: session.operator.id,
    name: session.operator.name,
    role: session.operator.role,
    permissions: {
      canView: permissions?.views?.chat === true || permissions?.valentina?.canAccessSdr === true,
      canViewAll:
        permissions?.chat?.canViewAllChats === true ||
        permissions?.valentina?.canAccessSdr === true,
      canEditClientInfo: permissions?.chat?.canEditClientInfo === true,
      canSendInternalNotes: permissions?.chat?.canSendInternalNotes === true,
      canOverrideChat: permissions?.chat?.canOverrideChat === true,
    },
  };
  if (actor.role !== "admin" && !actor.permissions.canView)
    return Response.json({ error: "Permissão insuficiente." }, { status: 403, headers });
  try {
    if (write) {
      const text = await request.text();
      if (text.length > 32_000)
        throw new IndustrialReviewError(400, "Revisão excede o limite permitido.");
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new IndustrialReviewError(400, "JSON inválido.");
      }
      const result = await saveIndustrialReview(db, tenantId, actor, body);
      return Response.json(result, { headers });
    }
    const params = new URL(request.url).searchParams;
    const conversationId = params.get("conversationId");
    const cycleId = params.get("cycleId");
    if (!conversationId || conversationId.length > 240 || (cycleId && cycleId.length > 600))
      throw new IndustrialReviewError(400, "Identificador inválido.");
    const result = await readIndustrialReview(db, tenantId, conversationId, actor);
    if (cycleId && result.snapshot.cycleId !== cycleId)
      throw new IndustrialReviewError(409, "O ciclo mudou. Atualize o histórico.");
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof IndustrialReviewError)
      return Response.json({ error: error.message }, { status: error.status, headers });
    console.error("[triage-review] Falha ao consultar ou registrar revisão");
    return Response.json(
      { error: "Revisão temporariamente indisponível." },
      { status: 503, headers },
    );
  }
}
export const Route = createFileRoute("/api/valentina/triage-review")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request, false),
      POST: async ({ request }) => handle(request, true),
    },
  },
});
