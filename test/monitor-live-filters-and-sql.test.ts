import { describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { messages } from "../src/db/schema";
import {
  computeLiveSummary,
  filterLiveDataset,
  matchesLivePipeline,
  matchesLiveSector,
} from "../src/lib/monitor/live-filters";
import type { LiveConversation, LiveData, LiveOperator } from "../src/lib/monitor-mock-data";

function makeConv(overrides: Partial<LiveConversation> = {}): LiveConversation {
  return {
    id: overrides.id ?? "conv-1",
    contactName: overrides.contactName ?? "Cliente Teste",
    contactPhone: overrides.contactPhone ?? "5511999990000",
    queueState: overrides.queueState ?? "meus",
    sectorId: overrides.sectorId ?? null,
    sectorName: overrides.sectorName ?? null,
    lastMessage: overrides.lastMessage ?? "Olá",
    lastMessageTime: overrides.lastMessageTime ?? "2026-11-24T14:00:00.000Z",
    waitingMinutes: overrides.waitingMinutes ?? 0,
    isUnanswered: overrides.isUnanswered ?? false,
    hasRealInteraction: overrides.hasRealInteraction ?? true,
    isActiveToday: overrides.isActiveToday ?? true,
    activityCategory: overrides.activityCategory ?? "active_today",
    metaWindowOpen: overrides.metaWindowOpen ?? true,
    metaWindowRemainingMinutes: overrides.metaWindowRemainingMinutes ?? 600,
    activeDeal: overrides.activeDeal ?? null,
    linkedPipelineIds: overrides.linkedPipelineIds ?? [],
    hasOpenDeal: overrides.hasOpenDeal ?? Boolean(overrides.activeDeal?.status === "open"),
    openTasksCount: overrides.openTasksCount ?? 0,
    overdueTasksCount: overrides.overdueTasksCount ?? 0,
    failedMessagesCount: overrides.failedMessagesCount ?? 0,
    sentMessagesToday: overrides.sentMessagesToday ?? 0,
    responseDeltasMinutes: overrides.responseDeltasMinutes ?? [],
    operatorId: overrides.operatorId ?? null,
    operatorName: overrides.operatorName ?? null,
    messages: [],
  };
}

function makeOp(overrides: Partial<LiveOperator> = {}): LiveOperator {
  return {
    operatorId: overrides.operatorId ?? "op-1",
    operatorName: overrides.operatorName ?? "Operador 1",
    status: overrides.status ?? "disponivel",
    isOnline: overrides.isOnline ?? true,
    sectorIds: overrides.sectorIds ?? [],
    usageSecondsToday: overrides.usageSecondsToday ?? 3600,
    sentMessagesToday: overrides.sentMessagesToday ?? 0,
    avgResponseMinutesToday: overrides.avgResponseMinutesToday ?? null,
    conversations: overrides.conversations ?? [],
  };
}

describe("Monitoramento Ao Vivo — Filtros Estritos (Operador, Setor, Funil e Busca)", () => {
  const SEC_POS_VENDA = "sec-pos-venda";
  const SEC_ADMIN = "sec-admin";
  const PIPE_SUPORTE = "pipe-suporte";
  const PIPE_MAQUINAS = "pipe-maquinas";
  const OP_LUCIMARA = "op-lucimara";
  const OP_VINICIUS = "op-vinicius";

  const sampleLiveData: LiveData = {
    sectors: [
      { id: SEC_POS_VENDA, name: "Pós venda", operatorIds: [OP_LUCIMARA], count: 3 },
      { id: SEC_ADMIN, name: "Administradores", operatorIds: [OP_VINICIUS], count: 1 },
    ],
    pipelines: [
      { id: PIPE_SUPORTE, name: "FUNIL SUPORTE TÉCNICO", count: 2, totalValue: 15000 },
      { id: PIPE_MAQUINAS, name: "FUNIL MÁQUINAS", count: 3, totalValue: 850000 },
    ],
    operators: [
      makeOp({
        operatorId: OP_LUCIMARA,
        operatorName: "Lucimara Dal Mora",
        isOnline: true,
        sectorIds: [SEC_POS_VENDA],
        sentMessagesToday: 44,
        conversations: [
          makeConv({
            id: "conv-luc-sup-1",
            contactName: "Natalia Teixeira",
            operatorId: OP_LUCIMARA,
            operatorName: "Lucimara Dal Mora",
            sectorId: SEC_POS_VENDA,
            sectorName: "Pós venda",
            isUnanswered: true,
            waitingMinutes: 45,
            sentMessagesToday: 10,
            responseDeltasMinutes: [8, 12],
            activeDeal: {
              id: "deal-1",
              title: "Pós-venda Natalia",
              value: 5000,
              status: "open",
              pipelineId: PIPE_SUPORTE,
              pipelineName: "FUNIL SUPORTE TÉCNICO",
              stageName: "SUPORTE",
              operatorId: OP_LUCIMARA,
              operatorName: "Lucimara Dal Mora",
            },
            linkedPipelineIds: [PIPE_SUPORTE],
          }),
          makeConv({
            id: "conv-luc-maq-2",
            contactName: "Gustavo Ramos",
            operatorId: OP_LUCIMARA,
            operatorName: "Lucimara Dal Mora",
            sectorId: SEC_POS_VENDA,
            sectorName: "Pós venda",
            isUnanswered: false,
            waitingMinutes: 0,
            sentMessagesToday: 34,
            responseDeltasMinutes: [4],
            activeDeal: {
              id: "deal-2",
              title: "PEDRO GUSTAVO RAMOS NUNES",
              value: 40000,
              status: "open",
              pipelineId: PIPE_MAQUINAS,
              pipelineName: "FUNIL MÁQUINAS",
              stageName: "NEGOCIAÇÃO",
              operatorId: OP_VINICIUS,
              operatorName: "Vinicius",
            },
            linkedPipelineIds: [PIPE_MAQUINAS],
          }),
          makeConv({
            id: "conv-luc-no-sec",
            contactName: "Elisa Tiengo Comper",
            operatorId: OP_LUCIMARA,
            operatorName: "Lucimara Dal Mora",
            sectorId: null, // fallback pelo setor do operador (Pós venda)
            isUnanswered: true,
            waitingMinutes: 12,
            activeDeal: {
              id: "deal-3",
              title: "Pós Vendas Elisa",
              value: 0,
              status: "won", // ganho (não aberto!)
              pipelineId: PIPE_SUPORTE,
              pipelineName: "FUNIL SUPORTE TÉCNICO",
              stageName: "FINALIZADO",
              operatorId: OP_LUCIMARA,
              operatorName: "Lucimara Dal Mora",
            },
            hasOpenDeal: false,
            linkedPipelineIds: [PIPE_SUPORTE],
          }),
        ],
      }),
      makeOp({
        operatorId: OP_VINICIUS,
        operatorName: "Vinicius",
        isOnline: true,
        sectorIds: [SEC_ADMIN],
        sentMessagesToday: 80,
        conversations: [
          makeConv({
            id: "conv-vini-1",
            contactName: "Dirquens Francisco",
            operatorId: OP_VINICIUS,
            operatorName: "Vinicius",
            sectorId: SEC_ADMIN,
            sectorName: "Administradores",
            isUnanswered: true,
            waitingMinutes: 120,
            sentMessagesToday: 80,
            responseDeltasMinutes: [20],
            activeDeal: {
              id: "deal-vini",
              title: "Máquina Black Dirquens",
              value: 300000,
              status: "open",
              pipelineId: PIPE_MAQUINAS,
              pipelineName: "FUNIL MÁQUINAS",
              stageName: "CONTATANDO",
              operatorId: OP_VINICIUS,
              operatorName: "Vinicius",
            },
            linkedPipelineIds: [PIPE_MAQUINAS],
          }),
        ],
      }),
    ],
    unassigned: [
      makeConv({
        id: "conv-queue-1",
        contactName: "Giovanni TESTE",
        queueState: "fila",
        operatorId: null,
        sectorId: SEC_ADMIN,
        isUnanswered: true,
        waitingMinutes: 15800,
        activeDeal: {
          id: "deal-q1",
          title: "Teste Prospecção",
          value: 500000,
          status: "open",
          pipelineId: PIPE_MAQUINAS,
          pipelineName: "FUNIL MÁQUINAS",
          stageName: "PROSPECÇÃO REMOTA",
        },
        linkedPipelineIds: [PIPE_MAQUINAS],
      }),
    ],
    automation: [
      makeConv({
        id: "conv-auto-1",
        contactName: "Lead Triagem Fagner",
        queueState: "automacao",
        operatorId: null,
        sectorId: SEC_ADMIN,
        isUnanswered: false,
        failedMessagesCount: 2,
        activeDeal: {
          id: "deal-a1",
          title: "Card Triagem",
          value: 200000,
          status: "open",
          pipelineId: PIPE_MAQUINAS,
          pipelineName: "FUNIL MÁQUINAS",
          stageName: "CONTATANDO",
        },
        linkedPipelineIds: [PIPE_MAQUINAS],
      }),
    ],
  };

  it("elimina vazamento de fila/automação/outros funis quando Lucimara + FUNIL SUPORTE TÉCNICO estão selecionados", () => {
    const res = filterLiveDataset(sampleLiveData, {
      opIdFilter: OP_LUCIMARA,
      pipelineFilter: PIPE_SUPORTE,
    });

    // Apenas Lucimara em Equipe & Produtividade Hoje
    expect(res.operators.map((o) => o.operatorId)).toEqual([OP_LUCIMARA]);
    // Zero fila sem consultor e zero Triagem IA vazando no Radar Executivo
    expect(res.unassigned).toHaveLength(0);
    expect(res.automation).toHaveLength(0);

    // Apenas as 2 conversas de Lucimara no FUNIL SUPORTE TÉCNICO (exclui Gustavo Ramos de Máquinas e Dirquens de Vinícius)
    const luc = res.operators[0];
    expect(luc.conversations.map((c) => c.id)).toEqual(["conv-luc-sup-1", "conv-luc-no-sec"]);

    // Métricas recalculadas estritamente sobre o recorte
    expect(luc.waitingReplyCount).toBe(2);
    expect(luc.criticalWaitCount).toBe(1);
    expect(luc.sentMessagesToday).toBe(10);
    expect(luc.avgResponseMinutesToday).toBe(10); // média(8, 12)

    // Summary executivo sem os 15.800 min da fila nem os R$ 700k da fila/IA/Vinícius
    expect(res.summary.waitingReplyCount).toBe(2);
    expect(res.summary.unassignedQueueCount).toBe(0);
    expect(res.summary.automationCount).toBe(0);
    expect(res.summary.maxWaitMinutes).toBe(45);
    expect(res.summary.openDealsInLiveCount).toBe(1); // apenas deal-1 aberto (deal-3 é won)
    expect(res.summary.activePipelineValue).toBe(5000);
    expect(res.summary.totalSentMessagesToday).toBe(10);
    expect(res.summary.failedDeliveriesCount).toBe(0);
  });

  it("filtra estritamente por Setor (Pós venda) sem vazar Vinícius, Fila de outro setor ou Triagem de outro setor", () => {
    const res = filterLiveDataset(sampleLiveData, {
      sectorIdFilter: SEC_POS_VENDA,
    });

    expect(res.operators.map((o) => o.operatorId)).toEqual([OP_LUCIMARA]);
    expect(res.unassigned).toHaveLength(0);
    expect(res.automation).toHaveLength(0);
    // Inclui conversa sem sectorId explícito cujo operador (Lucimara) pertence ao setor Pós venda
    expect(res.operators[0].conversations.map((c) => c.id)).toEqual([
      "conv-luc-sup-1",
      "conv-luc-maq-2",
      "conv-luc-no-sec",
    ]);
    // Nunca vaza cliente do Vinícius
    expect(
      res.operators.flatMap((o) => o.conversations).some((c) => c.id === "conv-vini-1")
    ).toBe(false);
  });

  it("preserva distinção entre dono do chat (Lucimara) e dono do card CRM (Vinícius) sem duplicar em Vinícius", () => {
    const resVini = filterLiveDataset(sampleLiveData, {
      opIdFilter: OP_VINICIUS,
    });
    expect(resVini.operators.map((o) => o.operatorId)).toEqual([OP_VINICIUS]);
    expect(resVini.operators[0].conversations.map((c) => c.id)).toEqual(["conv-vini-1"]);

    const resLuc = filterLiveDataset(sampleLiveData, {
      opIdFilter: OP_LUCIMARA,
      pipelineFilter: PIPE_MAQUINAS,
    });
    expect(resLuc.operators[0].conversations.map((c) => c.id)).toEqual(["conv-luc-maq-2"]);
    expect(resLuc.operators[0].conversations[0].activeDeal?.operatorName).toBe("Vinicius");
  });

  it("oculta operadores sem conversas no funil selecionado em Equipe & Produtividade Hoje", () => {
    const res = filterLiveDataset(sampleLiveData, {
      pipelineFilter: PIPE_SUPORTE,
    });
    // Vinícius não tem nenhuma conversa em FUNIL SUPORTE TÉCNICO — não deve poluir a lista!
    expect(res.operators.map((o) => o.operatorId)).toEqual([OP_LUCIMARA]);
    expect(res.summary.totalOperators).toBe(1);
  });

  it("filtro __with_deal__ considera exclusivamente negócios ABERTOS (ignora won/lost)", () => {
    const openConv = makeConv({
      activeDeal: { id: "d1", title: "Aberto", value: 100, status: "open", pipelineName: "P1", stageName: "E1" },
      hasOpenDeal: true,
    });
    const wonConv = makeConv({
      activeDeal: { id: "d2", title: "Ganho", value: 100, status: "won", pipelineName: "P1", stageName: "E1" },
      hasOpenDeal: false,
    });
    expect(matchesLivePipeline(openConv, "__with_deal__")).toBe(true);
    expect(matchesLivePipeline(wonConv, "__with_deal__")).toBe(false);
  });

  it("matchesLiveSector respeita sectorId explícito acima do setor do operador", () => {
    const posVendaOps = new Set([OP_LUCIMARA]);
    expect(
      matchesLiveSector(
        { sectorId: "sec-suporte", operatorId: OP_LUCIMARA },
        SEC_POS_VENDA,
        posVendaOps
      )
    ).toBe(false);
    expect(
      matchesLiveSector({ sectorId: null, operatorId: OP_LUCIMARA }, SEC_POS_VENDA, posVendaOps)
    ).toBe(true);
  });

  it("computeLiveSummary deduplica valor de deal compartilhado entre conversas", () => {
    const sharedDeal = {
      id: "deal-shared",
      title: "Shared",
      value: 12000,
      status: "open",
      pipelineId: PIPE_SUPORTE,
      pipelineName: "Suporte",
      stageName: "E1",
    };
    const op = makeOp({
      conversations: [
        makeConv({ id: "c1", activeDeal: sharedDeal }),
        makeConv({ id: "c2", activeDeal: sharedDeal }),
      ],
    });
    const summary = computeLiveSummary([op], [], []);
    expect(summary.openDealsInLiveCount).toBe(1);
    expect(summary.activePipelineValue).toBe(12000);
  });
});

describe("Monitoramento Ao Vivo — Validação Real da Query SQL Otimizada em PostgreSQL (PGlite)", () => {
  it("calcula 1 linha resumo por conversa com firstUnansweredClientSentAt, failedMessagesCount e isolamento multi-tenant", async () => {
    const pg = new PGlite();
    await pg.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        sender_type TEXT NOT NULL,
        content TEXT NOT NULL,
        sent_at TIMESTAMPTZ NOT NULL,
        is_internal_note BOOLEAN DEFAULT FALSE,
        status TEXT DEFAULT 'accepted'
      );

      INSERT INTO conversations (id, tenant_id) VALUES
        ('conv-tecfag-wait', 'tecfag'),
        ('conv-tecfag-replied', 'tecfag'),
        ('conv-tecfag-empty', 'tecfag'),
        ('conv-valem-isolated', 'valem');

      -- Conversa 1 (tecfag): agente respondeu 10:00, cliente mandou 10:05 e 10:10 + nota interna 10:12 + msg failed
      INSERT INTO messages (id, tenant_id, conversation_id, sender_type, content, sent_at, is_internal_note, status) VALUES
        ('m1', 'tecfag', 'conv-tecfag-wait', 'client', 'Oi inicial', '2026-11-24T10:00:00Z', false, 'accepted'),
        ('m2', 'tecfag', 'conv-tecfag-wait', 'agent', 'Olá, como ajudo?', '2026-11-24T10:01:00Z', false, 'failed'),
        ('m3', 'tecfag', 'conv-tecfag-wait', 'client', 'Preciso de suporte', '2026-11-24T10:05:00Z', false, 'accepted'),
        ('m4', 'tecfag', 'conv-tecfag-wait', 'client', 'Consegue me retornar?', '2026-11-24T10:10:00Z', false, 'accepted'),
        ('m5', 'tecfag', 'conv-tecfag-wait', 'agent', 'Nota interna supervisor', '2026-11-24T10:12:00Z', true, 'accepted');

      -- Conversa 2 (tecfag): cliente mandou 09:00, agente respondeu 09:05 -> não está aguardando
      INSERT INTO messages (id, tenant_id, conversation_id, sender_type, content, sent_at, is_internal_note, status) VALUES
        ('m6', 'tecfag', 'conv-tecfag-replied', 'client', 'Bom dia', '2026-11-24T09:00:00Z', false, 'accepted'),
        ('m7', 'tecfag', 'conv-tecfag-replied', 'agent', 'Bom dia! Resolvido.', '2026-11-24T09:05:00Z', false, 'delivered');

      -- Conversa 3 (valem): deve ser 100% isolada quando consultando tenant tecfag
      INSERT INTO messages (id, tenant_id, conversation_id, sender_type, content, sent_at, is_internal_note, status) VALUES
        ('m8', 'valem', 'conv-valem-isolated', 'client', 'Pedido válvula spray', '2026-11-24T11:00:00Z', false, 'accepted');
    `);

    const result = await pg.query<{
      conversationId: string;
      hasRealMsg: boolean;
      lastRealSenderType: string | null;
      lastRealContent: string | null;
      lastClientSentAt: string | null;
      firstUnansweredClientSentAt: string | null;
      failedMessagesCount: number;
    }>(
      `
      SELECT
        c.id AS "conversationId",
        s."hasRealMsg",
        s."lastRealSenderType",
        s."lastRealContent",
        s."lastRealSentAt",
        s."lastAnyContent",
        s."lastClientSentAt",
        s."firstUnansweredClientSentAt",
        s."failedMessagesCount"
      FROM conversations c
      CROSS JOIN LATERAL (
        WITH recent_raw AS (
          SELECT
            m.id,
            m.sender_type,
            m.content,
            m.sent_at,
            m.is_internal_note,
            m.status
          FROM messages m
          WHERE m.tenant_id = $1
            AND m.conversation_id = c.id
          ORDER BY m.sent_at DESC, m.id DESC
          LIMIT 35
        ),
        recent AS (
          SELECT
            r.id,
            r.sender_type,
            r.content,
            r.sent_at,
            r.is_internal_note,
            r.status,
            ROW_NUMBER() OVER (ORDER BY r.sent_at DESC, r.id DESC) AS rn_any,
            CASE
              WHEN NOT COALESCE(r.is_internal_note, false) AND r.sender_type <> 'system'
              THEN ROW_NUMBER() OVER (
                PARTITION BY (NOT COALESCE(r.is_internal_note, false) AND r.sender_type <> 'system')
                ORDER BY r.sent_at DESC, r.id DESC
              )
              ELSE NULL
            END AS rn_real
          FROM recent_raw r
        ),
        last_non_client AS (
          SELECT MIN(rn_real) AS non_client_rn
          FROM recent
          WHERE rn_real IS NOT NULL AND sender_type <> 'client'
        )
        SELECT
          (COUNT(*) FILTER (WHERE r.rn_real IS NOT NULL) > 0) AS "hasRealMsg",
          MAX(r.sender_type) FILTER (WHERE r.rn_real = 1) AS "lastRealSenderType",
          MAX(LEFT(r.content, 280)) FILTER (WHERE r.rn_real = 1) AS "lastRealContent",
          MAX(r.sent_at) FILTER (WHERE r.rn_real = 1) AS "lastRealSentAt",
          MAX(LEFT(r.content, 280)) FILTER (WHERE r.rn_any = 1) AS "lastAnyContent",
          MAX(r.sent_at) FILTER (WHERE r.rn_real IS NOT NULL AND r.sender_type = 'client') AS "lastClientSentAt",
          MIN(r.sent_at) FILTER (
            WHERE r.rn_real IS NOT NULL
              AND r.sender_type = 'client'
              AND (lnc.non_client_rn IS NULL OR r.rn_real < lnc.non_client_rn)
          ) AS "firstUnansweredClientSentAt",
          COUNT(*) FILTER (WHERE r.status = 'failed')::int AS "failedMessagesCount"
        FROM recent r
        CROSS JOIN last_non_client lnc
      ) s
      WHERE c.tenant_id = $1
        AND c.id IN ('conv-tecfag-wait', 'conv-tecfag-replied', 'conv-tecfag-empty', 'conv-valem-isolated')
      ORDER BY c.id
      `,
      ["tecfag"]
    );

    // Isolamento multi-tenant: apenas 3 conversas de tecfag retornadas (valem excluída!)
    expect(result.rows).toHaveLength(3);

    const emptyConv = result.rows.find((r) => r.conversationId === "conv-tecfag-empty")!;
    expect(emptyConv.hasRealMsg).toBe(false);
    expect(emptyConv.lastRealSenderType).toBeNull();
    expect(emptyConv.firstUnansweredClientSentAt).toBeNull();
    expect(emptyConv.failedMessagesCount).toBe(0);

    const replied = result.rows.find((r) => r.conversationId === "conv-tecfag-replied")!;
    expect(replied.hasRealMsg).toBe(true);
    expect(replied.lastRealSenderType).toBe("agent");
    expect(replied.lastRealContent).toBe("Bom dia! Resolvido.");
    expect(replied.firstUnansweredClientSentAt).toBeNull();
    expect(replied.failedMessagesCount).toBe(0);

    const waiting = result.rows.find((r) => r.conversationId === "conv-tecfag-wait")!;
    expect(waiting.hasRealMsg).toBe(true);
    // Nota interna não mascara a última mensagem real do cliente!
    expect(waiting.lastRealSenderType).toBe("client");
    expect(waiting.lastRealContent).toBe("Consegue me retornar?");
    // Primeira mensagem não respondida da sequência é 10:05 (não 10:00 nem 10:10!)
    expect(new Date(waiting.firstUnansweredClientSentAt!).toISOString()).toBe(
      "2026-11-24T10:05:00.000Z"
    );
    expect(new Date(waiting.lastClientSentAt!).toISOString()).toBe("2026-11-24T10:10:00.000Z");
    expect(waiting.failedMessagesCount).toBe(1);

    await pg.close();
  });

  it("serializa todayLookbackStart como string (nunca Date cru) nos parâmetros da query de produtividade (evita ERR_INVALID_ARG_TYPE no postgres-js)", () => {
    const dialect = new PgDialect();
    const todayLookbackStart = new Date("2026-11-23T23:00:00.000Z");
    const whereClause = and(
      eq(messages.tenantId, "tecfag"),
      inArray(messages.conversationId, ["conv-1", "conv-2"]),
      gte(messages.sentAt, todayLookbackStart),
      eq(messages.isInternalNote, false),
      inArray(messages.senderType, ["client", "agent"])
    );
    const compiled = dialect.sqlToQuery(whereClause!);
    // Garante que nenhum parâmetro é instância de Date (que quebra Bind() no postgres-js)
    expect(compiled.params.some((p) => p instanceof Date)).toBe(false);
    expect(compiled.params).toContain("2026-11-23T23:00:00.000Z");
  });
});
