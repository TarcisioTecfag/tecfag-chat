import crypto from "node:crypto";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  contacts,
  contactPhones,
  conversations,
  crmDealActivities,
  crmDeals,
  crmPipelines,
  crmStages,
  messages,
  metaMessageTemplates,
  operators,
  quickResponses,
  sectors,
  tasks,
} from "../../db/schema";
import { crmService } from "../crm/crm-service";
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
  ensureMetaTemplateGroupsSchema,
  setMetaTemplateBindings,
  syncMetaTemplates,
} from "../whatsapp/meta-templates";
import { resolveMetaTemplateValues } from "../whatsapp/meta-template-common";
import { SITE_CHANNEL } from "../livechat/site-channel-policy";
import { sendSiteOperatorText } from "../livechat/site-delivery";
import { SessionManager } from "../baileys/session-manager";
import { SdrDebouncer } from "../valentina/sdr-debouncer";

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
      },
    },
  },
  {
    name: "create_account",
    access: "write",
    description:
      "[ESCRITA] Cria uma nova empresa ou cliente PF (crm_accounts) via crmService com validação real de CPF/CNPJ e deduplicação de documento.",
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
      },
    },
  },
  {
    name: "update_account",
    access: "write",
    description:
      "[ESCRITA] Atualiza parcialmente uma empresa/conta (crm_accounts) via crmService.",
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
          description: "Lista ordenada dos valores para as variáveis {{1}}, {{2}}, ... do corpo do template (opcional quando os bindings automáticos resolvem).",
        },
        operatorId: { type: "string", description: "ID do operador remetente (opcional)." },
        senderName: { type: "string", description: "Nome exibido como remetente interno (opcional)." },
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
];

export const MCP_EXTENDED_TOOL_LABELS_PT: Record<string, string> = {
  list_meta_templates: "Listagem de Templates Meta",
  create_crm_deal: "Criar Negociação (CRM)",
  update_crm_deal_stage: "Mover Etapa da Negociação (CRM)",
  update_crm_deal_owner: "Alterar Responsável da Negociação (CRM)",
  mark_deal_won: "Marcar Negociação como Ganha (CRM)",
  mark_deal_lost: "Marcar Negociação como Perdida (CRM)",
  create_contact: "Criar Contato",
  update_contact: "Atualizar Contato",
  create_account: "Criar Empresa / Conta (CRM)",
  update_account: "Atualizar Empresa / Conta (CRM)",
  create_task: "Criar Tarefa / Atividade",
  update_task: "Atualizar Tarefa / Atividade",
  chat_send_message: "Enviar Mensagem no Chat (WhatsApp/Site)",
  chat_add_internal_note: "Adicionar Nota Interna no Chat",
  chat_transfer_conversation: "Transferir Conversa",
  chat_close_conversation: "Finalizar Conversa",
  create_conversation: "Abrir / Criar Conversa",
  update_meta_template_visibility: "Atualizar Visibilidade de Template Meta",
  create_meta_template: "Criar & Submeter Template Meta",
  send_meta_template: "Enviar Template Oficial Meta",
  create_quick_response: "Criar Resposta Rápida",
  delete_quick_response: "Excluir Resposta Rápida",
  update_sector: "Atualizar Setor",
};

const EXTENDED_TOOL_NAMES = new Set(MCP_EXTENDED_TOOLS.map((t) => t.name));

export function isExtendedMcpTool(name: string): boolean {
  return EXTENDED_TOOL_NAMES.has(name);
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

      const rows = await db
        .select()
        .from(metaMessageTemplates)
        .where(eq(metaMessageTemplates.tenantId, tenantId))
        .orderBy(asc(metaMessageTemplates.name));

      const filtered = rows.filter((row) => {
        if (row.status === "DELETED") return false;
        if (statusFilter && row.status.toUpperCase() !== statusFilter) return false;
        if (searchFilter) {
          const hay = `${row.name} ${row.bodyText}`.toLowerCase();
          if (!hay.includes(searchFilter)) return false;
        }
        return true;
      });

      return {
        tenantId,
        total: filtered.length,
        templates: filtered.map((t) => ({
          id: t.id,
          metaTemplateId: t.metaTemplateId,
          name: t.name,
          language: t.language,
          category: t.category,
          status: t.status,
          bodyText: t.bodyText,
          bindings: t.bindings,
          customGroups: t.customGroups,
          allPipelines: t.allPipelines,
          pipelineIds: t.pipelineIds,
          stageIds: t.stageIds,
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

      if (Object.keys(updates).length === 1) {
        throw new Error(
          "Informe ao menos um campo para atualizar ('name', 'phone', 'email', 'cpf', 'cnpj' ou 'accountId').",
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
      };
    }

    // ── 9. CREATE ACCOUNT ────────────────────────────────────────────────────
    case "create_account": {
      const accountName = asTrimmedString(args.name);
      if (!accountName) throw new Error("Campo obrigatório 'name' não informado.");

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
      });

      return {
        success: true,
        tenantId,
        accountId: account.id,
        name: account.name,
        type: account.type,
        document: account.document,
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
      const [existingConv] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.tenantId, tenantId), eq(conversations.contactId, contactId)))
        .limit(1);

      const now = new Date();
      if (existingConv) {
        if (!reopenIfExists) {
          throw new Error(
            `Já existe uma conversa ('${existingConv.id}') para o contato '${contactId}'.`,
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

      await setMetaTemplateBindings(
        tenantId,
        tpl.metaTemplateId,
        undefined,
        undefined,
        {
          allPipelines: args.allPipelines,
          pipelineIds,
          stageIds,
        },
      );

      const [refreshedTpl] = await db
        .select({
          allPipelines: metaMessageTemplates.allPipelines,
          pipelineIds: metaMessageTemplates.pipelineIds,
          stageIds: metaMessageTemplates.stageIds,
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

      if (conv.queueState === "finalizados") {
        throw new Error(
          "A conversa está finalizada ('finalizados'). Reabra a conversa antes de disparar o template.",
        );
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

      const rawParams = Array.isArray(args.parameters)
        ? args.parameters.map((p) => ({ type: "text", text: String(p) }))
        : undefined;
      const values = resolveMetaTemplateValues(
        selected.variableCount,
        selected.bindings,
        rawParams,
        { customerName: contact.name, operatorName: senderName },
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
        templateName: selected.name,
        templateLanguage: selected.language,
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

    default:
      throw new Error(`Ferramenta estendida desconhecida: '${name}'.`);
  }
}
