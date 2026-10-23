// ══════════════════════════════════════════════════════════════════════════════
// 📊 DIRECTOR BI CONTEXT — Contexto Executivo 360º em Tempo Real (Fagner / Valentina Diretoria)
// Exclusivo para o módulo administrativo (scope = "admin").
// NÃO afeta o copiloto individual do operador (scope = "operator").
// ══════════════════════════════════════════════════════════════════════════════

import { client as sqlClient } from "../../db";
import {
  calculateBusinessPacing,
  isCommercialWinStage,
  roundPercent,
  saoPauloDay,
  type CommercialCalendarDay,
} from "../commercial/metrics";
import { buildConsultantOperatorAliasMap } from "../commercial/avatar-matcher";
import { categorizeLossReason } from "../commercial/perdas-data";
import { projectIndustrialMonitoring } from "../triage/industrial-monitor";
import {
  buildJournalSnapshot,
  readJournalSnapshot,
  type JournalFlow,
} from "../triage/industrial-triage-journal";
import { RodizioEngine } from "./rodizio-engine";
import { getKnowledgeBaseContext } from "./knowledge-service";

function formatBrl(value: number): string {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

function formatDurationSeconds(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec <= 0) return "N/A";
  const rounded = Math.round(sec);
  if (rounded < 60) return `${rounded}s`;
  const mins = Math.floor(rounded / 60);
  const remSec = rounded % 60;
  if (mins < 60) return remSec > 0 ? `${mins}m ${remSec}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

function formatDurationMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min) || min < 0) return "0m";
  const rounded = Math.round(min);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const remMins = rounded % 60;
  if (hours < 24) return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

const DIRECTOR_STOPWORDS = new Set([
  "como", "qual", "quais", "quem", "onde", "quando", "porque", "para", "pelo", "pela",
  "meus", "minha", "minhas", "meu", "sobre", "estao", "esta", "estão", "está", "hoje",
  "ontem", "amanha", "amanhã", "agora", "fagner", "valentina", "cliente", "clientes",
  "negociacao", "negociação", "negociacoes", "negociações", "tarefa", "tarefas",
  "ligacao", "ligação", "ligacoes", "ligações", "meta", "metas", "conversa", "conversas",
  "atendimento", "atendimentos", "tenho", "tem", "tudo", "todos", "todas", "fazer",
  "preciso", "quero", "pode", "resumo", "status", "parada", "paradas", "parado", "parados",
  "aberta", "abertas", "aberto", "abertos", "pendente", "pendentes", "agenda", "agendada",
  "agendadas", "agendado", "agendados", "mes", "mês", "semana", "dia", "valor", "proposta",
  "tempo", "medio", "médio", "geral", "operador", "operadores", "mais", "gargalo", "fila",
  "taxa", "conversao", "conversão", "sdr", "quantos", "alerta", "alertas", "estouro", "sla",
  "tivemos", "gere", "grafico", "gráfico", "funil", "vendas", "desta", "puxe", "relatorio",
  "relatório", "detalhado", "vendedor", "vendedores", "objecoes", "objeções", "aparecem",
  "leads", "principais", "operacao", "operação", "dados", "mostrar", "mostre", "analise",
  "análise", "diretoria", "gestao", "gestão", "comercial", "equipe", "time",
]);

function extractDirectorSearchTerms(userQuery?: string): string[] {
  if (!userQuery || !userQuery.trim()) return [];
  return userQuery
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !DIRECTOR_STOPWORDS.has(w))
    .slice(0, 5);
}

/**
 * Constrói o dossiê executivo 360º completo da operação para o Fagner / Valentina Diretoria.
 * Inclui TMA, Gargalos de Fila por Operador, Taxa de Conversão SDR, Alertas de SLA,
 * Funil de Vendas (Semana/Mês/Geral), Relatório Detalhado por Vendedor, Objeções/Motivos de Perda,
 * Rodízio, Diretrizes, Custos IA, Base de Conhecimento e Busca Profunda sob demanda.
 */
export async function getDirectorBiContext(
  tenantId: string,
  userQuery?: string,
  knowledgeBase?: string
): Promise<string> {
  const now = new Date();
  const todayBr = saoPauloDay(now); // YYYY-MM-DD in America/Sao_Paulo
  const currentMonth = todayBr.slice(0, 7); // YYYY-MM
  const [yearNum, monthNum] = currentMonth.split("-").map(Number);
  const monthStartBr = `${currentMonth}-01`;
  const nextMonthStartBr = `${monthNum === 12 ? yearNum + 1 : yearNum}-${String(
    monthNum === 12 ? 1 : monthNum + 1
  ).padStart(2, "0")}-01`;

  // Início do dia em BRT (-03:00)
  const todayStartIso = `${todayBr}T00:00:00.000-03:00`;
  const sevenDaysAgoIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgoIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const sections: string[] = [];

  try {
    // ── 1. Consultas paralelas ao banco de dados ──────────────────────────────
    const [
      operatorsRes,
      consultantProfilesRes,
      convSummaryRes,
      activeConvsRes,
      transferTmaRes,
      responseTimeStatsRes,
      liveChatResponseStatsRes,
      overdueLogsRes,
      internalAlertsRes,
      sdrFlowsRes,
      pipelinesRes,
      stagesRes,
      dealsRes,
      goalsRes,
      calendarRes,
      directivesRes,
      pendingActivitiesRes,
      auditsRes,
      recentClientMessagesRes,
      aiCostsRes,
      rodizioRes,
    ] = await Promise.allSettled([
      // 1) Operadores do tenant
      sqlClient`
        SELECT id, name, email, role, status, is_online
        FROM operators
        WHERE tenant_id = ${tenantId}
        ORDER BY name ASC
      `,
      // 2) Perfis de consultores comerciais (divisão Máquinas / Personnalité)
      sqlClient`
        SELECT operator_id, division, active_on_tv
        FROM commercial_consultant_profiles
        WHERE tenant_id = ${tenantId}
      `,
      // 3) Resumo de conversas por estado + volume hoje / 7 dias
      sqlClient`
        SELECT
          queue_state,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE created_at >= ${todayStartIso}::timestamptz)::int AS created_today,
          COUNT(*) FILTER (WHERE last_message_time >= ${todayStartIso}::timestamptz)::int AS active_today,
          COUNT(*) FILTER (WHERE created_at >= ${sevenDaysAgoIso}::timestamptz)::int AS created_7d
        FROM conversations
        WHERE tenant_id = ${tenantId}
        GROUP BY queue_state
      `,
      // 4) Conversas ativas ('meus' e 'fila') com detalhes para gargalo de fila e espera ao vivo
      sqlClient`
        SELECT
          c.id,
          c.queue_state,
          c.operator_id,
          op.name AS operator_name,
          s.name AS sector_name,
          ct.name AS contact_name,
          ct.phone AS contact_phone,
          acc.name AS company_name,
          c.unread_count,
          c.last_message_text,
          c.last_message_time,
          c.created_at,
          c.updated_at,
          lm.sender_type AS last_msg_sender_type,
          lm.sent_at AS last_msg_at,
          lc.sent_at AS last_client_message_at,
          la.sent_at AS last_operator_message_at
        FROM conversations c
        INNER JOIN contacts ct ON ct.id = c.contact_id
        LEFT JOIN crm_accounts acc ON acc.id = ct.account_id
        LEFT JOIN operators op ON op.id = c.operator_id
        LEFT JOIN sectors s ON s.id = c.sector_id
        LEFT JOIN LATERAL (
          SELECT m.sender_type, m.sent_at
          FROM messages m
          WHERE m.conversation_id = c.id AND m.is_internal_note = false
          ORDER BY m.sent_at DESC
          LIMIT 1
        ) lm ON true
        LEFT JOIN LATERAL (
          SELECT m.sent_at
          FROM messages m
          WHERE m.conversation_id = c.id AND m.sender_type = 'client' AND m.is_internal_note = false
          ORDER BY m.sent_at DESC
          LIMIT 1
        ) lc ON true
        LEFT JOIN LATERAL (
          SELECT m.sent_at
          FROM messages m
          WHERE m.conversation_id = c.id AND m.sender_type = 'agent' AND m.is_internal_note = false
          ORDER BY m.sent_at DESC
          LIMIT 1
        ) la ON true
        WHERE c.tenant_id = ${tenantId}
          AND c.queue_state IN ('meus', 'fila', 'automacao')
        ORDER BY c.last_message_time DESC NULLS LAST
      `,
      // 5) TMA Pós-Transferência SDR (commercial_transfer_response_events)
      sqlClient`
        SELECT
          id,
          conversation_id,
          operator_id,
          transferred_at,
          first_responded_at,
          duration_seconds,
          status
        FROM commercial_transfer_response_events
        WHERE tenant_id = ${tenantId}
          AND transferred_at >= ${thirtyDaysAgoIso}::timestamptz
        ORDER BY transferred_at DESC
      `,
      // 6) TMA de response_time_logs (hoje, 7d, 30d)
      sqlClient`
        SELECT
          operator_id,
          COUNT(*) FILTER (WHERE client_message_at >= ${todayStartIso}::timestamptz)::int AS logs_today,
          AVG(response_time_seconds) FILTER (WHERE client_message_at >= ${todayStartIso}::timestamptz AND response_time_seconds IS NOT NULL)::float AS avg_sec_today,
          COUNT(*) FILTER (WHERE client_message_at >= ${todayStartIso}::timestamptz AND is_overdue = true)::int AS overdue_today,
          COUNT(*) FILTER (WHERE client_message_at >= ${sevenDaysAgoIso}::timestamptz)::int AS logs_7d,
          AVG(response_time_seconds) FILTER (WHERE client_message_at >= ${sevenDaysAgoIso}::timestamptz AND response_time_seconds IS NOT NULL)::float AS avg_sec_7d,
          COUNT(*) FILTER (WHERE client_message_at >= ${sevenDaysAgoIso}::timestamptz AND is_overdue = true)::int AS overdue_7d,
          COUNT(*)::int AS logs_30d,
          AVG(response_time_seconds) FILTER (WHERE response_time_seconds IS NOT NULL)::float AS avg_sec_30d,
          COUNT(*) FILTER (WHERE is_overdue = true)::int AS overdue_30d,
          COUNT(*) FILTER (WHERE is_overdue = true AND agent_response_id IS NULL)::int AS open_overdue_now
        FROM response_time_logs
        WHERE tenant_id = ${tenantId}
          AND client_message_at >= ${thirtyDaysAgoIso}::timestamptz
        GROUP BY operator_id
      `,
      // 7) Cálculo de TMA real diretamente de pares de mensagens (cliente -> agente) nos últimos 7 dias
      sqlClient`
        WITH msg_pairs AS (
          SELECT
            c.operator_id,
            m.sent_at AS op_msg_at,
            m.sent_at >= ${todayStartIso}::timestamptz AS is_today,
            (
              SELECT MAX(mc.sent_at)
              FROM messages mc
              WHERE mc.conversation_id = m.conversation_id
                AND mc.sender_type = 'client'
                AND mc.is_internal_note = false
                AND mc.sent_at < m.sent_at
                AND mc.sent_at >= m.sent_at - INTERVAL '4 hours'
            ) AS prev_client_msg_at
          FROM messages m
          INNER JOIN conversations c ON c.id = m.conversation_id
          WHERE c.tenant_id = ${tenantId}
            AND m.sender_type = 'agent'
            AND m.is_internal_note = false
            AND m.sent_at >= ${sevenDaysAgoIso}::timestamptz
            AND c.operator_id IS NOT NULL
        )
        SELECT
          operator_id,
          COUNT(*) FILTER (WHERE prev_client_msg_at IS NOT NULL AND is_today)::int AS replies_today,
          AVG(EXTRACT(EPOCH FROM (op_msg_at - prev_client_msg_at))) FILTER (WHERE prev_client_msg_at IS NOT NULL AND is_today)::float AS avg_reply_sec_today,
          COUNT(*) FILTER (WHERE prev_client_msg_at IS NOT NULL)::int AS replies_7d,
          AVG(EXTRACT(EPOCH FROM (op_msg_at - prev_client_msg_at))) FILTER (WHERE prev_client_msg_at IS NOT NULL)::float AS avg_reply_sec_7d
        FROM msg_pairs
        GROUP BY operator_id
      `,
      // 8) Logs de SLA estourados em aberto ou ocorridos hoje
      sqlClient`
        SELECT
          rtl.id,
          rtl.conversation_id,
          rtl.operator_id,
          rtl.client_message_at,
          rtl.agent_response_at,
          rtl.response_time_seconds,
          rtl.is_overdue,
          rtl.agent_response_id,
          ct.name AS contact_name,
          op.name AS operator_name
        FROM response_time_logs rtl
        INNER JOIN conversations c ON c.id = rtl.conversation_id
        INNER JOIN contacts ct ON ct.id = c.contact_id
        LEFT JOIN operators op ON op.id = rtl.operator_id
        WHERE rtl.tenant_id = ${tenantId}
          AND rtl.is_overdue = true
          AND (rtl.agent_response_id IS NULL OR rtl.client_message_at >= ${sevenDaysAgoIso}::timestamptz)
        ORDER BY rtl.client_message_at DESC
        LIMIT 30
      `,
      // 9) Alertas disparados em internal_messages (hoje e últimos 7 dias)
      sqlClient`
        SELECT
          im.id,
          im.operator_id,
          op.name AS operator_name,
          im.content,
          im.metadata,
          im.created_at
        FROM internal_messages im
        LEFT JOIN operators op ON op.id = im.operator_id
        WHERE im.tenant_id = ${tenantId}
          AND im.direction = 'from_agent'
          AND im.created_at >= ${sevenDaysAgoIso}::timestamptz
          AND (
            im.metadata->>'type' IN ('sla_alert', 'no_response', 'operator_overload', 'sentiment_alert', 'lead_transfer')
            OR im.agent_type = 'sla_alert'
          )
        ORDER BY im.created_at DESC
        LIMIT 80
      `,
      // 10) Fluxos de Triagem SDR (agent_flow_states) — últimas 200 conversas distintas
      sqlClient`
        WITH current_flows AS (
          SELECT DISTINCT ON (af.conversation_id)
            af.id,
            af.conversation_id,
            af.current_step AS current_node_id,
            af.collected_data,
            af.started_at,
            af.last_interaction_at AS updated_at,
            af.completed_at,
            af.outcome,
            af.metadata,
            c.queue_state,
            c.operator_id,
            op.name AS operator_name,
            s.name AS sector_name,
            ct.name AS contact_name,
            ct.phone AS contact_phone
          FROM agent_flow_states af
          INNER JOIN conversations c ON c.id = af.conversation_id AND c.tenant_id = af.tenant_id
          INNER JOIN contacts ct ON ct.id = c.contact_id AND ct.tenant_id = af.tenant_id
          LEFT JOIN operators op ON op.id = c.operator_id AND op.tenant_id = af.tenant_id
          LEFT JOIN sectors s ON s.id = c.sector_id AND s.tenant_id = af.tenant_id
          WHERE af.tenant_id = ${tenantId}
            AND af.agent_type = 'sdr'
          ORDER BY af.conversation_id, af.started_at DESC, af.id DESC
        )
        SELECT * FROM current_flows
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 200
      `,
      // 11) Pipelines do CRM
      sqlClient`
        SELECT id, name, order_index
        FROM crm_pipelines
        WHERE tenant_id = ${tenantId}
        ORDER BY order_index ASC, created_at ASC
      `,
      // 12) Etapas do CRM
      sqlClient`
        SELECT id, pipeline_id, name, order_index, is_win_stage
        FROM crm_stages
        WHERE tenant_id = ${tenantId}
        ORDER BY order_index ASC
      `,
      // 13) Negociações do CRM (crm_deals) com conta e último evento
      sqlClient`
        SELECT
          d.id,
          d.title,
          d.value,
          d.status,
          d.pipeline_id,
          d.stage_id,
          d.operator_id,
          d.account_id,
          d.loss_reason,
          d.last_activity_at,
          d.closed_at,
          d.created_at,
          d.updated_at,
          acc.name AS account_name,
          acc.document AS account_cnpj,
          acc.phone AS account_phone,
          (
            SELECT MAX(e.created_at)
            FROM crm_deal_events e
            WHERE e.deal_id = d.id AND e.tenant_id = ${tenantId}
          ) AS last_event_at
        FROM crm_deals d
        LEFT JOIN crm_accounts acc ON acc.id = d.account_id AND acc.tenant_id = ${tenantId}
        WHERE d.tenant_id = ${tenantId}
          AND COALESCE(d.title, '') NOT ILIKE '%TESTE%N_O APAGAR%'
        ORDER BY d.updated_at DESC
      `,
      // 14) Metas Comerciais do mês atual (ou último mês configurado como referência)
      sqlClient`
        SELECT id, operator_id, month, target_value, conversion_rate
        FROM commercial_goals
        WHERE tenant_id = ${tenantId}
          AND month = COALESCE(
            (SELECT month FROM commercial_goals WHERE tenant_id = ${tenantId} AND month = ${currentMonth} LIMIT 1),
            (SELECT month FROM commercial_goals WHERE tenant_id = ${tenantId} ORDER BY month DESC LIMIT 1)
          )
      `,
      // 15) Calendário Comercial do mês atual (dias úteis)
      sqlClient`
        SELECT date, type, affects_goal
        FROM commercial_calendar_days
        WHERE tenant_id = ${tenantId}
          AND date >= ${monthStartBr}
          AND date < ${nextMonthStartBr}
        ORDER BY date ASC
      `,
      // 16) Diretrizes da Diretoria (commercial_directives)
      sqlClient`
        SELECT
          cd.id,
          cd.deal_id,
          cd.assigned_to_operator_id AS operator_id,
          cd.instruction AS directive,
          cd.status,
          cd.priority,
          cd.created_at,
          cd.completed_at,
          d.title AS deal_title,
          op.name AS operator_name
        FROM commercial_directives cd
        LEFT JOIN crm_deals d ON d.id = cd.deal_id
        LEFT JOIN operators op ON op.id = cd.assigned_to_operator_id
        WHERE cd.tenant_id = ${tenantId}
        ORDER BY cd.created_at DESC
        LIMIT 30
      `,
      // 17) Atividades/Tarefas pendentes no CRM por vendedor
      sqlClient`
        SELECT
          a.id,
          a.deal_id,
          a.assigned_to_operator_id,
          a.type,
          a.title,
          a.due_date,
          a.status,
          d.title AS deal_title
        FROM crm_deal_activities a
        LEFT JOIN crm_deals d ON d.id = a.deal_id
        WHERE a.tenant_id = ${tenantId}
          AND a.status = 'pending'
        ORDER BY a.due_date ASC NULLS LAST
        LIMIT 60
      `,
      // 18) Auditorias recentes de atendimento (ai_conversation_audits)
      sqlClient`
        SELECT
          contact_name,
          operator_id,
          performance_score,
          client_sentiment,
          actionable_insight,
          audited_at
        FROM ai_conversation_audits
        WHERE tenant_id = ${tenantId}
          AND status = 'done'
        ORDER BY audited_at DESC
        LIMIT 20
      `,
      // 19) Amostra de mensagens recentes de clientes para mapear objeções e dúvidas reais
      sqlClient`
        SELECT
          m.content,
          m.sent_at AS created_at,
          c.id AS conversation_id,
          ct.name AS contact_name,
          op.name AS operator_name
        FROM messages m
        INNER JOIN conversations c ON c.id = m.conversation_id
        INNER JOIN contacts ct ON ct.id = c.contact_id
        LEFT JOIN operators op ON op.id = c.operator_id
        WHERE c.tenant_id = ${tenantId}
          AND m.sender_type = 'client'
          AND m.is_internal_note = false
          AND LENGTH(TRIM(COALESCE(m.content, ''))) >= 12
        ORDER BY m.sent_at DESC
        LIMIT 120
      `,
      // 20) Custos de IA (ai_usage_logs) nos últimos 7 dias e hoje
      sqlClient`
        SELECT
          feature,
          COUNT(*)::int AS calls_7d,
          COUNT(*) FILTER (WHERE created_at >= ${todayStartIso}::timestamptz)::int AS calls_today,
          COALESCE(SUM(NULLIF(cost_brl, '')::numeric), 0)::float AS cost_brl_7d,
          COALESCE(SUM(NULLIF(cost_brl, '')::numeric) FILTER (WHERE created_at >= ${todayStartIso}::timestamptz), 0)::float AS cost_brl_today
        FROM ai_usage_logs
        WHERE tenant_id = ${tenantId}
          AND created_at >= ${sevenDaysAgoIso}::timestamptz
        GROUP BY feature
        ORDER BY cost_brl_7d DESC
      `,
      // 21) Estado do Rodízio
      RodizioEngine.getRodizioState(tenantId),
    ]);

    const operatorsList: any[] = operatorsRes.status === "fulfilled" ? [...operatorsRes.value] : [];
    const consultantProfiles: any[] =
      consultantProfilesRes.status === "fulfilled" ? [...consultantProfilesRes.value] : [];
    const convSummary: any[] = convSummaryRes.status === "fulfilled" ? [...convSummaryRes.value] : [];
    const activeConvs: any[] = activeConvsRes.status === "fulfilled" ? [...activeConvsRes.value] : [];
    const transferTmaRows: any[] = transferTmaRes.status === "fulfilled" ? [...transferTmaRes.value] : [];
    const responseTimeStats: any[] =
      responseTimeStatsRes.status === "fulfilled" ? [...responseTimeStatsRes.value] : [];
    const liveChatResponseStats: any[] =
      liveChatResponseStatsRes.status === "fulfilled" ? [...liveChatResponseStatsRes.value] : [];
    const overdueLogs: any[] = overdueLogsRes.status === "fulfilled" ? [...overdueLogsRes.value] : [];
    const internalAlerts: any[] =
      internalAlertsRes.status === "fulfilled" ? [...internalAlertsRes.value] : [];
    const sdrFlows: any[] = sdrFlowsRes.status === "fulfilled" ? [...sdrFlowsRes.value] : [];
    const pipelines: any[] = pipelinesRes.status === "fulfilled" ? [...pipelinesRes.value] : [];
    const stages: any[] = stagesRes.status === "fulfilled" ? [...stagesRes.value] : [];
    const deals: any[] = dealsRes.status === "fulfilled" ? [...dealsRes.value] : [];
    const goals: any[] = goalsRes.status === "fulfilled" ? [...goalsRes.value] : [];
    const calendarDays: any[] = calendarRes.status === "fulfilled" ? [...calendarRes.value] : [];
    const directives: any[] = directivesRes.status === "fulfilled" ? [...directivesRes.value] : [];
    const pendingActivities: any[] =
      pendingActivitiesRes.status === "fulfilled" ? [...pendingActivitiesRes.value] : [];
    const audits: any[] = auditsRes.status === "fulfilled" ? [...auditsRes.value] : [];
    const recentClientMessages: any[] =
      recentClientMessagesRes.status === "fulfilled" ? [...recentClientMessagesRes.value] : [];
    const aiCosts: any[] = aiCostsRes.status === "fulfilled" ? [...aiCostsRes.value] : [];
    const rodizioOps: any[] = rodizioRes.status === "fulfilled" ? [...rodizioRes.value] : [];

    // Mapa de operadores por ID
    const opNameById = new Map<string, string>();
    const opRoleById = new Map<string, string>();
    const opStatusById = new Map<string, string>();
    for (const op of operatorsList) {
      opNameById.set(op.id, op.name || "Operador");
      opRoleById.set(op.id, op.role || "operator");
      opStatusById.set(op.id, op.status || "offline");
    }

    const divisionByOpId = new Map<string, string>();
    for (const cp of consultantProfiles) {
      if (cp.operator_id && cp.division) {
        divisionByOpId.set(cp.operator_id, cp.division);
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SEÇÃO 1: FILAS E GARGALOS POR OPERADOR EM TEMPO REAL
    // (Responde: "Quem são os operadores com mais gargalo de fila?")
    // ══════════════════════════════════════════════════════════════════════════
    const queueCounts: Record<string, number> = { automacao: 0, fila: 0, meus: 0, finalizados: 0 };
    let totalConvCount = 0;
    let convCreatedToday = 0;
    let convActiveToday = 0;
    let convCreated7d = 0;
    for (const row of convSummary) {
      const st = row.queue_state || "outros";
      const tot = Number(row.total || 0);
      queueCounts[st] = (queueCounts[st] || 0) + tot;
      totalConvCount += tot;
      convCreatedToday += Number(row.created_today || 0);
      convActiveToday += Number(row.active_today || 0);
      convCreated7d += Number(row.created_7d || 0);
    }

    interface OperatorQueueBottleneck {
      operatorId: string;
      operatorName: string;
      division: string;
      status: string;
      activeChatsCount: number;
      waitingClientReplyCount: number;
      waitingOver15mCount: number;
      waiting8to14mCount: number;
      waitingOver24hCount: number;
      unreadMessagesSum: number;
      maxWaitMinutes: number;
      avgWaitMinutes: number;
      waitingClients: Array<{
        convId: string;
        clientName: string;
        companyName: string | null;
        waitMinutes: number;
        lastMessage: string;
      }>;
    }

    const bottleneckByOp = new Map<string, OperatorQueueBottleneck>();
    const unassignedFilaChats: Array<{
      convId: string;
      clientName: string;
      sectorName: string;
      waitMinutes: number;
      lastMessage: string;
    }> = [];
    const allLiveOverdue15mChats: Array<{
      convId: string;
      clientName: string;
      operatorName: string;
      waitMinutes: number;
      lastMessage: string;
    }> = [];
    const allLiveWarning8to14mChats: Array<{
      convId: string;
      clientName: string;
      operatorName: string;
      waitMinutes: number;
    }> = [];

    const nowMs = now.getTime();

    for (const c of activeConvs) {
      const clientTs = c.last_client_message_at
        ? new Date(c.last_client_message_at).getTime()
        : c.last_msg_sender_type === "client" && c.last_msg_at
          ? new Date(c.last_msg_at).getTime()
          : 0;
      const opTs = c.last_operator_message_at ? new Date(c.last_operator_message_at).getTime() : 0;

      const isClientWaiting =
        (clientTs > 0 && (opTs === 0 || clientTs > opTs)) || c.last_msg_sender_type === "client";
      const waitRefMs = clientTs > 0 ? clientTs : new Date(c.updated_at || c.created_at).getTime();
      const waitMinutes = isClientWaiting ? Math.max(1, Math.floor((nowMs - waitRefMs) / 60_000)) : 0;

      if (c.queue_state === "fila") {
        unassignedFilaChats.push({
          convId: c.id,
          clientName: c.contact_name || c.contact_phone || "Lead",
          sectorName: c.sector_name || "Geral",
          waitMinutes: Math.max(1, Math.floor((nowMs - waitRefMs) / 60_000)),
          lastMessage: (c.last_message_text || "").slice(0, 80),
        });
        if (waitMinutes >= 15) {
          allLiveOverdue15mChats.push({
            convId: c.id,
            clientName: c.contact_name || c.contact_phone || "Lead",
            operatorName: "Sem operador (Na Fila)",
            waitMinutes,
            lastMessage: (c.last_message_text || "").slice(0, 80),
          });
        }
        continue;
      }

      if (c.queue_state !== "meus") continue;

      const opId = c.operator_id || "unassigned";
      const opName = c.operator_name || opNameById.get(opId) || "Sem Operador";
      let entry = bottleneckByOp.get(opId);
      if (!entry) {
        entry = {
          operatorId: opId,
          operatorName: opName,
          division: divisionByOpId.get(opId) || "Geral",
          status: opStatusById.get(opId) || "offline",
          activeChatsCount: 0,
          waitingClientReplyCount: 0,
          waitingOver15mCount: 0,
          waiting8to14mCount: 0,
          waitingOver24hCount: 0,
          unreadMessagesSum: 0,
          maxWaitMinutes: 0,
          avgWaitMinutes: 0,
          waitingClients: [],
        };
        bottleneckByOp.set(opId, entry);
      }

      entry.activeChatsCount += 1;
      entry.unreadMessagesSum += Number(c.unread_count || 0);

      if (isClientWaiting) {
        entry.waitingClientReplyCount += 1;
        if (waitMinutes > entry.maxWaitMinutes) entry.maxWaitMinutes = waitMinutes;
        if (waitMinutes >= 15) {
          entry.waitingOver15mCount += 1;
          allLiveOverdue15mChats.push({
            convId: c.id,
            clientName: c.contact_name || c.contact_phone || "Cliente",
            operatorName: opName,
            waitMinutes,
            lastMessage: (c.last_message_text || "").slice(0, 80),
          });
        } else if (waitMinutes >= 8) {
          entry.waiting8to14mCount += 1;
          allLiveWarning8to14mChats.push({
            convId: c.id,
            clientName: c.contact_name || c.contact_phone || "Cliente",
            operatorName: opName,
            waitMinutes,
          });
        }
        if (waitMinutes >= 1440) {
          entry.waitingOver24hCount += 1;
        }
        entry.waitingClients.push({
          convId: c.id,
          clientName: c.contact_name || c.contact_phone || "Cliente",
          companyName: c.company_name || null,
          waitMinutes,
          lastMessage: (c.last_message_text || "").slice(0, 75),
        });
      }
    }

    // Calcula média de espera por operador e ordena ranking de gargalo
    const bottleneckRanking = Array.from(bottleneckByOp.values()).map((b) => {
      b.waitingClients.sort((a, z) => z.waitMinutes - a.waitMinutes);
      const sumWait = b.waitingClients.reduce((acc, item) => acc + item.waitMinutes, 0);
      b.avgWaitMinutes =
        b.waitingClients.length > 0 ? Math.round(sumWait / b.waitingClients.length) : 0;
      return b;
    });

    // Ordena por: 1) mais clientes esperando resposta (>15m e total), 2) maior volume de conversas ativas
    bottleneckRanking.sort((a, b) => {
      if (b.waitingClientReplyCount !== a.waitingClientReplyCount) {
        return b.waitingClientReplyCount - a.waitingClientReplyCount;
      }
      if (b.waitingOver15mCount !== a.waitingOver15mCount) {
        return b.waitingOver15mCount - a.waitingOver15mCount;
      }
      if (b.activeChatsCount !== a.activeChatsCount) {
        return b.activeChatsCount - a.activeChatsCount;
      }
      return b.maxWaitMinutes - a.maxWaitMinutes;
    });

    const totalWaitingReplyNow = bottleneckRanking.reduce(
      (s, b) => s + b.waitingClientReplyCount,
      0
    );
    const totalOver15mNow = bottleneckRanking.reduce((s, b) => s + b.waitingOver15mCount, 0);

    const queueLines: string[] = [
      `• Panorama Geral de Conversas (${totalConvCount} total no banco):`,
      `  - Em Atendimento Humano ('meus'): ${queueCounts.meus || 0} conversa(s) ativa(s)`,
      `  - Na Fila de Espera ('fila' sem operador): ${queueCounts.fila || 0} conversa(s)`,
      `  - Em Automação / Triagem IA ('automacao'): ${queueCounts.automacao || 0} conversa(s)`,
      `  - Finalizadas ('finalizados'): ${queueCounts.finalizados || 0} conversa(s)`,
      `  - Volume recente: ${convCreatedToday} iniciada(s) hoje | ${convActiveToday} movimentada(s) hoje | ${convCreated7d} iniciada(s) nos últimos 7 dias.`,
      `• Resumo de Gargalo Agora: ${totalWaitingReplyNow} cliente(s) aguardando resposta do operador neste exato momento (sendo ${totalOver15mNow} com espera >= 15 min / SLA estourado).`,
    ];

    if (unassignedFilaChats.length > 0) {
      queueLines.push(
        `• ⚠️ Conversas na Fila Geral SEM Operador (${unassignedFilaChats.length}): ` +
          unassignedFilaChats
            .slice(0, 6)
            .map(
              (u) =>
                `${u.clientName} (Setor: ${u.sectorName}, aguardando há ${formatDurationMinutes(u.waitMinutes)})`
            )
            .join(" | ")
      );
    }

    if (bottleneckRanking.length > 0) {
      queueLines.push(`• 🏆 RANKING DE GARGALO DE FILA POR OPERADOR (do maior gargalo para o menor):`);
      bottleneckRanking.forEach((b, idx) => {
        const waitingPreview =
          b.waitingClients.length > 0
            ? ` | Clientes aguardando: ${b.waitingClients
                .slice(0, 4)
                .map(
                  (wc) =>
                    `${wc.clientName}${wc.companyName ? ` (${wc.companyName})` : ""} [esperando há ${formatDurationMinutes(wc.waitMinutes)}]`
                )
                .join(", ")}`
            : " | Todos os clientes respondidos em dia";
        queueLines.push(
          `  ${idx + 1}º ${b.operatorName} (${b.division.toUpperCase()} | status: ${b.status}): ` +
            `${b.activeChatsCount} conversa(s) ativa(s) na carteira | ` +
            `${b.waitingClientReplyCount} cliente(s) aguardando resposta agora ` +
            `(${b.waitingOver15mCount} acima de 15min [SLA estourado], ${b.waiting8to14mCount} em alerta 8-14min, ${b.waitingOver24hCount} paradas >24h) | ` +
            `Não lidas: ${b.unreadMessagesSum} | Espera máx: ${formatDurationMinutes(b.maxWaitMinutes)} | Espera média da fila: ${formatDurationMinutes(b.avgWaitMinutes)}` +
            waitingPreview
        );
      });
    } else {
      queueLines.push(`• Nenhum operador possui conversas ativas na aba 'meus' neste momento.`);
    }

    sections.push(`🚦 1. GARGALOS DE FILA E CARGA POR OPERADOR (TEMPO REAL):\n${queueLines.join("\n")}`);

    // ══════════════════════════════════════════════════════════════════════════
    // SEÇÃO 2: TEMPO MÉDIO DE ATENDIMENTO (TMA) GERAL E POR OPERADOR
    // (Responde: "Como está o tempo médio de atendimento (TMA) geral?")
    // ══════════════════════════════════════════════════════════════════════════
    // 2.1 TMA Pós-Transferência SDR (commercial_transfer_response_events)
    const transferToday = transferTmaRows.filter(
      (r) => r.transferred_at && saoPauloDay(new Date(r.transferred_at)) === todayBr
    );
    const transferMonth = transferTmaRows.filter(
      (r) => r.transferred_at && saoPauloDay(new Date(r.transferred_at)).startsWith(currentMonth)
    );
    const transferRespondedToday = transferToday.filter(
      (r) => r.status === "responded" && r.duration_seconds !== null
    );
    const transferRespondedMonth = transferMonth.filter(
      (r) => r.status === "responded" && r.duration_seconds !== null
    );
    const transferPendingNow = transferTmaRows.filter((r) => r.status === "pending");

    const avgTransferSecToday =
      transferRespondedToday.length > 0
        ? transferRespondedToday.reduce((s, r) => s + Number(r.duration_seconds || 0), 0) /
          transferRespondedToday.length
        : null;
    const avgTransferSecMonth =
      transferRespondedMonth.length > 0
        ? transferRespondedMonth.reduce((s, r) => s + Number(r.duration_seconds || 0), 0) /
          transferRespondedMonth.length
        : null;
    const withinSlaMonthCount = transferRespondedMonth.filter(
      (r) => Number(r.duration_seconds || 0) <= 900
    ).length;
    const withinSlaMonthPct =
      transferRespondedMonth.length > 0
        ? roundPercent((withinSlaMonthCount / transferRespondedMonth.length) * 100)
        : 100;

    // 2.2 TMA de Chat Geral (response_time_logs + pares de mensagens ao vivo)
    let totalLogsToday = 0;
    let weightedSecToday = 0;
    let totalLogs7d = 0;
    let weightedSec7d = 0;
    let totalLogs30d = 0;
    let weightedSec30d = 0;

    for (const r of responseTimeStats) {
      const lToday = Number(r.logs_today || 0);
      const l7d = Number(r.logs_7d || 0);
      const l30d = Number(r.logs_30d || 0);
      if (lToday > 0 && r.avg_sec_today !== null) {
        totalLogsToday += lToday;
        weightedSecToday += lToday * Number(r.avg_sec_today);
      }
      if (l7d > 0 && r.avg_sec_7d !== null) {
        totalLogs7d += l7d;
        weightedSec7d += l7d * Number(r.avg_sec_7d);
      }
      if (l30d > 0 && r.avg_sec_30d !== null) {
        totalLogs30d += l30d;
        weightedSec30d += l30d * Number(r.avg_sec_30d);
      }
    }

    let liveRepliesToday = 0;
    let liveWeightedSecToday = 0;
    let liveReplies7d = 0;
    let liveWeightedSec7d = 0;
    const liveReplyByOp = new Map<
      string,
      { repliesToday: number; avgSecToday: number | null; replies7d: number; avgSec7d: number | null }
    >();

    for (const lr of liveChatResponseStats) {
      const rToday = Number(lr.replies_today || 0);
      const r7d = Number(lr.replies_7d || 0);
      const avgToday = lr.avg_reply_sec_today !== null ? Number(lr.avg_reply_sec_today) : null;
      const avg7d = lr.avg_reply_sec_7d !== null ? Number(lr.avg_reply_sec_7d) : null;
      if (rToday > 0 && avgToday !== null) {
        liveRepliesToday += rToday;
        liveWeightedSecToday += rToday * avgToday;
      }
      if (r7d > 0 && avg7d !== null) {
        liveReplies7d += r7d;
        liveWeightedSec7d += r7d * avg7d;
      }
      if (lr.operator_id) {
        liveReplyByOp.set(lr.operator_id, {
          repliesToday: rToday,
          avgSecToday: avgToday,
          replies7d: r7d,
          avgSec7d: avg7d,
        });
      }
    }

    const avgLogSecToday = totalLogsToday > 0 ? weightedSecToday / totalLogsToday : null;
    const avgLogSec7d = totalLogs7d > 0 ? weightedSec7d / totalLogs7d : null;
    const avgLogSec30d = totalLogs30d > 0 ? weightedSec30d / totalLogs30d : null;
    const avgLiveReplySecToday =
      liveRepliesToday > 0 ? liveWeightedSecToday / liveRepliesToday : null;
    const avgLiveReplySec7d = liveReplies7d > 0 ? liveWeightedSec7d / liveReplies7d : null;

    // TMA consolidado principal (usa o dado mais rico disponível para hoje e 7d/mês)
    const headlineTmaTodaySec = avgLogSecToday ?? avgLiveReplySecToday ?? avgTransferSecToday;
    const headlineTma7dSec = avgLogSec7d ?? avgLiveReplySec7d ?? avgTransferSecMonth ?? avgLogSec30d;

    // TMA por operador consolidado
    const tmaByOpLines: string[] = [];
    const opTmaCombined: Array<{
      opName: string;
      avgSec: number;
      sourceLabel: string;
      samples: number;
      overdue30d: number;
    }> = [];

    const statsByOpMap = new Map<string, any>();
    for (const r of responseTimeStats) {
      if (r.operator_id) statsByOpMap.set(r.operator_id, r);
    }

    const transferByOpMap = new Map<string, { count: number; totalSec: number; withinSla: number }>();
    for (const tr of transferRespondedMonth) {
      if (!tr.operator_id) continue;
      const cur = transferByOpMap.get(tr.operator_id) || { count: 0, totalSec: 0, withinSla: 0 };
      cur.count += 1;
      const dur = Number(tr.duration_seconds || 0);
      cur.totalSec += dur;
      if (dur <= 900) cur.withinSla += 1;
      transferByOpMap.set(tr.operator_id, cur);
    }

    const allRelevantOpIds = new Set<string>([
      ...Array.from(statsByOpMap.keys()),
      ...Array.from(liveReplyByOp.keys()),
      ...Array.from(transferByOpMap.keys()),
      ...Array.from(bottleneckByOp.keys()),
    ]);

    for (const opId of allRelevantOpIds) {
      if (opId === "unassigned") continue;
      const opName = opNameById.get(opId) || "Operador";
      const rtl = statsByOpMap.get(opId);
      const live = liveReplyByOp.get(opId);
      const tr = transferByOpMap.get(opId);
      const bneck = bottleneckByOp.get(opId);

      const bestSec =
        (rtl?.avg_sec_today !== null && rtl?.avg_sec_today !== undefined
          ? Number(rtl.avg_sec_today)
          : null) ??
        live?.avgSecToday ??
        (rtl?.avg_sec_7d !== null && rtl?.avg_sec_7d !== undefined ? Number(rtl.avg_sec_7d) : null) ??
        live?.avgSec7d ??
        (tr && tr.count > 0 ? tr.totalSec / tr.count : null) ??
        (rtl?.avg_sec_30d !== null && rtl?.avg_sec_30d !== undefined
          ? Number(rtl.avg_sec_30d)
          : null);

      const samples =
        Number(rtl?.logs_7d || 0) + Number(live?.replies7d || 0) + Number(tr?.count || 0);
      const overdue30d = Number(rtl?.overdue_30d || 0);

      if (bestSec !== null) {
        opTmaCombined.push({
          opName,
          avgSec: bestSec,
          sourceLabel:
            live?.avgSecToday || rtl?.avg_sec_today
              ? "Hoje"
              : live?.avgSec7d || rtl?.avg_sec_7d
                ? "Últimos 7d"
                : "Mês/30d",
          samples,
          overdue30d,
        });
      }

      tmaByOpLines.push(
        `  - ${opName}: ` +
          `TMA Resposta Hoje: ${formatDurationSeconds(rtl?.avg_sec_today ?? live?.avgSecToday)} (${Number(rtl?.logs_today || live?.repliesToday || 0)} resp.) | ` +
          `TMA 7 dias: ${formatDurationSeconds(rtl?.avg_sec_7d ?? live?.avgSec7d)} (${Number(rtl?.logs_7d || live?.replies7d || 0)} resp.) | ` +
          `TMA 30 dias: ${formatDurationSeconds(rtl?.avg_sec_30d)} (${Number(rtl?.logs_30d || 0)} logs, ${overdue30d} estouros SLA) | ` +
          `TMA 1ª Resp. Pós-SDR (Mês): ${tr && tr.count > 0 ? `${formatDurationSeconds(tr.totalSec / tr.count)} (${tr.count} leads, ${roundPercent((tr.withinSla / tr.count) * 100)}% no SLA <=15m)` : "Sem transferências medidas"} | ` +
          `Espera atual na fila: ${bneck ? `${bneck.waitingClientReplyCount} aguardando (média ${formatDurationMinutes(bneck.avgWaitMinutes)})` : "0 aguardando"}`
      );
    }

    opTmaCombined.sort((a, b) => a.avgSec - b.avgSec);
    const fastestOp = opTmaCombined[0];
    const slowestOp = opTmaCombined.length > 1 ? opTmaCombined[opTmaCombined.length - 1] : null;

    const tmaSectionLines: string[] = [
      `• Meta Oficial de SLA da Operação: Responder em até 15 minutos (Alerta amarelo a partir de 8 min; Estouro crítico >= 15 min).`,
      `• 📌 TMA GERAL DE RESPOSTA HOJE: ${
        headlineTmaTodaySec !== null
          ? `${formatDurationSeconds(headlineTmaTodaySec)} (${Math.round(headlineTmaTodaySec)}s)`
          : "Ainda sem pares de resposta concluídos hoje (00:00 até agora)"
      } [Amostra hoje: ${Math.max(totalLogsToday, liveRepliesToday)} interações respondidas].`,
      `• 📌 TMA GERAL NOS ÚLTIMOS 7 DIAS: ${
        headlineTma7dSec !== null
          ? `${formatDurationSeconds(headlineTma7dSec)} (${Math.round(headlineTma7dSec)}s)`
          : "N/A"
      } [Amostra 7d: ${Math.max(totalLogs7d, liveReplies7d)} interações].`,
      `• 📌 TMA GERAL NOS ÚLTIMOS 30 DIAS (Logs SLA): ${formatDurationSeconds(avgLogSec30d)} (${totalLogs30d} registros medidos, ${responseTimeStats.reduce((s, r) => s + Number(r.overdue_30d || 0), 0)} estouros de SLA).`,
      `• 📌 TMA DE 1ª RESPOSTA PÓS-TRANSFERÊNCIA DO SDR (Mês ${currentMonth}): ${
        avgTransferSecMonth !== null
          ? `${formatDurationSeconds(avgTransferSecMonth)} em ${transferRespondedMonth.length} transferência(s) respondida(s) (${withinSlaMonthPct}% dentro do SLA de 15 min) | Pendentes aguardando 1ª resposta agora: ${transferPendingNow.length}`
          : `Nenhuma transferência medida na tabela de eventos neste mês (${transferPendingNow.length} pendente(s) agora)`
      }.`,
      fastestOp
        ? `• Destaques de Velocidade: Operador mais rápido: ${fastestOp.opName} (${formatDurationSeconds(fastestOp.avgSec)} - ${fastestOp.sourceLabel})${
            slowestOp
              ? ` | Maior tempo médio de resposta: ${slowestOp.opName} (${formatDurationSeconds(slowestOp.avgSec)} - ${slowestOp.sourceLabel})`
              : ""
          }.`
        : `• Destaques de Velocidade: Sem amostra suficiente por operador.`,
      `• Detalhamento de TMA por Operador:`,
      ...(tmaByOpLines.length > 0 ? tmaByOpLines : ["  - Sem registros de TMA por operador."]),
    ];

    sections.push(
      `⏱️ 2. TEMPO MÉDIO DE ATENDIMENTO (TMA) GERAL E POR OPERADOR:\n${tmaSectionLines.join("\n")}`
    );

    // ══════════════════════════════════════════════════════════════════════════
    // SEÇÃO 3: TAXA DE CONVERSÃO DO SDR E FUNIL DE TRIAGEM (HOJE, 7 DIAS E GERAL)
    // (Responde: "Qual é a taxa de conversão do SDR de hoje?")
    // ══════════════════════════════════════════════════════════════════════════
    interface SdrWindowMetrics {
      total: number;
      qualifiedTransferred: number;
      collectingActive: number;
      noResponse: number;
      stoppedManual: number;
      resolvedByAi: number;
      conversionRateTotalPct: number;
      conversionRateFinishedPct: number;
      byFunnel: Record<string, number>;
    }

    const createEmptySdrMetrics = (): SdrWindowMetrics => ({
      total: 0,
      qualifiedTransferred: 0,
      collectingActive: 0,
      noResponse: 0,
      stoppedManual: 0,
      resolvedByAi: 0,
      conversionRateTotalPct: 0,
      conversionRateFinishedPct: 0,
      byFunnel: {},
    });

    const sdrToday = createEmptySdrMetrics();
    const sdr7d = createEmptySdrMetrics();
    const sdrAll = createEmptySdrMetrics();
    const recentTriageItems: string[] = [];
    const triageObjectionsSample: string[] = [];

    for (const row of sdrFlows) {
      const monitoring = projectIndustrialMonitoring(
        {
          startedAt: row.started_at,
          outcome: row.outcome,
          metadata: row.metadata,
        },
        {
          operatorId: row.operator_id,
          queueState: row.queue_state,
        }
      );

      const flowForJournal: JournalFlow = {
        conversationId: row.conversation_id,
        currentNodeId: row.current_node_id,
        collectedData: row.collected_data,
        metadata: row.metadata,
      };
      const snapshot =
        readJournalSnapshot(row.metadata) ||
        buildJournalSnapshot(flowForJournal, { updatedBy: "rule" });

      const startedDate = row.started_at ? new Date(row.started_at) : new Date();
      const startedDayBr = saoPauloDay(startedDate);
      const isToday =
        startedDayBr === todayBr || startedDate.getTime() >= new Date(todayStartIso).getTime();
      const is7d = startedDate.getTime() >= new Date(sevenDaysAgoIso).getTime();

      const state = monitoring.state;
      const isQualified =
        state === "transferred" ||
        state === "ready" ||
        state === "handoff_pending" ||
        state === "waiting_for_team" ||
        row.outcome === "transferred" ||
        row.outcome === "completed" ||
        (state === "manual" && Boolean(row.operator_id));
      const isCollecting = state === "collecting";
      const isNoResponse = state === "no_response" || row.outcome === "abandoned";
      const isResolved = state === "resolved";
      const isStopped = !isQualified && !isCollecting && !isNoResponse && !isResolved;

      const funnelName =
        monitoring.targetFunnel ||
        snapshot?.routing?.target ||
        row.sector_name ||
        (row.collected_data as any)?.area ||
        (row.collected_data as any)?.setor ||
        "Em definição / Geral";

      const applyToWindow = (win: SdrWindowMetrics) => {
        win.total += 1;
        if (isQualified) win.qualifiedTransferred += 1;
        else if (isCollecting) win.collectingActive += 1;
        else if (isNoResponse) win.noResponse += 1;
        else if (isResolved) win.resolvedByAi += 1;
        else if (isStopped) win.stoppedManual += 1;
        win.byFunnel[funnelName] = (win.byFunnel[funnelName] || 0) + 1;
      };

      applyToWindow(sdrAll);
      if (is7d) applyToWindow(sdr7d);
      if (isToday) applyToWindow(sdrToday);

      const cd = (row.collected_data || {}) as Record<string, any>;
      const machineOrProduct =
        snapshot?.Asset?.machineModel ||
        snapshot?.Need?.desiredProduct ||
        cd.maquina ||
        cd.produto ||
        cd.interesse ||
        cd.equipamento ||
        null;
      const companyName =
        snapshot?.Identity?.companyName || cd.empresa || cd.razao_social || null;
      const cnpj = snapshot?.Identity?.cnpj || cd.cnpj || null;

      if (recentTriageItems.length < 15) {
        recentTriageItems.push(
          `  - [${startedDayBr}] ${row.contact_name || row.contact_phone || "Lead"}${
            companyName ? ` (${companyName}${cnpj ? ` - CNPJ ${cnpj}` : ""})` : ""
          } | Status SDR: ${monitoring.label} (${state}) | Funil: ${funnelName} | Interesse: ${
            machineOrProduct || "N/I"
          } | Progresso: ${snapshot?.progress?.percent ?? 0}% | Consultor: ${
            row.operator_name || "Aguardando/IA"
          }`
        );
      }

      if (cd.duvida || cd.observacao || cd.urgencia || cd.problema) {
        triageObjectionsSample.push(
          `${row.contact_name || "Lead"}: ${cd.duvida || cd.observacao || cd.urgencia || cd.problema}`
        );
      }
    }

    const finalizeSdrRates = (win: SdrWindowMetrics) => {
      win.conversionRateTotalPct =
        win.total > 0 ? roundPercent((win.qualifiedTransferred / win.total) * 100) : 0;
      const finished = Math.max(0, win.total - win.collectingActive);
      win.conversionRateFinishedPct =
        finished > 0 ? roundPercent((win.qualifiedTransferred / finished) * 100) : 0;
    };
    finalizeSdrRates(sdrToday);
    finalizeSdrRates(sdr7d);
    finalizeSdrRates(sdrAll);

    const formatFunnelBreakdown = (byFunnel: Record<string, number>) => {
      const entries = Object.entries(byFunnel).sort((a, b) => b[1] - a[1]);
      if (entries.length === 0) return "Nenhum registro";
      return entries.map(([k, v]) => `${k}: ${v}`).join(" | ");
    };

    const sdrLines: string[] = [
      `• 🎯 HOJE (${todayBr}):`,
      `  - Total de Leads em Triagem SDR Hoje: ${sdrToday.total}`,
      `  - Leads Qualificados / Encaminhados ao Comercial Hoje: ${sdrToday.qualifiedTransferred}`,
      `  - Taxa de Conversão do SDR Hoje (sobre total do dia): ${sdrToday.conversionRateTotalPct}% (${sdrToday.qualifiedTransferred} de ${sdrToday.total})`,
      `  - Taxa de Conversão do SDR Hoje (sobre triagens concluídas): ${sdrToday.conversionRateFinishedPct}%`,
      `  - Em Qualificação Ativa Agora: ${sdrToday.collectingActive} | Sem Resposta/Abandono Hoje: ${sdrToday.noResponse} | Interrompidos/Manual: ${sdrToday.stoppedManual} | Resolvidos pela IA: ${sdrToday.resolvedByAi}`,
      `  - Distribuição por Setor/Funil Hoje: ${formatFunnelBreakdown(sdrToday.byFunnel)}`,
      `• 📅 ÚLTIMOS 7 DIAS:`,
      `  - Total de Leads no SDR (7d): ${sdr7d.total} | Qualificados/Transferidos: ${sdr7d.qualifiedTransferred} | Taxa de Conversão Total (7d): ${sdr7d.conversionRateTotalPct}% (Sobre concluídas: ${sdr7d.conversionRateFinishedPct}%)`,
      `  - Em Coleta: ${sdr7d.collectingActive} | Sem Resposta: ${sdr7d.noResponse} | Manual/Parados: ${sdr7d.stoppedManual}`,
      `  - Distribuição por Setor/Funil (7d): ${formatFunnelBreakdown(sdr7d.byFunnel)}`,
      `• 📊 HISTÓRICO GERAL RECENTE (Amostra de ${sdrAll.total} sessões do SDR):`,
      `  - Qualificados/Transferidos: ${sdrAll.qualifiedTransferred} (${sdrAll.conversionRateTotalPct}% do total / ${sdrAll.conversionRateFinishedPct}% das finalizadas) | Em Coleta: ${sdrAll.collectingActive} | Sem Resposta: ${sdrAll.noResponse} | Manual/Parados: ${sdrAll.stoppedManual}`,
      `  - Distribuição por Setor/Funil (Geral): ${formatFunnelBreakdown(sdrAll.byFunnel)}`,
      `• Últimos Leads Triados pelo SDR:`,
      ...(recentTriageItems.length > 0 ? recentTriageItems : ["  - Nenhuma triagem registrada."]),
    ];

    sections.push(
      `🤖 3. TAXA DE CONVERSÃO DO SDR E PERFORMANCE DA TRIAGEM AUTOMÁTICA:\n${sdrLines.join("\n")}`
    );

    // ══════════════════════════════════════════════════════════════════════════
    // SEÇÃO 4: ALERTAS DE ESTOURO DE SLA HOJE E TOP 5 PRINCIPAIS ALERTAS DA OPERAÇÃO
    // (Responde: "Quantos alertas de estouro de SLA tivemos hoje?" e "Quais são os 5 principais alertas da operação hoje?")
    // ══════════════════════════════════════════════════════════════════════════
    const alertsTodayRows = internalAlerts.filter(
      (a) => a.created_at && saoPauloDay(new Date(a.created_at)) === todayBr
    );
    const countAlertByType = (rows: any[], types: string[]) =>
      rows.filter((r) => {
        const t = r.metadata?.type || r.agent_type || "";
        return types.includes(t);
      }).length;

    const slaAlertsFiredToday = countAlertByType(alertsTodayRows, ["sla_alert", "no_response"]);
    const overloadAlertsToday = countAlertByType(alertsTodayRows, ["operator_overload"]);
    const sentimentAlertsToday = countAlertByType(alertsTodayRows, ["sentiment_alert"]);

    const slaAlertsFired7d = countAlertByType(internalAlerts, ["sla_alert", "no_response"]);
    const overloadAlerts7d = countAlertByType(internalAlerts, ["operator_overload"]);

    const overdueLogsToday = overdueLogs.filter(
      (l) => l.client_message_at && saoPauloDay(new Date(l.client_message_at)) === todayBr
    );
    const openOverdueLogsNow = overdueLogs.filter((l) => l.agent_response_id === null);

    allLiveOverdue15mChats.sort((a, b) => b.waitMinutes - a.waitMinutes);

    const slaSectionLines: string[] = [
      `• 🚨 RESUMO DE ESTOUROS DE SLA HOJE (${todayBr}):`,
      `  - Notificações de Estouro de SLA / Sem Resposta disparadas hoje: ${slaAlertsFiredToday} alerta(s)`,
      `  - Alertas de Sobrecarga de Operador disparados hoje: ${overloadAlertsToday} alerta(s)`,
      `  - Alertas de Sentimento Crítico hoje: ${sentimentAlertsToday} alerta(s)`,
      `  - Registros de SLA estourado na tabela response_time_logs hoje: ${overdueLogsToday.length} (e ${openOverdueLogsNow.length} em aberto sem resposta no log)`,
      `  - Conversas ATIVAS AO VIVO com SLA Estourado AGORA (cliente esperando >= 15 min): ${allLiveOverdue15mChats.length} conversa(s)`,
      `  - Conversas em Pré-Alerta de SLA AGORA (cliente esperando entre 8 e 14 min): ${allLiveWarning8to14mChats.length} conversa(s)`,
      `  - Histórico 7 dias: ${slaAlertsFired7d} alertas de SLA e ${overloadAlerts7d} alertas de sobrecarga disparados nos últimos 7 dias.`,
    ];

    if (allLiveOverdue15mChats.length > 0) {
      slaSectionLines.push(
        `• Lista de Conversas com SLA Estourado Agora (>= 15 min sem resposta):`,
        ...allLiveOverdue15mChats
          .slice(0, 10)
          .map(
            (c, i) =>
              `  ${i + 1}. ${c.clientName} — aguardando há ${formatDurationMinutes(c.waitMinutes)} | Operador: ${c.operatorName} | Última msg: "${c.lastMessage || "Mídia/ Áudio"}"`
          )
      );
    }

    sections.push(
      `🚨 4. ALERTAS DE ESTOURO DE SLA (HOJE E EM TEMPO REAL):\n${slaSectionLines.join("\n")}`
    );

    // ══════════════════════════════════════════════════════════════════════════
    // SEÇÃO 5: FUNIL DE VENDAS (SEMANA, MÊS E GERAL) + RELATÓRIO POR VENDEDOR
    // (Responde: "Gere um gráfico do funil de vendas desta semana" e "Puxe um relatório detalhado por vendedor")
    // ══════════════════════════════════════════════════════════════════════════
    const pipelineNameById = new Map<string, string>();
    for (const p of pipelines) {
      pipelineNameById.set(p.id, p.name || "Funil");
    }

    const stageById = new Map<
      string,
      { id: string; pipelineId: string; name: string; orderIndex: number; isWin: boolean }
    >();
    for (const st of stages) {
      stageById.set(st.id, {
        id: st.id,
        pipelineId: st.pipeline_id,
        name: st.name || "Etapa",
        orderIndex: Number(st.order_index || 0),
        isWin: isCommercialWinStage({
          id: st.id,
          name: st.name,
          isWinStage: st.is_win_stage,
        }),
      });
    }

    // Alias map para reconciliar nomes de consultores e operadores
    const aliasResolution = buildConsultantOperatorAliasMap(
      operatorsList.map((o) => ({ operatorId: o.id, name: o.name })),
      operatorsList.map((o) => ({ id: o.id, name: o.name }))
    );
    const resolveCanonicalOpId = (rawId: string | null | undefined): string => {
      if (!rawId) return "unassigned";
      return aliasResolution.resolve(rawId) || rawId;
    };

    // Metas do mês
    let companyMonthGoal = 0;
    const goalByOpId = new Map<string, number>();
    for (const g of goals) {
      const val = Number(g.target_value || 0);
      if (g.operator_id) {
        const cid = resolveCanonicalOpId(g.operator_id);
        goalByOpId.set(cid, (goalByOpId.get(cid) || 0) + val);
      } else {
        companyMonthGoal += val;
      }
    }
    if (companyMonthGoal === 0 && goalByOpId.size > 0) {
      for (const v of goalByOpId.values()) companyMonthGoal += v;
    }

    // Métricas globais e por etapa/vendedor
    let wonMonthValue = 0;
    let wonMonthCount = 0;
    let wonWeekValue = 0;
    let wonWeekCount = 0;
    let wonTodayValue = 0;
    let wonTodayCount = 0;
    let openPipelineValue = 0;
    let openPipelineCount = 0;
    let lostMonthValue = 0;
    let lostMonthCount = 0;
    let createdWeekCount = 0;
    let createdWeekValue = 0;

    interface StageFunnelStat {
      stageId: string;
      stageName: string;
      pipelineName: string;
      orderIndex: number;
      isWin: boolean;
      openCount: number;
      openValue: number;
      weekCount: number;
      weekValue: number;
      monthCount: number;
      monthValue: number;
    }
    const stageStatsMap = new Map<string, StageFunnelStat>();
    for (const st of stages) {
      const pName = pipelineNameById.get(st.pipeline_id) || "Comercial";
      stageStatsMap.set(st.id, {
        stageId: st.id,
        stageName: st.name,
        pipelineName: pName,
        orderIndex: Number(st.order_index || 0),
        isWin: isCommercialWinStage({
          id: st.id,
          name: st.name,
          isWinStage: st.is_win_stage,
        }),
        openCount: 0,
        openValue: 0,
        weekCount: 0,
        weekValue: 0,
        monthCount: 0,
        monthValue: 0,
      });
    }

    interface SellerReportRow {
      operatorId: string;
      operatorName: string;
      division: string;
      monthGoal: number;
      wonMonthValue: number;
      wonMonthCount: number;
      wonWeekValue: number;
      wonWeekCount: number;
      openDealsCount: number;
      openDealsValue: number;
      stalledDealsCount: number;
      stalledDealsValue: number;
      lostMonthCount: number;
      lostMonthValue: number;
      pendingTasksCount: number;
      pendingDirectivesCount: number;
    }

    const sellerReportMap = new Map<string, SellerReportRow>();
    const ensureSellerRow = (rawOpId: string | null | undefined): SellerReportRow => {
      const cid = resolveCanonicalOpId(rawOpId);
      let row = sellerReportMap.get(cid);
      if (!row) {
        row = {
          operatorId: cid,
          operatorName: opNameById.get(cid) || (cid === "unassigned" ? "Sem Vendedor Atribuído" : cid),
          division: divisionByOpId.get(cid) || "Comercial",
          monthGoal: goalByOpId.get(cid) || 0,
          wonMonthValue: 0,
          wonMonthCount: 0,
          wonWeekValue: 0,
          wonWeekCount: 0,
          openDealsCount: 0,
          openDealsValue: 0,
          stalledDealsCount: 0,
          stalledDealsValue: 0,
          lostMonthCount: 0,
          lostMonthValue: 0,
          pendingTasksCount: 0,
          pendingDirectivesCount: 0,
        };
        sellerReportMap.set(cid, row);
      }
      return row;
    };

    // Pré-popula consultores com meta ou perfil comercial
    for (const cp of consultantProfiles) {
      if (cp.operator_id) ensureSellerRow(cp.operator_id);
    }
    for (const opId of goalByOpId.keys()) {
      ensureSellerRow(opId);
    }

    const stalledDealsList: Array<{
      id: string;
      title: string;
      accountName: string;
      operatorName: string;
      stageName: string;
      value: number;
      daysStalled: number;
    }> = [];
    const topOpenDealsList: Array<{
      id: string;
      title: string;
      accountName: string;
      operatorName: string;
      stageName: string;
      value: number;
    }> = [];
    const recentWonDealsList: Array<{
      title: string;
      accountName: string;
      operatorName: string;
      value: number;
      day: string;
    }> = [];
    const lossCategoryMap = new Map<
      string,
      {
        label: string;
        count: number;
        value: number;
        monthCount: number;
        monthValue: number;
        examples: string[];
      }
    >();
    const lossSubReasonMap = new Map<
      string,
      { reason: string; category: string; count: number; monthCount: number; value: number }
    >();

    const sevenDaysAgoMs = new Date(sevenDaysAgoIso).getTime();

    for (const d of deals) {
      const val = Number(d.value || 0);
      const stInfo = stageById.get(d.stage_id);
      const isEffectiveWon = d.status === "won" || (d.status !== "lost" && Boolean(stInfo?.isWin));
      const isLost = d.status === "lost";
      const isOpen = !isEffectiveWon && !isLost;

      const createdDate = d.created_at ? new Date(d.created_at) : now;
      const updatedDate = d.updated_at ? new Date(d.updated_at) : createdDate;
      const closedDate = d.closed_at ? new Date(d.closed_at) : updatedDate;
      const lastTouchDate = d.last_event_at ? new Date(d.last_event_at) : updatedDate;

      const createdInWeek = createdDate.getTime() >= sevenDaysAgoMs;
      const activeInWeek =
        createdInWeek ||
        updatedDate.getTime() >= sevenDaysAgoMs ||
        closedDate.getTime() >= sevenDaysAgoMs;
      const createdInMonth = saoPauloDay(createdDate).startsWith(currentMonth);

      if (createdInWeek) {
        createdWeekCount += 1;
        createdWeekValue += val;
      }

      const stageStat = stageStatsMap.get(d.stage_id);
      if (stageStat) {
        if (isOpen || isEffectiveWon) {
          if (isOpen) {
            stageStat.openCount += 1;
            stageStat.openValue += val;
          }
          if (activeInWeek) {
            stageStat.weekCount += 1;
            stageStat.weekValue += val;
          }
          if (createdInMonth || saoPauloDay(updatedDate).startsWith(currentMonth)) {
            stageStat.monthCount += 1;
            stageStat.monthValue += val;
          }
        }
      }

      const seller = ensureSellerRow(d.operator_id);

      if (isEffectiveWon) {
        const winDay = saoPauloDay(d.closed_at ? closedDate : updatedDate);
        if (winDay.startsWith(currentMonth)) {
          wonMonthValue += val;
          wonMonthCount += 1;
          seller.wonMonthValue += val;
          seller.wonMonthCount += 1;
        }
        if ((d.closed_at ? closedDate : updatedDate).getTime() >= sevenDaysAgoMs) {
          wonWeekValue += val;
          wonWeekCount += 1;
          seller.wonWeekValue += val;
          seller.wonWeekCount += 1;
        }
        if (winDay === todayBr) {
          wonTodayValue += val;
          wonTodayCount += 1;
        }
        if (recentWonDealsList.length < 10) {
          recentWonDealsList.push({
            title: d.title || "Venda",
            accountName: d.account_name || "Cliente",
            operatorName: seller.operatorName,
            value: val,
            day: winDay,
          });
        }
      } else if (isLost) {
        const lostDay = saoPauloDay(d.closed_at ? closedDate : updatedDate);
        const isLostInMonth = lostDay.startsWith(currentMonth);
        if (isLostInMonth) {
          lostMonthValue += val;
          lostMonthCount += 1;
          seller.lostMonthCount += 1;
          seller.lostMonthValue += val;
        }
        const catLabel = categorizeLossReason(d.loss_reason);
        const curCat = lossCategoryMap.get(catLabel) || {
          label: catLabel,
          count: 0,
          value: 0,
          monthCount: 0,
          monthValue: 0,
          examples: [],
        };
        curCat.count += 1;
        curCat.value += val;
        if (isLostInMonth) {
          curCat.monthCount += 1;
          curCat.monthValue += val;
        }
        if (d.loss_reason && curCat.examples.length < 3) {
          curCat.examples.push(`${d.title}: "${d.loss_reason}"`);
        }
        lossCategoryMap.set(catLabel, curCat);

        const rawReason = String(d.loss_reason || "Não especificado").trim() || "Não especificado";
        const curSub = lossSubReasonMap.get(rawReason) || {
          reason: rawReason,
          category: catLabel,
          count: 0,
          monthCount: 0,
          value: 0,
        };
        curSub.count += 1;
        if (isLostInMonth) curSub.monthCount += 1;
        curSub.value += val;
        lossSubReasonMap.set(rawReason, curSub);
      } else if (isOpen) {
        openPipelineValue += val;
        openPipelineCount += 1;
        seller.openDealsCount += 1;
        seller.openDealsValue += val;

        const daysStalled = Math.floor((nowMs - lastTouchDate.getTime()) / (24 * 60 * 60 * 1000));
        if (daysStalled >= 3) {
          seller.stalledDealsCount += 1;
          seller.stalledDealsValue += val;
          stalledDealsList.push({
            id: d.id,
            title: d.title || "Negociação",
            accountName: d.account_name || "Cliente",
            operatorName: seller.operatorName,
            stageName: stInfo?.name || "Em aberto",
            value: val,
            daysStalled,
          });
        }

        topOpenDealsList.push({
          id: d.id,
          title: d.title || "Negociação",
          accountName: d.account_name || "Cliente",
          operatorName: seller.operatorName,
          stageName: stInfo?.name || "Em aberto",
          value: val,
        });
      }
    }

    // Tarefas e diretrizes pendentes por vendedor
    for (const act of pendingActivities) {
      if (act.assigned_to_operator_id) {
        const s = ensureSellerRow(act.assigned_to_operator_id);
        s.pendingTasksCount += 1;
      }
    }
    for (const dir of directives) {
      if (dir.status === "pending" && dir.operator_id) {
        const s = ensureSellerRow(dir.operator_id);
        s.pendingDirectivesCount += 1;
      }
    }

    // Cálculo de Pacing de Dias Úteis do Mês
    const mappedCalendar: CommercialCalendarDay[] = calendarDays.map((c) => ({
      date: c.date,
      type: c.type || "holiday",
      affectsGoal: Boolean(c.affects_goal),
    }));
    const rawPacing = calculateBusinessPacing(
      currentMonth,
      todayBr,
      companyMonthGoal,
      wonMonthValue,
      mappedCalendar
    );
    const expectedToDate = companyMonthGoal * (rawPacing.expectedPercent / 100);
    const pacingStatus =
      rawPacing.coveragePercent >= rawPacing.expectedPercent
        ? "ACIMA / NO RITMO DA META"
        : rawPacing.coveragePercent >= rawPacing.expectedPercent * 0.8
          ? "ATENÇÃO ( ABAIXO DO RITMO IDEAL )"
          : "CRÍTICO ( DISTANTE DO RITMO IDEAL )";
    const pacing = {
      totalBusinessDays: rawPacing.businessDays,
      elapsedBusinessDays: rawPacing.elapsedDays,
      remainingBusinessDays: rawPacing.remainingDays,
      expectedPct: rawPacing.expectedPercent,
      attainmentPct: rawPacing.coveragePercent,
      requiredDailyRate: rawPacing.dailyRequired,
      expectedToDate,
      pacingStatus,
    };

    // 5.1 Funil de Vendas (Desta Semana e Pipeline Geral por Etapa)
    const stageStatsList = Array.from(stageStatsMap.values()).sort(
      (a, b) => a.orderIndex - b.orderIndex
    );

    const funnelLines: string[] = [
      `• 📊 RESUMO DO FUNIL NESTA SEMANA (Últimos 7 dias):`,
      `  - Novas Negociações Criadas na Semana: ${createdWeekCount} (${formatBrl(createdWeekValue)})`,
      `  - Negociações Ganhas/Fechadas na Semana: ${wonWeekCount} (${formatBrl(wonWeekValue)})`,
      `  - Negociações Ganhas Hoje (${todayBr}): ${wonTodayCount} (${formatBrl(wonTodayValue)})`,
      `  - Pipeline Total em Aberto Agora: ${openPipelineCount} negociação(ões) somando ${formatBrl(openPipelineValue)}`,
      `• 📈 DADOS POR ETAPA DO FUNIL (Use estes números exatos para gerar gráficos ChartBlock de Funil da Semana ou Geral):`,
    ];

    if (stageStatsList.length > 0) {
      for (const st of stageStatsList) {
        if (st.openCount === 0 && st.weekCount === 0 && st.monthCount === 0) continue;
        funnelLines.push(
          `  - Etapa "${st.stageName}" (Funil: ${st.pipelineName}${st.isWin ? " [ETAPA DE GANHO]" : ""}): ` +
            `Ativas/Movimentadas na Semana = ${st.weekCount} deals (${formatBrl(st.weekValue)}) | ` +
            `Em Aberto Agora = ${st.openCount} deals (${formatBrl(st.openValue)}) | ` +
            `No Mês = ${st.monthCount} deals (${formatBrl(st.monthValue)})`
        );
      }
    } else {
      funnelLines.push(`  - Nenhuma etapa cadastrada no CRM.`);
    }

    // Também consolida o funil macro (Triagem SDR 7d -> Qualificados 7d -> Deals Semana -> Ganhos Semana)
    funnelLines.push(
      `• 🔄 FUNIL PONTA A PONTA DA SEMANA (Marketing/SDR -> CRM -> Fechamento):`,
      `  1. Leads Recebidos no SDR (Últimos 7d): ${sdr7d.total}`,
      `  2. Leads Qualificados/Transferidos pelo SDR (Últimos 7d): ${sdr7d.qualifiedTransferred} (${sdr7d.conversionRateTotalPct}%)`,
      `  3. Negociações em Andamento/Criadas no CRM na Semana: ${Math.max(createdWeekCount, openPipelineCount)} (${formatBrl(openPipelineValue)} em aberto)`,
      `  4. Vendas Ganhas/Fechadas na Semana: ${wonWeekCount} (${formatBrl(wonWeekValue)})`
    );

    sections.push(`📈 5. FUNIL DE VENDAS (DESTA SEMANA, MÊS E PIPELINE GERAL):\n${funnelLines.join("\n")}`);

    // 5.2 Relatório Detalhado por Vendedor
    const sellerRowsSorted = Array.from(sellerReportMap.values())
      .filter(
        (s) =>
          s.operatorId !== "unassigned" ||
          s.openDealsCount > 0 ||
          s.wonMonthCount > 0
      )
      .sort((a, b) => {
        if (b.wonMonthValue !== a.wonMonthValue) return b.wonMonthValue - a.wonMonthValue;
        if (b.openDealsValue !== a.openDealsValue) return b.openDealsValue - a.openDealsValue;
        return b.monthGoal - a.monthGoal;
      });

    const sellerReportLines: string[] = [
      `• 🎯 PANORAMA DE META & PACING DA EMPRESA (${currentMonth}):`,
      `  - Meta Mensal Global: ${formatBrl(companyMonthGoal)}`,
      `  - Realizado no Mês (Ganho): ${formatBrl(wonMonthValue)} em ${wonMonthCount} venda(s) (${pacing.attainmentPct}% da meta)`,
      `  - Pacing de Dias Úteis: Dia útil ${pacing.elapsedBusinessDays} de ${pacing.totalBusinessDays} (${pacing.remainingBusinessDays} dias úteis restantes)`,
      `  - Deveria estar hoje (Pacing Ideal): ${formatBrl(pacing.expectedToDate)} (${pacing.expectedPct}%) | Status do Ritmo: ${pacing.pacingStatus.toUpperCase()}`,
      `  - Meta Diária Necessária nos dias restantes: ${formatBrl(pacing.requiredDailyRate)}/dia útil`,
      `  - Perdidos no Mês: ${lostMonthCount} deal(s) (${formatBrl(lostMonthValue)})`,
      `• 👥 TABELA DETALHADA POR VENDEDOR / CONSULTOR (Dados completos para ReportBlock / ChartBlock):`,
    ];

    for (const s of sellerRowsSorted) {
      const bneck = bottleneckByOp.get(s.operatorId);
      const tr = transferByOpMap.get(s.operatorId);
      const live = liveReplyByOp.get(s.operatorId);
      const goalPct = s.monthGoal > 0 ? roundPercent((s.wonMonthValue / s.monthGoal) * 100) : 0;
      const sellerTmaSec =
        live?.avgSec7d ?? (tr && tr.count > 0 ? tr.totalSec / tr.count : null);

      sellerReportLines.push(
        `  • ${s.operatorName} [Divisão: ${s.division.toUpperCase()}]:\n` +
          `    - Meta Mês: ${formatBrl(s.monthGoal)} | Realizado Mês: ${formatBrl(s.wonMonthValue)} (${s.wonMonthCount} venda(s), ${goalPct}% da meta) | Ganho na Semana: ${formatBrl(s.wonWeekValue)} (${s.wonWeekCount})\n` +
          `    - Pipeline Aberto: ${s.openDealsCount} deal(s) (${formatBrl(s.openDealsValue)}) | Parados >=3 dias: ${s.stalledDealsCount} deal(s) (${formatBrl(s.stalledDealsValue)}) | Perdidos Mês: ${s.lostMonthCount} (${formatBrl(s.lostMonthValue)})\n` +
          `    - Fila WhatsApp Agora: ${bneck?.activeChatsCount ?? 0} conversa(s) ativa(s), ${bneck?.waitingClientReplyCount ?? 0} cliente(s) aguardando resposta (${bneck?.waitingOver15mCount ?? 0} >15m SLA), TMA: ${formatDurationSeconds(sellerTmaSec)}\n` +
          `    - Pendências: ${s.pendingTasksCount} tarefa(s) CRM pendente(s) | ${s.pendingDirectivesCount} diretriz(es) da diretoria pendente(s)`
      );
    }

    topOpenDealsList.sort((a, b) => b.value - a.value);
    stalledDealsList.sort((a, b) => b.value - a.value);

    if (topOpenDealsList.length > 0) {
      sellerReportLines.push(
        `• 💰 TOP 8 MAIORES NEGOCIAÇÕES EM ABERTO NO PIPELINE:`,
        ...topOpenDealsList
          .slice(0, 8)
          .map(
            (d, i) =>
              `  ${i + 1}. "${d.title}" (${d.accountName}) — Valor: ${formatBrl(d.value)} | Etapa: ${d.stageName} | Vendedor: ${d.operatorName}`
          )
      );
    }

    if (stalledDealsList.length > 0) {
      sellerReportLines.push(
        `• 🧊 TOP 8 NEGOCIAÇÕES PARADAS / ESFRIANDO (>= 3 DIAS SEM INTERAÇÃO):`,
        ...stalledDealsList
          .slice(0, 8)
          .map(
            (d, i) =>
              `  ${i + 1}. "${d.title}" (${d.accountName}) — Valor: ${formatBrl(d.value)} | Parada há ${d.daysStalled} dias na etapa "${d.stageName}" | Vendedor: ${d.operatorName}`
          )
      );
    }

    if (recentWonDealsList.length > 0) {
      sellerReportLines.push(
        `• 🏅 ÚLTIMAS VENDAS GANHAS / FECHADAS:`,
        ...recentWonDealsList
          .slice(0, 8)
          .map(
            (w) =>
              `  - [${w.day}] "${w.title}" (${w.accountName}) — ${formatBrl(w.value)} | Vendedor: ${w.operatorName}`
          )
      );
    }

    sections.push(
      `🏆 6. RELATÓRIO DETALHADO POR VENDEDOR E DESEMPENHO COMERCIAL:\n${sellerReportLines.join("\n")}`
    );

    // ══════════════════════════════════════════════════════════════════════════
    // SEÇÃO 7: OBJEÇÕES DOS LEADS, MOTIVOS DE PERDA E AUDITORIA DE CONVERSAS
    // (Responde: "Quais objeções mais aparecem nas conversas dos leads?")
    // ══════════════════════════════════════════════════════════════════════════
    // Categoriza objeções/dúvidas reais nas últimas 120 mensagens de clientes + dados de triagem
    const objectionBuckets: Array<{
      label: string;
      regex: RegExp;
      count: number;
      examples: Array<{ client: string; operator: string; text: string }>;
    }> = [
      {
        label: "Preço, Valor de Orçamento e Pedido de Desconto",
        regex: /\b(preco|preço|valor|orcamento|orçamento|caro|desconto|custo|quanto\s+custa|cotacao|cotação|mais\s+barato|concorrente)\b/i,
        count: 0,
        examples: [],
      },
      {
        label: "Especificação Técnica, Modelo, Produtividade e Compatibilidade",
        regex: /\b(modelo|especificacao|especificação|inox|voltagem|220v|110v|380v|capacidade|velocidade|producao|produção|tamanho|medida|embalagem|sache|sachê|pote|frasco|valvula|válvula|seladora|envasadora|datador|dosadora|rotuladora|vacuo|vácuo)\b/i,
        count: 0,
        examples: [],
      },
      {
        label: "Prazo de Entrega, Pronta Entrega, Estoque e Frete",
        regex: /\b(prazo|entrega|frete|estoque|pronta\s+entrega|transportadora|envio|demora|dias\s+uteis|chega|rastreio)\b/i,
        count: 0,
        examples: [],
      },
      {
        label: "Condições de Pagamento, Boleto, Financiamento e Parcelamento",
        regex: /\b(pagamento|boleto|parcela|parcelamento|cartao|cartão|faturado|faturamento|entrada|financiamento|bndes|pix|prazo\s+de\s+pagamento)\b/i,
        count: 0,
        examples: [],
      },
      {
        label: "Garantia, Assistência Técnica, Peças de Reposição e Suporte",
        regex: /\b(garantia|assistencia|assistência|manutencao|manutenção|peca|peça|reposicao|reposição|defeito|suporte|tecnico|técnico)\b/i,
        count: 0,
        examples: [],
      },
    ];

    for (const msg of recentClientMessages) {
      const text = String(msg.content || "").trim();
      for (const bucket of objectionBuckets) {
        if (bucket.regex.test(text)) {
          bucket.count += 1;
          if (bucket.examples.length < 3) {
            bucket.examples.push({
              client: msg.contact_name || "Lead",
              operator: msg.operator_name || "Atendimento",
              text: text.slice(0, 140),
            });
          }
        }
      }
    }

    objectionBuckets.sort((a, b) => b.count - a.count);
    const totalObjectionHits = objectionBuckets.reduce((s, b) => s + b.count, 0);

    const lossCategoriesSorted = Array.from(lossCategoryMap.values()).sort(
      (a, b) => b.monthCount - a.monthCount || b.count - a.count
    );
    const lossSubReasonsSorted = Array.from(lossSubReasonMap.values()).sort(
      (a, b) => b.monthCount - a.monthCount || b.count - a.count
    );

    const objectionsLines: string[] = [
      `• 💬 RANKING DE OBJEÇÕES E DÚVIDAS CRÍTICAS NAS CONVERSAS DE WHATSAPP DOS LEADS (Amostra recente de ${recentClientMessages.length} mensagens de clientes):`,
    ];

    for (const b of objectionBuckets) {
      const pct = totalObjectionHits > 0 ? roundPercent((b.count / totalObjectionHits) * 100) : 0;
      const exText =
        b.examples.length > 0
          ? ` | Exemplos reais: ${b.examples.map((e) => `${e.client}: "${e.text}"`).join(" ; ")}`
          : "";
      objectionsLines.push(`  - ${b.label}: ${b.count} ocorrências (${pct}% das objeções mapeadas)${exText}`);
    }

    if (lossCategoriesSorted.length > 0) {
      objectionsLines.push(
        `• 📉 MACRO-CATEGORIAS DE OBJEÇÕES / MOTIVOS DE PERDA NO CRM (No Mês ${currentMonth} vs. Histórico Geral):`
      );
      for (const lc of lossCategoriesSorted) {
        objectionsLines.push(
          `  - ${lc.label}: No Mês = ${lc.monthCount} perdas (${formatBrl(lc.monthValue)}) | Histórico = ${lc.count} perdas (${formatBrl(lc.value)})${
            lc.examples.length > 0 ? ` | Exemplos: ${lc.examples.join(" ; ")}` : ""
          }`
        );
      }
      objectionsLines.push(
        `• 🎯 TOP 12 OBJEÇÕES / MOTIVOS ESPECÍFICOS MAIS APONTADOS PELOS LEADS E VENDEDORES NO CRM:`
      );
      for (const sr of lossSubReasonsSorted.slice(0, 12)) {
        objectionsLines.push(
          `  - "${sr.reason}" [${sr.category}]: No Mês = ${sr.monthCount} ocorrência(s) | Histórico = ${sr.count} ocorrência(s) (${formatBrl(sr.value)})`
        );
      }
    } else {
      objectionsLines.push(
        `• 📉 MOTIVOS DE PERDA NO CRM: Nenhuma negociação marcada com status 'lost' e justificativa preenchida no período atual.`
      );
    }

    if (audits.length > 0) {
      objectionsLines.push(
        `• 🔍 ÚLTIMAS AUDITORIAS DE QUALIDADE & OBJEÇÕES DETECTADAS PELA IA (${audits.length}):`,
        ...audits.slice(0, 6).map((a) => {
          const opName = a.operator_id ? opNameById.get(a.operator_id) || "Operador" : "Geral";
          return `  - Cliente: ${a.contact_name || "Lead"} | Consultor: ${opName} | Score QA: ${a.performance_score ?? "N/A"}/100 | Sentimento: ${a.client_sentiment || "neutro"} | Insight: ${(a.actionable_insight || "").slice(0, 140)}`;
        })
      );
    }

    sections.push(
      `🛑 7. OBJEÇÕES DOS LEADS NAS CONVERSAS E MOTIVOS DE PERDA:\n${objectionsLines.join("\n")}`
    );

    // ══════════════════════════════════════════════════════════════════════════
    // SEÇÃO 8: OS 5 PRINCIPAIS ALERTAS DA OPERAÇÃO HOJE (CONSOLIDAÇÃO EXECUTIVA)
    // (Responde: "Quais são os 5 principais alertas da operação hoje?")
    // ══════════════════════════════════════════════════════════════════════════
    const top5Alerts: string[] = [];

    // Alerta 1: Gargalo de fila e SLA ao vivo
    const topBottleneckOp = bottleneckRanking[0];
    if (totalWaitingReplyNow > 0 && topBottleneckOp) {
      top5Alerts.push(
        `1. 🚨 [FILA & SLA DE ATENDIMENTO] Há ${totalWaitingReplyNow} cliente(s) aguardando resposta agora (${totalOver15mNow} com SLA estourado >15 min). O maior gargalo está com ${topBottleneckOp.operatorName} (${topBottleneckOp.waitingClientReplyCount} clientes esperando, ${topBottleneckOp.waitingOver15mCount} acima de 15m, espera máx de ${formatDurationMinutes(topBottleneckOp.maxWaitMinutes)}).`
      );
    } else {
      top5Alerts.push(
        `1. ✅ [FILA & SLA DE ATENDIMENTO] Nenhum cliente com SLA estourado em tempo real agora (${slaAlertsFiredToday} alerta(s) de SLA disparados hoje; ${overdueLogsToday.length} registro(s) de atraso no dia).`
      );
    }

    // Alerta 2: Negociações paradas / esfriando no CRM
    if (stalledDealsList.length > 0) {
      const totalStalledVal = stalledDealsList.reduce((s, d) => s + d.value, 0);
      const topStalled = stalledDealsList[0];
      top5Alerts.push(
        `2. 🧊 [RECEITA EM RISCO - PIPELINE PARADO] Existem ${stalledDealsList.length} negociação(ões) em aberto sem interação há 3+ dias, travando ${formatBrl(totalStalledVal)} no funil. Destaque crítico: "${topStalled.title}" (${topStalled.accountName}, ${formatBrl(topStalled.value)}, parada há ${topStalled.daysStalled} dias com ${topStalled.operatorName}).`
      );
    } else {
      top5Alerts.push(
        `2. 📊 [PIPELINE COMERCIAL] ${openPipelineCount} negociação(ões) ativa(s) somando ${formatBrl(openPipelineValue)} sem negócios críticos travados há mais de 3 dias.`
      );
    }

    // Alerta 3: Pacing de Meta Comercial do Mês
    if (companyMonthGoal > 0) {
      top5Alerts.push(
        `3. 🎯 [RITMO DE META COMERCIAL (${currentMonth})] Realizado de ${formatBrl(wonMonthValue)} (${pacing.attainmentPct}%) frente à meta de ${formatBrl(companyMonthGoal)}. Pacing esperado até hoje: ${formatBrl(pacing.expectedToDate)} (${pacing.expectedPct}%). Status: ${pacing.pacingStatus.toUpperCase()} — exige ${formatBrl(pacing.requiredDailyRate)}/dia útil nos ${pacing.remainingBusinessDays} dias úteis restantes.`
      );
    } else {
      top5Alerts.push(
        `3. 🎯 [RESULTADO COMERCIAL (${currentMonth})] ${wonMonthCount} venda(s) ganha(s) no mês totalizando ${formatBrl(wonMonthValue)} e ${formatBrl(openPipelineValue)} em negociações abertas.`
      );
    }

    // Alerta 4: Conversão do SDR / Triagem e Leads sem Resposta
    top5Alerts.push(
      `4. 🤖 [TRIAGEM SDR & RETENÇÃO DE LEADS] Hoje: ${sdrToday.total} lead(s) atendidos (${sdrToday.qualifiedTransferred} qualificados = ${sdrToday.conversionRateTotalPct}%). Nos últimos 7 dias: ${sdr7d.total} leads com ${sdr7d.qualifiedTransferred} qualificados (${sdr7d.conversionRateTotalPct}%) e ${sdr7d.noResponse} lead(s) sem resposta/abandonados que precisam de repescagem.`
    );

    // Alerta 5: Tarefas / Diretrizes da Diretoria pendentes ou Conversas sem Operador
    const pendingDirectivesTotal = directives.filter((d) => d.status === "pending").length;
    if (unassignedFilaChats.length > 0 || pendingDirectivesTotal > 0 || pendingActivities.length > 0) {
      top5Alerts.push(
        `5. 📌 [EXECUÇÃO OPERACIONAL & PENDÊNCIAS] ${unassignedFilaChats.length} conversa(s) aguardando na fila geral sem operador, ${pendingDirectivesTotal} diretriz(es) da diretoria pendente(s) de execução e ${pendingActivities.length} atividade(s)/follow-up(s) pendentes no CRM.`
      );
    } else {
      top5Alerts.push(
        `5. 📌 [SOBRECARGA E ESCALA] ${overloadAlerts7d} alerta(s) de sobrecarga registrados nos últimos 7 dias; ${rodizioOps.filter((r) => r.isParticipating && !r.isOnLeave).length} consultor(es) ativos na escala do rodízio agora.`
      );
    }

    sections.push(
      `🔥 8. TOP 5 PRINCIPAIS ALERTAS DA OPERAÇÃO HOJE (SÍNTESE EXECUTIVA):\n${top5Alerts.join("\n")}`
    );

    // ══════════════════════════════════════════════════════════════════════════
    // SEÇÃO 9: ESCALA DO RODÍZIO, DIRETRIZES E CUSTOS DE IA
    // ══════════════════════════════════════════════════════════════════════════
    const activeRodizio = rodizioOps.filter((r) => r.isParticipating && !r.isOnLeave);
    const pausedRodizio = rodizioOps.filter((r) => !r.isParticipating || r.isOnLeave);
    const rodizioLines: string[] = [
      `• Consultores Ativos Recebendo Leads no Rodízio (${activeRodizio.length}): ` +
        (activeRodizio.length > 0
          ? activeRodizio
              .map(
                (r) =>
                  `${r.name} [Pasta: ${r.area || "geral"}, Funis: ${(r.funnels || []).join(",") || "todos"}, Saldo comp.: ${r.compensationBalance ?? 0}]`
              )
              .join(" | ")
          : "Nenhum"),
      pausedRodizio.length > 0
        ? `• Fora da Escala / Ausentes (${pausedRodizio.length}): ` +
          pausedRodizio
            .map((r) => `${r.name} (${r.isOnLeave ? "Ausente" : "Pausado"})`)
            .join(", ")
        : `• Todos os consultores cadastrados no rodízio estão ativos.`,
    ];

    const totalAiCost7d = aiCosts.reduce((s, c) => s + Number(c.cost_brl_7d || 0), 0);
    const totalAiCostToday = aiCosts.reduce((s, c) => s + Number(c.cost_brl_today || 0), 0);
    const aiCostLine =
      aiCosts.length > 0
        ? `• Telemetria Vertex AI: Custo Hoje = ${formatBrl(totalAiCostToday)} | Custo Últimos 7d = ${formatBrl(totalAiCost7d)} (${aiCosts
            .map((c) => `${c.feature}: ${c.calls_7d} chamadas / ${formatBrl(c.cost_brl_7d)}`)
            .join(", ")}).`
        : `• Telemetria Vertex AI: Sem registros de custo nos últimos 7 dias.`;

    sections.push(
      `🔄 9. ESCALA DO RODÍZIO E TELEMETRIA DE IA:\n${rodizioLines.join("\n")}\n${aiCostLine}`
    );

    // ══════════════════════════════════════════════════════════════════════════
    // SEÇÃO 10: BUSCA PROFUNDA SOB DEMANDA (QUANDO O GESTOR CITA NOME, EMPRESA, CNPJ OU PRODUTO)
    // ══════════════════════════════════════════════════════════════════════════
    const searchTerms = extractDirectorSearchTerms(userQuery);
    if (searchTerms.length > 0) {
      const patterns = searchTerms.map((t) => `%${t}%`);
      const [matchedConvsRes, matchedDealsRes, matchedAccountsRes] = await Promise.allSettled([
        sqlClient`
          SELECT
            c.id,
            c.queue_state,
            ct.name AS contact_name,
            ct.phone AS contact_phone,
            acc.name AS company_name,
            acc.document AS company_cnpj,
            op.name AS operator_name,
            c.last_message_text,
            c.updated_at
          FROM conversations c
          INNER JOIN contacts ct ON ct.id = c.contact_id
          LEFT JOIN crm_accounts acc ON acc.id = ct.account_id
          LEFT JOIN operators op ON op.id = c.operator_id
          WHERE c.tenant_id = ${tenantId}
            AND (
              ct.name ILIKE ANY(${patterns})
              OR ct.phone ILIKE ANY(${patterns})
              OR COALESCE(acc.name, '') ILIKE ANY(${patterns})
              OR COALESCE(acc.document, '') ILIKE ANY(${patterns})
              OR COALESCE(c.last_message_text, '') ILIKE ANY(${patterns})
              OR COALESCE(op.name, '') ILIKE ANY(${patterns})
            )
          ORDER BY c.updated_at DESC
          LIMIT 6
        `,
        sqlClient`
          SELECT
            d.id,
            d.title,
            d.value,
            d.status,
            d.loss_reason,
            s.name AS stage_name,
            op.name AS operator_name,
            acc.name AS account_name,
            acc.document AS account_cnpj,
            d.updated_at
          FROM crm_deals d
          LEFT JOIN crm_stages s ON s.id = d.stage_id
          LEFT JOIN operators op ON op.id = d.operator_id
          LEFT JOIN crm_accounts acc ON acc.id = d.account_id
          WHERE d.tenant_id = ${tenantId}
            AND (
              d.title ILIKE ANY(${patterns})
              OR COALESCE(acc.name, '') ILIKE ANY(${patterns})
              OR COALESCE(acc.document, '') ILIKE ANY(${patterns})
              OR COALESCE(op.name, '') ILIKE ANY(${patterns})
            )
          ORDER BY d.updated_at DESC
          LIMIT 8
        `,
        sqlClient`
          SELECT name, document AS cnpj, phone, email, segment, address
          FROM crm_accounts
          WHERE tenant_id = ${tenantId}
            AND (
              name ILIKE ANY(${patterns})
              OR COALESCE(document, '') ILIKE ANY(${patterns})
            )
          LIMIT 6
        `,
      ]);

      const matchedConvs: any[] =
        matchedConvsRes.status === "fulfilled" ? [...matchedConvsRes.value] : [];
      const matchedDeals: any[] =
        matchedDealsRes.status === "fulfilled" ? [...matchedDealsRes.value] : [];
      const matchedAccounts: any[] =
        matchedAccountsRes.status === "fulfilled" ? [...matchedAccountsRes.value] : [];

      const drillLines: string[] = [];

      if (matchedConvs.length > 0) {
        drillLines.push(`• Conversas Encontradas para os termos [${searchTerms.join(", ")}]:`);
        for (const mc of matchedConvs.slice(0, 4)) {
          const msgsRows = await sqlClient`
            SELECT sender_type, sender_name, content, sent_at
            FROM messages
            WHERE conversation_id = ${mc.id}
            ORDER BY sent_at DESC
            LIMIT 8
          `;
          const transcript = [...msgsRows]
            .reverse()
            .map(
              (m: any) =>
                `[${m.sender_type === "client" ? "Lead" : m.sender_name || "Agente"}]: ${(m.content || "").slice(0, 140)}`
            )
            .join(" | ");
          drillLines.push(
            `  - Conversa ${mc.contact_name} (${mc.contact_phone || "s/ tel"}${mc.company_name ? ` | Empresa: ${mc.company_name}` : ""}) | Estado: ${mc.queue_state} | Consultor: ${mc.operator_name || "IA/Fila"}\n    Últimas mensagens: ${transcript || mc.last_message_text || "Sem texto"}`
          );
        }
      }

      if (matchedDeals.length > 0) {
        drillLines.push(`• Negociações CRM Encontradas:`);
        for (const md of matchedDeals) {
          drillLines.push(
            `  - Deal "${md.title}" | Conta: ${md.account_name || "N/I"} (${md.account_cnpj || "s/ CNPJ"}) | Valor: ${formatBrl(Number(md.value || 0))} | Status: ${md.status} (Etapa: ${md.stage_name || "N/I"}) | Vendedor: ${md.operator_name || "N/I"}`
          );
        }
      }

      if (matchedAccounts.length > 0) {
        drillLines.push(`• Empresas (Contas CRM) Encontradas:`);
        for (const ma of matchedAccounts) {
          const addr = (ma.address || {}) as Record<string, any>;
          drillLines.push(
            `  - ${ma.name} | CNPJ: ${ma.cnpj || "N/I"} | Tel: ${ma.phone || "N/I"} | Cidade/UF: ${addr.city || "-"}/${addr.state || "-"}`
          );
        }
      }

      if (drillLines.length > 0) {
        sections.push(
          `🔎 10. BUSCA PROFUNDA ESPECÍFICA PARA A PERGUNTA DO GESTOR:\n${drillLines.join("\n")}`
        );
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SEÇÃO 11: BASE DE CONHECIMENTO / CATÁLOGO (QUANDO SOLICITADO OU RELEVANTE)
    // ══════════════════════════════════════════════════════════════════════════
    const asksProductOrCatalog =
      /\b(maquina|máquina|equipamento|catalogo|catálogo|modelo|seladora|envasadora|datador|dosadora|rotuladora|valvula|válvula|pote|frasco|gatilho|trigger|base\s+de\s+conhecimento|especificacao|especificação|ficha\s+tecnica)\b/i.test(
        userQuery || ""
      );

    if (asksProductOrCatalog) {
      const targetBases =
        knowledgeBase === "all"
          ? ["tecfag", "valem"]
          : [knowledgeBase === "valem" || knowledgeBase === "tecfag" ? knowledgeBase : tenantId];
      const kbParts: string[] = [];
      for (const b of targetBases) {
        const kb = await getKnowledgeBaseContext(b, userQuery);
        if (kb) kbParts.push(kb.slice(0, 6000));
      }
      if (kbParts.length > 0) {
        sections.push(`📚 11. CATÁLOGO E BASE DE CONHECIMENTO:\n${kbParts.join("\n\n")}`);
      }
    }

    return sections.join("\n\n");
  } catch (err: any) {
    console.error("[getDirectorBiContext] Erro ao compilar contexto executivo:", err);
    return `⚠️ Erro parcial ao compilar métricas da operação: ${err?.message || "erro desconhecido"}`;
  }
}
