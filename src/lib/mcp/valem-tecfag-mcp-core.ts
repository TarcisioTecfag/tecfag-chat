import crypto from "node:crypto";
import { client as defaultSqlClient } from "../../db";
import { requireSession } from "../auth-session";
import {
  calculateBusinessPacing,
  isCommercialWinStage,
  roundPercent,
  saoPauloDay,
} from "../commercial/metrics";
import {
  buildConsultantOperatorAliasMap,
  matchConsultantNames,
} from "../commercial/avatar-matcher";
import { categorizeLossReason } from "../commercial/perdas-data";
import { projectIndustrialMonitoring } from "../triage/industrial-monitor";
import {
  buildJournalSnapshot,
  readJournalSnapshot,
  type JournalFlow,
} from "../triage/industrial-triage-journal";
import {
  formatMarketingSectorLabel,
  isEffectiveCommercialWin,
} from "../marketing/crm-attribution";
import {
  getMarketingAuditBatch,
  listMarketingStageHistory,
  parseFlexibleDateBound,
  projectCanonicalDealSourceName,
} from "../marketing/crm-reporting-service";
import {
  MCP_EXTENDED_TOOLS,
  MCP_EXTENDED_TOOL_LABELS_PT,
  executeExtendedMcpTool,
  isExtendedMcpTool,
  type McpToolDefinition,
} from "./valem-tecfag-mcp-write-tools";

// Tokens operacionais padrão (podem ser sobrescritos via variáveis de ambiente no Railway)
export const DEFAULT_MCP_TECFAG_TOKEN = "mcp_tf_8f4e2a9c1d7b6e3f5a0c2d4e8b1f7a3c";
export const DEFAULT_MCP_VALEM_TOKEN = "mcp_vl_3c7a1f8b4e2d0c5a3f6e7b1d9c2a4e8f";
export const DEFAULT_MCP_ADMIN_TOKEN = "mcp_admin_7d9e3b5c1a8f4e6d2b0c9a7e5f3d1b8c";

export const MCP_SERVER_INFO = {
  name: "valem-tecfag-mcp",
  version: "3.2.0",
};

export type McpAccessLevel = "read" | "read_write";

export function normalizeMcpAccessLevel(raw: unknown): McpAccessLevel {
  return raw === "read_write" ? "read_write" : "read";
}

export interface McpNamedKey {
  id: string;
  label: string;
  token: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  usageCount: number;
  active: boolean;
  accessLevel: McpAccessLevel;
}

export type McpAuditEventType = "query" | "action" | "connection" | "config_change";

export interface McpAuditLogEntry {
  id: string;
  timestamp: string;
  keyId: string;
  keyLabel: string;
  toolName: string;
  toolLabel: string;
  argumentsSummary: string;
  argumentsRaw: Record<string, unknown>;
  resultSummary: string;
  status: "success" | "error";
  latencyMs: number;
  eventType?: McpAuditEventType;
  transport?: string;
  clientName?: string;
  clientIp?: string;
  responseBytes?: number;
  responsePreview?: string;
}

export interface McpTenantSettings {
  tenantId: "tecfag" | "valem";
  enabled: boolean;
  primaryToken: string;
  primaryTokenUpdatedAt: string | null;
  primaryAccessLevel: McpAccessLevel;
  namedKeys: McpNamedKey[];
  auditLogs: McpAuditLogEntry[];
}

export interface McpAccessContext {
  authorized: boolean;
  lockedTenantId: "tecfag" | "valem" | null;
  defaultTenantId: "tecfag" | "valem";
  authMode: "token_tecfag" | "token_valem" | "token_admin" | "session" | "none";
  accessLevel?: McpAccessLevel;
  keyId?: string;
  keyLabel?: string;
  skipAuditLog?: boolean;
  clientIp?: string;
  userAgent?: string;
  clientName?: string;
  transport?: string;
  sessionId?: string;
}

interface McpActiveSession {
  sessionId: string;
  access: McpAccessContext;
  clientName?: string;
  sseController?: ReadableStreamDefaultController<Uint8Array>;
  createdAt: number;
  lastSeenAt: number;
}

const mcpSessions = new Map<string, McpActiveSession>();
const MCP_SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 horas
const MAX_AUDIT_LOGS = 500;
const tenantWriteLocks = new Map<string, Promise<unknown>>();

function withTenantSettingsLock<T>(
  tenantId: "tecfag" | "valem",
  task: () => Promise<T>,
): Promise<T> {
  const prev = tenantWriteLocks.get(tenantId) || Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  tenantWriteLocks.set(
    tenantId,
    next.catch(() => undefined),
  );
  return next;
}

function cleanupExpiredMcpSessions(): void {
  const now = Date.now();
  for (const [id, session] of mcpSessions.entries()) {
    if (now - session.lastSeenAt > MCP_SESSION_TTL_MS) {
      mcpSessions.delete(id);
    }
  }
}

export function registerMcpSession(
  sessionId: string,
  access: McpAccessContext,
  clientName?: string,
): void {
  if (!sessionId) return;
  cleanupExpiredMcpSessions();
  const existing = mcpSessions.get(sessionId);
  mcpSessions.set(sessionId, {
    sessionId,
    access: { ...access, sessionId },
    clientName: clientName || existing?.clientName || access.clientName,
    sseController: existing?.sseController,
    createdAt: existing?.createdAt || Date.now(),
    lastSeenAt: Date.now(),
  });
}

export function updateMcpSessionClient(sessionId: string, clientName: string): void {
  if (!sessionId || !clientName) return;
  const existing = mcpSessions.get(sessionId);
  if (existing) {
    existing.clientName = clientName;
    existing.access.clientName = clientName;
    existing.lastSeenAt = Date.now();
  }
}

export function getMcpSession(sessionId: string): McpActiveSession | undefined {
  if (!sessionId) return undefined;
  cleanupExpiredMcpSessions();
  const existing = mcpSessions.get(sessionId);
  if (existing) {
    existing.lastSeenAt = Date.now();
  }
  return existing;
}

export function attachMcpSseController(
  sessionId: string,
  access: McpAccessContext,
  controller: ReadableStreamDefaultController<Uint8Array>,
): void {
  if (!sessionId) return;
  cleanupExpiredMcpSessions();
  const existing = mcpSessions.get(sessionId);
  mcpSessions.set(sessionId, {
    sessionId,
    access: { ...access, sessionId },
    clientName: existing?.clientName || access.clientName,
    sseController: controller,
    createdAt: existing?.createdAt || Date.now(),
    lastSeenAt: Date.now(),
  });
}

export function pushMcpSseMessage(sessionId: string, payload: unknown): boolean {
  if (!sessionId || payload === null || payload === undefined) return false;
  const session = mcpSessions.get(sessionId);
  if (!session?.sseController) return false;
  try {
    const encoder = new TextEncoder();
    session.sseController.enqueue(
      encoder.encode(`event: message\ndata: ${JSON.stringify(payload)}\n\n`),
    );
    session.lastSeenAt = Date.now();
    return true;
  } catch {
    return false;
  }
}

export function closeMcpSession(sessionId: string): void {
  if (!sessionId) return;
  const existing = mcpSessions.get(sessionId);
  if (existing?.sseController) {
    try {
      existing.sseController.close();
    } catch {
      // ignore
    }
  }
  mcpSessions.delete(sessionId);
}

/**
 * Derruba imediatamente todas as sessões MCP / conexões SSE ativas em memória
 * de um tenant (ou de uma chave específica `keyId` quando revogada/rotacionada).
 */
export function revokeMcpSessions(
  tenantId: "tecfag" | "valem",
  keyId?: string,
): number {
  let revokedCount = 0;
  for (const [id, session] of mcpSessions.entries()) {
    const sessionTenant = session.access.lockedTenantId || session.access.defaultTenantId;
    if (sessionTenant !== tenantId) continue;
    if (keyId && session.access.keyId !== keyId) continue;
    if (session.sseController) {
      try {
        session.sseController.close();
      } catch {
        // ignore
      }
    }
    mcpSessions.delete(id);
    revokedCount += 1;
  }
  return revokedCount;
}

const TOOL_LABELS_PT: Record<string, string> = {
  search_conversations: "Busca de Conversas",
  get_conversation_messages: "Mensagens da Conversa",
  get_fagner_triage_overview: "Panorama da Triagem IA",
  get_fagner_triage_history: "Histórico da Triagem IA",
  search_crm_deals: "Pesquisa de Negociações (CRM)",
  get_crm_deal_details: "Ficha 360º da Negociação",
  search_crm_accounts: "Empresas & Receita Federal",
  search_contacts: "Busca de Contatos",
  get_sales_and_commercial_metrics: "Métricas de Vendas & Meta",
  get_rodizio_and_operators_status: "Escala do Rodízio & Operadores",
  mcp_initialize: "Conexão Inicializada (Handshake MCP)",
  mcp_tools_list: "Sincronização de Ferramentas (tools/list)",
  mcp_sse_connect: "Conexão SSE Aberta (Link Único)",
  mcp_http_inspect: "Verificação / Acesso ao Link Único (GET)",
  mcp_auth_rejected: "Tentativa Bloqueada (Link Revogado / Inválido)",
  get_marketing_audit_batch: "Auditoria de Marketing em Lote (15–50 Leads)",
  config_toggle_enabled: "Alteração de Status do Conector",
  config_rotate_primary_token: "Rotação do Link Único Principal",
  config_restore_default_token: "Restauração do Link Oficial Padrão",
  config_create_named_key: "Criação de Link Individual",
  config_toggle_named_key: "Alteração de Status de Link Individual",
  config_delete_named_key: "Revogação de Link Individual",
  config_set_primary_access_level: "Alteração de Permissão do Link Principal",
  config_set_named_key_access_level: "Alteração de Permissão de Link Individual",
  config_clear_audit_logs: "Limpeza do Histórico de Auditoria",
  ...MCP_EXTENDED_TOOL_LABELS_PT,
};

export function inferMcpAuditEventType(toolName: string, rawType?: unknown): McpAuditEventType {
  if (
    rawType === "query" ||
    rawType === "action" ||
    rawType === "connection" ||
    rawType === "config_change"
  ) {
    return rawType;
  }
  if (toolName.startsWith("config_")) return "config_change";
  if (toolName.startsWith("mcp_")) return "connection";
  if (isWriteMcpTool(toolName)) return "action";
  return "query";
}

export function formatMcpToolLabel(toolName: string): string {
  return TOOL_LABELS_PT[toolName] || toolName;
}

export function detectMcpClientName(request: Request): string {
  const url = new URL(request.url);
  const explicit =
    request.headers.get("x-mcp-client-name") ||
    url.searchParams.get("client") ||
    url.searchParams.get("clientName") ||
    "";
  if (explicit.trim()) return explicit.trim();

  const ua = (request.headers.get("user-agent") || "").trim();
  if (!ua) return "Cliente MCP";
  const lower = ua.toLowerCase();
  if (lower.includes("claude")) return "Claude (Anthropic)";
  if (lower.includes("antigravity")) return "Antigravity IDE";
  if (lower.includes("cursor")) return "Cursor IDE";
  if (lower.includes("windsurf")) return "Windsurf IDE";
  if (lower.includes("mcp-remote") || lower.includes("modelcontextprotocol")) return "MCP Client";
  if (lower.includes("openai") || lower.includes("chatgpt")) return "OpenAI / ChatGPT";
  if (lower.includes("node") || lower.includes("undici")) return "Conector Node / MCP";
  if (lower.includes("mozilla") || lower.includes("chrome") || lower.includes("safari")) {
    return "Navegador Web";
  }
  return ua.length > 48 ? `${ua.slice(0, 45)}...` : ua;
}

export function extractRequestClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff && xff.trim()) {
    return xff.split(",")[0].trim();
  }
  const realIp =
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-client-ip");
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }
  return "direto";
}

export function summarizeMcpToolArguments(
  _toolName: string,
  args: Record<string, unknown>,
): string {
  const entries = Object.entries(args || {}).filter(
    ([k, v]) => k !== "tenantId" && v !== undefined && v !== null && String(v).trim() !== "",
  );
  if (entries.length === 0) {
    return "Consulta geral (padrão)";
  }
  return entries
    .map(([k, v]) => {
      const valStr = typeof v === "object" ? JSON.stringify(v) : String(v);
      return `${k}: ${valStr.length > 45 ? `${valStr.slice(0, 42)}...` : valStr}`;
    })
    .join(" · ");
}

export function summarizeMcpToolResult(toolName: string, data: any): string {
  if (!data || typeof data !== "object") return "Resposta concluída";
  try {
    switch (toolName) {
      case "search_conversations": {
        const count = Number(data.totalReturned ?? 0);
        const first = data.conversations?.[0]?.clientName;
        return first
          ? `${count} conversa(s) retornada(s) (ex: ${first})`
          : `${count} conversa(s) retornada(s)`;
      }
      case "get_conversation_messages": {
        const client = data.conversation?.clientName || data.conversation?.id || "Conversa";
        const msgs = Number(data.totalMessagesReturned ?? 0);
        return `Conversa de "${client}" (${msgs} mensagens lidas)`;
      }
      case "get_fagner_triage_overview": {
        const total = Number(data.summary?.totalConversations ?? 0);
        const auto = Number(data.summary?.inAutomationNow ?? 0);
        const transf = Number(data.summary?.transferredCount ?? 0);
        return `${total} triagens analisadas (${auto} em automação, ${transf} transferidas)`;
      }
      case "get_fagner_triage_history": {
        const client = data.conversation?.clientName || data.conversation?.id || "Cliente";
        const cycles = Number(data.totalCycles ?? 0);
        return `Histórico de "${client}" (${cycles} ciclo(s) de triagem)`;
      }
      case "search_crm_deals": {
        const count = Number(data.summary?.totalReturned ?? 0);
        const sum = Number(data.summary?.sumReturnedValue ?? 0);
        return `${count} negociação(ões) · R$ ${sum.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
      }
      case "get_crm_deal_details": {
        const title = data.deal?.title || data.deal?.id || "Card";
        const val = Number(data.deal?.value ?? 0);
        return `Card "${title}" (R$ ${val.toLocaleString("pt-BR", { minimumFractionDigits: 2 })})`;
      }
      case "search_crm_accounts": {
        if (data.account) {
          return `Ficha da empresa "${data.account.name}" (${data.account.document || "sem doc"})`;
        }
        const count = Number(data.totalReturned ?? 0);
        const first = data.accounts?.[0]?.name;
        return first
          ? `${count} empresa(s) encontrada(s) (ex: ${first})`
          : `${count} empresa(s) encontrada(s)`;
      }
      case "search_contacts": {
        const count = Number(data.totalReturned ?? 0);
        const first = data.contacts?.[0]?.name;
        return first
          ? `${count} contato(s) encontrado(s) (ex: ${first})`
          : `${count} contato(s) encontrado(s)`;
      }
      case "get_sales_and_commercial_metrics": {
        const month = data.month || "";
        const won = Number(data.executiveSummary?.closedWonDealsCount ?? 0);
        const rev = Number(data.executiveSummary?.totalClosedRevenue ?? 0);
        return `Mês ${month}: ${won} vendas ganhas (R$ ${rev.toLocaleString("pt-BR", { minimumFractionDigits: 2 })})`;
      }
      case "get_rodizio_and_operators_status": {
        const online = Number(data.summary?.onlineOperators ?? 0);
        const total = Number(data.summary?.totalOperators ?? 0);
        return `${online}/${total} operadores online · escala e setores lidos`;
      }
      case "list_meta_templates": {
        const total = Number(data.total ?? data.templates?.length ?? 0);
        return `${total} template(s) Meta listado(s)`;
      }
      case "create_crm_deal":
        return `Negociação "${data.title || data.dealId}" criada na etapa "${data.stageName || data.stageId}" (${data.dealId})`;
      case "update_crm_deal_stage":
        return `Negociação ${data.dealId} movida para etapa "${data.stageName || data.stageId}"`;
      case "update_crm_deal_owner":
        return `Negociação ${data.dealId} atribuída para ${data.operatorName || data.operatorId}`;
      case "mark_deal_won":
        return `Negociação ${data.dealId} marcada como GANHA`;
      case "mark_deal_lost":
        return `Negociação ${data.dealId} marcada como PERDIDA (${data.lossReason || "sem motivo"})`;
      case "create_contact":
        return data.deduplicated
          ? `Contato existente reutilizado: "${data.name}" (${data.contactId})`
          : `Contato "${data.name}" criado (${data.contactId})`;
      case "update_contact":
        return `Contato "${data.name || data.contactId}" atualizado (${data.contactId})`;
      case "create_account":
        return `Empresa/Conta "${data.name}" criada (${data.accountId})`;
      case "update_account":
        return `Empresa/Conta "${data.name || data.accountId}" atualizada (${data.accountId})`;
      case "create_task":
        return `Tarefa "${data.title}" criada (${data.taskId})`;
      case "update_task":
        return `Tarefa "${data.title || data.taskId}" atualizada → status: ${data.status || "alterado"}`;
      case "chat_send_message":
        return `Mensagem enviada via ${data.channel || "whatsapp"} na conversa ${data.conversationId} (${data.messageId})`;
      case "chat_add_internal_note":
        return `Nota interna registrada na conversa ${data.conversationId} (${data.messageId})`;
      case "chat_transfer_conversation":
        return `Conversa ${data.conversationId} transferida para ${data.operatorName || data.sectorName || data.queueState} (${data.queueState})`;
      case "chat_close_conversation":
        return `Conversa ${data.conversationId} finalizada (v${data.version ?? ""})`;
      case "create_conversation":
        return `Conversa ${data.conversationId} ${data.reopened ? "reaberta" : "criada"} (${data.queueState})`;
      case "update_meta_template_visibility":
        return `Visibilidade do template "${data.name || data.templateId}" atualizada (${data.allPipelines ? "todos os funis" : `${data.pipelineIds?.length ?? 0} funil(is) · ${data.stageIds?.length ?? 0} etapa(s)`})`;
      case "create_meta_template":
        return `Template Meta "${data.template?.name || ""}" submetido para aprovação`;
      case "send_meta_template":
        return `Template Meta "${data.templateName}" enviado na conversa ${data.conversationId} (${data.messageId})`;
      case "create_quick_response":
        return `Resposta rápida "${data.shortcut}" criada (${data.quickResponseId})`;
      case "delete_quick_response":
        return `Resposta rápida "${data.shortcut || data.deletedId}" excluída`;
      case "update_sector":
        return `Setor "${data.name || data.sectorId}" atualizado (${Array.isArray(data.operatorIds) ? `${data.operatorIds.length} operadores` : "dados alterados"})`;
      case "list_crm_pipelines": {
        const pipes = Number(data.totalPipelines ?? data.pipelines?.length ?? 0);
        const stages = Number(data.totalStages ?? 0);
        return `${pipes} funil(is) e ${stages} etapa(s) listado(s)`;
      }
      case "list_operators": {
        const ops = Number(data.totalOperators ?? data.operators?.length ?? 0);
        const secs = Number(data.totalSectors ?? data.sectors?.length ?? 0);
        return `${ops} operador(es) e ${secs} setor(es) listado(s)`;
      }
      case "update_crm_deal": {
        const fields = Array.isArray(data.updatedFields) ? data.updatedFields.join(", ") : "campos";
        return `Negociação ${data.dealId} atualizada (${fields})`;
      }
      case "merge_contacts":
        return `Contato ${data.mergedSourceContactId} mesclado em "${data.contact?.name || data.targetContactId}" (${data.targetContactId})`;
      case "replace_crm_deal_contact":
        return `Contato do card ${data.dealId} trocado para "${data.newContactName || data.newContactId}"`;
      case "archive_crm_deal": {
        const detached = Array.isArray(data.detachedConversationIds) ? data.detachedConversationIds.length : 0;
        return data.mode === "delete_permanent"
          ? `Negociação ${data.dealId} excluída definitivamente${detached > 0 ? ` (${detached} conversa(s) preservada(s))` : ""} (${data.reason || "sem motivo"})`
          : `Negociação ${data.dealId} arquivada na Lixeira (${data.reason || "sem motivo"})`;
      }
      case "get_deal_conversations":
        return `Vínculos consultados (${Number(data.totalConversations ?? 0)} conversa(s), ${Number(data.totalDeals ?? 0)} card(s))`;
      case "link_conversation_deal":
        return `Conversa ${data.conversationId} vinculada ao card ${data.dealId}`;
      case "unlink_conversation_deal":
        return `Conversa ${data.conversationId} desvinculada do card ${data.dealId}`;
      case "reassign_conversation_contact":
        return `Contato da conversa ${data.conversationId} trocado para "${data.newContactName || data.newContactId}"`;
      case "batch_upsert_crm_deals":
        return `Lote de ${Number(data.totalItems ?? 0)} item(ns): ${Number(data.createdCount ?? 0)} criados, ${Number(data.updatedCount ?? 0)} atualizados, ${Number(data.replayedCount ?? 0)} idempotentes, ${Number(data.errorCount ?? 0)} erros`;
      case "chat_send_media":
        return `Mídia (${data.mediaType || "arquivo"}) enviada na conversa ${data.conversationId} (${data.messageId})`;
      case "list_crm_products":
        return `${Number(data.totalProducts ?? 0)} produto(s) do catálogo listado(s)`;
      case "add_deal_product":
        return `Produto adicionado ao card ${data.dealId} (novo total: R$ ${data.dealTotalValue ?? "0.00"})`;
      case "remove_deal_product":
        return `Produto ${data.removedDealProductId} removido do card ${data.dealId}`;
      case "create_deal_proposal":
        return `Proposta ${data.proposalNumber || data.proposalId} criada no card ${data.dealId}`;
      case "list_deal_proposals":
        return `${Number(data.totalProposals ?? 0)} proposta(s) listada(s) no card ${data.dealId}`;
      case "list_webhook_subscriptions":
        return `${Number(data.totalSubscriptions ?? 0)} subscrição(ões) de webhook listada(s)`;
      case "upsert_webhook_subscription":
        return `Webhook (${data.action}) "${data.name || data.subscriptionId || data.deletedSubscriptionId}" aplicado`;
      case "list_webhook_deliveries":
        return `${Number(data.totalDeliveries ?? 0)} entrega(s) de webhook consultada(s)`;
      case "retry_webhook_delivery":
        return `Reenvio da entrega ${data.deliveryId}: status ${data.status} (HTTP ${data.statusCode ?? "N/A"})`;
      case "set_conversation_triage_mode":
        return `Triagem da conversa ${data.conversationId} alterada (${data.action} → fila ${data.queueState})`;
      case "get_triage_summary":
        return `Triagem da conversa ${data.conversationId}: ${data.isAiActive ? "IA ativa" : data.isPaused ? "IA pausada" : "manual"} (${data.queueState})`;
      case "update_triage_summary":
        return `Resumo de triagem salvo na conversa ${data.conversationId} (${data.currentStep || "atualizado"})`;
      case "list_knowledge_folders":
        return `${Number(data.totalFolders ?? 0)} pasta(s) e ${Number(data.totalFilesInTenant ?? 0)} arquivo(s) no Knowledge`;
      case "search_knowledge_files":
        return `${Number(data.returnedCount ?? 0)} de ${Number(data.totalMatched ?? 0)} arquivo(s) do Knowledge retornado(s)`;
      case "get_knowledge_file_content":
        return `Arquivo "${data.name || data.fileId}" lido (${Number(data.returnedChars ?? 0)}/${Number(data.totalChars ?? 0)} chars)`;
      case "query_knowledge_rag":
        return `Contexto RAG retornado (${Number(data.returnedChars ?? 0)} chars para "${data.query || ""}")`;
      case "create_knowledge_folder": {
        const folder = data.folder as Record<string, unknown> | undefined;
        return data.reused
          ? `Pasta "${folder?.name || data.folderId}" já existia e foi reutilizada (${data.folderId})`
          : `Pasta "${folder?.name || data.folderId}" criada no Knowledge (${data.folderId})`;
      }
      case "update_knowledge_folder": {
        const folder = data.folder as Record<string, unknown> | undefined;
        return `Pasta "${folder?.name || data.folderId}" atualizada no Knowledge (${data.folderId})`;
      }
      case "delete_knowledge_folder":
        return `Pasta "${data.deletedFolderName || data.deletedFolderId}" removida (${data.mode || "empty"}, ${Number(data.deletedFilesCount ?? 0)} arquivo(s) excluído(s))`;
      case "upsert_knowledge_file": {
        const file = data.file as Record<string, unknown> | undefined;
        return data.updated
          ? `Arquivo "${file?.name || data.fileId}" atualizado no Knowledge (${data.fileId})`
          : `Arquivo "${file?.name || data.fileId}" inserido no Knowledge (${data.fileId})`;
      }
      case "update_knowledge_file": {
        const file = data.file as Record<string, unknown> | undefined;
        const fields = Array.isArray(data.updatedFields) ? data.updatedFields.join(", ") : "editado";
        return `Arquivo "${file?.name || data.fileId}" editado no Knowledge (${fields || "ok"})`;
      }
      case "delete_knowledge_file":
        return `${Number(data.deletedCount ?? 0)} arquivo(s) removido(s) do Knowledge`;
      case "get_stage_rules": {
        const stageName = (data.stage as Record<string, unknown> | undefined)?.name || "";
        const reqCount = Number((data.requiredFields as Record<string, unknown> | undefined)?.count ?? 0);
        const tplCount = Number((data.metaTemplates as Record<string, unknown> | undefined)?.count ?? 0);
        const lossCount = Number((data.lossReasons as Record<string, unknown> | undefined)?.count ?? 0);
        return `Regras de "${stageName}": ${reqCount} campo(s) obrigatório(s), ${lossCount} motivo(s) de perda, ${tplCount} template(s)`;
      }
      case "validate_deal_stage_transition":
        return `Pré-validação do card ${data.dealId} → "${data.targetStageName}": ${Number(data.missingFieldsCount ?? 0)} campo(s) faltando, ${Number(data.overdueActivitiesCount ?? 0)} tarefa(s) atrasada(s)`;
      case "check_operator_schedule_conflict":
        return data.hasConflict
          ? `Conflito detectado para ${data.operatorName || data.operatorId}: ${Number(data.conflictCount ?? 0)} atividade(s) no horário`
          : `Agenda livre para ${data.operatorName || data.operatorId} no horário consultado`;
      case "get_stage_queue": {
        const stageName = (data.stage as Record<string, unknown> | undefined)?.name || "";
        return `Fila "${stageName}": ${Number(data.totalOpenInStage ?? 0)} aberto(s), ${Number(data.breachedCount ?? 0)} acima de ${Number(data.slaMinutes ?? 15)} min`;
      }
      case "get_deal_audit_log":
        return `Auditoria do card ${data.dealId}: ${Number(data.returnedEvents ?? 0)}/${Number(data.totalEvents ?? 0)} evento(s), ${Number(data.adminActionsCount ?? 0)} ação(ões) administrativa(s)`;
      default:
        return "Dados retornados com sucesso";
    }
  } catch {
    return "Dados retornados com sucesso";
  }
}

function safeCompareToken(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const bufA = Buffer.from(provided.trim(), "utf8");
  const bufB = Buffer.from(expected.trim(), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function generateMcpTokenForTenant(tenantId: "tecfag" | "valem"): string {
  const prefix = tenantId === "valem" ? "mcp_vl_" : "mcp_tf_";
  return `${prefix}${crypto.randomBytes(16).toString("hex")}`;
}

export function getDefaultPrimaryToken(tenantId: "tecfag" | "valem"): string {
  if (tenantId === "valem") {
    return (process.env.MCP_VALEM_TOKEN || DEFAULT_MCP_VALEM_TOKEN).trim();
  }
  return (process.env.MCP_TECFAG_TOKEN || DEFAULT_MCP_TECFAG_TOKEN).trim();
}

export async function getMcpTenantSettings(
  tenantId: "tecfag" | "valem",
): Promise<McpTenantSettings> {
  const defaultToken = getDefaultPrimaryToken(tenantId);
  try {
    const rows = await defaultSqlClient<
      Array<{ enabled: number; config: Record<string, unknown> | null; updated_at: Date | string | null }>
    >`
      SELECT enabled, config, updated_at
      FROM agent_configs
      WHERE tenant_id = ${tenantId}
        AND agent_type = 'mcp'
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    if (!rows.length) {
      return {
        tenantId,
        enabled: true,
        primaryToken: defaultToken,
        primaryTokenUpdatedAt: null,
        primaryAccessLevel: "read",
        namedKeys: [],
        auditLogs: [],
      };
    }
    const row = rows[0];
    let parsedCfg: unknown = row.config;
    if (typeof parsedCfg === "string") {
      try {
        parsedCfg = JSON.parse(parsedCfg);
      } catch {
        parsedCfg = {};
      }
    }
    const cfg =
      parsedCfg && typeof parsedCfg === "object" && !Array.isArray(parsedCfg)
        ? (parsedCfg as Record<string, unknown>)
        : {};
    const primaryToken =
      typeof cfg.primaryToken === "string" && cfg.primaryToken.trim()
        ? cfg.primaryToken.trim()
        : defaultToken;
    const primaryTokenUpdatedAt =
      typeof cfg.primaryTokenUpdatedAt === "string" ? cfg.primaryTokenUpdatedAt : null;
    const primaryAccessLevel = normalizeMcpAccessLevel(cfg.primaryAccessLevel);
    const rawKeys = Array.isArray(cfg.namedKeys) ? cfg.namedKeys : [];
    const namedKeys: McpNamedKey[] = rawKeys
      .filter((k): k is Record<string, unknown> => Boolean(k && typeof k === "object"))
      .map((k) => ({
        id: String(k.id || ""),
        label: String(k.label || "Link de Acesso"),
        token: String(k.token || ""),
        createdBy: String(k.createdBy || "Admin"),
        createdAt: String(k.createdAt || new Date().toISOString()),
        lastUsedAt: typeof k.lastUsedAt === "string" ? k.lastUsedAt : null,
        usageCount: Number(k.usageCount || 0),
        active: k.active !== false,
        accessLevel: normalizeMcpAccessLevel(k.accessLevel),
      }))
      .filter((k) => Boolean(k.id && k.token));

    const rawLogs = Array.isArray(cfg.auditLogs) ? cfg.auditLogs : [];
    const auditLogs: McpAuditLogEntry[] = rawLogs
      .filter((l): l is Record<string, unknown> => Boolean(l && typeof l === "object"))
      .map((l) => {
        const toolName = String(l.toolName || "");
        return {
          id: String(l.id || ""),
          timestamp: String(l.timestamp || new Date().toISOString()),
          keyId: String(l.keyId || "primary"),
          keyLabel: String(l.keyLabel || "Link Principal"),
          toolName,
          toolLabel: String(l.toolLabel || formatMcpToolLabel(toolName)),
          argumentsSummary: String(l.argumentsSummary || "Consulta geral"),
          argumentsRaw:
            l.argumentsRaw && typeof l.argumentsRaw === "object" && !Array.isArray(l.argumentsRaw)
              ? (l.argumentsRaw as Record<string, unknown>)
              : {},
          resultSummary: String(l.resultSummary || ""),
          status: l.status === "error" ? ("error" as const) : ("success" as const),
          latencyMs: Number(l.latencyMs || 0),
          eventType: inferMcpAuditEventType(toolName, l.eventType),
          transport: typeof l.transport === "string" ? l.transport : undefined,
          clientName: typeof l.clientName === "string" ? l.clientName : undefined,
          clientIp: typeof l.clientIp === "string" ? l.clientIp : undefined,
          responseBytes: typeof l.responseBytes === "number" ? l.responseBytes : undefined,
          responsePreview: typeof l.responsePreview === "string" ? l.responsePreview : undefined,
        };
      })
      .filter((l) => Boolean(l.id && l.toolName));

    return {
      tenantId,
      enabled: row.enabled !== 0,
      primaryToken,
      primaryTokenUpdatedAt,
      primaryAccessLevel,
      namedKeys,
      auditLogs,
    };
  } catch (err) {
    console.error(`[MCP Config] Erro ao carregar configurações do tenant ${tenantId}:`, err);
    return {
      tenantId,
      enabled: true,
      primaryToken: defaultToken,
      primaryTokenUpdatedAt: null,
      primaryAccessLevel: "read",
      namedKeys: [],
      auditLogs: [],
    };
  }
}

async function persistMcpTenantSettingsUnlocked(
  tenantId: "tecfag" | "valem",
  settings: {
    enabled: boolean;
    primaryToken: string;
    primaryTokenUpdatedAt: string | null;
    primaryAccessLevel?: McpAccessLevel;
    namedKeys: McpNamedKey[];
    auditLogs?: McpAuditLogEntry[];
  },
): Promise<McpTenantSettings> {
  const defaultRowId = `mcp-config-${tenantId}`;
  const enabledInt = settings.enabled ? 1 : 0;
  const previousSettings =
    !Array.isArray(settings.auditLogs) || settings.primaryAccessLevel === undefined
      ? await getMcpTenantSettings(tenantId)
      : null;
  const currentAuditLogs = Array.isArray(settings.auditLogs)
    ? settings.auditLogs.slice(0, MAX_AUDIT_LOGS)
    : (previousSettings?.auditLogs || []).slice(0, MAX_AUDIT_LOGS);
  const primaryAccessLevel = normalizeMcpAccessLevel(
    settings.primaryAccessLevel ?? previousSettings?.primaryAccessLevel,
  );
  const normalizedNamedKeys: McpNamedKey[] = settings.namedKeys.map((k) => ({
    ...k,
    accessLevel: normalizeMcpAccessLevel(k.accessLevel),
  }));

  const configJson = {
    primaryToken: settings.primaryToken,
    primaryTokenUpdatedAt: settings.primaryTokenUpdatedAt,
    primaryAccessLevel,
    namedKeys: normalizedNamedKeys,
    auditLogs: currentAuditLogs,
  };
  const serializedConfig = JSON.stringify(configJson);

  const existing = await defaultSqlClient<Array<{ id: string }>>`
    SELECT id FROM agent_configs
    WHERE tenant_id = ${tenantId} AND agent_type = 'mcp'
    ORDER BY updated_at DESC
    LIMIT 1
  `;

  const targetId = existing[0]?.id || defaultRowId;

  await defaultSqlClient`
    INSERT INTO agent_configs (id, tenant_id, agent_type, enabled, config, created_at, updated_at)
    VALUES (
      ${targetId},
      ${tenantId},
      'mcp',
      ${enabledInt},
      ${serializedConfig}::jsonb,
      NOW(),
      NOW()
    )
    ON CONFLICT (id) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        config = EXCLUDED.config,
        updated_at = NOW()
  `;

  return {
    tenantId,
    enabled: settings.enabled,
    primaryToken: settings.primaryToken,
    primaryTokenUpdatedAt: settings.primaryTokenUpdatedAt,
    primaryAccessLevel,
    namedKeys: normalizedNamedKeys,
    auditLogs: currentAuditLogs,
  };
}

export async function saveMcpTenantSettings(
  tenantId: "tecfag" | "valem",
  settings: {
    enabled: boolean;
    primaryToken: string;
    primaryTokenUpdatedAt: string | null;
    primaryAccessLevel?: McpAccessLevel;
    namedKeys: McpNamedKey[];
    auditLogs?: McpAuditLogEntry[];
  },
): Promise<McpTenantSettings> {
  return withTenantSettingsLock(tenantId, () =>
    persistMcpTenantSettingsUnlocked(tenantId, settings),
  );
}

export async function recordMcpToolAuditLog(params: {
  tenantId: "tecfag" | "valem";
  access?: McpAccessContext;
  toolName: string;
  toolLabel?: string;
  toolArgs: Record<string, unknown>;
  argumentsSummary?: string;
  resultSummary: string;
  status: "success" | "error";
  latencyMs: number;
  eventType?: McpAuditEventType;
  transport?: string;
  clientName?: string;
  clientIp?: string;
  responseBytes?: number;
  responsePreview?: string;
}): Promise<void> {
  if (params.access?.skipAuditLog) return;
  await withTenantSettingsLock(params.tenantId, async () => {
    try {
      const current = await getMcpTenantSettings(params.tenantId);
      const nowIso = new Date().toISOString();
      const keyId = params.access?.keyId || "primary";
      const keyLabel =
        params.access?.keyLabel ||
        (params.tenantId === "valem" ? "Link Principal (Valem)" : "Link Principal (Tecfag)");
      const eventType = inferMcpAuditEventType(params.toolName, params.eventType);

      const newEntry: McpAuditLogEntry = {
        id: `mcp-log-${crypto.randomBytes(6).toString("hex")}`,
        timestamp: nowIso,
        keyId,
        keyLabel,
        toolName: params.toolName,
        toolLabel: params.toolLabel || formatMcpToolLabel(params.toolName),
        argumentsSummary:
          params.argumentsSummary || summarizeMcpToolArguments(params.toolName, params.toolArgs),
        argumentsRaw: params.toolArgs || {},
        resultSummary: params.resultSummary,
        status: params.status,
        latencyMs: params.latencyMs,
        eventType,
        transport: params.transport || params.access?.transport || "HTTP JSON-RPC",
        clientName: params.clientName || params.access?.clientName || "Cliente MCP",
        clientIp: params.clientIp || params.access?.clientIp || "direto",
        responseBytes: params.responseBytes,
        responsePreview: params.responsePreview,
      };

      const shouldIncrementKeyUsage =
        eventType === "query" || eventType === "action" || params.toolName === "mcp_initialize";
      const updatedKeys = current.namedKeys.map((k) =>
        k.id === keyId
          ? {
              ...k,
              lastUsedAt: nowIso,
              usageCount: shouldIncrementKeyUsage ? (k.usageCount || 0) + 1 : k.usageCount || 0,
            }
          : k,
      );

      const updatedLogs = [newEntry, ...current.auditLogs].slice(0, MAX_AUDIT_LOGS);

      await persistMcpTenantSettingsUnlocked(params.tenantId, {
        enabled: current.enabled,
        primaryToken: current.primaryToken,
        primaryTokenUpdatedAt: current.primaryTokenUpdatedAt,
        primaryAccessLevel: current.primaryAccessLevel,
        namedKeys: updatedKeys,
        auditLogs: updatedLogs,
      });
    } catch (err) {
      console.error("[MCP Audit] Erro ao persistir log de auditoria:", err);
    }
  });
}

/**
 * Valida o acesso à rota /api/mcp via Token de Conector (query ?token=, Header Bearer ou x-mcp-token),
 * via Session ID MCP já autenticada (Mcp-Session-Id / ?sessionId=),
 * ou via Sessão Autenticada do servidor (requireSession).
 * Quando um token escopado por tenant é usado (ex: Tecfag), trava o tenantId no servidor
 * para garantir 100% de isolamento multi-tenant.
 */
export async function resolveMcpAccess(request: Request): Promise<McpAccessContext> {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token") || url.searchParams.get("apiKey") || "";
  const authHeader = request.headers.get("authorization") || "";
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const headerToken = request.headers.get("x-mcp-token") || "";
  const candidateToken = (queryToken || bearerToken || headerToken).trim();

  const sessionId = (
    request.headers.get("mcp-session-id") ||
    url.searchParams.get("sessionId") ||
    ""
  ).trim();
  const clientIp = extractRequestClientIp(request);
  const userAgent = (request.headers.get("user-agent") || "").trim();
  const detectedClientName = detectMcpClientName(request);
  const existingSession = sessionId ? getMcpSession(sessionId) : undefined;
  const effectiveClientName = existingSession?.clientName || detectedClientName;

  const finalizeAccess = (ctx: McpAccessContext): McpAccessContext => {
    const enriched: McpAccessContext = {
      ...ctx,
      clientIp,
      userAgent,
      clientName: effectiveClientName,
      sessionId: sessionId || undefined,
    };
    if (ctx.authorized && sessionId) {
      registerMcpSession(sessionId, enriched, effectiveClientName);
    }
    return enriched;
  };

  const adminTokens = [
    process.env.MCP_ACCESS_TOKEN,
    DEFAULT_MCP_ADMIN_TOKEN,
  ].filter((t): t is string => Boolean(t && t.trim()));

  if (candidateToken) {
    if (adminTokens.some((expected) => safeCompareToken(candidateToken, expected))) {
      return finalizeAccess({
        authorized: true,
        lockedTenantId: null,
        defaultTenantId: "tecfag",
        authMode: "token_admin",
        accessLevel: "read_write",
        keyId: "admin",
        keyLabel: "Admin Multi-Tenant",
      });
    }

    const [tecfagSettings, valemSettings] = await Promise.all([
      getMcpTenantSettings("tecfag"),
      getMcpTenantSettings("valem"),
    ]);

    if (tecfagSettings.enabled) {
      const tecfagPrimaryCandidates = [
        tecfagSettings.primaryToken,
        !tecfagSettings.primaryTokenUpdatedAt ? process.env.MCP_TECFAG_TOKEN : undefined,
      ].filter((t): t is string => Boolean(t && t.trim()));

      if (tecfagPrimaryCandidates.some((expected) => safeCompareToken(candidateToken, expected))) {
        return finalizeAccess({
          authorized: true,
          lockedTenantId: "tecfag",
          defaultTenantId: "tecfag",
          authMode: "token_tecfag",
          accessLevel: tecfagSettings.primaryAccessLevel,
          keyId: "primary",
          keyLabel: "Link Principal (Tecfag)",
        });
      }

      const matchedNamedKey = tecfagSettings.namedKeys.find(
        (k) => k.active && safeCompareToken(candidateToken, k.token),
      );
      if (matchedNamedKey) {
        return finalizeAccess({
          authorized: true,
          lockedTenantId: "tecfag",
          defaultTenantId: "tecfag",
          authMode: "token_tecfag",
          accessLevel: matchedNamedKey.accessLevel,
          keyId: matchedNamedKey.id,
          keyLabel: matchedNamedKey.label,
        });
      }
    }

    if (valemSettings.enabled) {
      const valemPrimaryCandidates = [
        valemSettings.primaryToken,
        !valemSettings.primaryTokenUpdatedAt ? process.env.MCP_VALEM_TOKEN : undefined,
      ].filter((t): t is string => Boolean(t && t.trim()));

      if (valemPrimaryCandidates.some((expected) => safeCompareToken(candidateToken, expected))) {
        return finalizeAccess({
          authorized: true,
          lockedTenantId: "valem",
          defaultTenantId: "valem",
          authMode: "token_valem",
          accessLevel: valemSettings.primaryAccessLevel,
          keyId: "primary",
          keyLabel: "Link Principal (Valem)",
        });
      }

      const matchedNamedKey = valemSettings.namedKeys.find(
        (k) => k.active && safeCompareToken(candidateToken, k.token),
      );
      if (matchedNamedKey) {
        return finalizeAccess({
          authorized: true,
          lockedTenantId: "valem",
          defaultTenantId: "valem",
          authMode: "token_valem",
          accessLevel: matchedNamedKey.accessLevel,
          keyId: matchedNamedKey.id,
          keyLabel: matchedNamedKey.label,
        });
      }
    }

    // Token fornecido não é mais válido (revogado, rotacionado, pausado ou incorreto):
    // Registra tentativa bloqueada na auditoria para rastreabilidade de segurança.
    const rejectedTenant: "tecfag" | "valem" = candidateToken.startsWith("mcp_vl_")
      ? "valem"
      : "tecfag";
    const targetSettings = rejectedTenant === "valem" ? valemSettings : tecfagSettings;
    const pausedKey = targetSettings.namedKeys.find(
      (k) => !k.active && safeCompareToken(candidateToken, k.token),
    );
    const tokenPrefix = `${candidateToken.slice(0, 12)}...`;
    await recordMcpToolAuditLog({
      tenantId: rejectedTenant,
      toolName: "mcp_auth_rejected",
      toolLabel: "Tentativa Bloqueada (Link Revogado / Inválido)",
      eventType: "connection",
      toolArgs: {
        tokenPrefix,
        reason: !targetSettings.enabled
          ? "connector_disabled"
          : pausedKey
            ? "named_key_paused"
            : "token_revoked_or_invalid",
      },
      argumentsSummary: pausedKey
        ? `Link pausado ("${pausedKey.label}") · Token ${tokenPrefix}`
        : `Token revogado/antigo bloqueado (${tokenPrefix})`,
      resultSummary: !targetSettings.enabled
        ? "Acesso negado (401): Conector MCP está pausado"
        : pausedKey
          ? `Acesso negado (401): O link de "${pausedKey.label}" está pausado`
          : "Acesso negado (401): Este link único já foi revogado/substituído",
      status: "error",
      latencyMs: 0,
      transport: `${request.method} /api/mcp (Bloqueado)`,
      clientName: effectiveClientName,
      clientIp,
      responseBytes: 0,
      responsePreview: JSON.stringify(
        {
          blocked: true,
          status: 401,
          tokenPrefix,
          clientName: effectiveClientName,
          clientIp,
          reason: !targetSettings.enabled
            ? "Conector MCP desativado"
            : pausedKey
              ? `Link individual '${pausedKey.label}' pausado`
              : "Token antigo/revogado após rotação de chave",
        },
        null,
        2,
      ),
      access: {
        authorized: false,
        lockedTenantId: rejectedTenant,
        defaultTenantId: rejectedTenant,
        authMode: "none",
        keyId: pausedKey?.id || "revoked",
        keyLabel: pausedKey ? `${pausedKey.label} (Pausado)` : "Link Revogado / Antigo",
      },
    });

    if (sessionId) {
      closeMcpSession(sessionId);
    }

    return finalizeAccess({
      authorized: false,
      lockedTenantId: null,
      defaultTenantId: rejectedTenant,
      authMode: "none",
    });
  }

  // Se o cliente já autenticou a sessão MCP (via GET SSE ou POST initialize com token)
  // e enviou o sessionId nas chamadas seguintes, revalida se o conector/chave segue ativo
  // e sincroniza o nível de permissão (read vs read_write) ao vivo:
  if (!candidateToken && existingSession?.access.authorized) {
    const sessionTenant =
      existingSession.access.lockedTenantId || existingSession.access.defaultTenantId || "tecfag";
    const liveSettings = await getMcpTenantSettings(sessionTenant);
    const keyId = existingSession.access.keyId;
    const liveNamedKey = liveSettings.namedKeys.find((k) => k.id === keyId && k.active);
    const isStillValid =
      liveSettings.enabled &&
      (keyId === "admin" ||
        keyId === "session" ||
        keyId === "primary" ||
        Boolean(liveNamedKey));

    if (isStillValid) {
      const liveAccessLevel: McpAccessLevel =
        keyId === "admin"
          ? "read_write"
          : keyId === "primary"
            ? liveSettings.primaryAccessLevel
            : liveNamedKey
              ? liveNamedKey.accessLevel
              : normalizeMcpAccessLevel(existingSession.access.accessLevel);
      return finalizeAccess({
        ...existingSession.access,
        accessLevel: liveAccessLevel,
      });
    }
    closeMcpSession(sessionId);
  }

  // Fallback: sessão autenticada de operador logado no navegador
  const auth = await requireSession(request);
  if (!("response" in auth)) {
    const sessionTenant = auth.session.tenantId === "valem" ? "valem" : "tecfag";
    return finalizeAccess({
      authorized: true,
      lockedTenantId: sessionTenant,
      defaultTenantId: sessionTenant,
      authMode: "session",
      accessLevel: auth.session.operator.role === "admin" ? "read_write" : "read",
      keyId: "session",
      keyLabel: `Sessão Web (${auth.session.operator.name || "Operador"})`,
    });
  }

  return finalizeAccess({
    authorized: false,
    lockedTenantId: null,
    defaultTenantId: "tecfag",
    authMode: "none",
  });
}

function resolveEffectiveTenantId(
  requestedTenant: unknown,
  access?: McpAccessContext,
): "tecfag" | "valem" {
  // Se o token/sessão está travado em um tenant específico, ignora qualquer tentativa de troca
  if (access?.lockedTenantId) {
    return access.lockedTenantId;
  }
  const raw = String(requestedTenant || access?.defaultTenantId || "tecfag")
    .trim()
    .toLowerCase();
  if (raw !== "tecfag" && raw !== "valem") {
    throw new Error(`tenantId inválido ('${requestedTenant}'). Use 'tecfag' ou 'valem'.`);
  }
  return raw;
}

function clampLimit(raw: unknown, defaultLimit = 25, maxLimit = 100): number {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return defaultLimit;
  return Math.min(Math.floor(num), maxLimit);
}

function formatCnpjOrCpf(raw: unknown): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return String(raw);
}

function extractReceitaDetails(addressObj: unknown, fallbackDoc: unknown) {
  const addr =
    addressObj && typeof addressObj === "object" && !Array.isArray(addressObj)
      ? (addressObj as Record<string, any>)
      : {};
  return {
    cnpjFormatted: formatCnpjOrCpf(fallbackDoc || addr.cleanCnpj || addr.cnpjFormatted),
    razaoSocial: addr.razaoSocial || null,
    nomeFantasia: addr.nomeFantasia || null,
    situacaoCadastral: addr.situacaoCadastral || null,
    dataAbertura: addr.dataAbertura || null,
    porte: addr.porte || null,
    capitalSocial: addr.capitalSocial || null,
    naturezaJuridica: addr.naturezaJuridica || null,
    atividadePrincipal: addr.atividadePrincipal || null,
    atividadesSecundarias: addr.atividadesSecundarias || null,
    endereco: {
      logradouro: addr.street || addr.logradouro || null,
      numero: addr.number || addr.numero || null,
      complemento: addr.complement || addr.complemento || null,
      bairro: addr.neighborhood || addr.bairro || null,
      municipio: addr.city || addr.municipio || null,
      uf: addr.state || addr.uf || null,
      cep: addr.zipCode || addr.cep || null,
    },
    qsa: addr.qsa || null,
    consultedAt: addr.consultedAt || null,
  };
}

const MCP_READ_CORE_TOOLS_RAW = [
  {
    name: "search_conversations",
    description:
      "Busca e lista conversas/atendimentos do sistema (WhatsApp Meta, Baileys ou Site). Permite filtrar por termo de busca (nome do cliente, telefone, CNPJ ou texto da última mensagem), estado da fila ('automacao', 'fila', 'meus', 'finalizados') ou nome do operador.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: {
          type: "string",
          enum: ["tecfag", "valem"],
          default: "tecfag",
          description: "Tenant do sistema ('tecfag' ou 'valem'). Padrão: 'tecfag'.",
        },
        query: {
          type: "string",
          description:
            "Busca opcional por nome do contato, telefone, empresa, CNPJ ou trecho da última mensagem.",
        },
        queueState: {
          type: "string",
          enum: ["automacao", "fila", "meus", "finalizados"],
          description: "Filtra pelo estado atual da fila de atendimento.",
        },
        operatorName: {
          type: "string",
          description: "Filtra pelo nome do operador/vendedor responsável pela conversa.",
        },
        limit: {
          type: "number",
          default: 20,
          description: "Quantidade máxima de conversas retornadas (padrão 20, máx 100).",
        },
      },
    },
  },
  {
    name: "get_conversation_messages",
    description:
      "Retorna o histórico cronológico de mensagens e notas internas de uma conversa específica (conversationId), incluindo dados cadastrais do contato, empresa vinculada e negociações vinculadas.",
    inputSchema: {
      type: "object",
      required: ["conversationId"],
      properties: {
        tenantId: {
          type: "string",
          enum: ["tecfag", "valem"],
          default: "tecfag",
        },
        conversationId: {
          type: "string",
          description:
            "ID da conversa (ex: obtido via search_conversations ou get_fagner_triage_overview).",
        },
        includeInternalNotes: {
          type: "boolean",
          default: true,
          description: "Se true (padrão), inclui notas internas e resumos de triagem.",
        },
        limit: {
          type: "number",
          default: 60,
          description: "Quantidade de mensagens mais recentes a retornar (padrão 60, máx 200).",
        },
      },
    },
  },
  {
    name: "get_fagner_triage_overview",
    description:
      "Painel em tempo real das triagens da IA SDR (Fagner na Tecfag / Valentina na Valem). Mostra resumo de ciclos ativos, iniciados hoje, estado operacional de cada atendimento ('collecting', 'ready', 'waiting_for_team', 'handoff_pending', 'transferred', 'no_response', 'stopped', 'closed'), dados já coletados, máquina/funil decidido e diagnósticos de handoff.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: {
          type: "string",
          enum: ["tecfag", "valem"],
          default: "tecfag",
        },
        stateFilter: {
          type: "string",
          description:
            "Filtro opcional de estado (ex: 'collecting', 'ready', 'waiting_for_team', 'handoff_pending', 'transferred', 'no_response', 'stopped', 'closed').",
        },
        limit: {
          type: "number",
          default: 30,
          description: "Quantidade máxima de fluxos recentes detalhados (padrão 30, máx 100).",
        },
      },
    },
  },
  {
    name: "get_fagner_triage_history",
    description:
      "Inspeciona o Histórico da Triagem do Fagner/Valentina: se 'conversationId' for informado, retorna todos os ciclos de triagem daquela conversa, o briefing consolidado (campos coletados, funil de destino, máquina, vendedor sorteado, evidência VTEX, contexto do site e revisões humanas) e a linha do tempo de notas progressivas (journal). Se 'conversationId' for omitido, lista as conversas que passaram pela triagem.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: {
          type: "string",
          enum: ["tecfag", "valem"],
          default: "tecfag",
        },
        conversationId: {
          type: "string",
          description: "ID da conversa para inspecionar ciclos, briefing e notas progressivas.",
        },
        query: {
          type: "string",
          description:
            "Termo de busca por nome ou telefone quando conversationId não for informado.",
        },
        limit: {
          type: "number",
          default: 25,
        },
      },
    },
  },
  {
    name: "search_crm_deals",
    description:
      "Busca e filtra negociações (cards) no CRM local (crm_deals), excluindo automaticamente cards de teste (is_test=false por padrão). Permite filtrar por texto (título, empresa, CNPJ ou id_rd), funil (pipelineName), etapa (stageName), setor de origem/atual (sectorOrigin, sectorCurrent), origem de mídia (source / deal_source_name), ponto de conversão (campaign), campanha de mídia (utmCampaign), datas (createdFrom/To, wonFrom/To), vendedor (operatorName) e status ('open', 'won', 'lost', 'paused', 'closed_won_effective').",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: {
          type: "string",
          enum: ["tecfag", "valem"],
          default: "tecfag",
        },
        query: {
          type: "string",
          description:
            "Busca textual por título da negociação, ID do RD (id_rd), nome da empresa, CNPJ ou motivo de perda.",
        },
        idRd: {
          type: "string",
          description: "Filtra pelo ID original do card no RD Station CRM (id_rd / rd_deal_id).",
        },
        pipelineName: {
          type: "string",
          description:
            "Filtra pelo nome do funil (ex: 'FUNIL MÁQUINAS', 'FUNIL PERSONNALITÉ', 'FUNIL PEÇAS', 'FUNIL CWR', 'SDR').",
        },
        stageName: {
          type: "string",
          description: "Filtra pelo nome da etapa (ex: 'FECHAMENTO', 'PROPOSTA', 'QUALIFICAÇÃO').",
        },
        sectorOrigin: {
          type: "string",
          description:
            "Filtra pelo setor imutável de origem ('semi_industrial', 'personnalite', 'projetos', 'pecas', 'pre_venda', 'suporte_tecnico', 'externo', 'financeiro').",
        },
        sectorCurrent: {
          type: "string",
          description: "Filtra pelo setor atual da negociação.",
        },
        source: {
          type: "string",
          description: "Filtra pela origem de mídia (ex: 'Busca Paga | Google', 'Busca Paga | Meta').",
        },
        campaign: {
          type: "string",
          description: "Filtra pelo ponto de conversão (campaign_name, ex: 'CRM | Form Meta - Envasadora').",
        },
        utmCampaign: {
          type: "string",
          description: "Filtra pela campanha da mídia (utm_campaign).",
        },
        operatorName: {
          type: "string",
          description:
            "Filtra pelo nome do vendedor/consultor responsável (ex: 'Jhordan', 'Beatriz', 'Diana').",
        },
        status: {
          type: "string",
          enum: ["open", "won", "lost", "paused", "closed_won_effective"],
          description:
            "Status do card ('open', 'won', 'lost', 'paused') ou 'closed_won_effective' para vendas fechadas (status 'won' OU etapas 'FECHAMENTO' / 'VENDA CONCLUÍDA').",
        },
        createdFrom: {
          type: "string",
          description: "Data inicial de criação (YYYY-MM-DD ou ISO).",
        },
        createdTo: {
          type: "string",
          description: "Data final de criação (YYYY-MM-DD ou ISO).",
        },
        wonFrom: {
          type: "string",
          description: "Data inicial de ganho/fechamento (YYYY-MM-DD ou ISO).",
        },
        wonTo: {
          type: "string",
          description: "Data final de ganho/fechamento (YYYY-MM-DD ou ISO).",
        },
        includeTests: {
          type: "boolean",
          default: false,
          description: "Se true, inclui cards marcados como teste (is_test=true). Padrão: false.",
        },
        includeLegacy: {
          type: "boolean",
          default: true,
          description: "Se false, oculta os cards históricos arquivados do RD (is_legacy=true). Padrão: true.",
        },
        limit: {
          type: "number",
          default: 25,
          description: "Quantidade máxima de negociações (padrão 25, máx 100).",
        },
      },
    },
  },
  {
    name: "get_crm_deal_details",
    description:
      "Retorna a ficha completa 360º de uma negociação do CRM (dealId): dados do card, campos personalizados, empresa vinculada com dados da Receita Federal, contatos participantes, produtos/itens orçados, propostas comerciais, atividades/tarefas e conversas de WhatsApp vinculadas.",
    inputSchema: {
      type: "object",
      required: ["dealId"],
      properties: {
        tenantId: {
          type: "string",
          enum: ["tecfag", "valem"],
          default: "tecfag",
        },
        dealId: {
          type: "string",
          description: "ID da negociação (crm_deals.id).",
        },
      },
    },
  },
  {
    name: "search_crm_accounts",
    description:
      "Busca empresas/contas cadastradas no CRM (crm_accounts) por Razão Social, Nome Fantasia, CNPJ/CPF, segmento, cidade ou UF, ou retorna a ficha completa de uma empresa específica (accountId) com Dados da Receita Federal, contatos vinculados e negociações.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: {
          type: "string",
          enum: ["tecfag", "valem"],
          default: "tecfag",
        },
        accountId: {
          type: "string",
          description:
            "ID específico da empresa (crm_accounts.id) para ver todos os contatos e negociações dela.",
        },
        query: {
          type: "string",
          description:
            "Busca por Razão Social, Nome Fantasia, CNPJ/CPF, telefone, e-mail ou segmento.",
        },
        type: {
          type: "string",
          enum: ["company", "person"],
          description: "Filtra por PJ ('company') ou PF ('person').",
        },
        limit: {
          type: "number",
          default: 25,
        },
      },
    },
  },
  {
    name: "search_contacts",
    description:
      "Busca contatos/clientes individuais (contacts) por nome, telefone, WhatsApp, CNPJ/CPF ou e-mail, exibindo a empresa vinculada (crm_accounts), operador da carteira, conversa ativa e negociações.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: {
          type: "string",
          enum: ["tecfag", "valem"],
          default: "tecfag",
        },
        query: {
          type: "string",
          description: "Nome, telefone, CNPJ/CPF ou e-mail do contato.",
        },
        limit: {
          type: "number",
          default: 25,
        },
      },
    },
  },
  {
    name: "get_sales_and_commercial_metrics",
    description:
      "Retorna o consolidado executivo de Vendas, Metas, Pacing, Funis e Motivos de Perda (Commercial War Room / Visão de Diretoria). Reconcilia automaticamente vendas em etapas de 'FECHAMENTO' e operadores duplicados do RD Station.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: {
          type: "string",
          enum: ["tecfag", "valem"],
          default: "tecfag",
        },
        month: {
          type: "string",
          description:
            "Mês de competência no formato YYYY-MM (ex: '2026-10'). Se omitido, usa o mês atual BRT.",
        },
        division: {
          type: "string",
          enum: ["maquinas", "personnalite", "all"],
          default: "all",
          description: "Filtra divisão comercial ('maquinas', 'personnalite' ou 'all').",
        },
      },
    },
  },
  {
    name: "get_rodizio_and_operators_status",
    description:
      "Retorna o status atual dos operadores, setores, fila de atendimento e Escala Local do Rodízio (aba Fluxos do Fagner/Valentina: pastas Máquinas, Personnalité, Peças, Assistência Técnica, Pós-Venda e Financeiro, operadores ativos/em folga, compensações e leads distribuídos).",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: {
          type: "string",
          enum: ["tecfag", "valem"],
          default: "tecfag",
        },
      },
    },
  },
  {
    name: "get_marketing_audit_batch",
    description:
      "Auditoria qualitativa de Marketing & Atendimento em lote (15 a 50 negociações/leads): retorna em uma única chamada o card completo (com chaves de cruzamento, id_rd, deal_source_name, campaign_name, UTMs e setores), histórico linear de etapas, atividades comerciais, triagem do bot SDR e transcrição cronológica das conversas vinculadas.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: {
          type: "string",
          enum: ["tecfag", "valem"],
          default: "tecfag",
        },
        dealIds: {
          type: "array",
          items: { type: "string" },
          description: "Lista opcional de IDs específicos de negociações (máx 50).",
        },
        campaign: {
          type: "string",
          description: "Filtra pelo ponto de conversão (ex: 'CRM | Form Meta - Envasadora').",
        },
        utmCampaign: {
          type: "string",
          description: "Filtra pela campanha de mídia (utm_campaign).",
        },
        source: {
          type: "string",
          description: "Filtra pela origem de mídia (ex: 'Busca Paga | Meta', 'Busca Paga | Google').",
        },
        sectorOrigin: {
          type: "string",
          description: "Filtra pelo setor de origem.",
        },
        sectorCurrent: {
          type: "string",
          description: "Filtra pelo setor atual.",
        },
        createdFrom: {
          type: "string",
          description: "Data inicial de criação (YYYY-MM-DD).",
        },
        createdTo: {
          type: "string",
          description: "Data final de criação (YYYY-MM-DD).",
        },
        limit: {
          type: "number",
          default: 20,
          description: "Tamanho do lote (padrão 20, máx 50).",
        },
      },
    },
  },
];

export const MCP_TOOLS: McpToolDefinition[] = [
  ...MCP_READ_CORE_TOOLS_RAW.map((tool) => ({
    ...tool,
    access: "read" as const,
  })),
  ...MCP_EXTENDED_TOOLS,
];

const WRITE_MCP_TOOL_NAMES = new Set(
  MCP_TOOLS.filter((t) => t.access === "write").map((t) => t.name),
);

export function isWriteMcpTool(toolName: string): boolean {
  return WRITE_MCP_TOOL_NAMES.has(toolName);
}

export function getVisibleMcpTools(access?: McpAccessContext): McpToolDefinition[] {
  const canWrite = access?.accessLevel === "read_write";
  return canWrite ? MCP_TOOLS : MCP_TOOLS.filter((t) => t.access === "read");
}

export async function executeMcpTool(
  toolName: string,
  args: Record<string, any> = {},
  access?: McpAccessContext,
  sql: any = defaultSqlClient,
) {
  const tenantId = resolveEffectiveTenantId(args.tenantId, access);

  if (isWriteMcpTool(toolName) && access?.accessLevel !== "read_write") {
    throw new Error(
      `Permissão insuficiente (Somente Leitura): a ação '${toolName}' requer uma chave MCP com permissão 'Leitura + Escrita'. Habilite em Configurações > Conector MCP.`,
    );
  }

  if (isExtendedMcpTool(toolName)) {
    return await executeExtendedMcpTool(toolName, args, tenantId, {
      keyId: access?.keyId,
      keyLabel: access?.keyLabel,
      clientName: access?.clientName,
    });
  }

  switch (toolName) {
    case "search_conversations": {
      const limit = clampLimit(args.limit, 20, 100);
      const query = String(args.query || "").trim();
      const queueState = args.queueState ? String(args.queueState).trim() : null;
      const operatorName = args.operatorName ? String(args.operatorName).trim() : null;

      const conditions = [sql`conv.tenant_id = ${tenantId}`];
      if (queueState) conditions.push(sql`conv.queue_state = ${queueState}`);
      if (operatorName) {
        const opPattern = `%${operatorName}%`;
        conditions.push(sql`op.name ILIKE ${opPattern}`);
      }
      if (query) {
        const pattern = `%${query}%`;
        conditions.push(sql`(
          c.name ILIKE ${pattern}
          OR COALESCE(c.phone, '') ILIKE ${pattern}
          OR COALESCE(c.cnpj, '') ILIKE ${pattern}
          OR COALESCE(acc.name, '') ILIKE ${pattern}
          OR COALESCE(acc.trade_name, '') ILIKE ${pattern}
          OR COALESCE(acc.document, '') ILIKE ${pattern}
          OR COALESCE(conv.last_message_text, '') ILIKE ${pattern}
        )`);
      }

      const whereClause = conditions.reduce((acc, curr, idx) =>
        idx === 0 ? curr : sql`${acc} AND ${curr}`,
      );

      const rows = await sql`
        SELECT
          conv.id AS conversation_id,
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
          c.account_id,
          acc.name AS account_name,
          acc.trade_name AS account_trade_name,
          acc.document AS account_document,
          op.id AS operator_id,
          op.name AS operator_name,
          s.id AS sector_id,
          s.name AS sector_name,
          (
            SELECT jsonb_agg(jsonb_build_object(
              'dealId', d.id,
              'title', d.title,
              'value', d.value,
              'status', d.status
            ))
            FROM crm_conversation_deals cd
            JOIN crm_deals d ON d.id = cd.deal_id AND d.tenant_id = conv.tenant_id
            WHERE cd.conversation_id = conv.id
              AND cd.tenant_id = conv.tenant_id
              AND cd.is_active = true
          ) AS linked_deals
        FROM conversations conv
        JOIN contacts c ON c.id = conv.contact_id AND c.tenant_id = conv.tenant_id
        LEFT JOIN crm_accounts acc ON acc.id = c.account_id AND acc.tenant_id = conv.tenant_id
        LEFT JOIN operators op ON op.id = conv.operator_id AND op.tenant_id = conv.tenant_id
        LEFT JOIN sectors s ON s.id = conv.sector_id AND s.tenant_id = conv.tenant_id
        WHERE ${whereClause}
        ORDER BY conv.last_message_time DESC NULLS LAST
        LIMIT ${limit}
      `;

      const [queueSummary] = await sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE queue_state = 'automacao')::int AS automacao,
          COUNT(*) FILTER (WHERE queue_state = 'fila')::int AS fila,
          COUNT(*) FILTER (WHERE queue_state = 'meus')::int AS meus,
          COUNT(*) FILTER (WHERE queue_state = 'finalizados')::int AS finalizados
        FROM conversations
        WHERE tenant_id = ${tenantId}
      `;

      return {
        tenantId,
        queueSummary,
        returnedCount: rows.length,
        conversations: rows.map((r: any) => ({
          conversationId: r.conversation_id,
          queueState: r.queue_state,
          unreadCount: r.unread_count,
          lastMessageText: r.last_message_text,
          lastMessageTime: r.last_message_time,
          createdAt: r.created_at,
          contact: {
            id: r.contact_id,
            name: r.contact_name,
            phone: r.contact_phone,
            email: r.contact_email,
            channel: r.main_channel,
          },
          account: r.account_id
            ? {
                id: r.account_id,
                name: r.account_name,
                tradeName: r.account_trade_name,
                document: formatCnpjOrCpf(r.account_document),
              }
            : null,
          operator: r.operator_id ? { id: r.operator_id, name: r.operator_name } : null,
          sector: r.sector_id ? { id: r.sector_id, name: r.sector_name } : null,
          linkedDeals: r.linked_deals || [],
        })),
      };
    }

    case "get_conversation_messages": {
      const conversationId = String(args.conversationId || "").trim();
      if (!conversationId) throw new Error("Informe conversationId.");
      const includeInternalNotes = args.includeInternalNotes !== false;
      const limit = clampLimit(args.limit, 60, 200);

      const [conv] = await sql`
        SELECT
          conv.id,
          conv.queue_state,
          conv.unread_count,
          conv.last_message_time,
          conv.created_at,
          c.id AS contact_id,
          c.name AS contact_name,
          c.phone AS contact_phone,
          c.email AS contact_email,
          c.main_channel,
          c.tags,
          acc.id AS account_id,
          acc.name AS account_name,
          acc.trade_name AS account_trade_name,
          acc.document AS account_document,
          acc.address AS account_address,
          op.id AS operator_id,
          op.name AS operator_name,
          s.name AS sector_name
        FROM conversations conv
        JOIN contacts c ON c.id = conv.contact_id AND c.tenant_id = conv.tenant_id
        LEFT JOIN crm_accounts acc ON acc.id = c.account_id AND acc.tenant_id = conv.tenant_id
        LEFT JOIN operators op ON op.id = conv.operator_id AND op.tenant_id = conv.tenant_id
        LEFT JOIN sectors s ON s.id = conv.sector_id AND s.tenant_id = conv.tenant_id
        WHERE conv.tenant_id = ${tenantId} AND conv.id = ${conversationId}
        LIMIT 1
      `;

      if (!conv) {
        throw new Error(`Conversa '${conversationId}' não encontrada no tenant '${tenantId}'.`);
      }

      const msgs = await sql`
        SELECT
          id,
          sender_type,
          sender_name,
          content,
          is_internal_note,
          media_interpretation,
          provider,
          direction,
          status,
          sent_at
        FROM messages
        WHERE tenant_id = ${tenantId}
          AND conversation_id = ${conversationId}
          ${includeInternalNotes ? sql`` : sql`AND is_internal_note = false`}
        ORDER BY sent_at DESC, id DESC
        LIMIT ${limit}
      `;

      return {
        tenantId,
        conversation: {
          id: conv.id,
          queueState: conv.queue_state,
          unreadCount: conv.unread_count,
          sectorName: conv.sector_name,
          operator: conv.operator_id ? { id: conv.operator_id, name: conv.operator_name } : null,
          contact: {
            id: conv.contact_id,
            name: conv.contact_name,
            phone: conv.contact_phone,
            email: conv.contact_email,
            channel: conv.main_channel,
            tags: conv.tags || [],
          },
          account: conv.account_id
            ? {
                id: conv.account_id,
                name: conv.account_name,
                tradeName: conv.account_trade_name,
                document: formatCnpjOrCpf(conv.account_document),
                receitaFederal: extractReceitaDetails(conv.account_address, conv.account_document),
              }
            : null,
        },
        messageCountReturned: msgs.length,
        messages: [...msgs].reverse().map((m: any) => ({
          id: m.id,
          sentAt: m.sent_at,
          senderType: m.sender_type,
          senderName: m.sender_name,
          isInternalNote: m.is_internal_note,
          content: m.content ? String(m.content).slice(0, 4000) : "",
          mediaInterpretation: m.media_interpretation || null,
          provider: m.provider,
          direction: m.direction,
          status: m.status,
        })),
      };
    }

    case "get_fagner_triage_overview": {
      const limit = clampLimit(args.limit, 30, 100);
      const stateFilter = args.stateFilter ? String(args.stateFilter).trim() : null;

      const flows = await sql`
        WITH current_flows AS (
          SELECT DISTINCT ON (af.conversation_id)
            af.id,
            af.conversation_id,
            af.current_step,
            af.collected_data,
            af.metadata,
            af.started_at,
            af.last_interaction_at,
            af.completed_at,
            af.outcome,
            conv.queue_state,
            conv.operator_id,
            op.name AS operator_name,
            c.name AS contact_name,
            c.phone AS contact_phone,
            c.main_channel
          FROM agent_flow_states af
          JOIN conversations conv ON conv.id = af.conversation_id AND conv.tenant_id = af.tenant_id
          JOIN contacts c ON c.id = conv.contact_id AND c.tenant_id = af.tenant_id
          LEFT JOIN operators op ON op.id = conv.operator_id AND op.tenant_id = af.tenant_id
          WHERE af.tenant_id = ${tenantId} AND af.agent_type = 'sdr'
          ORDER BY af.conversation_id, af.started_at DESC, af.id DESC
        )
        SELECT * FROM current_flows
        ORDER BY last_interaction_at DESC NULLS LAST
        LIMIT 200
      `;

      const stateCounts: Record<string, number> = {};
      const projectedList: any[] = [];

      for (const row of flows) {
        const projection = projectIndustrialMonitoring(
          {
            startedAt: row.started_at,
            outcome: row.outcome,
            metadata: row.metadata,
          },
          {
            operatorId: row.operator_id,
            queueState: row.queue_state,
          },
        );
        stateCounts[projection.state] = (stateCounts[projection.state] || 0) + 1;

        if (stateFilter && projection.state !== stateFilter) continue;
        if (projectedList.length >= limit) continue;

        projectedList.push({
          flowId: row.id,
          conversationId: row.conversation_id,
          contactName: row.contact_name,
          contactPhone: row.contact_phone,
          channel: row.main_channel,
          queueState: row.queue_state,
          operatorName: row.operator_name || null,
          startedAt: row.started_at,
          lastInteractionAt: row.last_interaction_at,
          completedAt: row.completed_at,
          currentStep: row.current_step,
          outcome: row.outcome,
          monitoring: projection,
          collectedData: row.collected_data || {},
        });
      }

      return {
        tenantId,
        aiPersona: tenantId === "tecfag" ? "Fagner (Triagem Industrial)" : "Valentina (SDR)",
        totalTrackedConversations: flows.length,
        countsByState: stateCounts,
        sessions: projectedList,
      };
    }

    case "get_fagner_triage_history": {
      const conversationId = args.conversationId ? String(args.conversationId).trim() : "";
      const query = String(args.query || "").trim();
      const limit = clampLimit(args.limit, 25, 100);

      if (!conversationId) {
        const pattern = `%${query}%`;
        const rows = await sql`
          SELECT
            conv.id AS conversation_id,
            c.name AS contact_name,
            c.phone AS contact_phone,
            c.main_channel AS channel,
            conv.queue_state,
            conv.created_at,
            conv.last_message_time,
            (
              SELECT COUNT(*)::int FROM agent_flow_states af
              WHERE af.tenant_id = conv.tenant_id
                AND af.conversation_id = conv.id
                AND af.agent_type = 'sdr'
            ) AS flow_rows_count
          FROM conversations conv
          JOIN contacts c ON c.id = conv.contact_id AND c.tenant_id = conv.tenant_id
          WHERE conv.tenant_id = ${tenantId}
            ${query ? sql`AND (c.name ILIKE ${pattern} OR COALESCE(c.phone, '') ILIKE ${pattern})` : sql``}
            AND (
              EXISTS (
                SELECT 1 FROM agent_flow_states af
                WHERE af.tenant_id = conv.tenant_id
                  AND af.conversation_id = conv.id
                  AND af.agent_type = 'sdr'
              )
              OR EXISTS (
                SELECT 1 FROM messages m
                WHERE m.tenant_id = conv.tenant_id
                  AND m.conversation_id = conv.id
                  AND m.is_internal_note = true
                  AND m.meta_details->'industrialTriage'->>'version' = '1'
              )
            )
          ORDER BY conv.last_message_time DESC NULLS LAST
          LIMIT ${limit}
        `;

        return {
          tenantId,
          mode: "conversations_list",
          count: rows.length,
          items: rows,
        };
      }

      const flowRows = await sql`
        SELECT
          id,
          conversation_id AS "conversationId",
          tenant_id AS "tenantId",
          started_at AS "startedAt",
          last_interaction_at AS "lastInteractionAt",
          completed_at AS "completedAt",
          outcome,
          current_step AS "currentStep",
          collected_data AS "collectedData",
          metadata
        FROM agent_flow_states
        WHERE tenant_id = ${tenantId}
          AND conversation_id = ${conversationId}
          AND agent_type = 'sdr'
        ORDER BY started_at DESC, id DESC
        LIMIT 20
      `;

      const journalNotes = await sql`
        SELECT
          id,
          content,
          sent_at,
          meta_details
        FROM messages
        WHERE tenant_id = ${tenantId}
          AND conversation_id = ${conversationId}
          AND is_internal_note = true
          AND meta_details->'industrialTriage'->>'version' = '1'
        ORDER BY sent_at ASC, id ASC
        LIMIT 100
      `;

      const cycles = flowRows.map((f: any, idx: number) => {
        let snapshot = null;
        try {
          snapshot = buildJournalSnapshot(f as JournalFlow);
        } catch {
          snapshot = null;
        }
        return {
          isCurrent: idx === 0,
          flowId: f.id,
          startedAt: f.startedAt,
          lastInteractionAt: f.lastInteractionAt,
          completedAt: f.completedAt,
          outcome: f.outcome,
          currentStep: f.currentStep,
          snapshot,
        };
      });

      const events = journalNotes.map((n: any) => {
        const triageMeta = n.meta_details?.industrialTriage || {};
        return {
          messageId: n.id,
          at: n.sent_at,
          cycleId: triageMeta.cycleId || null,
          kind: triageMeta.kind || "unknown",
          text: String(n.content || "").slice(0, 4000),
          snapshot: readJournalSnapshot(triageMeta.snapshot),
        };
      });

      return {
        tenantId,
        conversationId,
        cyclesCount: cycles.length,
        cycles,
        journalEventsCount: events.length,
        journalEvents: events,
      };
    }

    case "search_crm_deals": {
      const limit = clampLimit(args.limit, 25, 100);
      const query = String(args.query || "").trim();
      const idRd = args.idRd ? String(args.idRd).trim() : null;
      const pipelineName = args.pipelineName ? String(args.pipelineName).trim() : null;
      const stageName = args.stageName ? String(args.stageName).trim() : null;
      const sectorOrigin = args.sectorOrigin ? String(args.sectorOrigin).trim() : null;
      const sectorCurrent = args.sectorCurrent ? String(args.sectorCurrent).trim() : null;
      const source = args.source ? String(args.source).trim() : null;
      const campaign = args.campaign ? String(args.campaign).trim() : null;
      const utmCampaign = args.utmCampaign ? String(args.utmCampaign).trim() : null;
      const operatorName = args.operatorName ? String(args.operatorName).trim() : null;
      const status = args.status ? String(args.status).trim() : null;
      const includeTests = args.includeTests === true;
      const includeLegacy = args.includeLegacy !== false;

      const conditions = [sql`d.tenant_id = ${tenantId}`];
      if (!includeTests) conditions.push(sql`d.is_test = false`);
      if (!includeLegacy) conditions.push(sql`d.is_legacy = false`);
      if (idRd) conditions.push(sql`d.rd_deal_id = ${idRd}`);

      if (pipelineName) {
        const pPattern = `%${pipelineName}%`;
        conditions.push(sql`p.name ILIKE ${pPattern}`);
      }
      if (stageName) {
        const sPattern = `%${stageName}%`;
        conditions.push(sql`st.name ILIKE ${sPattern}`);
      }
      if (sectorOrigin) {
        conditions.push(sql`d.sector_origin = ${sectorOrigin}`);
      }
      if (sectorCurrent) {
        conditions.push(sql`d.sector_current = ${sectorCurrent}`);
      }
      if (source) {
        const srcPat = `%${source}%`;
        conditions.push(sql`(COALESCE(d.source, '') ILIKE ${srcPat} OR COALESCE(d.utm_source, '') ILIKE ${srcPat})`);
      }
      if (campaign) {
        const cmpPat = `%${campaign}%`;
        conditions.push(sql`COALESCE(d.campaign, '') ILIKE ${cmpPat}`);
      }
      if (utmCampaign) {
        const ucmpPat = `%${utmCampaign}%`;
        conditions.push(sql`COALESCE(d.utm_campaign, '') ILIKE ${ucmpPat}`);
      }
      if (operatorName) {
        const opPattern = `%${operatorName}%`;
        conditions.push(sql`op.name ILIKE ${opPattern}`);
      }
      if (status === "closed_won_effective") {
        conditions.push(sql`(
          d.status = 'won'
          OR (
            d.status = 'open'
            AND COALESCE(d.sector_current, '') NOT IN ('suporte_tecnico', 'financeiro')
            AND (st.is_win_stage = true OR LOWER(st.name) ~ '^(fechamento|venda conclu[ií]da)')
          )
        )`);
      } else if (status) {
        conditions.push(sql`d.status = ${status}`);
      }
      const createdFrom = parseFlexibleDateBound(args.createdFrom ? String(args.createdFrom) : null, "start");
      if (createdFrom) conditions.push(sql`d.created_at >= ${createdFrom}::timestamp`);
      const createdTo = parseFlexibleDateBound(args.createdTo ? String(args.createdTo) : null, "end");
      if (createdTo) conditions.push(sql`d.created_at <= ${createdTo}::timestamp`);
      const wonFrom = parseFlexibleDateBound(args.wonFrom ? String(args.wonFrom) : null, "start");
      if (wonFrom) conditions.push(sql`COALESCE(d.won_at, d.closed_at) >= ${wonFrom}::timestamp`);
      const wonTo = parseFlexibleDateBound(args.wonTo ? String(args.wonTo) : null, "end");
      if (wonTo) conditions.push(sql`COALESCE(d.won_at, d.closed_at) <= ${wonTo}::timestamp`);

      if (query) {
        const qPattern = `%${query}%`;
        conditions.push(sql`(
          d.title ILIKE ${qPattern}
          OR COALESCE(d.rd_deal_id, '') ILIKE ${qPattern}
          OR COALESCE(acc.name, '') ILIKE ${qPattern}
          OR COALESCE(acc.trade_name, '') ILIKE ${qPattern}
          OR COALESCE(acc.document, '') ILIKE ${qPattern}
          OR COALESCE(d.loss_reason, '') ILIKE ${qPattern}
        )`);
      }

      const whereClause = conditions.reduce((acc, curr, idx) =>
        idx === 0 ? curr : sql`${acc} AND ${curr}`,
      );

      const rows = await sql`
        SELECT
          d.id,
          d.rd_deal_id,
          d.rd_deal_url,
          d.title,
          d.value,
          d.currency,
          d.status,
          d.loss_reason,
          d.paused_reason,
          d.entry_channel,
          d.source,
          d.campaign,
          d.utm_source,
          d.utm_medium,
          d.utm_campaign,
          d.utm_content,
          d.utm_term,
          d.click_id,
          d.original_pipeline_id,
          d.sector_origin,
          d.sector_current,
          d.rating,
          d.ai_priority_score,
          d.ai_priority_level,
          d.expected_close_date,
          d.won_at,
          d.lost_at,
          d.closed_at,
          d.is_legacy,
          d.is_test,
          d.created_at,
          d.updated_at,
          p.id AS pipeline_id,
          p.name AS pipeline_name,
          st.id AS stage_id,
          st.name AS stage_name,
          st.is_win_stage,
          st.is_loss_stage,
          op.id AS operator_id,
          op.name AS operator_name,
          acc.id AS account_id,
          acc.name AS account_name,
          acc.trade_name AS account_trade_name,
          acc.document AS account_document
        FROM crm_deals d
        JOIN crm_pipelines p ON p.id = d.pipeline_id AND p.tenant_id = d.tenant_id
        JOIN crm_stages st ON st.id = d.stage_id AND st.tenant_id = d.tenant_id
        LEFT JOIN operators op ON op.id = d.operator_id AND op.tenant_id = d.tenant_id
        LEFT JOIN crm_accounts acc ON acc.id = d.account_id AND acc.tenant_id = d.tenant_id
        WHERE ${whereClause}
        ORDER BY COALESCE(d.won_at, d.closed_at, d.updated_at, d.created_at) DESC
        LIMIT ${limit}
      `;

      return {
        tenantId,
        returnedCount: rows.length,
        deals: rows.map((r: any) => {
          const effectiveWon = isEffectiveCommercialWin({
            status: r.status,
            stageIsWin: r.is_win_stage,
            stageName: r.stage_name,
            sectorCurrent: r.sector_current,
          });
          const canonicalSource = projectCanonicalDealSourceName(r);
          return {
            id: r.id,
            id_rd: r.rd_deal_id || null,
            rd_deal_url: r.rd_deal_url || null,
            title: r.title,
            value: Number(r.value || 0),
            currency: r.currency,
            status: r.status,
            win: effectiveWon,
            isEffectiveWon: effectiveWon,
            winAt: effectiveWon ? r.won_at || r.closed_at || r.updated_at : null,
            lostAt: r.status === "lost" ? r.lost_at || r.closed_at || r.updated_at : null,
            sectorOrigin: r.sector_origin || null,
            sectorOriginLabel: formatMarketingSectorLabel(r.sector_origin),
            sectorCurrent: r.sector_current || null,
            sectorCurrentLabel: formatMarketingSectorLabel(r.sector_current),
            originalPipelineId: r.original_pipeline_id || r.pipeline_id,
            pipeline: { id: r.pipeline_id, name: r.pipeline_name },
            stage: {
              id: r.stage_id,
              name: r.stage_name,
              isWinStage: effectiveWon,
              isLossStage: r.is_loss_stage,
            },
            operator: r.operator_id ? { id: r.operator_id, name: r.operator_name } : null,
            account: r.account_id
              ? {
                  id: r.account_id,
                  name: r.account_name,
                  tradeName: r.account_trade_name,
                  document: formatCnpjOrCpf(r.account_document),
                }
              : null,
            lossReason: r.loss_reason || null,
            pausedReason: r.paused_reason || null,
            entryChannel: r.entry_channel || null,
            deal_source_name: canonicalSource,
            source: canonicalSource,
            campaign_name: r.campaign || null,
            campaign: r.campaign || null,
            utmSource: r.utm_source || null,
            utmMedium: r.utm_medium || null,
            utmCampaign: r.utm_campaign || null,
            rating: r.rating,
            aiPriority: r.ai_priority_level
              ? { score: r.ai_priority_score, level: r.ai_priority_level }
              : null,
            isLegacy: Boolean(r.is_legacy),
            isTest: Boolean(r.is_test),
            closedAt: r.closed_at,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          };
        }),
      };
    }

    case "get_crm_deal_details": {
      const dealId = String(args.dealId || "").trim();
      if (!dealId) throw new Error("Informe dealId.");

      const [deal] = await sql`
        SELECT
          d.*,
          p.name AS pipeline_name,
          orig_p.name AS original_pipeline_name,
          st.name AS stage_name,
          st.is_win_stage,
          op.name AS operator_name,
          op.email AS operator_email,
          acc.name AS account_name,
          acc.trade_name AS account_trade_name,
          acc.type AS account_type,
          acc.document AS account_document,
          acc.segment AS account_segment,
          acc.phone AS account_phone,
          acc.email AS account_email,
          acc.website AS account_website,
          acc.address AS account_address
        FROM crm_deals d
        JOIN crm_pipelines p ON p.id = d.pipeline_id AND p.tenant_id = d.tenant_id
        LEFT JOIN crm_pipelines orig_p ON orig_p.id = d.original_pipeline_id AND orig_p.tenant_id = d.tenant_id
        JOIN crm_stages st ON st.id = d.stage_id AND st.tenant_id = d.tenant_id
        LEFT JOIN operators op ON op.id = d.operator_id AND op.tenant_id = d.tenant_id
        LEFT JOIN crm_accounts acc ON acc.id = d.account_id AND acc.tenant_id = d.tenant_id
        WHERE d.tenant_id = ${tenantId} AND d.id = ${dealId}
        LIMIT 1
      `;

      if (!deal) {
        throw new Error(`Negociação '${dealId}' não encontrada no tenant '${tenantId}'.`);
      }

      const [
        dealContacts,
        dealProducts,
        proposals,
        activities,
        linkedConversations,
        recentEvents,
        stageHistoryRes,
        fieldDefinitions,
      ] = await Promise.all([
        sql`
          SELECT dc.role, dc.is_primary, c.id, c.name, c.phone, c.email, c.cpf, c.cnpj, c.main_channel
          FROM crm_deal_contacts dc
          JOIN contacts c ON c.id = dc.contact_id AND c.tenant_id = dc.tenant_id
          WHERE dc.tenant_id = ${tenantId} AND dc.deal_id = ${dealId}
          ORDER BY dc.is_primary DESC, c.name ASC
        `,
        sql`
          SELECT id, product_id, name, quantity, unit_price, discount_percent, total_price, notes
          FROM crm_deal_products
          WHERE tenant_id = ${tenantId} AND deal_id = ${dealId}
          ORDER BY created_at ASC
        `,
        sql`
          SELECT id, proposal_number, title, status, subtotal, discount, total, payment_terms, delivery_terms, created_at
          FROM crm_proposals
          WHERE tenant_id = ${tenantId} AND deal_id = ${dealId}
          ORDER BY created_at DESC
        `,
        sql`
          SELECT id, type, title, description, completion_note, status, due_date, completed_at, created_at
          FROM crm_deal_activities
          WHERE tenant_id = ${tenantId} AND deal_id = ${dealId}
          ORDER BY created_at DESC
          LIMIT 30
        `,
        sql`
          SELECT
            cd.conversation_id,
            cd.origin,
            cd.is_active,
            cd.created_by_operator_id,
            op.name AS created_by_operator_name,
            conv.queue_state,
            conv.last_message_text,
            conv.last_message_time
          FROM crm_conversation_deals cd
          JOIN conversations conv ON conv.id = cd.conversation_id AND conv.tenant_id = cd.tenant_id
          LEFT JOIN operators op ON op.id = cd.created_by_operator_id AND op.tenant_id = cd.tenant_id
          WHERE cd.tenant_id = ${tenantId} AND cd.deal_id = ${dealId}
          ORDER BY cd.created_at DESC
        `,
        sql`
          SELECT
            de.id,
            de.event_type,
            de.from_stage_id,
            de.to_stage_id,
            de.operator_id,
            op.name AS operator_name,
            de.metadata,
            de.created_at
          FROM crm_deal_events de
          LEFT JOIN operators op ON op.id = de.operator_id AND op.tenant_id = de.tenant_id
          WHERE de.tenant_id = ${tenantId}
            AND de.deal_id = ${dealId}
            AND de.event_type != 'conversation_action'
          ORDER BY de.created_at DESC
          LIMIT 50
        `,
        listMarketingStageHistory(
          tenantId,
          { dealId, includeTests: true, includeLegacy: true, limit: 1 },
          sql,
        ),
        sql`
          SELECT id, name, field_type
          FROM crm_custom_field_definitions
          WHERE tenant_id = ${tenantId} AND entity_type = 'deal'
        `,
      ]);

      const fieldMap = new Map<string, string>(
        fieldDefinitions.map((f: any) => [String(f.id), String(f.name)]),
      );
      const rawCustom =
        deal.custom_fields && typeof deal.custom_fields === "object" ? deal.custom_fields : {};
      const labeledCustomFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawCustom)) {
        const label = fieldMap.get(k) || k;
        labeledCustomFields[label] = v;
      }

      const effectiveWon = isEffectiveCommercialWin({
        status: deal.status,
        stageIsWin: deal.is_win_stage,
        stageName: deal.stage_name,
        sectorCurrent: deal.sector_current,
      });
      const canonicalSource = projectCanonicalDealSourceName(deal);

      return {
        tenantId,
        deal: {
          id: deal.id,
          id_rd: deal.rd_deal_id || null,
          rd_deal_url: deal.rd_deal_url || null,
          title: deal.title,
          value: Number(deal.value || 0),
          currency: deal.currency,
          status: deal.status,
          win: effectiveWon,
          isEffectiveWon: effectiveWon,
          winAt: effectiveWon ? deal.won_at || deal.closed_at || deal.updated_at : null,
          lostAt: deal.status === "lost" ? deal.lost_at || deal.closed_at || deal.updated_at : null,
          sectorOrigin: deal.sector_origin || null,
          sectorOriginLabel: formatMarketingSectorLabel(deal.sector_origin),
          sectorCurrent: deal.sector_current || null,
          sectorCurrentLabel: formatMarketingSectorLabel(deal.sector_current),
          originalPipeline: {
            id: deal.original_pipeline_id || deal.pipeline_id,
            name: deal.original_pipeline_name || deal.pipeline_name,
          },
          pipeline: { id: deal.pipeline_id, name: deal.pipeline_name },
          stage: { id: deal.stage_id, name: deal.stage_name },
          operator: deal.operator_id
            ? { id: deal.operator_id, name: deal.operator_name, email: deal.operator_email }
            : null,
          entryChannel: deal.entry_channel || null,
          deal_source_name: canonicalSource,
          source: canonicalSource,
          sourceRaw: deal.source || null,
          campaign_name: deal.campaign || null,
          campaign: deal.campaign || null,
          utmSource: deal.utm_source || null,
          utmMedium: deal.utm_medium || null,
          utmCampaign: deal.utm_campaign || null,
          utmContent: deal.utm_content || null,
          utmTerm: deal.utm_term || null,
          clickId: deal.click_id || null,
          landingPage: deal.landing_page || null,
          lossReason: deal.loss_reason,
          pausedReason: deal.paused_reason,
          isLegacy: Boolean(deal.is_legacy),
          isTest: Boolean(deal.is_test),
          expectedCloseDate: deal.expected_close_date,
          closedAt: deal.closed_at,
          createdAt: deal.created_at,
          updatedAt: deal.updated_at,
          customFields: labeledCustomFields,
        },
        account: deal.account_id
          ? {
              id: deal.account_id,
              type: deal.account_type,
              name: deal.account_name,
              tradeName: deal.account_trade_name,
              document: formatCnpjOrCpf(deal.account_document),
              segment: deal.account_segment,
              phone: deal.account_phone,
              email: deal.account_email,
              website: deal.account_website,
              receitaFederal: extractReceitaDetails(deal.account_address, deal.account_document),
            }
          : null,
        contacts: dealContacts,
        products: dealProducts.map((p: any) => ({
          ...p,
          quantity: Number(p.quantity || 0),
          unit_price: Number(p.unit_price || 0),
          total_price: Number(p.total_price || 0),
        })),
        proposals,
        stageHistory: stageHistoryRes.items,
        recentActivities: activities,
        recentEvents,
        linkedConversations,
      };
    }

    case "search_crm_accounts": {
      const accountId = args.accountId ? String(args.accountId).trim() : null;
      const query = String(args.query || "").trim();
      const type = args.type ? String(args.type).trim() : null;
      const limit = clampLimit(args.limit, 25, 100);

      if (accountId) {
        const [acc] = await sql`
          SELECT *
          FROM crm_accounts
          WHERE tenant_id = ${tenantId} AND id = ${accountId}
          LIMIT 1
        `;
        if (!acc) {
          throw new Error(`Empresa '${accountId}' não encontrada no tenant '${tenantId}'.`);
        }

        const [linkedContacts, linkedDeals] = await Promise.all([
          sql`
            SELECT id, name, phone, email, main_channel, responsible_name, created_at
            FROM contacts
            WHERE tenant_id = ${tenantId} AND account_id = ${accountId}
            ORDER BY created_at DESC
          `,
          sql`
            SELECT d.id, d.title, d.value, d.status, d.closed_at, d.created_at, p.name AS pipeline_name, st.name AS stage_name, op.name AS operator_name
            FROM crm_deals d
            JOIN crm_pipelines p ON p.id = d.pipeline_id AND p.tenant_id = d.tenant_id
            JOIN crm_stages st ON st.id = d.stage_id AND st.tenant_id = d.tenant_id
            LEFT JOIN operators op ON op.id = d.operator_id AND op.tenant_id = d.tenant_id
            WHERE d.tenant_id = ${tenantId} AND d.account_id = ${accountId}
            ORDER BY d.created_at DESC
            LIMIT 50
          `,
        ]);

        return {
          tenantId,
          account: {
            id: acc.id,
            type: acc.type,
            name: acc.name,
            tradeName: acc.trade_name,
            segment: acc.segment,
            documentType: acc.document_type,
            document: formatCnpjOrCpf(acc.document),
            phone: acc.phone,
            email: acc.email,
            website: acc.website,
            notes: acc.notes,
            receitaFederal: extractReceitaDetails(acc.address, acc.document),
            createdAt: acc.created_at,
            updatedAt: acc.updated_at,
          },
          linkedContacts,
          linkedDeals: linkedDeals.map((d: any) => ({
            ...d,
            value: Number(d.value || 0),
          })),
        };
      }

      const conditions = [sql`acc.tenant_id = ${tenantId}`, sql`acc.archived_at IS NULL`];
      if (type) conditions.push(sql`acc.type = ${type}`);
      if (query) {
        const cleanDigits = query.replace(/\D/g, "");
        const pattern = `%${query}%`;
        if (cleanDigits.length >= 6) {
          const digitPattern = `%${cleanDigits}%`;
          conditions.push(sql`(
            acc.name ILIKE ${pattern}
            OR COALESCE(acc.trade_name, '') ILIKE ${pattern}
            OR COALESCE(acc.document, '') ILIKE ${digitPattern}
            OR COALESCE(acc.phone, '') ILIKE ${digitPattern}
            OR COALESCE(acc.segment, '') ILIKE ${pattern}
          )`);
        } else {
          conditions.push(sql`(
            acc.name ILIKE ${pattern}
            OR COALESCE(acc.trade_name, '') ILIKE ${pattern}
            OR COALESCE(acc.segment, '') ILIKE ${pattern}
            OR COALESCE(acc.email, '') ILIKE ${pattern}
          )`);
        }
      }

      const whereClause = conditions.reduce((acc, curr, idx) =>
        idx === 0 ? curr : sql`${acc} AND ${curr}`,
      );

      const rows = await sql`
        SELECT
          acc.id,
          acc.type,
          acc.name,
          acc.trade_name,
          acc.segment,
          acc.document_type,
          acc.document,
          acc.phone,
          acc.email,
          acc.website,
          acc.address,
          acc.updated_at,
          (SELECT COUNT(*)::int FROM contacts c WHERE c.tenant_id = acc.tenant_id AND c.account_id = acc.id) AS contacts_count,
          (SELECT COUNT(*)::int FROM crm_deals d WHERE d.tenant_id = acc.tenant_id AND d.account_id = acc.id) AS deals_count
        FROM crm_accounts acc
        WHERE ${whereClause}
        ORDER BY acc.updated_at DESC
        LIMIT ${limit}
      `;

      return {
        tenantId,
        returnedCount: rows.length,
        accounts: rows.map((acc: any) => ({
          id: acc.id,
          type: acc.type,
          name: acc.name,
          tradeName: acc.trade_name,
          segment: acc.segment,
          document: formatCnpjOrCpf(acc.document),
          phone: acc.phone,
          email: acc.email,
          website: acc.website,
          contactsCount: acc.contacts_count,
          dealsCount: acc.deals_count,
          receitaFederal: extractReceitaDetails(acc.address, acc.document),
        })),
      };
    }

    case "search_contacts": {
      const query = String(args.query || "").trim();
      const limit = clampLimit(args.limit, 25, 100);
      const pattern = `%${query}%`;

      const rows = await sql`
        SELECT
          c.id,
          c.name,
          c.phone,
          c.email,
          c.cnpj,
          c.cpf,
          c.main_channel,
          c.responsible_name,
          c.tags,
          c.account_id,
          acc.name AS account_name,
          acc.trade_name AS account_trade_name,
          acc.document AS account_document,
          conv.id AS conversation_id,
          conv.queue_state,
          conv.last_message_time
        FROM contacts c
        LEFT JOIN crm_accounts acc ON acc.id = c.account_id AND acc.tenant_id = c.tenant_id
        LEFT JOIN conversations conv ON conv.contact_id = c.id AND conv.tenant_id = c.tenant_id
        WHERE c.tenant_id = ${tenantId}
          ${
            query
              ? sql`AND (
                  c.name ILIKE ${pattern}
                  OR COALESCE(c.phone, '') ILIKE ${pattern}
                  OR COALESCE(c.email, '') ILIKE ${pattern}
                  OR COALESCE(c.cnpj, '') ILIKE ${pattern}
                  OR COALESCE(acc.name, '') ILIKE ${pattern}
                )`
              : sql``
          }
        ORDER BY COALESCE(conv.last_message_time, c.created_at) DESC
        LIMIT ${limit}
      `;

      return {
        tenantId,
        returnedCount: rows.length,
        contacts: rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          phone: r.phone,
          email: r.email,
          document: formatCnpjOrCpf(r.cnpj || r.cpf || r.account_document),
          channel: r.main_channel,
          responsibleName: r.responsible_name,
          tags: r.tags || [],
          account: r.account_id
            ? {
                id: r.account_id,
                name: r.account_name,
                tradeName: r.account_trade_name,
                document: formatCnpjOrCpf(r.account_document),
              }
            : null,
          conversation: r.conversation_id
            ? {
                id: r.conversation_id,
                queueState: r.queue_state,
                lastMessageTime: r.last_message_time,
              }
            : null,
        })),
      };
    }

    case "get_sales_and_commercial_metrics": {
      const now = new Date();
      const today = saoPauloDay(now);
      const month =
        args.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(args.month))
          ? String(args.month)
          : today.slice(0, 7);
      const division =
        args.division === "maquinas" || args.division === "personnalite" ? args.division : null;

      const [year, monthNumber] = month.split("-").map(Number);
      const monthStart = `${month}-01`;
      const nextMonthStart = `${monthNumber === 12 ? year + 1 : year}-${String(
        monthNumber === 12 ? 1 : monthNumber + 1,
      ).padStart(2, "0")}-01`;

      const [
        consultantRows,
        allOperators,
        stageRows,
        dealsRows,
        goalRows,
        calendarRows,
      ] = await Promise.all([
        sql`
          SELECT
            op.id AS operator_id,
            op.name,
            cp.division,
            cp.active_on_tv
          FROM commercial_consultant_profiles cp
          JOIN operators op ON op.id = cp.operator_id AND op.tenant_id = cp.tenant_id
          WHERE cp.tenant_id = ${tenantId}
            AND cp.division IS NOT NULL
            AND cp.division != ''
        `,
        sql`SELECT id, name FROM operators WHERE tenant_id = ${tenantId}`,
        sql`
          SELECT st.id, st.name, st.order_index, st.is_win_stage, st.pipeline_id, p.name AS pipeline_name
          FROM crm_stages st
          JOIN crm_pipelines p ON p.id = st.pipeline_id AND p.tenant_id = st.tenant_id
          WHERE st.tenant_id = ${tenantId}
          ORDER BY p.order_index ASC, st.order_index ASC
        `,
        sql`
          SELECT
            id,
            title,
            value,
            status,
            stage_id,
            pipeline_id,
            operator_id,
            loss_reason,
            created_at,
            closed_at
          FROM crm_deals
          WHERE tenant_id = ${tenantId}
            AND is_test = false
            AND (
              status = 'open'
              OR COALESCE(closed_at, created_at) >= (${monthStart}::timestamp - INTERVAL '2 days')
            )
        `,
        sql`
          SELECT operator_id, target_value, conversion_rate
          FROM commercial_goals
          WHERE tenant_id = ${tenantId} AND month = ${month}
        `,
        sql`
          SELECT date, type, affects_goal
          FROM commercial_calendar_days
          WHERE tenant_id = ${tenantId}
            AND date >= ${monthStart}
            AND date < ${nextMonthStart}
        `,
      ]);

      let effectiveConsultantRows: any[] = consultantRows;
      if (effectiveConsultantRows.length === 0 && allOperators.length > 0) {
        const seenBaseNames = new Map<string, any>();
        const deduped: any[] = [];
        for (const op of allOperators) {
          const base = String(op.name || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/\s*-\s*\d+.*$/, "")
            .trim();
          if (!base) continue;
          if (!seenBaseNames.has(base)) {
            const entry = {
              operator_id: op.id,
              name: String(op.name).replace(/\s*-\s*\d+.*$/, "").trim() || op.name,
              division: "maquinas",
              active_on_tv: true,
            };
            seenBaseNames.set(base, entry);
            deduped.push(entry);
          }
        }
        effectiveConsultantRows = deduped;
      }

      const aliasMap = buildConsultantOperatorAliasMap(
        effectiveConsultantRows.map((c: any) => ({ operatorId: c.operator_id, name: c.name })),
        allOperators,
      );

      const filteredConsultants = effectiveConsultantRows.filter(
        (c: any) => !division || !consultantRows.length || c.division === division,
      );
      const activeConsultantIds = new Set(filteredConsultants.map((c: any) => c.operator_id));

      const stageById = new Map<string, any>(
        stageRows.map((s: any) => [
          s.id,
          {
            id: s.id,
            name: s.name,
            isWinStage: isCommercialWinStage({
              id: s.id,
              name: s.name,
              isWinStage: s.is_win_stage,
            }),
            pipelineId: s.pipeline_id,
            pipelineName: s.pipeline_name,
          },
        ]),
      );

      const goalsByOperator = new Map<string, number>();
      for (const g of goalRows) {
        const canonical = aliasMap.resolve(g.operator_id) || g.operator_id;
        goalsByOperator.set(canonical, Number(g.target_value || 0));
      }
      for (const c of filteredConsultants) {
        if (!goalsByOperator.has(c.operator_id)) {
          const matched = goalRows.find((g: any) => {
            const op = allOperators.find((o: any) => o.id === g.operator_id);
            return op && matchConsultantNames(op.name, c.name);
          });
          if (matched) {
            goalsByOperator.set(c.operator_id, Number(matched.target_value || 0));
          }
        }
      }

      const byConsultant = new Map<string, any>(
        filteredConsultants.map((c: any) => [
          c.operator_id,
          {
            operatorId: c.operator_id,
            name: c.name,
            division: c.division,
            targetValue: goalsByOperator.get(c.operator_id) || 0,
            wonValue: 0,
            wonCount: 0,
            openValue: 0,
            openCount: 0,
            lostCountMonth: 0,
          },
        ]),
      );

      let totalWonMonthValue = 0;
      let totalWonMonthCount = 0;
      let totalOpenValue = 0;
      let totalOpenCount = 0;
      let totalLostMonthCount = 0;
      const lossCategoriesCounter: Record<string, number> = {};
      const pipelineSummaryMap = new Map<string, any>();

      for (const deal of dealsRows) {
        const stage = stageById.get(deal.stage_id);
        const canonicalOpId = aliasMap.resolve(deal.operator_id) || deal.operator_id;
        if (division && (!canonicalOpId || !activeConsultantIds.has(canonicalOpId))) {
          continue;
        }

        const val = Number(deal.value || 0);
        const closedDate = deal.closed_at ? saoPauloDay(new Date(deal.closed_at)) : null;
        const createdDate = deal.created_at ? saoPauloDay(new Date(deal.created_at)) : null;
        const isEffectiveWon =
          deal.status === "won" || (deal.status === "open" && Boolean(stage?.isWinStage));
        const isEffectiveOpen = deal.status === "open" && !stage?.isWinStage;

        const dealMonth = (closedDate || createdDate || "").slice(0, 7);

        if (stage) {
          const pKey = stage.pipelineName;
          if (!pipelineSummaryMap.has(pKey)) {
            pipelineSummaryMap.set(pKey, {
              pipelineName: pKey,
              openCount: 0,
              openValue: 0,
              wonMonthCount: 0,
              wonMonthValue: 0,
            });
          }
          const pEntry = pipelineSummaryMap.get(pKey);
          if (isEffectiveOpen) {
            pEntry.openCount += 1;
            pEntry.openValue += val;
          }
          if (isEffectiveWon && dealMonth === month) {
            pEntry.wonMonthCount += 1;
            pEntry.wonMonthValue += val;
          }
        }

        if (isEffectiveOpen) {
          totalOpenCount += 1;
          totalOpenValue += val;
          if (canonicalOpId && byConsultant.has(canonicalOpId)) {
            const entry = byConsultant.get(canonicalOpId);
            entry.openCount += 1;
            entry.openValue += val;
          }
        }

        if (isEffectiveWon && dealMonth === month) {
          totalWonMonthCount += 1;
          totalWonMonthValue += val;
          if (canonicalOpId && byConsultant.has(canonicalOpId)) {
            const entry = byConsultant.get(canonicalOpId);
            entry.wonCount += 1;
            entry.wonValue += val;
          }
        }

        if (deal.status === "lost" && dealMonth === month) {
          totalLostMonthCount += 1;
          const category = categorizeLossReason(deal.loss_reason || "Não especificado");
          lossCategoriesCounter[category] = (lossCategoriesCounter[category] || 0) + 1;
          if (canonicalOpId && byConsultant.has(canonicalOpId)) {
            byConsultant.get(canonicalOpId).lostCountMonth += 1;
          }
        }
      }

      const totalGoal = Array.from(byConsultant.values()).reduce(
        (s, c) => s + c.targetValue,
        0,
      );
      const referenceDay = month === today.slice(0, 7) ? today : `${month}-28`;
      const pacing = calculateBusinessPacing(
        month,
        referenceDay,
        totalGoal,
        totalWonMonthValue,
        calendarRows.map((c: any) => ({
          date: c.date,
          type: c.type,
          affectsGoal: c.affects_goal,
        })),
      );

      const consultantsRanking = Array.from(byConsultant.values())
        .map((c) => ({
          ...c,
          wonValue: Math.round(c.wonValue * 100) / 100,
          openValue: Math.round(c.openValue * 100) / 100,
          attainmentPercent: roundPercent(
            c.targetValue > 0 ? (c.wonValue / c.targetValue) * 100 : 0,
            1,
          ),
        }))
        .sort((a, b) => b.wonValue - a.wonValue);

      return {
        tenantId,
        month,
        division: division || "all",
        summary: {
          totalGoal: Math.round(totalGoal * 100) / 100,
          totalWonMonthValue: Math.round(totalWonMonthValue * 100) / 100,
          totalWonMonthCount,
          attainmentPercent: roundPercent(
            totalGoal > 0 ? (totalWonMonthValue / totalGoal) * 100 : 0,
            1,
          ),
          totalOpenValue: Math.round(totalOpenValue * 100) / 100,
          totalOpenCount,
          totalLostMonthCount,
          pacing,
        },
        consultantsRanking,
        pipelinesSummary: Array.from(pipelineSummaryMap.values()).map((p) => ({
          ...p,
          openValue: Math.round(p.openValue * 100) / 100,
          wonMonthValue: Math.round(p.wonMonthValue * 100) / 100,
        })),
        lossReasonsByCategoryMonth: lossCategoriesCounter,
      };
    }

    case "get_rodizio_and_operators_status": {
      const [operatorsRows, sectorsRows, sdrConfigRows, activeChatsByOp] = await Promise.all([
        sql`
          SELECT id, name, email, role, status, is_online
          FROM operators
          WHERE tenant_id = ${tenantId}
          ORDER BY name ASC
        `,
        sql`
          SELECT id, name, operator_ids
          FROM sectors
          WHERE tenant_id = ${tenantId}
          ORDER BY name ASC
        `,
        sql`
          SELECT agent_type, config, enabled, updated_at
          FROM agent_configs
          WHERE tenant_id = ${tenantId} AND agent_type IN ('rodizio', 'sdr')
        `,
        sql`
          SELECT operator_id, COUNT(*)::int AS active_chats
          FROM conversations
          WHERE tenant_id = ${tenantId} AND queue_state = 'meus' AND operator_id IS NOT NULL
          GROUP BY operator_id
        `,
      ]);

      const activeMap = new Map<string, number>(
        activeChatsByOp.map((r: any) => [String(r.operator_id), Number(r.active_chats)]),
      );
      const rodizioRow = sdrConfigRows.find((r: any) => r.agent_type === "rodizio");
      const sdrRow = sdrConfigRows.find((r: any) => r.agent_type === "sdr");
      const rodizioConfig = rodizioRow?.config || sdrRow?.config || {};
      const flowOperators = Array.isArray(rodizioConfig.flowOperators)
        ? rodizioConfig.flowOperators
        : [];

      const validOperatorIdsSet = new Set<string>(
        operatorsRows.map((op: any) => String(op.id)),
      );

      return {
        tenantId,
        sdrEnabled: Boolean(sdrRow?.enabled),
        totalOperators: operatorsRows.length,
        flowScaleOperatorsCount: flowOperators.length,
        flowScaleByArea: flowOperators.map((fo: any) => {
          const opId = fo.id || fo.operatorId;
          return {
            operatorId: opId,
            name: fo.name,
            area: fo.area,
            funnels: fo.funnels || [],
            isInFlow: fo.isParticipating !== undefined ? Boolean(fo.isParticipating) : fo.isInFlow !== false,
            onLeave: Boolean(fo.isOnLeave ?? fo.onLeave),
            compensationBalance: Number(fo.compensation || 0),
            activeChatsNow: activeMap.get(String(opId)) || 0,
          };
        }),
        sectors: sectorsRows.map((s: any) => {
          const validIds = Array.isArray(s.operator_ids)
            ? Array.from(
                new Set(
                  s.operator_ids.filter(
                    (id: unknown): id is string =>
                      typeof id === "string" && validOperatorIdsSet.has(id),
                  ),
                ),
              )
            : [];
          return {
            id: s.id,
            name: s.name,
            operatorCount: validIds.length,
            operatorIds: validIds,
          };
        }),
        operators: operatorsRows.map((op: any) => ({
          id: op.id,
          name: op.name,
          email: op.email,
          role: op.role,
          status: op.status,
          isOnline: op.is_online,
          activeChatsNow: activeMap.get(op.id) || 0,
        })),
      };
    }

    case "get_marketing_audit_batch": {
      const dealIds = Array.isArray(args.dealIds)
        ? args.dealIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
        : undefined;
      return await getMarketingAuditBatch(
        tenantId,
        {
          dealIds,
          campaign: args.campaign ? String(args.campaign) : null,
          utmCampaign: args.utmCampaign ? String(args.utmCampaign) : null,
          source: args.source ? String(args.source) : null,
          sectorOrigin: args.sectorOrigin ? String(args.sectorOrigin) : null,
          sectorCurrent: args.sectorCurrent ? String(args.sectorCurrent) : null,
          createdFrom: args.createdFrom ? String(args.createdFrom) : null,
          createdTo: args.createdTo ? String(args.createdTo) : null,
          limit: clampLimit(args.limit, 20, 50),
        },
        sql,
      );
    }

    default:
      throw new Error(`Ferramenta desconhecida: ${toolName}`);
  }
}

export async function handleSingleJsonRpcMessage(
  msg: any,
  access?: McpAccessContext,
  sql: any = defaultSqlClient,
): Promise<any | null> {
  if (!msg || typeof msg !== "object") return null;

  // Suporte tanto para JSON-RPC padrão quanto chamadas REST diretas { tool, arguments }
  const isDirectToolCall =
    !msg.method && (typeof msg.tool === "string" || typeof msg.toolName === "string");
  const method: string = isDirectToolCall
    ? "tools/call"
    : String(msg.method || "");
  const params: any = isDirectToolCall
    ? {
        name: msg.tool || msg.toolName,
        arguments:
          msg.arguments && typeof msg.arguments === "object"
            ? msg.arguments
            : msg.params && typeof msg.params === "object"
              ? msg.params
              : {},
      }
    : msg.params;

  const hasExplicitId = msg.id !== undefined && msg.id !== null;
  const id = hasExplicitId
    ? msg.id
    : method === "tools/call" || method === "initialize" || method === "tools/list"
      ? `mcp-${Date.now()}`
      : null;

  // Notificações JSON-RPC (ex: notifications/initialized) sem id não geram resposta
  if (id === null || method.startsWith("notifications/")) {
    return null;
  }

  const defaultTenant: "tecfag" | "valem" =
    access?.lockedTenantId || access?.defaultTenantId || "tecfag";

  try {
    if (method === "initialize") {
      const startedAt = Date.now();
      const clientVersion = params?.protocolVersion || "2024-11-05";
      const rawClientName = params?.clientInfo?.name
        ? `${params.clientInfo.name}${params.clientInfo.version ? ` v${params.clientInfo.version}` : ""}`
        : undefined;
      const effectiveClientName = rawClientName || access?.clientName || "Cliente MCP";

      if (access?.sessionId && rawClientName) {
        updateMcpSessionClient(access.sessionId, rawClientName);
      }

      const responsePayload = {
        protocolVersion: clientVersion,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: MCP_SERVER_INFO,
      };
      const jsonText = JSON.stringify(responsePayload, null, 2);

      await recordMcpToolAuditLog({
        tenantId: defaultTenant,
        access,
        toolName: "mcp_initialize",
        toolLabel: "Conexão Inicializada (Handshake MCP)",
        toolArgs: {
          protocolVersion: clientVersion,
          client: effectiveClientName,
        },
        argumentsSummary: `Cliente: ${effectiveClientName} · Protocolo ${clientVersion}`,
        resultSummary: `Conectado com sucesso (${effectiveClientName})`,
        status: "success",
        latencyMs: Date.now() - startedAt,
        eventType: "connection",
        clientName: effectiveClientName,
        responseBytes: Buffer.byteLength(jsonText, "utf8"),
        responsePreview: JSON.stringify(
          {
            handshake: "initialize",
            clientInfo: params?.clientInfo || { name: effectiveClientName },
            protocolVersion: clientVersion,
            serverInfo: responsePayload.serverInfo,
          },
          null,
          2,
        ),
      });

      return {
        jsonrpc: "2.0",
        id,
        result: responsePayload,
      };
    }

    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    if (method === "tools/list") {
      const startedAt = Date.now();
      const visibleTools = getVisibleMcpTools(access);
      const protocolTools = visibleTools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      }));
      const accessLabel = access?.accessLevel === "read_write" ? "Leitura + Escrita" : "Somente Leitura";
      const previewObj = {
        accessLevel: access?.accessLevel || "read",
        totalTools: protocolTools.length,
        tools: protocolTools.map((t) => ({ name: t.name, description: t.description.slice(0, 90) })),
      };
      const fullJson = JSON.stringify({ tools: protocolTools });

      await recordMcpToolAuditLog({
        tenantId: defaultTenant,
        access,
        toolName: "mcp_tools_list",
        toolLabel: "Sincronização de Ferramentas (tools/list)",
        toolArgs: { accessLevel: access?.accessLevel || "read" },
        argumentsSummary: `Listagem de ferramentas MCP (${accessLabel})`,
        resultSummary: `${protocolTools.length} ferramentas sincronizadas (${accessLabel})`,
        status: "success",
        latencyMs: Date.now() - startedAt,
        eventType: "connection",
        responseBytes: Buffer.byteLength(fullJson, "utf8"),
        responsePreview: JSON.stringify(previewObj, null, 2),
      });

      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: protocolTools,
        },
      };
    }

    if (method === "resources/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          resources: [],
        },
      };
    }

    if (method === "prompts/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          prompts: [],
        },
      };
    }

    if (method === "tools/call") {
      const toolName = String(params?.name || "");
      const toolArgs =
        params?.arguments && typeof params.arguments === "object" ? params.arguments : {};
      const startedAt = Date.now();
      let effectiveTenant: "tecfag" | "valem" = defaultTenant;
      try {
        effectiveTenant = resolveEffectiveTenantId(toolArgs.tenantId, access);
      } catch {
        effectiveTenant = defaultTenant;
      }
      try {
        const data = await executeMcpTool(toolName, toolArgs, access, sql);
        const latencyMs = Date.now() - startedAt;
        const jsonText = JSON.stringify(data, null, 2);
        const responseBytes = Buffer.byteLength(jsonText, "utf8");
        const responsePreview =
          jsonText.length > 1800
            ? `${jsonText.slice(0, 1800)}\n... [truncado no preview · total ${responseBytes.toLocaleString("pt-BR")} bytes enviados]`
            : jsonText;

        await recordMcpToolAuditLog({
          tenantId: effectiveTenant,
          access,
          toolName,
          toolArgs,
          resultSummary: summarizeMcpToolResult(toolName, data),
          status: "success",
          latencyMs,
          eventType: isWriteMcpTool(toolName) ? "action" : "query",
          responseBytes,
          responsePreview,
        });
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: jsonText,
              },
            ],
            isError: false,
          },
        };
      } catch (toolError) {
        const latencyMs = Date.now() - startedAt;
        const errMsg = toolError instanceof Error ? toolError.message : String(toolError);
        const errJson = JSON.stringify({ error: errMsg }, null, 2);
        await recordMcpToolAuditLog({
          tenantId: effectiveTenant,
          access,
          toolName,
          toolArgs,
          resultSummary: `Erro: ${errMsg}`,
          status: "error",
          latencyMs,
          eventType: isWriteMcpTool(toolName) ? "action" : "query",
          responseBytes: Buffer.byteLength(errJson, "utf8"),
          responsePreview: errJson,
        });
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: errJson,
              },
            ],
            isError: true,
          },
        };
      }
    }

    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    };
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: err instanceof Error ? err.message : "Internal MCP error",
      },
    };
  }
}

export async function processMcpJsonRpcPayload(
  payload: unknown,
  access?: McpAccessContext,
  sql: any = defaultSqlClient,
): Promise<{ status: number; body: any | null }> {
  if (Array.isArray(payload)) {
    const responses = (
      await Promise.all(payload.map((item) => handleSingleJsonRpcMessage(item, access, sql)))
    ).filter((r) => r !== null);
    if (responses.length === 0) {
      return { status: 202, body: null };
    }
    return { status: 200, body: responses };
  }

  const single = await handleSingleJsonRpcMessage(payload, access, sql);
  if (single === null) {
    return { status: 202, body: null };
  }
  return { status: 200, body: single };
}
