import crypto from "node:crypto";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  accessGroups,
  commercialEvidence,
  contacts,
  contactPhones,
  conversationDealContexts,
  conversations,
  crmActionHistory,
  crmConversationDeals,
  crmCustomFieldDefinitions,
  crmDealActivities,
  crmDealContacts,
  crmDealEvents,
  crmDeals,
  crmPipelines,
  crmProducts,
  crmStages,
  messages,
  metaMessageTemplates,
  operators,
  quickResponses,
  rdMarketingFlows,
  sectors,
  tasks,
} from "../../db/schema";
import { crmService } from "../crm/crm-service";
import { resolveAccountCustomFieldsInput } from "./valem-tecfag-mcp-account-fields";
import {
  conflictsWithStandardField,
  isCustomFieldEntity,
  isCustomFieldType,
  listCustomFields,
  type CustomFieldEntity,
} from "../crm/custom-fields";
import { mergeContactsInTenant } from "../crm/contact-merge-service";
import {
  findContactByAnyPhone,
  syncContactPhones,
} from "../crm/contact-phones";
import { outboundQueue } from "../whatsapp/outbound";
import { metaAdapter } from "../whatsapp/adapters/meta";
import { resolveConversationConnection } from "../whatsapp/connections";
import { connectionPeerJid } from "../whatsapp/connection-contacts";
import {
  createMetaTemplate,
  deleteMetaTemplate,
  ensureMetaTemplateGroupsSchema,
  listMetaTemplateGroups,
  loadDealCustomFieldsForTemplate,
  normalizeCustomGroups,
  setMetaTemplateBindings,
  syncMetaTemplates,
} from "../whatsapp/meta-templates";
import {
  getDealFieldBindingKey,
  resolveMetaTemplateValues,
  stripTemplateAccents,
} from "../whatsapp/meta-template-common";
import { SITE_CHANNEL } from "../livechat/site-channel-policy";
import { sendSiteOperatorText } from "../livechat/site-delivery";
import { SessionManager } from "../baileys/session-manager";
import { SdrDebouncer } from "../valentina/sdr-debouncer";
import {
  MCP_PHASE23_TOOLS,
  MCP_PHASE23_TOOL_LABELS_PT,
  executePhase23McpTool,
  isPhase23McpTool,
} from "./valem-tecfag-mcp-phase23-tools";
import {
  MCP_KNOWLEDGE_TOOLS,
  MCP_KNOWLEDGE_TOOL_LABELS_PT,
  executeKnowledgeMcpTool,
  isKnowledgeMcpTool,
} from "./valem-tecfag-mcp-knowledge-tools";
import {
  MCP_WAVE1_TOOLS,
  MCP_WAVE1_TOOL_LABELS_PT,
  executeWave1McpTool,
  isWave1McpTool,
} from "./valem-tecfag-mcp-wave1-tools";
import {
  MCP_TRIAGE_AUDIT_TOOLS,
  MCP_TRIAGE_AUDIT_TOOL_LABELS_PT,
  executeTriageAuditMcpTool,
  isTriageAuditMcpTool,
} from "./valem-tecfag-mcp-triage-tools";
import {
  MCP_OPERATOR_MESSAGES_TOOLS,
  MCP_OPERATOR_MESSAGES_TOOL_LABELS_PT,
  executeOperatorMessagesMcpTool,
  isOperatorMessagesMcpTool,
} from "./valem-tecfag-mcp-operator-messages-tools";
import {
  MCP_TEMPLATE_GROUPS_TOOLS,
  MCP_TEMPLATE_GROUPS_TOOL_LABELS_PT,
  executeTemplateGroupsMcpTool,
  isTemplateGroupsMcpTool,
  resolveTenantSectorScopeInput,
} from "./valem-tecfag-mcp-template-groups-tools";
import {
  MCP_SDR_ORCHESTRATOR_TOOLS,
  MCP_SDR_ORCHESTRATOR_TOOL_LABELS_PT,
  executeSdrOrchestratorMcpTool,
  isSdrOrchestratorMcpTool,
} from "./valem-tecfag-mcp-sdr-orchestrator-tools";
import {
  MCP_RD_MARKETING_TOOLS,
  MCP_RD_MARKETING_TOOL_LABELS_PT,
  executeRdMarketingMcpTool,
  isRdMarketingMcpTool,
} from "./valem-tecfag-mcp-rd-marketing-tools";

export type McpToolAccessKind = "read" | "write";

export interface McpToolDefinition {
  name: string;
  description: string;
  access: McpToolAccessKind;
  inputSchema: Record<string, unknown>;
}

export interface McpWriteActorContext {
  keyId?: string;
  keyLabel?: string;
  clientName?: string;
}

const TENANT_ID_PROP = {
  type: "string",
  enum: ["tecfag", "valem"],
  default: "tecfag",
  description: "Tenant alvo ('tecfag' ou 'valem'). Ignorado quando a chave MCP está travada em um tenant.",
};

export const MCP_EXTENDED_TOOLS: McpToolDefinition[] = [
  // ── TEMPLATES META (LEITURA) ───────────────────────────────────────────────
  {
    name: "list_meta_templates",
    access: "read",
    description:
      "Lista os templates oficiais da Meta (WhatsApp Business API) salvos no tenant, com status de aprovação, categoria, corpo, variáveis e restrições por funil/etapa. Opcionalmente sincroniza com a Graph API da Meta antes de listar.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        status: {
          type: "string",
          description: "Filtrar por status (ex: 'APPROVED', 'PENDING', 'REJECTED').",
        },
        search: {
          type: "string",
          description: "Filtrar por trecho do nome ou corpo do template.",
        },
        group: {
          type: "string",
          description:
            "Filtrar por categoria/grupo interno (ex: 'COMERCIAL', 'Fagner', ou '__UNGROUPED__' para listar apenas templates sem categoria).",
        },
        syncFromMeta: {
          type: "boolean",
          default: false,
          description: "Quando true, sincroniza primeiro os templates diretamente na Graph API da Meta.",
        },
      },
    },
  },

  // ── CRM: NEGOCIAÇÕES ───────────────────────────────────────────────────────
  {
    name: "create_crm_deal",
    access: "write",
    description:
      "[ESCRITA] Cria uma nova negociação real no CRM via crmService (respeitando contato obrigatório, funil/etapa válidos, histórico de etapa e isolamento multi-tenant). Informe contactId/contactIds, um objeto contact para criar inline, ou accountId com contato vinculado.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        tenantId: TENANT_ID_PROP,
        title: { type: "string", description: "Título da negociação." },
        pipelineId: {
          type: "string",
          description: "ID do funil (opcional se pipelineName for informado ou para usar o funil padrão do tenant).",
        },
        pipelineName: {
          type: "string",
          description: "Nome do funil (alternativa a pipelineId).",
        },
        stageId: {
          type: "string",
          description: "ID da etapa inicial (opcional; usa a 1ª etapa do funil se omitido).",
        },
        stageName: {
          type: "string",
          description: "Nome da etapa inicial dentro do funil (alternativa a stageId).",
        },
        value: { type: "number", description: "Valor monetário da negociação em BRL." },
        accountId: { type: "string", description: "ID da empresa/conta (crm_accounts) a vincular." },
        contactId: { type: "string", description: "ID do contato principal a vincular." },
        contactIds: {
          type: "array",
          items: { type: "string" },
          description: "Lista de IDs de contatos a vincular.",
        },
        contact: {
          type: "object",
          description: "Criação atômica de novo contato junto da negociação (caso não informe contactId).",
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            email: { type: "string" },
          },
          required: ["name"],
        },
        operatorId: { type: "string", description: "ID do vendedor/operador responsável." },
        conversationId: { type: "string", description: "ID da conversa de origem (opcional)." },
        source: { type: "string", description: "Fonte/origem comercial (ex: 'Busca Paga | Google')." },
        campaign: { type: "string", description: "Campanha de marketing (opcional)." },
        initialNote: { type: "string", description: "Anotação inicial registrada na linha do tempo do card." },
        expectedCloseDate: { type: "string", description: "Previsão de fechamento (ISO YYYY-MM-DD)." },
        customFields: {
          type: "object",
          description:
            "Mapa chave→valor de campos personalizados do card (aceita ID ou nome exato do campo, ex: { 'black_maquina': 'FX-800', 'black_preco': 'R$ 1.063,12' }).",
        },
      },
    },
  },
  {
    name: "update_crm_deal_stage",
    access: "write",
    description:
      "[ESCRITA] Move uma negociação para outra etapa (e opcionalmente outro funil) no CRM via crmService, gravando o histórico real em crm_deal_stage_history.",
    inputSchema: {
      type: "object",
      required: ["dealId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        dealId: { type: "string", description: "ID da negociação (crm_deals.id)." },
        stageId: { type: "string", description: "ID da etapa de destino (crm_stages.id)." },
        stageName: {
          type: "string",
          description: "Nome da etapa de destino no funil (alternativa a stageId).",
        },
        pipelineId: {
          type: "string",
          description: "ID do funil de destino (opcional, quando estiver trocando de funil).",
        },
        operatorId: {
          type: "string",
          description: "ID do operador que está realizando a movimentação (opcional, para auditoria).",
        },
      },
    },
  },
  {
    name: "update_crm_deal_owner",
    access: "write",
    description:
      "[ESCRITA] Altera o vendedor/operador responsável de uma negociação no CRM via crmService, validando que o operador pertence ao mesmo tenant.",
    inputSchema: {
      type: "object",
      required: ["dealId", "operatorId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        dealId: { type: "string", description: "ID da negociação." },
        operatorId: { type: "string", description: "ID do novo vendedor responsável." },
      },
    },
  },
  {
    name: "mark_deal_won",
    access: "write",
    description:
      "[ESCRITA] Marca uma negociação como GANHA ('won') via crmService, registrando wonAt e evento de auditoria.",
    inputSchema: {
      type: "object",
      required: ["dealId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        dealId: { type: "string", description: "ID da negociação." },
        winReason: { type: "string", description: "Motivo ou observação do ganho (opcional)." },
        stageId: { type: "string", description: "Etapa de ganho específica (opcional)." },
        operatorId: { type: "string", description: "Operador autor da ação (opcional)." },
      },
    },
  },
  {
    name: "mark_deal_lost",
    access: "write",
    description:
      "[ESCRITA] Marca uma negociação como PERDIDA ('lost') via crmService, exigindo motivo de perda (lossReason) e registrando lostAt e auditoria.",
    inputSchema: {
      type: "object",
      required: ["dealId", "lossReason"],
      properties: {
        tenantId: TENANT_ID_PROP,
        dealId: { type: "string", description: "ID da negociação." },
        lossReason: { type: "string", description: "Motivo da perda (obrigatório)." },
        operatorId: { type: "string", description: "Operador autor da ação (opcional)." },
      },
    },
  },

  // ── CRM: CONTATOS E EMPRESAS ───────────────────────────────────────────────
  {
    name: "create_contact",
    access: "write",
    description:
      "[ESCRITA] Cria um novo contato no tenant (com sincronização em contact_phones e deduplicação automática por telefone, salvo se deduplicateByPhone=false).",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        tenantId: TENANT_ID_PROP,
        name: { type: "string", description: "Nome completo do contato." },
        phone: { type: "string", description: "Telefone/WhatsApp do contato (ex: 5511999998888)." },
        email: { type: "string", description: "E-mail do contato (opcional)." },
        cpf: { type: "string", description: "CPF do contato (opcional)." },
        cnpj: { type: "string", description: "CNPJ do contato (opcional)." },
        accountId: { type: "string", description: "ID da empresa/conta para vincular (opcional)." },
        deduplicateByPhone: {
          type: "boolean",
          default: true,
          description: "Se true, retorna o contato existente quando o telefone já estiver cadastrado no tenant.",
        },
      },
    },
  },
  {
    name: "update_contact",
    access: "write",
    description:
      "[ESCRITA] Atualiza parcialmente os dados de um contato existente no tenant (apenas os campos enviados são alterados) e sincroniza contact_phones quando o telefone muda.",
    inputSchema: {
      type: "object",
      required: ["contactId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        contactId: { type: "string", description: "ID do contato (contacts.id)." },
        name: { type: "string", description: "Novo nome do contato." },
        phone: { type: "string", description: "Novo telefone principal do contato." },
        email: { type: "string", description: "Novo e-mail do contato." },
        cpf: { type: "string", description: "Novo CPF do contato." },
        cnpj: { type: "string", description: "Novo CNPJ do contato." },
        accountId: { type: "string", description: "ID da empresa/conta vinculada (ou null para desvincular)." },
        walletOperatorId: {
          type: ["string", "null"],
          description:
            "ID do operador dono da carteira do contato (ou null / '' para limpar a carteira antiga). Sincroniza também responsibleName.",
        },
      },
    },
  },
  {
    name: "create_account",
    access: "write",
    description:
      "[ESCRITA] Cria uma nova empresa ou cliente PF (crm_accounts) via crmService com validação real de CPF/CNPJ, deduplicação de documento e suporte a campos personalizados (customFields por ID ou nome) e endereço (address).",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        tenantId: TENANT_ID_PROP,
        name: { type: "string", description: "Razão social ou nome da conta." },
        type: {
          type: "string",
          enum: ["company", "person"],
          default: "company",
          description: "Tipo de conta ('company' ou 'person').",
        },
        tradeName: { type: "string", description: "Nome fantasia (opcional)." },
        segment: { type: "string", description: "Segmento de atuação (opcional)." },
        document: { type: "string", description: "CNPJ ou CPF (opcional)." },
        email: { type: "string", description: "E-mail da empresa (opcional)." },
        phone: { type: "string", description: "Telefone da empresa (opcional)." },
        website: { type: "string", description: "Website (opcional)." },
        notes: { type: "string", description: "Observações (opcional)." },
        address: {
          type: "object",
          description: "Endereço / dados Receita Federal opcionais (street, number, complement, neighborhood, city, state, zipCode).",
        },
        customFields: {
          type: "object",
          description:
            "Campos personalizados da empresa (entityType='company') como objeto { [idOuNomeDoCampo]: valor }. Para campos de seleção (single/multiple), aceita ID ou rótulo da opção.",
        },
      },
    },
  },
  {
    name: "update_account",
    access: "write",
    description:
      "[ESCRITA] Atualiza parcialmente uma empresa/conta (crm_accounts) via crmService, incluindo campos personalizados (customFields por ID ou nome) e endereço (address).",
    inputSchema: {
      type: "object",
      required: ["accountId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        accountId: { type: "string", description: "ID da empresa/conta (crm_accounts.id)." },
        name: { type: "string" },
        type: { type: "string", enum: ["company", "person"] },
        tradeName: { type: "string" },
        segment: { type: "string" },
        document: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        website: { type: "string" },
        notes: { type: "string" },
        address: {
          type: "object",
          description: "Campos de endereço a mesclar em crm_accounts.address.",
        },
        customFields: {
          type: "object",
          description:
            "Campos personalizados da empresa a mesclar em crm_accounts.custom_fields ({ [idOuNomeDoCampo]: valor }). Use null para limpar um campo.",
        },
      },
    },
  },

  // ── TAREFAS & ATIVIDADES ───────────────────────────────────────────────────
  {
    name: "create_task",
    access: "write",
    description:
      "[ESCRITA] Cria uma tarefa/atividade real. Quando dealId é informado, cria uma atividade no CRM (crm_deal_activities via crmService, aparecendo no card e na aba Tarefas). Sem dealId, cria uma tarefa avulsa na tabela tasks.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        tenantId: TENANT_ID_PROP,
        title: { type: "string", description: "Título da tarefa." },
        dealId: { type: "string", description: "ID da negociação no CRM (recomendado para tarefas comerciais)." },
        type: {
          type: "string",
          enum: ["task", "call", "meeting", "whatsapp", "email", "lunch", "visit", "note"],
          default: "task",
          description: "Tipo da atividade.",
        },
        description: { type: "string", description: "Descrição detalhada da tarefa." },
        dueDate: { type: "string", description: "Data/hora de vencimento em ISO 8601 (ex: 2026-11-20T14:00:00-03:00)." },
        assignedToOperatorId: { type: "string", description: "ID do operador responsável pela tarefa." },
        conversationId: { type: "string", description: "ID da conversa associada (opcional)." },
      },
    },
  },
  {
    name: "update_task",
    access: "write",
    description:
      "[ESCRITA] Atualiza uma tarefa/atividade existente (tanto em crm_deal_activities via crmService quanto em tasks avulsas): status ('pending', 'completed', 'cancelled'), título, descrição, prazo, responsável ou nota de conclusão.",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        taskId: { type: "string", description: "ID da tarefa/atividade." },
        dealId: { type: "string", description: "ID da negociação (opcional, inferido automaticamente se omitido)." },
        status: {
          type: "string",
          enum: ["pending", "completed", "cancelled"],
          description: "Novo status da tarefa.",
        },
        title: { type: "string", description: "Novo título." },
        description: { type: "string", description: "Nova descrição." },
        dueDate: { type: "string", description: "Nova data/hora limite em ISO 8601." },
        assignedToOperatorId: { type: "string", description: "Novo operador responsável." },
        completionNote: { type: "string", description: "Observação de conclusão (quando status='completed')." },
      },
    },
  },

  // ── CHAT & WHATSAPP REAL ───────────────────────────────────────────────────
  {
    name: "chat_send_message",
    access: "write",
    description:
      "[ESCRITA] Envia uma mensagem REAL para o cliente em uma conversa existente pelo canal real configurado (WhatsApp Meta Cloud API, Baileys ou Live Chat do Site), respeitando a janela de 24h da Meta, idempotência e atualização SSE em tempo real.",
    inputSchema: {
      type: "object",
      required: ["conversationId", "content"],
      properties: {
        tenantId: TENANT_ID_PROP,
        conversationId: { type: "string", description: "ID da conversa (conversations.id)." },
        content: { type: "string", description: "Texto da mensagem a enviar." },
        operatorId: { type: "string", description: "ID do operador remetente (opcional)." },
        senderName: { type: "string", description: "Nome exibido como remetente interno (opcional)." },
        quotedMessageId: { type: "string", description: "ID da mensagem citada/respondida (opcional)." },
        idempotencyKey: { type: "string", description: "Chave de idempotência para evitar envios duplicados (opcional)." },
      },
    },
  },
  {
    name: "chat_add_internal_note",
    access: "write",
    description:
      "[ESCRITA] Adiciona uma nota interna (amarela, invisível para o cliente) dentro de uma conversa e notifica os operadores em tempo real via SSE.",
    inputSchema: {
      type: "object",
      required: ["conversationId", "content"],
      properties: {
        tenantId: TENANT_ID_PROP,
        conversationId: { type: "string", description: "ID da conversa." },
        content: { type: "string", description: "Conteúdo da nota interna." },
        senderName: { type: "string", description: "Nome do autor exibido na nota interna (opcional)." },
        operatorId: { type: "string", description: "ID do operador autor (opcional)." },
      },
    },
  },
  {
    name: "chat_transfer_conversation",
    access: "write",
    description:
      "[ESCRITA] Transfere uma conversa para um operador específico (queueState='meus') ou para a fila de um setor (queueState='fila'), validando existência no mesmo tenant, gravando mensagem de sistema e emitindo evento SSE.",
    inputSchema: {
      type: "object",
      required: ["conversationId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        conversationId: { type: "string", description: "ID da conversa." },
        operatorId: { type: "string", description: "ID do operador de destino (move para 'meus')." },
        sectorId: { type: "string", description: "ID do setor de destino (se sem operatorId, move para 'fila' do setor)." },
        reason: { type: "string", description: "Motivo ou contexto da transferência (opcional)." },
      },
    },
  },
  {
    name: "chat_close_conversation",
    access: "write",
    description:
      "[ESCRITA] Finaliza uma conversa (queueState='finalizados'), limpa o responsável ativo, registra mensagem de sistema na linha do tempo e emite SSE.",
    inputSchema: {
      type: "object",
      required: ["conversationId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        conversationId: { type: "string", description: "ID da conversa." },
        reason: { type: "string", description: "Motivo/resumo do encerramento (opcional)." },
      },
    },
  },
  {
    name: "create_conversation",
    access: "write",
    description:
      "[ESCRITA] Cria ou reabre a conversa de um contato no tenant respeitando a unicidade por contato, opcionalmente já atribuindo a um operador ou setor.",
    inputSchema: {
      type: "object",
      required: ["contactId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        contactId: { type: "string", description: "ID do contato (contacts.id)." },
        queueState: {
          type: "string",
          enum: ["fila", "meus", "automacao"],
          default: "fila",
          description: "Estado inicial da fila.",
        },
        operatorId: { type: "string", description: "Operador responsável (obrigatório se queueState='meus')." },
        sectorId: { type: "string", description: "Setor inicial (opcional)." },
        reopenIfExists: {
          type: "boolean",
          default: true,
          description: "Se já existir conversa para este contato, reabre/retorna a existente em vez de falhar.",
        },
      },
    },
  },

  // ── TEMPLATES META (ESCRITA REAL) ──────────────────────────────────────────
  {
    name: "update_meta_template_visibility",
    access: "write",
    description:
      "[ESCRITA] Atualiza a visibilidade de um template oficial da Meta por funis e etapas (allPipelines, pipelineIds, stageIds) usando setMetaTemplateBindings real.",
    inputSchema: {
      type: "object",
      required: ["templateId", "allPipelines"],
      properties: {
        tenantId: TENANT_ID_PROP,
        templateId: {
          type: "string",
          description: "ID interno (meta_message_templates.id) ou metaTemplateId da Meta.",
        },
        allPipelines: {
          type: "boolean",
          description: "true libera em todos os funis; false restringe aos pipelineIds/stageIds informados.",
        },
        pipelineIds: {
          type: "array",
          items: { type: "string" },
          description: "Lista de IDs de funis permitidos.",
        },
        stageIds: {
          type: "array",
          items: { type: "string" },
          description: "Lista de IDs de etapas permitidas.",
        },
        bindings: {
          type: "object",
          description:
            "Opcional: mapa de vínculos das variáveis {{1}}..{{N}} ('customer_name' | 'operator_name' | 'manual' | 'deal_field:<fieldId>'), ex: { '1': 'deal_field:black_maquina', '2': 'deal_field:black_preco', '3': 'deal_field:gap_t1' }.",
        },
        customGroups: {
          type: "array",
          items: { type: "string" },
          description:
            "Opcional: substitui as categorias/grupos internos do template (ex: ['COMERCIAL', 'Fagner']). Omita para manter inalterado.",
        },
        allSectors: {
          type: "boolean",
          description:
            "Opcional: true libera o template para todos os setores (herdando a regra da categoria); false restringe o template individual aos setores informados em sectorIds/sectorNames.",
        },
        sectorIds: {
          type: "array",
          items: { type: "string" },
          description: "Opcional: IDs de setores liberados para ver e enviar este template no chat.",
        },
        sectorNames: {
          type: "array",
          items: { type: "string" },
          description: "Opcional: nomes de setores liberados para ver e enviar este template no chat.",
        },
      },
    },
  },
  {
    name: "delete_meta_template",
    access: "write",
    description:
      "[ESCRITA] Exclui PERMANENTEMENTE um template oficial na Graph API da Meta (DELETE /{waba_id}/message_templates) e marca status='DELETED' no banco local. Exige confirmDelete=true e bloqueia exclusão se o template estiver vinculado a um fluxo de Webhook RD Marketing (a menos que forceDeleteIfReferenced=true).",
    inputSchema: {
      type: "object",
      required: ["confirmDelete"],
      properties: {
        tenantId: TENANT_ID_PROP,
        metaTemplateId: {
          type: "string",
          description: "ID oficial do template na Meta (ex: '1169671662173358').",
        },
        templateId: {
          type: "string",
          description: "ID interno (meta_message_templates.id) — alternativa a metaTemplateId.",
        },
        templateName: {
          type: "string",
          description: "Nome exato do template na Meta (alternativa a metaTemplateId).",
        },
        confirmDelete: {
          type: "boolean",
          description: "OBRIGATÓRIO ser true para confirmar exclusão definitiva na Meta (a Meta bloqueia reutilizar o mesmo nome por 30 dias).",
        },
        forceDeleteIfReferenced: {
          type: "boolean",
          default: false,
          description: "Quando true, permite excluir mesmo se houver fluxo de Webhook RD Marketing referenciando o template.",
        },
      },
    },
  },
  {
    name: "create_crm_custom_field",
    access: "write",
    description:
      "[ESCRITA] Cria um campo personalizado oficial no CRM (crm_custom_field_definitions) para negociações, empresas, contatos ou produtos — com suporte a ID previsível (slug) e idempotência opcional.",
    inputSchema: {
      type: "object",
      required: ["name", "fieldType"],
      properties: {
        tenantId: TENANT_ID_PROP,
        entityType: {
          type: "string",
          enum: ["deal", "company", "contact", "product"],
          default: "deal",
          description: "Entidade alvo do campo personalizado (padrão: 'deal').",
        },
        name: {
          type: "string",
          description: "Título exibido no CRM (até 120 caracteres, ex: 'Máquina Black').",
        },
        fieldId: {
          type: "string",
          description: "ID/slug opcional e previsível para facilitar integrações (apenas letras, números, _ e -, ex: 'black_maquina'). Se omitido, gera 'cf-<uuid>'.",
        },
        fieldType: {
          type: "string",
          enum: ["text", "date", "single", "multiple", "number", "url"],
          description: "Tipo de dado do campo personalizado.",
        },
        required: { type: "boolean", default: false, description: "Se o campo é obrigatório." },
        visibleOnCreate: { type: "boolean", default: true, description: "Se aparece no formulário de criação." },
        isUnique: { type: "boolean", default: false, description: "Se impede valores duplicados entre cards (apenas para entityType='deal')." },
        allPipelines: { type: "boolean", default: true, description: "Quando true, aplica a todos os funis (apenas para entityType='deal')." },
        pipelineIds: {
          type: "array",
          items: { type: "string" },
          description: "Lista de IDs de funis quando allPipelines=false.",
        },
        options: {
          type: "array",
          description: "Opções obrigatórias quando fieldType='single' ou 'multiple' (itens { id?, label } ou strings).",
          items: { type: "object" },
        },
        ifExistsReturnExisting: {
          type: "boolean",
          default: true,
          description: "Quando true, retorna o campo existente sem erro se já houver campo ativo com mesmo ID ou nome.",
        },
      },
    },
  },
  {
    name: "create_meta_template",
    access: "write",
    description:
      "[ESCRITA] Cria e submete DE VERDADE um novo template de mensagem para aprovação na Graph API da Meta (via createMetaTemplate) e salva o registro local.",
    inputSchema: {
      type: "object",
      required: ["name", "category", "bodyText"],
      properties: {
        tenantId: TENANT_ID_PROP,
        name: {
          type: "string",
          description: "Nome do template (apenas letras minúsculas, números e _, ex: retorno_orcamento).",
        },
        language: { type: "string", default: "pt_BR", description: "Idioma (ex: 'pt_BR')." },
        category: {
          type: "string",
          enum: ["UTILITY", "MARKETING", "AUTHENTICATION"],
          description: "Categoria oficial da Meta.",
        },
        bodyText: {
          type: "string",
          description: "Corpo da mensagem (pode conter variáveis {{1}}, {{2}}, ...).",
        },
        headerText: { type: "string", description: "Texto do cabeçalho (opcional)." },
        footerText: { type: "string", description: "Texto do rodapé (opcional)." },
        examples: {
          type: "array",
          items: { type: "string" },
          description: "Valores de exemplo obrigatórios pela Meta para cada variável {{1}}..{{N}} no bodyText.",
        },
        bindings: {
          type: "object",
          description: "Vínculo das variáveis ('customer_name' | 'operator_name' | 'manual'), ex: { '1': 'customer_name' }.",
        },
      },
    },
  },
  {
    name: "send_meta_template",
    access: "write",
    description:
      "[ESCRITA] Dispara DE VERDADE um template oficial APROVADO pela Meta em uma conversa via OutboundQueue + Meta Cloud API (útil inclusive fora da janela de 24h).",
    inputSchema: {
      type: "object",
      required: ["conversationId", "templateName"],
      properties: {
        tenantId: TENANT_ID_PROP,
        conversationId: { type: "string", description: "ID da conversa de destino." },
        templateName: { type: "string", description: "Nome exato do template aprovado na Meta." },
        templateLanguage: { type: "string", default: "pt_BR", description: "Idioma do template (ex: 'pt_BR')." },
        parameters: {
          type: "array",
          items: { type: "string" },
          description:
            "Lista ordenada dos valores para as variáveis {{1}}, {{2}}, ... do corpo do template (opcional quando os bindings automáticos 'customer_name', 'operator_name' ou 'deal_field:<campo>' resolvem). Quando informado, prevalece sobre 'deal_field:*'.",
        },
        dealId: {
          type: "string",
          description:
            "ID opcional do card (crm_deals) usado para preencher automaticamente variáveis com binding 'deal_field:<campo>'. Se omitido, resolve automaticamente o card ativo vinculado à conversa.",
        },
        operatorId: { type: "string", description: "ID do operador remetente (opcional)." },
        senderName: { type: "string", description: "Nome exibido como remetente interno (opcional)." },
        reopenIfClosed: {
          type: "boolean",
          default: false,
          description:
            "Quando true, reabre automaticamente a conversa caso ela esteja em 'finalizados' (vai para 'meus' se operatorId for informado, ou 'automacao' por padrão) antes de disparar o template.",
        },
        idempotencyKey: { type: "string", description: "Chave de idempotência opcional." },
      },
    },
  },

  // ── OPERAÇÃO & ADMIN ───────────────────────────────────────────────────────
  {
    name: "create_quick_response",
    access: "write",
    description:
      "[ESCRITA] Cria uma resposta rápida (atalho /comando) na tabela quick_responses do tenant.",
    inputSchema: {
      type: "object",
      required: ["shortcut", "text"],
      properties: {
        tenantId: TENANT_ID_PROP,
        shortcut: { type: "string", description: "Atalho da resposta (ex: '/cnpj' ou 'cnpj')." },
        text: { type: "string", description: "Texto completo da resposta rápida." },
        description: { type: "string", description: "Descrição curta opcional." },
      },
    },
  },
  {
    name: "delete_quick_response",
    access: "write",
    description:
      "[ESCRITA] Remove permanentemente uma resposta rápida do tenant pelo seu ID.",
    inputSchema: {
      type: "object",
      required: ["quickResponseId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        quickResponseId: { type: "string", description: "ID da resposta rápida (quick_responses.id)." },
      },
    },
  },
  {
    name: "update_sector",
    access: "write",
    description:
      "[ESCRITA] Atualiza o nome e/ou a lista de operadores vinculados a um setor do tenant, validando que todos os operatorIds pertencem ao mesmo tenant.",
    inputSchema: {
      type: "object",
      required: ["sectorId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        sectorId: { type: "string", description: "ID do setor (sectors.id)." },
        name: { type: "string", description: "Novo nome do setor (opcional)." },
        operatorIds: {
          type: "array",
          items: { type: "string" },
          description: "Lista completa de IDs de operadores pertencentes ao setor (opcional).",
        },
      },
    },
  },

  // ── FASE 1 (EVOLUÇÃO MCP): FUNIS/OPERADORES + EDIÇÃO COMPLETA + SANEAMENTO ─
  {
    name: "list_crm_pipelines",
    access: "read",
    description:
      "Lista oficialmente todos os funis (pipelines) do CRM do tenant com suas etapas ordenadas (ID, nome, ordem, se é etapa de ganho/perda e campos obrigatórios). Opcionalmente inclui contagem de cards e definições de campos personalizados de negociação.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        includeDealCounts: {
          type: "boolean",
          default: false,
          description: "Quando true, inclui o total de negociações por funil e por etapa.",
        },
        includeCustomFields: {
          type: "boolean",
          default: false,
          description: "Quando true, retorna também a lista oficial de campos personalizados ativos para negociações (IDs, nomes, tipos e opções).",
        },
        search: {
          type: "string",
          description: "Filtro opcional por trecho do nome do funil ou de alguma etapa.",
        },
      },
    },
  },
  {
    name: "list_operators",
    access: "read",
    description:
      "Lista oficialmente os operadores/vendedores atribuíveis do tenant com ID, nome, e-mail, perfil, status, grupo de acesso e equipes/setores vinculados.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        sectorId: { type: "string", description: "Filtrar operadores pertencentes a um setor específico (ID)." },
        sectorName: { type: "string", description: "Filtrar operadores pertencentes a um setor específico (nome parcial)." },
        role: {
          type: "string",
          enum: ["admin", "agent"],
          description: "Filtrar por perfil ('admin' ou 'agent').",
        },
        onlyOnline: {
          type: "boolean",
          default: false,
          description: "Quando true, retorna apenas operadores atualmente marcados como online.",
        },
        search: {
          type: "string",
          description: "Filtro opcional por nome ou e-mail do operador.",
        },
      },
    },
  },
  {
    name: "update_crm_deal",
    access: "write",
    description:
      "[ESCRITA] Edita parcialmente um card/negociação existente no CRM (valor, título, fonte, campanha, previsão de fechamento, qualificação, empresa, responsável, funil/etapa, UTMs, campos personalizados e vínculo opcional de produto/máquina) e retorna o card completo já atualizado.",
    inputSchema: {
      type: "object",
      required: ["dealId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        dealId: { type: "string", description: "ID da negociação existente (crm_deals.id)." },
        title: { type: "string", description: "Novo título da negociação." },
        value: {
          type: ["number", "null"],
          description: "Novo valor monetário em BRL (ou null para limpar).",
        },
        source: {
          type: ["string", "null"],
          description: "Fonte/origem comercial (ex: 'Busca Paga | Google', 'Indicação').",
        },
        campaign: {
          type: ["string", "null"],
          description: "Campanha / ponto de conversão de marketing.",
        },
        expectedCloseDate: {
          type: ["string", "null"],
          description: "Previsão de fechamento (ISO YYYY-MM-DD ou null para limpar).",
        },
        rating: {
          type: "number",
          description: "Qualificação da negociação (0 a 5 estrelas).",
        },
        accountId: {
          type: ["string", "null"],
          description: "ID da empresa/conta vinculada (ou null para desvincular).",
        },
        operatorId: {
          type: ["string", "null"],
          description: "ID do vendedor/operador responsável (ou null para deixar sem dono).",
        },
        pipelineId: { type: "string", description: "ID do funil de destino (opcional)." },
        pipelineName: { type: "string", description: "Nome do funil de destino (alternativa a pipelineId)." },
        stageId: { type: "string", description: "ID da etapa de destino (opcional)." },
        stageName: { type: "string", description: "Nome da etapa de destino (alternativa a stageId)." },
        status: {
          type: "string",
          enum: ["open", "paused"],
          description: "Status operacional ('open' para reabrir ou 'paused' para pausar). Para ganhar/perder use mark_deal_won/mark_deal_lost.",
        },
        pausedReason: {
          type: ["string", "null"],
          description: "Motivo da pausa quando status='paused' (ou null para limpar).",
        },
        entryChannel: { type: ["string", "null"], description: "Canal de entrada (ex: 'whatsapp', 'rd_webhook', 'manual')." },
        utmSource: { type: ["string", "null"], description: "UTM source." },
        utmMedium: { type: ["string", "null"], description: "UTM medium." },
        utmCampaign: { type: ["string", "null"], description: "UTM campaign." },
        utmContent: { type: ["string", "null"], description: "UTM content." },
        utmTerm: { type: ["string", "null"], description: "UTM term." },
        clickId: { type: ["string", "null"], description: "Click ID (gclid/fbclid)." },
        landingPage: { type: ["string", "null"], description: "URL da landing page de origem." },
        customFields: {
          type: "object",
          description: "Mapa chave→valor de campos personalizados do card (aceita tanto o ID quanto o nome exato do campo personalizado; faz merge preservando os demais campos existentes).",
        },
        product: {
          type: "object",
          description: "Opcional: adiciona um item de produto/máquina ao card (em crm_deal_products). Se 'value' não for informado explicitamente, recalcula o valor do card.",
          properties: {
            productId: { type: "string", description: "ID de produto do catálogo (crm_products.id), opcional." },
            name: { type: "string", description: "Nome do produto/máquina (obrigatório se productId não for informado)." },
            quantity: { type: "number", default: 1, description: "Quantidade (padrão: 1)." },
            unitPrice: { type: "number", description: "Valor unitário em BRL (usa preço do catálogo se productId for informado e unitPrice omitido)." },
            discountPercent: { type: "number", default: 0, description: "Desconto percentual (0 a 100)." },
            notes: { type: "string", description: "Observação do item (opcional)." },
          },
        },
        expectedVersion: {
          type: "number",
          description: "Versão esperada do card para trava otimista (opcional).",
        },
        actorOperatorId: {
          type: "string",
          description: "ID do operador autor da alteração para auditoria (opcional).",
        },
      },
    },
  },
  {
    name: "merge_contacts",
    access: "write",
    description:
      "[ESCRITA] Mescla atomicamente um contato duplicado (sourceContactId) em um contato principal (targetContactId) dentro do tenant, consolidando telefones, cards do CRM, conversas, histórico de mensagens e identidades com registro de auditoria.",
    inputSchema: {
      type: "object",
      required: ["sourceContactId", "targetContactId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        sourceContactId: {
          type: "string",
          description: "ID do contato duplicado que será absorvido e removido após a migração dos vínculos.",
        },
        targetContactId: {
          type: "string",
          description: "ID do contato principal que permanecerá ativo recebendo todos os cards, telefones e conversas.",
        },
        reason: {
          type: "string",
          description: "Motivo da mesclagem (gravado no histórico administrativo de auditoria).",
        },
        conversationConflictStrategy: {
          type: "string",
          enum: ["merge_messages", "block"],
          default: "merge_messages",
          description: "Como agir se ambos os contatos já tiverem conversa na mesma conexão WhatsApp: 'merge_messages' (padrão, consolida o histórico na conversa do destino) ou 'block' (aborta e retorna os IDs conflitantes).",
        },
        preferSourceFields: {
          type: "boolean",
          default: false,
          description: "Se false (padrão), mantém os dados preenchidos do contato principal e usa os do duplicado apenas para preencher lacunas.",
        },
        operatorId: { type: "string", description: "ID do operador responsável pela mesclagem (opcional, para auditoria)." },
        actorName: { type: "string", description: "Nome legível de quem solicitou a mesclagem (opcional)." },
      },
    },
  },
  {
    name: "replace_crm_deal_contact",
    access: "write",
    description:
      "[ESCRITA] Troca o contato vinculado a um card existente do CRM com segurança (adiciona o novo contato como principal antes de remover o vínculo incorreto, preservando a integridade do card) e registra auditoria.",
    inputSchema: {
      type: "object",
      required: ["dealId", "newContactId"],
      properties: {
        tenantId: TENANT_ID_PROP,
        dealId: { type: "string", description: "ID da negociação (crm_deals.id)." },
        newContactId: { type: "string", description: "ID do contato correto a vincular ao card." },
        oldContactId: {
          type: "string",
          description: "ID específico do contato incorreto a desvincular (opcional; se omitido, substitui o contato principal anterior).",
        },
        replaceAll: {
          type: "boolean",
          default: false,
          description: "Quando true, remove todos os demais contatos vinculados ao card, deixando apenas newContactId.",
        },
        keepPreviousContacts: {
          type: "boolean",
          default: false,
          description: "Quando true (e sem oldContactId/replaceAll), apenas adiciona/promove newContactId a principal sem remover participantes anteriores.",
        },
        role: {
          type: "string",
          enum: ["buyer", "technical", "decision_maker", "user", "other"],
          default: "buyer",
          description: "Papel do novo contato no card (padrão: 'buyer').",
        },
        reason: { type: "string", description: "Motivo da troca de contato (gravado em auditoria)." },
        operatorId: { type: "string", description: "ID do operador autor da troca (opcional)." },
        actorName: { type: "string", description: "Nome legível de quem solicitou a troca (opcional)." },
      },
    },
  },
  {
    name: "archive_crm_deal",
    access: "write",
    description:
      "[ESCRITA] Arquiva (envia para a Lixeira — padrão seguro e reversível) ou exclui em definitivo um card criado por engano no CRM, exigindo motivo e registrando quem fez e por quê no histórico administrativo.",
    inputSchema: {
      type: "object",
      required: ["dealId", "reason"],
      properties: {
        tenantId: TENANT_ID_PROP,
        dealId: { type: "string", description: "ID da negociação (crm_deals.id)." },
        reason: {
          type: "string",
          description: "Motivo obrigatório do arquivamento/exclusão (mínimo 3 caracteres, salvo na auditoria).",
        },
        mode: {
          type: "string",
          enum: ["archive", "delete_permanent"],
          default: "archive",
          description: "'archive' (padrão recomendado: envia o card à Lixeira sem apagar histórico) ou 'delete_permanent' (exclusão definitiva, exige confirmPermanentDelete=true e bloqueia cards com conversas vinculadas).",
        },
        confirmPermanentDelete: {
          type: "boolean",
          default: false,
          description: "Trava de segurança obrigatória (deve ser true) quando mode='delete_permanent'.",
        },
        detachConversations: {
          type: "boolean",
          default: false,
          description:
            "Quando true junto com mode='delete_permanent' e confirmPermanentDelete=true, desvincula automaticamente as conversas ligadas ao card (preservando 100% das conversas no chat) e exclui o card definitivamente em uma única chamada.",
        },
        operatorId: { type: "string", description: "ID do operador autor da ação (opcional)." },
        actorName: { type: "string", description: "Nome legível de quem solicitou o arquivamento/exclusão (opcional)." },
      },
    },
  },
  ...MCP_PHASE23_TOOLS,
  ...MCP_KNOWLEDGE_TOOLS,
  ...MCP_WAVE1_TOOLS,
  ...MCP_TRIAGE_AUDIT_TOOLS,
  ...MCP_OPERATOR_MESSAGES_TOOLS,
  ...MCP_TEMPLATE_GROUPS_TOOLS,
  ...MCP_SDR_ORCHESTRATOR_TOOLS,
  ...MCP_RD_MARKETING_TOOLS,
];

export const MCP_EXTENDED_TOOL_LABELS_PT: Record<string, string> = {
  list_meta_templates: "Listagem de Templates Meta",
  list_crm_pipelines: "Listagem Oficial de Funis e Etapas (CRM)",
  list_operators: "Listagem Oficial de Operadores e Equipes",
  create_crm_deal: "Criar Negociação (CRM)",
  update_crm_deal: "Editar Negociação Existente (CRM)",
  update_crm_deal_stage: "Mover Etapa da Negociação (CRM)",
  update_crm_deal_owner: "Alterar Responsável da Negociação (CRM)",
  mark_deal_won: "Marcar Negociação como Ganha (CRM)",
  mark_deal_lost: "Marcar Negociação como Perdida (CRM)",
  create_contact: "Criar Contato",
  update_contact: "Atualizar Contato",
  merge_contacts: "Mesclar Contatos Duplicados",
  replace_crm_deal_contact: "Trocar Contato Vinculado ao Card (CRM)",
  archive_crm_deal: "Arquivar / Excluir Negociação (CRM)",
  create_account: "Criar Empresa / Conta (CRM)",
  update_account: "Atualizar Empresa / Conta (CRM)",
  create_task: "Criar Tarefa / Atividade",
  update_task: "Atualizar Tarefa / Atividade",
  chat_send_message: "Enviar Mensagem no Chat (WhatsApp/Site)",
  chat_add_internal_note: "Adicionar Nota Interna no Chat",
  chat_transfer_conversation: "Transferir Conversa",
  chat_close_conversation: "Finalizar Conversa",
  create_conversation: "Abrir / Criar Conversa",
  update_meta_template_visibility: "Atualizar Visibilidade e Bindings de Template Meta",
  create_meta_template: "Criar & Submeter Template Meta",
  delete_meta_template: "Excluir Template Oficial na Meta",
  create_crm_custom_field: "Criar Campo Personalizado (CRM)",
  send_meta_template: "Enviar Template Oficial Meta",
  create_quick_response: "Criar Resposta Rápida",
  delete_quick_response: "Excluir Resposta Rápida",
  update_sector: "Atualizar Setor",
  ...MCP_PHASE23_TOOL_LABELS_PT,
  ...MCP_KNOWLEDGE_TOOL_LABELS_PT,
  ...MCP_WAVE1_TOOL_LABELS_PT,
  ...MCP_TRIAGE_AUDIT_TOOL_LABELS_PT,
  ...MCP_OPERATOR_MESSAGES_TOOL_LABELS_PT,
  ...MCP_TEMPLATE_GROUPS_TOOL_LABELS_PT,
  ...MCP_SDR_ORCHESTRATOR_TOOL_LABELS_PT,
  ...MCP_RD_MARKETING_TOOL_LABELS_PT,
};

const EXTENDED_TOOL_NAMES = new Set(MCP_EXTENDED_TOOLS.map((t) => t.name));

export function isExtendedMcpTool(name: string): boolean {
  return EXTENDED_TOOL_NAMES.has(name);
}

/**
 * Normaliza `parameters` vindos do MCP para `resolveMetaTemplateValues`:
 * - Se `parameters` não for enviado (ou tiver menos itens que `variableCount`) mas as variáveis
 *   possuírem binding automático (`customer_name` / `operator_name`), preenche os slots faltantes
 *   para que o binding resolva automaticamente sem exigir `parameters` redundante.
 * - Se alguma variável `manual` não receber valor, `resolveMetaTemplateValues` continua lançando
 *   erro explícito (`Valor ausente para {{N}}.`).
 */
export function buildMcpMetaTemplateSuppliedParams(
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
  // Caso comum: o cliente passou apenas os parâmetros manuais em ordem, omitindo os auto-bound
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

  return Array.from({ length: variableCount }, (_, offset) => {
    return rawList[offset] ?? { type: "text" as const, text: "" };
  });
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
  } else {
    const [pipe] = await db
      .select({ id: crmPipelines.id })
      .from(crmPipelines)
      .where(and(eq(crmPipelines.id, pipelineId), eq(crmPipelines.tenantId, tenantId)))
      .limit(1);
    if (!pipe) {
      throw new Error(`Funil '${pipelineId}' não encontrado no tenant '${tenantId}'.`);
    }
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

async function resolveConversationRecipient(tenantId: string, conversationId: string) {
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
      mainChannel: contacts.mainChannel,
    })
    .from(contacts)
    .where(and(eq(contacts.id, conv.contactId), eq(contacts.tenantId, tenantId)))
    .limit(1);

  if (!contact) {
    throw new Error("Conversa sem contato válido associado neste tenant.");
  }

  let phoneEntry: { phone: string; whatsappUserId: string | null } | null = null;
  if (conv.contactPhoneId) {
    const [cp] = await db
      .select({ phone: contactPhones.phone, whatsappUserId: contactPhones.whatsappUserId })
      .from(contactPhones)
      .where(
        and(
          eq(contactPhones.tenantId, tenantId),
          eq(contactPhones.contactId, conv.contactId),
          eq(contactPhones.id, conv.contactPhoneId),
        ),
      )
      .limit(1);
    phoneEntry = cp || null;
  }

  const effectivePhone = phoneEntry?.phone || conv.contactPhone || contact.phone || "";
  const effectiveUserId =
    phoneEntry?.whatsappUserId ||
    (!conv.contactPhoneId ? contact.whatsappUserId : undefined) ||
    undefined;

  return { conv, contact, effectivePhone, effectiveUserId };
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

export async function executeExtendedMcpTool(
  name: string,
  args: Record<string, unknown>,
  tenantId: "tecfag" | "valem",
  actor?: McpWriteActorContext,
): Promise<unknown> {
  switch (name) {
    // ── 1. LIST META TEMPLATES (READ) ────────────────────────────────────────
    case "list_meta_templates": {
      await ensureMetaTemplateGroupsSchema();
      if (args.syncFromMeta === true) {
        await syncMetaTemplates(tenantId);
      }
      const statusFilter = asTrimmedString(args.status)?.toUpperCase();
      const searchFilter = asTrimmedString(args.search)?.toLowerCase();
      const groupFilter = asTrimmedString(args.group);
      const groupFilterKey = groupFilter ? stripTemplateAccents(groupFilter) : null;
      const filterOnlyUngrouped =
        groupFilterKey === "__ungrouped__" ||
        groupFilterKey === "sem_grupo" ||
        groupFilterKey === "sem grupo" ||
        groupFilterKey === "sem_categoria" ||
        groupFilterKey === "sem categoria";

      const [rows, groupRows] = await Promise.all([
        db
          .select()
          .from(metaMessageTemplates)
          .where(eq(metaMessageTemplates.tenantId, tenantId))
          .orderBy(asc(metaMessageTemplates.name)),
        listMetaTemplateGroups(tenantId),
      ]);

      const activeRows = rows.filter((row) => row.status !== "DELETED");
      const countByGroupKey = new Map<string, number>();
      let unclassifiedCount = 0;
      for (const row of activeRows) {
        const groups = normalizeCustomGroups(row.customGroups);
        if (groups.length === 0) {
          unclassifiedCount++;
        } else {
          for (const gName of groups) {
            const key = stripTemplateAccents(gName);
            countByGroupKey.set(key, (countByGroupKey.get(key) ?? 0) + 1);
          }
        }
      }

      const filtered = activeRows.filter((row) => {
        if (statusFilter && row.status.toUpperCase() !== statusFilter) return false;
        if (searchFilter) {
          const hay = `${row.name} ${row.bodyText}`.toLowerCase();
          if (!hay.includes(searchFilter)) return false;
        }
        if (groupFilterKey) {
          const groups = normalizeCustomGroups(row.customGroups);
          if (filterOnlyUngrouped) {
            if (groups.length > 0) return false;
          } else if (!groups.some((g) => stripTemplateAccents(g) === groupFilterKey)) {
            return false;
          }
        }
        return true;
      });

      return {
        tenantId,
        syncedFromMeta: args.syncFromMeta === true,
        total: filtered.length,
        totalGroups: groupRows.length,
        unclassifiedCount,
        groups: groupRows.map((g) => ({
          id: g.id,
          name: g.name,
          templateCount: countByGroupKey.get(stripTemplateAccents(g.name)) ?? 0,
          allPipelines: g.allPipelines !== false,
          pipelineIds: Array.isArray(g.pipelineIds) ? g.pipelineIds : [],
          stageIds: Array.isArray(g.stageIds) ? g.stageIds : [],
          allSectors: g.allSectors !== false,
          sectorIds: Array.isArray(g.sectorIds) ? g.sectorIds : [],
        })),
        templates: filtered.map((t) => ({
          id: t.id,
          metaTemplateId: t.metaTemplateId,
          name: t.name,
          language: t.language,
          category: t.category,
          status: t.status,
          bodyText: t.bodyText,
          bindings: t.bindings,
          customGroups: normalizeCustomGroups(t.customGroups),
          allPipelines: t.allPipelines,
          pipelineIds: t.pipelineIds,
          stageIds: t.stageIds,
          allSectors: t.allSectors,
          sectorIds: t.sectorIds,
          rejectedReason: t.rejectedReason,
          lastSyncedAt: t.lastSyncedAt,
        })),
      };
    }

    // ── 2. CREATE CRM DEAL ───────────────────────────────────────────────────
    case "create_crm_deal": {
      const title = asTrimmedString(args.title);
      if (!title) throw new Error("Campo obrigatório 'title' não informado.");

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      const { pipelineId, stageId, stageName } = await resolvePipelineAndStage(tenantId, {
        pipelineId: asTrimmedString(args.pipelineId),
        pipelineName: asTrimmedString(args.pipelineName),
        stageId: asTrimmedString(args.stageId),
        stageName: asTrimmedString(args.stageName),
      });

      const contactObj =
        args.contact && typeof args.contact === "object" && !Array.isArray(args.contact)
          ? (args.contact as { name?: string; phone?: string; email?: string })
          : undefined;
      const contactIds = Array.isArray(args.contactIds)
        ? args.contactIds.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : undefined;

      let resolvedCustomFields: Record<string, unknown> | undefined;
      if (args.customFields !== undefined) {
        if (!args.customFields || typeof args.customFields !== "object" || Array.isArray(args.customFields)) {
          throw new Error("Campo 'customFields' deve ser um objeto chave→valor.");
        }
        const defs = await listCustomFields(tenantId, "deal");
        const idSet = new Set(defs.map((d) => d.id));
        const idByLowerName = new Map(defs.map((d) => [d.name.trim().toLowerCase(), d.id]));
        resolvedCustomFields = {};
        for (const [k, v] of Object.entries(args.customFields as Record<string, unknown>)) {
          if (idSet.has(k)) {
            resolvedCustomFields[k] = v;
          } else {
            resolvedCustomFields[idByLowerName.get(k.trim().toLowerCase()) || k] = v;
          }
        }
      }

      const deal = await crmService.createDeal(tenantId, operator?.id ?? null, {
        title,
        pipelineId,
        stageId,
        accountId: asTrimmedString(args.accountId) ?? null,
        value: args.value !== undefined && args.value !== null ? Number(args.value) : null,
        expectedCloseDate: parseOptionalDate(args.expectedCloseDate, "expectedCloseDate") ?? null,
        operatorId: operator?.id ?? null,
        contactId: asTrimmedString(args.contactId),
        contactIds,
        contact: contactObj?.name
          ? {
              name: String(contactObj.name).trim(),
              phone: contactObj.phone ? String(contactObj.phone).trim() : null,
              email: contactObj.email ? String(contactObj.email).trim() : null,
            }
          : null,
        conversationId: asTrimmedString(args.conversationId),
        source: asTrimmedString(args.source),
        campaign: asTrimmedString(args.campaign),
        initialNote: asTrimmedString(args.initialNote) ?? null,
        ...(resolvedCustomFields ? { customFields: resolvedCustomFields } : {}),
      });

      return {
        success: true,
        tenantId,
        dealId: deal.id,
        title: deal.title,
        pipelineId: deal.pipelineId,
        stageId: deal.stageId,
        stageName,
        status: deal.status,
        value: deal.value,
        operatorId: deal.operatorId,
        customFields: deal.customFields ?? {},
      };
    }

    // ── 3. UPDATE CRM DEAL STAGE ─────────────────────────────────────────────
    case "update_crm_deal_stage": {
      const dealId = asTrimmedString(args.dealId);
      if (!dealId) throw new Error("Campo obrigatório 'dealId' não informado.");

      const [existingDeal] = await db
        .select({ id: crmDeals.id, pipelineId: crmDeals.pipelineId, stageId: crmDeals.stageId })
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .limit(1);
      if (!existingDeal) {
        throw new Error(`Negociação '${dealId}' não encontrada no tenant '${tenantId}'.`);
      }

      const stageIdArg = asTrimmedString(args.stageId);
      const stageNameArg = asTrimmedString(args.stageName);
      if (!stageIdArg && !stageNameArg) {
        throw new Error("Informe 'stageId' ou 'stageName' para mover a negociação.");
      }

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      const target = await resolvePipelineAndStage(tenantId, {
        pipelineId: asTrimmedString(args.pipelineId),
        fallbackPipelineId: existingDeal.pipelineId,
        stageId: stageIdArg,
        stageName: stageNameArg,
      });

      const updated = await crmService.updateDeal(tenantId, dealId, operator?.id ?? null, {
        pipelineId: target.pipelineId,
        stageId: target.stageId,
      });

      return {
        success: true,
        tenantId,
        dealId: updated.id,
        previousStageId: existingDeal.stageId,
        pipelineId: updated.pipelineId,
        stageId: updated.stageId,
        stageName: target.stageName,
        status: updated.status,
      };
    }

    // ── 4. UPDATE CRM DEAL OWNER ─────────────────────────────────────────────
    case "update_crm_deal_owner": {
      const dealId = asTrimmedString(args.dealId);
      const operatorId = asTrimmedString(args.operatorId);
      if (!dealId || !operatorId) {
        throw new Error("Campos obrigatórios: 'dealId' e 'operatorId'.");
      }

      const targetOp = await assertOperatorInTenant(tenantId, operatorId);
      const updated = await crmService.updateDeal(tenantId, dealId, targetOp?.id ?? null, {
        operatorId: targetOp!.id,
      });

      return {
        success: true,
        tenantId,
        dealId: updated.id,
        operatorId: updated.operatorId,
        operatorName: targetOp!.name,
      };
    }

    // ── 5. MARK DEAL WON ─────────────────────────────────────────────────────
    case "mark_deal_won": {
      const dealId = asTrimmedString(args.dealId);
      if (!dealId) throw new Error("Campo obrigatório 'dealId' não informado.");

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      const stageId = asTrimmedString(args.stageId);
      if (stageId) {
        await resolvePipelineAndStage(tenantId, { stageId });
      }

      const updated = await crmService.updateDeal(tenantId, dealId, operator?.id ?? null, {
        status: "won",
        winReason: asTrimmedString(args.winReason) ?? null,
        ...(stageId ? { stageId } : {}),
      });

      return {
        success: true,
        tenantId,
        dealId: updated.id,
        status: updated.status,
        stageId: updated.stageId,
        wonAt: updated.wonAt,
      };
    }

    // ── 6. MARK DEAL LOST ────────────────────────────────────────────────────
    case "mark_deal_lost": {
      const dealId = asTrimmedString(args.dealId);
      const lossReason = asTrimmedString(args.lossReason);
      if (!dealId || !lossReason) {
        throw new Error("Campos obrigatórios: 'dealId' e 'lossReason'.");
      }

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      const updated = await crmService.updateDeal(tenantId, dealId, operator?.id ?? null, {
        status: "lost",
        lossReason,
      });

      return {
        success: true,
        tenantId,
        dealId: updated.id,
        status: updated.status,
        lossReason: updated.lossReason,
        lostAt: updated.lostAt,
      };
    }

    // ── 7. CREATE CONTACT ────────────────────────────────────────────────────
    case "create_contact": {
      const contactName = asTrimmedString(args.name);
      if (!contactName) throw new Error("Campo obrigatório 'name' não informado.");

      const phone = asTrimmedString(args.phone) ?? null;
      const email = asTrimmedString(args.email) ?? null;
      const cpf = asTrimmedString(args.cpf) ?? null;
      const cnpj = asTrimmedString(args.cnpj) ?? null;
      const accountId = asTrimmedString(args.accountId) ?? null;
      const deduplicate = args.deduplicateByPhone !== false;

      if (deduplicate && phone) {
        const existingMatch = await findContactByAnyPhone(db, tenantId, phone);
        if (existingMatch?.contact) {
          return {
            success: true,
            deduplicated: true,
            tenantId,
            contactId: existingMatch.contact.id,
            name: existingMatch.contact.name,
            phone: existingMatch.contact.phone,
            email: existingMatch.contact.email,
          };
        }
      }

      const id = `cont-${crypto.randomUUID()}`;
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx.insert(contacts).values({
          id,
          tenantId,
          name: contactName,
          phone,
          email,
          cpf,
          cnpj,
          accountId,
          mainChannel: "whatsapp",
          createdAt: now,
          updatedAt: now,
        });
        if (phone) {
          await syncContactPhones(tx, tenantId, id, [{ phone, isPrimary: true, label: "Principal" }]);
        }
      });

      return {
        success: true,
        deduplicated: false,
        tenantId,
        contactId: id,
        name: contactName,
        phone,
        email,
        cpf,
        cnpj,
        accountId,
      };
    }

    // ── 8. UPDATE CONTACT ────────────────────────────────────────────────────
    case "update_contact": {
      const contactId = asTrimmedString(args.contactId);
      if (!contactId) throw new Error("Campo obrigatório 'contactId' não informado.");

      const [existing] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)))
        .limit(1);
      if (!existing) {
        throw new Error(`Contato '${contactId}' não encontrado no tenant '${tenantId}'.`);
      }

      const updates: Partial<typeof contacts.$inferInsert> = { updatedAt: new Date() };
      if (args.name !== undefined) {
        const trimmed = asTrimmedString(args.name);
        if (!trimmed) throw new Error("Nome do contato não pode ser vazio.");
        updates.name = trimmed;
      }
      if (args.phone !== undefined) updates.phone = asTrimmedString(args.phone) ?? null;
      if (args.email !== undefined) updates.email = asTrimmedString(args.email) ?? null;
      if (args.cpf !== undefined) updates.cpf = asTrimmedString(args.cpf) ?? null;
      if (args.cnpj !== undefined) updates.cnpj = asTrimmedString(args.cnpj) ?? null;
      if (args.accountId !== undefined) updates.accountId = asTrimmedString(args.accountId) ?? null;
      if (args.walletOperatorId !== undefined) {
        if (args.walletOperatorId === null || args.walletOperatorId === "") {
          updates.walletOperatorId = null;
          updates.responsibleName = "Na Fila";
        } else {
          const walletOp = await assertOperatorInTenant(
            tenantId,
            asTrimmedString(args.walletOperatorId),
          );
          if (!walletOp) {
            throw new Error("Campo 'walletOperatorId' inválido.");
          }
          updates.walletOperatorId = walletOp.id;
          updates.responsibleName = walletOp.name;
        }
      }

      if (Object.keys(updates).length === 1) {
        throw new Error(
          "Informe ao menos um campo para atualizar ('name', 'phone', 'email', 'cpf', 'cnpj', 'accountId' ou 'walletOperatorId').",
        );
      }

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(contacts)
          .set(updates)
          .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)))
          .returning();
        if (args.phone !== undefined && typeof updates.phone === "string" && updates.phone) {
          await syncContactPhones(tx, tenantId, contactId, [
            { phone: updates.phone, isPrimary: true, label: "Principal" },
          ]);
        }
        return row;
      });

      return {
        success: true,
        tenantId,
        contactId: updated.id,
        name: updated.name,
        phone: updated.phone,
        email: updated.email,
        accountId: updated.accountId,
        walletOperatorId: updated.walletOperatorId,
        responsibleName: updated.responsibleName,
      };
    }

    // ── 9. CREATE ACCOUNT ────────────────────────────────────────────────────
    case "create_account": {
      const accountName = asTrimmedString(args.name);
      if (!accountName) throw new Error("Campo obrigatório 'name' não informado.");

      let resolvedCustomFields: Record<string, unknown> | undefined;
      if (args.customFields !== undefined) {
        if (!args.customFields || typeof args.customFields !== "object" || Array.isArray(args.customFields)) {
          throw new Error("Campo 'customFields' deve ser um objeto chave→valor.");
        }
        resolvedCustomFields = await resolveAccountCustomFieldsInput(
          tenantId,
          args.customFields as Record<string, unknown>,
        );
      }

      let addressPayload: Record<string, any> | undefined;
      if (args.address !== undefined) {
        if (!args.address || typeof args.address !== "object" || Array.isArray(args.address)) {
          throw new Error("Campo 'address' deve ser um objeto.");
        }
        addressPayload = args.address as Record<string, any>;
      }

      const account = await crmService.createAccount(tenantId, {
        name: accountName,
        type: args.type === "person" ? "person" : "company",
        tradeName: asTrimmedString(args.tradeName),
        segment: asTrimmedString(args.segment),
        document: asTrimmedString(args.document),
        email: asTrimmedString(args.email),
        phone: asTrimmedString(args.phone),
        website: asTrimmedString(args.website),
        notes: asTrimmedString(args.notes),
        ...(addressPayload ? { address: addressPayload } : {}),
        ...(resolvedCustomFields ? { customFields: resolvedCustomFields } : {}),
      });

      return {
        success: true,
        tenantId,
        accountId: account.id,
        name: account.name,
        type: account.type,
        document: account.document,
        customFields: account.customFields ?? {},
      };
    }

    // ── 10. UPDATE ACCOUNT ───────────────────────────────────────────────────
    case "update_account": {
      const accountId = asTrimmedString(args.accountId);
      if (!accountId) throw new Error("Campo obrigatório 'accountId' não informado.");

      const payload: Parameters<typeof crmService.updateAccount>[2] = {};
      if (args.name !== undefined) payload.name = asTrimmedString(args.name);
      if (args.type === "person" || args.type === "company") payload.type = args.type;
      if (args.tradeName !== undefined) payload.tradeName = asTrimmedString(args.tradeName) ?? null;
      if (args.segment !== undefined) payload.segment = asTrimmedString(args.segment) ?? null;
      if (args.document !== undefined) payload.document = asTrimmedString(args.document) ?? null;
      if (args.email !== undefined) payload.email = asTrimmedString(args.email) ?? null;
      if (args.phone !== undefined) payload.phone = asTrimmedString(args.phone) ?? null;
      if (args.website !== undefined) payload.website = asTrimmedString(args.website) ?? null;
      if (args.notes !== undefined) payload.notes = typeof args.notes === "string" ? args.notes : null;
      if (args.address !== undefined) {
        if (!args.address || typeof args.address !== "object" || Array.isArray(args.address)) {
          throw new Error("Campo 'address' deve ser um objeto.");
        }
        payload.address = args.address as Record<string, any>;
      }
      if (args.customFields !== undefined) {
        if (!args.customFields || typeof args.customFields !== "object" || Array.isArray(args.customFields)) {
          throw new Error("Campo 'customFields' deve ser um objeto chave→valor.");
        }
        payload.customFields = await resolveAccountCustomFieldsInput(
          tenantId,
          args.customFields as Record<string, unknown>,
        );
      }

      if (Object.keys(payload).length === 0) {
        throw new Error("Informe ao menos um campo para atualizar na conta/empresa.");
      }

      const updated = await crmService.updateAccount(tenantId, accountId, payload);
      return {
        success: true,
        tenantId,
        accountId: updated.id,
        name: updated.name,
        type: updated.type,
        document: updated.document,
        customFields: updated.customFields ?? {},
      };
    }

    // ── 11. CREATE TASK / DEAL ACTIVITY ──────────────────────────────────────
    case "create_task": {
      const title = asTrimmedString(args.title);
      if (!title) throw new Error("Campo obrigatório 'title' não informado.");

      const dealId = asTrimmedString(args.dealId);
      const taskType = asTrimmedString(args.type) || "task";
      const description = asTrimmedString(args.description);
      const dueDate = parseOptionalDate(args.dueDate, "dueDate") ?? null;
      const assignedOp = await assertOperatorInTenant(
        tenantId,
        asTrimmedString(args.assignedToOperatorId),
      );
      const conversationId = asTrimmedString(args.conversationId) ?? null;

      if (dealId) {
        const activity = await crmService.createDealActivity(
          tenantId,
          dealId,
          assignedOp?.id ?? null,
          {
            type: taskType,
            title,
            description,
            dueDate,
            conversationId,
            assignedToOperatorId: assignedOp?.id ?? null,
            assignedToOperatorIds: assignedOp ? [assignedOp.id] : null,
            status: "pending",
          },
        );
        return {
          success: true,
          storage: "crm_deal_activities",
          tenantId,
          taskId: activity.id,
          dealId: activity.dealId,
          title: activity.title,
          type: activity.type,
          status: activity.status,
          dueDate: activity.dueDate,
          assignedToOperatorId: activity.assignedToOperatorId,
        };
      }

      const taskId = `task-${crypto.randomUUID()}`;
      const now = new Date();
      await db.insert(tasks).values({
        id: taskId,
        tenantId,
        name: title,
        type: taskType,
        status: "pending",
        dueDate,
        description: description ?? null,
        chatConversationId: conversationId,
        operatorEmail: assignedOp?.email ?? null,
        createdAt: now,
        updatedAt: now,
      });

      return {
        success: true,
        storage: "tasks",
        tenantId,
        taskId,
        title,
        type: taskType,
        status: "pending",
        dueDate,
        operatorEmail: assignedOp?.email ?? null,
      };
    }

    // ── 12. UPDATE TASK / DEAL ACTIVITY ──────────────────────────────────────
    case "update_task": {
      const taskId = asTrimmedString(args.taskId);
      if (!taskId) throw new Error("Campo obrigatório 'taskId' não informado.");

      const statusArg = asTrimmedString(args.status) as
        | "pending"
        | "completed"
        | "cancelled"
        | undefined;
      if (statusArg && !["pending", "completed", "cancelled"].includes(statusArg)) {
        throw new Error("Status inválido. Use 'pending', 'completed' ou 'cancelled'.");
      }

      const assignedOp = await assertOperatorInTenant(
        tenantId,
        asTrimmedString(args.assignedToOperatorId),
      );
      const dueDate =
        args.dueDate !== undefined ? parseOptionalDate(args.dueDate, "dueDate") ?? null : undefined;

      // 1) Tenta localizar em crm_deal_activities (fluxo principal do Kanban de Tarefas)
      const [existingActivity] = await db
        .select({ id: crmDealActivities.id, dealId: crmDealActivities.dealId })
        .from(crmDealActivities)
        .where(
          and(
            eq(crmDealActivities.id, taskId),
            eq(crmDealActivities.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (existingActivity) {
        const updated = await crmService.updateDealActivity(
          tenantId,
          existingActivity.dealId,
          taskId,
          assignedOp?.id ?? null,
          {
            ...(statusArg ? { status: statusArg } : {}),
            ...(args.title !== undefined ? { title: asTrimmedString(args.title) } : {}),
            ...(args.description !== undefined
              ? { description: typeof args.description === "string" ? args.description : null }
              : {}),
            ...(dueDate !== undefined ? { dueDate } : {}),
            ...(assignedOp
              ? {
                  assignedToOperatorId: assignedOp.id,
                  assignedToOperatorIds: [assignedOp.id],
                }
              : {}),
            ...(args.completionNote !== undefined
              ? {
                  completionNote:
                    typeof args.completionNote === "string" ? args.completionNote : null,
                }
              : {}),
          },
        );
        return {
          success: true,
          storage: "crm_deal_activities",
          tenantId,
          taskId: updated.id,
          dealId: updated.dealId,
          title: updated.title,
          status: updated.status,
          dueDate: updated.dueDate,
        };
      }

      // 2) Fallback: tabela tasks avulsas
      const taskUpdates: Record<string, unknown> = { updatedAt: new Date() };
      if (statusArg) taskUpdates.status = statusArg;
      if (args.title !== undefined) {
        const trimmed = asTrimmedString(args.title);
        if (!trimmed) throw new Error("Título da tarefa não pode ser vazio.");
        taskUpdates.name = trimmed;
      }
      if (args.description !== undefined) {
        taskUpdates.description = typeof args.description === "string" ? args.description : null;
      }
      if (dueDate !== undefined) taskUpdates.dueDate = dueDate;
      if (assignedOp) taskUpdates.operatorEmail = assignedOp.email;

      const [updatedTask] = await db
        .update(tasks)
        .set(taskUpdates)
        .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId)))
        .returning();

      if (!updatedTask) {
        throw new Error(`Tarefa '${taskId}' não encontrada no tenant '${tenantId}'.`);
      }

      return {
        success: true,
        storage: "tasks",
        tenantId,
        taskId: updatedTask.id,
        title: updatedTask.name,
        status: updatedTask.status,
        dueDate: updatedTask.dueDate,
      };
    }

    // ── 13. CHAT SEND MESSAGE (REAL META / BAILEYS / SITE) ───────────────────
    case "chat_send_message": {
      const conversationId = asTrimmedString(args.conversationId);
      const content = asTrimmedString(args.content);
      if (!conversationId || !content) {
        throw new Error("Campos obrigatórios: 'conversationId' e 'content'.");
      }

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      const senderName = buildActorDisplayName(
        asTrimmedString(args.senderName),
        operator?.name,
        actor,
      );
      const idempotencyKey = asTrimmedString(args.idempotencyKey);
      const quotedMessageId = asTrimmedString(args.quotedMessageId);

      const { conv, contact, effectivePhone, effectiveUserId } =
        await resolveConversationRecipient(tenantId, conversationId);

      if (conv.queueState === "finalizados") {
        throw new Error(
          "A conversa está finalizada ('finalizados'). Reabra ou transfira a conversa antes de enviar mensagem.",
        );
      }

      SdrDebouncer.getInstance().clearSession(conversationId);

      // Canal Site (widget livechat)
      if (!conv.whatsappConnectionId && contact.mainChannel === SITE_CHANNEL) {
        const siteResult = await sendSiteOperatorText({
          tenantId,
          conversationId: conv.id,
          operatorId: operator?.id ?? conv.operatorId ?? `mcp-${actor?.keyId || "system"}`,
          text: content.slice(0, 4000),
          operatorName: senderName,
          idempotencyKey,
        });
        return {
          ...siteResult,
          channel: "site",
          tenantId,
          conversationId: conv.id,
        };
      }

      const target = await resolveConversationConnection(tenantId, conversationId);
      const recipientUserId = target.provider === "meta" ? effectiveUserId : undefined;
      const peer = conv.whatsappConnectionId
        ? await connectionPeerJid(tenantId, conv.whatsappConnectionId, conv.contactId)
        : null;

      if (!effectivePhone && !recipientUserId && !peer) {
        throw new Error("Contato sem telefone ou identificador WhatsApp válido para envio.");
      }

      const result = await outboundQueue.enqueueAndSend({
        idempotencyKey,
        tenantId,
        conversationId,
        recipientPhone: effectivePhone,
        recipientUserId,
        text: content,
        quotedMessageId,
        operatorId: operator?.id ?? conv.operatorId ?? null,
        senderName,
        isInternalNote: false,
      });

      if (!result.success) {
        throw new Error(result.error || `Falha no envio via ${target.provider} (${result.code || result.status}).`);
      }

      return {
        success: true,
        channel: target.provider,
        tenantId,
        conversationId,
        messageId: result.messageId,
        externalId: result.externalId ?? null,
        status: result.status,
        sentAtISO: result.sentAtISO ?? null,
      };
    }

    // ── 14. CHAT ADD INTERNAL NOTE ───────────────────────────────────────────
    case "chat_add_internal_note": {
      const conversationId = asTrimmedString(args.conversationId);
      const content = asTrimmedString(args.content);
      if (!conversationId || !content) {
        throw new Error("Campos obrigatórios: 'conversationId' e 'content'.");
      }

      const [conv] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
        .limit(1);
      if (!conv) {
        throw new Error(`Conversa '${conversationId}' não encontrada no tenant '${tenantId}'.`);
      }

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      const senderName = buildActorDisplayName(
        asTrimmedString(args.senderName),
        operator?.name,
        actor,
      );

      const result = await outboundQueue.enqueueAndSend({
        tenantId,
        conversationId,
        recipientPhone: "",
        text: content,
        operatorId: operator?.id ?? null,
        senderName,
        isInternalNote: true,
      });

      emitSseSafe(tenantId, {
        type: "message",
        message: {
          id: result.messageId,
          conversationId,
          senderType: "agent",
          senderName,
          content,
          isInternalNote: true,
          status: "accepted",
          sentAt: result.sentAtISO || new Date().toISOString(),
        },
      });

      return {
        success: true,
        tenantId,
        conversationId,
        messageId: result.messageId,
        isInternalNote: true,
        sentAtISO: result.sentAtISO ?? null,
      };
    }

    // ── 15. CHAT TRANSFER CONVERSATION ───────────────────────────────────────
    case "chat_transfer_conversation": {
      const conversationId = asTrimmedString(args.conversationId);
      const operatorId = asTrimmedString(args.operatorId);
      const sectorId = asTrimmedString(args.sectorId);
      const reason = asTrimmedString(args.reason);
      if (!conversationId) throw new Error("Campo obrigatório 'conversationId' não informado.");
      if (!operatorId && !sectorId) {
        throw new Error("Informe 'operatorId' (para transferir para operador) ou 'sectorId' (para transferir para fila do setor).");
      }

      const [conv] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
        .limit(1);
      if (!conv) {
        throw new Error(`Conversa '${conversationId}' não encontrada no tenant '${tenantId}'.`);
      }

      const targetOp = await assertOperatorInTenant(tenantId, operatorId);
      let targetSector: { id: string; name: string } | null = null;
      if (sectorId) {
        const [sec] = await db
          .select({ id: sectors.id, name: sectors.name })
          .from(sectors)
          .where(and(eq(sectors.id, sectorId), eq(sectors.tenantId, tenantId)))
          .limit(1);
        if (!sec) {
          throw new Error(`Setor '${sectorId}' não encontrado no tenant '${tenantId}'.`);
        }
        targetSector = sec;
      }

      const nextQueueState = targetOp ? "meus" : "fila";
      const now = new Date();
      const [updated] = await db
        .update(conversations)
        .set({
          queueState: nextQueueState,
          operatorId: targetOp ? targetOp.id : null,
          ...(targetSector ? { sectorId: targetSector.id } : {}),
          version: sql`${conversations.version} + 1`,
          updatedAt: now,
        })
        .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
        .returning();

      const actorLabel = buildActorDisplayName(undefined, undefined, actor);
      const sysMsgId = `sys-${crypto.randomUUID()}`;
      const sysText = targetOp
        ? `Atendimento transferido para ${targetOp.name}${targetSector ? ` (Setor: ${targetSector.name})` : ""} via ${actorLabel}.${reason ? ` Motivo: ${reason}` : ""}`
        : `Atendimento transferido para a fila do setor ${targetSector!.name} via ${actorLabel}.${reason ? ` Motivo: ${reason}` : ""}`;

      await db.insert(messages).values({
        id: sysMsgId,
        tenantId,
        conversationId,
        senderType: "system",
        senderName: "Sistema",
        content: sysText,
        isInternalNote: false,
        provider: "system",
        direction: "outbound",
        status: "accepted",
        sentAt: now,
        updatedAt: now,
      });

      emitSseSafe(tenantId, {
        type: "queue_update",
        conversationId,
        queueState: updated.queueState,
        operatorId: updated.operatorId,
        sectorId: updated.sectorId,
        version: updated.version,
      });

      return {
        success: true,
        tenantId,
        conversationId,
        queueState: updated.queueState,
        operatorId: updated.operatorId,
        operatorName: targetOp?.name ?? null,
        sectorId: updated.sectorId,
        sectorName: targetSector?.name ?? null,
        version: updated.version,
      };
    }

    // ── 16. CHAT CLOSE CONVERSATION ──────────────────────────────────────────
    case "chat_close_conversation": {
      const conversationId = asTrimmedString(args.conversationId);
      const reason = asTrimmedString(args.reason);
      if (!conversationId) throw new Error("Campo obrigatório 'conversationId' não informado.");

      const now = new Date();
      const [updated] = await db
        .update(conversations)
        .set({
          queueState: "finalizados",
          operatorId: null,
          unreadCount: 0,
          version: sql`${conversations.version} + 1`,
          updatedAt: now,
        })
        .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
        .returning();

      if (!updated) {
        throw new Error(`Conversa '${conversationId}' não encontrada no tenant '${tenantId}'.`);
      }

      const actorLabel = buildActorDisplayName(undefined, undefined, actor);
      const sysText = `Atendimento encerrado via ${actorLabel}.${reason ? ` Motivo: ${reason}` : ""}`;
      await db.insert(messages).values({
        id: `sys-${crypto.randomUUID()}`,
        tenantId,
        conversationId,
        senderType: "system",
        senderName: "Sistema",
        content: sysText,
        isInternalNote: false,
        provider: "system",
        direction: "outbound",
        status: "accepted",
        sentAt: now,
        updatedAt: now,
      });

      emitSseSafe(tenantId, {
        type: "queue_update",
        conversationId,
        queueState: "finalizados",
        operatorId: null,
        version: updated.version,
      });

      return {
        success: true,
        tenantId,
        conversationId: updated.id,
        queueState: updated.queueState,
        version: updated.version,
      };
    }

    // ── 17. CREATE / REOPEN CONVERSATION ─────────────────────────────────────
    case "create_conversation": {
      const contactId = asTrimmedString(args.contactId);
      if (!contactId) throw new Error("Campo obrigatório 'contactId' não informado.");

      const queueState = (asTrimmedString(args.queueState) || "fila") as
        | "fila"
        | "meus"
        | "automacao";
      if (!["fila", "meus", "automacao"].includes(queueState)) {
        throw new Error("queueState inválido. Use 'fila', 'meus' ou 'automacao'.");
      }

      const operatorId = asTrimmedString(args.operatorId);
      if (queueState === "meus" && !operatorId) {
        throw new Error("Informe 'operatorId' ao criar/reabrir conversa com queueState='meus'.");
      }
      const targetOp = await assertOperatorInTenant(tenantId, operatorId);

      const sectorId = asTrimmedString(args.sectorId);
      if (sectorId) {
        const [sec] = await db
          .select({ id: sectors.id })
          .from(sectors)
          .where(and(eq(sectors.id, sectorId), eq(sectors.tenantId, tenantId)))
          .limit(1);
        if (!sec) throw new Error(`Setor '${sectorId}' não encontrado no tenant '${tenantId}'.`);
      }

      const [contact] = await db
        .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
        .from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)))
        .limit(1);
      if (!contact) {
        throw new Error(`Contato '${contactId}' não encontrado no tenant '${tenantId}'.`);
      }

      const reopenIfExists = args.reopenIfExists !== false;
      // Busca exclusivamente a conversa do canal corporativo oficial (whatsappConnectionId IS NULL),
      // evitando reutilizar conversas paralelas de celulares Baileys individuais de vendedores.
      const [existingConv] = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.tenantId, tenantId),
            eq(conversations.contactId, contactId),
            isNull(conversations.whatsappConnectionId),
          ),
        )
        .limit(1);

      const now = new Date();
      if (existingConv) {
        if (!reopenIfExists) {
          throw new Error(
            `Já existe uma conversa no canal oficial ('${existingConv.id}') para o contato '${contactId}'.`,
          );
        }
        const [reopened] = await db
          .update(conversations)
          .set({
            queueState,
            operatorId: queueState === "meus" ? targetOp!.id : null,
            ...(sectorId ? { sectorId } : {}),
            version: sql`${conversations.version} + 1`,
            updatedAt: now,
          })
          .where(and(eq(conversations.id, existingConv.id), eq(conversations.tenantId, tenantId)))
          .returning();

        emitSseSafe(tenantId, {
          type: "queue_update",
          conversationId: reopened.id,
          queueState: reopened.queueState,
          operatorId: reopened.operatorId,
          sectorId: reopened.sectorId,
          version: reopened.version,
        });

        return {
          success: true,
          reopened: true,
          tenantId,
          conversationId: reopened.id,
          contactId,
          whatsappConnectionId: reopened.whatsappConnectionId ?? null,
          isOfficialChannel: !reopened.whatsappConnectionId,
          queueState: reopened.queueState,
          operatorId: reopened.operatorId,
          sectorId: reopened.sectorId,
        };
      }

      const convId = `conv-${crypto.randomUUID()}`;
      const [created] = await db
        .insert(conversations)
        .values({
          id: convId,
          tenantId,
          contactId,
          contactPhone: contact.phone,
          whatsappConnectionId: null,
          queueState,
          operatorId: queueState === "meus" ? targetOp!.id : null,
          sectorId: sectorId ?? null,
          unreadCount: 0,
          lastMessageTime: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      emitSseSafe(tenantId, {
        type: "queue_update",
        conversationId: created.id,
        queueState: created.queueState,
        operatorId: created.operatorId,
        sectorId: created.sectorId,
        version: created.version,
      });

      return {
        success: true,
        reopened: false,
        tenantId,
        conversationId: created.id,
        contactId,
        whatsappConnectionId: created.whatsappConnectionId ?? null,
        isOfficialChannel: true,
        queueState: created.queueState,
        operatorId: created.operatorId,
        sectorId: created.sectorId,
      };
    }

    // ── 18. UPDATE META TEMPLATE VISIBILITY ──────────────────────────────────
    case "update_meta_template_visibility": {
      const templateId = asTrimmedString(args.templateId);
      if (!templateId) throw new Error("Campo obrigatório 'templateId' não informado.");
      if (typeof args.allPipelines !== "boolean") {
        throw new Error("Campo obrigatório 'allPipelines' (boolean) não informado.");
      }

      await ensureMetaTemplateGroupsSchema();
      const [tpl] = await db
        .select({
          id: metaMessageTemplates.id,
          metaTemplateId: metaMessageTemplates.metaTemplateId,
          name: metaMessageTemplates.name,
        })
        .from(metaMessageTemplates)
        .where(
          and(
            eq(metaMessageTemplates.tenantId, tenantId),
            or(
              eq(metaMessageTemplates.id, templateId),
              eq(metaMessageTemplates.metaTemplateId, templateId),
            ),
          ),
        )
        .limit(1);

      if (!tpl) {
        throw new Error(`Template Meta '${templateId}' não encontrado no tenant '${tenantId}'.`);
      }

      const pipelineIds = Array.isArray(args.pipelineIds)
        ? args.pipelineIds.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : [];
      const stageIds = Array.isArray(args.stageIds)
        ? args.stageIds.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : [];

      const bindingsInput =
        args.bindings && typeof args.bindings === "object" && !Array.isArray(args.bindings)
          ? (args.bindings as Record<string, unknown>)
          : undefined;
      const customGroupsInput = Array.isArray(args.customGroups) ? args.customGroups : undefined;
      const sectorIdsArg = Array.isArray(args.sectorIds)
        ? args.sectorIds.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : undefined;
      const sectorNamesArg = Array.isArray(args.sectorNames)
        ? args.sectorNames.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : undefined;
      const sectorPatch = await resolveTenantSectorScopeInput(tenantId, {
        allSectors: typeof args.allSectors === "boolean" ? args.allSectors : undefined,
        sectorIds: sectorIdsArg,
        sectorNames: sectorNamesArg,
      });

      await setMetaTemplateBindings(
        tenantId,
        tpl.metaTemplateId,
        bindingsInput,
        customGroupsInput,
        {
          allPipelines: args.allPipelines,
          pipelineIds,
          stageIds,
          ...(sectorPatch.hasSectorPatch
            ? {
                allSectors: sectorPatch.allSectors,
                sectorIds: sectorPatch.sectorIds,
              }
            : {}),
        },
      );

      const [refreshedTpl] = await db
        .select({
          allPipelines: metaMessageTemplates.allPipelines,
          pipelineIds: metaMessageTemplates.pipelineIds,
          stageIds: metaMessageTemplates.stageIds,
          allSectors: metaMessageTemplates.allSectors,
          sectorIds: metaMessageTemplates.sectorIds,
          bindings: metaMessageTemplates.bindings,
          customGroups: metaMessageTemplates.customGroups,
        })
        .from(metaMessageTemplates)
        .where(and(eq(metaMessageTemplates.id, tpl.id), eq(metaMessageTemplates.tenantId, tenantId)))
        .limit(1);

      return {
        success: true,
        tenantId,
        templateId: tpl.id,
        metaTemplateId: tpl.metaTemplateId,
        name: tpl.name,
        allPipelines: refreshedTpl?.allPipelines ?? args.allPipelines,
        pipelineIds: refreshedTpl?.pipelineIds ?? pipelineIds,
        stageIds: refreshedTpl?.stageIds ?? stageIds,
        allSectors: refreshedTpl?.allSectors ?? true,
        sectorIds: Array.isArray(refreshedTpl?.sectorIds) ? refreshedTpl.sectorIds : [],
        notFoundSectors: sectorPatch.notFoundSectors,
        bindings: refreshedTpl?.bindings ?? {},
        customGroups: normalizeCustomGroups(refreshedTpl?.customGroups),
      };
    }

    // ── 18b. DELETE META TEMPLATE (GRAPH API REAL) ───────────────────────────
    case "delete_meta_template": {
      if (args.confirmDelete !== true) {
        throw new Error(
          "Exclusão definitiva na Meta bloqueada: passe confirmDelete=true para confirmar (a Meta bloqueia reutilizar o nome por 30 dias).",
        );
      }

      const metaTemplateIdArg = asTrimmedString(args.metaTemplateId);
      const templateIdArg = asTrimmedString(args.templateId);
      const templateNameArg = asTrimmedString(args.templateName);
      if (!metaTemplateIdArg && !templateIdArg && !templateNameArg) {
        throw new Error(
          "Informe 'metaTemplateId', 'templateId' ou 'templateName' para identificar o template a excluir.",
        );
      }

      await ensureMetaTemplateGroupsSchema();
      const lookupConds = [];
      if (metaTemplateIdArg) lookupConds.push(eq(metaMessageTemplates.metaTemplateId, metaTemplateIdArg));
      if (templateIdArg) {
        lookupConds.push(eq(metaMessageTemplates.id, templateIdArg));
        lookupConds.push(eq(metaMessageTemplates.metaTemplateId, templateIdArg));
      }
      if (templateNameArg) lookupConds.push(eq(metaMessageTemplates.name, templateNameArg));

      const matches = await db
        .select({
          id: metaMessageTemplates.id,
          metaTemplateId: metaMessageTemplates.metaTemplateId,
          name: metaMessageTemplates.name,
          language: metaMessageTemplates.language,
          status: metaMessageTemplates.status,
        })
        .from(metaMessageTemplates)
        .where(and(eq(metaMessageTemplates.tenantId, tenantId), or(...lookupConds)));

      const activeMatches = matches.filter((m) => m.status !== "DELETED");
      if (activeMatches.length === 0) {
        throw new Error(
          `Template Meta '${metaTemplateIdArg || templateIdArg || templateNameArg}' não encontrado (ou já excluído) no tenant '${tenantId}'.`,
        );
      }
      if (activeMatches.length > 1) {
        throw new Error(
          `Mais de um template corresponde ao filtro (${activeMatches.map((m) => `${m.name}:${m.metaTemplateId}`).join(", ")}). Informe 'metaTemplateId' exato.`,
        );
      }
      const targetTpl = activeMatches[0];

      // Guarda contra exclusão acidental de template vinculado a Webhook RD Marketing
      const flows = await db
        .select({ id: rdMarketingFlows.id, settings: rdMarketingFlows.settings })
        .from(rdMarketingFlows)
        .where(eq(rdMarketingFlows.tenantId, tenantId));

      const referencingFlows = flows
        .filter((f) => {
          const ref = String((f.settings as any)?.whatsappTemplateId || "").trim();
          return (
            ref &&
            (ref === targetTpl.id || ref === targetTpl.metaTemplateId || ref === targetTpl.name)
          );
        })
        .map((f) => ({
          flowId: f.id,
          flowName: String((f.settings as any)?.name || f.id),
        }));

      if (referencingFlows.length > 0 && args.forceDeleteIfReferenced !== true) {
        throw new Error(
          `Template '${targetTpl.name}' está referenciado em ${referencingFlows.length} fluxo(s) de Webhook RD Marketing (${referencingFlows.map((f) => f.flowName).join(", ")}). Troque o template nos fluxos antes de excluir ou passe forceDeleteIfReferenced=true.`,
        );
      }

      await deleteMetaTemplate(tenantId, targetTpl.metaTemplateId);

      return {
        success: true,
        tenantId,
        deleted: true,
        templateId: targetTpl.id,
        metaTemplateId: targetTpl.metaTemplateId,
        name: targetTpl.name,
        language: targetTpl.language,
        previousStatus: targetTpl.status,
        referencedByRdFlows: referencingFlows,
      };
    }

    // ── 18c. CREATE CRM CUSTOM FIELD ─────────────────────────────────────────
    case "create_crm_custom_field": {
      const entityType = (asTrimmedString(args.entityType) || "deal") as CustomFieldEntity;
      if (!isCustomFieldEntity(entityType)) {
        throw new Error("Campo 'entityType' inválido. Use: 'deal', 'company', 'contact' ou 'product'.");
      }
      const fieldType = asTrimmedString(args.fieldType);
      if (!isCustomFieldType(fieldType)) {
        throw new Error("Campo 'fieldType' inválido. Use: 'text', 'date', 'single', 'multiple', 'number' ou 'url'.");
      }
      const name = asTrimmedString(args.name);
      if (!name || name.length > 120) {
        throw new Error("Campo obrigatório 'name' deve ter entre 1 e 120 caracteres.");
      }
      if (conflictsWithStandardField(entityType, name)) {
        throw new Error(`O campo '${name}' já existe como campo padrão do sistema.`);
      }

      const customFieldId = asTrimmedString(args.fieldId);
      if (customFieldId && !/^[a-zA-Z0-9_-]{2,80}$/.test(customFieldId)) {
        throw new Error("Campo 'fieldId' inválido: use apenas letras, números, '_' e '-' (2 a 80 caracteres).");
      }

      const ifExistsReturnExisting = args.ifExistsReturnExisting !== false;
      const existingFields = await listCustomFields(tenantId, entityType);
      const matchedExisting = existingFields.find(
        (f) =>
          (customFieldId && f.id === customFieldId) ||
          f.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"),
      );
      if (matchedExisting) {
        if (ifExistsReturnExisting) {
          return {
            success: true,
            tenantId,
            reused: true,
            field: matchedExisting,
          };
        }
        throw new Error(`Já existe um campo personalizado '${matchedExisting.name}' (${matchedExisting.id}).`);
      }

      let options: Array<{ id: string; label: string }> = [];
      if (fieldType === "single" || fieldType === "multiple") {
        if (!Array.isArray(args.options) || args.options.length === 0 || args.options.length > 100) {
          throw new Error("Informe ao menos 1 opção (até 100) em 'options' para campos 'single' ou 'multiple'.");
        }
        options = args.options.map((entry: any) => {
          const label =
            typeof entry === "string"
              ? entry.trim()
              : typeof entry?.label === "string"
                ? entry.label.trim()
                : "";
          if (!label || label.length > 120) {
            throw new Error("Cada opção precisa ter 'label' de 1 a 120 caracteres.");
          }
          const optId =
            typeof entry === "object" && typeof entry?.id === "string" && entry.id.trim()
              ? entry.id.trim()
              : `opt-${crypto.randomUUID()}`;
          return { id: optId, label };
        });
      }

      const allPipelines = entityType !== "deal" || args.allPipelines !== false;
      let pipelineIds: string[] = [];
      if (!allPipelines) {
        const rawIds = Array.isArray(args.pipelineIds)
          ? Array.from(
              new Set(
                args.pipelineIds.filter((v): v is string => typeof v === "string" && v.trim().length > 0),
              ),
            )
          : [];
        if (rawIds.length === 0) {
          throw new Error("Informe ao menos um funil em 'pipelineIds' quando allPipelines=false.");
        }
        const tenantPipes = await db
          .select({ id: crmPipelines.id })
          .from(crmPipelines)
          .where(eq(crmPipelines.tenantId, tenantId));
        const allowedPipeSet = new Set(tenantPipes.map((p) => p.id));
        const invalidPipe = rawIds.find((id) => !allowedPipeSet.has(id));
        if (invalidPipe) {
          throw new Error(`Funil '${invalidPipe}' não pertence ao tenant '${tenantId}'.`);
        }
        pipelineIds = rawIds;
      }

      const required = args.required === true;
      const visibleOnCreate = args.visibleOnCreate !== false;
      if (required && !visibleOnCreate) {
        throw new Error("Um campo obrigatório deve ter visibleOnCreate=true.");
      }

      const finalId = customFieldId || `cf-${crypto.randomUUID()}`;
      const nextSortOrder = existingFields.length
        ? Math.max(...existingFields.map((item) => item.sortOrder)) + 1
        : 0;

      const [createdField] = await db
        .insert(crmCustomFieldDefinitions)
        .values({
          id: finalId,
          tenantId,
          entityType,
          name,
          fieldType,
          options,
          required,
          requiredRule: "always",
          requiredFromStageId: null,
          isUnique: entityType === "deal" && args.isUnique === true,
          visibleOnCreate,
          allPipelines,
          pipelineIds,
          sortOrder: nextSortOrder,
        })
        .returning();

      return {
        success: true,
        tenantId,
        reused: false,
        field: createdField,
      };
    }

    // ── 19. CREATE META TEMPLATE (GRAPH API REAL) ────────────────────────────
    case "create_meta_template": {
      const result = await createMetaTemplate(tenantId, {
        name: asTrimmedString(args.name),
        language: asTrimmedString(args.language) || "pt_BR",
        category: asTrimmedString(args.category),
        bodyText: asTrimmedString(args.bodyText),
        headerText: asTrimmedString(args.headerText),
        footerText: asTrimmedString(args.footerText),
        examples: Array.isArray(args.examples) ? args.examples.map(String) : undefined,
        bindings: args.bindings && typeof args.bindings === "object" ? args.bindings : undefined,
      });

      return {
        success: true,
        tenantId,
        template: result,
      };
    }

    // ── 20. SEND META TEMPLATE (WABA REAL VIA OUTBOUND QUEUE) ────────────────
    case "send_meta_template": {
      const conversationId = asTrimmedString(args.conversationId);
      const templateName = asTrimmedString(args.templateName);
      const templateLanguage = asTrimmedString(args.templateLanguage) || "pt_BR";
      if (!conversationId || !templateName) {
        throw new Error("Campos obrigatórios: 'conversationId' e 'templateName'.");
      }

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      const senderName = buildActorDisplayName(
        asTrimmedString(args.senderName),
        operator?.name,
        actor,
      );
      const idempotencyKey = asTrimmedString(args.idempotencyKey);

      const { conv, contact, effectivePhone, effectiveUserId } =
        await resolveConversationRecipient(tenantId, conversationId);

      const reopenIfClosed = args.reopenIfClosed === true;
      let reopened = false;
      let effectiveQueueState = conv.queueState;

      if (conv.queueState === "finalizados") {
        if (!reopenIfClosed) {
          throw new Error(
            "A conversa está finalizada ('finalizados'). Reabra a conversa antes de disparar o template (ou passe reopenIfClosed=true).",
          );
        }
        const nextQueueState = operator ? "meus" : "automacao";
        const [reopenedConv] = await db
          .update(conversations)
          .set({
            queueState: nextQueueState,
            operatorId: nextQueueState === "meus" ? operator!.id : null,
            version: sql`${conversations.version} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
          .returning();
        if (reopenedConv) {
          reopened = true;
          effectiveQueueState = reopenedConv.queueState;
          emitSseSafe(tenantId, {
            type: "queue_update",
            conversationId: reopenedConv.id,
            queueState: reopenedConv.queueState,
            operatorId: reopenedConv.operatorId,
            sectorId: reopenedConv.sectorId,
            version: reopenedConv.version,
          });
        }
      }

      const target = await resolveConversationConnection(tenantId, conversationId);
      if (target.provider !== "meta") {
        throw new Error(
          `Esta conversa usa o canal '${target.provider}'. Templates oficiais da Meta só podem ser enviados em conversas do canal 'meta'.`,
        );
      }

      if (!effectivePhone && !effectiveUserId) {
        throw new Error("Contato sem telefone ou BSUID válido para envio via Meta Cloud API.");
      }

      const approved = await metaAdapter.listApprovedTemplates(tenantId);
      const selected = approved.find(
        (item) => item.name === templateName && item.language === templateLanguage,
      );
      if (!selected?.supported) {
        throw new Error(
          `Template '${templateName}' (${templateLanguage}) não está aprovado pela Meta ou tem formato não suportado neste tenant.`,
        );
      }

      const rawParams = buildMcpMetaTemplateSuppliedParams(
        selected.variableCount,
        selected.bindings,
        args.parameters,
      );
      const preferredDealId = asTrimmedString(args.dealId);
      const hasDealFieldBindings = Object.values(selected.bindings || {}).some((b) =>
        Boolean(getDealFieldBindingKey(b)),
      );
      const dealFieldContext =
        hasDealFieldBindings || preferredDealId
          ? await loadDealCustomFieldsForTemplate(tenantId, conversationId, preferredDealId)
          : null;
      const fallbackCustomerName =
        contact.name?.trim() ||
        (Array.isArray(args.parameters) && args.parameters[0] !== undefined
          ? String(args.parameters[0]).trim()
          : "");
      const values = resolveMetaTemplateValues(
        selected.variableCount,
        selected.bindings,
        rawParams,
        {
          customerName: fallbackCustomerName,
          operatorName: senderName,
          dealCustomFields: dealFieldContext?.dealCustomFields,
          dealCustomFieldNamesById: dealFieldContext?.dealCustomFieldNamesById,
        },
      );
      const resolvedParams = values.map((value) => ({ type: "text" as const, text: value }));
      const templateComponents = resolvedParams.length
        ? [{ type: "body", parameters: resolvedParams }]
        : [];
      const renderedText = selected.bodyText.replace(
        /@?\{\{(\d+)\}\}/g,
        (_, num) => resolvedParams[Number(num) - 1]?.text || `{{${num}}}`,
      );

      SdrDebouncer.getInstance().clearSession(conversationId);

      const result = await outboundQueue.enqueueAndSend({
        idempotencyKey,
        tenantId,
        conversationId,
        recipientPhone: effectivePhone,
        recipientUserId: effectiveUserId,
        text: renderedText,
        templateName: selected.name,
        templateLanguage: selected.language,
        templateComponents,
        operatorId: operator?.id ?? conv.operatorId ?? null,
        senderName,
        isInternalNote: false,
      });

      if (!result.success) {
        throw new Error(
          result.error || `Falha no envio do template Meta (${result.code || result.status}).`,
        );
      }

      return {
        success: true,
        tenantId,
        conversationId,
        reopened,
        queueState: effectiveQueueState,
        templateName: selected.name,
        templateLanguage: selected.language,
        resolvedParameters: values,
        resolvedFromDealId: dealFieldContext?.dealId ?? null,
        renderedText,
        messageId: result.messageId,
        externalId: result.externalId ?? null,
        status: result.status,
        sentAtISO: result.sentAtISO ?? null,
      };
    }

    // ── 21. CREATE QUICK RESPONSE ────────────────────────────────────────────
    case "create_quick_response": {
      const rawShortcut = asTrimmedString(args.shortcut);
      const text = asTrimmedString(args.text);
      if (!rawShortcut || !text) {
        throw new Error("Campos obrigatórios: 'shortcut' e 'text'.");
      }
      const shortcut = rawShortcut.startsWith("/") ? rawShortcut : `/${rawShortcut}`;
      const id = `qr-${crypto.randomUUID()}`;
      const [created] = await db
        .insert(quickResponses)
        .values({
          id,
          tenantId,
          shortcut,
          text,
          description: asTrimmedString(args.description) ?? null,
          createdAt: new Date(),
        })
        .returning();

      return {
        success: true,
        tenantId,
        quickResponseId: created.id,
        shortcut: created.shortcut,
        text: created.text,
        description: created.description,
      };
    }

    // ── 22. DELETE QUICK RESPONSE ────────────────────────────────────────────
    case "delete_quick_response": {
      const qrId = asTrimmedString(args.quickResponseId) || asTrimmedString(args.qrId);
      if (!qrId) throw new Error("Campo obrigatório 'quickResponseId' não informado.");

      const [deleted] = await db
        .delete(quickResponses)
        .where(and(eq(quickResponses.id, qrId), eq(quickResponses.tenantId, tenantId)))
        .returning({ id: quickResponses.id, shortcut: quickResponses.shortcut });

      if (!deleted) {
        throw new Error(`Resposta rápida '${qrId}' não encontrada no tenant '${tenantId}'.`);
      }

      return {
        success: true,
        tenantId,
        deletedId: deleted.id,
        shortcut: deleted.shortcut,
      };
    }

    // ── 23. UPDATE SECTOR ────────────────────────────────────────────────────
    case "update_sector": {
      const sectorId = asTrimmedString(args.sectorId);
      if (!sectorId) throw new Error("Campo obrigatório 'sectorId' não informado.");

      const [existing] = await db
        .select()
        .from(sectors)
        .where(and(eq(sectors.id, sectorId), eq(sectors.tenantId, tenantId)))
        .limit(1);
      if (!existing) {
        throw new Error(`Setor '${sectorId}' não encontrado no tenant '${tenantId}'.`);
      }

      const updates: Partial<typeof sectors.$inferInsert> = {};
      if (args.name !== undefined) {
        const trimmedName = asTrimmedString(args.name);
        if (!trimmedName) throw new Error("Nome do setor não pode ser vazio.");
        updates.name = trimmedName;
      }

      if (args.operatorIds !== undefined) {
        if (!Array.isArray(args.operatorIds)) {
          throw new Error("'operatorIds' deve ser um array de IDs de operadores.");
        }
        const uniqueIds = Array.from(
          new Set(
            args.operatorIds
              .filter((v): v is string => typeof v === "string")
              .map((v) => v.trim())
              .filter(Boolean),
          ),
        );
        if (uniqueIds.length > 0) {
          const validOps = await db
            .select({ id: operators.id })
            .from(operators)
            .where(and(eq(operators.tenantId, tenantId), inArray(operators.id, uniqueIds)));
          const validSet = new Set(validOps.map((o) => o.id));
          const invalid = uniqueIds.filter((id) => !validSet.has(id));
          if (invalid.length > 0) {
            throw new Error(
              `Operadores não encontrados no tenant '${tenantId}': ${invalid.join(", ")}.`,
            );
          }
        }
        updates.operatorIds = uniqueIds;
      }

      if (Object.keys(updates).length === 0) {
        throw new Error("Informe 'name' e/ou 'operatorIds' para atualizar o setor.");
      }

      const [updated] = await db
        .update(sectors)
        .set(updates)
        .where(and(eq(sectors.id, sectorId), eq(sectors.tenantId, tenantId)))
        .returning();

      return {
        success: true,
        tenantId,
        sectorId: updated.id,
        name: updated.name,
        operatorIds: updated.operatorIds,
      };
    }

    // ── 24. LIST CRM PIPELINES (READ — FASE 1 / ITEM 2) ──────────────────────
    case "list_crm_pipelines": {
      const includeDealCounts = args.includeDealCounts === true;
      const includeCustomFields = args.includeCustomFields === true;
      const searchFilter = asTrimmedString(args.search)?.toLowerCase();

      const allPipelines = await crmService.getPipelines(tenantId, {
        includeDealCounts,
      });

      const filtered = searchFilter
        ? allPipelines.filter((p) => {
            if (p.name.toLowerCase().includes(searchFilter)) return true;
            return p.stages.some((s) => s.name.toLowerCase().includes(searchFilter));
          })
        : allPipelines;

      const pipelinesOut = filtered.map((p) => ({
        id: p.id,
        name: p.name,
        orderIndex: p.orderIndex,
        isDefault: p.isDefault,
        color: p.color,
        coolingDays: p.coolingDays,
        ...(includeDealCounts ? { dealsCount: p.dealsCount ?? 0 } : {}),
        stages: p.stages.map((s) => ({
          id: s.id,
          name: s.name,
          orderIndex: s.orderIndex,
          isWinStage: s.isWinStage,
          isLossStage: s.isLossStage,
          requiredFields: s.requiredFields,
          ...(includeDealCounts ? { dealsCount: s.dealsCount ?? 0 } : {}),
        })),
      }));

      const totalStages = pipelinesOut.reduce((acc, p) => acc + p.stages.length, 0);

      let customFieldsOut:
        | Array<{
            id: string;
            name: string;
            fieldType: string;
            required: boolean;
            allPipelines: boolean;
            pipelineIds: string[];
            options: Array<{ id: string; label: string }>;
          }>
        | undefined;

      if (includeCustomFields) {
        const defs = await listCustomFields(tenantId, "deal");
        customFieldsOut = defs.map((f) => ({
          id: f.id,
          name: f.name,
          fieldType: f.fieldType,
          required: f.required,
          allPipelines: f.allPipelines,
          pipelineIds: f.pipelineIds,
          options: f.options,
        }));
      }

      return {
        tenantId,
        totalPipelines: pipelinesOut.length,
        totalStages,
        pipelines: pipelinesOut,
        ...(customFieldsOut ? { customFields: customFieldsOut } : {}),
      };
    }

    // ── 25. LIST OPERATORS (READ — FASE 1 / ITEM 2) ──────────────────────────
    case "list_operators": {
      const sectorIdFilter = asTrimmedString(args.sectorId);
      const sectorNameFilter = asTrimmedString(args.sectorName)?.toLowerCase();
      const roleFilter = asTrimmedString(args.role)?.toLowerCase();
      const onlyOnline = args.onlyOnline === true;
      const searchFilter = asTrimmedString(args.search)?.toLowerCase();

      const [opRows, sectorRows, groupRows] = await Promise.all([
        db
          .select({
            id: operators.id,
            name: operators.name,
            email: operators.email,
            role: operators.role,
            status: operators.status,
            isOnline: operators.isOnline,
            groupId: operators.groupId,
            lastSeenAt: operators.lastSeenAt,
          })
          .from(operators)
          .where(eq(operators.tenantId, tenantId))
          .orderBy(asc(operators.name)),
        db
          .select({
            id: sectors.id,
            name: sectors.name,
            operatorIds: sectors.operatorIds,
          })
          .from(sectors)
          .where(eq(sectors.tenantId, tenantId))
          .orderBy(asc(sectors.name)),
        db
          .select({
            id: accessGroups.id,
            name: accessGroups.name,
          })
          .from(accessGroups)
          .where(eq(accessGroups.tenantId, tenantId)),
      ]);

      const groupById = new Map(groupRows.map((g) => [g.id, g.name]));
      const sectorsByOpId = new Map<string, Array<{ id: string; name: string }>>();

      for (const sec of sectorRows) {
        const ids = Array.isArray(sec.operatorIds) ? sec.operatorIds : [];
        for (const opId of ids) {
          const list = sectorsByOpId.get(opId) || [];
          list.push({ id: sec.id, name: sec.name });
          sectorsByOpId.set(opId, list);
        }
      }

      const filteredOps = opRows
        .map((op) => ({
          id: op.id,
          name: op.name,
          email: op.email,
          role: op.role,
          status: op.status,
          isOnline: op.isOnline,
          lastSeenAt: op.lastSeenAt,
          group: op.groupId ? { id: op.groupId, name: groupById.get(op.groupId) || null } : null,
          sectors: sectorsByOpId.get(op.id) || [],
        }))
        .filter((op) => {
          if (roleFilter && op.role.toLowerCase() !== roleFilter) return false;
          if (onlyOnline && !op.isOnline) return false;
          if (sectorIdFilter && !op.sectors.some((s) => s.id === sectorIdFilter)) return false;
          if (
            sectorNameFilter &&
            !op.sectors.some((s) => s.name.toLowerCase().includes(sectorNameFilter))
          ) {
            return false;
          }
          if (searchFilter) {
            const hay = `${op.name} ${op.email}`.toLowerCase();
            if (!hay.includes(searchFilter)) return false;
          }
          return true;
        });

      return {
        tenantId,
        totalOperators: filteredOps.length,
        totalSectors: sectorRows.length,
        operators: filteredOps,
        sectors: sectorRows.map((s) => ({
          id: s.id,
          name: s.name,
          operatorIds: Array.isArray(s.operatorIds) ? s.operatorIds : [],
        })),
      };
    }

    // ── 26. UPDATE CRM DEAL (WRITE — FASE 1 / ITEM 1) ────────────────────────
    case "update_crm_deal": {
      const dealId = asTrimmedString(args.dealId);
      if (!dealId) throw new Error("Campo obrigatório 'dealId' não informado.");

      const [existingDeal] = await db
        .select({
          id: crmDeals.id,
          pipelineId: crmDeals.pipelineId,
          stageId: crmDeals.stageId,
        })
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .limit(1);
      if (!existingDeal) {
        throw new Error(`Negociação '${dealId}' não encontrada no tenant '${tenantId}'.`);
      }

      const actorOp = await assertOperatorInTenant(tenantId, asTrimmedString(args.actorOperatorId));

      const updatePayload: Parameters<typeof crmService.updateDeal>[3] = {};
      const updatedFields: string[] = [];

      if (args.title !== undefined) {
        const trimmedTitle = asTrimmedString(args.title);
        if (!trimmedTitle) throw new Error("O campo 'title' não pode ser vazio.");
        updatePayload.title = trimmedTitle;
        updatedFields.push("title");
      }
      if (args.value !== undefined) {
        if (args.value === null || args.value === "") {
          updatePayload.value = null;
        } else {
          const num = Number(args.value);
          if (!Number.isFinite(num) || num < 0) {
            throw new Error(`Valor inválido em 'value': '${String(args.value)}'.`);
          }
          updatePayload.value = num;
        }
        updatedFields.push("value");
      }
      if (args.source !== undefined) {
        updatePayload.source = args.source === null ? "" : String(args.source).trim();
        updatedFields.push("source");
      }
      if (args.campaign !== undefined) {
        updatePayload.campaign = args.campaign === null ? "" : String(args.campaign).trim();
        updatedFields.push("campaign");
      }
      if (args.expectedCloseDate !== undefined) {
        updatePayload.expectedCloseDate =
          args.expectedCloseDate === null || args.expectedCloseDate === ""
            ? null
            : parseOptionalDate(args.expectedCloseDate, "expectedCloseDate") ?? null;
        updatedFields.push("expectedCloseDate");
      }
      if (args.rating !== undefined) {
        const ratingNum = Number(args.rating);
        if (!Number.isInteger(ratingNum) || ratingNum < 0 || ratingNum > 5) {
          throw new Error("O campo 'rating' deve ser um inteiro entre 0 e 5.");
        }
        updatePayload.rating = ratingNum;
        updatedFields.push("rating");
      }
      if (args.accountId !== undefined) {
        updatePayload.accountId = args.accountId === null ? null : asTrimmedString(args.accountId) ?? null;
        updatedFields.push("accountId");
      }
      if (args.operatorId !== undefined) {
        if (args.operatorId === null || args.operatorId === "") {
          updatePayload.operatorId = null;
        } else {
          const targetOp = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
          updatePayload.operatorId = targetOp!.id;
        }
        updatedFields.push("operatorId");
      }

      const hasPipelineOrStage =
        args.pipelineId !== undefined ||
        args.pipelineName !== undefined ||
        args.stageId !== undefined ||
        args.stageName !== undefined;
      if (hasPipelineOrStage) {
        const resolved = await resolvePipelineAndStage(tenantId, {
          pipelineId: asTrimmedString(args.pipelineId),
          pipelineName: asTrimmedString(args.pipelineName),
          fallbackPipelineId: existingDeal.pipelineId,
          stageId: asTrimmedString(args.stageId),
          stageName: asTrimmedString(args.stageName),
        });
        updatePayload.pipelineId = resolved.pipelineId;
        updatePayload.stageId = resolved.stageId;
        updatedFields.push("pipelineId", "stageId");
      }

      if (args.status !== undefined) {
        if (args.status !== "open" && args.status !== "paused") {
          throw new Error(
            "Campo 'status' em update_crm_deal aceita apenas 'open' ou 'paused'. Para marcar como ganho ou perdido, use mark_deal_won ou mark_deal_lost.",
          );
        }
        updatePayload.status = args.status;
        updatedFields.push("status");
      }
      if (args.pausedReason !== undefined) {
        updatePayload.pausedReason =
          args.pausedReason === null ? null : asTrimmedString(args.pausedReason) ?? null;
        updatedFields.push("pausedReason");
      }
      if (args.entryChannel !== undefined) {
        updatePayload.entryChannel =
          args.entryChannel === null ? null : asTrimmedString(args.entryChannel) ?? null;
        updatedFields.push("entryChannel");
      }
      if (args.utmSource !== undefined) {
        updatePayload.utmSource = args.utmSource === null ? null : asTrimmedString(args.utmSource) ?? null;
        updatedFields.push("utmSource");
      }
      if (args.utmMedium !== undefined) {
        updatePayload.utmMedium = args.utmMedium === null ? null : asTrimmedString(args.utmMedium) ?? null;
        updatedFields.push("utmMedium");
      }
      if (args.utmCampaign !== undefined) {
        updatePayload.utmCampaign =
          args.utmCampaign === null ? null : asTrimmedString(args.utmCampaign) ?? null;
        updatedFields.push("utmCampaign");
      }
      if (args.utmContent !== undefined) {
        updatePayload.utmContent =
          args.utmContent === null ? null : asTrimmedString(args.utmContent) ?? null;
        updatedFields.push("utmContent");
      }
      if (args.utmTerm !== undefined) {
        updatePayload.utmTerm = args.utmTerm === null ? null : asTrimmedString(args.utmTerm) ?? null;
        updatedFields.push("utmTerm");
      }
      if (args.clickId !== undefined) {
        updatePayload.clickId = args.clickId === null ? null : asTrimmedString(args.clickId) ?? null;
        updatedFields.push("clickId");
      }
      if (args.landingPage !== undefined) {
        updatePayload.landingPage =
          args.landingPage === null ? null : asTrimmedString(args.landingPage) ?? null;
        updatedFields.push("landingPage");
      }
      if (args.expectedVersion !== undefined) {
        const v = Number(args.expectedVersion);
        if (!Number.isInteger(v) || v < 1) {
          throw new Error("Campo 'expectedVersion' deve ser um inteiro positivo.");
        }
        updatePayload.expectedVersion = v;
      }

      if (args.customFields !== undefined) {
        if (!args.customFields || typeof args.customFields !== "object" || Array.isArray(args.customFields)) {
          throw new Error("Campo 'customFields' deve ser um objeto chave→valor.");
        }
        const rawCf = args.customFields as Record<string, unknown>;
        const defs = await listCustomFields(tenantId, "deal");
        const idByExactId = new Set(defs.map((d) => d.id));
        const idByLowerName = new Map(defs.map((d) => [d.name.trim().toLowerCase(), d.id]));
        const resolvedCf: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rawCf)) {
          if (idByExactId.has(k)) {
            resolvedCf[k] = v;
          } else {
            const mappedId = idByLowerName.get(k.trim().toLowerCase());
            resolvedCf[mappedId || k] = v;
          }
        }
        updatePayload.customFields = resolvedCf;
        updatedFields.push("customFields");
      }

      const productArg =
        args.product && typeof args.product === "object" && !Array.isArray(args.product)
          ? (args.product as {
              productId?: unknown;
              name?: unknown;
              quantity?: unknown;
              unitPrice?: unknown;
              discountPercent?: unknown;
              notes?: unknown;
            })
          : undefined;

      if (updatedFields.length === 0 && !productArg) {
        throw new Error(
          "Informe ao menos um campo para atualizar ('title', 'value', 'source', 'campaign', 'customFields', 'product', 'operatorId', 'stageId', etc.).",
        );
      }

      let addedProduct: unknown = undefined;
      if (productArg) {
        const prodId = asTrimmedString(productArg.productId);
        let prodName = asTrimmedString(productArg.name);
        let prodUnitPrice =
          productArg.unitPrice !== undefined && productArg.unitPrice !== null
            ? Number(productArg.unitPrice)
            : undefined;

        if (prodId) {
          const [catalogProd] = await db
            .select()
            .from(crmProducts)
            .where(and(eq(crmProducts.tenantId, tenantId), eq(crmProducts.id, prodId)))
            .limit(1);
          if (!catalogProd) {
            throw new Error(`Produto '${prodId}' não encontrado no catálogo do tenant '${tenantId}'.`);
          }
          if (!prodName) prodName = catalogProd.name;
          if (prodUnitPrice === undefined) prodUnitPrice = Number(catalogProd.unitPrice || 0);
        }

        if (!prodName) {
          throw new Error("Em 'product', informe 'name' ou um 'productId' válido do catálogo.");
        }

        addedProduct = await crmService.addDealProduct(tenantId, dealId, actorOp?.id ?? null, {
          productId: prodId ?? null,
          name: prodName,
          quantity: productArg.quantity !== undefined ? Number(productArg.quantity) : 1,
          unitPrice: prodUnitPrice ?? 0,
          discountPercent:
            productArg.discountPercent !== undefined ? Number(productArg.discountPercent) : 0,
          notes: asTrimmedString(productArg.notes) ?? null,
        });
        updatedFields.push("product");
      }

      if (Object.keys(updatePayload).length > 0) {
        await crmService.updateDeal(tenantId, dealId, actorOp?.id ?? null, updatePayload);
      }

      const [freshDeal] = await db
        .select()
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .limit(1);

      const [[pipeRow], [stageRow], [ownerRow], dealContactsList, dealProductsList] = await Promise.all([
        freshDeal?.pipelineId
          ? db
              .select({ id: crmPipelines.id, name: crmPipelines.name })
              .from(crmPipelines)
              .where(and(eq(crmPipelines.tenantId, tenantId), eq(crmPipelines.id, freshDeal.pipelineId)))
              .limit(1)
          : Promise.resolve([undefined]),
        freshDeal?.stageId
          ? db
              .select({ id: crmStages.id, name: crmStages.name })
              .from(crmStages)
              .where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.id, freshDeal.stageId)))
              .limit(1)
          : Promise.resolve([undefined]),
        freshDeal?.operatorId
          ? db
              .select({ id: operators.id, name: operators.name, email: operators.email })
              .from(operators)
              .where(and(eq(operators.tenantId, tenantId), eq(operators.id, freshDeal.operatorId)))
              .limit(1)
          : Promise.resolve([undefined]),
        crmService.getDealContacts(tenantId, dealId),
        crmService.getDealProducts(tenantId, dealId),
      ]);

      return {
        success: true,
        tenantId,
        dealId,
        updatedFields: Array.from(new Set(updatedFields)),
        ...(addedProduct ? { addedProduct } : {}),
        deal: freshDeal
          ? {
              id: freshDeal.id,
              title: freshDeal.title,
              status: freshDeal.status,
              value: freshDeal.value,
              currency: freshDeal.currency,
              pipelineId: freshDeal.pipelineId,
              pipelineName: pipeRow?.name ?? null,
              stageId: freshDeal.stageId,
              stageName: stageRow?.name ?? null,
              operatorId: freshDeal.operatorId,
              operatorName: ownerRow?.name ?? null,
              accountId: freshDeal.accountId,
              source: freshDeal.source,
              campaign: freshDeal.campaign,
              rating: freshDeal.rating,
              expectedCloseDate: freshDeal.expectedCloseDate,
              pausedReason: freshDeal.pausedReason,
              entryChannel: freshDeal.entryChannel,
              utmSource: freshDeal.utmSource,
              utmMedium: freshDeal.utmMedium,
              utmCampaign: freshDeal.utmCampaign,
              utmContent: freshDeal.utmContent,
              utmTerm: freshDeal.utmTerm,
              clickId: freshDeal.clickId,
              landingPage: freshDeal.landingPage,
              customFields: freshDeal.customFields,
              version: freshDeal.version,
              updatedAt: freshDeal.updatedAt,
              contacts: dealContactsList,
              products: dealProductsList,
            }
          : null,
      };
    }

    // ── 27. MERGE CONTACTS (WRITE — FASE 1 / ITEM 3) ─────────────────────────
    case "merge_contacts": {
      const sourceContactId = asTrimmedString(args.sourceContactId);
      const targetContactId = asTrimmedString(args.targetContactId);
      if (!sourceContactId || !targetContactId) {
        throw new Error("Campos obrigatórios: 'sourceContactId' e 'targetContactId'.");
      }
      if (sourceContactId === targetContactId) {
        throw new Error("'sourceContactId' e 'targetContactId' não podem ser iguais.");
      }

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      const actorName = buildActorDisplayName(
        asTrimmedString(args.actorName),
        operator?.name,
        actor,
      );
      const strategy =
        args.conversationConflictStrategy === "block" ? "block" : "merge_messages";

      return await mergeContactsInTenant(tenantId, {
        sourceContactId,
        targetContactId,
        reason: asTrimmedString(args.reason) ?? null,
        preferSourceFields: args.preferSourceFields === true,
        conversationConflictStrategy: strategy,
        operatorId: operator?.id ?? null,
        actorName,
      });
    }

    // ── 28. REPLACE CRM DEAL CONTACT (WRITE — FASE 1 / ITEM 3) ───────────────
    case "replace_crm_deal_contact": {
      const dealId = asTrimmedString(args.dealId);
      const newContactId = asTrimmedString(args.newContactId);
      if (!dealId || !newContactId) {
        throw new Error("Campos obrigatórios: 'dealId' e 'newContactId'.");
      }

      const [existingDeal] = await db
        .select({ id: crmDeals.id, title: crmDeals.title })
        .from(crmDeals)
        .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
        .limit(1);
      if (!existingDeal) {
        throw new Error(`Negociação '${dealId}' não encontrada no tenant '${tenantId}'.`);
      }

      const [targetContact] = await db
        .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
        .from(contacts)
        .where(and(eq(contacts.id, newContactId), eq(contacts.tenantId, tenantId)))
        .limit(1);
      if (!targetContact) {
        throw new Error(`Contato '${newContactId}' não encontrado no tenant '${tenantId}'.`);
      }

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      const actorName = buildActorDisplayName(
        asTrimmedString(args.actorName),
        operator?.name,
        actor,
      );
      const reason = asTrimmedString(args.reason) || "Correção de contato vinculado via MCP";
      const role = asTrimmedString(args.role) || "buyer";
      const oldContactId = asTrimmedString(args.oldContactId);
      const replaceAll = args.replaceAll === true;
      const keepPrevious = args.keepPreviousContacts === true;

      const currentLinks = await db
        .select({
          contactId: crmDealContacts.contactId,
          isPrimary: crmDealContacts.isPrimary,
        })
        .from(crmDealContacts)
        .where(and(eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.dealId, dealId)));

      // 1. Adiciona/promove o novo contato como principal ANTES de desvincular o antigo
      await crmService.addDealContact(
        tenantId,
        dealId,
        targetContact.id,
        role,
        true,
        operator?.id ?? null,
      );

      // 2. Define quais contatos anteriores serão desvinculados
      const toRemoveIds: string[] = [];
      if (oldContactId) {
        if (oldContactId !== targetContact.id && currentLinks.some((l) => l.contactId === oldContactId)) {
          toRemoveIds.push(oldContactId);
        }
      } else if (replaceAll) {
        for (const link of currentLinks) {
          if (link.contactId !== targetContact.id) toRemoveIds.push(link.contactId);
        }
      } else if (!keepPrevious) {
        const prevPrimary = currentLinks.find((l) => l.isPrimary && l.contactId !== targetContact.id);
        if (prevPrimary) toRemoveIds.push(prevPrimary.contactId);
      }

      for (const remId of toRemoveIds) {
        await crmService.removeDealContact(tenantId, dealId, remId, operator?.id ?? null);
      }

      await db.insert(crmActionHistory).values({
        id: crypto.randomUUID(),
        tenantId,
        operatorId: operator?.id ?? null,
        operatorName: actorName,
        action: "replace_deal_contact",
        entityType: "deal",
        itemCount: 1,
        details: {
          dealId,
          dealTitle: existingDeal.title,
          newContactId: targetContact.id,
          newContactName: targetContact.name,
          removedContactIds: toRemoveIds,
          reason,
          source: "mcp",
        },
      });

      const updatedContacts = await crmService.getDealContacts(tenantId, dealId);

      return {
        success: true,
        tenantId,
        dealId,
        title: existingDeal.title,
        newContactId: targetContact.id,
        newContactName: targetContact.name,
        removedContactIds: toRemoveIds,
        reason,
        actorName,
        contacts: updatedContacts,
      };
    }

    // ── 29. ARCHIVE OR DELETE CRM DEAL (WRITE — FASE 1 / ITEM 3) ─────────────
    case "archive_crm_deal": {
      const dealId = asTrimmedString(args.dealId);
      const reason = asTrimmedString(args.reason);
      if (!dealId) throw new Error("Campo obrigatório 'dealId' não informado.");
      if (!reason || reason.length < 3) {
        throw new Error(
          "Campo obrigatório 'reason' não informado (mínimo 3 caracteres) para auditoria do arquivamento/exclusão.",
        );
      }

      const mode = args.mode === "delete_permanent" ? "delete_permanent" : "archive";
      if (mode === "delete_permanent" && args.confirmPermanentDelete !== true) {
        throw new Error(
          "Para exclusão definitiva (mode='delete_permanent'), informe explicitamente confirmPermanentDelete=true. Recomendação: use mode='archive' (Lixeira reversível).",
        );
      }

      const operator = await assertOperatorInTenant(tenantId, asTrimmedString(args.operatorId));
      const actorName = buildActorDisplayName(
        asTrimmedString(args.actorName),
        operator?.name,
        actor,
      );

      if (mode === "archive") {
        const now = new Date();
        const pausedReason = `Lixeira — ${reason}`;

        const archived = await db.transaction(async (tx) => {
          const [deal] = await tx
            .select()
            .from(crmDeals)
            .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
            .for("update")
            .limit(1);
          if (!deal) {
            throw new Error(`Negociação '${dealId}' não encontrada no tenant '${tenantId}'.`);
          }

          const [updated] = await tx
            .update(crmDeals)
            .set({
              status: "paused",
              pausedReason,
              updatedAt: now,
              lastActivityAt: now,
              version: deal.version + 1,
            })
            .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
            .returning();

          await tx.insert(crmDealEvents).values({
            id: `evt-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
            tenantId,
            dealId,
            eventType: "status_changed",
            fromStageId: null,
            toStageId: null,
            fromStatus: deal.status,
            toStatus: "paused",
            metadata: {
              previousStatus: deal.status,
              newStatus: "paused",
              pausedReason,
              reason,
              archivedBy: actorName,
              source: "mcp",
            },
            operatorId: operator?.id ?? null,
            createdAt: now,
          });

          await tx.insert(crmActionHistory).values({
            id: crypto.randomUUID(),
            tenantId,
            operatorId: operator?.id ?? null,
            operatorName: actorName,
            action: "delete_trash",
            entityType: "deal",
            itemCount: 1,
            details: {
              dealIds: [dealId],
              deals: [{ id: deal.id, title: deal.title }],
              reason,
              pausedReason,
              source: "mcp",
            },
            createdAt: now,
          });

          return { previousStatus: deal.status, updated };
        });

        return {
          success: true,
          tenantId,
          dealId: archived.updated.id,
          title: archived.updated.title,
          mode: "archive",
          previousStatus: archived.previousStatus,
          status: archived.updated.status,
          pausedReason: archived.updated.pausedReason,
          version: archived.updated.version,
          reason,
          archivedBy: actorName,
        };
      }

      // mode === "delete_permanent"
      const detachConversations = args.detachConversations === true;
      const now = new Date();
      const deletedInfo = await db.transaction(async (tx) => {
        const [deal] = await tx
          .select()
          .from(crmDeals)
          .where(and(eq(crmDeals.id, dealId), eq(crmDeals.tenantId, tenantId)))
          .for("update")
          .limit(1);
        if (!deal) {
          throw new Error(`Negociação '${dealId}' não encontrada no tenant '${tenantId}'.`);
        }

        // Proteção: não exclui permanentemente card com conversa ativa vinculada,
        // a menos que detachConversations=true seja passado explicitamente (preservando as conversas no chat).
        const activeConvLinks = await tx
          .select({ conversationId: crmConversationDeals.conversationId })
          .from(crmConversationDeals)
          .where(
            and(
              eq(crmConversationDeals.tenantId, tenantId),
              eq(crmConversationDeals.dealId, dealId),
              eq(crmConversationDeals.isActive, true),
            ),
          );

        const detachedConversationIds = Array.from(
          new Set(activeConvLinks.map((row) => row.conversationId)),
        );

        if (detachedConversationIds.length > 0 && !detachConversations) {
          throw new Error(
            `Exclusão definitiva bloqueada: a negociação '${dealId}' possui conversa vinculada ('${detachedConversationIds[0]}'). Use mode='archive' para arquivar sem perder o histórico, ou passe detachConversations=true (ou use unlink_conversation_deal antes) para excluir preservando a conversa no chat.`,
          );
        }

        if (detachedConversationIds.length > 0 && detachConversations) {
          await tx
            .update(crmConversationDeals)
            .set({
              isActive: false,
              unlinkedAt: now,
              unlinkedByOperatorId: operator?.id ?? null,
            })
            .where(
              and(
                eq(crmConversationDeals.tenantId, tenantId),
                eq(crmConversationDeals.dealId, dealId),
                eq(crmConversationDeals.isActive, true),
              ),
            );

          await tx
            .update(conversationDealContexts)
            .set({
              currentDealId: null,
              previousDealId: null,
              version: sql`${conversationDealContexts.version} + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(conversationDealContexts.tenantId, tenantId),
                inArray(conversationDealContexts.conversationId, detachedConversationIds),
                eq(conversationDealContexts.currentDealId, dealId),
              ),
            );
        }

        await tx
          .delete(commercialEvidence)
          .where(and(eq(commercialEvidence.tenantId, tenantId), eq(commercialEvidence.dealId, dealId)));
        await tx
          .delete(crmDeals)
          .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, dealId)));

        await tx.insert(crmActionHistory).values({
          id: crypto.randomUUID(),
          tenantId,
          operatorId: operator?.id ?? null,
          operatorName: actorName,
          action: "delete_permanent",
          entityType: "deal",
          itemCount: 1,
          details: {
            dealIds: [dealId],
            deals: [{ id: deal.id, title: deal.title }],
            reason,
            detachConversations,
            detachedConversationIds,
            conversationsPreserved: detachedConversationIds.length > 0,
            source: "mcp",
          },
          createdAt: now,
        });

        return { id: deal.id, title: deal.title, detachedConversationIds };
      });

      return {
        success: true,
        tenantId,
        dealId: deletedInfo.id,
        title: deletedInfo.title,
        mode: "delete_permanent",
        deleted: true,
        detachConversations,
        detachedConversationIds: deletedInfo.detachedConversationIds,
        conversationsPreserved: deletedInfo.detachedConversationIds.length > 0,
        reason,
        deletedBy: actorName,
      };
    }

    default:
      if (isPhase23McpTool(name)) {
        return executePhase23McpTool(name, args, tenantId, actor);
      }
      if (isKnowledgeMcpTool(name)) {
        return executeKnowledgeMcpTool(name, args, tenantId, actor);
      }
      if (isWave1McpTool(name)) {
        return executeWave1McpTool(name, args, tenantId, actor);
      }
      if (isTriageAuditMcpTool(name)) {
        return executeTriageAuditMcpTool(name, args, tenantId, actor);
      }
      if (isOperatorMessagesMcpTool(name)) {
        return executeOperatorMessagesMcpTool(name, args, tenantId, actor);
      }
      if (isTemplateGroupsMcpTool(name)) {
        return executeTemplateGroupsMcpTool(name, args, tenantId, actor);
      }
      if (isSdrOrchestratorMcpTool(name)) {
        return executeSdrOrchestratorMcpTool(name, args, tenantId, actor);
      }
      if (isRdMarketingMcpTool(name)) {
        return executeRdMarketingMcpTool(name, args, tenantId);
      }
      throw new Error(`Ferramenta estendida desconhecida: '${name}'.`);
  }
}
