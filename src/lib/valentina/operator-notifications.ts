import crypto from "crypto";
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  agentFlowStates,
  contacts,
  conversations,
  crmAccounts,
  crmConversationDeals,
  crmCustomFieldDefinitions,
  crmDealProducts,
  crmDeals,
  internalMessages,
  messages,
  operators,
} from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import { SessionManager } from "../baileys/session-manager";
import { TECFAG_DEFAULT_CATALOG } from "../triage/tecfag-default-catalog";
import {
  ensureLeadTransferTaskOnDeal,
  ensureLocalCrmDealBeforeTransfer,
  LEAD_TRANSFER_TASK_TITLE,
} from "./sdr-crm-local";

export interface LeadTransferNotificationParams {
  tenantId: string;
  operatorId: string;
  operatorName?: string | null;
  conversationId: string;
  clientName?: string | null;
  company?: string | null;
  machine?: string | null;
  interest?: string | null;
  targetFunnel?: string | null;
  dealId?: string | null;
  dealTitle?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
  temperature?: "quente" | "morno" | "frio";
  transferSource?: "sdr_auto" | "manual_transfer" | "rodizio_reassignment";
  transferredBy?: string | null;
  cycle?: string | null;
  triageBriefing?: string;
  collectedData?: Record<string, { value?: string; status?: string }> | null;
}

function normalizeFieldKey(raw: string): string {
  return (raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isGenericPlaceholderValue(raw: string | null | undefined): boolean {
  const clean = String(raw ?? "").trim();
  if (!clean) return true;
  const norm = normalizeFieldKey(clean);
  return (
    norm === "-" ||
    norm === "--" ||
    norm === "..." ||
    norm === "aguardando..." ||
    norm === "aguardando" ||
    norm === "nao informada" ||
    norm === "nao informado" ||
    norm === "empresa nao informada" ||
    norm === "sem empresa" ||
    norm === "nao possui" ||
    norm === "n/a" ||
    norm === "null" ||
    norm === "undefined"
  );
}

function isWeakClientName(raw: string | null | undefined): boolean {
  if (isGenericPlaceholderValue(raw)) return true;
  const norm = normalizeFieldKey(String(raw ?? ""));
  return (
    norm === "cliente" ||
    norm === "cliente whatsapp" ||
    norm === "contato" ||
    norm === "visitante" ||
    norm === "lead" ||
    norm === "sem nome"
  );
}

function isGenericMachineInterest(raw: string | null | undefined): boolean {
  if (isGenericPlaceholderValue(raw)) return true;
  const norm = normalizeFieldKey(String(raw ?? ""));
  return (
    norm === "atendimento geral" ||
    norm === "atendimento recebido via whatsapp" ||
    norm === "atendimento comercial transferido para sua fila" ||
    norm === "sdr / analise" ||
    norm === "funil sdr" ||
    norm === "funil cwr"
  );
}

function resolveCatalogMachineName(machineId: string | null | undefined): string | null {
  const cleanId = String(machineId ?? "").trim();
  if (!cleanId) return null;
  const normId = normalizeFieldKey(cleanId);
  const found = TECFAG_DEFAULT_CATALOG.find(
    (m) =>
      normalizeFieldKey(m.id) === normId ||
      normalizeFieldKey(m.code) === normId ||
      normalizeFieldKey(m.name) === normId,
  );
  return found?.name?.trim() || null;
}

function extractMachineFromDealTitle(
  dealTitle: string | null | undefined,
  clientName: string,
  company: string | null,
): string | null {
  const raw = String(dealTitle ?? "").trim();
  if (!raw) return null;
  const parts = raw
    .split(/\s*(?:—|–|\|| - )\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const normClient = normalizeFieldKey(clientName);
  const normCompany = normalizeFieldKey(company || "");
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    const normPart = normalizeFieldKey(part);
    if (!part || part.length < 2 || isGenericMachineInterest(part)) continue;
    if (normPart === "fagner" || normPart === "valentina" || normPart === "sdr") continue;
    if (normClient && normPart === normClient) continue;
    if (normCompany && normPart === normCompany) continue;
    if (/^\+?\d{8,20}$/.test(part.replace(/[\s().-]/g, ""))) continue;
    return part;
  }
  return null;
}

export interface ResolveLeadPopupFieldsInput {
  explicitClientName?: string | null;
  contactName?: string | null;
  explicitCompany?: string | null;
  accountTradeName?: string | null;
  accountName?: string | null;
  dealAccountTradeName?: string | null;
  dealAccountName?: string | null;
  cnpjDetails?: Record<string, any> | null;
  explicitMachine?: string | null;
  explicitInterest?: string | null;
  collectedData?: Record<string, { value?: string; status?: string }> | null;
  machineDecision?: { machineId?: string | null } | null;
  dealProductNames?: string[] | null;
  dealCustomMachine?: string | null;
  dealTitle?: string | null;
  targetFunnel?: string | null;
}

export interface ResolvedLeadPopupFields {
  clientName: string;
  company: string | null;
  machine: string | null;
}

/**
 * Resolve de forma determinística Nome, Máquina/Produto e Empresa para o pop-up de
 * interrupção de Lead Novo, sem nunca corromper o campo Máquina com mensagens soltas
 * do cliente (ex: "ok obrigado") vindas de `lastMessageText`.
 */
export function resolveLeadPopupFields(
  input: ResolveLeadPopupFieldsInput,
): ResolvedLeadPopupFields {
  const normalizedCollected = normalizeCollectedMap(input.collectedData);
  const filledEntries = Object.entries(normalizedCollected).filter(
    ([k, v]) =>
      !k.startsWith("_") &&
      v &&
      v.status === "filled" &&
      !isGenericPlaceholderValue(v.value),
  );

  const findCollected = (matcher: (normKey: string) => boolean): string | null => {
    const entry = filledEntries.find(([k]) => matcher(normalizeFieldKey(k)));
    return entry?.[1]?.value?.trim() || null;
  };

  // 1. Nome do lead
  const collectedName = findCollected(
    (k) =>
      (k === "nome" || /\bnome\b/.test(k)) &&
      !k.includes("empresa") &&
      !k.includes("fantasia") &&
      !k.includes("razao"),
  );
  const clientName =
    (!isWeakClientName(input.explicitClientName) && input.explicitClientName?.trim()) ||
    (!isWeakClientName(collectedName) && collectedName) ||
    (!isWeakClientName(input.contactName) && input.contactName?.trim()) ||
    input.explicitClientName?.trim() ||
    input.contactName?.trim() ||
    "Cliente";

  // 2. Empresa
  const rfData = (normalizedCollected as any)?.["_RECEITA_FEDERAL"];
  const collectedCompany = findCollected(
    (k) => k.includes("empresa") || k.includes("razao social") || k.includes("nome fantasia"),
  );
  const companyCandidates = [
    input.explicitCompany,
    input.accountTradeName,
    input.accountName,
    input.dealAccountTradeName,
    input.dealAccountName,
    input.cnpjDetails?.nomeFantasia,
    input.cnpjDetails?.razaoSocial,
    collectedCompany,
    rfData?.nomeFantasia,
    rfData?.razaoSocial,
  ];
  const company =
    companyCandidates
      .map((v) => String(v ?? "").trim())
      .find((v) => !isGenericPlaceholderValue(v)) || null;

  // 3. Máquina / Produto / Interesse principal
  const normFunnel = normalizeFieldKey(input.targetFunnel || "");
  const isFunnelOnlyText = (val: string) => {
    const n = normalizeFieldKey(val);
    return Boolean(normFunnel && (n === normFunnel || n === `funil ${normFunnel}`));
  };

  const collectedPrimaryMachine =
    findCollected((k) => k.includes("modelo") && k.includes("maquina")) ||
    findCollected(
      (k) =>
        k.includes("maquina") ||
        k.includes("produto de interesse") ||
        k.includes("tipo de produto") ||
        k.includes("equipamento") ||
        k.includes("peca") ||
        k.includes("interesse"),
    ) ||
    findCollected((k) => k.includes("produto"));

  const catalogMachineName = resolveCatalogMachineName(input.machineDecision?.machineId);

  const validDealProducts = (input.dealProductNames || [])
    .map((p) => String(p ?? "").trim())
    .filter((p) => !isGenericMachineInterest(p));
  const dealProductsSummary =
    validDealProducts.length > 0 ? validDealProducts.slice(0, 2).join(" + ") : null;

  const collectedApplication = findCollected(
    (k) => k.includes("aplicacao") || k.includes("produz") || k.includes("embalar"),
  );

  const dealTitleMachine = extractMachineFromDealTitle(input.dealTitle, clientName, company);

  const specificCandidates = [
    input.explicitMachine,
    input.explicitInterest && !isFunnelOnlyText(input.explicitInterest)
      ? input.explicitInterest
      : null,
    collectedPrimaryMachine,
    catalogMachineName,
    dealProductsSummary,
    input.dealCustomMachine,
    collectedApplication,
    dealTitleMachine,
  ];

  const specificMachine =
    specificCandidates
      .map((v) => String(v ?? "").trim())
      .find((v) => !isGenericMachineInterest(v)) || null;

  const fallbackCandidates = [input.explicitInterest, input.targetFunnel];
  const machine =
    specificMachine ||
    fallbackCandidates
      .map((v) => String(v ?? "").trim())
      .find((v) => !isGenericMachineInterest(v)) ||
    null;

  return {
    clientName,
    company,
    machine,
  };
}

function normalizeCollectedMap(
  raw: Record<string, any> | null | undefined,
): Record<string, { value: string; status: "filled" | "pending" }> {
  const result: Record<string, { value: string; status: "filled" | "pending" }> = {};
  if (!raw || typeof raw !== "object") return result;
  for (const [key, val] of Object.entries(raw)) {
    if (key.startsWith("_")) {
      (result as any)[key] = val;
      continue;
    }
    if (val && typeof val === "object" && "value" in val) {
      const strVal = String(val.value ?? "").trim();
      const isFilled =
        val.status === "filled" || (Boolean(strVal) && strVal !== "Aguardando...");
      result[key] = {
        value: strVal,
        status: isFilled ? "filled" : "pending",
      };
    } else if (typeof val === "string" && val.trim()) {
      result[key] = {
        value: val.trim(),
        status: "filled",
      };
    }
  }
  return result;
}

function summarizeConversationMessages(
  rows: Array<{
    senderType: string;
    senderName: string | null;
    content: string | null;
    mediaInterpretation: string | null;
  }>,
  personaName: string,
): string[] {
  const clientPoints: string[] = [];
  const dialogueLines: string[] = [];

  for (const row of rows) {
    const rawContent = (row.content || "").trim();
    const mediaInterp = (row.mediaInterpretation || "").trim();
    const effectiveText =
      rawContent && !/^\[(áudio|audio|imagem|documento|vídeo|video)\]/i.test(rawContent)
        ? rawContent
        : mediaInterp || rawContent;
    const clean = effectiveText.replace(/\s+/g, " ").trim();
    if (!clean) continue;

    if (row.senderType === "client") {
      clientPoints.push(clean.slice(0, 220));
      dialogueLines.push(`- *Cliente:* ${clean.slice(0, 220)}`);
    } else if (row.senderType === "bot" || row.senderType === "agent") {
      const speaker = row.senderType === "bot" ? personaName : row.senderName || "Atendente";
      dialogueLines.push(`- *${speaker}:* ${clean.slice(0, 180)}`);
    }
  }

  if (dialogueLines.length === 0 && clientPoints.length === 0) {
    return [];
  }

  return dialogueLines.slice(-6);
}

/**
 * Registra no banco (internal_messages) e transmite em tempo real via SSE
 * o aviso proativo do Fagner / Valentina quando um cliente é transferido para o vendedor,
 * garantindo que a negociação possua a tarefa "Responder o contato" atribuída ao recebedor
 * e incluindo o resumo completo do que foi tratado no atendimento.
 */
export interface LeadTransferNotificationDeps {
  database?: any;
  ensureDeal?: typeof ensureLocalCrmDealBeforeTransfer;
  ensureTask?: typeof ensureLeadTransferTaskOnDeal;
  notifyPublic?: (tenantId: string, event: any) => void;
}

export async function notifyOperatorLeadTransferred(
  params: LeadTransferNotificationParams,
  deps?: LeadTransferNotificationDeps,
): Promise<boolean> {
  const {
    tenantId,
    operatorId,
    conversationId,
    temperature = "quente",
    transferSource = "sdr_auto",
    transferredBy = null,
    cycle = null,
  } = params;

  if (!tenantId || !operatorId || !conversationId) return false;

  const database = deps?.database ?? db;
  const ensureDeal = deps?.ensureDeal ?? ensureLocalCrmDealBeforeTransfer;
  const ensureTask = deps?.ensureTask ?? ensureLeadTransferTaskOnDeal;
  const emitPublic =
    deps?.notifyPublic ??
    ((tid: string, ev: any) => SessionManager.getInstance().notifyPublic(tid, ev));

  try {
    const persona = getAiPersona(tenantId);

    // 1. Enriquecer dados do operador, cliente, conversa e estado da triagem
    let operatorName = params.operatorName?.trim() || "";
    let dealId = params.dealId || null;
    let dealTitle = params.dealTitle || null;
    let taskId = params.taskId || null;
    let taskTitle = params.taskTitle || LEAD_TRANSFER_TASK_TITLE;
    let targetFunnel = params.targetFunnel || null;
    let contactId: string | null = null;
    let contactPhone = "";
    let cnpjDetails: Record<string, any> | null = null;

    const [convRow] = await database
      .select({
        contactId: conversations.contactId,
        contactName: contacts.name,
        contactPhone: contacts.phone,
        contactCnpjDetails: contacts.cnpjDetails,
        accountName: crmAccounts.name,
        accountTradeName: crmAccounts.tradeName,
        lastMessageText: conversations.lastMessageText,
      })
      .from(conversations)
      .leftJoin(
        contacts,
        and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, tenantId)),
      )
      .leftJoin(
        crmAccounts,
        and(eq(crmAccounts.id, contacts.accountId), eq(crmAccounts.tenantId, tenantId)),
      )
      .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
      .limit(1);

    if (convRow) {
      contactId = convRow.contactId || null;
      contactPhone = convRow.contactPhone || "";
      cnpjDetails =
        convRow.contactCnpjDetails && typeof convRow.contactCnpjDetails === "object"
          ? (convRow.contactCnpjDetails as Record<string, any>)
          : null;
    }

    if (!operatorName) {
      const [opRow] = await database
        .select({ name: operators.name })
        .from(operators)
        .where(and(eq(operators.id, operatorId), eq(operators.tenantId, tenantId)))
        .limit(1);
      if (opRow?.name) {
        operatorName = opRow.name;
      }
    }

    // Buscar dados coletados da triagem (agentFlowStates) se não fornecidos
    let collectedData = normalizeCollectedMap(params.collectedData);
    let flowRouteReason: string | null = null;
    let machineDecision: { machineId?: string | null } | null = null;
    const [latestFlow] = await database
      .select({
        collectedData: agentFlowStates.collectedData,
        metadata: agentFlowStates.metadata,
      })
      .from(agentFlowStates)
      .where(
        and(
          eq(agentFlowStates.tenantId, tenantId),
          eq(agentFlowStates.conversationId, conversationId),
        ),
      )
      .orderBy(desc(agentFlowStates.startedAt), desc(agentFlowStates.id))
      .limit(1);

    if (latestFlow) {
      const flowCollected = normalizeCollectedMap(
        (latestFlow.collectedData as Record<string, any>) || {},
      );
      collectedData = { ...flowCollected, ...collectedData };
      const flowMeta = (latestFlow.metadata as Record<string, any>) || {};
      if (!targetFunnel && typeof flowMeta.targetFunnel === "string") {
        targetFunnel = flowMeta.targetFunnel;
      }
      if (typeof flowMeta.routeReason === "string") {
        flowRouteReason = flowMeta.routeReason;
      }
      if (flowMeta.machineDecision && typeof flowMeta.machineDecision === "object") {
        machineDecision = flowMeta.machineDecision as { machineId?: string | null };
      }
      if (!dealId && typeof flowMeta.localCrmDealId === "string" && flowMeta.localCrmDealId) {
        dealId = flowMeta.localCrmDealId;
      }
      if (!dealTitle && typeof flowMeta.localCrmDealTitle === "string" && flowMeta.localCrmDealTitle) {
        dealTitle = flowMeta.localCrmDealTitle;
      }
    }

    const filledEntries = Object.entries(collectedData).filter(
      ([k, v]) =>
        !k.startsWith("_") &&
        v &&
        v.status === "filled" &&
        v.value &&
        v.value !== "Aguardando...",
    );

    // 2. Localizar negociação vinculada ativa ou criar se ainda não existir
    if (!dealId || !dealTitle) {
      const [linkedDeal] = await database
        .select({
          id: crmDeals.id,
          title: crmDeals.title,
          value: crmDeals.value,
        })
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
          ),
        )
        .orderBy(desc(crmConversationDeals.createdAt))
        .limit(1);

      if (linkedDeal) {
        dealId = dealId || linkedDeal.id;
        dealTitle = dealTitle || linkedDeal.title;
      }
    }

    // Enriquecimento opcional da negociação (empresa do card, produtos e campos personalizados de máquina).
    // Protegido por try/catch para não falhar em schemas mínimos de testes isolados.
    let dealAccountName: string | null = null;
    let dealAccountTradeName: string | null = null;
    let dealProductNames: string[] = [];
    let dealCustomMachine: string | null = null;

    if (dealId) {
      try {
        const [dealExtra] = await database
          .select({
            accountName: crmAccounts.name,
            accountTradeName: crmAccounts.tradeName,
            customFields: crmDeals.customFields,
          })
          .from(crmDeals)
          .leftJoin(
            crmAccounts,
            and(eq(crmAccounts.id, crmDeals.accountId), eq(crmAccounts.tenantId, tenantId)),
          )
          .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, dealId)))
          .limit(1);

        if (dealExtra) {
          dealAccountName = dealExtra.accountName || null;
          dealAccountTradeName = dealExtra.accountTradeName || null;
          const cf =
            dealExtra.customFields && typeof dealExtra.customFields === "object"
              ? (dealExtra.customFields as Record<string, unknown>)
              : null;
          if (cf && Object.keys(cf).length > 0) {
            const defs = await database
              .select({
                id: crmCustomFieldDefinitions.id,
                name: crmCustomFieldDefinitions.name,
              })
              .from(crmCustomFieldDefinitions)
              .where(
                and(
                  eq(crmCustomFieldDefinitions.tenantId, tenantId),
                  eq(crmCustomFieldDefinitions.entityType, "deal"),
                  isNull(crmCustomFieldDefinitions.archivedAt),
                ),
              );
            const machineDef = defs.find((d: { id: string; name: string }) => {
              const normName = normalizeFieldKey(d.name);
              return (
                normName.includes("maquina") ||
                normName.includes("equipamento") ||
                normName.includes("modelo") ||
                normName.includes("produto") ||
                normName.includes("interesse")
              );
            });
            const rawVal = machineDef ? cf[machineDef.id] ?? cf[machineDef.name] : null;
            if (typeof rawVal === "string" && rawVal.trim()) {
              dealCustomMachine = rawVal.trim();
            } else if (Array.isArray(rawVal)) {
              const joined = rawVal
                .map((item) => String(item ?? "").trim())
                .filter(Boolean)
                .slice(0, 2)
                .join(" + ");
              if (joined) dealCustomMachine = joined;
            }
          }
        }
      } catch {
        // Colunas/tabelas opcionais ausentes em bancos de teste mínimos — ignora silenciosamente
      }

      try {
        const prodRows = await database
          .select({ name: crmDealProducts.name })
          .from(crmDealProducts)
          .where(
            and(eq(crmDealProducts.tenantId, tenantId), eq(crmDealProducts.dealId, dealId)),
          )
          .orderBy(asc(crmDealProducts.createdAt))
          .limit(3);
        dealProductNames = prodRows
          .map((r: { name: string | null }) => String(r.name ?? "").trim())
          .filter(Boolean);
      } catch {
        // Tabela opcional ausente em bancos de teste mínimos
      }
    }

    const resolvedFields = resolveLeadPopupFields({
      explicitClientName: params.clientName,
      contactName: convRow?.contactName,
      explicitCompany: params.company,
      accountTradeName: convRow?.accountTradeName,
      accountName: convRow?.accountName,
      dealAccountTradeName,
      dealAccountName,
      cnpjDetails,
      explicitMachine: params.machine,
      explicitInterest: params.interest,
      collectedData,
      machineDecision,
      dealProductNames,
      dealCustomMachine,
      dealTitle,
      targetFunnel,
    });

    const clientName = resolvedFields.clientName;
    const company = resolvedFields.company || "";
    const resolvedMachine = resolvedFields.machine;
    const interest =
      resolvedMachine ||
      params.interest?.trim() ||
      (convRow?.lastMessageText ? convRow.lastMessageText.slice(0, 140) : "");

    if (!dealId) {
      const ensuredDeal = await ensureDeal({
        tenantId,
        conversationId,
        contactId,
        contactPhone,
        clientName: clientName || "Cliente WhatsApp",
        companyName: company || undefined,
        targetOperatorId: operatorId,
        targetOperatorName: operatorName || null,
        targetFunnel: targetFunnel || "Atendimento Geral",
        funnelStage: "Qualificação",
        collectedData,
        requireConfiguredPipeline: false,
      });

      if (ensuredDeal.success && ensuredDeal.dealId) {
        dealId = ensuredDeal.dealId;
        dealTitle = ensuredDeal.dealTitle || dealTitle;
        taskId = ensuredDeal.taskId || taskId;
        taskTitle = ensuredDeal.taskTitle || taskTitle;
      }
    }

    // 3. Garantir que a tarefa "Responder o contato" exista na negociação com responsável = recebedor do lead
    if (dealId) {
      const ensuredTask = await ensureTask({
        tenantId,
        dealId,
        conversationId,
        operatorId,
        operatorName: operatorName || null,
        clientName: clientName || "Cliente",
        contactPhone: contactPhone || null,
        targetFunnel: targetFunnel || null,
      });
      if (ensuredTask) {
        taskId = ensuredTask.taskId;
        taskTitle = ensuredTask.taskTitle;
      }
    }

    // 4. Buscar últimas mensagens da conversa para montar o resumo do que foi tratado
    const recentMsgs = await database
      .select({
        senderType: messages.senderType,
        senderName: messages.senderName,
        content: messages.content,
        mediaInterpretation: messages.mediaInterpretation,
      })
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, tenantId),
          eq(messages.conversationId, conversationId),
          eq(messages.isInternalNote, false),
        ),
      )
      .orderBy(desc(messages.sentAt), desc(messages.id))
      .limit(10);

    const chronologicalMsgs = [...recentMsgs].reverse();
    const dialogueSummaryLines = summarizeConversationMessages(chronologicalMsgs, persona.name);

    const displayClient = clientName || "Cliente";
    const companySuffix =
      company && !company.toLowerCase().includes("não informada") ? ` (${company})` : "";
    const funnelLabel = targetFunnel ? ` • Funil: *${targetFunnel}*` : "";
    const dealLabel = dealTitle ? ` • Negociação: *${dealTitle}*` : "";

    let headerLine = "";
    if (transferSource === "manual_transfer") {
      const byText = transferredBy ? ` por ${transferredBy}` : "";
      headerLine = `*Novo cliente transferido para você${byText}!*\nO atendimento de *${displayClient}*${companySuffix} já está na sua fila *Meus Atendimentos*${dealLabel}.`;
    } else if (transferSource === "rodizio_reassignment") {
      headerLine = `*Lead atribuído para você no Rodízio!*\nO cliente *${displayClient}*${companySuffix}${funnelLabel}${dealLabel} foi direcionado para a sua carteira.`;
    } else {
      headerLine = `*Novo lead transferido por ${persona.name} para você!*\nCliente: *${displayClient}*${companySuffix}${funnelLabel}${dealLabel}. Já está em *Meus Atendimentos* aguardando seu contato.`;
    }

    // 5. Construir o Resumo do que foi tratado no atendimento
    const summarySections: string[] = [];

    if (params.triageBriefing && params.triageBriefing.trim()) {
      summarySections.push(params.triageBriefing.trim().slice(0, 8_000));
      if (dialogueSummaryLines.length > 0) {
        summarySections.push(
          ["*Histórico recente do que foi conversado:*", ...dialogueSummaryLines].join("\n"),
        );
      }
    } else {
      const summaryLines: string[] = ["*Resumo do que foi tratado no atendimento*"];
      summaryLines.push(`- *Cliente:* ${displayClient}${companySuffix}`);
      if (contactPhone) {
        summaryLines.push(`- *Contato:* ${contactPhone}`);
      }
      if (targetFunnel) {
        summaryLines.push(`- *Setor / Funil:* ${targetFunnel}`);
      }
      if (interest) {
        summaryLines.push(`- *Demanda / Interesse principal:* ${interest}`);
      }
      if (flowRouteReason === "direct_operator_requested") {
        summaryLines.push(
          `- *Motivo do direcionamento:* Cliente solicitou falar diretamente com o vendedor/atendente.`,
        );
      }

      if (filledEntries.length > 0) {
        summaryLines.push("", "*Dados levantados pelo atendimento:*");
        for (const [key, val] of filledEntries) {
          summaryLines.push(`- *${key}:* ${val.value}`);
        }
      }

      if (dialogueSummaryLines.length > 0) {
        summaryLines.push("", "*Histórico recente do que foi conversado:*");
        summaryLines.push(...dialogueSummaryLines);
      }

      summarySections.push(summaryLines.join("\n"));
    }

    // Bloco explícito da Negociação + Tarefa criada para o operador
    const actionLines: string[] = ["*Ação registrada na Negociação*"];
    if (dealTitle) {
      actionLines.push(`- *Negociação vinculada:* ${dealTitle}`);
    }
    actionLines.push(
      `- *Tarefa criada:* ${taskTitle} (Responsável: ${operatorName || "Você"})`,
    );
    summarySections.push(actionLines.join("\n"));

    const content = `${headerLine}\n\n${summarySections.join("\n\n")}`;

    const interestDisplay =
      [
        targetFunnel ? `Setor/Funil: ${targetFunnel}` : null,
        dealTitle ? `Negociação: ${dealTitle}` : null,
        `Tarefa: ${taskTitle}`,
        interest && interest !== dealTitle ? interest : null,
      ]
        .filter(Boolean)
        .join(" | ") || "Atendimento comercial transferido para sua fila";

    const deterministicId = cycle
      ? `notif-transfer-${crypto.createHash("sha256").update(`${tenantId}:${conversationId}:${operatorId}:${cycle}`).digest("hex").slice(0, 24)}`
      : null;

    const now = new Date();
    const nowIso = now.toISOString();
    const finalMachine =
      resolvedMachine ||
      extractMachineFromDealTitle(dealTitle, displayClient, company || null) ||
      null;
    const metadata = {
      type: "lead_transfer",
      scope: "operator",
      isWarning: true,
      warningType: "new_lead" as const,
      conversationId,
      clientId: conversationId,
      clientName: displayClient,
      contactName: displayClient,
      machine: finalMachine,
      company: company || null,
      interest: interestDisplay,
      temperature,
      dealId,
      dealTitle,
      taskId,
      taskTitle,
      targetFunnel,
      transferSource,
      transferredBy,
      receivedAt: nowIso,
      hasAttendanceSummary: true,
      ...(cycle ? { cycle } : {}),
    };

    const warningMetadata = {
      conversationId,
      clientId: conversationId,
      clientName: displayClient,
      machine: finalMachine,
      company: company || null,
      targetFunnel: targetFunnel || null,
      transferSource,
      transferredBy,
      receivedAt: nowIso,
      interest: interestDisplay,
      temperature,
      dealId: dealId || undefined,
      dealTitle: dealTitle || undefined,
      taskId: taskId || undefined,
      taskTitle,
    };

    if (deterministicId) {
      const [byId] = await database
        .select({
          id: internalMessages.id,
          content: internalMessages.content,
          metadata: internalMessages.metadata,
        })
        .from(internalMessages)
        .where(
          and(
            eq(internalMessages.tenantId, tenantId),
            eq(internalMessages.id, deterministicId),
          ),
        )
        .limit(1);

      if (byId) {
        const existingMeta = (byId.metadata as Record<string, any>) || {};
        const needsUpdate =
          !existingMeta.hasAttendanceSummary ||
          (!existingMeta.taskId && Boolean(taskId)) ||
          (Boolean(params.triageBriefing) && !byId.content.includes(params.triageBriefing.slice(0, 60)));

        if (needsUpdate) {
          await database
            .update(internalMessages)
            .set({
              content,
              metadata,
              lastFiredAt: now,
            })
            .where(
              and(
                eq(internalMessages.tenantId, tenantId),
                eq(internalMessages.id, deterministicId),
              ),
            );

          emitPublic(tenantId, {
            type: "operator_ai_notification" as any,
            operatorId,
            message: {
              id: deterministicId,
              direction: "from_agent",
              author: persona.name,
              content,
              createdAt: now.toISOString(),
              isWarning: true,
              warningType: "new_lead",
              warningMetadata,
              metadata,
            },
            notification: {
              id: deterministicId,
              author: persona.name,
              content,
              createdAt: now.toISOString(),
              isWarning: true,
              warningType: "new_lead",
              warningMetadata,
            },
          });
        }
        return true;
      }
    }

    // Evitar duplicação se o mesmo aviso de transferência já foi gerado nos últimos 2 minutos
    const recentWindow = new Date(Date.now() - 2 * 60 * 1000);
    const existing = await database
      .select({
        id: internalMessages.id,
        content: internalMessages.content,
        metadata: internalMessages.metadata,
      })
      .from(internalMessages)
      .where(
        and(
          eq(internalMessages.tenantId, tenantId),
          eq(internalMessages.operatorId, operatorId),
          sql`${internalMessages.metadata}->>'type' = 'lead_transfer'`,
          sql`${internalMessages.metadata}->>'conversationId' = ${conversationId}`,
          gte(internalMessages.createdAt, recentWindow),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const existingRow = existing[0];
      const existingMeta = (existingRow.metadata as Record<string, any>) || {};
      if (!existingMeta.hasAttendanceSummary || (!existingMeta.taskId && Boolean(taskId))) {
        await database
          .update(internalMessages)
          .set({
            content,
            metadata,
            lastFiredAt: now,
          })
          .where(
            and(
              eq(internalMessages.tenantId, tenantId),
              eq(internalMessages.id, existingRow.id),
            ),
          );
      }
      return true;
    }

    const notifId =
      deterministicId || `notif-transfer-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;

    const inserted = await database
      .insert(internalMessages)
      .values({
        id: notifId,
        tenantId,
        operatorId,
        direction: "from_agent",
        agentType: "supervisor",
        content,
        metadata,
        read: 0,
        createdAt: now,
        repeatCount: 1,
        lastFiredAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: internalMessages.id });

    if (inserted.length === 0) return true;

    emitPublic(tenantId, {
      type: "operator_ai_notification" as any,
      operatorId,
      message: {
        id: notifId,
        direction: "from_agent",
        author: persona.name,
        content,
        createdAt: now.toISOString(),
        isWarning: true,
        warningType: "new_lead",
        warningMetadata,
        metadata,
      },
      notification: {
        id: notifId,
        author: persona.name,
        content,
        createdAt: now.toISOString(),
        isWarning: true,
        warningType: "new_lead",
        warningMetadata,
      },
    });
    return true;
  } catch (err: any) {
    console.error("[notifyOperatorLeadTransferred] Erro ao notificar transferência:", err?.message || err);
    return false;
  }
}
