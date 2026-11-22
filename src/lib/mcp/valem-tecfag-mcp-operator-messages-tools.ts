import crypto from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, client as pgSql } from "../../db";
import {
  agentFlowStates,
  contacts,
  conversations,
  crmAccounts,
  crmConversationDeals,
  crmDeals,
  messages,
  operators,
  sectors,
} from "../../db/schema";
import { getAiPersona } from "../ai-persona";
import { setAttendanceActor } from "../attendance-events";
import { SessionManager } from "../baileys/session-manager";
import { isSdrEnabledForTenant } from "../triage/sdr-disabled-routing";
import { SdrDebouncer } from "../valentina/sdr-debouncer";
import { metaAdapter } from "../whatsapp/adapters/meta";
import { resolveConversationConnection } from "../whatsapp/connections";
import {
  getDealFieldBindingKey,
  resolveMetaTemplateValues,
} from "../whatsapp/meta-template-common";
import { loadDealCustomFieldsForTemplate } from "../whatsapp/meta-templates";
import { outboundQueue } from "../whatsapp/outbound";
import { resolveTriageAuditDateWindow } from "./valem-tecfag-mcp-triage-tools";
import type { McpToolDefinition, McpWriteActorContext } from "./valem-tecfag-mcp-write-tools";

const TENANT_ID_PROP = {
  type: "string",
  enum: ["tecfag", "valem"],
  default: "tecfag",
  description:
    "Tenant alvo ('tecfag' ou 'valem'). Ignorado quando a chave MCP está travada em um tenant.",
};

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export type OperatorConversationScope =
  | "assigned"
  | "wallet"
  | "assigned_or_wallet"
  | "participated";

export type OperatorInteractionFilter =
  | "all"
  | "never_replied_by_agent"
  | "never_replied_by_this_operator"
  | "awaiting_agent_reply"
  | "replied_by_agent";

export type MetaWindowFilter = "all" | "inside_24h" | "outside_24h";
export type ChannelFilter = "all" | "official" | "baileys";
export type ProactiveInsideWindowAction = "trigger_ai" | "send_template" | "send_text" | "queue_only";
export type ProactiveOutsideWindowAction = "send_template" | "queue_only" | "skip";

export const MCP_OPERATOR_MESSAGES_TOOLS: McpToolDefinition[] = [
  {
    name: "get_operator_conversations_messages",
    access: "read",
    description:
      "Consulta paginada e em lote de todas as conversas e mensagens de um colaborador/operador específico (por operatorId ou operatorName). Permite filtrar quem nunca teve resposta humana ('never_replied_by_agent'), quem não teve resposta desse operador ('never_replied_by_this_operator'), quem aguarda retorno ('awaiting_agent_reply'), canal oficial Meta vs. Baileys e se está dentro ou fora da janela de 24h da Meta (identificando quem precisa de template aprovado). Retorna resumo completo (summary) sem truncamento + últimas N mensagens por conversa em 1 única chamada.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        operatorId: {
          type: "string",
          description: "ID exato do operador/colaborador (ex: obtido via list_operators).",
        },
        operatorName: {
          type: "string",
          description:
            "Nome completo ou parcial do colaborador (usado quando operatorId não for informado).",
        },
        scope: {
          type: "string",
          enum: ["assigned", "wallet", "assigned_or_wallet", "participated"],
          default: "assigned",
          description:
            "Escopo das conversas: 'assigned' (atualmente atribuídas ao operador, padrão), 'wallet' (contatos na carteira dele), 'assigned_or_wallet' (ambos) ou 'participated' (atribuídas ou onde o operador já enviou mensagens).",
        },
        queueStates: {
          type: "array",
          items: {
            type: "string",
            enum: ["automacao", "fila", "meus", "finalizados"],
          },
          description:
            "Filtra por uma ou mais filas ('meus', 'fila', 'automacao', 'finalizados'). Se omitido, inclui todas.",
        },
        channelFilter: {
          type: "string",
          enum: ["all", "official", "baileys"],
          default: "all",
          description:
            "Filtra por canal: 'all' (padrão), 'official' (WhatsApp oficial Meta, whatsapp_connection_id IS NULL) ou 'baileys' (celulares conectados).",
        },
        interactionFilter: {
          type: "string",
          enum: [
            "all",
            "never_replied_by_agent",
            "never_replied_by_this_operator",
            "awaiting_agent_reply",
            "replied_by_agent",
          ],
          default: "all",
          description:
            "Filtro de interação humana (ignora notas internas e mensagens de sistema): 'never_replied_by_agent' (nenhum humano nunca respondeu), 'never_replied_by_this_operator' (este operador nunca enviou mensagem), 'awaiting_agent_reply' (última mensagem externa é do cliente sem resposta posterior humana), 'replied_by_agent' (já houve resposta humana) ou 'all' (padrão).",
        },
        metaWindowFilter: {
          type: "string",
          enum: ["all", "inside_24h", "outside_24h"],
          default: "all",
          description:
            "Filtra pela janela de 24h da Meta (baseada na última mensagem do cliente): 'inside_24h' (pode enviar texto livre/IA), 'outside_24h' (exige template Meta aprovado) ou 'all'.",
        },
        requireClientMessage: {
          type: "boolean",
          default: false,
          description:
            "Quando true, inclui apenas conversas onde o cliente enviou pelo menos 1 mensagem (clientMessagesCount > 0).",
        },
        startDate: {
          type: "string",
          description: "Data inicial opcional YYYY-MM-DD (Brasília) sobre last_message_time.",
        },
        endDate: {
          type: "string",
          description: "Data final opcional YYYY-MM-DD (Brasília) sobre last_message_time.",
        },
        query: {
          type: "string",
          description: "Busca textual opcional por nome do cliente, telefone, CNPJ, empresa ou última mensagem.",
        },
        messagesPerConversation: {
          type: "number",
          default: 10,
          description:
            "Quantidade de mensagens cronológicas mais recentes incluídas em cada conversa (padrão 10, máx 50; use 0 para retornar apenas a lista e estatísticas sem o texto das mensagens).",
        },
        includeInternalNotes: {
          type: "boolean",
          default: true,
          description: "Quando true (padrão), inclui notas internas na lista de mensagens retornada.",
        },
        includeSystemMessages: {
          type: "boolean",
          default: false,
          description: "Quando true, inclui eventos de sistema ('senderType=system') nas mensagens retornadas.",
        },
        limit: {
          type: "number",
          default: 25,
          description: "Quantidade de conversas retornadas por página (padrão 25, máx 100).",
        },
        offset: {
          type: "number",
          default: 0,
          description: "Deslocamento para paginação (padrão 0). Use nextOffset retornado em summary.",
        },
      },
    },
  },
  {
    name: "handoff_conversation_to_ai_proactive",
    access: "write",
    description:
      "[ESCRITA] Retira uma ou mais conversas (até 50 por lote) de um operador/SDR, limpa opcionalmente a carteira do contato (walletOperatorId=null, responsibleName='Na Fila'), move para 'automacao' e aciona o assistente IA (SDR) proativamente: para leads dentro da janela de 24h da Meta pode disparar a IA ('trigger_ai'), enviar texto proativo ('send_text') ou template ('send_template'); para leads fora da janela de 24h envia template Meta aprovado como bot SDR preparando agent_flow_states com greetingDone=true. Suporta dryRun=true para simular antes de executar e trava onlyIfNeverRepliedByAgent=true por segurança.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        conversationId: {
          type: "string",
          description: "ID único de uma conversa (alternativa a conversationIds).",
        },
        conversationIds: {
          type: "array",
          items: { type: "string" },
          description: "Lista de até 50 IDs de conversas para repassar em lote ao assistente IA (SDR).",
        },
        dryRun: {
          type: "boolean",
          default: false,
          description:
            "Quando true, valida todas as conversas, checa janela de 24h, guardas de segurança e parâmetros do template sem alterar o banco nem enviar mensagens.",
        },
        onlyIfNeverRepliedByAgent: {
          type: "boolean",
          default: true,
          description:
            "Trava de segurança (padrão true): pula automaticamente conversas em que algum operador humano já enviou mensagem externa.",
        },
        expectedOperatorId: {
          type: "string",
          description:
            "Trava opcional: só processa conversas atribuídas a este operador ou cujo contato pertença à carteira dele.",
        },
        clearWallet: {
          type: "boolean",
          default: true,
          description:
            "Quando true (padrão), limpa contacts.walletOperatorId=null e grava responsibleName='Na Fila' para impedir que o cliente volte para o SDR antigo ao responder.",
        },
        insideWindowAction: {
          type: "string",
          enum: ["trigger_ai", "send_template", "send_text", "queue_only"],
          default: "trigger_ai",
          description:
            "Ação para conversas DENTRO da janela de 24h da Meta: 'trigger_ai' (padrão — aciona o assistente IA para responder com base na última mensagem do cliente), 'send_template', 'send_text' (requer proactiveMessage) ou 'queue_only'.",
        },
        outsideWindowAction: {
          type: "string",
          enum: ["send_template", "queue_only", "skip"],
          default: "send_template",
          description:
            "Ação para conversas FORA da janela de 24h da Meta: 'send_template' (padrão — envia templateName aprovado pela Meta como bot SDR e inicia o fluxo com greetingDone=true), 'queue_only' (move para automacao sem enviar) ou 'skip'.",
        },
        templateName: {
          type: "string",
          description:
            "Nome do template oficial APPROVED na Meta para abordagem proativa fora da janela 24h (ex: 'fagner_abertura_dia1_v1_sn' ou template específico aprovado).",
        },
        templateLanguage: {
          type: "string",
          default: "pt_BR",
          description: "Idioma do template Meta (padrão 'pt_BR').",
        },
        templateParameters: {
          type: "array",
          items: { type: "string" },
          description:
            "Parâmetros manuais opcionais para variáveis {{1}}, {{2}}... do template. Variáveis com binding (customer_name, operator_name, deal_field:*) são resolvidas automaticamente.",
        },
        proactiveMessage: {
          type: "string",
          description:
            "Texto proativo enviado como bot SDR quando insideWindowAction='send_text' (apenas dentro da janela 24h).",
        },
        reopenIfClosed: {
          type: "boolean",
          default: true,
          description: "Quando true (padrão), reabre conversas em 'finalizados' movendo-as para 'automacao'.",
        },
        reason: {
          type: "string",
          description: "Motivo do repasse proativo para registro em auditoria.",
        },
        actorName: {
          type: "string",
          description: "Nome legível de quem acionou o repasse (opcional).",
        },
        idempotencyPrefix: {
          type: "string",
          description:
            "Prefixo opcional para gerar idempotencyKey determinístico por conversa (evita reenvio duplicado em retentativas de lote).",
        },
      },
    },
  },
];

export const MCP_OPERATOR_MESSAGES_TOOL_LABELS_PT: Record<string, string> = {
  get_operator_conversations_messages: "Conversas & Mensagens por Colaborador",
  handoff_conversation_to_ai_proactive: "Repasse Proativo para Triagem IA (Lote/Template)",
};

const OPERATOR_MESSAGES_TOOL_NAMES = new Set(MCP_OPERATOR_MESSAGES_TOOLS.map((t) => t.name));

export function isOperatorMessagesMcpTool(name: string): boolean {
  return OPERATOR_MESSAGES_TOOL_NAMES.has(name);
}

function asTrimmedString(val: unknown): string | undefined {
  if (typeof val !== "string") return undefined;
  const trimmed = val.trim();
  return trimmed.length ? trimmed : undefined;
}

function clampInt(raw: unknown, defaultVal: number, min: number, max: number): number {
  const num = Number(raw);
  if (!Number.isFinite(num)) return defaultVal;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function safeIso(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val.toISOString();
  const parsed = new Date(String(val));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseQueueStates(raw: unknown): Array<"automacao" | "fila" | "meus" | "finalizados"> {
  const valid = new Set(["automacao", "fila", "meus", "finalizados"]);
  if (Array.isArray(raw)) {
    return raw
      .map((item) => String(item || "").trim().toLowerCase())
      .filter((item): item is "automacao" | "fila" | "meus" | "finalizados" => valid.has(item));
  }
  if (typeof raw === "string" && raw.trim() && raw.trim().toLowerCase() !== "all") {
    return raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item): item is "automacao" | "fila" | "meus" | "finalizados" => valid.has(item));
  }
  return [];
}

function buildTemplateSuppliedParams(
  variableCount: number,
  bindings: Record<string, string> | undefined,
  suppliedParameters: unknown,
): Array<{ type: "text"; text: string }> {
  if (variableCount <= 0) return [];
  const rawList = Array.isArray(suppliedParameters)
    ? suppliedParameters.map((p) => ({ type: "text" as const, text: String(p ?? "") }))
    : [];
  if (rawList.length === variableCount) return rawList;

  const map = bindings || {};
  const manualIndexes: number[] = [];
  for (let i = 1; i <= variableCount; i++) {
    const b = map[String(i)] || "manual";
    if (b === "manual") manualIndexes.push(i);
  }
  if (rawList.length > 0 && rawList.length === manualIndexes.length && manualIndexes.length < variableCount) {
    let manualCursor = 0;
    return Array.from({ length: variableCount }, (_, offset) => {
      const idx = offset + 1;
      const b = map[String(idx)] || "manual";
      if (b === "manual") {
        return rawList[manualCursor++] ?? { type: "text" as const, text: "" };
      }
      return { type: "text" as const, text: "" };
    });
  }

  return Array.from({ length: variableCount }, (_, offset) => rawList[offset] ?? { type: "text" as const, text: "" });
}

export interface OperatorConversationMessageStats {
  totalMessages: number;
  clientMessagesCount: number;
  agentMessagesCount: number;
  thisOperatorMessagesCount: number;
  botMessagesCount: number;
  internalNotesCount: number;
  lastClientMessageAt: string | null;
  lastAgentMessageAt: string | null;
  lastBotMessageAt: string | null;
  neverRepliedByAgent: boolean;
  neverRepliedByThisOperator: boolean;
  awaitingAgentReply: boolean;
  withinMeta24hWindow: boolean;
  hoursSinceLastClientMessage: number | null;
  recommendedProactiveMethod: "free_text_or_ai" | "meta_template_required" | "baileys_channel";
}

export function computeOperatorConversationStats(input: {
  totalMessages: number;
  clientMessagesCount: number;
  agentMessagesCount: number;
  thisOperatorMessagesCount: number;
  botMessagesCount: number;
  internalNotesCount: number;
  lastClientMessageAt: Date | string | null;
  lastAgentMessageAt: Date | string | null;
  lastBotMessageAt: Date | string | null;
  isOfficialChannel: boolean;
  now?: Date;
}): OperatorConversationMessageStats {
  const now = input.now ?? new Date();
  const lastClientIso = safeIso(input.lastClientMessageAt);
  const lastAgentIso = safeIso(input.lastAgentMessageAt);
  const lastBotIso = safeIso(input.lastBotMessageAt);

  const lastClientMs = lastClientIso ? new Date(lastClientIso).getTime() : null;
  const lastAgentMs = lastAgentIso ? new Date(lastAgentIso).getTime() : null;

  const neverRepliedByAgent = input.agentMessagesCount === 0;
  const neverRepliedByThisOperator = input.thisOperatorMessagesCount === 0;
  const awaitingAgentReply =
    lastClientMs !== null && (lastAgentMs === null || lastClientMs > lastAgentMs);

  const hoursSinceLastClientMessage =
    lastClientMs !== null
      ? Math.max(0, Math.round(((now.getTime() - lastClientMs) / (1000 * 60 * 60)) * 10) / 10)
      : null;

  const withinMeta24hWindow =
    lastClientMs !== null && now.getTime() - lastClientMs <= TWENTY_FOUR_HOURS_MS;

  const recommendedProactiveMethod = !input.isOfficialChannel
    ? "baileys_channel"
    : withinMeta24hWindow
      ? "free_text_or_ai"
      : "meta_template_required";

  return {
    totalMessages: input.totalMessages,
    clientMessagesCount: input.clientMessagesCount,
    agentMessagesCount: input.agentMessagesCount,
    thisOperatorMessagesCount: input.thisOperatorMessagesCount,
    botMessagesCount: input.botMessagesCount,
    internalNotesCount: input.internalNotesCount,
    lastClientMessageAt: lastClientIso,
    lastAgentMessageAt: lastAgentIso,
    lastBotMessageAt: lastBotIso,
    neverRepliedByAgent,
    neverRepliedByThisOperator,
    awaitingAgentReply,
    withinMeta24hWindow,
    hoursSinceLastClientMessage,
    recommendedProactiveMethod,
  };
}

export function matchesOperatorConversationFilters(
  stats: OperatorConversationMessageStats,
  filters: {
    interactionFilter: OperatorInteractionFilter;
    metaWindowFilter: MetaWindowFilter;
    requireClientMessage?: boolean;
  },
): boolean {
  if (filters.requireClientMessage && stats.clientMessagesCount <= 0) {
    return false;
  }

  switch (filters.interactionFilter) {
    case "never_replied_by_agent":
      if (!stats.neverRepliedByAgent) return false;
      break;
    case "never_replied_by_this_operator":
      if (!stats.neverRepliedByThisOperator) return false;
      break;
    case "awaiting_agent_reply":
      if (!stats.awaitingAgentReply) return false;
      break;
    case "replied_by_agent":
      if (stats.neverRepliedByAgent) return false;
      break;
    case "all":
    default:
      break;
  }

  if (filters.metaWindowFilter === "inside_24h" && !stats.withinMeta24hWindow) {
    return false;
  }
  if (filters.metaWindowFilter === "outside_24h" && stats.withinMeta24hWindow) {
    return false;
  }

  return true;
}

export interface ProactiveHandoffPlan {
  decision:
    | "trigger_ai"
    | "send_template"
    | "send_text"
    | "queue_only"
    | "skipped_non_official_channel"
    | "skipped_already_replied"
    | "skipped_operator_mismatch"
    | "skipped_closed"
    | "skipped_outside_24h"
    | "needs_meta_template"
    | "needs_proactive_message";
  reason: string;
}

export function resolveProactiveHandoffPlan(input: {
  isOfficialChannel: boolean;
  queueState: string;
  reopenIfClosed: boolean;
  agentMessagesCount: number;
  onlyIfNeverRepliedByAgent: boolean;
  expectedOperatorId?: string;
  currentOperatorId: string | null;
  walletOperatorId: string | null;
  withinMeta24hWindow: boolean;
  insideWindowAction: ProactiveInsideWindowAction;
  outsideWindowAction: ProactiveOutsideWindowAction;
  hasTemplateName: boolean;
  hasProactiveMessage: boolean;
}): ProactiveHandoffPlan {
  if (!input.isOfficialChannel) {
    return {
      decision: "skipped_non_official_channel",
      reason: "Conversa pertence a conexão Baileys pessoal (não é canal oficial Meta).",
    };
  }

  if (input.queueState === "finalizados" && !input.reopenIfClosed) {
    return {
      decision: "skipped_closed",
      reason: "Conversa está em 'finalizados' e reopenIfClosed=false.",
    };
  }

  if (
    input.expectedOperatorId &&
    input.currentOperatorId !== input.expectedOperatorId &&
    input.walletOperatorId !== input.expectedOperatorId
  ) {
    return {
      decision: "skipped_operator_mismatch",
      reason: `Conversa/carteira não pertence ao operador esperado '${input.expectedOperatorId}'.`,
    };
  }

  if (input.onlyIfNeverRepliedByAgent && input.agentMessagesCount > 0) {
    return {
      decision: "skipped_already_replied",
      reason: `Já existem ${input.agentMessagesCount} mensagem(ns) humana(s) externa(s) nesta conversa.`,
    };
  }

  if (input.withinMeta24hWindow) {
    if (input.insideWindowAction === "send_template") {
      if (!input.hasTemplateName) {
        return {
          decision: "needs_meta_template",
          reason: "insideWindowAction='send_template' exige 'templateName' aprovado pela Meta.",
        };
      }
      return {
        decision: "send_template",
        reason: "Dentro da janela 24h: enviará template Meta como bot SDR e colocará em automacao.",
      };
    }
    if (input.insideWindowAction === "send_text") {
      if (!input.hasProactiveMessage) {
        return {
          decision: "needs_proactive_message",
          reason: "insideWindowAction='send_text' exige 'proactiveMessage' preenchido.",
        };
      }
      return {
        decision: "send_text",
        reason: "Dentro da janela 24h: enviará texto proativo como bot SDR e colocará em automacao.",
      };
    }
    if (input.insideWindowAction === "queue_only") {
      return {
        decision: "queue_only",
        reason: "Dentro da janela 24h: moverá para automacao sem envio imediato.",
      };
    }
    return {
      decision: "trigger_ai",
      reason: "Dentro da janela 24h: moverá para automacao e acionará o assistente IA proativamente.",
    };
  }

  // Fora da janela de 24h
  if (input.outsideWindowAction === "skip") {
    return {
      decision: "skipped_outside_24h",
      reason: "Fora da janela 24h da Meta e outsideWindowAction='skip'.",
    };
  }
  if (input.outsideWindowAction === "queue_only") {
    return {
      decision: "queue_only",
      reason: "Fora da janela 24h: moverá para automacao sem disparo (aguardará retorno ou template futuro).",
    };
  }
  if (!input.hasTemplateName) {
    return {
      decision: "needs_meta_template",
      reason: "Fora da janela 24h da Meta: informe 'templateName' aprovado pela Meta para disparar proativamente.",
    };
  }
  return {
    decision: "send_template",
    reason: "Fora da janela 24h: enviará template Meta aprovado como bot SDR e iniciará fluxo de triagem.",
  };
}

function buildActorDisplayName(
  explicitName: string | undefined,
  actor?: McpWriteActorContext,
): string {
  if (explicitName) return explicitName;
  if (actor?.keyLabel) return `MCP (${actor.keyLabel})`;
  return "MCP";
}

function emitSseSafe(tenantId: string, event: Record<string, unknown>): void {
  try {
    SessionManager.getInstance().notifyPublic(
      tenantId,
      event as Parameters<SessionManager["notifyPublic"]>[1],
    );
  } catch {
    // Falha de SSE não invalida ação confirmada
  }
}

async function resolveTargetOperator(
  tenantId: "tecfag" | "valem",
  operatorId?: string,
  operatorName?: string,
): Promise<{ id: string; name: string; email: string; role: string; isOnline: boolean }> {
  if (!operatorId && !operatorName) {
    throw new Error(
      "Informe 'operatorId' ou 'operatorName' para consultar as conversas e mensagens do colaborador.",
    );
  }

  if (operatorId) {
    const [op] = await db
      .select({
        id: operators.id,
        name: operators.name,
        email: operators.email,
        role: operators.role,
        isOnline: operators.isOnline,
      })
      .from(operators)
      .where(and(eq(operators.tenantId, tenantId), eq(operators.id, operatorId)))
      .limit(1);
    if (!op) {
      throw new Error(`Operador '${operatorId}' não encontrado no tenant '${tenantId}'.`);
    }
    return op;
  }

  const allOps = await db
    .select({
      id: operators.id,
      name: operators.name,
      email: operators.email,
      role: operators.role,
      isOnline: operators.isOnline,
    })
    .from(operators)
    .where(eq(operators.tenantId, tenantId));

  const needle = operatorName!.toLowerCase();
  const exact = allOps.filter((o) => o.name.trim().toLowerCase() === needle);
  if (exact.length === 1) return exact[0];

  const partial = allOps.filter((o) => o.name.trim().toLowerCase().includes(needle));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    const list = partial.map((o) => `${o.name} (${o.id})`).join(", ");
    throw new Error(
      `Mais de um operador corresponde a '${operatorName}': ${list}. Informe 'operatorId' exato.`,
    );
  }
  throw new Error(`Nenhum operador encontrado com nome '${operatorName}' no tenant '${tenantId}'.`);
}

export async function executeOperatorMessagesMcpTool(
  name: string,
  args: Record<string, unknown>,
  tenantId: "tecfag" | "valem",
  actor?: McpWriteActorContext,
): Promise<unknown> {
  const persona = getAiPersona(tenantId);

  switch (name) {
    // ── 1. GET OPERATOR CONVERSATIONS & MESSAGES (READ) ──────────────────────
    case "get_operator_conversations_messages": {
      const operatorIdArg = asTrimmedString(args.operatorId);
      const operatorNameArg = asTrimmedString(args.operatorName);
      const targetOp = await resolveTargetOperator(tenantId, operatorIdArg, operatorNameArg);

      const rawScope = asTrimmedString(args.scope)?.toLowerCase() || "assigned";
      const scope: OperatorConversationScope =
        rawScope === "wallet" ||
        rawScope === "assigned_or_wallet" ||
        rawScope === "participated"
          ? rawScope
          : "assigned";

      const queueStates = parseQueueStates(args.queueStates);
      const rawChannel = asTrimmedString(args.channelFilter)?.toLowerCase() || "all";
      const channelFilter: ChannelFilter =
        rawChannel === "official" || rawChannel === "baileys" ? rawChannel : "all";

      const rawInteraction = asTrimmedString(args.interactionFilter)?.toLowerCase() || "all";
      const interactionFilter: OperatorInteractionFilter =
        rawInteraction === "never_replied_by_agent" ||
        rawInteraction === "never_replied_by_this_operator" ||
        rawInteraction === "awaiting_agent_reply" ||
        rawInteraction === "replied_by_agent"
          ? rawInteraction
          : "all";

      const rawWindow = asTrimmedString(args.metaWindowFilter)?.toLowerCase() || "all";
      const metaWindowFilter: MetaWindowFilter =
        rawWindow === "inside_24h" || rawWindow === "outside_24h" ? rawWindow : "all";
      const requireClientMessage = args.requireClientMessage === true;

      const startDate = asTrimmedString(args.startDate);
      const endDate = asTrimmedString(args.endDate);
      const hasDateArgs = Boolean(startDate || endDate);
      const dateWindow = hasDateArgs
        ? resolveTriageAuditDateWindow({ period: "range", startDate, endDate })
        : { period: "all" as const, startUtc: null, endUtc: null };

      const queryText = asTrimmedString(args.query);
      const messagesPerConversation = clampInt(args.messagesPerConversation, 10, 0, 50);
      const includeInternalNotes = args.includeInternalNotes !== false;
      const includeSystemMessages = args.includeSystemMessages === true;
      const limit = clampInt(args.limit, 25, 1, 100);
      const offset = clampInt(args.offset, 0, 0, 100000);

      const opNameLower = targetOp.name.trim().toLowerCase();
      const opNamePrefixPattern = `${opNameLower}%`;

      const conditions: any[] = [pgSql`conv.tenant_id = ${tenantId}`];

      if (scope === "assigned") {
        conditions.push(pgSql`conv.operator_id = ${targetOp.id}`);
      } else if (scope === "wallet") {
        conditions.push(pgSql`c.wallet_operator_id = ${targetOp.id}`);
      } else if (scope === "assigned_or_wallet") {
        conditions.push(
          pgSql`(conv.operator_id = ${targetOp.id} OR c.wallet_operator_id = ${targetOp.id})`,
        );
      } else {
        // participated
        conditions.push(
          pgSql`(
            conv.operator_id = ${targetOp.id}
            OR EXISTS (
              SELECT 1 FROM messages mp
              WHERE mp.tenant_id = conv.tenant_id
                AND mp.conversation_id = conv.id
                AND mp.sender_type = 'agent'
                AND mp.is_internal_note = false
                AND LOWER(BTRIM(COALESCE(mp.sender_name, ''))) LIKE ${opNamePrefixPattern}
            )
          )`,
        );
      }

      if (queueStates.length > 0) {
        conditions.push(pgSql`conv.queue_state = ANY(${queueStates}::text[])`);
      }

      if (channelFilter === "official") {
        conditions.push(pgSql`conv.whatsapp_connection_id IS NULL`);
      } else if (channelFilter === "baileys") {
        conditions.push(pgSql`conv.whatsapp_connection_id IS NOT NULL`);
      }

      if (dateWindow.startUtc) {
        conditions.push(pgSql`conv.last_message_time >= ${dateWindow.startUtc}`);
      }
      if (dateWindow.endUtc) {
        conditions.push(pgSql`conv.last_message_time <= ${dateWindow.endUtc}`);
      }

      if (queryText) {
        const pattern = `%${queryText}%`;
        conditions.push(pgSql`(
          c.name ILIKE ${pattern}
          OR COALESCE(c.phone, '') ILIKE ${pattern}
          OR COALESCE(c.cnpj, '') ILIKE ${pattern}
          OR COALESCE(acc.name, '') ILIKE ${pattern}
          OR COALESCE(acc.trade_name, '') ILIKE ${pattern}
          OR COALESCE(conv.last_message_text, '') ILIKE ${pattern}
        )`);
      }

      const whereClause = conditions.reduce((acc, curr, idx) =>
        idx === 0 ? curr : pgSql`${acc} AND ${curr}`,
      );

      // Query agregada em SQL via LATERAL: não carrega corpos de milhões de mensagens em RAM
      const rawRows = await pgSql<any[]>`
        SELECT
          conv.id AS conversation_id,
          conv.whatsapp_connection_id,
          conv.queue_state,
          conv.unread_count,
          conv.last_message_text,
          conv.last_message_time,
          conv.created_at,
          c.id AS contact_id,
          c.name AS contact_name,
          c.phone AS contact_phone,
          c.email AS contact_email,
          c.main_channel,
          c.wallet_operator_id,
          c.responsible_name,
          c.account_id,
          acc.name AS account_name,
          acc.trade_name AS account_trade_name,
          op.id AS operator_id,
          op.name AS operator_name,
          s.id AS sector_id,
          s.name AS sector_name,
          COALESCE(ms.total_messages, 0)::int AS total_messages,
          COALESCE(ms.client_messages_count, 0)::int AS client_messages_count,
          COALESCE(ms.agent_messages_count, 0)::int AS agent_messages_count,
          COALESCE(ms.this_operator_messages_count, 0)::int AS this_operator_messages_count,
          COALESCE(ms.bot_messages_count, 0)::int AS bot_messages_count,
          COALESCE(ms.internal_notes_count, 0)::int AS internal_notes_count,
          ms.last_client_message_at,
          ms.last_agent_message_at,
          ms.last_bot_message_at
        FROM conversations conv
        JOIN contacts c ON c.id = conv.contact_id AND c.tenant_id = conv.tenant_id
        LEFT JOIN crm_accounts acc ON acc.id = c.account_id AND acc.tenant_id = conv.tenant_id
        LEFT JOIN operators op ON op.id = conv.operator_id AND op.tenant_id = conv.tenant_id
        LEFT JOIN sectors s ON s.id = conv.sector_id AND s.tenant_id = conv.tenant_id
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS total_messages,
            COUNT(*) FILTER (WHERE m.sender_type = 'client' AND m.is_internal_note = false)::int AS client_messages_count,
            COUNT(*) FILTER (WHERE m.sender_type = 'agent' AND m.is_internal_note = false)::int AS agent_messages_count,
            COUNT(*) FILTER (
              WHERE m.sender_type = 'agent'
                AND m.is_internal_note = false
                AND LOWER(BTRIM(COALESCE(m.sender_name, ''))) LIKE ${opNamePrefixPattern}
            )::int AS this_operator_messages_count,
            COUNT(*) FILTER (WHERE m.sender_type = 'bot' AND m.is_internal_note = false)::int AS bot_messages_count,
            COUNT(*) FILTER (WHERE m.is_internal_note = true)::int AS internal_notes_count,
            MAX(m.sent_at) FILTER (WHERE m.sender_type = 'client' AND m.is_internal_note = false) AS last_client_message_at,
            MAX(m.sent_at) FILTER (WHERE m.sender_type = 'agent' AND m.is_internal_note = false) AS last_agent_message_at,
            MAX(m.sent_at) FILTER (WHERE m.sender_type = 'bot' AND m.is_internal_note = false) AS last_bot_message_at
          FROM messages m
          WHERE m.tenant_id = conv.tenant_id
            AND m.conversation_id = conv.id
        ) ms ON true
        WHERE ${whereClause}
        ORDER BY conv.last_message_time DESC NULLS LAST, conv.id DESC
      `;

      const now = new Date();
      const enriched = rawRows.map((r) => {
        const isOfficialChannel = !r.whatsapp_connection_id;
        const stats = computeOperatorConversationStats({
          totalMessages: Number(r.total_messages || 0),
          clientMessagesCount: Number(r.client_messages_count || 0),
          agentMessagesCount: Number(r.agent_messages_count || 0),
          thisOperatorMessagesCount: Number(r.this_operator_messages_count || 0),
          botMessagesCount: Number(r.bot_messages_count || 0),
          internalNotesCount: Number(r.internal_notes_count || 0),
          lastClientMessageAt: r.last_client_message_at,
          lastAgentMessageAt: r.last_agent_message_at,
          lastBotMessageAt: r.last_bot_message_at,
          isOfficialChannel,
          now,
        });
        return { row: r, isOfficialChannel, stats };
      });

      const matched = enriched.filter((item) =>
        matchesOperatorConversationFilters(item.stats, {
          interactionFilter,
          metaWindowFilter,
          requireClientMessage,
        }),
      );

      // Resumo completo sobre 100% dos itens filtrados (antes da paginação)
      const byQueueState: Record<string, number> = {
        meus: 0,
        fila: 0,
        automacao: 0,
        finalizados: 0,
      };
      let neverRepliedByAgentCount = 0;
      let neverRepliedByThisOperatorCount = 0;
      let clientSentNeverRepliedByAgentCount = 0;
      let clientSentNeverRepliedByThisOperatorCount = 0;
      let strictlyOnlyClientMessagesCount = 0;
      let noClientMessagesCount = 0;
      let awaitingAgentReplyCount = 0;
      let repliedByAgentCount = 0;
      let insideMeta24hWindowCount = 0;
      let outsideMeta24hWindowCount = 0;
      let officialChannelCount = 0;
      let baileysChannelCount = 0;
      let withWalletOperatorCount = 0;

      for (const item of matched) {
        const qs = String(item.row.queue_state || "");
        byQueueState[qs] = (byQueueState[qs] || 0) + 1;
        if (item.stats.neverRepliedByAgent) neverRepliedByAgentCount += 1;
        else repliedByAgentCount += 1;
        if (item.stats.neverRepliedByThisOperator) neverRepliedByThisOperatorCount += 1;
        if (item.stats.clientMessagesCount > 0) {
          if (item.stats.neverRepliedByAgent) clientSentNeverRepliedByAgentCount += 1;
          if (item.stats.neverRepliedByThisOperator) clientSentNeverRepliedByThisOperatorCount += 1;
          if (item.stats.agentMessagesCount === 0 && item.stats.botMessagesCount === 0) {
            strictlyOnlyClientMessagesCount += 1;
          }
        } else {
          noClientMessagesCount += 1;
        }
        if (item.stats.awaitingAgentReply) awaitingAgentReplyCount += 1;
        if (item.stats.withinMeta24hWindow) insideMeta24hWindowCount += 1;
        else outsideMeta24hWindowCount += 1;
        if (item.isOfficialChannel) officialChannelCount += 1;
        else baileysChannelCount += 1;
        if (item.row.wallet_operator_id) withWalletOperatorCount += 1;
      }

      const pageItems = matched.slice(offset, offset + limit);
      const pageConvIds = pageItems.map((i) => String(i.row.conversation_id));

      // Batch 1: negociações vinculadas apenas para a página atual
      const dealsByConv = new Map<string, Array<Record<string, unknown>>>();
      if (pageConvIds.length > 0) {
        const dealRows = await pgSql<any[]>`
          SELECT
            cd.conversation_id,
            d.id AS deal_id,
            d.title,
            d.value,
            d.status,
            d.operator_id AS deal_operator_id
          FROM crm_conversation_deals cd
          JOIN crm_deals d ON d.id = cd.deal_id AND d.tenant_id = cd.tenant_id
          WHERE cd.tenant_id = ${tenantId}
            AND cd.is_active = true
            AND cd.conversation_id = ANY(${pageConvIds}::text[])
        `;
        for (const d of dealRows) {
          const list = dealsByConv.get(d.conversation_id) || [];
          list.push({
            dealId: d.deal_id,
            title: d.title,
            value: d.value,
            status: d.status,
            operatorId: d.deal_operator_id ?? null,
          });
          dealsByConv.set(d.conversation_id, list);
        }
      }

      // Batch 2: últimas N mensagens cronológicas de cada conversa da página (1 única query SQL)
      const msgsByConv = new Map<string, Array<Record<string, unknown>>>();
      if (pageConvIds.length > 0 && messagesPerConversation > 0) {
        const msgRows = await pgSql<any[]>`
          WITH ranked_msgs AS (
            SELECT
              m.id,
              m.conversation_id,
              m.sender_type,
              m.sender_name,
              m.content,
              m.is_internal_note,
              m.media_interpretation,
              m.provider,
              m.direction,
              m.status,
              m.sent_at,
              ROW_NUMBER() OVER (
                PARTITION BY m.conversation_id
                ORDER BY m.sent_at DESC, m.id DESC
              ) AS rn
            FROM messages m
            WHERE m.tenant_id = ${tenantId}
              AND m.conversation_id = ANY(${pageConvIds}::text[])
              ${includeInternalNotes ? pgSql`` : pgSql`AND m.is_internal_note = false`}
              ${includeSystemMessages ? pgSql`` : pgSql`AND m.sender_type <> 'system'`}
          )
          SELECT *
          FROM ranked_msgs
          WHERE rn <= ${messagesPerConversation}
          ORDER BY conversation_id, sent_at ASC, id ASC
        `;
        for (const m of msgRows) {
          const list = msgsByConv.get(m.conversation_id) || [];
          list.push({
            id: m.id,
            sentAt: safeIso(m.sent_at),
            senderType: m.sender_type,
            senderName: m.sender_name,
            isInternalNote: Boolean(m.is_internal_note),
            direction: m.direction,
            provider: m.provider,
            status: m.status,
            content: m.content ? String(m.content).slice(0, 2000) : "",
            mediaInterpretation: m.media_interpretation
              ? String(m.media_interpretation).slice(0, 500)
              : null,
          });
          msgsByConv.set(m.conversation_id, list);
        }
      }

      const totalMatched = matched.length;
      const hasMore = offset + pageItems.length < totalMatched;

      return {
        tenantId,
        aiPersona: persona.name,
        generatedAt: now.toISOString(),
        operator: {
          id: targetOp.id,
          name: targetOp.name,
          email: targetOp.email,
          role: targetOp.role,
          isOnline: targetOp.isOnline,
        },
        filtersApplied: {
          scope,
          queueStates: queueStates.length > 0 ? queueStates : ["all"],
          channelFilter,
          interactionFilter,
          metaWindowFilter,
          requireClientMessage,
          startDate: startDate ?? null,
          endDate: endDate ?? null,
          query: queryText ?? null,
          messagesPerConversation,
          includeInternalNotes,
          includeSystemMessages,
        },
        summary: {
          totalMatched,
          returnedCount: pageItems.length,
          offset,
          limit,
          hasMore,
          nextOffset: hasMore ? offset + pageItems.length : null,
          neverRepliedByAgentCount,
          neverRepliedByThisOperatorCount,
          clientSentNeverRepliedByAgentCount,
          clientSentNeverRepliedByThisOperatorCount,
          strictlyOnlyClientMessagesCount,
          noClientMessagesCount,
          awaitingAgentReplyCount,
          repliedByAgentCount,
          insideMeta24hWindowCount,
          outsideMeta24hWindowCount,
          officialChannelCount,
          baileysChannelCount,
          withWalletOperatorCount,
          byQueueState,
        },
        conversations: pageItems.map(({ row: r, isOfficialChannel, stats }) => ({
          conversationId: r.conversation_id,
          queueState: r.queue_state,
          isOfficialChannel,
          whatsappConnectionId: r.whatsapp_connection_id ?? null,
          unreadCount: Number(r.unread_count || 0),
          createdAt: safeIso(r.created_at),
          lastMessageTime: safeIso(r.last_message_time),
          lastMessageText: r.last_message_text ? String(r.last_message_text).slice(0, 500) : null,
          contact: {
            id: r.contact_id,
            name: r.contact_name,
            phone: r.contact_phone,
            email: r.contact_email,
            channel: r.main_channel,
            walletOperatorId: r.wallet_operator_id ?? null,
            responsibleName: r.responsible_name ?? null,
            accountId: r.account_id ?? null,
            accountName: r.account_trade_name || r.account_name || null,
          },
          operator: r.operator_id ? { id: r.operator_id, name: r.operator_name } : null,
          sector: r.sector_id ? { id: r.sector_id, name: r.sector_name } : null,
          linkedDeals: dealsByConv.get(r.conversation_id) || [],
          stats,
          ...(messagesPerConversation > 0
            ? { messages: msgsByConv.get(r.conversation_id) || [] }
            : {}),
        })),
      };
    }

    // ── 2. HANDOFF CONVERSATION TO AI PROACTIVE (WRITE) ──────────────────────
    case "handoff_conversation_to_ai_proactive": {
      const rawIds: string[] = [];
      if (Array.isArray(args.conversationIds)) {
        for (const item of args.conversationIds) {
          const id = asTrimmedString(item);
          if (id) rawIds.push(id);
        }
      }
      const singleId = asTrimmedString(args.conversationId);
      if (singleId) rawIds.push(singleId);

      const uniqueIds = Array.from(new Set(rawIds));
      if (uniqueIds.length === 0) {
        throw new Error(
          "Campo obrigatório: informe 'conversationId' ou 'conversationIds' (lista de 1 a 50 conversas).",
        );
      }
      if (uniqueIds.length > 50) {
        throw new Error("Limite máximo de 50 conversas por chamada em 'conversationIds'.");
      }

      const dryRun = args.dryRun === true;
      const onlyIfNeverRepliedByAgent = args.onlyIfNeverRepliedByAgent !== false;
      const expectedOperatorId = asTrimmedString(args.expectedOperatorId);
      const clearWallet = args.clearWallet !== false;
      const reopenIfClosed = args.reopenIfClosed !== false;

      const rawInside = asTrimmedString(args.insideWindowAction)?.toLowerCase() || "trigger_ai";
      const insideWindowAction: ProactiveInsideWindowAction =
        rawInside === "send_template" || rawInside === "send_text" || rawInside === "queue_only"
          ? rawInside
          : "trigger_ai";

      const rawOutside = asTrimmedString(args.outsideWindowAction)?.toLowerCase() || "send_template";
      const outsideWindowAction: ProactiveOutsideWindowAction =
        rawOutside === "queue_only" || rawOutside === "skip" ? rawOutside : "send_template";

      const templateName = asTrimmedString(args.templateName);
      const templateLanguage = asTrimmedString(args.templateLanguage) || "pt_BR";
      const proactiveMessage = asTrimmedString(args.proactiveMessage);
      const reason =
        asTrimmedString(args.reason) || `Repasse proativo para triagem ${persona.name} via MCP`;
      const actorName = buildActorDisplayName(asTrimmedString(args.actorName), actor);
      const idempotencyPrefix = asTrimmedString(args.idempotencyPrefix);

      // Se houver templateName informado, valida uma única vez antes do lote
      let approvedTemplate:
        | Awaited<ReturnType<typeof metaAdapter.listApprovedTemplates>>[number]
        | null = null;
      if (templateName) {
        const approvedList = await metaAdapter.listApprovedTemplates(tenantId);
        approvedTemplate =
          approvedList.find(
            (t) => t.name === templateName && t.language === templateLanguage,
          ) || null;
        if (!approvedTemplate?.supported) {
          throw new Error(
            `Template '${templateName}' (${templateLanguage}) não está aprovado pela Meta ou não é suportado no tenant '${tenantId}'.`,
          );
        }
      }

      const sdrEnabledInTenant = await isSdrEnabledForTenant(db, tenantId);
      const now = new Date();
      const results: Array<Record<string, unknown>> = [];

      let handedOffCount = 0;
      let sentTemplateCount = 0;
      let sentTextCount = 0;
      let aiTriggeredCount = 0;
      let queuedOnlyCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const conversationId of uniqueIds) {
        try {
          const [convRow] = await db
            .select({
              id: conversations.id,
              contactId: conversations.contactId,
              contactPhone: conversations.contactPhone,
              whatsappConnectionId: conversations.whatsappConnectionId,
              operatorId: conversations.operatorId,
              sectorId: conversations.sectorId,
              queueState: conversations.queueState,
              version: conversations.version,
            })
            .from(conversations)
            .where(
              and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)),
            )
            .limit(1);

          if (!convRow) {
            errorCount += 1;
            results.push({
              conversationId,
              status: "error",
              error: `Conversa '${conversationId}' não encontrada no tenant '${tenantId}'.`,
            });
            continue;
          }

          const [contactRow] = await db
            .select({
              id: contacts.id,
              name: contacts.name,
              phone: contacts.phone,
              whatsappUserId: contacts.whatsappUserId,
              walletOperatorId: contacts.walletOperatorId,
              responsibleName: contacts.responsibleName,
              accountId: contacts.accountId,
            })
            .from(contacts)
            .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, convRow.contactId)))
            .limit(1);

          if (!contactRow) {
            errorCount += 1;
            results.push({
              conversationId,
              status: "error",
              error: `Contato '${convRow.contactId}' da conversa não encontrado.`,
            });
            continue;
          }

          // Checagem ao vivo de mensagens (guarda onlyIfNeverRepliedByAgent + janela 24h Meta + 1ª msg recente sem resposta)
          const [msgStat] = await pgSql<any[]>`
            SELECT
              COUNT(*) FILTER (WHERE sender_type = 'agent' AND is_internal_note = false)::int AS agent_messages_count,
              MAX(sent_at) FILTER (WHERE sender_type = 'client' AND is_internal_note = false) AS last_client_message_at,
              MIN(sent_at) FILTER (
                WHERE sender_type = 'client'
                  AND is_internal_note = false
                  AND sent_at >= NOW() - INTERVAL '14 days'
              ) AS first_recent_client_message_at
            FROM messages
            WHERE tenant_id = ${tenantId}
              AND conversation_id = ${conversationId}
          `;

          const agentMessagesCount = Number(msgStat?.agent_messages_count || 0);
          const lastClientIso = safeIso(msgStat?.last_client_message_at);
          const firstRecentClientIso = safeIso(msgStat?.first_recent_client_message_at);
          const withinMeta24hWindow =
            lastClientIso !== null &&
            now.getTime() - new Date(lastClientIso).getTime() <= TWENTY_FOUR_HOURS_MS;

          const isOfficialChannel = !convRow.whatsappConnectionId;
          const plan = resolveProactiveHandoffPlan({
            isOfficialChannel,
            queueState: convRow.queueState,
            reopenIfClosed,
            agentMessagesCount,
            onlyIfNeverRepliedByAgent,
            expectedOperatorId,
            currentOperatorId: convRow.operatorId,
            walletOperatorId: contactRow.walletOperatorId,
            withinMeta24hWindow,
            insideWindowAction,
            outsideWindowAction,
            hasTemplateName: Boolean(approvedTemplate),
            hasProactiveMessage: Boolean(proactiveMessage),
          });

          if (
            plan.decision !== "trigger_ai" &&
            plan.decision !== "send_template" &&
            plan.decision !== "send_text" &&
            plan.decision !== "queue_only"
          ) {
            skippedCount += 1;
            results.push({
              conversationId,
              contactId: contactRow.id,
              contactName: contactRow.name,
              phone: convRow.contactPhone || contactRow.phone || null,
              status: plan.decision,
              withinMeta24hWindow,
              lastClientMessageAt: lastClientIso,
              agentMessagesCount,
              reason: plan.reason,
            });
            continue;
          }

          // Pré-resolução de template quando aplicável (também valida em dryRun!)
          let resolvedTemplatePayload: {
            templateName: string;
            templateLanguage: string;
            resolvedValues: string[];
            templateComponents: Array<{ type: "body"; parameters: Array<{ type: "text"; text: string }> }>;
            renderedText: string;
          } | null = null;

          if (plan.decision === "send_template" && approvedTemplate) {
            const targetConn = await resolveConversationConnection(tenantId, conversationId);
            if (targetConn.provider !== "meta") {
              skippedCount += 1;
              results.push({
                conversationId,
                contactId: contactRow.id,
                contactName: contactRow.name,
                status: "skipped_non_official_channel",
                reason: `Provedor da conversa é '${targetConn.provider}', não 'meta'.`,
              });
              continue;
            }

            const rawParams = buildTemplateSuppliedParams(
              approvedTemplate.variableCount,
              approvedTemplate.bindings,
              args.templateParameters,
            );
            const hasDealBindings = Object.values(approvedTemplate.bindings || {}).some((b) =>
              Boolean(getDealFieldBindingKey(b)),
            );
            const dealFieldContext = hasDealBindings
              ? await loadDealCustomFieldsForTemplate(tenantId, conversationId)
              : null;
            const values = resolveMetaTemplateValues(
              approvedTemplate.variableCount,
              approvedTemplate.bindings,
              rawParams,
              {
                customerName: contactRow.name?.trim() || "",
                operatorName: persona.name,
                dealCustomFields: dealFieldContext?.dealCustomFields,
                dealCustomFieldNamesById: dealFieldContext?.dealCustomFieldNamesById,
              },
            );
            const resolvedParams = values.map((v) => ({ type: "text" as const, text: v }));
            const templateComponents = resolvedParams.length
              ? [{ type: "body" as const, parameters: resolvedParams }]
              : [];
            const renderedText = approvedTemplate.bodyText.replace(
              /@?\{\{(\d+)\}\}/g,
              (_, num) => resolvedParams[Number(num) - 1]?.text || `{{${num}}}`,
            );
            resolvedTemplatePayload = {
              templateName: approvedTemplate.name,
              templateLanguage: approvedTemplate.language,
              resolvedValues: values,
              templateComponents,
              renderedText,
            };
          }

          if (dryRun) {
            handedOffCount += 1;
            if (plan.decision === "send_template") sentTemplateCount += 1;
            else if (plan.decision === "send_text") sentTextCount += 1;
            else if (plan.decision === "trigger_ai") aiTriggeredCount += 1;
            else queuedOnlyCount += 1;

            results.push({
              conversationId,
              contactId: contactRow.id,
              contactName: contactRow.name,
              phone: convRow.contactPhone || contactRow.phone || null,
              status: "dry_run_ready",
              plannedAction: plan.decision,
              withinMeta24hWindow,
              lastClientMessageAt: lastClientIso,
              previousOperatorId: convRow.operatorId,
              previousWalletOperatorId: contactRow.walletOperatorId,
              willClearWallet: clearWallet && Boolean(contactRow.walletOperatorId),
              sdrEnabledInTenant,
              ...(resolvedTemplatePayload
                ? {
                    templateName: resolvedTemplatePayload.templateName,
                    renderedPreview: resolvedTemplatePayload.renderedText,
                  }
                : {}),
              ...(plan.decision === "send_text" && proactiveMessage
                ? { proactiveMessagePreview: proactiveMessage }
                : {}),
              reason: plan.reason,
            });
            continue;
          }

          // Execução real:
          // 1) Se precisa enviar template ou texto proativo, dispara antes de mover (evita conversa órfã se falhar)
          const effectivePhone = convRow.contactPhone || contactRow.phone || undefined;
          const effectiveUserId = contactRow.whatsappUserId || undefined;
          let sentMessageId: string | null = null;
          let sentExternalId: string | null = null;
          let renderedSentText: string | null = null;

          if (plan.decision === "send_template" && resolvedTemplatePayload) {
            if (!effectivePhone && !effectiveUserId) {
              errorCount += 1;
              results.push({
                conversationId,
                contactId: contactRow.id,
                contactName: contactRow.name,
                status: "error",
                error: "Contato sem telefone ou BSUID válido para envio via Meta Cloud API.",
              });
              continue;
            }
            const sendRes = await outboundQueue.enqueueAndSend({
              tenantId,
              conversationId,
              recipientPhone: effectivePhone,
              recipientUserId: effectiveUserId,
              text: resolvedTemplatePayload.renderedText,
              templateName: resolvedTemplatePayload.templateName,
              templateLanguage: resolvedTemplatePayload.templateLanguage,
              templateComponents: resolvedTemplatePayload.templateComponents,
              senderType: "bot",
              senderName: `${persona.name} (SDR)`,
              isInternalNote: false,
              idempotencyKey: idempotencyPrefix
                ? `${idempotencyPrefix}:${conversationId}:${resolvedTemplatePayload.templateName}`
                : undefined,
            });
            if (!sendRes.success) {
              errorCount += 1;
              results.push({
                conversationId,
                contactId: contactRow.id,
                contactName: contactRow.name,
                status: "error",
                plannedAction: "send_template",
                error:
                  sendRes.error ||
                  `Falha no envio do template '${resolvedTemplatePayload.templateName}' (${sendRes.code || sendRes.status}).`,
              });
              continue;
            }
            sentMessageId = sendRes.messageId;
            sentExternalId = sendRes.externalId ?? null;
            renderedSentText = resolvedTemplatePayload.renderedText;
          } else if (plan.decision === "send_text" && proactiveMessage) {
            if (!effectivePhone && !effectiveUserId) {
              errorCount += 1;
              results.push({
                conversationId,
                contactId: contactRow.id,
                contactName: contactRow.name,
                status: "error",
                error: "Contato sem telefone ou BSUID válido para envio via Meta Cloud API.",
              });
              continue;
            }
            const sendRes = await outboundQueue.enqueueAndSend({
              tenantId,
              conversationId,
              recipientPhone: effectivePhone,
              recipientUserId: effectiveUserId,
              text: proactiveMessage,
              senderType: "bot",
              senderName: `${persona.name} (SDR)`,
              isInternalNote: false,
              idempotencyKey: idempotencyPrefix
                ? `${idempotencyPrefix}:${conversationId}:text`
                : undefined,
            });
            if (!sendRes.success) {
              errorCount += 1;
              results.push({
                conversationId,
                contactId: contactRow.id,
                contactName: contactRow.name,
                status: "error",
                plannedAction: "send_text",
                error:
                  sendRes.error ||
                  `Falha no envio do texto proativo (${sendRes.code || sendRes.status}).`,
              });
              continue;
            }
            sentMessageId = sendRes.messageId;
            sentExternalId = sendRes.externalId ?? null;
            renderedSentText = proactiveMessage;
          }

          // 2) Transação atômica: tira do SDR, limpa carteira (se clearWallet=true) e prepara agent_flow_states
          const greetingAlreadySent =
            plan.decision === "send_template" || plan.decision === "send_text";
          const actionNow = new Date();
          // Preserva mensagens recentes sem resposta do cliente dentro do ciclo atual do Fagner
          // (para que ele leia o pedido que o cliente já enviou antes do repasse)
          const flowStartedAt =
            agentMessagesCount === 0 && firstRecentClientIso
              ? new Date(Math.min(actionNow.getTime(), new Date(firstRecentClientIso).getTime() - 1000))
              : actionNow;

          const txResult = await db.transaction(async (tx) => {
            await setAttendanceActor(tx, tenantId, `${persona.name} (${actorName})`, null);

            const [updatedConv] = await tx
              .update(conversations)
              .set({
                queueState: "automacao",
                operatorId: null,
                version: sql`${conversations.version} + 1`,
                updatedAt: actionNow,
              })
              .where(
                and(eq(conversations.tenantId, tenantId), eq(conversations.id, conversationId)),
              )
              .returning();

            let walletCleared = false;
            if (clearWallet && contactRow.walletOperatorId) {
              await tx
                .update(contacts)
                .set({
                  walletOperatorId: null,
                  responsibleName: "Na Fila",
                })
                .where(
                  and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactRow.id)),
                );
              walletCleared = true;
            }

            const [existingFlow] = await tx
              .select()
              .from(agentFlowStates)
              .where(
                and(
                  eq(agentFlowStates.tenantId, tenantId),
                  eq(agentFlowStates.conversationId, conversationId),
                  eq(agentFlowStates.agentType, "sdr"),
                ),
              )
              .orderBy(desc(agentFlowStates.lastInteractionAt))
              .limit(1);

            const prevMeta =
              existingFlow?.metadata && typeof existingFlow.metadata === "object"
                ? { ...(existingFlow.metadata as Record<string, unknown>) }
                : {};

            const nextMeta: Record<string, unknown> = {
              ...prevMeta,
              attendanceActorName: persona.name,
              aiPaused: false,
              manualMode: false,
              handoffStatus: null,
              proactiveHandoffAt: actionNow.toISOString(),
              proactiveHandoffBy: actorName,
              proactiveHandoffReason: reason,
              previousOperatorId: convRow.operatorId,
              ...(greetingAlreadySent
                ? {
                    greetingDone: true,
                    proactiveOutreachSent: true,
                    proactiveTemplateName: resolvedTemplatePayload?.templateName ?? null,
                  }
                : {}),
            };

            let flowId: string;
            if (existingFlow) {
              flowId = existingFlow.id;
              await tx
                .update(agentFlowStates)
                .set({
                  outcome: "in_progress",
                  currentStep: "Em Qualificação",
                  metadata: nextMeta,
                  startedAt: flowStartedAt,
                  completedAt: null,
                  lastInteractionAt: actionNow,
                })
                .where(
                  and(
                    eq(agentFlowStates.tenantId, tenantId),
                    eq(agentFlowStates.id, existingFlow.id),
                  ),
                );
            } else {
              flowId = `fs-sdr-${tenantId}-${conversationId}`;
              await tx
                .insert(agentFlowStates)
                .values({
                  id: flowId,
                  tenantId,
                  conversationId,
                  agentType: "sdr",
                  currentStep: "Em Qualificação",
                  collectedData: {},
                  metadata: {
                    stepNumber: 0,
                    totalSteps: 7,
                    followUpStage: 0,
                    funnelStage: "triagem",
                    targetFunnel: null,
                    ...nextMeta,
                  },
                  startedAt: flowStartedAt,
                  lastInteractionAt: actionNow,
                  completedAt: null,
                  outcome: "in_progress",
                })
                .onConflictDoNothing();
            }

            return {
              updatedConv: updatedConv || convRow,
              walletCleared,
              flowId,
            };
          });

          // 3) Se dentro da janela 24h e action='trigger_ai', aciona SdrDebouncer com a última mensagem do cliente
          let aiTriggered = false;
          let aiSkipReason: string | null = null;
          if (plan.decision === "trigger_ai") {
            if (!sdrEnabledInTenant) {
              aiSkipReason = "sdr_disabled";
            } else {
              const [lastClientMsg] = await db
                .select({
                  id: messages.id,
                  content: messages.content,
                  sentAt: messages.sentAt,
                })
                .from(messages)
                .where(
                  and(
                    eq(messages.tenantId, tenantId),
                    eq(messages.conversationId, conversationId),
                    eq(messages.senderType, "client"),
                    eq(messages.isInternalNote, false),
                  ),
                )
                .orderBy(desc(messages.sentAt), desc(messages.id))
                .limit(1);

              if (lastClientMsg && effectivePhone) {
                SdrDebouncer.getInstance().pushIncomingMessage(
                  tenantId,
                  conversationId,
                  effectivePhone,
                  {
                    messageId: lastClientMsg.id,
                    text: lastClientMsg.content || "Olá",
                    mediaType: "text",
                    receivedAt: actionNow,
                  },
                );
                aiTriggered = true;
              } else {
                aiSkipReason = !lastClientMsg ? "no_client_message_found" : "missing_phone";
              }
            }
          }

          emitSseSafe(tenantId, {
            type: "queue_update",
            conversationId,
            contactId: contactRow.id,
            contactName: contactRow.name,
            queueState: "automacao",
            operatorId: null,
            walletOperatorId: txResult.walletCleared ? null : contactRow.walletOperatorId,
            sectorId: txResult.updatedConv.sectorId,
            version: txResult.updatedConv.version,
            responsibleName: `${persona.name} IA`,
          });
          emitSseSafe(tenantId, {
            type: "sdr_flow_updated",
            conversationId,
            funnelStage: "triagem",
            outcome: "in_progress",
          });

          handedOffCount += 1;
          if (plan.decision === "send_template") sentTemplateCount += 1;
          else if (plan.decision === "send_text") sentTextCount += 1;
          else if (plan.decision === "trigger_ai") aiTriggeredCount += 1;
          else queuedOnlyCount += 1;

          results.push({
            conversationId,
            contactId: contactRow.id,
            contactName: contactRow.name,
            phone: effectivePhone ?? null,
            status: "handed_off",
            actionExecuted: plan.decision,
            queueState: "automacao",
            operatorId: null,
            previousOperatorId: convRow.operatorId,
            walletCleared: txResult.walletCleared,
            flowId: txResult.flowId,
            withinMeta24hWindow,
            ...(sentMessageId
              ? {
                  messageId: sentMessageId,
                  externalId: sentExternalId,
                  renderedText: renderedSentText,
                  templateName: resolvedTemplatePayload?.templateName ?? null,
                }
              : {}),
            ...(plan.decision === "trigger_ai"
              ? { aiTriggered, aiSkipReason }
              : {}),
          });
        } catch (err: any) {
          errorCount += 1;
          results.push({
            conversationId,
            status: "error",
            error: err?.message || "Erro inesperado ao repassar conversa.",
          });
        }
      }

      return {
        success: errorCount === 0,
        tenantId,
        aiPersona: persona.name,
        dryRun,
        sdrEnabledInTenant,
        totalRequested: uniqueIds.length,
        handedOffCount,
        sentTemplateCount,
        sentTextCount,
        aiTriggeredCount,
        queuedOnlyCount,
        skippedCount,
        errorCount,
        results,
      };
    }

    default:
      throw new Error(`Ferramenta de mensagens por colaborador desconhecida: '${name}'.`);
  }
}
