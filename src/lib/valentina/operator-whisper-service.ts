import crypto from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  contacts,
  conversations,
  crmConversationDeals,
  crmDealContacts,
  crmDeals,
  crmPipelines,
  crmStages,
  internalMessages,
  messages,
  operators,
  sectors,
} from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import { SessionManager } from "../baileys/session-manager";
import { vertexAi } from "../vertex-ai";

export type WhisperPriority = "normal" | "alta" | "urgente";
export type WhisperTone = "consultivo" | "direto" | "urgente";
export type WhisperSource = "mcp" | "ui_monitor" | "ui_crm" | "api";

export interface SendOperatorWhisperInput {
  tenantId: string;
  message: string;
  title?: string | null;
  operatorId?: string | null;
  operatorName?: string | null;
  operatorEmail?: string | null;
  operatorIds?: string[] | null;
  sectorId?: string | null;
  sectorName?: string | null;
  dealId?: string | null;
  conversationId?: string | null;
  priority?: WhisperPriority | string | null;
  senderName?: string | null;
  senderOperatorId?: string | null;
  senderRole?: string | null;
  asAiOnly?: boolean;
  rewriteWithAi?: boolean;
  tone?: WhisperTone | string | null;
  mirrorInConversation?: boolean;
  assignConversation?: boolean;
  source?: WhisperSource;
  actorMeta?: Record<string, unknown>;
}

export interface OperatorWhisperDelivery {
  whisperId: string;
  operatorId: string;
  operatorName: string;
  operatorEmail: string;
  conversationMessageId: string | null;
  didAssignConversation: boolean;
  createdAt: string;
}

export interface SendOperatorWhisperResult {
  success: true;
  tenantId: string;
  personaName: string;
  mode: "single" | "broadcast";
  batchId: string;
  priority: WhisperPriority;
  asAiOnly: boolean;
  displayedSender: string;
  auditSenderName: string;
  rewrittenByAi: boolean;
  originalMessage: string;
  finalMessage: string;
  title: string | null;
  context: {
    deal: {
      id: string;
      title: string;
      status: string;
      pipelineName: string | null;
      stageName: string | null;
      ownerOperatorId: string | null;
    } | null;
    conversation: {
      id: string;
      contactName: string | null;
      contactPhone: string | null;
      queueState: string | null;
      operatorId: string | null;
    } | null;
  };
  deliveredCount: number;
  deliveries: OperatorWhisperDelivery[];
}

export interface ListOperatorWhispersInput {
  tenantId: string;
  operatorId?: string | null;
  operatorName?: string | null;
  dealId?: string | null;
  conversationId?: string | null;
  priority?: WhisperPriority | string | null;
  status?: "all" | "pending" | "read" | "acknowledged" | string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number | null;
}

export interface OperatorWhisperRecord {
  id: string;
  tenantId: string;
  batchId: string | null;
  operatorId: string;
  operatorName: string;
  operatorEmail: string | null;
  operatorAvatar: string | null;
  title: string | null;
  content: string;
  originalMessage: string | null;
  rewrittenByAi: boolean;
  priority: WhisperPriority;
  asAiOnly: boolean;
  displayedSender: string;
  auditSenderName: string;
  source: string;
  dealId: string | null;
  dealTitle: string | null;
  conversationId: string | null;
  contactName: string | null;
  mirroredConversationMessageId: string | null;
  read: boolean;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  acknowledgedNote: string | null;
  createdAt: string;
}

export interface AcknowledgeOperatorWhisperInput {
  tenantId: string;
  operatorId: string;
  whisperId: string;
  note?: string | null;
}

const MAX_WHISPER_LENGTH = 4000;
const MAX_BROADCAST_RECIPIENTS = 50;

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function normalizeWhisperPriority(raw: unknown): WhisperPriority {
  const clean = normalizeText(String(raw || ""));
  if (clean === "urgente" || clean === "urgent" || clean === "critical" || clean === "critica") {
    return "urgente";
  }
  if (clean === "alta" || clean === "high") {
    return "alta";
  }
  return "normal";
}

export function normalizeWhisperTone(raw: unknown): WhisperTone {
  const clean = normalizeText(String(raw || ""));
  if (clean === "urgente" || clean === "urgent") return "urgente";
  if (clean === "direto" || clean === "direct" || clean === "objetivo") return "direto";
  return "consultivo";
}

function isBotOperator(op: { id: string; name: string }): boolean {
  return op.id.startsWith("bot-") || normalizeText(op.name).includes("robo");
}

function safeParseMetadata(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? (raw as Record<string, any>) : {};
}

function emitTenantSse(tenantId: string, event: Record<string, unknown>): void {
  try {
    SessionManager.getInstance().notifyPublic(
      tenantId,
      event as Parameters<SessionManager["notifyPublic"]>[1],
    );
  } catch (err: any) {
    console.warn("[operator-whisper-service] Falha não-crítica ao emitir SSE:", err?.message || err);
  }
}

interface ResolvedOperator {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar: string | null;
}

async function listHumanOperatorsInTenant(tenantId: string): Promise<ResolvedOperator[]> {
  const rows = await db
    .select({
      id: operators.id,
      name: operators.name,
      email: operators.email,
      role: operators.role,
      avatar: operators.avatar,
    })
    .from(operators)
    .where(eq(operators.tenantId, tenantId))
    .orderBy(asc(operators.name));

  return rows.filter((op) => !isBotOperator(op));
}

function matchSingleOperatorFromList(
  allOps: ResolvedOperator[],
  ref: { operatorId?: string | null; operatorEmail?: string | null; operatorName?: string | null },
): ResolvedOperator {
  const id = String(ref.operatorId || "").trim();
  const email = String(ref.operatorEmail || "").trim().toLowerCase();
  const name = String(ref.operatorName || "").trim();

  if (id) {
    const exact = allOps.find((o) => o.id === id);
    if (!exact) {
      throw new Error(`Operador '${id}' não encontrado no tenant.`);
    }
    return exact;
  }

  if (email) {
    const exact = allOps.find((o) => o.email.toLowerCase() === email);
    if (!exact) {
      throw new Error(`Operador com e-mail '${email}' não encontrado no tenant.`);
    }
    return exact;
  }

  if (name) {
    const needle = normalizeText(name);
    const exact = allOps.find((o) => normalizeText(o.name) === needle);
    if (exact) return exact;

    const partials = allOps.filter((o) => normalizeText(o.name).includes(needle));
    if (partials.length === 1) return partials[0];
    if (partials.length > 1) {
      const sample = partials.slice(0, 6).map((o) => `${o.name} (${o.id})`).join(", ");
      throw new Error(
        `Nome de operador ambíguo ('${name}'). Especifique operatorId ou o nome completo. Encontrados: ${sample}.`,
      );
    }
    throw new Error(`Operador '${name}' não encontrado no tenant.`);
  }

  throw new Error("Informe um operador destinatário (operatorId, operatorName, operatorEmail, operatorIds ou sectorId).");
}

interface ResolvedDealContext {
  id: string;
  title: string;
  status: string;
  operatorId: string | null;
  pipelineName: string | null;
  stageName: string | null;
}

interface ResolvedConversationContext {
  id: string;
  operatorId: string | null;
  walletOperatorId: string | null;
  queueState: string | null;
  sectorId: string | null;
  version: number;
  contactName: string | null;
  contactPhone: string | null;
  contactAvatar: string | null;
}

async function resolveDealInTenant(
  tenantId: string,
  dealId: string,
): Promise<ResolvedDealContext | null> {
  const [row] = await db
    .select({
      id: crmDeals.id,
      title: crmDeals.title,
      status: crmDeals.status,
      operatorId: crmDeals.operatorId,
      pipelineName: crmPipelines.name,
      stageName: crmStages.name,
    })
    .from(crmDeals)
    .leftJoin(
      crmPipelines,
      and(eq(crmDeals.pipelineId, crmPipelines.id), eq(crmPipelines.tenantId, tenantId)),
    )
    .leftJoin(
      crmStages,
      and(eq(crmDeals.stageId, crmStages.id), eq(crmStages.tenantId, tenantId)),
    )
    .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, dealId)))
    .limit(1);

  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    operatorId: row.operatorId ?? null,
    pipelineName: row.pipelineName ?? null,
    stageName: row.stageName ?? null,
  };
}

async function resolveConversationInTenant(
  tenantId: string,
  conversationId: string,
): Promise<ResolvedConversationContext | null> {
  const [row] = await db
    .select({
      id: conversations.id,
      operatorId: conversations.operatorId,
      queueState: conversations.queueState,
      sectorId: conversations.sectorId,
      version: conversations.version,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      contactAvatar: contacts.avatar,
      walletOperatorId: contacts.walletOperatorId,
    })
    .from(conversations)
    .leftJoin(
      contacts,
      and(eq(conversations.contactId, contacts.id), eq(contacts.tenantId, tenantId)),
    )
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)))
    .limit(1);

  if (!row) return null;
  return {
    id: row.id,
    operatorId: row.operatorId ?? null,
    walletOperatorId: row.walletOperatorId ?? null,
    queueState: row.queueState ?? null,
    sectorId: row.sectorId ?? null,
    version: Number(row.version ?? 1),
    contactName: row.contactName ?? null,
    contactPhone: row.contactPhone ?? null,
    contactAvatar: row.contactAvatar ?? null,
  };
}

async function discoverConversationForDeal(
  tenantId: string,
  dealId: string,
): Promise<ResolvedConversationContext | null> {
  const linkedRows = await db
    .select({
      conversationId: crmConversationDeals.conversationId,
    })
    .from(crmConversationDeals)
    .innerJoin(
      conversations,
      and(
        eq(crmConversationDeals.conversationId, conversations.id),
        eq(conversations.tenantId, tenantId),
      ),
    )
    .where(
      and(
        eq(crmConversationDeals.tenantId, tenantId),
        eq(crmConversationDeals.dealId, dealId),
        eq(crmConversationDeals.isActive, true),
      ),
    )
    .orderBy(desc(conversations.lastMessageTime), desc(crmConversationDeals.createdAt))
    .limit(5);

  if (linkedRows.length > 0) {
    // Prefere conversa WhatsApp sobre chat do site, se existir
    const preferred =
      linkedRows.find((r) => !r.conversationId.startsWith("conv-lc-")) ?? linkedRows[0];
    return resolveConversationInTenant(tenantId, preferred.conversationId);
  }

  // Fallback: contato primário vinculado ao deal
  const dealContactRows = await db
    .select({ contactId: crmDealContacts.contactId })
    .from(crmDealContacts)
    .where(and(eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.dealId, dealId)))
    .orderBy(desc(crmDealContacts.isPrimary), asc(crmDealContacts.createdAt))
    .limit(3);

  const contactIds = dealContactRows.map((r) => r.contactId);
  if (contactIds.length === 0) return null;

  const [convRow] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), inArray(conversations.contactId, contactIds)))
    .orderBy(desc(conversations.lastMessageTime))
    .limit(1);

  if (!convRow) return null;
  return resolveConversationInTenant(tenantId, convRow.id);
}

async function discoverDealForConversation(
  tenantId: string,
  conversationId: string,
): Promise<ResolvedDealContext | null> {
  const [linked] = await db
    .select({ dealId: crmConversationDeals.dealId })
    .from(crmConversationDeals)
    .innerJoin(
      crmDeals,
      and(eq(crmConversationDeals.dealId, crmDeals.id), eq(crmDeals.tenantId, tenantId)),
    )
    .where(
      and(
        eq(crmConversationDeals.tenantId, tenantId),
        eq(crmConversationDeals.conversationId, conversationId),
        eq(crmConversationDeals.isActive, true),
      ),
    )
    .orderBy(
      sql`CASE WHEN ${crmDeals.status} = 'open' THEN 0 ELSE 1 END`,
      desc(crmDeals.updatedAt),
    )
    .limit(1);

  if (!linked) return null;
  return resolveDealInTenant(tenantId, linked.dealId);
}

async function rewriteWhisperWithVertexAi(params: {
  tenantId: string;
  rawMessage: string;
  tone: WhisperTone;
  priority: WhisperPriority;
  asAiOnly: boolean;
  displayedSender: string;
  targetName: string | null;
  deal: ResolvedDealContext | null;
  conversation: ResolvedConversationContext | null;
}): Promise<{ text: string; rewritten: boolean }> {
  const persona = getAiPersona(params.tenantId);
  const toneGuide =
    params.tone === "urgente"
      ? "urgente, direto e acionável, destacando prioridade imediata sem ser grosseiro"
      : params.tone === "direto"
        ? "curto, objetivo e claro, indo direto à ação esperada"
        : "consultivo, parceiro e profissional, incentivando ação rápida";

  const contextLines: string[] = [];
  if (params.targetName) contextLines.push(`- Destinatário: ${params.targetName}`);
  if (params.deal) {
    contextLines.push(
      `- Negociação CRM: "${params.deal.title}" (status: ${params.deal.status}${
        params.deal.pipelineName ? ` · funil: ${params.deal.pipelineName}` : ""
      }${params.deal.stageName ? ` · etapa: ${params.deal.stageName}` : ""})`,
    );
  }
  if (params.conversation?.contactName) {
    contextLines.push(`- Cliente na conversa: ${params.conversation.contactName}`);
  }
  contextLines.push(`- Prioridade: ${params.priority}`);
  contextLines.push(
    params.asAiOnly
      ? `- Voz da mensagem: fale em 1ª pessoa como ${persona.name} (assistente interno da ${persona.company}), SEM mencionar que um gestor ou supervisão mandou cobrar.`
      : `- Voz da mensagem: fale como ${persona.name} repassando uma orientação/cobrança de ${params.displayedSender}.`,
  );

  const prompt = [
    `Você é ${persona.name}, assistente interno da ${persona.company} (tom da persona: ${persona.tone}).`,
    `Reescreva a instrução abaixo como uma mensagem interna curta de cobrança/orientação para o vendedor (2 a 4 linhas no máximo, português do Brasil, sem inventar fatos, valores ou prazos que não estejam na instrução).`,
    `Estilo desejado: ${toneGuide}.`,
    `Retorne APENAS o texto final da mensagem (sem aspas em volta, sem prefixos como "Mensagem:").`,
    ``,
    `Contexto real:`,
    ...contextLines,
    ``,
    `Instrução original:`,
    params.rawMessage,
  ].join("\n");

  try {
    const generated = await vertexAi.generateText(prompt, "gemini-2.5-flash", undefined, {
      tenantId: params.tenantId,
      feature: persona.chatFeatureKey,
      metadata: {
        subFeature: "operator_whisper_rewrite",
        priority: params.priority,
        tone: params.tone,
        dealId: params.deal?.id ?? null,
        conversationId: params.conversation?.id ?? null,
      },
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 320,
      },
    });
    const clean = String(generated || "")
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();
    if (clean && clean.length >= 4) {
      return { text: clean.slice(0, MAX_WHISPER_LENGTH), rewritten: true };
    }
  } catch (err: any) {
    console.warn(
      "[operator-whisper-service] Falha ao reescrever sussurro via Vertex AI; usando texto literal:",
      err?.message || err,
    );
  }

  return { text: params.rawMessage, rewritten: false };
}

export async function sendOperatorWhisper(
  input: SendOperatorWhisperInput,
): Promise<SendOperatorWhisperResult> {
  const tenantId = String(input.tenantId || "").trim();
  if (!tenantId) {
    throw new Error("tenantId é obrigatório para enviar sussurro.");
  }

  const rawMessage = String(input.message || "").trim();
  if (!rawMessage) {
    throw new Error("message é obrigatório e não pode estar vazio.");
  }
  if (rawMessage.length > MAX_WHISPER_LENGTH) {
    throw new Error(`A mensagem do sussurro não pode exceder ${MAX_WHISPER_LENGTH} caracteres.`);
  }

  const priority = normalizeWhisperPriority(input.priority);
  const tone = normalizeWhisperTone(input.tone);
  const asAiOnly = input.asAiOnly === true;
  const rewriteWithAi = input.rewriteWithAi === true;
  const assignConversation = input.assignConversation === true;
  const title = input.title ? String(input.title).trim().slice(0, 140) || null : null;
  const persona = getAiPersona(tenantId);

  const auditSenderName =
    String(input.senderName || "").trim() || "Gestão Comercial";
  const displayedSender = asAiOnly ? persona.name : auditSenderName;

  // 1. Resolve contexto de Lead (dealId) e Conversa (conversationId) no tenant
  const rawDealId = String(input.dealId || "").trim();
  const rawConvId = String(input.conversationId || "").trim();

  let dealCtx: ResolvedDealContext | null = null;
  let convCtx: ResolvedConversationContext | null = null;

  if (rawDealId) {
    dealCtx = await resolveDealInTenant(tenantId, rawDealId);
    if (!dealCtx) {
      throw new Error(`Negociação '${rawDealId}' não encontrada no tenant '${tenantId}'.`);
    }
  }

  if (rawConvId) {
    convCtx = await resolveConversationInTenant(tenantId, rawConvId);
    if (!convCtx) {
      throw new Error(`Conversa '${rawConvId}' não encontrada no tenant '${tenantId}'.`);
    }
  }

  // Enriquecimento automático cruzado (deal ↔ conversa)
  if (dealCtx && !convCtx) {
    convCtx = await discoverConversationForDeal(tenantId, dealCtx.id);
  } else if (convCtx && !dealCtx) {
    dealCtx = await discoverDealForConversation(tenantId, convCtx.id);
  }

  // 2. Resolve destinatário(s)
  const allOps = await listHumanOperatorsInTenant(tenantId);
  const opsById = new Map(allOps.map((o) => [o.id, o]));
  const targetsMap = new Map<string, ResolvedOperator>();

  const hasMultiOperatorIds = Array.isArray(input.operatorIds) && input.operatorIds.length > 0;
  const rawSectorId = String(input.sectorId || "").trim();
  const rawSectorName = String(input.sectorName || "").trim();
  const hasExplicitSingle = Boolean(
    String(input.operatorId || "").trim() ||
      String(input.operatorName || "").trim() ||
      String(input.operatorEmail || "").trim(),
  );

  if (hasExplicitSingle) {
    const op = matchSingleOperatorFromList(allOps, {
      operatorId: input.operatorId,
      operatorName: input.operatorName,
      operatorEmail: input.operatorEmail,
    });
    targetsMap.set(op.id, op);
  }

  if (hasMultiOperatorIds) {
    for (const rawId of input.operatorIds!) {
      const cleanId = String(rawId || "").trim();
      if (!cleanId) continue;
      const op = opsById.get(cleanId);
      if (!op) {
        throw new Error(`Operador '${cleanId}' em operatorIds não encontrado no tenant '${tenantId}'.`);
      }
      targetsMap.set(op.id, op);
    }
  }

  if (rawSectorId || rawSectorName) {
    const tenantSectors = await db
      .select({ id: sectors.id, name: sectors.name, operatorIds: sectors.operatorIds })
      .from(sectors)
      .where(eq(sectors.tenantId, tenantId));

    let matchedSector = rawSectorId
      ? tenantSectors.find((s) => s.id === rawSectorId)
      : undefined;

    if (!matchedSector && rawSectorName) {
      const needle = normalizeText(rawSectorName);
      matchedSector =
        tenantSectors.find((s) => normalizeText(s.name) === needle) ??
        tenantSectors.find((s) => normalizeText(s.name).includes(needle));
    }

    if (!matchedSector) {
      throw new Error(
        `Setor '${rawSectorId || rawSectorName}' não encontrado no tenant '${tenantId}'.`,
      );
    }

    const memberIds = Array.isArray(matchedSector.operatorIds) ? matchedSector.operatorIds : [];
    for (const memberId of memberIds) {
      const op = opsById.get(memberId);
      if (op) targetsMap.set(op.id, op);
    }
    if (targetsMap.size === 0) {
      throw new Error(`O setor '${matchedSector.name}' não possui operadores humanos vinculados.`);
    }
  }

  // Inferência automática se nenhum destinatário explícito foi passado
  if (targetsMap.size === 0) {
    const inferredOpId =
      dealCtx?.operatorId || convCtx?.operatorId || convCtx?.walletOperatorId || null;
    if (inferredOpId && opsById.has(inferredOpId)) {
      targetsMap.set(inferredOpId, opsById.get(inferredOpId)!);
    } else {
      throw new Error(
        "Não foi possível inferir o vendedor destinatário a partir do lead/conversa. Informe operatorId, operatorName, operatorEmail, operatorIds ou sectorId.",
      );
    }
  }

  const targets = Array.from(targetsMap.values());
  if (targets.length > MAX_BROADCAST_RECIPIENTS) {
    throw new Error(
      `Limite de ${MAX_BROADCAST_RECIPIENTS} destinatários por chamada excedido (${targets.length} solicitados).`,
    );
  }

  const isBroadcast = targets.length > 1;
  if (assignConversation && isBroadcast) {
    throw new Error(
      "assignConversation: true só pode ser usado para 1 vendedor por vez (incompatível com envio em lote/setor).",
    );
  }
  if (assignConversation && !convCtx) {
    throw new Error(
      "assignConversation: true exige uma conversa vinculada (conversationId ou dealId com conversa).",
    );
  }

  // 3. Reescrita opcional via Vertex AI
  let finalMessage = rawMessage;
  let rewrittenByAi = false;
  if (rewriteWithAi) {
    const aiResult = await rewriteWhisperWithVertexAi({
      tenantId,
      rawMessage,
      tone,
      priority,
      asAiOnly,
      displayedSender,
      targetName: targets.length === 1 ? targets[0].name.split(" ")[0] : null,
      deal: dealCtx,
      conversation: convCtx,
    });
    finalMessage = aiResult.text;
    rewrittenByAi = aiResult.rewritten;
  }

  // 4. Define espelhamento na conversa (padrão true no modo individual com conversa; false em broadcast)
  const shouldMirrorInConversation =
    Boolean(convCtx) &&
    (typeof input.mirrorInConversation === "boolean"
      ? input.mirrorInConversation && !isBroadcast
      : !isBroadcast);

  const batchId = `whisp-batch-${crypto.randomUUID()}`;
  const now = new Date();
  const deliveries: OperatorWhisperDelivery[] = [];

  for (const target of targets) {
    const whisperId = `whisp-${crypto.randomUUID()}`;
    let mirroredConversationMessageId: string | null = null;
    let didAssignConversation = false;

    // 4a. Espelho opcional dentro da conversa (sempre invisível ao cliente)
    if (shouldMirrorInConversation && convCtx) {
      const convMsgId = `msg-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
      mirroredConversationMessageId = convMsgId;

      const convSenderLabel = asAiOnly ? persona.name : `${displayedSender} (Supervisão)`;
      const whisperMetaDetails: Record<string, any> = {
        supervisorWhisper: true,
        whisperId,
        pairedWithInternalWhisper: true,
        asAiOnly,
        priority,
        source: input.source || "api",
        title,
        dealId: dealCtx?.id ?? null,
        dealTitle: dealCtx?.title ?? null,
        targetOperatorId: target.id,
        targetOperatorName: target.name,
        attendanceActor: {
          name: auditSenderName,
          operatorId: input.senderOperatorId ?? null,
          role: input.senderRole ?? "supervisor",
          source: input.source || "api",
          ...(input.actorMeta || {}),
        },
      };

      let systemAssignMessage: Record<string, any> | null = null;
      if (
        assignConversation &&
        (convCtx.operatorId !== target.id || convCtx.queueState !== "meus")
      ) {
        didAssignConversation = true;
        const sysMsgId = `msg-${Date.now() - 1}-${crypto.randomBytes(3).toString("hex")}`;
        const sysText = `Atendimento atribuído para ${target.name} por ${auditSenderName}.`;
        const sysTime = new Date(now.getTime() - 50);

        await db.insert(messages).values({
          id: sysMsgId,
          tenantId,
          conversationId: convCtx.id,
          senderType: "system",
          senderName: "Sistema",
          content: sysText,
          isInternalNote: false,
          provider: "internal",
          direction: "outbound",
          status: "accepted",
          metaDetails: {
            supervisorIntervention: "transfer",
            whisperId,
            attendanceActor: whisperMetaDetails.attendanceActor,
          },
          sentAt: sysTime,
          updatedAt: sysTime,
        });

        systemAssignMessage = {
          id: sysMsgId,
          conversationId: convCtx.id,
          senderType: "system",
          senderName: "Sistema",
          content: sysText,
          sentAt: sysTime.toISOString(),
          isInternalNote: false,
          status: "accepted",
        };
      }

      await db.insert(messages).values({
        id: convMsgId,
        tenantId,
        conversationId: convCtx.id,
        senderType: "agent",
        senderName: convSenderLabel,
        content: finalMessage,
        isInternalNote: true,
        provider: "internal",
        direction: "outbound",
        status: "accepted",
        metaDetails: whisperMetaDetails,
        sentAt: now,
        updatedAt: now,
      });

      if (didAssignConversation) {
        await db
          .update(conversations)
          .set({
            operatorId: target.id,
            queueState: "meus",
            version: sql`COALESCE(${conversations.version}, 1) + 1`,
            lastMessageTime: now,
            unreadCount: sql`COALESCE(${conversations.unreadCount}, 0) + 1`,
            updatedAt: now,
          })
          .where(and(eq(conversations.id, convCtx.id), eq(conversations.tenantId, tenantId)));

        emitTenantSse(tenantId, {
          type: "queue_update",
          conversationId: convCtx.id,
          queueState: "meus",
          operatorId: target.id,
          sectorId: convCtx.sectorId,
          responsibleName: target.name,
          version: convCtx.version + 1,
        });

        if (systemAssignMessage) {
          emitTenantSse(tenantId, {
            type: "message",
            message: systemAssignMessage,
          });
        }
      } else if (convCtx.queueState !== "finalizados") {
        // Sem efeitos colaterais: não reabre finalizados nem altera dono/fila
        await db
          .update(conversations)
          .set({
            unreadCount: sql`COALESCE(${conversations.unreadCount}, 0) + 1`,
            updatedAt: now,
          })
          .where(and(eq(conversations.id, convCtx.id), eq(conversations.tenantId, tenantId)));
      }

      emitTenantSse(tenantId, {
        type: "message",
        message: {
          id: convMsgId,
          conversationId: convCtx.id,
          senderType: "agent",
          senderName: convSenderLabel,
          content: finalMessage,
          isInternalNote: true,
          isSupervisorWhisper: true,
          sentAt: now.toISOString(),
          status: "accepted",
          operatorId: didAssignConversation ? target.id : convCtx.operatorId,
          walletOperatorId: convCtx.walletOperatorId,
          queue: didAssignConversation ? "meus" : convCtx.queueState,
          phone: convCtx.contactPhone ?? undefined,
          avatar: convCtx.contactAvatar ?? undefined,
          contactName: convCtx.contactName ?? "Cliente",
          metaDetails: whisperMetaDetails,
        },
      });
    }

    // 4b. Mensagem no chat interno do Fagner / Valentina (sempre)
    const internalTitle =
      title ||
      (dealCtx?.title
        ? `Cobrança · ${dealCtx.title}`
        : convCtx?.contactName
          ? `Cobrança · ${convCtx.contactName}`
          : asAiOnly
            ? `Lembrete de ${persona.name}`
            : `Orientação de ${displayedSender}`);

    const internalMeta: Record<string, any> = {
      type: "supervisor_whisper",
      warningType: "whisper",
      scope: "operator",
      isWarning: true,
      priority,
      title: internalTitle,
      customTitle: title,
      batchId,
      senderName: displayedSender,
      auditSenderName,
      senderOperatorId: input.senderOperatorId ?? null,
      senderRole: input.senderRole ?? null,
      asAiOnly,
      rewrittenByAi,
      ...(rewrittenByAi ? { originalMessage: rawMessage } : {}),
      source: input.source || "api",
      ...(input.actorMeta ? { actorMeta: input.actorMeta } : {}),
      dealId: dealCtx?.id ?? null,
      dealTitle: dealCtx?.title ?? null,
      dealPipelineName: dealCtx?.pipelineName ?? null,
      dealStageName: dealCtx?.stageName ?? null,
      conversationId: convCtx?.id ?? null,
      clientId: convCtx?.id ?? null,
      contactName: convCtx?.contactName ?? null,
      clientName: convCtx?.contactName ?? dealCtx?.title ?? null,
      mirroredConversationMessageId,
      didAssignConversation,
      acknowledgedAt: null,
      acknowledgedBy: null,
      acknowledgedNote: null,
    };

    await db.insert(internalMessages).values({
      id: whisperId,
      tenantId,
      operatorId: target.id,
      direction: "from_agent",
      agentType: "supervisor",
      content: finalMessage,
      metadata: internalMeta,
      read: 0,
      repeatCount: 1,
      lastFiredAt: now,
      createdAt: now,
    });

    const ssePayload = {
      id: whisperId,
      tenantId,
      operatorId: target.id,
      direction: "from_agent",
      agentType: "supervisor",
      content: finalMessage,
      createdAt: now.toISOString(),
      read: 0,
      isWarning: true,
      warningType: "whisper",
      metadata: internalMeta,
      warningMetadata: {
        whisperId,
        clientId: convCtx?.id ?? "",
        clientName: convCtx?.contactName ?? dealCtx?.title ?? "",
        conversationId: convCtx?.id ?? null,
        dealId: dealCtx?.id ?? null,
        dealTitle: dealCtx?.title ?? null,
        dealPipelineName: dealCtx?.pipelineName ?? null,
        dealStageName: dealCtx?.stageName ?? null,
        priority,
        title: internalTitle,
        senderName: displayedSender,
        asAiOnly,
        acknowledgedAt: null,
      },
    };

    emitTenantSse(tenantId, {
      type: "operator_ai_notification",
      tenantId,
      operatorId: target.id,
      message: ssePayload,
      notification: ssePayload,
    });

    deliveries.push({
      whisperId,
      operatorId: target.id,
      operatorName: target.name,
      operatorEmail: target.email,
      conversationMessageId: mirroredConversationMessageId,
      didAssignConversation,
      createdAt: now.toISOString(),
    });
  }

  return {
    success: true,
    tenantId,
    personaName: persona.name,
    mode: isBroadcast ? "broadcast" : "single",
    batchId,
    priority,
    asAiOnly,
    displayedSender,
    auditSenderName,
    rewrittenByAi,
    originalMessage: rawMessage,
    finalMessage,
    title,
    context: {
      deal: dealCtx
        ? {
            id: dealCtx.id,
            title: dealCtx.title,
            status: dealCtx.status,
            pipelineName: dealCtx.pipelineName,
            stageName: dealCtx.stageName,
            ownerOperatorId: dealCtx.operatorId,
          }
        : null,
      conversation: convCtx
        ? {
            id: convCtx.id,
            contactName: convCtx.contactName,
            contactPhone: convCtx.contactPhone,
            queueState: convCtx.queueState,
            operatorId: convCtx.operatorId,
          }
        : null,
    },
    deliveredCount: deliveries.length,
    deliveries,
  };
}

export async function listOperatorWhispers(input: ListOperatorWhispersInput): Promise<{
  tenantId: string;
  returnedCount: number;
  summary: {
    total: number;
    acknowledgedCount: number;
    pendingAckCount: number;
    readCount: number;
    unreadCount: number;
  };
  whispers: OperatorWhisperRecord[];
}> {
  const tenantId = String(input.tenantId || "").trim();
  if (!tenantId) {
    throw new Error("tenantId é obrigatório.");
  }

  const rawLimit = Number(input.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 100) : 30;

  let resolvedOpId = String(input.operatorId || "").trim() || null;
  if (!resolvedOpId && input.operatorName && String(input.operatorName).trim()) {
    const allOps = await listHumanOperatorsInTenant(tenantId);
    const needle = normalizeText(String(input.operatorName));
    const found =
      allOps.find((o) => normalizeText(o.name) === needle) ??
      allOps.find((o) => normalizeText(o.name).includes(needle));
    if (found) {
      resolvedOpId = found.id;
    } else {
      return {
        tenantId,
        returnedCount: 0,
        summary: {
          total: 0,
          acknowledgedCount: 0,
          pendingAckCount: 0,
          readCount: 0,
          unreadCount: 0,
        },
        whispers: [],
      };
    }
  }

  const conditions = [
    eq(internalMessages.tenantId, tenantId),
    eq(internalMessages.direction, "from_agent"),
    eq(internalMessages.agentType, "supervisor"),
    sql`${internalMessages.metadata}->>'type' = 'supervisor_whisper'`,
  ];

  if (resolvedOpId) {
    conditions.push(eq(internalMessages.operatorId, resolvedOpId));
  }
  if (input.dealId && String(input.dealId).trim()) {
    const dealId = String(input.dealId).trim();
    conditions.push(sql`${internalMessages.metadata}->>'dealId' = ${dealId}`);
  }
  if (input.conversationId && String(input.conversationId).trim()) {
    const convId = String(input.conversationId).trim();
    conditions.push(sql`${internalMessages.metadata}->>'conversationId' = ${convId}`);
  }
  if (input.priority && String(input.priority).trim()) {
    const prio = normalizeWhisperPriority(input.priority);
    conditions.push(sql`${internalMessages.metadata}->>'priority' = ${prio}`);
  }
  if (input.dateFrom && String(input.dateFrom).trim()) {
    const d = new Date(String(input.dateFrom));
    if (!Number.isNaN(d.getTime())) conditions.push(gte(internalMessages.createdAt, d));
  }
  if (input.dateTo && String(input.dateTo).trim()) {
    const d = new Date(String(input.dateTo));
    if (!Number.isNaN(d.getTime())) conditions.push(lte(internalMessages.createdAt, d));
  }

  const rows = await db
    .select({
      id: internalMessages.id,
      tenantId: internalMessages.tenantId,
      operatorId: internalMessages.operatorId,
      content: internalMessages.content,
      metadata: internalMessages.metadata,
      read: internalMessages.read,
      createdAt: internalMessages.createdAt,
      operatorName: operators.name,
      operatorEmail: operators.email,
      operatorAvatar: operators.avatar,
    })
    .from(internalMessages)
    .leftJoin(
      operators,
      and(eq(internalMessages.operatorId, operators.id), eq(operators.tenantId, tenantId)),
    )
    .where(and(...conditions))
    .orderBy(desc(internalMessages.createdAt))
    .limit(Math.min(limit * 3, 300));

  const statusFilter = normalizeText(String(input.status || "all"));

  const mapped: OperatorWhisperRecord[] = rows.map((row) => {
    const meta = safeParseMetadata(row.metadata);
    const ackAt = typeof meta.acknowledgedAt === "string" && meta.acknowledgedAt ? meta.acknowledgedAt : null;
    const isRead = Number(row.read || 0) > 0 || Boolean(ackAt);
    return {
      id: row.id,
      tenantId: row.tenantId,
      batchId: typeof meta.batchId === "string" ? meta.batchId : null,
      operatorId: row.operatorId,
      operatorName: row.operatorName || "Operador",
      operatorEmail: row.operatorEmail || null,
      operatorAvatar: row.operatorAvatar || null,
      title: typeof meta.customTitle === "string" && meta.customTitle
        ? meta.customTitle
        : typeof meta.title === "string"
          ? meta.title
          : null,
      content: row.content,
      originalMessage: typeof meta.originalMessage === "string" ? meta.originalMessage : null,
      rewrittenByAi: Boolean(meta.rewrittenByAi),
      priority: normalizeWhisperPriority(meta.priority),
      asAiOnly: Boolean(meta.asAiOnly),
      displayedSender: typeof meta.senderName === "string" ? meta.senderName : "Gestão Comercial",
      auditSenderName:
        typeof meta.auditSenderName === "string"
          ? meta.auditSenderName
          : typeof meta.senderName === "string"
            ? meta.senderName
            : "Gestão Comercial",
      source: typeof meta.source === "string" ? meta.source : "api",
      dealId: typeof meta.dealId === "string" ? meta.dealId : null,
      dealTitle: typeof meta.dealTitle === "string" ? meta.dealTitle : null,
      conversationId: typeof meta.conversationId === "string" ? meta.conversationId : null,
      contactName: typeof meta.contactName === "string" ? meta.contactName : null,
      mirroredConversationMessageId:
        typeof meta.mirroredConversationMessageId === "string"
          ? meta.mirroredConversationMessageId
          : null,
      read: isRead,
      acknowledged: Boolean(ackAt),
      acknowledgedAt: ackAt,
      acknowledgedNote: typeof meta.acknowledgedNote === "string" ? meta.acknowledgedNote : null,
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    };
  });

  const filtered = mapped.filter((item) => {
    if (statusFilter === "acknowledged" || statusFilter === "ciente") return item.acknowledged;
    if (statusFilter === "pending" || statusFilter === "pendente") return !item.acknowledged;
    if (statusFilter === "read" || statusFilter === "lido") return item.read;
    if (statusFilter === "unread" || statusFilter === "nao_lido") return !item.read;
    return true;
  });

  const sliced = filtered.slice(0, limit);
  const acknowledgedCount = filtered.filter((i) => i.acknowledged).length;
  const readCount = filtered.filter((i) => i.read).length;

  return {
    tenantId,
    returnedCount: sliced.length,
    summary: {
      total: filtered.length,
      acknowledgedCount,
      pendingAckCount: filtered.length - acknowledgedCount,
      readCount,
      unreadCount: filtered.length - readCount,
    },
    whispers: sliced,
  };
}

export async function acknowledgeOperatorWhisper(
  input: AcknowledgeOperatorWhisperInput,
): Promise<{
  success: true;
  whisperId: string;
  acknowledgedAt: string;
  alreadyAcknowledged: boolean;
  acknowledgedNote: string | null;
}> {
  const tenantId = String(input.tenantId || "").trim();
  const operatorId = String(input.operatorId || "").trim();
  const whisperId = String(input.whisperId || "").trim();
  const note = input.note ? String(input.note).trim().slice(0, 500) || null : null;

  if (!tenantId || !operatorId || !whisperId) {
    throw new Error("tenantId, operatorId e whisperId são obrigatórios.");
  }

  const [row] = await db
    .select({
      id: internalMessages.id,
      metadata: internalMessages.metadata,
    })
    .from(internalMessages)
    .where(
      and(
        eq(internalMessages.tenantId, tenantId),
        eq(internalMessages.operatorId, operatorId),
        eq(internalMessages.id, whisperId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new Error("Sussurro não encontrado para este operador.");
  }

  const meta = safeParseMetadata(row.metadata);
  if (meta.type !== "supervisor_whisper") {
    throw new Error("A mensagem informada não é um sussurro de supervisão.");
  }

  if (typeof meta.acknowledgedAt === "string" && meta.acknowledgedAt) {
    return {
      success: true,
      whisperId,
      acknowledgedAt: meta.acknowledgedAt,
      alreadyAcknowledged: true,
      acknowledgedNote: typeof meta.acknowledgedNote === "string" ? meta.acknowledgedNote : null,
    };
  }

  const nowIso = new Date().toISOString();
  const nextMeta = {
    ...meta,
    acknowledgedAt: nowIso,
    acknowledgedBy: operatorId,
    ...(note ? { acknowledgedNote: note } : {}),
  };

  await db
    .update(internalMessages)
    .set({
      read: 1,
      metadata: nextMeta,
    })
    .where(
      and(
        eq(internalMessages.tenantId, tenantId),
        eq(internalMessages.operatorId, operatorId),
        eq(internalMessages.id, whisperId),
      ),
    );

  emitTenantSse(tenantId, {
    type: "operator_whisper_acknowledged",
    tenantId,
    operatorId,
    whisperId,
    acknowledgedAt: nowIso,
    acknowledgedNote: note,
  });

  return {
    success: true,
    whisperId,
    acknowledgedAt: nowIso,
    alreadyAcknowledged: false,
    acknowledgedNote: note,
  };
}
