import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  contacts,
  crmAccounts,
  crmConversationDeals,
  crmDealActivities,
  crmDealContacts,
  crmDealEvents,
  crmDeals,
  crmPipelines,
  crmStages,
} from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import {
  isTestEntityTitle,
  loadDealSectorResolutionContext,
  resolveDealCurrentSector,
} from "../marketing/crm-attribution";
import {
  ensureLocalCrmDealBeforeTransfer,
  LEAD_TRANSFER_TASK_TITLE,
} from "../valentina/sdr-crm-local";
import { normalizeTriageText } from "./industrial-policy";
import type { IndustrialDatabase, IndustrialTransaction } from "./industrial-rodizio-store";

export interface CwrPipelineInfo {
  pipelineId: string;
  pipelineName: string;
  prospectsStageId: string | null;
  contatarStageId: string | null;
  contatandoStageId: string | null;
}

export async function resolveCwrPipelineAndStages(
  tx: IndustrialDatabase | IndustrialTransaction,
  tenantId: string,
): Promise<CwrPipelineInfo | null> {
  const pipelines = await tx
    .select({ id: crmPipelines.id, name: crmPipelines.name })
    .from(crmPipelines)
    .where(eq(crmPipelines.tenantId, tenantId))
    .orderBy(asc(crmPipelines.orderIndex));

  const cwr =
    pipelines.find((p) => normalizeTriageText(p.name) === "funil cwr") ||
    pipelines.find((p) => normalizeTriageText(p.name).includes("cwr"));

  if (!cwr) return null;

  const stages = await tx
    .select({ id: crmStages.id, name: crmStages.name, orderIndex: crmStages.orderIndex })
    .from(crmStages)
    .where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.pipelineId, cwr.id)))
    .orderBy(asc(crmStages.orderIndex));

  const findStage = (target: string) =>
    stages.find((s) => normalizeTriageText(s.name) === target)?.id || null;

  return {
    pipelineId: cwr.id,
    pipelineName: cwr.name,
    prospectsStageId: findStage("prospects"),
    contatarStageId: findStage("contatar"),
    contatandoStageId: findStage("contatando"),
  };
}

function isPlaceholderName(raw?: string | null): boolean {
  const clean = (raw || "").trim();
  if (!clean) return true;
  if (/^(cliente|contato|visitante|lead|whatsapp|sem nome|cliente whatsapp)$/i.test(clean)) {
    return true;
  }
  return /^\+?\d{8,20}$/.test(clean.replace(/[\s().-]/g, ""));
}

async function ensureConversationDealLinkInTx(
  tx: IndustrialDatabase | IndustrialTransaction,
  tenantId: string,
  conversationId: string,
  dealId: string,
  origin: "auto_sdr" | "crm" | "chat" = "auto_sdr",
  createdByOperatorId: string | null = null,
) {
  const [existing] = await tx
    .select({ id: crmConversationDeals.id })
    .from(crmConversationDeals)
    .where(
      and(
        eq(crmConversationDeals.tenantId, tenantId),
        eq(crmConversationDeals.conversationId, conversationId),
        eq(crmConversationDeals.dealId, dealId),
        eq(crmConversationDeals.isActive, true),
      ),
    )
    .limit(1);

  if (existing) return;

  await tx
    .insert(crmConversationDeals)
    .values({
      id: `cd-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      tenantId,
      conversationId,
      dealId,
      origin,
      createdByOperatorId,
      isActive: true,
      createdAt: new Date(),
    })
    .onConflictDoNothing();
}

async function ensureDealContactLinkInTx(
  tx: IndustrialDatabase | IndustrialTransaction,
  tenantId: string,
  dealId: string,
  contactId: string,
) {
  await tx
    .insert(crmDealContacts)
    .values({
      id: `dc-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      tenantId,
      dealId,
      contactId,
      role: "buyer",
      isPrimary: true,
      createdAt: new Date(),
    })
    .onConflictDoNothing();
}

export interface EnsureCwrContactingResult {
  ok: boolean;
  action: "moved_to_contacting" | "created_in_contacting" | "already_contacting" | "skipped";
  dealId?: string;
  dealTitle?: string;
  pipelineId?: string;
  stageId?: string;
  reason?: string;
}

/**
 * Garante o ciclo de vida no FUNIL CWR quando o Fagner envia o template (RD Marketing)
 * ou responde pela primeira vez a um cliente no WhatsApp:
 * - Se já existe card aberto no CWR em `PROSPECTS` ou `CONTATAR`, move para `CONTATANDO`.
 * - Se já existe card aberto vinculado à conversa em outro funil, preserva sem duplicar.
 * - Se não existe nenhum card aberto vinculado, cria um novo card no `FUNIL CWR` já em `CONTATANDO`.
 */
export async function ensureCwrDealOnContacting(
  tx: IndustrialDatabase | IndustrialTransaction,
  params: {
    tenantId: string;
    conversationId: string;
    contactId: string | null;
    clientName?: string | null;
    companyName?: string | null;
    dealIdHint?: string | null;
    actorName?: string | null;
  },
): Promise<EnsureCwrContactingResult> {
  const { tenantId, conversationId, contactId } = params;
  const cwr = await resolveCwrPipelineAndStages(tx, tenantId);
  if (!cwr || !cwr.contatandoStageId) {
    return { ok: false, action: "skipped", reason: "cwr_pipeline_or_stage_not_found" };
  }

  const persona = getAiPersona(tenantId);
  const actorName = params.actorName || persona.name;
  const now = new Date();

  let targetDeal: typeof crmDeals.$inferSelect | null = null;

  if (params.dealIdHint) {
    const [hinted] = await tx
      .select()
      .from(crmDeals)
      .where(
        and(
          eq(crmDeals.tenantId, tenantId),
          eq(crmDeals.id, params.dealIdHint),
          eq(crmDeals.status, "open"),
        ),
      )
      .limit(1);
    if (hinted) targetDeal = hinted;
  }

  if (!targetDeal) {
    const linked = await tx
      .select({ deal: crmDeals })
      .from(crmConversationDeals)
      .innerJoin(
        crmDeals,
        and(eq(crmDeals.id, crmConversationDeals.dealId), eq(crmDeals.tenantId, tenantId)),
      )
      .where(
        and(
          eq(crmConversationDeals.tenantId, tenantId),
          eq(crmConversationDeals.conversationId, conversationId),
          eq(crmConversationDeals.isActive, true),
          eq(crmDeals.status, "open"),
        ),
      )
      .orderBy(desc(crmDeals.updatedAt), desc(crmDeals.createdAt))
      .limit(5);

    targetDeal =
      linked.find((row) => row.deal.pipelineId === cwr.pipelineId)?.deal ||
      linked[0]?.deal ||
      null;
  }

  if (!targetDeal && contactId) {
    const contactDeals = await tx
      .select({ deal: crmDeals })
      .from(crmDealContacts)
      .innerJoin(
        crmDeals,
        and(eq(crmDeals.id, crmDealContacts.dealId), eq(crmDeals.tenantId, tenantId)),
      )
      .where(
        and(
          eq(crmDealContacts.tenantId, tenantId),
          eq(crmDealContacts.contactId, contactId),
          eq(crmDeals.pipelineId, cwr.pipelineId),
          eq(crmDeals.status, "open"),
        ),
      )
      .orderBy(desc(crmDeals.updatedAt), desc(crmDeals.createdAt))
      .limit(1);

    if (contactDeals[0]?.deal) {
      targetDeal = contactDeals[0].deal;
    }
  }

  if (targetDeal) {
    await ensureConversationDealLinkInTx(tx, tenantId, conversationId, targetDeal.id, "auto_sdr");
    if (contactId) {
      await ensureDealContactLinkInTx(tx, tenantId, targetDeal.id, contactId);
    }

    const movableFromStages = new Set(
      [cwr.prospectsStageId, cwr.contatarStageId].filter((id): id is string => Boolean(id)),
    );

    if (targetDeal.pipelineId === cwr.pipelineId && movableFromStages.has(targetDeal.stageId)) {
      const fromStageId = targetDeal.stageId;
      await tx
        .update(crmDeals)
        .set({
          stageId: cwr.contatandoStageId,
          version: sql`${crmDeals.version} + 1`,
          lastActivityAt: now,
          updatedAt: now,
        })
        .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, targetDeal.id)));

      await tx.insert(crmDealEvents).values({
        id: `ev-cwr-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
        tenantId,
        dealId: targetDeal.id,
        eventType: "stage_changed",
        fromStageId,
        toStageId: cwr.contatandoStageId,
        operatorId: null,
        metadata: {
          origin: "auto_sdr_cwr",
          actorName,
          actorType: "ai_sdr",
          conversationId,
          pipelineId: cwr.pipelineId,
          toStageName: "CONTATANDO",
        },
        createdAt: now,
      });

      return {
        ok: true,
        action: "moved_to_contacting",
        dealId: targetDeal.id,
        dealTitle: targetDeal.title,
        pipelineId: cwr.pipelineId,
        stageId: cwr.contatandoStageId,
      };
    }

    return {
      ok: true,
      action: "already_contacting",
      dealId: targetDeal.id,
      dealTitle: targetDeal.title,
      pipelineId: targetDeal.pipelineId,
      stageId: targetDeal.stageId,
    };
  }

  // Nenhum card aberto vinculado: cria no FUNIL CWR já na etapa CONTATANDO
  let contactRow: typeof contacts.$inferSelect | null = null;
  if (contactId) {
    const [found] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)))
      .limit(1);
    contactRow = found || null;
  }

  const resolvedName =
    (!isPlaceholderName(params.clientName) ? params.clientName?.trim() : null) ||
    (!isPlaceholderName(contactRow?.name) ? contactRow?.name?.trim() : null) ||
    contactRow?.phone ||
    "Lead WhatsApp";
  const resolvedCompany =
    params.companyName && !isPlaceholderName(params.companyName)
      ? params.companyName.trim()
      : null;
  const dealTitle = resolvedCompany ? `${resolvedName} - ${resolvedCompany}` : resolvedName;
  const newDealId = `deal-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;

  await tx.insert(crmDeals).values({
    id: newDealId,
    tenantId,
    title: dealTitle,
    accountId: contactRow?.accountId || null,
    pipelineId: cwr.pipelineId,
    stageId: cwr.contatandoStageId,
    originalPipelineId: cwr.pipelineId,
    status: "open",
    operatorId: null,
    entryChannel: contactRow?.entryChannel || "whatsapp",
    source: contactRow?.firstSource || "WhatsApp",
    campaign: contactRow?.firstCampaign || null,
    utmSource: contactRow?.utmSource || null,
    utmMedium: contactRow?.utmMedium || null,
    utmCampaign: contactRow?.utmCampaign || null,
    utmContent: contactRow?.utmContent || null,
    utmTerm: contactRow?.utmTerm || null,
    clickId: contactRow?.clickId || null,
    landingPage: contactRow?.landingPage || null,
    sectorOrigin: "pre_venda",
    sectorCurrent: "pre_venda",
    isTest: isTestEntityTitle(dealTitle),
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  });

  if (contactId) {
    await ensureDealContactLinkInTx(tx, tenantId, newDealId, contactId);
  }
  await ensureConversationDealLinkInTx(tx, tenantId, conversationId, newDealId, "auto_sdr");

  await tx.insert(crmDealEvents).values({
    id: `ev-cwr-create-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
    tenantId,
    dealId: newDealId,
    eventType: "created",
    toStageId: cwr.contatandoStageId,
    toStatus: "open",
    operatorId: null,
    metadata: {
      origin: "auto_sdr_cwr",
      actorName,
      actorType: "ai_sdr",
      conversationId,
      pipelineId: cwr.pipelineId,
      stageName: "CONTATANDO",
    },
    createdAt: now,
  });

  return {
    ok: true,
    action: "created_in_contacting",
    dealId: newDealId,
    dealTitle,
    pipelineId: cwr.pipelineId,
    stageId: cwr.contatandoStageId,
  };
}

export interface MoveDealOnSdrApprovalParams {
  tenantId: string;
  conversationId: string;
  contactId: string | null;
  contactPhone: string;
  dealIdHint?: string | null;
  targetPipelineId: string;
  targetStageId: string;
  targetOperatorId: string;
  targetOperatorName: string;
  targetFunnel: string;
  funnelStage?: string;
  clientName?: string | null;
  companyName?: string | null;
  collectedData?: Record<string, { value?: string; status?: string }> | null;
  approvedByOperatorId: string;
  approvedByOperatorName: string;
}

export interface MoveDealOnSdrApprovalResult {
  dealId: string;
  dealTitle: string;
  action: "moved_existing" | "created_new" | "reused_within_3h";
  pipelineId: string;
  stageId: string;
  taskId: string | null;
  taskTitle: string | null;
}

/**
 * Na aprovação pelo SDR humano (Human-in-the-Loop):
 * - Se a conversa já possui um card aberto (ex.: no FUNIL CWR), MOVE esse card para o
 *   funil e etapa de destino aprovados, atribui o operador responsável e cria a tarefa
 *   "Responder o contato" + nota de triagem.
 * - Caso não exista card aberto vinculado, cria o novo card diretamente no funil/etapa aprovados.
 */
export async function moveDealOnSdrApproval(
  tx: IndustrialTransaction,
  params: MoveDealOnSdrApprovalParams,
): Promise<MoveDealOnSdrApprovalResult> {
  const {
    tenantId,
    conversationId,
    contactId,
    contactPhone,
    targetPipelineId,
    targetStageId,
    targetOperatorId,
    targetOperatorName,
    targetFunnel,
    approvedByOperatorId,
    approvedByOperatorName,
  } = params;

  const now = new Date();
  const persona = getAiPersona(tenantId);

  const cwr = await resolveCwrPipelineAndStages(tx, tenantId);

  // 1. Localizar card aberto existente da conversa (priorizando dealIdHint ou card no CWR)
  let existingDeal: typeof crmDeals.$inferSelect | null = null;

  if (params.dealIdHint) {
    const [hinted] = await tx
      .select()
      .from(crmDeals)
      .where(
        and(
          eq(crmDeals.tenantId, tenantId),
          eq(crmDeals.id, params.dealIdHint),
          eq(crmDeals.status, "open"),
        ),
      )
      .for("update")
      .limit(1);
    if (hinted) existingDeal = hinted;
  }

  if (!existingDeal) {
    const linkedDeals = await tx
      .select({ deal: crmDeals })
      .from(crmConversationDeals)
      .innerJoin(
        crmDeals,
        and(eq(crmDeals.id, crmConversationDeals.dealId), eq(crmDeals.tenantId, tenantId)),
      )
      .where(
        and(
          eq(crmConversationDeals.tenantId, tenantId),
          eq(crmConversationDeals.conversationId, conversationId),
          eq(crmConversationDeals.isActive, true),
          eq(crmDeals.status, "open"),
        ),
      )
      .orderBy(desc(crmDeals.updatedAt), desc(crmDeals.createdAt))
      .limit(5);

    const candidate =
      (cwr ? linkedDeals.find((r) => r.deal.pipelineId === cwr.pipelineId)?.deal : null) ||
      linkedDeals[0]?.deal ||
      null;

    if (candidate) {
      const [locked] = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, candidate.id)))
        .for("update")
        .limit(1);
      existingDeal = locked || null;
    }
  }

  if (!existingDeal && contactId && cwr) {
    const [cwrContactDeal] = await tx
      .select({ deal: crmDeals })
      .from(crmDealContacts)
      .innerJoin(
        crmDeals,
        and(eq(crmDeals.id, crmDealContacts.dealId), eq(crmDeals.tenantId, tenantId)),
      )
      .where(
        and(
          eq(crmDealContacts.tenantId, tenantId),
          eq(crmDealContacts.contactId, contactId),
          eq(crmDeals.pipelineId, cwr.pipelineId),
          eq(crmDeals.status, "open"),
        ),
      )
      .orderBy(desc(crmDeals.updatedAt), desc(crmDeals.createdAt))
      .limit(1);

    if (cwrContactDeal?.deal) {
      const [locked] = await tx
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, cwrContactDeal.deal.id)))
        .for("update")
        .limit(1);
      existingDeal = locked || null;
    }
  }

  // Normalizar dados coletados para nota/criação
  const normalizedCollected: Record<string, { value: string; status: "filled" | "pending" }> = {};
  for (const [k, entry] of Object.entries(params.collectedData || {})) {
    if (k.startsWith("_")) continue;
    const val = typeof entry?.value === "string" ? entry.value.trim() : "";
    if (val && !/^aguardando/i.test(val)) {
      normalizedCollected[k] = {
        value: val,
        status: entry?.status === "filled" ? "filled" : "pending",
      };
    }
  }

  if (!existingDeal) {
    const created = await ensureLocalCrmDealBeforeTransfer(
      {
        tenantId,
        conversationId,
        contactId,
        contactPhone,
        clientName: params.clientName || undefined,
        companyName: params.companyName || undefined,
        targetOperatorId,
        targetOperatorName,
        targetFunnel,
        funnelStage: params.funnelStage || "Qualificação",
        collectedData: normalizedCollected,
        requireConfiguredPipeline: true,
        destination: {
          pipelineId: targetPipelineId,
          stageId: targetStageId,
        },
      },
      tx,
    );

    if (!created.success || !created.dealId) {
      throw new Error(created.error || "Não foi possível criar a negociação no funil de destino.");
    }

    return {
      dealId: created.dealId,
      dealTitle: created.dealTitle,
      action: created.action,
      pipelineId: created.pipelineId || targetPipelineId,
      stageId: created.stageId || targetStageId,
      taskId: created.taskId || null,
      taskTitle: created.taskTitle || null,
    };
  }

  // 2. Mover o card existente para o funil + etapa de destino + operador responsável
  const fromPipelineId = existingDeal.pipelineId;
  const fromStageId = existingDeal.stageId;
  const fromOperatorId = existingDeal.operatorId;

  let resolvedAccountId = existingDeal.accountId;
  if (!resolvedAccountId && contactId) {
    const [cnt] = await tx
      .select({ accountId: contacts.accountId })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)))
      .limit(1);
    if (cnt?.accountId) {
      const [acc] = await tx
        .select({ id: crmAccounts.id })
        .from(crmAccounts)
        .where(and(eq(crmAccounts.tenantId, tenantId), eq(crmAccounts.id, cnt.accountId)))
        .limit(1);
      if (acc) resolvedAccountId = acc.id;
    }
  }

  let nextTitle = existingDeal.title;
  if (isPlaceholderName(existingDeal.title)) {
    const candidateName = !isPlaceholderName(params.clientName) ? params.clientName?.trim() : null;
    const candidateCompany =
      params.companyName && !isPlaceholderName(params.companyName)
        ? params.companyName.trim()
        : null;
    if (candidateName && candidateCompany) {
      nextTitle = `${candidateName} - ${candidateCompany}`;
    } else if (candidateName) {
      nextTitle = candidateName;
    }
  }

  let nextSectorCurrent = existingDeal.sectorCurrent;
  try {
    const sectorCtx = await loadDealSectorResolutionContext(
      tx,
      tenantId,
      targetPipelineId,
      targetStageId,
      targetOperatorId,
    );
    const resolved = resolveDealCurrentSector({
      isTest: Boolean(existingDeal.isTest),
      pipelineId: targetPipelineId,
      pipelineName: sectorCtx.pipelineName,
      stageId: targetStageId,
      stageName: sectorCtx.stageName,
      operatorDivision: sectorCtx.operatorDivision,
      operatorSectorNames: sectorCtx.operatorSectorNames,
    });
    if (resolved) nextSectorCurrent = resolved;
  } catch {
    // Mantém setor atual se helper não conseguir resolver
  }

  await tx
    .update(crmDeals)
    .set({
      title: nextTitle,
      accountId: resolvedAccountId,
      pipelineId: targetPipelineId,
      stageId: targetStageId,
      operatorId: targetOperatorId,
      sectorCurrent: nextSectorCurrent,
      version: sql`${crmDeals.version} + 1`,
      lastActivityAt: now,
      updatedAt: now,
    })
    .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, existingDeal.id)));

  await ensureConversationDealLinkInTx(
    tx,
    tenantId,
    conversationId,
    existingDeal.id,
    "auto_sdr",
    approvedByOperatorId,
  );
  if (contactId) {
    await ensureDealContactLinkInTx(tx, tenantId, existingDeal.id, contactId);
  }

  if (fromStageId !== targetStageId || fromPipelineId !== targetPipelineId) {
    await tx.insert(crmDealEvents).values({
      id: `ev-appr-stage-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
      tenantId,
      dealId: existingDeal.id,
      eventType: "stage_changed",
      fromStageId,
      toStageId: targetStageId,
      operatorId: approvedByOperatorId,
      metadata: {
        origin: "sdr_human_approval",
        fromPipelineId,
        toPipelineId: targetPipelineId,
        targetFunnel,
        approvedByOperatorId,
        approvedByOperatorName,
        allocatedOperatorId: targetOperatorId,
        allocatedOperatorName: targetOperatorName,
        conversationId,
      },
      createdAt: now,
    });
  }

  if (fromOperatorId !== targetOperatorId) {
    await tx.insert(crmDealEvents).values({
      id: `ev-appr-op-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
      tenantId,
      dealId: existingDeal.id,
      eventType: "operator_changed",
      operatorId: approvedByOperatorId,
      metadata: {
        origin: "sdr_human_approval",
        fromOperatorId,
        toOperatorId: targetOperatorId,
        toOperatorName: targetOperatorName,
        approvedByOperatorName,
        conversationId,
      },
      createdAt: now,
    });
  }

  // Nota de resumo da triagem aprovada no card
  const filledLines = Object.entries(normalizedCollected)
    .filter(([, entry]) => entry.status === "filled" && entry.value)
    .map(([key, entry]) => `• ${key}: ${entry.value}`);

  const noteBody = [
    `Triagem realizada por ${persona.name} (IA) e aprovada por ${approvedByOperatorName}.`,
    `Destino aprovado: ${targetFunnel} • Responsável: ${targetOperatorName}`,
    ...(filledLines.length > 0 ? ["", "Dados coletados:", ...filledLines] : []),
  ].join("\n");

  await tx.insert(crmDealActivities).values({
    id: `act-note-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
    tenantId,
    dealId: existingDeal.id,
    conversationId,
    type: "note",
    title: `Triagem ${persona.name} aprovada por ${approvedByOperatorName}`,
    description: noteBody,
    status: "completed",
    operatorId: approvedByOperatorId,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  // Garantir tarefa "Responder o contato" atribuída ao operador recebedor
  const taskDescription = [
    `Responder o contato ${params.clientName || nextTitle}${contactPhone ? ` (${contactPhone})` : ""} referente ao atendimento aprovado pelo SDR.`,
    `Setor / Funil: ${targetFunnel}`,
    `Responsável: ${targetOperatorName}`,
  ].join(" | ");

  const [existingTask] = await tx
    .select({ id: crmDealActivities.id })
    .from(crmDealActivities)
    .where(
      and(
        eq(crmDealActivities.tenantId, tenantId),
        eq(crmDealActivities.dealId, existingDeal.id),
        eq(crmDealActivities.type, "task"),
        eq(crmDealActivities.status, "pending"),
        eq(crmDealActivities.title, LEAD_TRANSFER_TASK_TITLE),
      ),
    )
    .limit(1);

  let taskId: string;
  if (existingTask) {
    taskId = existingTask.id;
    await tx
      .update(crmDealActivities)
      .set({
        conversationId,
        description: taskDescription,
        assignedToOperatorId: targetOperatorId,
        assignedToOperatorIds: [targetOperatorId],
        updatedAt: now,
      })
      .where(and(eq(crmDealActivities.tenantId, tenantId), eq(crmDealActivities.id, taskId)));
  } else {
    taskId = `act-task-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    await tx.insert(crmDealActivities).values({
      id: taskId,
      tenantId,
      dealId: existingDeal.id,
      conversationId,
      type: "task",
      title: LEAD_TRANSFER_TASK_TITLE,
      description: taskDescription,
      status: "pending",
      dueDate: now,
      operatorId: approvedByOperatorId,
      assignedToOperatorId: targetOperatorId,
      assignedToOperatorIds: [targetOperatorId],
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    dealId: existingDeal.id,
    dealTitle: nextTitle,
    action: "moved_existing",
    pipelineId: targetPipelineId,
    stageId: targetStageId,
    taskId,
    taskTitle: LEAD_TRANSFER_TASK_TITLE,
  };
}

/**
 * Resolve múltiplos deals vinculados para enriquecer listagens sem N+1.
 */
export async function findActiveDealsByConversationIds(
  database: IndustrialDatabase,
  tenantId: string,
  conversationIds: string[],
) {
  if (!conversationIds.length) return new Map<string, { dealId: string; title: string; pipelineId: string; stageId: string; status: string }>();
  const rows = await database
    .select({
      conversationId: crmConversationDeals.conversationId,
      dealId: crmDeals.id,
      title: crmDeals.title,
      pipelineId: crmDeals.pipelineId,
      stageId: crmDeals.stageId,
      status: crmDeals.status,
    })
    .from(crmConversationDeals)
    .innerJoin(
      crmDeals,
      and(eq(crmDeals.id, crmConversationDeals.dealId), eq(crmDeals.tenantId, tenantId)),
    )
    .where(
      and(
        eq(crmConversationDeals.tenantId, tenantId),
        inArray(crmConversationDeals.conversationId, conversationIds),
        eq(crmConversationDeals.isActive, true),
      ),
    )
    .orderBy(desc(crmDeals.updatedAt));

  const map = new Map<string, { dealId: string; title: string; pipelineId: string; stageId: string; status: string }>();
  for (const row of rows) {
    if (!map.has(row.conversationId)) {
      map.set(row.conversationId, {
        dealId: row.dealId,
        title: row.title,
        pipelineId: row.pipelineId,
        stageId: row.stageId,
        status: row.status,
      });
    }
  }
  return map;
}
