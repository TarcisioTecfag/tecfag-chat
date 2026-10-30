// ══════════════════════════════════════════════════════════════════════════════
// 🏢 SDR CRM LOCAL — Criação e Vínculo Automático no CRM Local (Janela de 3h)
// ══════════════════════════════════════════════════════════════════════════════
// Regra de Negócio Oficial (Tecfag / Fagner SDR):
// 1. Zero integração com RD Station CRM. Tudo ocorre 100% no CRM Local.
// 2. ANTES de transferir o atendimento ao operador sorteado no Fluxo/Rodízio,
//    o Fagner verifica se existe uma negociação (crm_deals) criada para aquela
//    pessoa/contato nas ÚLTIMAS 3 HORAS (created_at >= NOW() - INTERVAL '3 hours').
// 3. Se existir card criado há <= 3 horas: vincula o atendimento atual a esse card
//    existente (crm_conversation_deals + crm_deal_contacts + nota de triagem).
// 4. Se NÃO existir ou se tiver passado de 3 horas (> 3h): cria um NOVO card
//    em crm_deals e vincula o contato e a conversa antes da transferência.
// ══════════════════════════════════════════════════════════════════════════════

import { db } from "../../db";
import {
  crmPipelines,
  crmStages,
  crmAccounts,
  crmDeals,
  crmDealContacts,
  crmConversationDeals,
  crmDealActivities,
  crmDealEvents,
  contacts,
  conversations,
} from "../../db/schema";
import { eq, and, desc, asc, gte, inArray, or, sql } from "drizzle-orm";
import { getAiPersona } from "../ai-persona";
import { ensureCatalogOption } from "../crm/catalogs";

export const SDR_DEAL_REUSE_WINDOW_HOURS = 3;
export const SDR_DEAL_REUSE_WINDOW_MS = SDR_DEAL_REUSE_WINDOW_HOURS * 60 * 60 * 1000;

/**
 * Verifica se a data de criação de um card do CRM Local está dentro da janela estrita de 3 horas (<= 3h).
 */
export function isDealWithinThreeHoursWindow(
  dealCreatedAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!dealCreatedAt) return false;
  const createdMs = dealCreatedAt instanceof Date ? dealCreatedAt.getTime() : new Date(dealCreatedAt).getTime();
  if (!Number.isFinite(createdMs)) return false;
  const elapsedMs = now.getTime() - createdMs;
  return elapsedMs >= 0 && elapsedMs <= SDR_DEAL_REUSE_WINDOW_MS;
}

export interface EnsureLocalCrmDealParams {
  tenantId: string;
  conversationId: string;
  contactId: string | null;
  contactPhone: string;
  clientName?: string;
  companyName?: string;
  targetOperatorId?: string | null;
  targetOperatorName?: string | null;
  allocatedOperator?: { id: string; name: string } | null;
  requireConfiguredPipeline?: boolean;
  reuseScope?: "person_and_funnel";
  destination?: { pipelineId: string; stageId: string };
  targetFunnel: string;
  funnelStage: string;
  collectedData: Record<string, { value: string; status: "filled" | "pending" }>;
}

export const LEAD_TRANSFER_TASK_TITLE = "Responder o contato";

export interface EnsureLocalCrmDealResult {
  success: boolean;
  action: "reused_within_3h" | "created_new";
  dealId: string;
  dealTitle: string;
  funnelId: string;
  pipelineId: string | null;
  pipelineName: string | null;
  stageId: string;
  stageName: string | null;
  accountId: string | null;
  reusedWithin3Hours: boolean;
  createdNew: boolean;
  taskId?: string | null;
  taskTitle?: string | null;
  error?: string;
}

async function upsertLeadTransferTaskInTx(
  tx: any,
  params: {
    tenantId: string;
    dealId: string;
    conversationId: string;
    operatorId: string | null;
    operatorName?: string | null;
    clientName?: string | null;
    contactPhone?: string | null;
    targetFunnel?: string | null;
    now: Date;
  },
): Promise<{ taskId: string; taskTitle: string }> {
  const {
    tenantId,
    dealId,
    conversationId,
    operatorId,
    operatorName,
    clientName,
    contactPhone,
    targetFunnel,
    now,
  } = params;

  const persona = getAiPersona(tenantId);
  const taskTitle = LEAD_TRANSFER_TASK_TITLE;
  const descriptionParts = [
    `Responder o contato ${clientName || "do atendimento"}${contactPhone ? ` (${contactPhone})` : ""} referente ao atendimento transferido.`,
    targetFunnel ? `Setor / Funil: ${targetFunnel}` : null,
    operatorName ? `Responsável: ${operatorName}` : null,
  ].filter(Boolean);
  const taskDescription = descriptionParts.join(" | ");

  const [existingPendingTask] = await tx
    .select()
    .from(crmDealActivities)
    .where(
      and(
        eq(crmDealActivities.tenantId, tenantId),
        eq(crmDealActivities.dealId, dealId),
        eq(crmDealActivities.type, "task"),
        eq(crmDealActivities.status, "pending"),
        eq(crmDealActivities.title, taskTitle),
      ),
    )
    .orderBy(desc(crmDealActivities.createdAt))
    .limit(1);

  if (existingPendingTask) {
    const resolvedOperatorId =
      operatorId ||
      existingPendingTask.assignedToOperatorId ||
      existingPendingTask.operatorId ||
      null;
    await tx
      .update(crmDealActivities)
      .set({
        conversationId: conversationId || existingPendingTask.conversationId || null,
        description: taskDescription,
        operatorId: null,
        assignedToOperatorId: resolvedOperatorId,
        dueDate: existingPendingTask.dueDate || now,
        updatedAt: now,
      })
      .where(
        and(
          eq(crmDealActivities.id, existingPendingTask.id),
          eq(crmDealActivities.tenantId, tenantId),
        ),
      );
    return { taskId: existingPendingTask.id, taskTitle };
  }

  const taskId = `act-task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  await tx.insert(crmDealActivities).values({
    id: taskId,
    tenantId,
    dealId,
    conversationId: conversationId || null,
    type: "task",
    title: taskTitle,
    description: taskDescription,
    status: "pending",
    dueDate: now,
    operatorId: null,
    assignedToOperatorId: operatorId || null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  await tx.insert(crmDealEvents).values({
    id: `ev-task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    tenantId,
    dealId,
    eventType: "activity_logged",
    operatorId: null,
    metadata: {
      activityId: taskId,
      type: "task",
      title: taskTitle,
      conversationId,
      origin: "auto_sdr",
      actorName: persona.name,
      actorType: "ai_sdr",
      assignedToOperatorId: operatorId || null,
      assignedToOperatorName: operatorName || null,
    },
    createdAt: now,
  });

  return { taskId, taskTitle };
}

/**
 * Garante que a negociação possua a tarefa pendente "Responder o contato"
 * vinculada ao atendimento e com responsável definido como o operador recebedor do lead.
 */
export async function ensureLeadTransferTaskOnDeal(params: {
  tenantId: string;
  dealId: string;
  conversationId: string;
  operatorId: string | null;
  operatorName?: string | null;
  clientName?: string | null;
  contactPhone?: string | null;
  targetFunnel?: string | null;
}): Promise<{ taskId: string; taskTitle: string } | null> {
  if (!params.tenantId || !params.dealId) return null;
  try {
    const now = new Date();
    return await db.transaction(async (tx) =>
      upsertLeadTransferTaskInTx(tx, {
        ...params,
        now,
      }),
    );
  } catch (err: any) {
    console.error(
      "[SdrCrmLocal] Erro ao garantir tarefa 'Responder o contato' na negociação:",
      err?.message || err,
    );
    return null;
  }
}

function getCollectedValue(
  collectedData: Record<string, { value: string; status: "filled" | "pending" }>,
  ...keys: string[]
): string {
  for (const k of keys) {
    const direct = collectedData[k];
    if (direct && direct.status === "filled" && direct.value && direct.value !== "Aguardando...") {
      return String(direct.value).trim();
    }
  }
  const norm = (s: string) =>
    s
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const targetSet = new Set(keys.map(norm));
  for (const [rawKey, entry] of Object.entries(collectedData || {})) {
    if (!entry || entry.status !== "filled" || !entry.value || entry.value === "Aguardando...") continue;
    const nk = norm(rawKey);
    if (targetSet.has(nk) || keys.some((k) => nk.includes(norm(k)))) {
      return String(entry.value).trim();
    }
  }
  return "";
}

function buildTriageSummaryNote(
  params: EnsureLocalCrmDealParams,
  personaName: string,
  reusedWithin3Hours: boolean
): string {
  const lines: string[] = [
    reusedWithin3Hours
      ? `🔄 Atendimento vinculado automaticamente pelo ${personaName} SDR (Negociação existente criada há menos de 3 horas)`
      : `🤖 Negociação criada automaticamente pelo ${personaName} SDR na conclusão da triagem`,
    `• Cliente: ${params.clientName || "Não informado"}`,
  ];

  if (params.companyName && params.companyName !== "Empresa não informada") {
    lines.push(`• Empresa: ${params.companyName}`);
  }
  if (params.contactPhone) {
    lines.push(`• WhatsApp: ${params.contactPhone}`);
  }
  if (params.targetFunnel) {
    lines.push(`• Fluxo / Funil Classificado: ${params.targetFunnel}`);
  }
  if (params.targetOperatorName) {
    lines.push(`• Responsável Sorteado no Rodízio: ${params.targetOperatorName}`);
  }

  const filledEntries = Object.entries(params.collectedData || {}).filter(
    ([k, v]) => !k.startsWith("_") && v && v.status === "filled" && v.value && v.value !== "Aguardando..."
  );

  if (filledEntries.length > 0) {
    lines.push("", "📋 Dados Coletados na Triagem:");
    for (const [key, val] of filledEntries) {
      lines.push(`  - ${key}: ${val.value}`);
    }
  }

  const rfData = (params.collectedData as any)?.["_RECEITA_FEDERAL"];
  if (rfData && rfData.razaoSocial) {
    lines.push(
      "",
      "🏢 Dados Receita Federal (CNPJ):",
      `  - Razão Social: ${rfData.razaoSocial}`,
      ...(rfData.nomeFantasia ? [`  - Nome Fantasia: ${rfData.nomeFantasia}`] : []),
      ...(rfData.cnaeDescricao ? [`  - CNAE: ${rfData.cnaeDescricao}`] : []),
      ...(rfData.municipio ? [`  - Localidade: ${rfData.municipio}/${rfData.uf || ""}`] : [])
    );
  }

  return lines.join("\n");
}

/**
 * Resolve o funil (crm_pipelines) e a etapa inicial (crm_stages) do tenant
 * correspondente ao setor/funil classificado pelo SDR.
 * Se o tenant não possuir nenhum funil cadastrado, inicializa o Funil Comercial padrão.
 */
async function resolveTargetPipelineAndStage(
  tx: any,
  tenantId: string,
  targetFunnel: string,
  funnelStage: string,
  requireConfiguredPipeline = false
): Promise<{
  pipelineId: string;
  pipelineName: string;
  stageId: string;
  stageName: string;
}> {
  let pipelines = await tx
    .select()
    .from(crmPipelines)
    .where(eq(crmPipelines.tenantId, tenantId))
    .orderBy(asc(crmPipelines.orderIndex), asc(crmPipelines.createdAt));

  if (pipelines.length === 0) {
    if (requireConfiguredPipeline) throw new Error("Nenhum funil configurado para este tenant");
    const now = new Date();
    const pipeId = `pipe-${tenantId}-${Date.now()}`;
    const [createdPipe] = await tx
      .insert(crmPipelines)
      .values({
        id: pipeId,
        tenantId,
        name: "Funil Comercial",
        orderIndex: 0,
        isDefault: true,
        color: "#0284c7",
        coolingDays: 10,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const defaultStageNames = [
      { name: "Primeiro Contato", orderIndex: 0, isWinStage: false, isLossStage: false },
      { name: "Qualificação", orderIndex: 1, isWinStage: false, isLossStage: false },
      { name: "Proposta Enviada", orderIndex: 2, isWinStage: false, isLossStage: false },
      { name: "Negociação", orderIndex: 3, isWinStage: false, isLossStage: false },
      { name: "Fechamento / Ganho", orderIndex: 4, isWinStage: true, isLossStage: false },
      { name: "Perdido", orderIndex: 5, isWinStage: false, isLossStage: true },
    ];

    for (const s of defaultStageNames) {
      await tx.insert(crmStages).values({
        id: `stg-${Date.now()}-${s.orderIndex}-${Math.random().toString(36).substring(2, 5)}`,
        tenantId,
        pipelineId: pipeId,
        name: s.name,
        orderIndex: s.orderIndex,
        isWinStage: s.isWinStage,
        isLossStage: s.isLossStage,
        requiredFields: [],
        createdAt: now,
        updatedAt: now,
      });
    }

    pipelines = [createdPipe];
  }

  const norm = (str: string = "") =>
    str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const normTargetFunnel = norm(targetFunnel);
  const normStageKey = norm(funnelStage);
  const isReviewFunnel =
    normTargetFunnel.includes("analise") ||
    normTargetFunnel.includes("revisao") ||
    normTargetFunnel === "atendimento geral" ||
    normStageKey === "outros" ||
    normStageKey === "triagem";
  if (requireConfiguredPipeline && !pipelines.some((pipeline: any) => norm(pipeline.name) === normTargetFunnel)) {
    throw new Error("Funil de destino não configurado para este atendimento");
  }

  // Tenta encontrar funil específico com nome correspondente ao fluxo (ex: "Máquinas", "Peças", "Personnalité", "Funil SDR" para Análise, etc.)
  let chosenPipeline =
    (requireConfiguredPipeline ? pipelines.find((p: any) => norm(p.name) === normTargetFunnel) : undefined) ||
    pipelines.find((p: any) => {
      const pName = norm(p.name);
      if (isReviewFunnel && (pName.includes("funil sdr") || pName === "sdr" || pName.includes("triagem") || pName.includes("analise"))) {
        return true;
      }
      return (
        (normTargetFunnel && (pName === normTargetFunnel || pName.includes(normTargetFunnel) || normTargetFunnel.includes(pName))) ||
        (normStageKey && (pName === normStageKey || pName.includes(normStageKey)))
      );
    }) ||
    pipelines.find((p: any) => p.isDefault) ||
    pipelines[0];

  let stages = await tx
    .select()
    .from(crmStages)
    .where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.pipelineId, chosenPipeline.id)))
    .orderBy(asc(crmStages.orderIndex), asc(crmStages.createdAt));

  if (stages.length === 0) {
    if (requireConfiguredPipeline) throw new Error("Funil sem etapa de atendimento configurada");
    const now = new Date();
    const [createdStage] = await tx
      .insert(crmStages)
      .values({
        id: `stg-${Date.now()}-0-${Math.random().toString(36).substring(2, 5)}`,
        tenantId,
        pipelineId: chosenPipeline.id,
        name: "Primeiro Contato",
        orderIndex: 0,
        isWinStage: false,
        isLossStage: false,
        requiredFields: [],
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    stages = [createdStage];
  }

  const initialStage =
    stages.find((s: any) => !s.isWinStage && !s.isLossStage) || stages[0];

  return {
    pipelineId: chosenPipeline.id,
    pipelineName: chosenPipeline.name,
    stageId: initialStage.id,
    stageName: initialStage.name,
  };
}

/**
 * Garante que o cliente/conversa possua uma negociação ativa no CRM Local ANTES
 * de transferir o atendimento para o operador humano, aplicando estritamente
 * a regra da janela de 3 horas (<= 3h vincula ao card existente; > 3h cria novo card).
 */
export async function ensureLocalCrmDealBeforeTransfer(
  params: EnsureLocalCrmDealParams,
  transaction?: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<EnsureLocalCrmDealResult> {
  const {
    tenantId,
    conversationId,
    contactId,
    contactPhone,
    targetFunnel,
    funnelStage,
    collectedData,
  } = params;

  const clientName =
    params.clientName ||
    getCollectedValue(collectedData, "NOME COMPLETO", "NOME") ||
    "Cliente WhatsApp";
  const targetOperatorId =
    params.targetOperatorId ?? params.allocatedOperator?.id ?? null;
  const targetOperatorName =
    params.targetOperatorName ?? params.allocatedOperator?.name ?? null;
  const normalizedParams: EnsureLocalCrmDealParams = {
    ...params,
    clientName,
    targetOperatorId,
    targetOperatorName,
  };

  const persona = getAiPersona(tenantId);
  const now = new Date();
  const threeHoursAgo = new Date(now.getTime() - SDR_DEAL_REUSE_WINDOW_MS);

  try {
    const operation = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<EnsureLocalCrmDealResult> => {
      // Lock consultivo por contato + tenant para evitar race conditions em mensagens simultâneas
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${contactId || conversationId}))`
      );

      let configuredTarget = params.requireConfiguredPipeline && !params.destination
        ? await resolveTargetPipelineAndStage(tx, tenantId, targetFunnel, funnelStage, true)
        : null;
      if (params.destination) {
        const [pipeline] = await tx.select().from(crmPipelines).where(and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, params.destination.pipelineId))).for("share");
        const [stage] = await tx.select().from(crmStages).where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.id, params.destination.stageId), eq(crmStages.pipelineId, params.destination.pipelineId))).for("share");
        if (!pipeline || !stage || stage.isWinStage || stage.isLossStage) throw new Error("Destino CRM inválido para este tenant");
        configuredTarget = { pipelineId: pipeline.id, pipelineName: pipeline.name, stageId: stage.id, stageName: stage.name };
      }

      // 1. Extrair documento (CNPJ/CPF) e empresa coletados na triagem
      const rawDoc = getCollectedValue(
        collectedData,
        "CNPJ OU CPF",
        "CNPJ",
        "CPF",
        "DOCUMENTO"
      ).replace(/\D/g, "");
      const validDoc = rawDoc.length === 11 || rawDoc.length === 14 ? rawDoc : "";

      const rfData = (collectedData as any)?.["_RECEITA_FEDERAL"];
      const collectedCompany =
        getCollectedValue(collectedData, "EMPRESA", "RAZÃO SOCIAL", "NOME DA EMPRESA") ||
        rfData?.nomeFantasia ||
        rfData?.razaoSocial ||
        (params.companyName && params.companyName !== "Empresa não informada" ? params.companyName : "");

      const cleanPhone = (contactPhone || "").replace(/\D/g, "");

      // 2. Resolver ou localizar conta existente (crm_accounts) se houver documento válido
      let resolvedAccountId: string | null = null;
      if (validDoc) {
        const [existingAcc] = await tx
          .select({ id: crmAccounts.id })
          .from(crmAccounts)
          .where(
            and(
              eq(crmAccounts.tenantId, tenantId),
              eq(crmAccounts.document, validDoc),
              sql`${crmAccounts.archivedAt} IS NULL`
            )
          )
          .limit(1);

        if (existingAcc) {
          resolvedAccountId = existingAcc.id;
        }
      }

      // 3. Buscar todos os contactIds equivalentes a esta pessoa no mesmo tenant (mesmo contactId ou mesmo telefone)
      const matchingContactIds = new Set<string>();
      if (contactId) matchingContactIds.add(contactId);

      if (cleanPhone.length >= 8 && params.reuseScope !== "person_and_funnel") {
        const phoneSuffix = cleanPhone.slice(-8);
        const samePhoneContacts = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(
            and(
              eq(contacts.tenantId, tenantId),
              sql`right(regexp_replace(${contacts.phone}, '[^0-9]', '', 'g'), 8) = ${phoneSuffix}`
            )
          )
          .limit(10);

        for (const c of samePhoneContacts) {
          matchingContactIds.add(c.id);
        }
      }

      const contactIdArray = Array.from(matchingContactIds);

      // 4. Coletar IDs de negociações candidatas vinculadas a esta pessoa (via crm_deal_contacts, crm_conversation_deals ou crm_accounts)
      const candidateDealIds = new Set<string>();

      if (contactIdArray.length > 0) {
        const dealContactRows = await tx
          .select({ dealId: crmDealContacts.dealId })
          .from(crmDealContacts)
          .where(
            and(
              eq(crmDealContacts.tenantId, tenantId),
              inArray(crmDealContacts.contactId, contactIdArray)
            )
          );
        for (const r of dealContactRows) candidateDealIds.add(r.dealId);

        const personConvs = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, tenantId),
              inArray(conversations.contactId, contactIdArray)
            )
          );
        const convIds = Array.from(new Set([conversationId, ...personConvs.map((c) => c.id)].filter(Boolean)));
        if (convIds.length > 0) {
          const convDealRows = await tx
            .select({ dealId: crmConversationDeals.dealId })
            .from(crmConversationDeals)
            .where(
              and(
                eq(crmConversationDeals.tenantId, tenantId),
                inArray(crmConversationDeals.conversationId, convIds)
              )
            );
          for (const r of convDealRows) candidateDealIds.add(r.dealId);
        }
      }

      // 5. VERIFICAÇÃO ESTRITA DA JANELA DE 3 HORAS (created_at >= NOW() - 3 hours)
      const matchConditions: any[] = [];
      if (candidateDealIds.size > 0) {
        matchConditions.push(inArray(crmDeals.id, Array.from(candidateDealIds)));
      }
      if (resolvedAccountId && params.reuseScope !== "person_and_funnel") {
        matchConditions.push(eq(crmDeals.accountId, resolvedAccountId));
      }

      let recentDealWithin3h: typeof crmDeals.$inferSelect | null = null;
      if (matchConditions.length > 0) {
        const [foundRecent] = await tx
          .select()
          .from(crmDeals)
          .where(
            and(
              eq(crmDeals.tenantId, tenantId),
              gte(crmDeals.createdAt, threeHoursAgo),
              ...(params.reuseScope === "person_and_funnel" && configuredTarget ? [eq(crmDeals.pipelineId, configuredTarget.pipelineId), eq(crmDeals.status, "open")] : []),
              or(...matchConditions)
            )
          )
          .orderBy(desc(crmDeals.createdAt))
          .limit(1);

        if (foundRecent) {
          recentDealWithin3h = foundRecent;
        }
      }

      // ════════════════════════════════════════════════════════════════════════
      // CENÁRIO A: EXISTE NEGOCIAÇÃO CRIADA NAS ÚLTIMAS 3 HORAS (<= 3h)
      // -> VINCULAR O ATENDIMENTO A ESSE CARD EXISTENTE
      // ════════════════════════════════════════════════════════════════════════
      if (recentDealWithin3h) {
        const dealId = recentDealWithin3h.id;

        // A1. Garantir vínculo do contato em crm_deal_contacts
        if (contactId) {
          const [existingContactLink] = await tx
            .select({ id: crmDealContacts.id })
            .from(crmDealContacts)
            .where(
              and(
                eq(crmDealContacts.tenantId, tenantId),
                eq(crmDealContacts.dealId, dealId),
                eq(crmDealContacts.contactId, contactId)
              )
            )
            .limit(1);

          if (!existingContactLink) {
            await tx.insert(crmDealContacts).values({
              id: `dc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              tenantId,
              dealId,
              contactId,
              role: "buyer",
              isPrimary: true,
              createdAt: now,
            });
          }
        }

        // A2. Garantir vínculo ativo da conversa em crm_conversation_deals
        const [existingConvLink] = await tx
          .select()
          .from(crmConversationDeals)
          .where(
            and(
              eq(crmConversationDeals.tenantId, tenantId),
              eq(crmConversationDeals.conversationId, conversationId),
              eq(crmConversationDeals.dealId, dealId)
            )
          )
          .limit(1);

        if (!existingConvLink) {
          await tx.insert(crmConversationDeals).values({
            id: `cd-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            tenantId,
            conversationId,
            dealId,
            origin: "auto_sdr",
            createdByOperatorId: targetOperatorId || recentDealWithin3h.operatorId || null,
            isActive: true,
            createdAt: now,
          });
        } else if (!existingConvLink.isActive) {
          await tx
            .update(crmConversationDeals)
            .set({ isActive: true, origin: "auto_sdr" })
            .where(
              and(
                eq(crmConversationDeals.id, existingConvLink.id),
                eq(crmConversationDeals.tenantId, tenantId)
              )
            );
        }

        // A3. Atualizar responsável / conta / customFields no card existente se aplicável
        const existingCustom = ((recentDealWithin3h.customFields as Record<string, any>) || {});
        const mergedCustom = {
          ...existingCustom,
          sdr_last_triage_at: now.toISOString(),
          sdr_target_funnel: targetFunnel,
          sdr_funnel_stage: funnelStage,
        };

        await tx
          .update(crmDeals)
          .set({
            operatorId: params.reuseScope === "person_and_funnel" ? (targetOperatorId || recentDealWithin3h.operatorId || null) : (recentDealWithin3h.operatorId || targetOperatorId || null),
            accountId: recentDealWithin3h.accountId || resolvedAccountId || null,
            customFields: mergedCustom,
            lastActivityAt: now,
            updatedAt: now,
          })
          .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)));

        // A4. Adicionar nota de triagem nas atividades do card
        const resolvedOwnerId = targetOperatorId || recentDealWithin3h.operatorId || null;
        const noteDescription = buildTriageSummaryNote(normalizedParams, persona.name, true);
        await tx.insert(crmDealActivities).values({
          id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          tenantId,
          dealId,
          conversationId: conversationId || null,
          type: "note",
          title: `Triagem SDR (${persona.name}) — Atendimento Vinculado (< 3h)`,
          description: noteDescription,
          status: "completed",
          operatorId: null,
          assignedToOperatorId: resolvedOwnerId,
          completedAt: now,
          createdAt: now,
          updatedAt: now,
        });

        // A4.1. Garantir tarefa pendente "Responder o contato" atribuída ao operador recebedor do lead
        const reusedTaskInfo = await upsertLeadTransferTaskInTx(tx, {
          tenantId,
          dealId,
          conversationId,
          operatorId: resolvedOwnerId,
          operatorName: targetOperatorName,
          clientName,
          contactPhone,
          targetFunnel,
          now,
        });

        // A5. Registrar evento de auditoria imutável no histórico do card
        await tx.insert(crmDealEvents).values({
          id: `ev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          tenantId,
          dealId,
          eventType: "conversation_linked",
          operatorId: null,
          metadata: {
            conversationId,
            contactName: clientName,
            contactPhone,
            origin: "auto_sdr",
            actorName: persona.name,
            actorType: "ai_sdr",
            allocatedOperatorId: resolvedOwnerId,
            allocatedOperatorName: targetOperatorName || null,
            reusedWithin3Hours: true,
            targetFunnel,
            taskId: reusedTaskInfo.taskId,
            taskTitle: reusedTaskInfo.taskTitle,
          },
          createdAt: now,
        });

        console.log(
          `[SdrCrmLocal] ♻️ Janela <= 3h: Conversa ${conversationId} vinculada ao card existente ${dealId} ("${recentDealWithin3h.title}") no tenant ${tenantId}.`
        );

        return {
          success: true,
          action: "reused_within_3h",
          dealId,
          dealTitle: recentDealWithin3h.title,
          funnelId: recentDealWithin3h.pipelineId,
          pipelineId: recentDealWithin3h.pipelineId,
          pipelineName: null,
          stageId: recentDealWithin3h.stageId,
          stageName: null,
          accountId: recentDealWithin3h.accountId || resolvedAccountId,
          reusedWithin3Hours: true,
          createdNew: false,
          taskId: reusedTaskInfo.taskId,
          taskTitle: reusedTaskInfo.taskTitle,
        };
      }

      // ════════════════════════════════════════════════════════════════════════
      // CENÁRIO B: NÃO EXISTE CARD NAS ÚLTIMAS 3 HORAS (> 3h OU PRIMEIRA VEZ)
      // -> CRIAR UMA NOVA NEGOCIAÇÃO E VINCULAR ANTES DA TRANSFERÊNCIA
      // ════════════════════════════════════════════════════════════════════════

      // B1. Criar conta compradora (crm_accounts) se ainda não existir
      if (!resolvedAccountId && (collectedCompany || validDoc || clientName)) {
        const isCompany = validDoc.length === 14 || Boolean(collectedCompany);
        const accName = (collectedCompany || clientName || "Cliente WhatsApp").trim();
        const newAccId = `acc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

        const [createdAcc] = await tx
          .insert(crmAccounts)
          .values({
            id: newAccId,
            tenantId,
            type: isCompany ? "company" : "person",
            name: rfData?.razaoSocial?.trim() || accName,
            tradeName: rfData?.nomeFantasia?.trim() || (isCompany ? accName : null),
            segment: rfData?.cnaeDescricao ? String(rfData.cnaeDescricao).slice(0, 120) : null,
            documentType: validDoc.length === 14 ? "cnpj" : validDoc.length === 11 ? "cpf" : null,
            document: validDoc || null,
            phone: cleanPhone || null,
            email: getCollectedValue(collectedData, "EMAIL", "E-MAIL") || rfData?.email || null,
            address: rfData?.municipio
              ? { city: rfData.municipio, state: rfData.uf || "" }
              : {},
            customFields: {},
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        resolvedAccountId = createdAcc.id;
      }

      // B2. Resolver Funil e Etapa Inicial no CRM Local
      const { pipelineId, pipelineName, stageId, stageName } =
        configuredTarget || await resolveTargetPipelineAndStage(tx, tenantId, targetFunnel, funnelStage, params.requireConfiguredPipeline);

      // B3. Montar título rico e informativo da nova negociação
      const machineOrProduct = getCollectedValue(
        collectedData,
        "MÁQUINA / PEÇA / INTERESSE",
        "MAQUINA_INTERESSE",
        "QUAL O TIPO DE PRODUTO?",
        "PRODUTO",
        "EQUIPAMENTO"
      );
      const displayEntity =
        collectedCompany || clientName || contactPhone || "Cliente WhatsApp";
      const suffix = machineOrProduct || targetFunnel || "Atendimento SDR";
      const dealTitle = `${displayEntity} — ${suffix}`.slice(0, 180);

      const newDealId = `deal-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      const dealCustomFields: Record<string, any> = {
        sdr_origin: true,
        sdr_agent_name: persona.name,
        sdr_target_funnel: targetFunnel,
        sdr_funnel_stage: funnelStage,
        ramo_produto: getCollectedValue(collectedData, "RAMO / O QUE EMBALA", "RAMO_PRODUTO", "SEGMENTO"),
        maquina_interesse: machineOrProduct,
        volume_producao: getCollectedValue(collectedData, "VOLUME / PRODUÇÃO", "VOLUME_PRODUCAO", "QUANTIDADE"),
        documento: validDoc || undefined,
      };

      const sdrSourceLabel = `WhatsApp SDR (${persona.name})`;
      await ensureCatalogOption(tenantId, "source", sdrSourceLabel, tx);

      // B4. Inserir o novo Deal em crm_deals (100% Local, sem enqueueRdCommercial)
      const [createdDeal] = await tx
        .insert(crmDeals)
        .values({
          id: newDealId,
          tenantId,
          title: dealTitle,
          accountId: resolvedAccountId,
          pipelineId,
          stageId,
          status: "open",
          value: null,
          currency: "BRL",
          expectedCloseDate: null,
          operatorId: targetOperatorId || null,
          source: sdrSourceLabel,
          campaign: null,
          rating: 0,
          customFields: dealCustomFields,
          version: 1,
          lastActivityAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // B5. Vincular o contato principal em crm_deal_contacts
      if (contactId) {
        await tx.insert(crmDealContacts).values({
          id: `dc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          tenantId,
          dealId: newDealId,
          contactId,
          role: "buyer",
          isPrimary: true,
          createdAt: now,
        });
      }

      // B6. Desativar vínculos antigos (> 3h) na conversa atual se existirem e vincular o novo card como ativo
      await tx
        .update(crmConversationDeals)
        .set({ isActive: false })
        .where(
          and(
            eq(crmConversationDeals.tenantId, tenantId),
            eq(crmConversationDeals.conversationId, conversationId)
          )
        );

      await tx.insert(crmConversationDeals).values({
        id: `cd-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        conversationId,
        dealId: newDealId,
        origin: "auto_sdr",
        createdByOperatorId: null,
        isActive: true,
        createdAt: now,
      });

      // B7. Registrar nota completa da triagem em crm_deal_activities
      const noteDescription = buildTriageSummaryNote(normalizedParams, persona.name, false);
      await tx.insert(crmDealActivities).values({
        id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        tenantId,
        dealId: newDealId,
        conversationId: conversationId || null,
        type: "note",
        title: `Relatório de Triagem SDR (${persona.name})`,
        description: noteDescription,
        status: "completed",
        operatorId: null,
        assignedToOperatorId: targetOperatorId || null,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      // B7.1. Criar tarefa pendente "Responder o contato" atribuída ao operador recebedor do lead
      const createdTaskInfo = await upsertLeadTransferTaskInTx(tx, {
        tenantId,
        dealId: newDealId,
        conversationId,
        operatorId: targetOperatorId || null,
        operatorName: targetOperatorName,
        clientName,
        contactPhone,
        targetFunnel,
        now,
      });

      // B8. Registrar eventos de auditoria ("created" e "conversation_linked") em crm_deal_events
      await tx.insert(crmDealEvents).values([
        {
          id: `ev-${Date.now()}-1-${Math.random().toString(36).substring(2, 6)}`,
          tenantId,
          dealId: newDealId,
          eventType: "created",
          operatorId: null,
          metadata: {
            title: createdDeal.title,
            pipelineId,
            pipelineName,
            stageId,
            stageName,
            source: sdrSourceLabel,
            origin: "auto_sdr",
            actorName: persona.name,
            actorType: "ai_sdr",
            allocatedOperatorId: targetOperatorId || null,
            allocatedOperatorName: targetOperatorName || null,
            targetFunnel,
          },
          createdAt: now,
        },
        {
          id: `ev-${Date.now()}-2-${Math.random().toString(36).substring(2, 6)}`,
          tenantId,
          dealId: newDealId,
          eventType: "conversation_linked",
          operatorId: null,
          metadata: {
            conversationId,
            contactName: clientName,
            contactPhone,
            origin: "auto_sdr",
            actorName: persona.name,
            actorType: "ai_sdr",
            allocatedOperatorId: targetOperatorId || null,
            allocatedOperatorName: targetOperatorName || null,
            reusedWithin3Hours: false,
            targetFunnel,
            taskId: createdTaskInfo.taskId,
            taskTitle: createdTaskInfo.taskTitle,
          },
          createdAt: now,
        },
      ]);

      console.log(
        `[SdrCrmLocal] ✨ Novo card criado no CRM Local (> 3h ou primeiro contato): ${newDealId} ("${createdDeal.title}") | Funil: ${pipelineName} / ${stageName} | Operador: ${targetOperatorId || "Fila"}`
      );

      return {
        success: true,
        action: "created_new",
        dealId: newDealId,
        dealTitle: createdDeal.title,
        funnelId: pipelineId,
        pipelineId,
        pipelineName,
        stageId,
        stageName,
        accountId: resolvedAccountId,
        reusedWithin3Hours: false,
        createdNew: true,
        taskId: createdTaskInfo.taskId,
        taskTitle: createdTaskInfo.taskTitle,
      };
    };
    // O handoff industrial compartilha a mesma transação do card, carteira e rodízio.
    return transaction ? await operation(transaction) : await db.transaction(operation);
  } catch (err: any) {
    if (transaction) throw err; // O chamador precisa reverter a transação inteira.
    console.error(`[SdrCrmLocal] ❌ Erro ao criar/vincular card no CRM Local para conversa ${conversationId}:`, err);
    return {
      success: false,
      action: "created_new",
      dealId: "",
      dealTitle: clientName,
      funnelId: "",
      pipelineId: null,
      pipelineName: null,
      stageId: "",
      stageName: null,
      accountId: null,
      reusedWithin3Hours: false,
      createdNew: false,
      error: err?.message || String(err),
    };
  }
}
