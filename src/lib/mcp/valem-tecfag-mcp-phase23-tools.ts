import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  agentFlowStates,
  contactPhones,
  contacts,
  conversationDealContexts,
  conversations,
  crmActionHistory,
  crmConversationDeals,
  crmDealContacts,
  crmDeals,
  crmPipelines,
  crmProducts,
  crmStages,
  messages,
  operators,
  webhookSubscriptions,
} from "../../db/schema";
import { crmService } from "../crm/crm-service";
import { listCustomFields } from "../crm/custom-fields";
import { outboundQueue } from "../whatsapp/outbound";
import { resolveConversationConnection } from "../whatsapp/connections";
import { SessionManager } from "../baileys/session-manager";
import { SdrDebouncer } from "../valentina/sdr-debouncer";
import { getAiPersona } from "../ai-persona";
import {
  hashIdempotencyPayload,
  lookupMcpIdempotency,
  saveMcpIdempotency,
} from "./mcp-idempotency";
import {
  SUPPORTED_WEBHOOK_EVENTS,
  dispatchWebhook,
  ensureWebhookSubscriptionsSchema,
  listTenantWebhookDeliveries,
  retryWebhookDelivery,
  validateWebhookTargetUrl,
} from "../webhooks/dispatcher";
import type { McpToolDefinition, McpWriteActorContext } from "./valem-tecfag-mcp-write-tools";

export const BATCH_UPSERT_MAX_ITEMS = 500;
export const BATCH_UPSERT_CONCURRENCY = 6;

const TENANT_ID_PROP = {
  type: "string",
  enum: ["tecfag", "valem"],
  default: "tecfag",
  description: "Tenant alvo ('tecfag' ou 'valem'). Ignorado quando a chave MCP está travada em um tenant.",
};

export const MCP_PHASE23_TOOLS: McpToolDefinition[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 2 — ITEM 4: VÍNCULO BIDIRECIONAL CONVERSA ↔ CARD & CONTATO DA CONVERSA
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "get_deal_conversations",
    access: "read",
    description:
      "Consulta bidirecional entre conversas e cards do CRM: dado um 'dealId', retorna todas as conversas vinculadas (vínculo direto e via contatos do card); dado um 'conversationId', retorna os cards vinculados e o card em contexto ativo.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        dealId: { type: "string", description: "ID do card/negociação para listar suas conversas." },
        conversationId: { type: "string", description: "ID da conversa para listar seus cards vinculados." },
      },
    },
  },
  {
    name: "link_conversation_deal",
    access: "write",
    description:
      "[ESCRITA] Vincula uma conversa existente a um card existente do CRM (idempotente), garantindo a participação do contato no card e atualizando opcionalmente o contexto ativo da conversa.",
    inputSchema: {
      type: "object",
      required: ["conversationId", "dealId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        conversationId: { type: "string", description: "ID da conversa (conversations.id)." },
        dealId: { type: "string", description: "ID da negociação (crm_deals.id)." },
        origin: {
          type: "string",
          enum: ["chat", "crm", "auto_sdr"],
          default: "crm",
          description: "Origem do vínculo (padrão: 'crm').",
        },
        setAsActiveContext: {
          type: "boolean",
          default: true,
          description: "Quando true (padrão), define este card como o contexto ativo exibido na conversa.",
        },
        operatorId: { type: "string", description: "ID do operador autor do vínculo (opcional)." },
      },
    },
  },
  {
    name: "unlink_conversation_deal",
    access: "write",
    description:
      "[ESCRITA] Desvincula uma conversa de um card existente do CRM. Por padrão protege contra deixar a conversa sem nenhum card vinculado; passe forceUnlinkLast=true para desvincular mesmo quando for o único vínculo ativo.",
    inputSchema: {
      type: "object",
      required: ["conversationId", "dealId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        conversationId: { type: "string", description: "ID da conversa." },
        dealId: { type: "string", description: "ID da negociação." },
        forceUnlinkLast: {
          type: "boolean",
          default: false,
          description: "Quando true, permite desvincular mesmo se este for o único card ativo ligado à conversa.",
        },
        operatorId: { type: "string", description: "ID do operador autor do desvínculo (opcional)." },
      },
    },
  },
  {
    name: "reassign_conversation_contact",
    access: "write",
    description:
      "[ESCRITA] Troca o contato associado a uma conversa existente, validando o índice único por conexão WhatsApp (retorna erro claro se o contato destino já possuir conversa na mesma conexão) e registrando auditoria.",
    inputSchema: {
      type: "object",
      required: ["conversationId", "newContactId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        conversationId: { type: "string", description: "ID da conversa." },
        newContactId: { type: "string", description: "ID do novo contato dono da conversa." },
        reason: { type: "string", description: "Motivo da troca (gravado em auditoria)." },
        operatorId: { type: "string", description: "ID do operador autor (opcional)." },
        actorName: { type: "string", description: "Nome legível de quem solicitou a troca (opcional)." },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 2 — ITEM 8: OPERAÇÃO EM LOTE COM IDEMPOTÊNCIA E RETORNO ITEM A ITEM
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "batch_upsert_crm_deals",
    access: "write",
    description:
      "[ESCRITA] Cria ou atualiza vários cards/contatos em uma única chamada (até 500 itens), com concorrência controlada, isolamento por item, retorno detalhado item a item e garantia real de idempotência (repetir a mesma chamada com a mesma idempotencyKey nunca duplica cards).",
    inputSchema: {
      type: "object",
      required: ["items"],
      properties: {
        tenantId: TENANT_ID_PROP,
        idempotencyKey: {
          type: "string",
          description: "Chave de referência do lote (ex: 'dist-2026-11-19-lote-1'). Combinada com o índice de cada item quando o item não trouxer sua própria idempotencyKey.",
        },
        actorOperatorId: {
          type: "string",
          description: "ID do operador autor padrão para auditoria dos itens (opcional).",
        },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 500,
          description: "Lista de até 500 itens para criar (sem dealId) ou atualizar (com dealId).",
          items: {
            type: "object",
            properties: {
              idempotencyKey: { type: "string", description: "Chave idempotente única deste item (ex: ID do lead no RD ou linha da planilha)." },
              dealId: { type: "string", description: "Se informado, atualiza este card existente; se omitido, cria um card novo." },
              title: { type: "string", description: "Título do card (obrigatório ao criar)." },
              pipelineId: { type: "string" },
              pipelineName: { type: "string" },
              stageId: { type: "string" },
              stageName: { type: "string" },
              value: { type: ["number", "null"] },
              operatorId: { type: ["string", "null"] },
              accountId: { type: ["string", "null"] },
              contactId: { type: "string" },
              contactIds: { type: "array", items: { type: "string" } },
              contact: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  phone: { type: "string" },
                  email: { type: "string" },
                },
                required: ["name"],
              },
              conversationId: { type: "string" },
              source: { type: ["string", "null"] },
              campaign: { type: ["string", "null"] },
              expectedCloseDate: { type: ["string", "null"] },
              rating: { type: "number" },
              initialNote: { type: "string" },
              customFields: { type: "object" },
            },
          },
        },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 3 — ITEM 5: ENVIAR MÍDIA NO CHAT + PRODUTOS E PROPOSTAS NO CARD
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "chat_send_media",
    access: "write",
    description:
      "[ESCRITA] Envia mídia real (imagem, PDF/documento, áudio ou vídeo) com legenda opcional em uma conversa via WhatsApp (Meta Cloud API ou Baileys), validando URL HTTPS segura e a janela de 24h da Meta.",
    inputSchema: {
      type: "object",
      required: ["conversationId", "mediaType", "mediaUrl"],
      properties: {
        tenantId: TENANT_ID_PROP,
        conversationId: { type: "string", description: "ID da conversa de destino." },
        mediaType: {
          type: "string",
          enum: ["image", "document", "audio", "video"],
          description: "Tipo da mídia: 'image' (foto/catálogo), 'document' (PDF/proposta), 'audio' ou 'video'.",
        },
        mediaUrl: {
          type: "string",
          description: "URL HTTPS pública e acessível do arquivo de mídia (não aceita IPs privados/localhost).",
        },
        caption: {
          type: "string",
          description: "Legenda opcional (suportada em imagem, documento e vídeo).",
        },
        fileName: {
          type: "string",
          description: "Nome do arquivo exibido ao cliente (recomendado para PDFs, ex: 'Proposta-Tecfag.pdf').",
        },
        operatorId: { type: "string", description: "ID do operador remetente (opcional)." },
        senderName: { type: "string", description: "Nome de exibição do remetente (opcional)." },
        idempotencyKey: { type: "string", description: "Chave de idempotência para evitar reenvio duplicado." },
      },
    },
  },
  {
    name: "list_crm_products",
    access: "read",
    description:
      "Lista os produtos/máquinas cadastrados no catálogo do CRM do tenant (com preço, unidade, SKU e categoria). Quando 'dealId' é informado, retorna também os itens já vinculados àquele card.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        search: { type: "string", description: "Filtro por nome, SKU, categoria ou descrição." },
        onlyActive: { type: "boolean", default: true, description: "Retornar apenas produtos ativos (padrão: true)." },
        dealId: { type: "string", description: "Opcional: retorna também os itens já adicionados a este card." },
      },
    },
  },
  {
    name: "add_deal_product",
    access: "write",
    description:
      "[ESCRITA] Adiciona um item de produto/máquina a um card do CRM (com quantidade, preço unitário e desconto opcional) e recalcula automaticamente o valor total do card.",
    inputSchema: {
      type: "object",
      required: ["dealId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        dealId: { type: "string", description: "ID da negociação (crm_deals.id)." },
        productId: { type: "string", description: "ID do produto no catálogo (crm_products.id) — preenche nome e preço automaticamente se omitidos." },
        name: { type: "string", description: "Nome do produto/máquina (obrigatório quando productId não for informado)." },
        quantity: { type: "number", default: 1, description: "Quantidade (> 0, padrão: 1)." },
        unitPrice: { type: "number", description: "Valor unitário em BRL (>= 0)." },
        discountPercent: { type: "number", default: 0, description: "Desconto percentual (0 a 100)." },
        discountAmount: { type: "number", description: "Desconto fixo em BRL (alternativa a discountPercent)." },
        notes: { type: "string", description: "Observações técnicas/comerciais do item (opcional)." },
        operatorId: { type: "string", description: "ID do operador autor (opcional)." },
      },
    },
  },
  {
    name: "remove_deal_product",
    access: "write",
    description:
      "[ESCRITA] Remove um item de produto (dealProductId) de um card do CRM e recalcula automaticamente o valor total da negociação.",
    inputSchema: {
      type: "object",
      required: ["dealId", "dealProductId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        dealId: { type: "string", description: "ID da negociação." },
        dealProductId: { type: "string", description: "ID do item na negociação (crm_deal_products.id)." },
        operatorId: { type: "string", description: "ID do operador autor (opcional)." },
      },
    },
  },
  {
    name: "create_deal_proposal",
    access: "write",
    description:
      "[ESCRITA] Emite e anexa uma proposta comercial formal ao card com numeração sequencial segura (PROP-YYYY-NNNN) e snapshot imutável dos produtos e valores.",
    inputSchema: {
      type: "object",
      required: ["dealId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        dealId: { type: "string", description: "ID da negociação." },
        title: { type: "string", description: "Título da proposta (opcional)." },
        paymentTerms: { type: "string", description: "Condições de pagamento (ex: '50% entrada + 50% na entrega')." },
        deliveryTerms: { type: "string", description: "Prazo e condições de entrega/frete." },
        validityDays: { type: "number", default: 15, description: "Validade da proposta em dias (padrão: 15)." },
        notes: { type: "string", description: "Observações adicionais da proposta." },
        operatorId: { type: "string", description: "ID do operador autor (opcional)." },
      },
    },
  },
  {
    name: "list_deal_proposals",
    access: "read",
    description:
      "Consulta todas as propostas comerciais já emitidas e anexadas a um card específico do CRM (com número, status, itens, totais e validade).",
    inputSchema: {
      type: "object",
      required: ["dealId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        dealId: { type: "string", description: "ID da negociação." },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 3 — ITEM 6: AVISO DE CONVERSA/MENSAGEM NOVA (WEBHOOKS COM RETRY & LOG)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "list_webhook_subscriptions",
    access: "read",
    description:
      "Lista as subscrições de webhook de saída configuradas no tenant (para eventos em tempo real como conversation.created e message.received) e o catálogo oficial de eventos suportados.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
      },
    },
  },
  {
    name: "upsert_webhook_subscription",
    access: "write",
    description:
      "[ESCRITA] Cria, atualiza (ativar/desativar/trocar eventos/rotacionar secret) ou remove uma subscrição de webhook de saída para receber avisos em tempo real de conversa nova e mensagem nova com assinatura HMAC-SHA256 e retry automático.",
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        tenantId: TENANT_ID_PROP,
        action: {
          type: "string",
          enum: ["create", "update", "delete"],
          description: "Ação a executar na subscrição.",
        },
        subscriptionId: {
          type: "string",
          description: "ID da subscrição (obrigatório para 'update' e 'delete').",
        },
        name: { type: "string", description: "Nome descritivo (ex: 'Receptor IA Tempo Real')." },
        url: { type: "string", description: "URL HTTPS de destino que receberá os POSTs assinados." },
        events: {
          type: "array",
          items: { type: "string", enum: [...SUPPORTED_WEBHOOK_EVENTS] },
          description: "Lista de eventos assinados (ex: ['conversation.created', 'message.received']).",
        },
        isActive: { type: "boolean", description: "Ativar (true) ou pausar (false) a subscrição." },
        rotateSecret: { type: "boolean", default: false, description: "Quando true em 'update', gera um novo secret HMAC." },
      },
    },
  },
  {
    name: "list_webhook_deliveries",
    access: "read",
    description:
      "Consulta a fila e o histórico de entregas de webhooks do tenant (status delivered/retrying/failed/pending, tentativas, código HTTP, erro e próxima retentativa).",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        subscriptionId: { type: "string", description: "Filtrar por subscrição específica." },
        eventType: { type: "string", description: "Filtrar por tipo de evento (ex: 'message.received')." },
        status: {
          type: "string",
          enum: ["pending", "retrying", "delivered", "failed"],
          description: "Filtrar por status da entrega.",
        },
        limit: { type: "number", default: 30, description: "Quantidade máxima de registros (1 a 100)." },
      },
    },
  },
  {
    name: "retry_webhook_delivery",
    access: "write",
    description:
      "[ESCRITA] Força o reenvio imediato de uma entrega de webhook específica (útil quando o receptor ficou fora do ar e voltou a operar).",
    inputSchema: {
      type: "object",
      required: ["deliveryId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        deliveryId: { type: "string", description: "ID da entrega em webhook_deliveries." },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 3 — ITEM 7: CONTROLE FINO DA TRIAGEM DO FAGNER POR CONVERSA
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "set_conversation_triage_mode",
    access: "write",
    description:
      "[ESCRITA] Controla com dupla trava o atendimento automático do assistente IA (SDR) em uma conversa específica: 'pause_ai' (pausa robô e cancela debouncer), 'resume_ai' (retoma robô), 'set_manual' (marca atendimento manual com operador opcional e silencia robô) ou 'unset_manual' (devolve à automação).",
    inputSchema: {
      type: "object",
      required: ["conversationId", "action"],
      properties: {
        tenantId: TENANT_ID_PROP,
        conversationId: { type: "string", description: "ID da conversa." },
        action: {
          type: "string",
          enum: ["pause_ai", "resume_ai", "set_manual", "unset_manual"],
          description: "Ação de controle da triagem na conversa.",
        },
        operatorId: {
          type: "string",
          description: "ID do operador responsável (usado em 'set_manual' para colocar na aba 'meus' do vendedor; se omitido, move para 'fila' humana).",
        },
        reason: { type: "string", description: "Motivo da pausa/assunção manual (registrado em auditoria)." },
        actorName: { type: "string", description: "Nome de quem acionou o controle (opcional)." },
      },
    },
  },
  {
    name: "get_triage_summary",
    access: "read",
    description:
      "Lê o estado atual da triagem IA da conversa (se está ativa, pausada ou manual, operador responsável, etapa atual), os dados coletados (collectedData) e o resumo estruturado da triagem.",
    inputSchema: {
      type: "object",
      required: ["conversationId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        conversationId: { type: "string", description: "ID da conversa." },
      },
    },
  },
  {
    name: "update_triage_summary",
    access: "write",
    description:
      "[ESCRITA] Grava ou atualiza o resumo estruturado e os dados coletados da triagem de uma conversa (em agent_flow_states), opcionalmente registrando uma nota interna para o vendedor humano entrar já contextualizado.",
    inputSchema: {
      type: "object",
      required: ["conversationId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        conversationId: { type: "string", description: "ID da conversa." },
        summary: { type: "string", description: "Texto consolidado do resumo da triagem para o vendedor." },
        collectedData: {
          type: "object",
          description: "Mapa de dados coletados na triagem (faz merge preservando chaves anteriores).",
        },
        currentStep: { type: "string", description: "Etapa atual da triagem (opcional)." },
        postInternalNote: {
          type: "boolean",
          default: false,
          description: "Quando true, também grava o resumo como nota interna amarela visível na linha do tempo do chat.",
        },
        operatorId: { type: "string", description: "ID do operador autor (opcional)." },
        actorName: { type: "string", description: "Nome de quem gravou o resumo (opcional)." },
      },
    },
  },
];

export const MCP_PHASE23_TOOL_LABELS_PT: Record<string, string> = {
  get_deal_conversations: "Consultar Vínculos Conversa ↔ Card",
  link_conversation_deal: "Vincular Conversa a Card (CRM)",
  unlink_conversation_deal: "Desvincular Conversa de Card (CRM)",
  reassign_conversation_contact: "Trocar Contato da Conversa",
  batch_upsert_crm_deals: "Operação em Lote de Cards (Idempotente)",
  chat_send_media: "Enviar Mídia no Chat (Imagem/PDF/Áudio)",
  list_crm_products: "Listar Produtos / Máquinas (CRM)",
  add_deal_product: "Adicionar Produto ao Card (CRM)",
  remove_deal_product: "Remover Produto do Card (CRM)",
  create_deal_proposal: "Criar Proposta Comercial no Card",
  list_deal_proposals: "Listar Propostas do Card (CRM)",
  list_webhook_subscriptions: "Listar Webhooks de Saída",
  upsert_webhook_subscription: "Configurar Webhook de Saída",
  list_webhook_deliveries: "Consultar Entregas / Logs de Webhooks",
  retry_webhook_delivery: "Reenviar Entrega de Webhook",
  set_conversation_triage_mode: "Controlar Triagem IA (Pausar/Retomar/Manual)",
  get_triage_summary: "Ler Resumo e Estado da Triagem IA",
  update_triage_summary: "Gravar Resumo da Triagem IA",
};

const PHASE23_NAMES = new Set(MCP_PHASE23_TOOLS.map((t) => t.name));

export function isPhase23McpTool(name: string): boolean {
  return PHASE23_NAMES.has(name);
}

function asTrimmedString(val: unknown): string | undefined {
  if (typeof val !== "string") return undefined;
  const trimmed = val.trim();
  return trimmed.length ? trimmed : undefined;
}

function parseOptionalDate(val: unknown, fieldName: string): Date | undefined {
  if (val === undefined || val === null || val === "") return undefined;
  const parsed = new Date(String(val));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Data inválida em '${fieldName}': '${String(val)}'. Use formato ISO 8601.`);
  }
  return parsed;
}

function buildActorDisplayName(
  explicitName: string | undefined,
  operatorName: string | undefined,
  actor?: McpWriteActorContext,
): string {
  if (explicitName) return explicitName;
  if (operatorName) return operatorName;
  if (actor?.keyLabel) return `MCP (${actor.keyLabel})`;
  return "MCP";
}

function emitSseSafe(tenantId: string, event: Record<string, unknown>): void {
  try {
    SessionManager.getInstance().notifyPublic(
      tenantId,
      event as Parameters<SessionManager["notifyPublic"]>[1],
    );
  } catch (err) {
    console.warn("[MCP SSE] Evento persistido, mas broadcast SSE indisponível:", err);
  }
}

async function assertOperatorInTenant(
  tenantId: string,
  operatorId: string | undefined,
): Promise<{ id: string; name: string; email: string } | null> {
  if (!operatorId) return null;
  const [op] = await db
    .select({ id: operators.id, name: operators.name, email: operators.email })
    .from(operators)
    .where(and(eq(operators.id, operatorId), eq(operators.tenantId, tenantId)))
    .limit(1);
  if (!op) {
    throw new Error(`Operador '${operatorId}' não encontrado no tenant '${tenantId}'.`);
  }
  return op;
}

async function resolvePipelineAndStage(
  tenantId: string,
  opts: {
    pipelineId?: string;
    pipelineName?: string;
    stageId?: string;
    stageName?: string;
    fallbackPipelineId?: string;
  },
): Promise<{ pipelineId: string; stageId: string; stageName: string }> {
  let pipelineId = opts.pipelineId || opts.fallbackPipelineId;

  if (!pipelineId && opts.pipelineName) {
    const allPipes = await db
      .select({ id: crmPipelines.id, name: crmPipelines.name })
      .from(crmPipelines)
      .where(eq(crmPipelines.tenantId, tenantId));
    const needle = opts.pipelineName.toLowerCase();
    const matched =
      allPipes.find((p) => p.name.toLowerCase() === needle) ||
      allPipes.find((p) => p.name.toLowerCase().includes(needle));
    if (!matched) {
      throw new Error(`Funil '${opts.pipelineName}' não encontrado no tenant '${tenantId}'.`);
    }
    pipelineId = matched.id;
  }

  if (opts.stageId) {
    const [st] = await db
      .select({ id: crmStages.id, name: crmStages.name, pipelineId: crmStages.pipelineId })
      .from(crmStages)
      .where(and(eq(crmStages.id, opts.stageId), eq(crmStages.tenantId, tenantId)))
      .limit(1);
    if (!st) {
      throw new Error(`Etapa '${opts.stageId}' não encontrada no tenant '${tenantId}'.`);
    }
    if (pipelineId && st.pipelineId !== pipelineId) {
      throw new Error(`Etapa '${opts.stageId}' não pertence ao funil '${pipelineId}'.`);
    }
    return { pipelineId: st.pipelineId, stageId: st.id, stageName: st.name };
  }

  if (!pipelineId) {
    const [defaultPipe] = await db
      .select({ id: crmPipelines.id })
      .from(crmPipelines)
      .where(eq(crmPipelines.tenantId, tenantId))
      .orderBy(asc(crmPipelines.orderIndex), asc(crmPipelines.createdAt))
      .limit(1);
    if (!defaultPipe) {
      throw new Error(`Nenhum funil CRM cadastrado no tenant '${tenantId}'.`);
    }
    pipelineId = defaultPipe.id;
  }

  const pipeStages = await db
    .select({ id: crmStages.id, name: crmStages.name, orderIndex: crmStages.orderIndex })
    .from(crmStages)
    .where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.pipelineId, pipelineId)))
    .orderBy(asc(crmStages.orderIndex));

  if (!pipeStages.length) {
    throw new Error(`Funil '${pipelineId}' não possui etapas cadastradas.`);
  }

  if (opts.stageName) {
    const needle = opts.stageName.toLowerCase();
    const matched =
      pipeStages.find((s) => s.name.toLowerCase() === needle) ||
      pipeStages.find((s) => s.name.toLowerCase().includes(needle));
    if (!matched) {
      throw new Error(
        `Etapa '${opts.stageName}' não encontrada no funil '${pipelineId}'. Etapas disponíveis: ${pipeStages.map((s) => s.name).join(", ")}.`,
      );
    }
    return { pipelineId, stageId: matched.id, stageName: matched.name };
  }

  return { pipelineId, stageId: pipeStages[0].id, stageName: pipeStages[0].name };
}

function validateSafeMediaUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`URL de mídia inválida: '${trimmed}'.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error("URL de mídia deve usar protocolo HTTPS público.");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new Error("URL de mídia apontando para endereço privado/interno não é permitida.");
  }
  return parsed.toString();
}

function maskSecret(secret: string): string {
  if (!secret || secret.length <= 8) return "****";
  return `${secret.slice(0, 6)}...${secret.slice(-4)}`;
}

async function resolveCustomFieldsInput(
  tenantId: string,
  rawCustomFields: Record<string, unknown>,
  preloadedDefs?: Awaited<ReturnType<typeof listCustomFields>>,
): Promise<Record<string, unknown>> {
  const defs = preloadedDefs ?? (await listCustomFields(tenantId, "deal"));
  const idSet = new Set(defs.map((d) => d.id));
  const idByLowerName = new Map(defs.map((d) => [d.name.trim().toLowerCase(), d.id]));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawCustomFields)) {
    if (idSet.has(k)) {
      out[k] = v;
    } else {
      out[idByLowerName.get(k.trim().toLowerCase()) || k] = v;
    }
  }
  return out;
}

export async function executePhase23McpTool(
  name: string,
  args: Record<string, unknown>,
  tenantId: "tecfag" | "valem",
  actor?: McpWriteActorContext,
): Promise<unknown> {
  switch (name) {
    // ── 1. GET DEAL CONVERSATIONS (READ — ITEM 4) ────────────────────────────
    case "get_deal_conversations": {
      const dealId = asTrimmedString(args.dealId);
      const conversationId = asTrimmedString(args.conversationId);
      if (!dealId && !conversationId) {
        throw new Error("Informe 'dealId' e/ou 'conversationId' para consultar os vínculos.");
      }

      const out: Record<string, unknown> = { tenantId };

      if (dealId) {
        const [deal] = await db
          .select({ id: crmDeals.id, title: crmDeals.title, status: crmDeals.status })
          .from(crmDeals)
          .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
          .limit(1);
        if (!deal) {
          throw new Error(`Negociação '${dealId}' não encontrada no tenant '${tenantId}'.`);
        }

        const directLinks = await db
          .select({
            linkId: crmConversationDeals.id,
            conversationId: crmConversationDeals.conversationId,
            origin: crmConversationDeals.origin,
            isActive: crmConversationDeals.isActive,
            createdAt: crmConversationDeals.createdAt,
          })
          .from(crmConversationDeals)
          .where(
            and(
              eq(crmConversationDeals.tenantId, tenantId),
              eq(crmConversationDeals.dealId, dealId),
              eq(crmConversationDeals.isActive, true),
            ),
          );

        const dealContactRows = await db
          .select({ contactId: crmDealContacts.contactId })
          .from(crmDealContacts)
          .where(and(eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.dealId, dealId)));
        const contactIds = dealContactRows.map((c) => c.contactId);

        const contactConvs = contactIds.length
          ? await db
              .select({ id: conversations.id })
              .from(conversations)
              .where(
                and(eq(conversations.tenantId, tenantId), inArray(conversations.contactId, contactIds)),
              )
          : [];

        const directSet = new Set(directLinks.map((l) => l.conversationId));
        const allConvIds = Array.from(
          new Set([...directLinks.map((l) => l.conversationId), ...contactConvs.map((c) => c.id)]),
        );

        const convRows = allConvIds.length
          ? await db
              .select({
                id: conversations.id,
                contactId: conversations.contactId,
                contactName: contacts.name,
                contactPhone: contacts.phone,
                queueState: conversations.queueState,
                operatorId: conversations.operatorId,
                whatsappConnectionId: conversations.whatsappConnectionId,
                lastMessageTime: conversations.lastMessageTime,
                lastMessageText: conversations.lastMessageText,
              })
              .from(conversations)
              .innerJoin(
                contacts,
                and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, tenantId)),
              )
              .where(and(eq(conversations.tenantId, tenantId), inArray(conversations.id, allConvIds)))
              .orderBy(desc(conversations.lastMessageTime))
          : [];

        out.deal = deal;
        out.conversations = convRows.map((c) => ({
          ...c,
          linkType: directSet.has(c.id) ? "direct" : "via_contact",
        }));
        out.totalConversations = convRows.length;
      }

      if (conversationId) {
        const [conv] = await db
          .select({
            id: conversations.id,
            contactId: conversations.contactId,
            queueState: conversations.queueState,
            operatorId: conversations.operatorId,
          })
          .from(conversations)
          .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
          .limit(1);
        if (!conv) {
          throw new Error(`Conversa '${conversationId}' não encontrada no tenant '${tenantId}'.`);
        }

        const [ctx] = await db
          .select({ currentDealId: conversationDealContexts.currentDealId })
          .from(conversationDealContexts)
          .where(
            and(
              eq(conversationDealContexts.tenantId, tenantId),
              eq(conversationDealContexts.conversationId, conversationId),
            ),
          )
          .limit(1);

        const linkedDeals = await crmService.getConversationDeals(tenantId, conversationId);
        out.conversation = conv;
        out.activeContextDealId = ctx?.currentDealId ?? null;
        out.deals = linkedDeals.map((d) => ({
          id: d.id,
          title: d.title,
          status: d.status,
          value: d.value,
          pipelineId: d.pipelineId,
          pipelineName: d.pipelineName ?? null,
          stageId: d.stageId,
          stageName: d.stageName ?? null,
          operatorId: d.operatorId,
          operatorName: d.operatorName ?? null,
          isLinked: d.isLinked,
          isActiveContext: ctx?.currentDealId === d.id,
        }));
        out.totalDeals = linkedDeals.length;
      }

      return out;
    }

    // ── 2. LINK CONVERSATION DEAL (WRITE — ITEM 4) ───────────────────────────
    case "link_conversation_deal": {
      const conversationId = asTrimmedString(args.conversationId);
      const dealId = asTrimmedString(args.dealId);
      if (!conversationId || !dealId) {
        throw new Error("Campos obrigatórios: 'conversationId' e 'dealId'.");
      }

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      const origin =
        args.origin === "chat" || args.origin === "auto_sdr" ? args.origin : "crm";
      const setAsActiveContext = args.setAsActiveContext !== false;

      const link = await crmService.linkConversationDeal(
        tenantId,
        conversationId,
        dealId,
        operator?.id ?? null,
        origin,
      );

      if (setAsActiveContext) {
        const now = new Date();
        await db
          .insert(conversationDealContexts)
          .values({
            tenantId,
            conversationId,
            currentDealId: dealId,
            selectionRequired: false,
            version: 1,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: conversationDealContexts.conversationId,
            set: {
              currentDealId: dealId,
              selectionRequired: false,
              version: sql`${conversationDealContexts.version} + 1`,
              updatedAt: now,
            },
          });
      }

      return {
        success: true,
        tenantId,
        linkId: link.id,
        conversationId,
        dealId,
        origin: link.origin,
        setAsActiveContext,
      };
    }

    // ── 3. UNLINK CONVERSATION DEAL (WRITE — ITEM 4) ─────────────────────────
    case "unlink_conversation_deal": {
      const conversationId = asTrimmedString(args.conversationId);
      const dealId = asTrimmedString(args.dealId);
      if (!conversationId || !dealId) {
        throw new Error("Campos obrigatórios: 'conversationId' e 'dealId'.");
      }

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      const forceUnlinkLast = args.forceUnlinkLast === true;

      if (!forceUnlinkLast) {
        const unlinked = await crmService.unlinkConversationDeal(
          tenantId,
          conversationId,
          dealId,
          operator?.id ?? null,
        );
        return {
          success: true,
          tenantId,
          conversationId,
          dealId,
          unlinked,
          forceUnlinkLast: false,
        };
      }

      const unlinked = await db.transaction(async (tx) => {
        const [conv] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
          .limit(1);
        if (!conv) {
          throw new Error(`Conversa '${conversationId}' não encontrada no tenant '${tenantId}'.`);
        }
        const [deal] = await tx
          .select({ id: crmDeals.id })
          .from(crmDeals)
          .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
          .limit(1);
        if (!deal) {
          throw new Error(`Negociação '${dealId}' não encontrada no tenant '${tenantId}'.`);
        }

        const now = new Date();
        const updated = await tx
          .update(crmConversationDeals)
          .set({
            isActive: false,
            unlinkedAt: now,
            unlinkedByOperatorId: operator?.id ?? null,
          })
          .where(
            and(
              eq(crmConversationDeals.tenantId, tenantId),
              eq(crmConversationDeals.conversationId, conversationId),
              eq(crmConversationDeals.dealId, dealId),
              eq(crmConversationDeals.isActive, true),
            ),
          )
          .returning({ id: crmConversationDeals.id });

        await tx
          .update(conversationDealContexts)
          .set({
            previousDealId: dealId,
            currentDealId: null,
            version: sql`${conversationDealContexts.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(conversationDealContexts.tenantId, tenantId),
              eq(conversationDealContexts.conversationId, conversationId),
              eq(conversationDealContexts.currentDealId, dealId),
            ),
          );

        return updated.length > 0;
      });

      return {
        success: true,
        tenantId,
        conversationId,
        dealId,
        unlinked,
        forceUnlinkLast: true,
      };
    }

    // ── 4. REASSIGN CONVERSATION CONTACT (WRITE — ITEM 4) ────────────────────
    case "reassign_conversation_contact": {
      const conversationId = asTrimmedString(args.conversationId);
      const newContactId = asTrimmedString(args.newContactId);
      if (!conversationId || !newContactId) {
        throw new Error("Campos obrigatórios: 'conversationId' e 'newContactId'.");
      }

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      const actorName = buildActorDisplayName(
        asTrimmedString(args.actorName),
        operator?.name,
        actor,
      );
      const reason = asTrimmedString(args.reason) || "Troca de contato da conversa via MCP";

      const result = await db.transaction(async (tx) => {
        const [conv] = await tx
          .select()
          .from(conversations)
          .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
          .for("update")
          .limit(1);
        if (!conv) {
          throw new Error(`Conversa '${conversationId}' não encontrada no tenant '${tenantId}'.`);
        }

        const [newContact] = await tx
          .select()
          .from(contacts)
          .where(and(eq(contacts.id, newContactId), eq(contacts.tenantId, tenantId)))
          .limit(1);
        if (!newContact) {
          throw new Error(`Contato '${newContactId}' não encontrado no tenant '${tenantId}'.`);
        }

        if (conv.contactId === newContactId) {
          return {
            previousContactId: conv.contactId,
            newContactName: newContact.name,
            version: conv.version,
            unchanged: true,
          };
        }

        // Verifica colisão de índice único (tenantId + whatsappConnectionId + contactId)
        const [colliding] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, tenantId),
              eq(conversations.contactId, newContactId),
              ne(conversations.id, conversationId),
              conv.whatsappConnectionId
                ? eq(conversations.whatsappConnectionId, conv.whatsappConnectionId)
                : isNull(conversations.whatsappConnectionId),
            ),
          )
          .limit(1);

        if (colliding) {
          throw new Error(
            `Conflito: o contato destino '${newContactId}' já possui a conversa '${colliding.id}' nesta mesma conexão (${conv.whatsappConnectionId || "corporativa"}). Para consolidar os dois históricos sem perda, use 'merge_contacts'.`,
          );
        }

        const [primaryPhone] = await tx
          .select({ id: contactPhones.id, phone: contactPhones.phone })
          .from(contactPhones)
          .where(
            and(
              eq(contactPhones.tenantId, tenantId),
              eq(contactPhones.contactId, newContactId),
            ),
          )
          .orderBy(desc(contactPhones.isPrimary), asc(contactPhones.position))
          .limit(1);

        const now = new Date();
        const [updated] = await tx
          .update(conversations)
          .set({
            contactId: newContactId,
            contactPhone: primaryPhone?.phone ?? newContact.phone ?? conv.contactPhone,
            contactPhoneId: primaryPhone?.id ?? null,
            version: conv.version + 1,
            updatedAt: now,
          })
          .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
          .returning();

        await tx.insert(crmActionHistory).values({
          id: crypto.randomUUID(),
          tenantId,
          operatorId: operator?.id ?? null,
          operatorName: actorName,
          action: "reassign_conversation_contact",
          entityType: "contact",
          itemCount: 1,
          details: {
            conversationId,
            previousContactId: conv.contactId,
            newContactId,
            newContactName: newContact.name,
            reason,
            source: "mcp",
          },
          createdAt: now,
        });

        return {
          previousContactId: conv.contactId,
          newContactName: newContact.name,
          version: updated.version,
          unchanged: false,
        };
      });

      return {
        success: true,
        tenantId,
        conversationId,
        previousContactId: result.previousContactId,
        newContactId,
        newContactName: result.newContactName,
        version: result.version,
        unchanged: result.unchanged,
        reason,
      };
    }

    // ── 5. BATCH UPSERT CRM DEALS (WRITE — ITEM 8) ───────────────────────────
    case "batch_upsert_crm_deals": {
      if (!Array.isArray(args.items) || args.items.length === 0) {
        throw new Error(
          `Campo obrigatório 'items' deve ser um array não vazio (1 a ${BATCH_UPSERT_MAX_ITEMS} itens).`,
        );
      }
      if (args.items.length > BATCH_UPSERT_MAX_ITEMS) {
        throw new Error(
          `Limite máximo de ${BATCH_UPSERT_MAX_ITEMS} itens por chamada em 'batch_upsert_crm_deals'.`,
        );
      }

      const batchKey = asTrimmedString(args.idempotencyKey);
      const [defaultActorOp, preloadedDealFieldDefs] = await Promise.all([
        assertOperatorInTenant(tenantId, asTrimmedString(args.actorOperatorId)),
        listCustomFields(tenantId, "deal"),
      ]);

      // Caches por chamada para eliminar queries repetitivas em lotes de até 500 itens
      const operatorCache = new Map<string, ReturnType<typeof assertOperatorInTenant>>();
      const getCachedOperator = (operatorId: string | undefined) => {
        if (!operatorId) return Promise.resolve(null);
        const existingPromise = operatorCache.get(operatorId);
        if (existingPromise) return existingPromise;
        const p = assertOperatorInTenant(tenantId, operatorId);
        operatorCache.set(operatorId, p);
        return p;
      };

      const pipelineStageCache = new Map<string, ReturnType<typeof resolvePipelineAndStage>>();
      const getCachedPipelineAndStage = (opts: Parameters<typeof resolvePipelineAndStage>[1]) => {
        const cacheKey = JSON.stringify([
          opts.pipelineId ?? "",
          opts.pipelineName ?? "",
          opts.fallbackPipelineId ?? "",
          opts.stageId ?? "",
          opts.stageName ?? "",
        ]);
        const existingPromise = pipelineStageCache.get(cacheKey);
        if (existingPromise) return existingPromise;
        const p = resolvePipelineAndStage(tenantId, opts);
        pipelineStageCache.set(cacheKey, p);
        return p;
      };

      type BatchItemResult = {
        index: number;
        idempotencyKey: string | null;
        status: "created" | "updated" | "replayed" | "error";
        dealId?: string;
        title?: string;
        pipelineId?: string;
        stageId?: string;
        operatorId?: string | null;
        value?: string | number | null;
        error?: string;
      };

      const results: BatchItemResult[] = new Array(args.items.length);

      // Mutex por chave dentro do mesmo lote para serializar conflitos (mesmo dealId, idempotencyKey ou telefone)
      const inBatchLocks = new Map<string, Promise<void>>();
      const withLockKeys = async <T>(lockKeys: string[], fn: () => Promise<T>): Promise<T> => {
        const uniqueKeys = Array.from(new Set(lockKeys)).sort();
        if (uniqueKeys.length === 0) return fn();
        const prevPromises = uniqueKeys.map((k) => inBatchLocks.get(k) ?? Promise.resolve());
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        for (const k of uniqueKeys) {
          inBatchLocks.set(k, gate);
        }
        await Promise.all(prevPromises);
        try {
          return await fn();
        } finally {
          release();
        }
      };

      const processBatchItem = async (i: number): Promise<void> => {
        const rawItem = args.items[i];
        if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
          results[i] = {
            index: i,
            idempotencyKey: null,
            status: "error",
            error: "Item inválido: esperado objeto JSON.",
          };
          return;
        }

        const item = rawItem as Record<string, unknown>;
        const itemKey =
          asTrimmedString(item.idempotencyKey) ||
          (batchKey ? `${batchKey}:item:${i}` : undefined);
        const dealId = asTrimmedString(item.dealId);
        const contactObj =
          item.contact && typeof item.contact === "object" && !Array.isArray(item.contact)
            ? (item.contact as { name?: string; phone?: string; email?: string })
            : undefined;
        const phoneDigits = contactObj?.phone
          ? String(contactObj.phone).replace(/\D/g, "")
          : "";

        const lockKeys: string[] = [];
        if (itemKey) lockKeys.push(`idem:${itemKey}`);
        if (dealId) lockKeys.push(`deal:${dealId}`);
        if (phoneDigits) lockKeys.push(`phone:${phoneDigits}`);

        await withLockKeys(lockKeys, async () => {
          try {
            // 1. Consulta idempotência persistida
            if (itemKey) {
              const cached = await lookupMcpIdempotency(tenantId, "batch_upsert_crm_deals", itemKey);
              if (cached) {
                results[i] = {
                  index: i,
                  idempotencyKey: itemKey,
                  status: "replayed",
                  dealId: cached.dealId as string | undefined,
                  title: cached.title as string | undefined,
                  pipelineId: cached.pipelineId as string | undefined,
                  stageId: cached.stageId as string | undefined,
                  operatorId: (cached.operatorId as string | null | undefined) ?? null,
                  value: (cached.value as string | number | null | undefined) ?? null,
                };
                return;
              }
            }

            if (dealId) {
              // Modo UPDATE
              const [existing] = await db
                .select({ id: crmDeals.id, pipelineId: crmDeals.pipelineId })
                .from(crmDeals)
                .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
                .limit(1);
              if (!existing) {
                throw new Error(`Negociação '${dealId}' não encontrada no tenant '${tenantId}'.`);
              }

              const patch: Parameters<typeof crmService.updateDeal>[3] = {};
              if (item.title !== undefined) {
                const t = asTrimmedString(item.title);
                if (!t) throw new Error("'title' não pode ser vazio.");
                patch.title = t;
              }
              if (item.value !== undefined) {
                patch.value = item.value === null || item.value === "" ? null : Number(item.value);
              }
              if (item.source !== undefined) {
                patch.source = item.source === null ? "" : String(item.source).trim();
              }
              if (item.campaign !== undefined) {
                patch.campaign = item.campaign === null ? "" : String(item.campaign).trim();
              }
              if (item.accountId !== undefined) {
                patch.accountId =
                  item.accountId === null ? null : asTrimmedString(item.accountId) ?? null;
              }
              if (item.operatorId !== undefined) {
                if (item.operatorId === null || item.operatorId === "") {
                  patch.operatorId = null;
                } else {
                  const op = await getCachedOperator(asTrimmedString(item.operatorId));
                  patch.operatorId = op!.id;
                }
              }
              if (item.expectedCloseDate !== undefined) {
                patch.expectedCloseDate =
                  item.expectedCloseDate === null || item.expectedCloseDate === ""
                    ? null
                    : parseOptionalDate(item.expectedCloseDate, "expectedCloseDate") ?? null;
              }
              if (item.rating !== undefined) {
                patch.rating = Number(item.rating);
              }
              if (
                item.pipelineId !== undefined ||
                item.pipelineName !== undefined ||
                item.stageId !== undefined ||
                item.stageName !== undefined
              ) {
                const target = await getCachedPipelineAndStage({
                  pipelineId: asTrimmedString(item.pipelineId),
                  pipelineName: asTrimmedString(item.pipelineName),
                  fallbackPipelineId: existing.pipelineId,
                  stageId: asTrimmedString(item.stageId),
                  stageName: asTrimmedString(item.stageName),
                });
                patch.pipelineId = target.pipelineId;
                patch.stageId = target.stageId;
              }
              if (
                item.customFields &&
                typeof item.customFields === "object" &&
                !Array.isArray(item.customFields)
              ) {
                patch.customFields = await resolveCustomFieldsInput(
                  tenantId,
                  item.customFields as Record<string, unknown>,
                  preloadedDealFieldDefs,
                );
              }

              const updated = await crmService.updateDeal(
                tenantId,
                dealId,
                defaultActorOp?.id ?? null,
                patch,
              );

              const itemResult = {
                dealId: updated.id,
                title: updated.title,
                pipelineId: updated.pipelineId,
                stageId: updated.stageId,
                operatorId: updated.operatorId,
                value: updated.value,
              };
              if (itemKey) {
                await saveMcpIdempotency(
                  tenantId,
                  "batch_upsert_crm_deals",
                  itemKey,
                  itemResult,
                  hashIdempotencyPayload(item),
                );
              }
              results[i] = {
                index: i,
                idempotencyKey: itemKey ?? null,
                status: "updated",
                ...itemResult,
              };
            } else {
              // Modo CREATE
              const title = asTrimmedString(item.title);
              if (!title) throw new Error("Campo obrigatório 'title' não informado para criação.");

              const [ownerOp, target] = await Promise.all([
                getCachedOperator(asTrimmedString(item.operatorId)),
                getCachedPipelineAndStage({
                  pipelineId: asTrimmedString(item.pipelineId),
                  pipelineName: asTrimmedString(item.pipelineName),
                  stageId: asTrimmedString(item.stageId),
                  stageName: asTrimmedString(item.stageName),
                }),
              ]);

              const contactIds = Array.isArray(item.contactIds)
                ? item.contactIds.filter(
                    (v): v is string => typeof v === "string" && v.trim().length > 0,
                  )
                : undefined;

              const resolvedCf =
                item.customFields &&
                typeof item.customFields === "object" &&
                !Array.isArray(item.customFields)
                  ? await resolveCustomFieldsInput(
                      tenantId,
                      item.customFields as Record<string, unknown>,
                      preloadedDealFieldDefs,
                    )
                  : undefined;

              const created = await crmService.createDeal(
                tenantId,
                defaultActorOp?.id ?? ownerOp?.id ?? null,
                {
                  title,
                  pipelineId: target.pipelineId,
                  stageId: target.stageId,
                  accountId: asTrimmedString(item.accountId) ?? null,
                  value:
                    item.value !== undefined && item.value !== null ? Number(item.value) : null,
                  expectedCloseDate:
                    parseOptionalDate(item.expectedCloseDate, "expectedCloseDate") ?? null,
                  operatorId: ownerOp?.id ?? null,
                  contactId: asTrimmedString(item.contactId),
                  contactIds,
                  contact: contactObj?.name
                    ? {
                        name: String(contactObj.name).trim(),
                        phone: contactObj.phone ? String(contactObj.phone).trim() : null,
                        email: contactObj.email ? String(contactObj.email).trim() : null,
                      }
                    : null,
                  conversationId: asTrimmedString(item.conversationId),
                  source: asTrimmedString(item.source),
                  campaign: asTrimmedString(item.campaign),
                  initialNote: asTrimmedString(item.initialNote) ?? null,
                  ...(resolvedCf ? { customFields: resolvedCf } : {}),
                },
              );

              const itemResult = {
                dealId: created.id,
                title: created.title,
                pipelineId: created.pipelineId,
                stageId: created.stageId,
                operatorId: created.operatorId,
                value: created.value,
              };
              if (itemKey) {
                await saveMcpIdempotency(
                  tenantId,
                  "batch_upsert_crm_deals",
                  itemKey,
                  itemResult,
                  hashIdempotencyPayload(item),
                );
              }
              results[i] = {
                index: i,
                idempotencyKey: itemKey ?? null,
                status: "created",
                ...itemResult,
              };
            }
          } catch (err: any) {
            results[i] = {
              index: i,
              idempotencyKey: itemKey ?? null,
              status: "error",
              error: String(err?.message || err || "Erro ao processar item do lote."),
            };
          }
        });
      };

      const concurrency = Math.min(BATCH_UPSERT_CONCURRENCY, args.items.length);
      let nextIndex = 0;
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (true) {
            const current = nextIndex++;
            if (current >= args.items.length) break;
            await processBatchItem(current);
          }
        }),
      );

      let createdCount = 0;
      let updatedCount = 0;
      let replayedCount = 0;
      let errorCount = 0;
      for (const r of results) {
        if (r.status === "created") createdCount++;
        else if (r.status === "updated") updatedCount++;
        else if (r.status === "replayed") replayedCount++;
        else errorCount++;
      }

      return {
        success: errorCount === 0,
        partialSuccess: errorCount > 0 && createdCount + updatedCount + replayedCount > 0,
        tenantId,
        idempotencyKey: batchKey ?? null,
        maxItemsPerCall: BATCH_UPSERT_MAX_ITEMS,
        totalItems: args.items.length,
        createdCount,
        updatedCount,
        replayedCount,
        errorCount,
        results,
      };
    }

    // ── 6. CHAT SEND MEDIA (WRITE — ITEM 5) ──────────────────────────────────
    case "chat_send_media": {
      const conversationId = asTrimmedString(args.conversationId);
      const mediaTypeRaw = asTrimmedString(args.mediaType);
      const mediaUrlRaw = asTrimmedString(args.mediaUrl);
      if (!conversationId) throw new Error("Campo obrigatório 'conversationId' não informado.");
      if (
        mediaTypeRaw !== "image" &&
        mediaTypeRaw !== "document" &&
        mediaTypeRaw !== "audio" &&
        mediaTypeRaw !== "video"
      ) {
        throw new Error(
          "Campo obrigatório 'mediaType' deve ser 'image', 'document', 'audio' ou 'video'.",
        );
      }
      if (!mediaUrlRaw) throw new Error("Campo obrigatório 'mediaUrl' não informado.");

      const safeMediaUrl = validateSafeMediaUrl(mediaUrlRaw);
      const caption = asTrimmedString(args.caption);
      const fileName = asTrimmedString(args.fileName);

      const [conv] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
        .limit(1);
      if (!conv) {
        throw new Error(`Conversa '${conversationId}' não encontrada no tenant '${tenantId}'.`);
      }

      const [contact] = await db
        .select({
          id: contacts.id,
          name: contacts.name,
          phone: contacts.phone,
          whatsappUserId: contacts.whatsappUserId,
        })
        .from(contacts)
        .where(and(eq(contacts.id, conv.contactId), eq(contacts.tenantId, tenantId)))
        .limit(1);
      if (!contact) {
        throw new Error("Conversa sem contato válido associado neste tenant.");
      }

      const recipientPhone = conv.contactPhone || contact.phone || "";
      if (!recipientPhone && !contact.whatsappUserId) {
        throw new Error("Contato sem telefone ou WhatsApp ID cadastrado para envio de mídia.");
      }

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      const senderName = buildActorDisplayName(
        asTrimmedString(args.senderName),
        operator?.name,
        actor,
      );
      const targetConn = await resolveConversationConnection(tenantId, conversationId);

      const sendRes = await outboundQueue.enqueueAndSend({
        tenantId,
        conversationId,
        recipientPhone,
        recipientUserId: contact.whatsappUserId ?? undefined,
        text: caption,
        mediaUrl: safeMediaUrl,
        mediaType: mediaTypeRaw,
        fileName,
        operatorId: operator?.id ?? null,
        senderName,
        idempotencyKey: asTrimmedString(args.idempotencyKey),
      });

      if (!sendRes.success) {
        const hint =
          sendRes.code === "META_WINDOW_CLOSED" || sendRes.error?.toLowerCase().includes("janela")
            ? " Janela de 24h da Meta encerrada — envie um template aprovado via 'send_meta_template'."
            : "";
        throw new Error(`Falha ao enviar mídia (${sendRes.status}): ${sendRes.error || "erro desconhecido"}.${hint}`);
      }

      emitSseSafe(tenantId, {
        type: "message",
        message: {
          id: sendRes.messageId,
          conversationId,
          senderType: "agent",
          senderName,
          content: caption || `[Mídia: ${mediaTypeRaw}]`,
          direction: "outbound",
          status: sendRes.status,
          sentAt: sendRes.sentAtISO || new Date().toISOString(),
        },
      });

      return {
        success: true,
        tenantId,
        conversationId,
        channel: targetConn.provider,
        mediaType: mediaTypeRaw,
        mediaUrl: safeMediaUrl,
        fileName: fileName ?? null,
        caption: caption ?? null,
        messageId: sendRes.messageId,
        externalId: sendRes.externalId ?? null,
        status: sendRes.status,
      };
    }

    // ── 7. LIST CRM PRODUCTS (READ — ITEM 5) ─────────────────────────────────
    case "list_crm_products": {
      const search = asTrimmedString(args.search);
      const onlyActive = args.onlyActive !== false;
      const dealId = asTrimmedString(args.dealId);

      const catalog = await crmService.getProducts(tenantId, {
        search,
        isActive: onlyActive ? true : undefined,
      });

      let dealProducts: unknown[] | undefined;
      if (dealId) {
        dealProducts = await crmService.getDealProducts(tenantId, dealId);
      }

      return {
        tenantId,
        totalProducts: catalog.length,
        products: catalog.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          description: p.description,
          unitPrice: p.unitPrice,
          unit: p.unit,
          category: p.category,
          isActive: p.isActive,
        })),
        ...(dealProducts ? { dealId, dealProducts, totalDealProducts: dealProducts.length } : {}),
      };
    }

    // ── 8. ADD DEAL PRODUCT (WRITE — ITEM 5) ─────────────────────────────────
    case "add_deal_product": {
      const dealId = asTrimmedString(args.dealId);
      if (!dealId) throw new Error("Campo obrigatório 'dealId' não informado.");

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      const productId = asTrimmedString(args.productId);
      let prodName = asTrimmedString(args.name);
      let unitPrice =
        args.unitPrice !== undefined && args.unitPrice !== null
          ? Number(args.unitPrice)
          : undefined;

      if (productId) {
        const [catalogProd] = await db
          .select()
          .from(crmProducts)
          .where(and(eq(crmProducts.tenantId, tenantId), eq(crmProducts.id, productId)))
          .limit(1);
        if (!catalogProd) {
          throw new Error(`Produto '${productId}' não encontrado no catálogo do tenant '${tenantId}'.`);
        }
        if (!prodName) prodName = catalogProd.name;
        if (unitPrice === undefined) unitPrice = Number(catalogProd.unitPrice || 0);
      }

      if (!prodName) {
        throw new Error("Informe 'name' ou um 'productId' válido do catálogo.");
      }

      const item = await crmService.addDealProduct(tenantId, dealId, operator?.id ?? null, {
        productId: productId ?? null,
        name: prodName,
        quantity: args.quantity !== undefined ? Number(args.quantity) : 1,
        unitPrice: unitPrice ?? 0,
        discountPercent: args.discountPercent !== undefined ? Number(args.discountPercent) : 0,
        discountAmount: args.discountAmount !== undefined ? Number(args.discountAmount) : undefined,
        notes: asTrimmedString(args.notes) ?? null,
      });

      const [freshDeal] = await db
        .select({ value: crmDeals.value })
        .from(crmDeals)
        .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, dealId)))
        .limit(1);

      return {
        success: true,
        tenantId,
        dealId,
        dealProductId: item.id,
        item,
        dealTotalValue: freshDeal?.value ?? null,
      };
    }

    // ── 9. REMOVE DEAL PRODUCT (WRITE — ITEM 5) ──────────────────────────────
    case "remove_deal_product": {
      const dealId = asTrimmedString(args.dealId);
      const dealProductId = asTrimmedString(args.dealProductId);
      if (!dealId || !dealProductId) {
        throw new Error("Campos obrigatórios: 'dealId' e 'dealProductId'.");
      }

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      await crmService.removeDealProduct(tenantId, dealId, dealProductId, operator?.id ?? null);

      const [freshDeal] = await db
        .select({ value: crmDeals.value })
        .from(crmDeals)
        .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, dealId)))
        .limit(1);

      return {
        success: true,
        tenantId,
        dealId,
        removedDealProductId: dealProductId,
        dealTotalValue: freshDeal?.value ?? null,
      };
    }

    // ── 10. CREATE DEAL PROPOSAL (WRITE — ITEM 5) ────────────────────────────
    case "create_deal_proposal": {
      const dealId = asTrimmedString(args.dealId);
      if (!dealId) throw new Error("Campo obrigatório 'dealId' não informado.");

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      const proposal = await crmService.createProposal(tenantId, dealId, operator?.id ?? null, {
        title: asTrimmedString(args.title),
        paymentTerms: asTrimmedString(args.paymentTerms),
        deliveryTerms: asTrimmedString(args.deliveryTerms),
        validityDays: args.validityDays !== undefined ? Number(args.validityDays) : undefined,
        notes: asTrimmedString(args.notes),
      });

      return {
        success: true,
        tenantId,
        dealId,
        proposalId: proposal.id,
        proposalNumber: proposal.proposalNumber,
        proposal,
      };
    }

    // ── 11. LIST DEAL PROPOSALS (READ — ITEM 5) ──────────────────────────────
    case "list_deal_proposals": {
      const dealId = asTrimmedString(args.dealId);
      if (!dealId) throw new Error("Campo obrigatório 'dealId' não informado.");

      const [deal] = await db
        .select({ id: crmDeals.id, title: crmDeals.title })
        .from(crmDeals)
        .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, dealId)))
        .limit(1);
      if (!deal) {
        throw new Error(`Negociação '${dealId}' não encontrada no tenant '${tenantId}'.`);
      }

      const proposals = await crmService.getProposals(tenantId, dealId);
      return {
        tenantId,
        dealId,
        dealTitle: deal.title,
        totalProposals: proposals.length,
        proposals,
      };
    }

    // ── 12. LIST WEBHOOK SUBSCRIPTIONS (READ — ITEM 6) ───────────────────────
    case "list_webhook_subscriptions": {
      await ensureWebhookSubscriptionsSchema();
      const rows = await db
        .select()
        .from(webhookSubscriptions)
        .where(eq(webhookSubscriptions.tenantId, tenantId))
        .orderBy(desc(webhookSubscriptions.createdAt));

      return {
        tenantId,
        totalSubscriptions: rows.length,
        supportedEvents: [...SUPPORTED_WEBHOOK_EVENTS],
        subscriptions: rows.map((s) => ({
          id: s.id,
          name: s.name,
          url: s.url,
          secretPreview: maskSecret(s.secret),
          events: s.events,
          isActive: s.isActive,
          createdAt: s.createdAt,
        })),
      };
    }

    // ── 13. UPSERT WEBHOOK SUBSCRIPTION (WRITE — ITEM 6) ─────────────────────
    case "upsert_webhook_subscription": {
      await ensureWebhookSubscriptionsSchema();
      const action = asTrimmedString(args.action);
      if (action !== "create" && action !== "update" && action !== "delete") {
        throw new Error("Campo obrigatório 'action' deve ser 'create', 'update' ou 'delete'.");
      }

      if (action === "delete") {
        const subId = asTrimmedString(args.subscriptionId);
        if (!subId) throw new Error("Campo obrigatório 'subscriptionId' não informado.");
        const [deleted] = await db
          .delete(webhookSubscriptions)
          .where(
            and(
              eq(webhookSubscriptions.id, subId),
              eq(webhookSubscriptions.tenantId, tenantId),
            ),
          )
          .returning();
        if (!deleted) {
          throw new Error(`Subscrição '${subId}' não encontrada no tenant '${tenantId}'.`);
        }
        return {
          success: true,
          tenantId,
          action: "delete",
          deletedSubscriptionId: deleted.id,
          name: deleted.name,
        };
      }

      const validateEvents = (raw: unknown): string[] => {
        if (!Array.isArray(raw) || raw.length === 0) {
          throw new Error(
            `Informe 'events' com ao menos um evento suportado: ${SUPPORTED_WEBHOOK_EVENTS.join(", ")}.`,
          );
        }
        const allowed = new Set<string>(SUPPORTED_WEBHOOK_EVENTS);
        const unique = Array.from(
          new Set(raw.filter((v): v is string => typeof v === "string").map((v) => v.trim())),
        );
        const invalid = unique.filter((e) => !allowed.has(e));
        if (invalid.length > 0) {
          throw new Error(
            `Eventos não suportados: ${invalid.join(", ")}. Suportados: ${SUPPORTED_WEBHOOK_EVENTS.join(", ")}.`,
          );
        }
        return unique;
      };

      if (action === "create") {
        const subName = asTrimmedString(args.name);
        const rawUrl = asTrimmedString(args.url);
        if (!subName) throw new Error("Campo obrigatório 'name' não informado.");
        if (!rawUrl) throw new Error("Campo obrigatório 'url' não informado.");
        const safeUrl = validateWebhookTargetUrl(rawUrl);
        const events = validateEvents(args.events);
        const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
        const id = crypto.randomUUID();

        const [created] = await db
          .insert(webhookSubscriptions)
          .values({
            id,
            tenantId,
            name: subName,
            url: safeUrl,
            secret,
            events,
            isActive: args.isActive !== false,
          })
          .returning();

        return {
          success: true,
          tenantId,
          action: "create",
          subscriptionId: created.id,
          name: created.name,
          url: created.url,
          events: created.events,
          isActive: created.isActive,
          secret: created.secret,
          note: "Guarde o 'secret' para validar o header X-Webhook-Signature (HMAC-SHA256).",
        };
      }

      // action === "update"
      const subId = asTrimmedString(args.subscriptionId);
      if (!subId) throw new Error("Campo obrigatório 'subscriptionId' não informado.");
      const [existing] = await db
        .select()
        .from(webhookSubscriptions)
        .where(
          and(eq(webhookSubscriptions.id, subId), eq(webhookSubscriptions.tenantId, tenantId)),
        )
        .limit(1);
      if (!existing) {
        throw new Error(`Subscrição '${subId}' não encontrada no tenant '${tenantId}'.`);
      }

      const patch: Partial<typeof webhookSubscriptions.$inferInsert> = {};
      if (args.name !== undefined) {
        const t = asTrimmedString(args.name);
        if (!t) throw new Error("'name' não pode ser vazio.");
        patch.name = t;
      }
      if (args.url !== undefined) {
        const u = asTrimmedString(args.url);
        if (!u) throw new Error("'url' não pode ser vazia.");
        patch.url = validateWebhookTargetUrl(u);
      }
      if (args.events !== undefined) {
        patch.events = validateEvents(args.events);
      }
      if (typeof args.isActive === "boolean") {
        patch.isActive = args.isActive;
      }
      let rotatedSecret: string | undefined;
      if (args.rotateSecret === true) {
        rotatedSecret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
        patch.secret = rotatedSecret;
      }

      if (Object.keys(patch).length === 0) {
        throw new Error("Informe ao menos um campo para atualizar ('name', 'url', 'events', 'isActive' ou 'rotateSecret').");
      }

      const [updated] = await db
        .update(webhookSubscriptions)
        .set(patch)
        .where(and(eq(webhookSubscriptions.id, subId), eq(webhookSubscriptions.tenantId, tenantId)))
        .returning();

      return {
        success: true,
        tenantId,
        action: "update",
        subscriptionId: updated.id,
        name: updated.name,
        url: updated.url,
        events: updated.events,
        isActive: updated.isActive,
        ...(rotatedSecret ? { secret: rotatedSecret } : { secretPreview: maskSecret(updated.secret) }),
      };
    }

    // ── 14. LIST WEBHOOK DELIVERIES (READ — ITEM 6) ──────────────────────────
    case "list_webhook_deliveries": {
      const deliveries = await listTenantWebhookDeliveries(tenantId, {
        subscriptionId: asTrimmedString(args.subscriptionId),
        eventType: asTrimmedString(args.eventType),
        status: asTrimmedString(args.status),
        limit: args.limit !== undefined ? Number(args.limit) : 30,
      });

      return {
        tenantId,
        totalDeliveries: deliveries.length,
        deliveries: deliveries.map((d) => ({
          id: d.id,
          subscriptionId: d.subscriptionId,
          eventId: d.eventId,
          eventType: d.eventType,
          targetUrl: d.targetUrl,
          status: d.status,
          attempts: d.attempts,
          maxAttempts: d.maxAttempts,
          lastStatusCode: d.lastStatusCode,
          lastError: d.lastError,
          nextRetryAt: d.nextRetryAt,
          deliveredAt: d.deliveredAt,
          createdAt: d.createdAt,
        })),
      };
    }

    // ── 15. RETRY WEBHOOK DELIVERY (WRITE — ITEM 6) ──────────────────────────
    case "retry_webhook_delivery": {
      const deliveryId = asTrimmedString(args.deliveryId);
      if (!deliveryId) throw new Error("Campo obrigatório 'deliveryId' não informado.");
      const attempt = await retryWebhookDelivery(tenantId, deliveryId);
      return {
        success: attempt.status === "delivered",
        tenantId,
        ...attempt,
      };
    }

    // ── 16. SET CONVERSATION TRIAGE MODE (WRITE — ITEM 7) ────────────────────
    case "set_conversation_triage_mode": {
      const conversationId = asTrimmedString(args.conversationId);
      const action = asTrimmedString(args.action);
      if (!conversationId) throw new Error("Campo obrigatório 'conversationId' não informado.");
      if (
        action !== "pause_ai" &&
        action !== "resume_ai" &&
        action !== "set_manual" &&
        action !== "unset_manual"
      ) {
        throw new Error(
          "Campo obrigatório 'action' deve ser 'pause_ai', 'resume_ai', 'set_manual' ou 'unset_manual'.",
        );
      }

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      const actorName = buildActorDisplayName(
        asTrimmedString(args.actorName),
        operator?.name,
        actor,
      );
      const reason =
        asTrimmedString(args.reason) ||
        (action === "pause_ai"
          ? "IA pausada via MCP"
          : action === "set_manual"
            ? "Atendimento assumido manualmente via MCP"
            : "Atendimento automático retomado via MCP");

      // Trava 1 imediata: limpa debouncer e aborta geração em curso antes de gravar no banco
      if (action === "pause_ai" || action === "set_manual") {
        SdrDebouncer.getInstance().clearSession(conversationId);
      }

      const persona = getAiPersona(tenantId);
      const now = new Date();

      const updatedState = await db.transaction(async (tx) => {
        const [conv] = await tx
          .select()
          .from(conversations)
          .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
          .for("update")
          .limit(1);
        if (!conv) {
          throw new Error(`Conversa '${conversationId}' não encontrada no tenant '${tenantId}'.`);
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

        let nextQueueState = conv.queueState;
        let nextOperatorId: string | null = conv.operatorId;
        let nextOutcome: string;
        let nextStep: string;
        let nextCompletedAt: Date | null = null;
        let nextMeta: Record<string, unknown>;

        if (action === "pause_ai") {
          nextQueueState = conv.operatorId ? "meus" : conv.queueState === "automacao" ? "fila" : conv.queueState;
          nextOutcome = "paused";
          nextStep = "IA Pausada";
          nextMeta = {
            ...prevMeta,
            aiPaused: true,
            manualMode: false,
            pausedReason: reason,
            pausedBy: actorName,
            pausedAt: now.toISOString(),
          };
        } else if (action === "set_manual") {
          nextOperatorId = operator ? operator.id : conv.operatorId;
          nextQueueState = nextOperatorId ? "meus" : "fila";
          nextOutcome = "stopped";
          nextStep = "Atendimento Manual";
          nextCompletedAt = now;
          nextMeta = {
            ...prevMeta,
            aiPaused: true,
            manualMode: true,
            manualOperatorId: nextOperatorId,
            pausedReason: reason,
            pausedBy: actorName,
            pausedAt: now.toISOString(),
          };
        } else {
          // resume_ai ou unset_manual
          nextOperatorId = null;
          nextQueueState = "automacao";
          nextOutcome = "in_progress";
          nextStep = existingFlow?.currentStep && !["IA Pausada", "Atendimento Manual", "Interrompido Manualmente"].includes(existingFlow.currentStep)
            ? existingFlow.currentStep
            : "Em Qualificação";
          nextCompletedAt = null;
          nextMeta = {
            ...prevMeta,
            aiPaused: false,
            manualMode: false,
            resumedBy: actorName,
            resumedAt: now.toISOString(),
            resumedReason: reason,
          };
        }

        const [updatedConv] = await tx
          .update(conversations)
          .set({
            queueState: nextQueueState,
            operatorId: nextOperatorId,
            version: conv.version + 1,
            updatedAt: now,
          })
          .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
          .returning();

        let flowId: string;
        if (existingFlow) {
          flowId = existingFlow.id;
          await tx
            .update(agentFlowStates)
            .set({
              outcome: nextOutcome,
              currentStep: nextStep,
              metadata: nextMeta,
              completedAt: nextCompletedAt,
              lastInteractionAt: now,
            })
            .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, existingFlow.id)));
        } else {
          flowId = `fs-sdr-${tenantId}-${conversationId}`;
          await tx.insert(agentFlowStates).values({
            id: flowId,
            tenantId,
            conversationId,
            agentType: "sdr",
            currentStep: nextStep,
            collectedData: {},
            metadata: {
              attendanceActorName: persona.name,
              ...nextMeta,
            },
            startedAt: now,
            lastInteractionAt: now,
            completedAt: nextCompletedAt,
            outcome: nextOutcome,
          });
        }

        await tx.insert(crmActionHistory).values({
          id: crypto.randomUUID(),
          tenantId,
          operatorId: operator?.id ?? null,
          operatorName: actorName,
          action: "triage_mode_changed",
          entityType: "contact",
          itemCount: 1,
          details: {
            conversationId,
            triageAction: action,
            previousQueueState: conv.queueState,
            nextQueueState,
            operatorId: nextOperatorId,
            outcome: nextOutcome,
            reason,
            source: "mcp",
          },
          createdAt: now,
        });

        return {
          conv: updatedConv,
          flowId,
          outcome: nextOutcome,
          currentStep: nextStep,
        };
      });

      emitSseSafe(tenantId, {
        type: "queue_update",
        conversationId,
        contactId: updatedState.conv.contactId,
        queueState: updatedState.conv.queueState,
        operatorId: updatedState.conv.operatorId,
        sectorId: updatedState.conv.sectorId,
        version: updatedState.conv.version,
      });

      void dispatchWebhook(
        tenantId,
        "triage.mode_changed",
        {
          conversationId,
          action,
          queueState: updatedState.conv.queueState,
          operatorId: updatedState.conv.operatorId,
          outcome: updatedState.outcome,
          reason,
          actorName,
          timestamp: now.toISOString(),
        },
        { eventId: `triage-mode:${conversationId}:${now.getTime()}` },
      ).catch(() => {});

      const isAiActive =
        updatedState.conv.queueState === "automacao" &&
        !updatedState.conv.operatorId &&
        updatedState.outcome === "in_progress";

      return {
        success: true,
        tenantId,
        conversationId,
        action,
        queueState: updatedState.conv.queueState,
        operatorId: updatedState.conv.operatorId,
        operatorName: operator?.name ?? null,
        flowId: updatedState.flowId,
        flowOutcome: updatedState.outcome,
        currentStep: updatedState.currentStep,
        isAiActive,
        isPaused: updatedState.outcome === "paused" || updatedState.outcome === "stopped",
        isManual: updatedState.conv.queueState === "meus" || updatedState.outcome === "stopped",
        debouncerCleared: action === "pause_ai" || action === "set_manual",
        reason,
        actorName,
      };
    }

    // ── 17. GET TRIAGE SUMMARY (READ — ITEM 7) ───────────────────────────────
    case "get_triage_summary": {
      const conversationId = asTrimmedString(args.conversationId);
      if (!conversationId) throw new Error("Campo obrigatório 'conversationId' não informado.");

      const [conv] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
        .limit(1);
      if (!conv) {
        throw new Error(`Conversa '${conversationId}' não encontrada no tenant '${tenantId}'.`);
      }

      const [[flow], [owner]] = await Promise.all([
        db
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
          .limit(1),
        conv.operatorId
          ? db
              .select({ id: operators.id, name: operators.name })
              .from(operators)
              .where(and(eq(operators.tenantId, tenantId), eq(operators.id, conv.operatorId)))
              .limit(1)
          : Promise.resolve([undefined]),
      ]);

      const meta =
        flow?.metadata && typeof flow.metadata === "object"
          ? (flow.metadata as Record<string, unknown>)
          : {};
      const collectedData =
        flow?.collectedData && typeof flow.collectedData === "object"
          ? (flow.collectedData as Record<string, unknown>)
          : {};

      const outcome = flow?.outcome ?? null;
      const isPaused = outcome === "paused" || outcome === "stopped" || meta.aiPaused === true;
      const isManual =
        conv.queueState === "meus" ||
        conv.operatorId !== null ||
        meta.manualMode === true ||
        outcome === "stopped";
      const isAiActive =
        conv.queueState === "automacao" &&
        conv.operatorId === null &&
        !isPaused &&
        outcome !== "completed" &&
        outcome !== "transferred";

      return {
        tenantId,
        conversationId,
        queueState: conv.queueState,
        operatorId: conv.operatorId,
        operatorName: owner?.name ?? null,
        isAiActive,
        isPaused,
        isManual,
        flowId: flow?.id ?? null,
        flowOutcome: outcome,
        currentStep: flow?.currentStep ?? null,
        summary: (meta.triageSummary as string | null | undefined) ?? null,
        summaryUpdatedAt: (meta.triageSummaryUpdatedAt as string | null | undefined) ?? null,
        summaryUpdatedBy: (meta.triageSummaryUpdatedBy as string | null | undefined) ?? null,
        pausedReason: (meta.pausedReason as string | null | undefined) ?? null,
        pausedBy: (meta.pausedBy as string | null | undefined) ?? null,
        pausedAt: (meta.pausedAt as string | null | undefined) ?? null,
        collectedData,
        lastInteractionAt: flow?.lastInteractionAt ?? null,
      };
    }

    // ── 18. UPDATE TRIAGE SUMMARY (WRITE — ITEM 7) ───────────────────────────
    case "update_triage_summary": {
      const conversationId = asTrimmedString(args.conversationId);
      if (!conversationId) throw new Error("Campo obrigatório 'conversationId' não informado.");

      const summaryText = args.summary !== undefined ? asTrimmedString(args.summary) : undefined;
      const currentStepArg = asTrimmedString(args.currentStep);
      const collectedPatch =
        args.collectedData &&
        typeof args.collectedData === "object" &&
        !Array.isArray(args.collectedData)
          ? (args.collectedData as Record<string, unknown>)
          : undefined;

      if (!summaryText && !collectedPatch && !currentStepArg) {
        throw new Error(
          "Informe ao menos um campo para gravar: 'summary', 'collectedData' ou 'currentStep'.",
        );
      }

      const [conv] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
        .limit(1);
      if (!conv) {
        throw new Error(`Conversa '${conversationId}' não encontrada no tenant '${tenantId}'.`);
      }

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      const actorName = buildActorDisplayName(
        asTrimmedString(args.actorName),
        operator?.name,
        actor,
      );
      const persona = getAiPersona(tenantId);
      const now = new Date();

      const saved = await db.transaction(async (tx) => {
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
        const prevCollected =
          existingFlow?.collectedData && typeof existingFlow.collectedData === "object"
            ? { ...(existingFlow.collectedData as Record<string, unknown>) }
            : {};

        const nextMeta: Record<string, unknown> = {
          ...prevMeta,
          ...(summaryText
            ? {
                triageSummary: summaryText,
                triageSummaryUpdatedAt: now.toISOString(),
                triageSummaryUpdatedBy: actorName,
              }
            : {}),
        };
        const nextCollected = collectedPatch
          ? { ...prevCollected, ...collectedPatch }
          : prevCollected;

        let flowId: string;
        let finalStep: string;
        if (existingFlow) {
          flowId = existingFlow.id;
          finalStep = currentStepArg || existingFlow.currentStep;
          await tx
            .update(agentFlowStates)
            .set({
              currentStep: finalStep,
              collectedData: nextCollected,
              metadata: nextMeta,
              lastInteractionAt: now,
            })
            .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, existingFlow.id)));
        } else {
          flowId = `fs-sdr-${tenantId}-${conversationId}`;
          finalStep = currentStepArg || "Resumo Registrado";
          await tx.insert(agentFlowStates).values({
            id: flowId,
            tenantId,
            conversationId,
            agentType: "sdr",
            currentStep: finalStep,
            collectedData: nextCollected,
            metadata: {
              attendanceActorName: persona.name,
              ...nextMeta,
            },
            startedAt: now,
            lastInteractionAt: now,
            outcome: conv.queueState === "automacao" ? "in_progress" : "stopped",
          });
        }

        let internalNoteId: string | null = null;
        if (args.postInternalNote === true && summaryText) {
          internalNoteId = `msg-triage-sum-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
          await tx.insert(messages).values({
            id: internalNoteId,
            tenantId,
            conversationId,
            senderType: "agent",
            senderName: actorName,
            content: `[Resumo da Triagem]\n${summaryText}`,
            isInternalNote: true,
            direction: "outbound",
            provider: "internal",
            status: "accepted",
            sentAt: now,
            updatedAt: now,
          });
        }

        return {
          flowId,
          currentStep: finalStep,
          summary: (nextMeta.triageSummary as string | undefined) ?? null,
          collectedData: nextCollected,
          internalNoteId,
        };
      });

      return {
        success: true,
        tenantId,
        conversationId,
        flowId: saved.flowId,
        currentStep: saved.currentStep,
        summary: saved.summary,
        collectedData: saved.collectedData,
        internalNoteId: saved.internalNoteId,
        updatedBy: actorName,
        updatedAt: now.toISOString(),
      };
    }

    default:
      throw new Error(`Ferramenta Fase 2/3 desconhecida: '${name}'.`);
  }
}
