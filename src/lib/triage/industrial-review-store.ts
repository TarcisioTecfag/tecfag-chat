import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { agentFlowStates, conversations, operators } from "../../db/schema";
import type { IndustrialDatabase, IndustrialTransaction } from "./industrial-rodizio-store";
import { buildJournalSnapshot, normalizeJournalData } from "./industrial-triage-journal";
import { appendIndustrialJournal } from "./industrial-triage-journal-store";
import { buildIndustrialBriefing } from "./industrial-briefing";
import {
  assessIndustrialReadiness,
  INDUSTRIAL_ROUTES,
  isIndustrialSubflow,
} from "./industrial-policy";
import {
  INDUSTRIAL_REVIEW_FIELDS,
  industrialReviewInput,
  reviewAccess,
  reviewDataHash,
  type ReviewActor,
} from "./industrial-review-contract";

export class IndustrialReviewError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
type State = Awaited<ReturnType<typeof readState>>;
async function readState(
  db: IndustrialDatabase | IndustrialTransaction,
  tenantId: string,
  conversationId: string,
  lock = false,
) {
  const convQuery = db
    .select()
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)));
  const [conversation] = await (lock ? convQuery.for("update") : convQuery.limit(1));
  if (!conversation) throw new IndustrialReviewError(404, "Atendimento não encontrado.");
  const flowQuery = db
    .select()
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
  const [flow] = await (lock ? flowQuery.for("update") : flowQuery);
  if (!flow) throw new IndustrialReviewError(404, "Ciclo de triagem não encontrado.");
  return { conversation, flow };
}
function project(state: State, actor: ReviewActor) {
  const access = reviewAccess(actor, state.conversation, state.flow);
  if (!access.visible)
    throw new IndustrialReviewError(403, access.reason || "Permissão insuficiente.");
  const snapshot = buildJournalSnapshot(state.flow);
  const revision = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  const fields = Object.fromEntries(
    INDUSTRIAL_REVIEW_FIELDS.filter((key) => key !== "CNPJ" && key !== "CPF").map((key) => [
      key,
      snapshot.collectedData[key] ||
        (key === "CNPJ OU CPF"
          ? snapshot.collectedData.CNPJ || snapshot.collectedData.CPF
          : null) || { value: "", status: "pending" as const },
    ]),
  );
  return { snapshot, revision, access, fields, briefing: buildIndustrialBriefing(snapshot) };
}
export async function readIndustrialReview(
  database: IndustrialDatabase,
  tenantId: string,
  conversationId: string,
  actor: ReviewActor,
) {
  return project(await readState(database, tenantId, conversationId), actor);
}
export async function saveIndustrialReview(
  database: IndustrialDatabase,
  tenantId: string,
  actor: ReviewActor,
  raw: unknown,
) {
  const parsed = industrialReviewInput.safeParse(raw);
  if (!parsed.success)
    throw new IndustrialReviewError(400, parsed.error.issues[0]?.message || "Revisão inválida.");
  const input = parsed.data;
  return database.transaction(async (tx) => {
    const state = await readState(tx, tenantId, input.conversationId, true);
    const current = project(state, actor);
    if (current.snapshot.cycleId !== input.cycleId || current.revision !== input.expectedRevision)
      throw new IndustrialReviewError(
        409,
        "A triagem mudou. Atualize os dados antes de salvar a revisão.",
      );
    if (!current.access.editable)
      throw new IndustrialReviewError(403, current.access.reason || "Revisão não permitida.");
    const [operator] = await tx
      .select({ id: operators.id, name: operators.name })
      .from(operators)
      .where(and(eq(operators.tenantId, tenantId), eq(operators.id, actor.id)))
      .limit(1);
    if (!operator) throw new IndustrialReviewError(403, "Operador indisponível neste tenant.");
    const existing =
      state.flow.collectedData &&
      typeof state.flow.collectedData === "object" &&
      !Array.isArray(state.flow.collectedData)
        ? (state.flow.collectedData as Record<string, unknown>)
        : {};
    const merged = { ...existing };
    for (const [key, field] of Object.entries(input.fields)) {
      if (["CNPJ OU CPF", "CNPJ", "CPF"].includes(key)) {
        for (const alias of ["CNPJ OU CPF", "CNPJ", "CPF"]) delete merged[alias];
        delete merged._RECEITA_FEDERAL;
      }
      merged[key] = field;
    }
    const now = new Date(Math.max(Date.now(), +state.flow.lastInteractionAt + 1));
    const metadata =
      state.flow.metadata && typeof state.flow.metadata === "object"
        ? (state.flow.metadata as Record<string, unknown>)
        : {};
    const catalogChanged = [
      "CNPJ OU CPF",
      "CNPJ",
      "CPF",
      "MÁQUINA / PEÇA / INTERESSE",
      "RAMO / O QUE EMBALA",
      "VOLUME / PRODUÇÃO",
      "MODELO DA MÁQUINA",
      "SOLICITAÇÃO",
    ].some(
      (key) => key in input.fields && JSON.stringify(existing[key]) !== JSON.stringify(merged[key]),
    );
    const decision =
      metadata.machineDecision && typeof metadata.machineDecision === "object"
        ? (metadata.machineDecision as Record<string, unknown>)
        : null;
    const subflow = isIndustrialSubflow(metadata.subflow) ? metadata.subflow : null;
    const readiness = assessIndustrialReadiness(
      {
        subflow,
        funnelStage: subflow ? INDUSTRIAL_ROUTES[subflow].stage : "triagem",
        targetFunnel: subflow ? INDUSTRIAL_ROUTES[subflow].funnel : null,
        needsReview: metadata.needsReview === true || catalogChanged,
        reason: "previous_route",
      },
      merged as Parameters<typeof assessIndustrialReadiness>[1],
    );
    const [updated] = await tx
      .update(agentFlowStates)
      .set({
        collectedData: merged,
        lastInteractionAt: now,
        metadata: {
          ...metadata,
          missingFields: readiness.missing,
          readyForHandoff: readiness.ready,
          ...(catalogChanged
            ? {
                needsReview: true,
                ...(decision
                  ? {
                      machineDecision: {
                        ...decision,
                        status: "review",
                        machineId: null,
                        line: null,
                        confidence: 0,
                        method: "rule",
                        reason:
                          "Dados alterados na revisão humana; a decisão anterior precisa ser reavaliada.",
                      },
                    }
                  : {}),
              }
            : {}),
          humanReview: {
            version: 1,
            cycle: state.flow.startedAt.toISOString(),
            operatorId: operator.id,
            operatorName: operator.name,
            reviewedAt: now.toISOString(),
            reason: input.reason,
            dataHash: reviewDataHash(normalizeJournalData(merged)),
          },
        },
      })
      .where(
        and(
          eq(agentFlowStates.tenantId, tenantId),
          eq(agentFlowStates.id, state.flow.id),
          eq(agentFlowStates.conversationId, input.conversationId),
        ),
      )
      .returning();
    await appendIndustrialJournal(
      tx,
      state.flow,
      updated,
      "human_review",
      `${actor.id}:${input.expectedRevision}`,
    );
    return project({ conversation: state.conversation, flow: updated }, actor);
  });
}
