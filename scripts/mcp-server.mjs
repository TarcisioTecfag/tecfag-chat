#!/usr/bin/env node
/**
 * SERVIDOR MCP OFICIAL — VALEM CHAT & TECFAG I.A FAGNER
 *
 * Conecta o Antigravity (e qualquer cliente MCP via stdio) diretamente ao ecossistema
 * Valem Chat / Tecfag Chat em modo Somente-Leitura (Read-Only), respeitando:
 *   1. Isolamento Multi-Tenant estrito ('tecfag' vs 'valem', padrão 'tecfag')
 *   2. Pool PostgreSQL enxuto (max: 2, idle_timeout: 20s) para não disputar conexões
 *   3. Regras de negócio oficiais (isCommercialWinStage, aliases de consultores RD,
 *      categorização dos 26 motivos de perda, projeção de monitoramento e journal do Fagner)
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  calculateBusinessPacing,
  isCommercialWinStage,
  roundPercent,
  saoPauloDay,
} from "../src/lib/commercial/metrics.ts";
import {
  buildConsultantOperatorAliasMap,
  matchConsultantNames,
} from "../src/lib/commercial/avatar-matcher.ts";
import { categorizeLossReason } from "../src/lib/commercial/perdas-data.ts";
import { projectIndustrialMonitoring } from "../src/lib/triage/industrial-monitor.ts";
import {
  buildJournalSnapshot,
  readJournalSnapshot,
} from "../src/lib/triage/industrial-triage-journal.ts";

// Garante que qualquer console.log acidental de dependências vá para stderr
// para jamais corromper o canal JSON-RPC no stdout.
const rawStdoutWrite = process.stdout.write.bind(process.stdout);
console.log = (...args) => process.stderr.write(`[mcp-log] ${args.join(" ")}\n`);
console.info = (...args) => process.stderr.write(`[mcp-info] ${args.join(" ")}\n`);
console.warn = (...args) => process.stderr.write(`[mcp-warn] ${args.join(" ")}\n`);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

function loadDotEnvIfNeeded() {
  if (process.env.DATABASE_URL) return;
  const envPath = path.join(PROJECT_ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadDotEnvIfNeeded();

const connectionString =
  process.env.MCP_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgres://postgres:123@localhost:5432/valemchat";

const isLocalDatabase = ["localhost", "127.0.0.1", "::1"].includes(
  new URL(connectionString).hostname,
);
const isCloud =
  connectionString.includes("railway") ||
  connectionString.includes("neon") ||
  connectionString.includes("supabase") ||
  connectionString.includes("render");

const sql = postgres(connectionString, {
  max: 2,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
  ssl: isCloud && !isLocalDatabase ? { rejectUnauthorized: false } : false,
});

function normalizeTenantId(raw) {
  const val = String(raw || "tecfag").trim().toLowerCase();
  if (val !== "tecfag" && val !== "valem") {
    throw new Error(`tenantId inválido ('${raw}'). Use 'tecfag' ou 'valem'.`);
  }
  return val;
}

function clampLimit(raw, defaultLimit = 25, maxLimit = 100) {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return defaultLimit;
  return Math.min(Math.floor(num), maxLimit);
}

function formatCnpjOrCpf(raw) {
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

function extractReceitaDetails(addressObj, fallbackDoc) {
  const addr = addressObj && typeof addressObj === "object" ? addressObj : {};
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

// ═══════════════════════════════════════════════════════════════════════════
// DEFINIÇÃO DAS 10 FERRAMENTAS (MCP TOOLS)
// ═══════════════════════════════════════════════════════════════════════════

const TOOLS = [
  {
    name: "search_conversations",
    description:
      "Busca e lista conversas/atendimentos do sistema (WhatsApp Meta, Baileys ou Site). Permite filtrar por tenant ('tecfag' ou 'valem'), termo de busca (nome do cliente, telefone, CNPJ ou texto da última mensagem), estado da fila ('automacao', 'fila', 'meus', 'finalizados') ou nome do operador.",
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
          description: "Busca opcional por nome do contato, telefone, empresa, CNPJ ou trecho da última mensagem.",
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
          description: "ID da conversa (ex: obtido via search_conversations ou get_fagner_triage_overview).",
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
          description: "Termo de busca por nome ou telefone quando conversationId não for informado.",
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
      "Busca e filtra negociações (cards) no CRM local (crm_deals). Permite filtrar por texto (título do card, empresa, CNPJ ou contato), funil (pipelineName), etapa (stageName), vendedor (operatorName), status ('open', 'won', 'lost', 'paused') ou apenas vendas fechadas/ganhas.",
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
          description: "Busca textual por título da negociação, nome da empresa, CNPJ ou motivo de perda.",
        },
        pipelineName: {
          type: "string",
          description: "Filtra pelo nome do funil (ex: 'FUNIL MÁQUINAS', 'FUNIL PERSONNALITÉ', 'FUNIL PEÇAS', 'SDR').",
        },
        stageName: {
          type: "string",
          description: "Filtra pelo nome da etapa (ex: 'FECHAMENTO', 'PROPOSTA', 'QUALIFICAÇÃO').",
        },
        operatorName: {
          type: "string",
          description: "Filtra pelo nome do vendedor/consultor responsável (ex: 'Jhordan', 'Melissa', 'Guilherme').",
        },
        status: {
          type: "string",
          enum: ["open", "won", "lost", "paused", "closed_won_effective"],
          description:
            "Status do card ('open', 'won', 'lost', 'paused') ou 'closed_won_effective' para buscar vendas fechadas (status 'won' OU etapa 'FECHAMENTO').",
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
      "Retorna a ficha completa 360º de uma negociação do CRM (dealId): dados do card, campos personalizados, empresa vinculada com dados da Receita Federal, contatos participantes, produtos/itens orçados, propostas comerciais, atividades/tarefas, histórico de eventos e conversas de WhatsApp vinculadas.",
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
          description: "ID específico da empresa (crm_accounts.id) para ver todos os contatos e negociações dela.",
        },
        query: {
          type: "string",
          description: "Busca por Razão Social, Nome Fantasia, CNPJ/CPF, telefone, e-mail ou segmento.",
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
          description: "Mês de competência no formato YYYY-MM (ex: '2026-10'). Se omitido, usa o mês atual BRT.",
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
];

// ═══════════════════════════════════════════════════════════════════════════
// IMPLEMENTAÇÃO DOS HANDLERS DE CADA FERRAMENTA
// ═══════════════════════════════════════════════════════════════════════════

async function handleSearchConversations(args) {
  const tenantId = normalizeTenantId(args.tenantId);
  const limit = clampLimit(args.limit, 20, 100);
  const query = (args.query || "").trim();
  const queueState = args.queueState ? String(args.queueState).trim() : null;
  const operatorName = args.operatorName ? String(args.operatorName).trim() : null;

  const conditions = [sql`conv.tenant_id = ${tenantId}`];
  if (queueState) {
    conditions.push(sql`conv.queue_state = ${queueState}`);
  }
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
    conversations: rows.map((r) => ({
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

async function handleGetConversationMessages(args) {
  const tenantId = normalizeTenantId(args.tenantId);
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
    messages: msgs.reverse().map((m) => ({
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

async function handleGetFagnerTriageOverview(args) {
  const tenantId = normalizeTenantId(args.tenantId);
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

  const stateCounts = {};
  const projectedList = [];

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

async function handleGetFagnerTriageHistory(args) {
  const tenantId = normalizeTenantId(args.tenantId);
  const conversationId = args.conversationId ? String(args.conversationId).trim() : "";
  const query = (args.query || "").trim();
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

  const cycles = flowRows.map((f, idx) => {
    let snapshot = null;
    try {
      snapshot = buildJournalSnapshot(f);
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

  const events = journalNotes.map((n) => {
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

async function handleSearchCrmDeals(args) {
  const tenantId = normalizeTenantId(args.tenantId);
  const limit = clampLimit(args.limit, 25, 100);
  const query = (args.query || "").trim();
  const pipelineName = args.pipelineName ? String(args.pipelineName).trim() : null;
  const stageName = args.stageName ? String(args.stageName).trim() : null;
  const operatorName = args.operatorName ? String(args.operatorName).trim() : null;
  const status = args.status ? String(args.status).trim() : null;

  const conditions = [sql`d.tenant_id = ${tenantId}`];

  if (pipelineName) {
    const pPattern = `%${pipelineName}%`;
    conditions.push(sql`p.name ILIKE ${pPattern}`);
  }
  if (stageName) {
    const sPattern = `%${stageName}%`;
    conditions.push(sql`st.name ILIKE ${sPattern}`);
  }
  if (operatorName) {
    const opPattern = `%${operatorName}%`;
    conditions.push(sql`op.name ILIKE ${opPattern}`);
  }
  if (status === "closed_won_effective") {
    conditions.push(sql`(
      d.status = 'won'
      OR (d.status = 'open' AND (st.is_win_stage = true OR LOWER(st.name) LIKE 'fechamento%'))
    )`);
  } else if (status) {
    conditions.push(sql`d.status = ${status}`);
  }
  if (query) {
    const qPattern = `%${query}%`;
    conditions.push(sql`(
      d.title ILIKE ${qPattern}
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
      d.title,
      d.value,
      d.currency,
      d.status,
      d.loss_reason,
      d.paused_reason,
      d.source,
      d.campaign,
      d.rating,
      d.ai_priority_score,
      d.ai_priority_level,
      d.expected_close_date,
      d.closed_at,
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
    ORDER BY COALESCE(d.closed_at, d.updated_at, d.created_at) DESC
    LIMIT ${limit}
  `;

  return {
    tenantId,
    returnedCount: rows.length,
    deals: rows.map((r) => {
      const effectiveWon =
        r.status === "won" ||
        (r.status === "open" &&
          isCommercialWinStage({ id: r.stage_id, name: r.stage_name, isWinStage: r.is_win_stage }));
      return {
        id: r.id,
        title: r.title,
        value: Number(r.value || 0),
        currency: r.currency,
        status: r.status,
        isEffectiveWon: effectiveWon,
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
        source: r.source || null,
        campaign: r.campaign || null,
        rating: r.rating,
        aiPriority: r.ai_priority_level
          ? { score: r.ai_priority_score, level: r.ai_priority_level }
          : null,
        closedAt: r.closed_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    }),
  };
}

async function handleGetCrmDealDetails(args) {
  const tenantId = normalizeTenantId(args.tenantId);
  const dealId = String(args.dealId || "").trim();
  if (!dealId) throw new Error("Informe dealId.");

  const [deal] = await sql`
    SELECT
      d.*,
      p.name AS pipeline_name,
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
    fieldDefinitions,
  ] = await Promise.all([
    sql`
      SELECT dc.role, dc.is_primary, c.id, c.name, c.phone, c.email, c.main_channel
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
      SELECT id, type, title, description, status, due_date, completed_at, created_at
      FROM crm_deal_activities
      WHERE tenant_id = ${tenantId} AND deal_id = ${dealId}
      ORDER BY created_at DESC
      LIMIT 30
    `,
    sql`
      SELECT cd.conversation_id, cd.origin, cd.is_active, conv.queue_state, conv.last_message_text, conv.last_message_time
      FROM crm_conversation_deals cd
      JOIN conversations conv ON conv.id = cd.conversation_id AND conv.tenant_id = cd.tenant_id
      WHERE cd.tenant_id = ${tenantId} AND cd.deal_id = ${dealId}
      ORDER BY cd.created_at DESC
    `,
    sql`
      SELECT id, name, field_type
      FROM crm_custom_field_definitions
      WHERE tenant_id = ${tenantId} AND entity_type = 'deal'
    `,
  ]);

  const fieldMap = new Map(fieldDefinitions.map((f) => [f.id, f.name]));
  const rawCustom = deal.custom_fields && typeof deal.custom_fields === "object" ? deal.custom_fields : {};
  const labeledCustomFields = {};
  for (const [k, v] of Object.entries(rawCustom)) {
    const label = fieldMap.get(k) || k;
    labeledCustomFields[label] = v;
  }

  return {
    tenantId,
    deal: {
      id: deal.id,
      title: deal.title,
      value: Number(deal.value || 0),
      currency: deal.currency,
      status: deal.status,
      isEffectiveWon:
        deal.status === "won" ||
        (deal.status === "open" &&
          isCommercialWinStage({
            id: deal.stage_id,
            name: deal.stage_name,
            isWinStage: deal.is_win_stage,
          })),
      pipeline: { id: deal.pipeline_id, name: deal.pipeline_name },
      stage: { id: deal.stage_id, name: deal.stage_name },
      operator: deal.operator_id
        ? { id: deal.operator_id, name: deal.operator_name, email: deal.operator_email }
        : null,
      source: deal.source,
      campaign: deal.campaign,
      lossReason: deal.loss_reason,
      pausedReason: deal.paused_reason,
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
    products: dealProducts.map((p) => ({
      ...p,
      quantity: Number(p.quantity || 0),
      unit_price: Number(p.unit_price || 0),
      total_price: Number(p.total_price || 0),
    })),
    proposals,
    recentActivities: activities,
    linkedConversations,
  };
}

async function handleSearchCrmAccounts(args) {
  const tenantId = normalizeTenantId(args.tenantId);
  const accountId = args.accountId ? String(args.accountId).trim() : null;
  const query = (args.query || "").trim();
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
      linkedDeals: linkedDeals.map((d) => ({
        ...d,
        value: Number(d.value || 0),
      })),
    };
  }

  const conditions = [sql`acc.tenant_id = ${tenantId}`, sql`acc.archived_at IS NULL`];
  if (type) {
    conditions.push(sql`acc.type = ${type}`);
  }
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
    accounts: rows.map((acc) => ({
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

async function handleSearchContacts(args) {
  const tenantId = normalizeTenantId(args.tenantId);
  const query = (args.query || "").trim();
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
    contacts: rows.map((r) => ({
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

async function handleGetSalesAndCommercialMetrics(args) {
  const tenantId = normalizeTenantId(args.tenantId);
  const now = new Date();
  const today = saoPauloDay(now);
  const month = args.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(args.month) ? args.month : today.slice(0, 7);
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
    sql`
      SELECT id, name FROM operators WHERE tenant_id = ${tenantId}
    `,
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

  // Se commercial_consultant_profiles estiver vazio no banco local, constrói a lista base
  // a partir dos operadores do tenant (unificando homônimos do RD Station).
  let effectiveConsultantRows = consultantRows;
  if (effectiveConsultantRows.length === 0 && allOperators.length > 0) {
    const seenBaseNames = new Map();
    const deduped = [];
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
          name: op.name.replace(/\s*-\s*\d+.*$/, "").trim() || op.name,
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
    effectiveConsultantRows.map((c) => ({ operatorId: c.operator_id, name: c.name })),
    allOperators,
  );

  const filteredConsultants = effectiveConsultantRows.filter(
    (c) => !division || !consultantRows.length || c.division === division,
  );
  const activeConsultantIds = new Set(filteredConsultants.map((c) => c.operator_id));

  const stageById = new Map(
    stageRows.map((s) => [
      s.id,
      {
        id: s.id,
        name: s.name,
        isWinStage: isCommercialWinStage({ id: s.id, name: s.name, isWinStage: s.is_win_stage }),
        pipelineId: s.pipeline_id,
        pipelineName: s.pipeline_name,
      },
    ]),
  );

  const goalsByOperator = new Map();
  for (const g of goalRows) {
    const canonical = aliasMap.resolve(g.operator_id) || g.operator_id;
    goalsByOperator.set(canonical, Number(g.target_value || 0));
  }
  for (const c of filteredConsultants) {
    if (!goalsByOperator.has(c.operator_id)) {
      const matched = goalRows.find((g) => {
        const op = allOperators.find((o) => o.id === g.operator_id);
        return op && matchConsultantNames(op.name, c.name);
      });
      if (matched) {
        goalsByOperator.set(c.operator_id, Number(matched.target_value || 0));
      }
    }
  }

  const byConsultant = new Map(
    filteredConsultants.map((c) => [
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
  const lossCategoriesCounter = {};
  const pipelineSummaryMap = new Map();

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

  const totalGoal = Array.from(byConsultant.values()).reduce((s, c) => s + c.targetValue, 0);
  const referenceDay = month === today.slice(0, 7) ? today : `${month}-28`;
  const pacing = calculateBusinessPacing(
    month,
    referenceDay,
    totalGoal,
    totalWonMonthValue,
    calendarRows.map((c) => ({
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
      attainmentPercent: roundPercent(c.targetValue > 0 ? (c.wonValue / c.targetValue) * 100 : 0, 1),
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
      attainmentPercent: roundPercent(totalGoal > 0 ? (totalWonMonthValue / totalGoal) * 100 : 0, 1),
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

async function handleGetRodizioAndOperatorsStatus(args) {
  const tenantId = normalizeTenantId(args.tenantId);

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
      SELECT config, enabled, updated_at
      FROM agent_configs
      WHERE tenant_id = ${tenantId} AND agent_type = 'sdr'
      LIMIT 1
    `,
    sql`
      SELECT operator_id, COUNT(*)::int AS active_chats
      FROM conversations
      WHERE tenant_id = ${tenantId} AND queue_state = 'meus' AND operator_id IS NOT NULL
      GROUP BY operator_id
    `,
  ]);

  const activeMap = new Map(activeChatsByOp.map((r) => [r.operator_id, r.active_chats]));
  const sdrConfig = sdrConfigRows[0]?.config || {};
  const flowOperators = Array.isArray(sdrConfig.flowOperators) ? sdrConfig.flowOperators : [];

  return {
    tenantId,
    sdrEnabled: Boolean(sdrConfigRows[0]?.enabled),
    totalOperators: operatorsRows.length,
    flowScaleOperatorsCount: flowOperators.length,
    flowScaleByArea: flowOperators.map((fo) => ({
      operatorId: fo.operatorId,
      name: fo.name,
      area: fo.area,
      funnels: fo.funnels || [],
      isInFlow: fo.isInFlow !== false,
      onLeave: Boolean(fo.onLeave),
      compensationBalance: Number(fo.compensation || 0),
      activeChatsNow: activeMap.get(fo.operatorId) || 0,
    })),
    sectors: sectorsRows.map((s) => ({
      id: s.id,
      name: s.name,
      operatorCount: Array.isArray(s.operator_ids) ? s.operator_ids.length : 0,
    })),
    operators: operatorsRows.map((op) => ({
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

async function executeTool(name, args = {}) {
  switch (name) {
    case "search_conversations":
      return handleSearchConversations(args);
    case "get_conversation_messages":
      return handleGetConversationMessages(args);
    case "get_fagner_triage_overview":
      return handleGetFagnerTriageOverview(args);
    case "get_fagner_triage_history":
      return handleGetFagnerTriageHistory(args);
    case "search_crm_deals":
      return handleSearchCrmDeals(args);
    case "get_crm_deal_details":
      return handleGetCrmDealDetails(args);
    case "search_crm_accounts":
      return handleSearchCrmAccounts(args);
    case "search_contacts":
      return handleSearchContacts(args);
    case "get_sales_and_commercial_metrics":
      return handleGetSalesAndCommercialMetrics(args);
    case "get_rodizio_and_operators_status":
      return handleGetRodizioAndOperatorsStatus(args);
    default:
      throw new Error(`Ferramenta desconhecida: ${name}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSPORTE MCP JSON-RPC 2.0 SOBRE STDIO (Newline-Delimited & Content-Length)
// ═══════════════════════════════════════════════════════════════════════════

let useContentLengthFraming = false;
let bridgeSessionId = crypto.randomUUID();
let detectedClientLabel =
  process.env.MCP_CLIENT_LABEL ||
  (process.env.ANTIGRAVITY_CLI_ALIAS ? "Antigravity IDE" : "Cliente MCP Local (Stdio)");

const DEFAULT_REMOTE_MCP_URL =
  "https://tecfagchat.up.railway.app/api/mcp?token=mcp_tf_8f4e2a9c1d7b6e3f5a0c2d4e8b1f7a3c";
const REMOTE_MCP_URL =
  process.env.MCP_LOCAL_ONLY === "1"
    ? ""
    : (process.env.MCP_REMOTE_URL || DEFAULT_REMOTE_MCP_URL).trim();

const LOCAL_TOOL_LABELS = {
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
};

function summarizeLocalArgs(args) {
  const entries = Object.entries(args || {}).filter(
    ([k, v]) => k !== "tenantId" && v !== undefined && v !== null && String(v).trim() !== "",
  );
  if (!entries.length) return "Consulta geral (padrão)";
  return entries
    .map(([k, v]) => {
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      return `${k}: ${s.length > 42 ? `${s.slice(0, 39)}...` : s}`;
    })
    .join(" · ");
}

async function recordLocalMcpAuditLog({
  tenantId = "tecfag",
  toolName,
  toolArgs = {},
  resultSummary,
  status = "success",
  latencyMs = 1,
  eventType = "query",
  responseBytes,
  responsePreview,
}) {
  try {
    const safeTenant = tenantId === "valem" ? "valem" : "tecfag";
    const defaultRowId = `mcp-config-${safeTenant}`;
    const existing = await sql`
      SELECT id, enabled, config
      FROM agent_configs
      WHERE tenant_id = ${safeTenant} AND agent_type = 'mcp'
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const row = existing[0];
    const cfg =
      row?.config && typeof row.config === "object" && !Array.isArray(row.config)
        ? row.config
        : {};
    const currentLogs = Array.isArray(cfg.auditLogs) ? cfg.auditLogs : [];
    const newEntry = {
      id: `mcp-log-${crypto.randomBytes(6).toString("hex")}`,
      timestamp: new Date().toISOString(),
      keyId: "primary",
      keyLabel:
        safeTenant === "valem" ? "Link Principal (Valem)" : "Link Principal (Tecfag)",
      toolName,
      toolLabel: LOCAL_TOOL_LABELS[toolName] || toolName,
      argumentsSummary: summarizeLocalArgs(toolArgs),
      argumentsRaw: toolArgs || {},
      resultSummary,
      status,
      latencyMs,
      eventType,
      transport: `Stdio Bridge (${detectedClientLabel})`,
      clientName: detectedClientLabel,
      clientIp: "local-stdio",
      responseBytes,
      responsePreview,
    };

    const nextConfig = {
      primaryToken:
        cfg.primaryToken ||
        (safeTenant === "valem"
          ? "mcp_vl_3c7a1f8b4e2d0c5a3f6e7b1d9c2a4e8f"
          : "mcp_tf_8f4e2a9c1d7b6e3f5a0c2d4e8b1f7a3c"),
      primaryTokenUpdatedAt: cfg.primaryTokenUpdatedAt || null,
      namedKeys: Array.isArray(cfg.namedKeys) ? cfg.namedKeys : [],
      auditLogs: [newEntry, ...currentLogs].slice(0, 500),
    };

    const targetId = row?.id || defaultRowId;
    const enabledInt = row ? Number(row.enabled ?? 1) : 1;
    const serializedConfig = JSON.stringify(nextConfig);

    await sql`
      INSERT INTO agent_configs (id, tenant_id, agent_type, enabled, config, created_at, updated_at)
      VALUES (
        ${targetId},
        ${safeTenant},
        'mcp',
        ${enabledInt},
        ${serializedConfig}::jsonb,
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE
      SET config = EXCLUDED.config,
          updated_at = NOW()
    `;
  } catch (err) {
    process.stderr.write(`[mcp-local-audit-warn] ${err?.message || err}\n`);
  }
}

async function forwardToRemoteMcp(msg) {
  if (!REMOTE_MCP_URL) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18_000);
    const res = await fetch(REMOTE_MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Mcp-Session-Id": bridgeSessionId,
        "x-mcp-client-name": detectedClientLabel,
        "x-mcp-bridge": detectedClientLabel,
      },
      body: JSON.stringify(msg),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch (err) {
    process.stderr.write(`[mcp-remote-fallback] ${err?.message || err}\n`);
    return null;
  }
}

function sendJsonRpc(message) {
  const json = JSON.stringify(message);
  if (useContentLengthFraming) {
    const byteLength = Buffer.byteLength(json, "utf8");
    rawStdoutWrite(`Content-Length: ${byteLength}\r\n\r\n${json}`);
  } else {
    rawStdoutWrite(`${json}\n`);
  }
}

async function handleJsonRpcMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  const { id, method, params } = msg;

  // Notifications (sem id)
  if (id === undefined || id === null) {
    return;
  }

  try {
    if (method === "initialize") {
      const startedAt = Date.now();
      const clientVersion = params?.protocolVersion || "2024-11-05";
      if (params?.clientInfo?.name) {
        detectedClientLabel = `${params.clientInfo.name}${params.clientInfo.version ? ` v${params.clientInfo.version}` : ""}`;
      }

      // Notifica e registra handshake no Link Único em produção + banco local
      await Promise.allSettled([
        forwardToRemoteMcp(msg),
        recordLocalMcpAuditLog({
          tenantId: "tecfag",
          toolName: "mcp_initialize",
          toolArgs: { protocolVersion: clientVersion, client: detectedClientLabel },
          resultSummary: `Conectado via Stdio Bridge (${detectedClientLabel})`,
          status: "success",
          latencyMs: Date.now() - startedAt,
          eventType: "connection",
          responsePreview: JSON.stringify(
            {
              handshake: "initialize",
              client: detectedClientLabel,
              protocolVersion: clientVersion,
            },
            null,
            2,
          ),
        }),
      ]);

      sendJsonRpc({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: clientVersion,
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: {
            name: "valem-tecfag-mcp",
            version: "1.0.0",
          },
        },
      });
      return;
    }

    if (method === "ping") {
      sendJsonRpc({ jsonrpc: "2.0", id, result: {} });
      return;
    }

    if (method === "tools/list") {
      const startedAt = Date.now();
      await Promise.allSettled([
        forwardToRemoteMcp(msg),
        recordLocalMcpAuditLog({
          tenantId: "tecfag",
          toolName: "mcp_tools_list",
          toolArgs: {},
          resultSummary: `${TOOLS.length} ferramentas sincronizadas (${detectedClientLabel})`,
          status: "success",
          latencyMs: Date.now() - startedAt,
          eventType: "connection",
          responsePreview: JSON.stringify(
            { totalTools: TOOLS.length, tools: TOOLS.map((t) => t.name) },
            null,
            2,
          ),
        }),
      ]);

      sendJsonRpc({
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS,
        },
      });
      return;
    }

    if (method === "resources/list") {
      sendJsonRpc({
        jsonrpc: "2.0",
        id,
        result: {
          resources: [],
        },
      });
      return;
    }

    if (method === "prompts/list") {
      sendJsonRpc({
        jsonrpc: "2.0",
        id,
        result: {
          prompts: [],
        },
      });
      return;
    }

    if (method === "tools/call") {
      const startedAt = Date.now();
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const effectiveTenant = toolArgs?.tenantId === "valem" ? "valem" : "tecfag";

      // Prioriza o Link Único em produção para garantir dados 100% em tempo real + log centralizado
      const remoteRpc = await forwardToRemoteMcp(msg);
      if (remoteRpc && remoteRpc.result && !remoteRpc.error) {
        const remoteText = remoteRpc.result?.content?.[0]?.text || "";
        const responseBytes = Buffer.byteLength(remoteText, "utf8");
        const responsePreview =
          remoteText.length > 1800
            ? `${remoteText.slice(0, 1800)}\n... [truncado · total ${responseBytes} bytes]`
            : remoteText;

        await recordLocalMcpAuditLog({
          tenantId: effectiveTenant,
          toolName,
          toolArgs,
          resultSummary: `Dados consultados via Link Único (${responseBytes.toLocaleString("pt-BR")} bytes)`,
          status: remoteRpc.result?.isError ? "error" : "success",
          latencyMs: Date.now() - startedAt,
          eventType: "query",
          responseBytes,
          responsePreview,
        });

        sendJsonRpc({
          jsonrpc: "2.0",
          id,
          result: remoteRpc.result,
        });
        return;
      }

      try {
        const data = await executeTool(toolName, toolArgs);
        const jsonText = JSON.stringify(data, null, 2);
        const responseBytes = Buffer.byteLength(jsonText, "utf8");
        const responsePreview =
          jsonText.length > 1800
            ? `${jsonText.slice(0, 1800)}\n... [truncado · total ${responseBytes} bytes]`
            : jsonText;

        await recordLocalMcpAuditLog({
          tenantId: effectiveTenant,
          toolName,
          toolArgs,
          resultSummary: `Dados retornados localmente (${responseBytes.toLocaleString("pt-BR")} bytes)`,
          status: "success",
          latencyMs: Date.now() - startedAt,
          eventType: "query",
          responseBytes,
          responsePreview,
        });

        sendJsonRpc({
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
        });
      } catch (toolError) {
        const errMsg = toolError instanceof Error ? toolError.message : String(toolError);
        await recordLocalMcpAuditLog({
          tenantId: effectiveTenant,
          toolName,
          toolArgs,
          resultSummary: `Erro: ${errMsg}`,
          status: "error",
          latencyMs: Date.now() - startedAt,
          eventType: "query",
          responsePreview: JSON.stringify({ error: errMsg }, null, 2),
        });

        sendJsonRpc({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: errMsg,
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          },
        });
      }
      return;
    }

    sendJsonRpc({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    });
  } catch (err) {
    sendJsonRpc({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: err instanceof Error ? err.message : "Internal MCP error",
      },
    });
  }
}

// Modo CLI de autoteste (--self-test) para validação rápida no terminal
if (process.argv.includes("--self-test")) {
  (async () => {
    try {
      const sales = await handleGetSalesAndCommercialMetrics({ tenantId: "tecfag" });
      const deals = await handleSearchCrmDeals({ tenantId: "tecfag", limit: 3 });
      const accounts = await handleSearchCrmAccounts({ tenantId: "tecfag", limit: 3 });
      const triage = await handleGetFagnerTriageOverview({ tenantId: "tecfag", limit: 3 });
      const rodizio = await handleGetRodizioAndOperatorsStatus({ tenantId: "tecfag" });
      rawStdoutWrite(
        JSON.stringify(
          {
            ok: true,
            toolsRegistered: TOOLS.length,
            sampleSalesSummary: sales.summary,
            top3Consultants: sales.consultantsRanking.slice(0, 3),
            sampleDealsCount: deals.returnedCount,
            sampleAccountsCount: accounts.returnedCount,
            triageOverview: {
              totalTracked: triage.totalTrackedConversations,
              countsByState: triage.countsByState,
            },
            rodizioSummary: {
              totalOperators: rodizio.totalOperators,
              flowScaleOperatorsCount: rodizio.flowScaleOperatorsCount,
            },
          },
          null,
          2,
        ) + "\n",
      );
      await sql.end({ timeout: 2 });
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Self-test error: ${err?.stack || err}\n`);
      await sql.end({ timeout: 2 });
      process.exit(1);
    }
  })();
} else {
  let buffer = Buffer.alloc(0);

  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);

    while (buffer.length > 0) {
      const preview = buffer.subarray(0, Math.min(buffer.length, 64)).toString("utf8");
      if (/^Content-Length:/i.test(preview)) {
        useContentLengthFraming = true;
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) break;
        const headerStr = buffer.subarray(0, headerEnd).toString("utf8");
        const match = headerStr.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          buffer = buffer.subarray(headerEnd + 4);
          continue;
        }
        const contentLen = Number(match[1]);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + contentLen) break;
        const jsonStr = buffer.subarray(bodyStart, bodyStart + contentLen).toString("utf8");
        buffer = buffer.subarray(bodyStart + contentLen);
        try {
          const parsed = JSON.parse(jsonStr);
          void handleJsonRpcMessage(parsed);
        } catch (err) {
          process.stderr.write(`[mcp-parse-error] ${err}\n`);
        }
      } else {
        const nlIdx = buffer.indexOf(0x0a); // '\n'
        if (nlIdx === -1) break;
        const lineStr = buffer.subarray(0, nlIdx).toString("utf8").trim();
        buffer = buffer.subarray(nlIdx + 1);
        if (!lineStr) continue;
        try {
          const parsed = JSON.parse(lineStr);
          void handleJsonRpcMessage(parsed);
        } catch (err) {
          process.stderr.write(`[mcp-parse-error] ${err}\n`);
        }
      }
    }
  });

  process.stdin.on("end", async () => {
    await sql.end({ timeout: 2 });
    process.exit(0);
  });
}
