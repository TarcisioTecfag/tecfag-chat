/**
 * Integração real, EXCLUSIVAMENTE em PostgreSQL de teste local explicitamente informado.
 * Executar com --no-env-file. Não importa motores/provedores nem executa migrations/seeds da operação.
 * TEST_DATABASE_URL=postgres://...@127.0.0.1:<porta>/...test bun --no-env-file test/industrial-handoff-postgres.test.ts
 */
import assert from "node:assert/strict";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { getTableName, is, SQL, sql, and, eq } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../src/db/schema";
import {
  createIndustrialHandoffStore,
  type HandoffOutbox,
} from "../src/lib/triage/industrial-handoff-store";
import {
  mutateIndustrialRodizio,
  mergeIndustrialOperatorSettings,
} from "../src/lib/triage/industrial-rodizio-store";
import {
  recoverIndustrialHandoffs,
  recoverIndustrialPostCommitOutbox,
} from "../src/lib/triage/industrial-handoff-recovery";
import { deliverIndustrialPostCommit } from "../src/lib/triage/industrial-post-commit-delivery";
import { projectIndustrialMonitoring } from "../src/lib/triage/industrial-monitor";
import { resolveIndustrialRoute } from "../src/lib/triage/industrial-policy";
import { captureSiteContext, type SiteContext } from "../src/lib/livechat/site-context";
import {
  readIndustrialSettings,
  saveIndustrialSettings,
} from "../src/lib/triage/industrial-settings-store";
import {
  emptyIndustrialSettings,
  industrialSettingsSchema,
} from "../src/lib/triage/industrial-settings";
import type { MachineDecision } from "../src/lib/triage/industrial-decisor";
import { applyMachineDecision } from "../src/lib/triage/industrial-decisor";
import { appendIndustrialJournal } from "../src/lib/triage/industrial-triage-journal-store";
import { buildJournalSnapshot } from "../src/lib/triage/industrial-triage-journal";
import { restartIndustrialCycle } from "../src/lib/triage/industrial-cycle-restart";
import { stopIndustrialCycle } from "../src/lib/triage/industrial-cycle-stop";
import {
  readIndustrialReview,
  saveIndustrialReview,
  IndustrialReviewError,
} from "../src/lib/triage/industrial-review-store";
import type { ReviewActor } from "../src/lib/triage/industrial-review-contract";
import { markIndustrialNoResponse } from "../src/lib/triage/industrial-silence-store";
import { historyPageInput } from "../src/lib/triage/triage-history-pagination";
import {
  HistoryNotFoundError,
  historyQueryScope,
  listHistoryConversations,
  listHistoryCycles,
  listHistoryEvents,
} from "../src/lib/triage/triage-history-store";
import {
  readAgentMonitoringSummary,
  readLatestSdrFlows,
} from "../src/lib/triage/agent-monitor-store";
import {
  reopenIndustrialSiteConversation,
  readSiteContinuationHistory,
} from "../src/lib/livechat/site-conversation-store";

// Validação antes de importar o helper CRM que possui a conexão padrão do aplicativo.
const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error("TEST_DATABASE_URL explícita é obrigatória; não há fallback para DATABASE_URL.");
const parsed = new URL(url);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
  !/test/.test(parsed.pathname) ||
  /prod|railway|valemchat$/.test(parsed.pathname)
)
  throw new Error("A suíte só aceita banco local com test no nome, fora dos bancos operacionais.");
process.env.NODE_ENV = "test";
process.env.IS_TEST = "true";
const { ensureLocalCrmDealBeforeTransfer } = await import("../src/lib/valentina/sdr-crm-local");
const { client: defaultClient } = await import("../src/db/index");
const client = postgres(url, { max: 12, prepare: false });
const testSchema = `triage_${crypto.randomUUID().replaceAll("-", "")}`;
// Pool inteiro usa o schema privado da execução, sem DROP/ALTER de tabelas existentes.
const scopedClient = postgres(url, {
  max: 12,
  prepare: false,
  connection: { search_path: testSchema },
});
const scopedDb = drizzle(scopedClient, { schema });
const dialect = new PgDialect();
const tables = [
  schema.tenants,
  schema.operators,
  schema.sectors,
  schema.crmAccounts,
  schema.contacts,
  schema.conversations,
  schema.agentConfigs,
  schema.agentFlowStates,
  schema.messages,
  schema.crmPipelines,
  schema.crmStages,
  schema.crmDeals,
  schema.crmDealContacts,
  schema.crmConversationDeals,
  schema.crmDealActivities,
  schema.crmDealEvents,
];
const q = (value: string) => `"${value.replaceAll('"', '""')}"`;
let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  passed++;
  console.log(`PASS ${name}`);
}
const store = createIndustrialHandoffStore(scopedDb, ensureLocalCrmDealBeforeTransfer);
let sequence = 0;
const tenantId = "industrial_fixture";
const otherTenant = "other_fixture";
const opA = "operator-a",
  opB = "operator-b",
  outsider = "operator-other";
const flowOperator = (id: string) => ({
  id,
  name: id,
  isParticipating: true,
  isOnLeave: false,
  isPenalized: false,
  area: "maquinas",
  funnels: ["Máquinas", "Atendimento Geral"],
  compensation: 0,
  leadsReceivedCount: 0,
  recentLeads: [],
});
const data = {
  "NOME COMPLETO": { value: "Pessoa de Teste", status: "filled" as const },
  "CNPJ OU CPF": { value: "52998224725", status: "filled" as const },
  "MÁQUINA / PEÇA / INTERESSE": { value: "Seladora", status: "filled" as const },
  "RAMO / O QUE EMBALA": { value: "Alimentos", status: "filled" as const },
  "VOLUME / PRODUÇÃO": { value: "100 por dia", status: "filled" as const },
};
const route = resolveIndustrialRoute({ collectedData: data, text: "Comprar seladora" });
async function fixture(tenant = tenantId, sameContact?: string) {
  const id = `case-${++sequence}`;
  const contactId = sameContact || `contact-${id}`;
  if (!sameContact)
    await scopedDb.insert(schema.contacts).values({
      id: contactId,
      tenantId: tenant,
      name: "Teste",
      phone: `5514999${String(sequence).padStart(6, "0")}`,
      mainChannel: "whatsapp",
    });
  await scopedDb
    .insert(schema.conversations)
    .values({ id, tenantId: tenant, contactId, queueState: "automacao" });
  const startedAt = new Date(Date.now() - 10_000);
  const flowId = `flow-${id}`;
  await scopedDb.insert(schema.agentFlowStates).values({
    id: flowId,
    tenantId: tenant,
    conversationId: id,
    agentType: "sdr",
    currentStep: "Em Qualificação",
    outcome: "in_progress",
    startedAt,
  });
  return { tenantId: tenant, conversationId: id, flowId, cycle: startedAt.toISOString() };
}
async function prepare(
  key: Awaited<ReturnType<typeof fixture>>,
  chosenRoute = route,
  decision?: MachineDecision | null,
  siteContext?: SiteContext | null,
) {
  const configuration = await readIndustrialSettings(scopedDb, key.tenantId);
  assert.equal(
    await store.prepare(key, {
      route: chosenRoute,
      data,
      clientName: "Pessoa de Teste",
      companyName: "Empresa Teste",
      siteContext,
      machineDecision:
        decision === null
          ? undefined
          : decision || {
              status: "confirmed",
              machineId: "fixture-machine",
              line: "SEMI-INDUSTRIAL",
              confidence: 1,
              method: "exact_catalog",
              reason: "catalog_confirmed",
              catalogRevision: configuration.revision,
              catalogFingerprint: configuration.catalogFingerprint,
            },
    }),
    true,
  );
}
async function config() {
  const [row] = await scopedDb
    .select()
    .from(schema.agentConfigs)
    .where(
      and(eq(schema.agentConfigs.tenantId, tenantId), eq(schema.agentConfigs.agentType, "rodizio")),
    );
  return row.config as {
    flowOperators: ReturnType<typeof flowOperator>[];
    operatorsMap: Record<string, { leadsReceivedCount: number }>;
  };
}
async function flow(key: Awaited<ReturnType<typeof fixture>>) {
  const [row] = await scopedDb
    .select()
    .from(schema.agentFlowStates)
    .where(
      and(
        eq(schema.agentFlowStates.tenantId, key.tenantId),
        eq(schema.agentFlowStates.id, key.flowId),
      ),
    );
  return row;
}
async function count(
  table:
    | typeof schema.crmDeals
    | typeof schema.crmConversationDeals
    | typeof schema.crmDealActivities
    | typeof schema.crmPipelines,
) {
  const [row] = await scopedDb
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.tenantId, tenantId));
  return row.n;
}

async function diagnostics(key: Awaited<ReturnType<typeof fixture>>) {
  return (await flow(key)).metadata as {
    handoffIssue?: { code: string } | null;
    handoffIssueHistory?: unknown[];
    handoffOutbox: HandoffOutbox;
  };
}

try {
  const [identity] =
    await client`select current_database() as name, host(inet_server_addr()) as ip`;
  assert.match(identity.name, /test/);
  assert.ok(["127.0.0.1", "::1"].includes(identity.ip));
  await client.unsafe(`CREATE SCHEMA ${q(testSchema)}`);
  // DDL derivado do schema Drizzle atual. FKs internas são adicionadas depois de criar as tabelas.
  for (const table of tables) {
    const cfg = getTableConfig(table);
    const columns = cfg.columns.map((col) => {
      let text = `${q(col.name)} ${col.getSQLType()}${col.primary ? " PRIMARY KEY" : ""}${col.notNull ? " NOT NULL" : ""}`;
      if (col.default !== undefined) {
        let value: string;
        if (is(col.default, SQL)) value = dialect.sqlToQuery(col.default).sql;
        else if (col.dataType === "json")
          value = `'${JSON.stringify(col.default).replaceAll("'", "''")}'::jsonb`;
        else if (typeof col.default === "string") value = `'${col.default.replaceAll("'", "''")}'`;
        else value = String(col.default);
        text += ` DEFAULT ${value}`;
      }
      return text;
    });
    await scopedClient.unsafe(`CREATE TABLE ${q(cfg.name)} (${columns.join(",")})`);
  }
  for (const table of tables)
    for (const fk of getTableConfig(table).foreignKeys) {
      const ref = fk.reference();
      if (!tables.some((item) => getTableName(item) === getTableName(ref.foreignTable))) continue;
      await scopedClient.unsafe(
        `ALTER TABLE ${q(getTableName(table))} ADD FOREIGN KEY (${ref.columns.map((col) => q(col.name)).join(",")}) REFERENCES ${q(getTableName(ref.foreignTable))} (${ref.foreignColumns.map((col) => q(col.name)).join(",")})`,
      );
    }
  for (const table of tables)
    for (const index of getTableConfig(table).indexes) {
      const cfg = index.config;
      if (!cfg.unique || !cfg.columns.every((column) => "name" in column)) continue;
      const columns = cfg.columns.map((column) => q((column as { name: string }).name));
      const where = cfg.where ? ` WHERE ${dialect.sqlToQuery(cfg.where).sql}` : "";
      await scopedClient.unsafe(
        `CREATE UNIQUE INDEX ${q(cfg.name!)} ON ${q(getTableName(table))} (${columns.join(",")})${where}`,
      );
    }
  await scopedDb
    .insert(schema.tenants)
    .values(
      [tenantId, otherTenant].map((id) => ({ id, name: id, slug: id, connectionType: "meta" })),
    );
  await scopedDb.insert(schema.operators).values([
    { id: opA, tenantId, name: "Operador A", email: "a@example.test", passwordHash: "test" },
    { id: opB, tenantId, name: "Operador B", email: "b@example.test", passwordHash: "test" },
    {
      id: outsider,
      tenantId: otherTenant,
      name: "Outra empresa",
      email: "other@example.test",
      passwordHash: "test",
    },
  ]);
  await scopedDb.insert(schema.agentConfigs).values([
    { id: "cfg-sdr", tenantId, agentType: "sdr", enabled: 1 },
    { id: "cfg-other", tenantId: otherTenant, agentType: "sdr", enabled: 1 },
    {
      id: "cfg-rr",
      tenantId,
      agentType: "rodizio",
      enabled: 1,
      config: {
        flowOperators: [
          flowOperator(opA),
          flowOperator(opB),
          { ...flowOperator(outsider), compensation: 1000 },
        ],
      },
    },
  ]);
  await scopedDb.insert(schema.crmPipelines).values({ id: "pipe", tenantId, name: "Máquinas" });
  await scopedDb
    .insert(schema.crmStages)
    .values({ id: "stage", tenantId, pipelineId: "pipe", name: "Qualificação" });
  await scopedDb.insert(schema.sectors).values([
    { id: "sector-sales", tenantId, name: "Comercial", operatorIds: [opA, opB] },
    { id: "sector-review", tenantId, name: "Análise", operatorIds: [opA, opB] },
    { id: "sector-foreign", tenantId: otherTenant, name: "Outro tenant", operatorIds: [outsider] },
  ]);
  const initialSettings = industrialSettingsSchema.parse({
    ...emptyIndustrialSettings(),
    catalog: [
      { id: "fixture-machine", name: "Seladora S100", sku: "S100", line: "SEMI-INDUSTRIAL" },
    ],
    destinations: {
      MAQUINAS: { sectorId: "sector-sales", pipelineId: "pipe", stageId: "stage" },
      REVIEW: { sectorId: "sector-review" },
      "5A_CLIENTE": { sectorId: "sector-review" },
    },
  });
  await saveIndustrialSettings(scopedDb, tenantId, 0, initialSettings, opA);

  await check(
    "12 execuções simultâneas do mesmo ciclo geram 1 atribuição, 1 card e 1 contagem",
    async () => {
      const key = await fixture();
      await prepare(key);
      const results = await Promise.all(Array.from({ length: 12 }, () => store.execute(key)));
      assert.equal(results.filter((r) => r.status === "transferred" && !r.replayed).length, 1);
      assert.equal(results.filter((r) => r.replayed).length, 11);
      assert.ok(results.every((r) => r.conversationVersion === 2));
      assert.equal(await count(schema.crmDeals), 1);
      assert.equal(await count(schema.crmConversationDeals), 1);
      assert.equal(await count(schema.crmDealActivities), 2); // Nota de criação + briefing final, uma vez cada.
      assert.equal(
        (await config()).flowOperators.reduce((n, op) => n + op.leadsReceivedCount, 0),
        1,
      );
      assert.equal((await flow(key)).outcome, "transferred");
      assert.ok(((await flow(key)).metadata as Record<string, unknown>).handoffReceipt);
    },
  );
  await check(
    "10 conversas concorrentes mantêm contagens e distribuição equilibradas; operador de outro tenant é excluído",
    async () => {
      const keys = await Promise.all(Array.from({ length: 10 }, () => fixture()));
      await Promise.all(keys.map((key) => prepare(key)));
      const results = await Promise.all(keys.map((key) => store.execute(key)));
      assert.ok(results.every((r) => r.status === "transferred"));
      const ops = (await config()).flowOperators;
      assert.equal(ops.find((op) => op.id === outsider)!.leadsReceivedCount, 0);
      assert.equal(
        ops.reduce((n, op) => n + op.leadsReceivedCount, 0),
        11,
      );
      assert.ok(Math.abs(ops[0].leadsReceivedCount - ops[1].leadsReceivedCount) <= 1);
      for (const key of keys) {
        const [conv] = await scopedDb
          .select()
          .from(schema.conversations)
          .where(
            and(
              eq(schema.conversations.tenantId, tenantId),
              eq(schema.conversations.id, key.conversationId),
            ),
          );
        const [contact] = await scopedDb
          .select()
          .from(schema.contacts)
          .where(
            and(eq(schema.contacts.tenantId, tenantId), eq(schema.contacts.id, conv.contactId)),
          );
        const [link] = await scopedDb
          .select()
          .from(schema.crmConversationDeals)
          .where(
            and(
              eq(schema.crmConversationDeals.tenantId, tenantId),
              eq(schema.crmConversationDeals.conversationId, key.conversationId),
            ),
          );
        const [deal] = await scopedDb
          .select()
          .from(schema.crmDeals)
          .where(and(eq(schema.crmDeals.tenantId, tenantId), eq(schema.crmDeals.id, link.dealId)));
        assert.equal(conv.operatorId, contact.walletOperatorId);
        assert.equal(conv.operatorId, deal.operatorId);
        assert.equal(conv.version, 2);
      }
    },
  );
  await check(
    "falha DEPOIS do card, atribuição e carteira reverte todos os efeitos; retry cria uma vez",
    async () => {
      const key = await fixture();
      await prepare(key);
      const beforeDeals = await count(schema.crmDeals);
      const beforeConfig = await config();
      await scopedClient.unsafe(
        `CREATE FUNCTION fail_rodizio_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = 'cfg-rr' THEN RAISE EXCEPTION 'injected_failure'; END IF; RETURN NEW; END $$`,
      );
      await scopedClient.unsafe(
        `CREATE TRIGGER injected_rodizio_failure BEFORE UPDATE ON agent_configs FOR EACH ROW EXECUTE FUNCTION fail_rodizio_write()`,
      );
      try {
        assert.equal((await store.execute(key)).status, "handoff_failed");
      } finally {
        await scopedClient.unsafe(`DROP TRIGGER injected_rodizio_failure ON agent_configs`);
      }
      assert.equal(await count(schema.crmDeals), beforeDeals);
      assert.deepEqual(await config(), beforeConfig);
      const [conv] = await scopedDb
        .select()
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.tenantId, tenantId),
            eq(schema.conversations.id, key.conversationId),
          ),
        );
      const [contact] = await scopedDb
        .select()
        .from(schema.contacts)
        .where(and(eq(schema.contacts.tenantId, tenantId), eq(schema.contacts.id, conv.contactId)));
      assert.equal(conv.operatorId, null);
      assert.equal(conv.queueState, "automacao");
      assert.equal(conv.version, 1);
      assert.equal(contact.walletOperatorId, null);
      assert.equal((await flow(key)).outcome, "in_progress");
      assert.equal(((await flow(key)).metadata as Record<string, unknown>).handoffAttempts, 1);
      assert.equal((await diagnostics(key)).handoffIssue?.code, "transaction_failed");
      assert.equal((await store.execute(key)).status, "transferred");
      assert.equal((await diagnostics(key)).handoffIssue, null);
      assert.equal((await diagnostics(key)).handoffIssueHistory?.length, 1);
      assert.equal(await count(schema.crmDeals), beforeDeals + 1);
      assert.equal((await store.execute(key)).replayed, true);
    },
  );
  await check(
    "card criado e erro propagado pelo helper externo é revertido com a transação",
    async () => {
      const key = await fixture();
      await prepare(key);
      const before = await count(schema.crmDeals);
      const failing = createIndustrialHandoffStore(scopedDb, async (params, tx) => {
        await ensureLocalCrmDealBeforeTransfer(params, tx);
        throw new Error("falha após criação");
      });
      assert.equal((await failing.execute(key)).status, "handoff_failed");
      assert.equal((await diagnostics(key)).handoffIssue?.code, "crm_failed");
      assert.ok(!JSON.stringify((await flow(key)).metadata).includes("falha após criação"));
      assert.equal(await count(schema.crmDeals), before);
      assert.equal((await store.execute(key)).status, "transferred");
    },
  );
  await check(
    "checkpoint persiste entre instâncias e é recuperado sem cliente enviar outra mensagem",
    async () => {
      const key = await fixture();
      await prepare(key);
      let notices = 0;
      const recovered = await recoverIndustrialHandoffs({
        database: scopedDb,
        store: createIndustrialHandoffStore(scopedDb, ensureLocalCrmDealBeforeTransfer),
        isIndustrialTenant: (id) => id === tenantId,
        onCommitted: async () => {
          notices++;
        },
      });
      assert.equal(recovered, 1);
      assert.equal(notices, 1);
      assert.equal((await flow(key)).outcome, "transferred");
      assert.equal(
        await recoverIndustrialHandoffs({
          database: scopedDb,
          store,
          isIndustrialTenant: (id) => id === tenantId,
          onCommitted: async () => {
            notices++;
          },
        }),
        0,
      );
      assert.equal(notices, 1);
    },
  );
  await check(
    "tomada humana durante a transação espera pelo lock e não é sobrescrita no replay",
    async () => {
      const key = await fixture();
      await prepare(key);
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const paused = createIndustrialHandoffStore(scopedDb, async (params, tx) => {
        enter();
        await gate;
        return ensureLocalCrmDealBeforeTransfer(params, tx);
      });
      const running = paused.execute(key);
      await entered;
      const manual = scopedDb
        .update(schema.conversations)
        .set({ operatorId: opB, queueState: "meus" })
        .where(
          and(
            eq(schema.conversations.tenantId, tenantId),
            eq(schema.conversations.id, key.conversationId),
          ),
        )
        .execute();
      release();
      assert.equal((await running).status, "transferred");
      await manual;
      const before = await config();
      assert.equal((await store.execute(key)).replayed, true);
      const [conv] = await scopedDb
        .select()
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.tenantId, tenantId),
            eq(schema.conversations.id, key.conversationId),
          ),
        );
      assert.equal(conv.operatorId, opB);
      assert.deepEqual(await config(), before);
    },
  );
  await check("tomada humana ANTES do commit impede card e sorteio", async () => {
    const key = await fixture();
    await prepare(key);
    const before = await count(schema.crmDeals);
    await scopedDb
      .update(schema.conversations)
      .set({ operatorId: opB, queueState: "meus" })
      .where(
        and(
          eq(schema.conversations.tenantId, tenantId),
          eq(schema.conversations.id, key.conversationId),
        ),
      );
    assert.equal((await store.execute(key)).superseded, true);
    assert.equal(await count(schema.crmDeals), before);
  });
  await check("tenant falso, ciclo antigo e SDR desativado não atribuem", async () => {
    const key = await fixture();
    await prepare(key);
    assert.equal((await store.execute({ ...key, tenantId: otherTenant })).superseded, true);
    assert.equal(
      (await store.execute({ ...key, cycle: new Date(0).toISOString() })).superseded,
      true,
    );
    await scopedDb
      .update(schema.agentConfigs)
      .set({ enabled: 0 })
      .where(
        and(eq(schema.agentConfigs.tenantId, tenantId), eq(schema.agentConfigs.id, "cfg-sdr")),
      );
    assert.equal((await store.execute(key)).superseded, true);
    assert.equal((await flow(key)).outcome, "in_progress");
    assert.equal((await diagnostics(key)).handoffIssue?.code, "sdr_disabled");
    await scopedDb
      .update(schema.agentConfigs)
      .set({ enabled: 1 })
      .where(
        and(eq(schema.agentConfigs.tenantId, tenantId), eq(schema.agentConfigs.id, "cfg-sdr")),
      );
    assert.equal((await store.execute(key)).status, "transferred");
  });
  await check("cancelamento após criação do CRM reverte e mantém checkpoint", async () => {
    const key = await fixture();
    await prepare(key);
    const before = await count(schema.crmDeals);
    const controller = new AbortController();
    const cancelled = createIndustrialHandoffStore(scopedDb, async (params, tx) => {
      const deal = await ensureLocalCrmDealBeforeTransfer(params, tx);
      controller.abort();
      return deal;
    });
    assert.equal(
      (await cancelled.execute(key, { signal: controller.signal })).status,
      "handoff_failed",
    );
    assert.equal(await count(schema.crmDeals), before);
    assert.equal((await flow(key)).outcome, "in_progress");
    assert.equal((await store.execute(key)).status, "transferred");
  });
  await check(
    "edição de configuração antiga não apaga contagens; alterações concorrentes de saldo são acumuladas",
    async () => {
      const stale = (await config()).flowOperators;
      const key = await fixture();
      await prepare(key);
      assert.equal((await store.execute(key)).status, "transferred");
      const before = await config();
      await mutateIndustrialRodizio(scopedDb, tenantId, (ops) =>
        ops.map((op) =>
          mergeIndustrialOperatorSettings(op, {
            ...stale.find((old) => old.id === op.id),
            departmentTag: "Novo setor",
          }),
        ),
      );
      assert.deepEqual(
        (await config()).flowOperators.map((op) => op.leadsReceivedCount),
        before.flowOperators.map((op) => op.leadsReceivedCount),
      );
      await Promise.all(
        Array.from({ length: 8 }, () =>
          mutateIndustrialRodizio(scopedDb, tenantId, (ops) =>
            ops.map((op) => (op.id === opA ? { ...op, compensation: op.compensation + 1 } : op)),
          ),
        ),
      );
      assert.equal((await config()).flowOperators.find((op) => op.id === opA)!.compensation, 8);
    },
  );
  await check(
    "falta de equipe mantém pendência; recuperação respeita backoff e retoma quando configurada",
    async () => {
      const key = await fixture();
      await prepare(key);
      const previous = (await config()).flowOperators;
      await mutateIndustrialRodizio(scopedDb, tenantId, (ops) =>
        ops.map((op) => ({ ...op, isOnLeave: true })),
      );
      assert.equal((await store.execute(key)).status, "waiting_for_team");
      assert.equal((await store.execute(key, { recovery: true })).superseded, true);
      await mutateIndustrialRodizio(scopedDb, tenantId, () => previous);
      assert.equal((await store.execute(key)).status, "transferred");
    },
  );
  await check(
    "informativo encerra com recibo sem card; pedido humano transfere sem card",
    async () => {
      const info = await fixture();
      const before = await count(schema.crmDeals);
      await prepare(
        info,
        resolveIndustrialRoute({ text: "Quero enviar meu currículo", collectedData: {} }),
      );
      assert.equal((await store.execute(info)).status, "resolved");
      assert.equal((await store.execute(info)).replayed, true);
      const human = await fixture();
      await prepare(
        human,
        resolveIndustrialRoute({ text: "Quero falar com um humano", collectedData: {} }),
      );
      assert.equal((await store.execute(human)).status, "transferred");
      assert.equal(await count(schema.crmDeals), before);
    },
  );
  await check("sem funil CRM configurado não cria fallback nem transfere", async () => {
    const key = await fixture();
    const parts = resolveIndustrialRoute({
      text: "Preciso de uma peça de reposição",
      collectedData: data,
    });
    await mutateIndustrialRodizio(scopedDb, tenantId, (ops) =>
      ops.map((op) => ({ ...op, funnels: [...op.funnels, "Peças"] })),
    );
    await prepare(key, parts);
    const before = await count(schema.crmPipelines);
    assert.equal((await store.execute(key)).status, "handoff_failed");
    assert.equal(await count(schema.crmPipelines), before);
    assert.equal((await diagnostics(key)).handoffIssue?.code, "destination_unconfigured");
  });
  await check("whitelist impede atribuição fora do telefone autorizado", async () => {
    const key = await fixture();
    await prepare(key);
    await scopedDb
      .update(schema.agentConfigs)
      .set({ config: { whitelistEnabled: true, whitelistPhone: "5514000000000" } })
      .where(
        and(eq(schema.agentConfigs.tenantId, tenantId), eq(schema.agentConfigs.id, "cfg-sdr")),
      );
    assert.equal((await store.execute(key)).superseded, true);
    assert.equal((await flow(key)).outcome, "in_progress");
    assert.equal((await diagnostics(key)).handoffIssue?.code, "whitelist_restricted");
    await scopedDb
      .update(schema.agentConfigs)
      .set({ config: {} })
      .where(
        and(eq(schema.agentConfigs.tenantId, tenantId), eq(schema.agentConfigs.id, "cfg-sdr")),
      );
    assert.equal((await store.execute(key)).status, "transferred");
  });
  await check("dois workers concorrentes recuperam um checkpoint uma única vez", async () => {
    const key = await fixture();
    await prepare(key);
    let notifications = 0;
    const run = () =>
      recoverIndustrialHandoffs({
        database: scopedDb,
        store,
        isIndustrialTenant: (id) => id === tenantId,
        onCommitted: async () => {
          notifications++;
        },
      });
    const results = await Promise.all([run(), run()]);
    assert.equal(
      results.reduce((a, b) => a + b, 0),
      1,
    );
    assert.equal(notifications, 1);
  });
  await check(
    "novo ciclo reutiliza card da mesma pessoa em até 3h; depois de 3h cria outro",
    async () => {
      let key = await fixture();
      await prepare(key);
      const first = await store.execute(key);
      assert.equal(first.status, "transferred");
      const before = await count(schema.crmDeals);
      async function reopen() {
        const startedAt = new Date();
        await scopedDb.transaction(async (tx) => {
          await tx
            .update(schema.conversations)
            .set({ operatorId: null, queueState: "automacao" })
            .where(
              and(
                eq(schema.conversations.tenantId, tenantId),
                eq(schema.conversations.id, key.conversationId),
              ),
            );
          await tx
            .update(schema.agentFlowStates)
            .set({
              metadata: {},
              collectedData: {},
              startedAt,
              outcome: "in_progress",
              completedAt: null,
            })
            .where(
              and(
                eq(schema.agentFlowStates.tenantId, tenantId),
                eq(schema.agentFlowStates.id, key.flowId),
              ),
            );
        });
        key = { ...key, cycle: startedAt.toISOString() };
        await prepare(key);
      }
      const oldKey = key;
      await reopen();
      assert.equal((await store.execute(oldKey)).superseded, true);
      const second = await store.execute(key);
      assert.equal(second.status, "transferred");
      assert.equal(second.deal?.dealId, first.deal?.dealId);
      assert.equal(second.deal?.action, "reused_within_3h");
      assert.equal(await count(schema.crmDeals), before);
      await scopedDb
        .update(schema.crmDeals)
        .set({ createdAt: new Date(Date.now() - 4 * 60 * 60_000) })
        .where(
          and(eq(schema.crmDeals.tenantId, tenantId), eq(schema.crmDeals.id, first.deal!.dealId)),
        );
      await reopen();
      const third = await store.execute(key);
      assert.equal(third.deal?.action, "created_new");
      assert.notEqual(third.deal?.dealId, first.deal?.dealId);
      assert.equal(await count(schema.crmDeals), before + 1);
    },
  );
  await check(
    "recuperação ignora fluxo antigo quando há ciclo mais recente na conversa",
    async () => {
      const old = await fixture();
      await prepare(old);
      const startedAt = new Date();
      const key = { ...old, flowId: `${old.flowId}-new`, cycle: startedAt.toISOString() };
      await scopedDb.insert(schema.agentFlowStates).values({
        id: key.flowId,
        tenantId,
        conversationId: key.conversationId,
        startedAt,
        agentType: "sdr",
        outcome: "in_progress",
        currentStep: "Em Qualificação",
      });
      await prepare(key);
      assert.equal((await store.execute(old)).superseded, true);
      assert.equal(
        await recoverIndustrialHandoffs({
          database: scopedDb,
          store,
          isIndustrialTenant: (id) => id === tenantId,
        }),
        1,
      );
      assert.equal((await flow(key)).outcome, "transferred");
      assert.equal(
        await recoverIndustrialHandoffs({
          database: scopedDb,
          store,
          isIndustrialTenant: (id) => id === tenantId,
        }),
        0,
      );
    },
  );
  await check(
    "operador duplicado na configuração não conta duas vezes nem cria card parcial",
    async () => {
      const key = await fixture();
      await prepare(key);
      const before = await count(schema.crmDeals);
      const previous = (await config()).flowOperators;
      await mutateIndustrialRodizio(scopedDb, tenantId, () => [...previous, { ...previous[0] }]);
      assert.equal((await store.execute(key)).status, "handoff_failed");
      assert.equal(await count(schema.crmDeals), before);
      await mutateIndustrialRodizio(scopedDb, tenantId, () => previous);
      assert.equal((await store.execute(key)).status, "transferred");
    },
  );
  await check("renomear funil e etapa não altera destino vinculado por ID", async () => {
    await scopedDb
      .update(schema.crmPipelines)
      .set({ name: "Comercial Industrial Renomeado" })
      .where(and(eq(schema.crmPipelines.tenantId, tenantId), eq(schema.crmPipelines.id, "pipe")));
    await scopedDb
      .update(schema.crmStages)
      .set({ name: "Recepção Renomeada" })
      .where(and(eq(schema.crmStages.tenantId, tenantId), eq(schema.crmStages.id, "stage")));
    const key = await fixture();
    await prepare(key);
    const result = await store.execute(key);
    assert.equal(result.status, "transferred");
    assert.equal(result.deal?.funnelId, "pipe");
    assert.equal(result.deal?.stageId, "stage");
    assert.equal(result.sectorId, "sector-sales");
  });
  await check(
    "destinos de outro tenant e etapa final são rejeitados sem alterar revisão",
    async () => {
      const config = await readIndustrialSettings(scopedDb, tenantId);
      await assert.rejects(
        saveIndustrialSettings(
          scopedDb,
          tenantId,
          config.revision,
          { ...config.settings, destinations: { REVIEW: { sectorId: "sector-foreign" } } },
          opA,
        ),
      );
      await scopedDb
        .insert(schema.crmStages)
        .values({ id: "win-stage", tenantId, pipelineId: "pipe", name: "Ganho", isWinStage: true });
      await assert.rejects(
        saveIndustrialSettings(
          scopedDb,
          tenantId,
          config.revision,
          {
            ...config.settings,
            destinations: {
              MAQUINAS: { sectorId: "sector-sales", pipelineId: "pipe", stageId: "win-stage" },
            },
          },
          opA,
        ),
      );
      assert.equal((await readIndustrialSettings(scopedDb, tenantId)).revision, config.revision);
    },
  );
  await check(
    "duas edições concorrentes da configuração não sobrescrevem uma à outra",
    async () => {
      const config = await readIndustrialSettings(scopedDb, tenantId);
      const results = await Promise.allSettled([
        saveIndustrialSettings(scopedDb, tenantId, config.revision, config.settings, opA),
        saveIndustrialSettings(scopedDb, tenantId, config.revision, config.settings, opB),
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    },
  );
  await check(
    "alterar etapa para encerramento durante a pendência bloqueia transferência e mantém checkpoint",
    async () => {
      const key = await fixture();
      await prepare(key);
      const before = await count(schema.crmDeals);
      await scopedDb
        .update(schema.crmStages)
        .set({ isLossStage: true })
        .where(and(eq(schema.crmStages.tenantId, tenantId), eq(schema.crmStages.id, "stage")));
      assert.equal((await store.execute(key)).status, "handoff_failed");
      assert.equal((await diagnostics(key)).handoffIssue?.code, "destination_pipeline_invalid");
      assert.equal(await count(schema.crmDeals), before);
      await scopedDb
        .update(schema.crmStages)
        .set({ isLossStage: false })
        .where(and(eq(schema.crmStages.tenantId, tenantId), eq(schema.crmStages.id, "stage")));
      assert.equal((await store.execute(key)).status, "transferred");
    },
  );
  await check("autorização no funil sem participação no setor não permite atribuição", async () => {
    const key = await fixture();
    await prepare(key);
    await scopedDb
      .update(schema.sectors)
      .set({ operatorIds: [] })
      .where(and(eq(schema.sectors.tenantId, tenantId), eq(schema.sectors.id, "sector-sales")));
    assert.equal((await store.execute(key)).status, "waiting_for_team");
    await scopedDb
      .update(schema.sectors)
      .set({ operatorIds: [opA, opB] })
      .where(and(eq(schema.sectors.tenantId, tenantId), eq(schema.sectors.id, "sector-sales")));
    assert.equal((await store.execute(key)).status, "transferred");
  });
  await check(
    "checkpoint comercial sem Decisor confirmado segue à revisão sem criar negociação",
    async () => {
      const key = await fixture();
      await prepare(key, route, null);
      const before = await count(schema.crmDeals);
      const result = await store.execute(key);
      assert.equal(result.status, "transferred");
      assert.equal(result.sectorId, "sector-review");
      assert.equal(result.deal, null);
      assert.equal(await count(schema.crmDeals), before);
      assert.equal(((await flow(key)).metadata as Record<string, unknown>).needsReview, true);
    },
  );
  await check(
    "mudança de catálogo entre decisão e commit invalida a evidência anterior",
    async () => {
      const key = await fixture();
      await prepare(key);
      const before = await count(schema.crmDeals);
      const config = await readIndustrialSettings(scopedDb, tenantId);
      await saveIndustrialSettings(
        scopedDb,
        tenantId,
        config.revision,
        {
          ...config.settings,
          catalog: config.settings.catalog.map((machine) => ({ ...machine, line: "PERSONNALITE" })),
        },
        opA,
      );
      const result = await store.execute(key);
      assert.equal(result.sectorId, "sector-review");
      assert.equal(result.deal, null);
      assert.equal(await count(schema.crmDeals), before);
      const next = await readIndustrialSettings(scopedDb, tenantId);
      await saveIndustrialSettings(scopedDb, tenantId, next.revision, config.settings, opA);
    },
  );
  await check(
    "troca apenas de destino preserva prova de catálogo e usa o novo setor por ID",
    async () => {
      const key = await fixture();
      await prepare(key);
      await scopedDb
        .insert(schema.sectors)
        .values({ id: "sector-sales-2", tenantId, name: "Novo setor", operatorIds: [opA, opB] });
      const config = await readIndustrialSettings(scopedDb, tenantId);
      await saveIndustrialSettings(
        scopedDb,
        tenantId,
        config.revision,
        {
          ...config.settings,
          destinations: {
            ...config.settings.destinations,
            MAQUINAS: { sectorId: "sector-sales-2", pipelineId: "pipe", stageId: "stage" },
          },
        },
        opA,
      );
      const result = await store.execute(key);
      assert.equal(result.status, "transferred");
      assert.equal(result.sectorId, "sector-sales-2");
      assert.ok(result.deal?.dealId);
      assert.equal(result.destinationRevision, config.revision + 1);
    },
  );
  await check(
    "funil estrangeiro e etapa de outro funil não são aceitos na configuração",
    async () => {
      await scopedDb.insert(schema.crmPipelines).values([
        { id: "foreign-pipe", tenantId: otherTenant, name: "Máquinas" },
        { id: "second-pipe", tenantId, name: "Outro funil" },
      ]);
      await scopedDb.insert(schema.crmStages).values([
        { id: "foreign-stage", tenantId: otherTenant, pipelineId: "foreign-pipe", name: "Entrada" },
        { id: "second-stage", tenantId, pipelineId: "second-pipe", name: "Entrada" },
      ]);
      const config = await readIndustrialSettings(scopedDb, tenantId);
      for (const [pipelineId, stageId] of [
        ["foreign-pipe", "foreign-stage"],
        ["pipe", "second-stage"],
      ])
        await assert.rejects(
          saveIndustrialSettings(
            scopedDb,
            tenantId,
            config.revision,
            {
              ...config.settings,
              destinations: { MAQUINAS: { sectorId: "sector-sales", pipelineId, stageId } },
            },
            opA,
          ),
        );
      assert.equal((await readIndustrialSettings(scopedDb, tenantId)).revision, config.revision);
    },
  );
  await check(
    "família bloqueada chega ao setor de revisão com coleta incompleta e sem card",
    async () => {
      const key = await fixture();
      const decision: MachineDecision = {
        status: "not_offered",
        machineId: null,
        line: null,
        confidence: 1,
        method: "rule",
        reason: "blocked_family:fixture",
        catalogRevision: 1,
      };
      const blocked = applyMachineDecision(route, decision);
      const before = await count(schema.crmDeals);
      assert.equal(
        await store.prepare(key, {
          route: blocked,
          data: {},
          clientName: "Cliente",
          companyName: "",
          machineDecision: decision,
        }),
        true,
      );
      const result = await store.execute(key);
      assert.equal(result.sectorId, "sector-review");
      assert.equal(result.deal, null);
      assert.equal(await count(schema.crmDeals), before);
    },
  );
  await check(
    "duas reaberturas do site reiniciam apenas um ciclo e preservam outros agentes",
    async () => {
      const key = await fixture();
      await scopedDb
        .update(schema.conversations)
        .set({
          queueState: "finalizados",
          operatorId: opA,
          sectorId: "sector-sales",
          version: 7,
        })
        .where(
          and(
            eq(schema.conversations.tenantId, tenantId),
            eq(schema.conversations.id, key.conversationId),
          ),
        );
      await scopedDb
        .update(schema.agentFlowStates)
        .set({
          outcome: "completed",
          metadata: { allocatedOperatorName: "Operador anterior" },
        })
        .where(
          and(
            eq(schema.agentFlowStates.tenantId, tenantId),
            eq(schema.agentFlowStates.id, key.flowId),
          ),
        );
      const supervisorId = `supervisor-${key.conversationId}`;
      await scopedDb.insert(schema.agentFlowStates).values({
        id: supervisorId,
        tenantId,
        conversationId: key.conversationId,
        agentType: "supervisor",
        currentStep: "Preservar",
        collectedData: { marker: true },
      });
      const results = await Promise.all([
        reopenIndustrialSiteConversation(scopedDb, tenantId, key.conversationId),
        reopenIndustrialSiteConversation(scopedDb, tenantId, key.conversationId),
      ]);
      assert.equal(results.filter(Boolean).length, 1);
      const reopened = results.find(Boolean)!;
      assert.equal(reopened.version, 8);
      assert.equal(reopened.operatorId, null);
      assert.equal(reopened.sectorId, null);
      assert.equal(reopened.queueState, "automacao");
      const states = await scopedDb
        .select()
        .from(schema.agentFlowStates)
        .where(
          and(
            eq(schema.agentFlowStates.tenantId, tenantId),
            eq(schema.agentFlowStates.conversationId, key.conversationId),
          ),
        );
      assert.equal(states.length, 2);
      assert.deepEqual(states.find((s) => s.id === supervisorId)?.collectedData, { marker: true });
      const current = states.find((s) => s.agentType === "sdr")!;
      const history = (
        current.metadata as { previousTriages: { id: string; responsibleName: string }[] }
      ).previousTriages;
      assert.equal(history.length, 1);
      assert.equal(history[0].id, key.flowId);
      assert.equal(history[0].responsibleName, "Operador anterior");
    },
  );
  await check(
    "reabertura atrasada ou com tenant estrangeiro não apaga triagem nem tomada humana",
    async () => {
      const key = await fixture();
      await scopedDb
        .update(schema.conversations)
        .set({ queueState: "meus", operatorId: opA })
        .where(
          and(
            eq(schema.conversations.tenantId, tenantId),
            eq(schema.conversations.id, key.conversationId),
          ),
        );
      await scopedDb
        .update(schema.agentFlowStates)
        .set({ collectedData: { marker: "não apagar" } })
        .where(
          and(
            eq(schema.agentFlowStates.tenantId, tenantId),
            eq(schema.agentFlowStates.id, key.flowId),
          ),
        );
      assert.equal(
        await reopenIndustrialSiteConversation(scopedDb, tenantId, key.conversationId),
        null,
      );
      assert.equal(
        await reopenIndustrialSiteConversation(scopedDb, otherTenant, key.conversationId),
        null,
      );
      assert.deepEqual((await flow(key)).collectedData, { marker: "não apagar" });
      const [current] = await scopedDb
        .select()
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.tenantId, tenantId),
            eq(schema.conversations.id, key.conversationId),
          ),
        );
      assert.equal(current.queueState, "meus");
      assert.equal(current.operatorId, opA);
    },
  );
  await check("retry de mensagem antiga não reabre atendimento encerrado do site", async () => {
    const key = await fixture();
    await scopedDb
      .update(schema.conversations)
      .set({ queueState: "finalizados" })
      .where(
        and(
          eq(schema.conversations.tenantId, tenantId),
          eq(schema.conversations.id, key.conversationId),
        ),
      );
    const oldMessageId = `old-${key.conversationId}`;
    await scopedDb.insert(schema.messages).values({
      id: oldMessageId,
      tenantId,
      conversationId: key.conversationId,
      senderType: "client",
      senderName: "Teste",
      content: "Mensagem já recebida",
    });
    assert.equal(
      await reopenIndustrialSiteConversation(scopedDb, tenantId, key.conversationId, oldMessageId),
      null,
    );
    assert.ok(await flow(key));
    assert.ok(
      await reopenIndustrialSiteConversation(
        scopedDb,
        tenantId,
        key.conversationId,
        `new-${key.conversationId}`,
      ),
    );
  });
  await check(
    "continuidade leva as últimas 200 mensagens com desempate estável e isolamento",
    async () => {
      const key = await fixture();
      const other = await fixture();
      const sentAt = new Date("2026-10-20T12:00:00Z");
      const prefix = `history-${key.conversationId}-`;
      const message = (
        id: string,
        tenant = tenantId,
        conversationId = key.conversationId,
        internal = false,
      ) => ({
        id,
        tenantId: tenant,
        conversationId,
        senderType: "client",
        senderName: "Teste",
        content: id,
        sentAt,
        isInternalNote: internal,
        mediaInterpretation: "Contexto da mídia",
      });
      await scopedDb
        .insert(schema.messages)
        .values([
          ...Array.from({ length: 205 }, (_, i) =>
            message(`${prefix}${String(i).padStart(3, "0")}`),
          ),
          message(`${prefix}foreign`, otherTenant),
          message(`${prefix}internal`, tenantId, key.conversationId, true),
          message(`${prefix}other`, tenantId, other.conversationId),
        ]);
      const rows = await scopedDb.transaction((tx) =>
        readSiteContinuationHistory(tx, tenantId, key.conversationId),
      );
      assert.equal(rows.length, 200);
      assert.deepEqual(
        rows.map((m) => m.id),
        Array.from({ length: 200 }, (_, i) => `${prefix}${String(i + 5).padStart(3, "0")}`),
      );
      assert.ok(
        rows.every(
          (m) =>
            m.tenantId === tenantId &&
            !m.isInternalNote &&
            m.mediaInterpretation === "Contexto da mídia",
        ),
      );
      assert.deepEqual(
        await readSiteContinuationHistory(scopedDb, otherTenant, other.conversationId),
        [],
      );
    },
  );
  await check(
    "monitor conta só ciclos correntes, exclui encerrados/humanos e respeita a meia-noite de Brasília",
    async () => {
      const monitorTenant = "monitor_fixture";
      await scopedDb.insert(schema.tenants).values({
        id: monitorTenant,
        name: "Monitor",
        slug: monitorTenant,
        connectionType: "meta",
      });
      await scopedDb.insert(schema.operators).values({
        id: "monitor-op",
        tenantId: monitorTenant,
        name: "Monitor",
        email: "monitor@example.test",
        passwordHash: "test",
      });
      const keys = await Promise.all(Array.from({ length: 6 }, () => fixture(monitorTenant)));
      for (const key of keys)
        await scopedDb
          .update(schema.agentFlowStates)
          .set({ startedAt: new Date("2026-10-21T03:00:00Z") })
          .where(
            and(
              eq(schema.agentFlowStates.tenantId, monitorTenant),
              eq(schema.agentFlowStates.id, key.flowId),
            ),
          );
      await scopedDb
        .update(schema.agentFlowStates)
        .set({ startedAt: new Date("2026-10-21T02:59:59Z") })
        .where(
          and(
            eq(schema.agentFlowStates.tenantId, monitorTenant),
            eq(schema.agentFlowStates.id, keys[1].flowId),
          ),
        );
      await scopedDb
        .update(schema.agentFlowStates)
        .set({ outcome: "completed", completedAt: new Date("2026-10-21T04:00:00Z") })
        .where(
          and(
            eq(schema.agentFlowStates.tenantId, monitorTenant),
            eq(schema.agentFlowStates.id, keys[2].flowId),
          ),
        );
      await scopedDb
        .update(schema.conversations)
        .set({ operatorId: "monitor-op", queueState: "meus" })
        .where(
          and(
            eq(schema.conversations.tenantId, monitorTenant),
            eq(schema.conversations.id, keys[3].conversationId),
          ),
        );
      await scopedDb
        .update(schema.conversations)
        .set({ queueState: "fila" })
        .where(
          and(
            eq(schema.conversations.tenantId, monitorTenant),
            eq(schema.conversations.id, keys[4].conversationId),
          ),
        );
      await scopedDb
        .update(schema.agentFlowStates)
        .set({ completedAt: new Date("2026-10-21T04:00:00Z") })
        .where(
          and(
            eq(schema.agentFlowStates.tenantId, monitorTenant),
            eq(schema.agentFlowStates.id, keys[5].flowId),
          ),
        );
      await scopedDb.insert(schema.agentFlowStates).values([
        {
          id: "monitor-old",
          tenantId: monitorTenant,
          conversationId: keys[0].conversationId,
          agentType: "sdr",
          currentStep: "Antigo",
          startedAt: new Date("2026-10-20T12:00:00Z"),
          lastInteractionAt: new Date("2026-10-22T12:00:00Z"),
          outcome: "in_progress",
        },
        {
          id: "monitor-supervisor",
          tenantId: monitorTenant,
          conversationId: keys[0].conversationId,
          agentType: "supervisor",
          currentStep: "Outro agente",
          startedAt: new Date("2026-10-21T03:00:00Z"),
          outcome: "in_progress",
        },
      ]);
      const result = await readAgentMonitoringSummary(
        scopedDb,
        monitorTenant,
        new Date("2026-10-21T12:00:00Z"),
      );
      assert.deepEqual(result.byAgent.sdr, { currentCycles: 6, activeFlows: 2, startedToday: 5 });
      assert.deepEqual(result.byAgent.supervisor, {
        currentCycles: 1,
        activeFlows: 1,
        startedToday: 1,
      });
      const latest = await readLatestSdrFlows(scopedDb, monitorTenant);
      assert.equal(latest.length, 6);
      assert.ok(
        latest.every(
          (f) => f.agentType === "sdr" && f.tenantId === monitorTenant && f.id !== "monitor-old",
        ),
      );
      assert.deepEqual((await readAgentMonitoringSummary(scopedDb, "missing_fixture")).byAgent, {});
    },
  );
  await check(
    "configuração corrompida e setor estrangeiro têm diagnóstico seguro e não atribuem",
    async () => {
      const configuration = await readIndustrialSettings(scopedDb, tenantId);
      const key = await fixture();
      await prepare(key);
      const original = configuration.row!.config;
      try {
        await scopedDb
          .update(schema.agentConfigs)
          .set({ config: { revision: 0 } })
          .where(
            and(
              eq(schema.agentConfigs.tenantId, tenantId),
              eq(schema.agentConfigs.id, configuration.row!.id),
            ),
          );
        assert.equal((await store.execute(key)).status, "handoff_failed");
        assert.equal((await diagnostics(key)).handoffIssue?.code, "settings_invalid");
        await scopedDb
          .update(schema.agentConfigs)
          .set({
            config: {
              revision: configuration.revision,
              settings: {
                ...configuration.settings,
                destinations: {
                  ...configuration.settings.destinations,
                  MAQUINAS: { sectorId: "sector-foreign", pipelineId: "pipe", stageId: "stage" },
                },
              },
            },
          })
          .where(
            and(
              eq(schema.agentConfigs.tenantId, tenantId),
              eq(schema.agentConfigs.id, configuration.row!.id),
            ),
          );
        assert.equal((await store.execute(key)).status, "handoff_failed");
        assert.equal((await diagnostics(key)).handoffIssue?.code, "destination_sector_invalid");
      } finally {
        await scopedDb
          .update(schema.agentConfigs)
          .set({ config: original })
          .where(
            and(
              eq(schema.agentConfigs.tenantId, tenantId),
              eq(schema.agentConfigs.id, configuration.row!.id),
            ),
          );
      }
      assert.equal((await store.execute(key)).status, "transferred");
      assert.equal((await diagnostics(key)).handoffIssue, null);
    },
  );
  await check("escala sem elegível registra causa e não consome atribuição", async () => {
    const key = await fixture();
    await prepare(key);
    const original = await config();
    const beforeDeals = await count(schema.crmDeals);
    await mutateIndustrialRodizio(scopedDb, tenantId, (ops) =>
      ops.map((op) => ({ ...op, isOnLeave: true })),
    );
    try {
      assert.equal((await store.execute(key)).status, "waiting_for_team");
      assert.equal((await diagnostics(key)).handoffIssue?.code, "no_eligible_operator");
      assert.equal(await count(schema.crmDeals), beforeDeals);
      assert.equal(
        (await config()).flowOperators.reduce((sum, op) => sum + op.leadsReceivedCount, 0),
        original.flowOperators.reduce((sum, op) => sum + op.leadsReceivedCount, 0),
      );
    } finally {
      await mutateIndustrialRodizio(scopedDb, tenantId, () => original.flowOperators);
    }
  });

  const postTenant = "post_commit_fixture";
  await scopedDb
    .insert(schema.tenants)
    .values({ id: postTenant, name: "Pós-commit", slug: postTenant, connectionType: "meta" });
  await scopedDb.insert(schema.operators).values(
    ["post-op", "post-op-2"].map((id) => ({
      id,
      tenantId: postTenant,
      name: id,
      email: `${id}@example.test`,
      passwordHash: "test",
    })),
  );
  await scopedDb.insert(schema.sectors).values({
    id: "post-sector",
    tenantId: postTenant,
    name: "Atendimento",
    operatorIds: ["post-op"],
  });
  await scopedDb.insert(schema.agentConfigs).values([
    { id: "post-sdr", tenantId: postTenant, agentType: "sdr", enabled: 1 },
    {
      id: "post-rr",
      tenantId: postTenant,
      agentType: "rodizio",
      config: { flowOperators: [flowOperator("post-op")] },
    },
  ]);
  await saveIndustrialSettings(
    scopedDb,
    postTenant,
    0,
    { ...emptyIndustrialSettings(), destinations: { REVIEW: { sectorId: "post-sector" } } },
    "post-op",
  );
  async function postFixture() {
    const key = await fixture(postTenant);
    await prepare(
      key,
      resolveIndustrialRoute({ text: "Quero falar com um humano", collectedData: {} }),
    );
    assert.equal((await store.execute(key)).status, "transferred");
    return key;
  }
  async function forceDue(key: Awaited<ReturnType<typeof fixture>>) {
    const current = await flow(key);
    const meta = await diagnostics(key);
    await scopedDb
      .update(schema.agentFlowStates)
      .set({
        metadata: {
          ...(current.metadata as Record<string, unknown>),
          handoffOutbox: { ...meta.handoffOutbox, nextAttemptAt: new Date(0).toISOString() },
        },
      })
      .where(
        and(
          eq(schema.agentFlowStates.tenantId, key.tenantId),
          eq(schema.agentFlowStates.id, key.flowId),
        ),
      );
  }
  await check(
    "avisos cancelados por mudança humana, remoção do dono ou fechamento nunca são marcados como enviados",
    async () => {
      for (const change of [
        { operatorId: "post-op-2", queueState: "meus" },
        { operatorId: null, queueState: "fila" },
        { operatorId: "post-op", queueState: "finalizados" },
      ]) {
        const key = await postFixture();
        await scopedDb
          .update(schema.conversations)
          .set(change)
          .where(
            and(
              eq(schema.conversations.tenantId, postTenant),
              eq(schema.conversations.id, key.conversationId),
            ),
          );
        assert.equal(await store.claimPostCommitOutbox(key, { immediate: true }), null);
        const box = (await diagnostics(key)).handoffOutbox;
        assert.equal(box.clientNotifiedAt, null);
        assert.equal(box.operatorNotifiedAt, null);
        assert.ok(box.clientCancelledAt && box.operatorCancelledAt);
        const projected = projectIndustrialMonitoring(await flow(key), change);
        assert.equal(projected.clientConfirmation, "cancelled");
        assert.equal(projected.operatorNotification, "cancelled");
      }
    },
  );
  await check(
    "worker usa a entrega compartilhada, preserva êxito parcial e retoma só a confirmação faltante",
    async () => {
      const key = await postFixture();
      await forceDue(key);
      let notifications = 0,
        clientSends = 0;
      const run = (failClient: boolean) =>
        recoverIndustrialPostCommitOutbox({
          database: scopedDb,
          store,
          isIndustrialTenant: (id) => id === postTenant,
          deliverOutbox: (item) =>
            deliverIndustrialPostCommit(item, {
              notifyOperator: async () => {
                notifications++;
                return true;
              },
              getContactPhone: async (id) => {
                assert.equal(id, postTenant);
                return "";
              },
              sendText: async (params) => {
                clientSends++;
                assert.equal(params.expectedOperatorId, "post-op");
                if (failClient) throw new Error("CREDENCIAL_NAO_PERSISTIR");
                return { sent: true };
              },
            }),
        });
      assert.equal(await run(true), 1);
      let box = (await diagnostics(key)).handoffOutbox;
      assert.ok(box.operatorNotifiedAt);
      assert.equal(box.clientNotifiedAt, null);
      assert.equal(box.clientIssue?.code, "client_confirmation_failed");
      assert.ok(!JSON.stringify(box).includes("CREDENCIAL_NAO_PERSISTIR"));
      await forceDue(key);
      assert.equal(await run(false), 1);
      box = (await diagnostics(key)).handoffOutbox;
      assert.ok(box.clientNotifiedAt);
      assert.equal(box.clientIssue, null);
      assert.equal(notifications, 1);
      assert.equal(clientSends, 2);
      await store.recordPostCommitFailure(key, { clientFailed: true });
      assert.equal((await diagnostics(key)).handoffOutbox.clientIssue, null);
      assert.equal(await run(false), 0);
      assert.equal((await store.execute(key)).replayed, true);
    },
  );
  await check(
    "duas reservas concorrentes de avisos dão uma tentativa; limite fica visível sem refazer rodízio",
    async () => {
      const key = await postFixture();
      await forceDue(key);
      const attempts = await Promise.all([
        store.claimPostCommitOutbox(key),
        store.claimPostCommitOutbox(key),
      ]);
      assert.equal(attempts.filter(Boolean).length, 1);
      await store.recordPostCommitFailure(key, { operatorFailed: true, clientFailed: true });
      for (let i = 1; i < 6; i++) {
        await forceDue(key);
        assert.ok(await store.claimPostCommitOutbox(key));
        await store.recordPostCommitFailure(key, { operatorFailed: true, clientFailed: true });
      }
      await forceDue(key);
      assert.equal(await store.claimPostCommitOutbox(key), null);
      const monitor = projectIndustrialMonitoring(await flow(key), {
        operatorId: "post-op",
        queueState: "meus",
      });
      assert.equal(monitor.clientConfirmation, "failed");
      assert.equal(monitor.operatorIssue?.code, "operator_notification_failed");
      assert.equal((await store.execute(key)).replayed, true);
      assert.equal(
        await store.ackPostCommit({ ...key, tenantId }, { clientNotified: true }),
        false,
      );
      assert.equal(
        await store.recordPostCommitFailure(
          { ...key, cycle: new Date(0).toISOString() },
          { clientFailed: true },
        ),
        false,
      );
    },
  );
  await check(
    "nota progressiva deduplica, permanece interna e reverte junto com o estado",
    async () => {
      const key = await fixture();
      const before = await flow(key);
      const after = { ...before, collectedData: data };
      let noteId: string | null = null;
      await scopedDb.transaction(async (tx) => {
        await tx
          .update(schema.agentFlowStates)
          .set({ collectedData: data })
          .where(
            and(
              eq(schema.agentFlowStates.tenantId, tenantId),
              eq(schema.agentFlowStates.id, key.flowId),
            ),
          );
        noteId = await appendIndustrialJournal(tx, before, after, "collection", "message-a");
        assert.equal(
          await appendIndustrialJournal(tx, before, after, "collection", "message-a"),
          null,
        );
      });
      const notes = await scopedDb
        .select()
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.tenantId, tenantId),
            eq(schema.messages.conversationId, key.conversationId),
          ),
        );
      assert.equal(notes.length, 1);
      assert.ok(noteId);
      assert.equal(notes[0].isInternalNote, true);
      assert.equal(
        (await readSiteContinuationHistory(scopedDb, tenantId, key.conversationId)).length,
        0,
      );
      await assert.rejects(
        scopedDb.transaction(async (tx) => {
          await tx
            .update(schema.agentFlowStates)
            .set({ collectedData: {} })
            .where(
              and(
                eq(schema.agentFlowStates.tenantId, tenantId),
                eq(schema.agentFlowStates.id, key.flowId),
              ),
            );
          await appendIndustrialJournal(tx, after, before, "collection", "message-b");
          throw new Error("ROLLBACK_TEST");
        }),
        /ROLLBACK_TEST/,
      );
      assert.deepEqual((await flow(key)).collectedData, data);
      assert.equal(
        (
          await scopedDb
            .select()
            .from(schema.messages)
            .where(
              and(
                eq(schema.messages.tenantId, tenantId),
                eq(schema.messages.conversationId, key.conversationId),
              ),
            )
        ).length,
        1,
      );
    },
  );
  await check(
    "reinício concorrente deduplica entrada, preserva dados e outros agentes",
    async () => {
      const key = await fixture();
      await scopedDb
        .update(schema.agentFlowStates)
        .set({ collectedData: data })
        .where(
          and(
            eq(schema.agentFlowStates.tenantId, tenantId),
            eq(schema.agentFlowStates.id, key.flowId),
          ),
        );
      await scopedDb.insert(schema.agentFlowStates).values({
        id: `super-${key.conversationId}`,
        tenantId,
        conversationId: key.conversationId,
        agentType: "supervisor",
        currentStep: "Ativo",
      });
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          restartIndustrialCycle(scopedDb, tenantId, key.conversationId, {
            reason: "reset",
            sourceKey: "same-message",
          }),
        ),
      );
      assert.equal(results.filter((row) => !row?.replayed).length, 1);
      assert.equal(results.filter((row) => row?.replayed).length, 5);
      const page = await listHistoryCycles(
        scopedDb,
        tenantId,
        key.conversationId,
        historyPageInput(
          "cycles",
          historyQueryScope(tenantId, { conversationId: key.conversationId }),
          null,
          null,
        ),
      );
      assert.equal(page.items.length, 2);
      const archived = page.items.find((row) => !row.isCurrent)!;
      assert.deepEqual(archived.snapshot!.collectedData, data);
      assert.equal(archived.source, "journal");
      const others = await scopedDb
        .select()
        .from(schema.agentFlowStates)
        .where(
          and(
            eq(schema.agentFlowStates.tenantId, tenantId),
            eq(schema.agentFlowStates.id, `super-${key.conversationId}`),
          ),
        );
      assert.equal(others.length, 1);
      assert.equal(
        await restartIndustrialCycle(scopedDb, otherTenant, key.conversationId, {
          reason: "reset",
          sourceKey: "foreign",
        }),
        null,
      );
      await assert.rejects(
        listHistoryCycles(
          scopedDb,
          otherTenant,
          key.conversationId,
          historyPageInput("cycles", "x", null, null),
        ),
        HistoryNotFoundError,
      );
    },
  );
  await check(
    "mais de vinte ciclos completos continuam acessíveis sem repetir ou confundir o atual",
    async () => {
      const key = await fixture();
      const scope = historyQueryScope(tenantId, { conversationId: key.conversationId });
      const receivedAt = new Date();
      for (let index = 0; index < 23; index++)
        await restartIndustrialCycle(scopedDb, tenantId, key.conversationId, {
          reason: "reset",
          sourceKey: `reset-${index}`,
          receivedAt,
        });
      const items = [];
      let cursor: string | null = null;
      do {
        const page = await listHistoryCycles(
          scopedDb,
          tenantId,
          key.conversationId,
          historyPageInput("cycles", scope, cursor, "7"),
        );
        items.push(...page.items);
        cursor = page.pageInfo.nextCursor;
      } while (cursor);
      assert.equal(items.length, 24);
      assert.equal(new Set(items.map((row) => row.snapshot!.cycleId)).size, 24);
      assert.equal(items.filter((row) => row.isCurrent).length, 1);
      assert.ok(items.every((row) => row.dataAvailable));
    },
  );
  await check("resumos legados são identificados sem inventar coleta ou notas", async () => {
    const key = await fixture();
    await scopedDb
      .update(schema.agentFlowStates)
      .set({
        metadata: {
          previousTriages: [
            {
              id: "old",
              startedAt: "2026-01-01T10:00:00.000Z",
              outcome: "completed",
              targetFunnel: "Peças",
            },
          ],
        },
      })
      .where(
        and(
          eq(schema.agentFlowStates.tenantId, tenantId),
          eq(schema.agentFlowStates.id, key.flowId),
        ),
      );
    const cycles = await listHistoryCycles(
      scopedDb,
      tenantId,
      key.conversationId,
      historyPageInput(
        "cycles",
        historyQueryScope(tenantId, { conversationId: key.conversationId }),
        null,
        null,
      ),
    );
    const legacy = cycles.items.find((row) => row.source === "legacy_summary")!;
    assert.equal(legacy.dataAvailable, false);
    assert.deepEqual(legacy.snapshot!.collectedData, {});
    assert.equal(legacy.isCurrent, false);
    assert.equal(legacy.snapshot!.targetFunnel, "Peças");
    await restartIndustrialCycle(scopedDb, tenantId, key.conversationId, {
      reason: "reset",
      sourceKey: "preserve-legacy",
    });
    // Simula a saída do resumo da janela limitada do metadado; a nota durável o mantém.
    await scopedDb
      .update(schema.agentFlowStates)
      .set({ metadata: {} })
      .where(
        and(
          eq(schema.agentFlowStates.tenantId, tenantId),
          eq(schema.agentFlowStates.conversationId, key.conversationId),
          eq(schema.agentFlowStates.agentType, "sdr"),
        ),
      );
    const preserved = await listHistoryCycles(
      scopedDb,
      tenantId,
      key.conversationId,
      historyPageInput(
        "cycles",
        historyQueryScope(tenantId, { conversationId: key.conversationId }),
        null,
        null,
      ),
    );
    assert.equal(
      preserved.items.find((row) => row.snapshot!.flowId === "old")?.dataAvailable,
      false,
    );
  });
  await check(
    "notas paginam por ciclo com desempate e isolamento, inclusive no mesmo horário",
    async () => {
      const key = await fixture();
      const before = await flow(key);
      const cycleId = buildJournalSnapshot(before).cycleId;
      for (let index = 0; index < 5; index++)
        await scopedDb.transaction((tx) =>
          appendIndustrialJournal(
            tx,
            null,
            { ...before, collectedData: { CAMPO: { value: String(index), status: "filled" } } },
            "collection",
            String(index),
          ),
        );
      const stamp = new Date(Date.now() - 1000);
      await scopedDb
        .update(schema.messages)
        .set({ sentAt: sql`${stamp.toISOString()}::timestamp + interval '123 microseconds'` })
        .where(
          and(
            eq(schema.messages.tenantId, tenantId),
            eq(schema.messages.conversationId, key.conversationId),
          ),
        );
      const scope = `${historyQueryScope(tenantId, { conversationId: key.conversationId })}:${cycleId}`;
      const first = await listHistoryEvents(
        scopedDb,
        tenantId,
        key.conversationId,
        cycleId,
        historyPageInput("events", scope, null, "2"),
      );
      const second = await listHistoryEvents(
        scopedDb,
        tenantId,
        key.conversationId,
        cycleId,
        historyPageInput("events", scope, first.pageInfo.nextCursor, "2"),
      );
      const third = await listHistoryEvents(
        scopedDb,
        tenantId,
        key.conversationId,
        cycleId,
        historyPageInput("events", scope, second.pageInfo.nextCursor, "2"),
      );
      assert.equal(
        new Set([...first.items, ...second.items, ...third.items].map((row) => row.id)).size,
        5,
      );
      assert.equal(third.pageInfo.nextCursor, null);
      const empty = await listHistoryEvents(
        scopedDb,
        tenantId,
        key.conversationId,
        "outro-ciclo",
        historyPageInput("events", "x", null, null),
      );
      assert.equal(empty.items.length, 0);
      await assert.rejects(
        listHistoryEvents(
          scopedDb,
          otherTenant,
          key.conversationId,
          cycleId,
          historyPageInput("events", "x", null, null),
        ),
        HistoryNotFoundError,
      );
    },
  );
  await check(
    "busca paginada alcança mais de cinquenta atendimentos sem vazamento entre tenants",
    async () => {
      const key = await fixture();
      const [conv] = await scopedDb
        .select()
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.tenantId, tenantId),
            eq(schema.conversations.id, key.conversationId),
          ),
        );
      const name = `Arquivo histórico ${key.conversationId}`;
      await scopedDb
        .update(schema.contacts)
        .set({ name })
        .where(and(eq(schema.contacts.tenantId, tenantId), eq(schema.contacts.id, conv.contactId)));
      const createdAt = new Date(Date.now() - 5000);
      const rows = Array.from({ length: 55 }, (_, index) => ({
        id: `${key.conversationId}-history-${index}`,
        tenantId,
        contactId: `${key.conversationId}-history-contact-${index}`,
        createdAt: sql`${createdAt.toISOString()}::timestamp + interval '123 microseconds'`,
      }));
      await scopedDb.insert(schema.contacts).values(
        rows.map((row) => ({
          id: row.contactId,
          tenantId,
          name,
          phone: row.contactId,
          mainChannel: "whatsapp",
        })),
      );
      await scopedDb.insert(schema.conversations).values(rows);
      await scopedDb.insert(schema.agentFlowStates).values(
        rows.map((row) => ({
          id: `sdr-${row.id}`,
          tenantId,
          conversationId: row.id,
          agentType: "sdr",
          currentStep: "Coleta",
        })),
      );
      const items = [];
      let cursor: string | null = null;
      do {
        const page = await listHistoryConversations(
          scopedDb,
          tenantId,
          name,
          historyPageInput(
            "conversations",
            historyQueryScope(tenantId, { query: name }),
            cursor,
            "11",
          ),
        );
        items.push(...page.items);
        cursor = page.pageInfo.nextCursor;
      } while (cursor);
      assert.equal(items.length, 56);
      assert.equal(new Set(items.map((row) => row.id)).size, 56);
      assert.equal(
        (
          await listHistoryConversations(
            scopedDb,
            otherTenant,
            name,
            historyPageInput("conversations", "x", null, null),
          )
        ).items.length,
        0,
      );
    },
  );
  await check(
    "interrupção manual preserva coleta e responsável e escreve uma única nota",
    async () => {
      const key = await fixture();
      await scopedDb
        .update(schema.agentFlowStates)
        .set({ collectedData: data })
        .where(
          and(
            eq(schema.agentFlowStates.tenantId, tenantId),
            eq(schema.agentFlowStates.id, key.flowId),
          ),
        );
      await scopedDb
        .update(schema.conversations)
        .set({ operatorId: opA, queueState: "meus" })
        .where(
          and(
            eq(schema.conversations.tenantId, tenantId),
            eq(schema.conversations.id, key.conversationId),
          ),
        );
      assert.equal(
        await stopIndustrialCycle(scopedDb, otherTenant, key.conversationId, outsider),
        false,
      );
      assert.equal(await stopIndustrialCycle(scopedDb, tenantId, key.conversationId, opA), true);
      await stopIndustrialCycle(scopedDb, tenantId, key.conversationId, opA);
      assert.equal((await flow(key)).outcome, "stopped");
      assert.deepEqual((await flow(key)).collectedData, data);
      const [conversation] = await scopedDb
        .select()
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.tenantId, tenantId),
            eq(schema.conversations.id, key.conversationId),
          ),
        );
      assert.equal(conversation.operatorId, opA);
      assert.equal(conversation.queueState, "meus");
      assert.equal(
        (
          await scopedDb
            .select()
            .from(schema.messages)
            .where(
              and(
                eq(schema.messages.tenantId, tenantId),
                eq(schema.messages.conversationId, key.conversationId),
              ),
            )
        ).length,
        1,
      );
    },
  );
  await check(
    "reabertura preserva os não lidos e não reinicia atendimento já tomado por humano",
    async () => {
      const key = await fixture();
      await scopedDb
        .update(schema.conversations)
        .set({ operatorId: opA, queueState: "meus", unreadCount: 3 })
        .where(
          and(
            eq(schema.conversations.tenantId, tenantId),
            eq(schema.conversations.id, key.conversationId),
          ),
        );
      assert.equal(
        await restartIndustrialCycle(scopedDb, tenantId, key.conversationId, {
          reason: "reopened",
          sourceKey: "new-message",
        }),
        null,
      );
      assert.ok(await flow(key));
      await scopedDb
        .update(schema.conversations)
        .set({ operatorId: null, queueState: "fila" })
        .where(
          and(
            eq(schema.conversations.tenantId, tenantId),
            eq(schema.conversations.id, key.conversationId),
          ),
        );
      const reopened = await restartIndustrialCycle(scopedDb, tenantId, key.conversationId, {
        reason: "reopened",
        sourceKey: "new-message",
      });
      assert.equal(reopened!.conversation.unreadCount, 3);
      assert.equal(reopened!.conversation.queueState, "automacao");
      assert.equal(
        (await restartIndustrialCycle(scopedDb, tenantId, key.conversationId, {
          reason: "reopened",
          sourceKey: "new-message",
        }))!.replayed,
        true,
      );
    },
  );
  const reviewAdmin: ReviewActor = {
    id: opA,
    name: "Nome vindo do cliente não será usado",
    role: "admin",
    permissions: {
      canView: true,
      canViewAll: true,
      canEditClientInfo: true,
      canSendInternalNotes: true,
      canOverrideChat: true,
    },
  };
  const reviewInputFor = (
    current: Awaited<ReturnType<typeof readIndustrialReview>>,
    fields: Record<string, { value: string; status: "filled" | "pending" }> = {},
  ) => ({
    cycleId: current.snapshot.cycleId,
    expectedRevision: current.revision,
    reason: "Conferido com o cliente",
    fields,
  });
  async function pausedReviewFixture() {
    const key = await fixture();
    await scopedDb
      .update(schema.agentFlowStates)
      .set({ outcome: "stopped", collectedData: data })
      .where(
        and(
          eq(schema.agentFlowStates.tenantId, tenantId),
          eq(schema.agentFlowStates.id, key.flowId),
        ),
      );
    return key;
  }
  await check(
    "revisão humana registra dados, autor real, motivo e briefing sem criar card ou alterar dono",
    async () => {
      const key = await pausedReviewFixture();
      const current = await readIndustrialReview(
        scopedDb,
        tenantId,
        key.conversationId,
        reviewAdmin,
      );
      const beforeDeals = await count(schema.crmDeals);
      const revised = await saveIndustrialReview(scopedDb, tenantId, reviewAdmin, {
        ...reviewInputFor(current),
        conversationId: key.conversationId,
        fields: { "NOME COMPLETO": { value: "Nome corrigido", status: "filled" } },
      });
      assert.equal(revised.snapshot.collectedData["NOME COMPLETO"].value, "Nome corrigido");
      assert.equal(revised.snapshot.humanReview!.current, true);
      assert.equal(
        revised.snapshot.humanReview!.operatorName,
        (
          await scopedDb
            .select()
            .from(schema.operators)
            .where(and(eq(schema.operators.tenantId, tenantId), eq(schema.operators.id, opA)))
        )[0].name,
      );
      assert.equal((await flow(key)).outcome, "stopped");
      assert.equal(await count(schema.crmDeals), beforeDeals);
      const notes = await scopedDb
        .select()
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.tenantId, tenantId),
            eq(schema.messages.conversationId, key.conversationId),
          ),
        );
      assert.equal(notes.length, 1);
      assert.equal(notes[0].isInternalNote, true);
      assert.match(notes[0].content, /BRIEFING FINAL/);
      await assert.rejects(
        saveIndustrialReview(scopedDb, tenantId, reviewAdmin, {
          ...reviewInputFor(current),
          conversationId: key.conversationId,
        }),
        (error) => error instanceof IndustrialReviewError && error.status === 409,
      );
    },
  );
  await check(
    "duas revisões simultâneas não sobrescrevem dados sem detectar conflito",
    async () => {
      const key = await pausedReviewFixture();
      const current = await readIndustrialReview(
        scopedDb,
        tenantId,
        key.conversationId,
        reviewAdmin,
      );
      const outcomes = await Promise.allSettled(
        ["Primeiro", "Segundo"].map((value) =>
          saveIndustrialReview(scopedDb, tenantId, reviewAdmin, {
            ...reviewInputFor(current),
            conversationId: key.conversationId,
            fields: { EMPRESA: { value, status: "filled" } },
          }),
        ),
      );
      assert.equal(outcomes.filter((row) => row.status === "fulfilled").length, 1);
      const rejected = outcomes.find((row) => row.status === "rejected") as PromiseRejectedResult;
      assert.equal((rejected.reason as IndustrialReviewError).status, 409);
      const notes = await scopedDb
        .select()
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.tenantId, tenantId),
            eq(schema.messages.conversationId, key.conversationId),
          ),
        );
      assert.equal(notes.length, 1);
    },
  );
  await check(
    "tenant estrangeiro, operador alheio e automação ativa não podem revisar",
    async () => {
      const key = await fixture();
      const current = await readIndustrialReview(
        scopedDb,
        tenantId,
        key.conversationId,
        reviewAdmin,
      );
      await assert.rejects(
        saveIndustrialReview(scopedDb, tenantId, reviewAdmin, {
          ...reviewInputFor(current),
          conversationId: key.conversationId,
        }),
        (error) => error instanceof IndustrialReviewError && error.status === 403,
      );
      await assert.rejects(
        readIndustrialReview(scopedDb, otherTenant, key.conversationId, reviewAdmin),
        (error) => error instanceof IndustrialReviewError && error.status === 404,
      );
      await scopedDb
        .update(schema.agentFlowStates)
        .set({ outcome: "stopped" })
        .where(
          and(
            eq(schema.agentFlowStates.tenantId, tenantId),
            eq(schema.agentFlowStates.id, key.flowId),
          ),
        );
      const paused = await readIndustrialReview(
        scopedDb,
        tenantId,
        key.conversationId,
        reviewAdmin,
      );
      await assert.rejects(
        saveIndustrialReview(
          scopedDb,
          tenantId,
          { ...reviewAdmin, id: outsider },
          { ...reviewInputFor(paused), conversationId: key.conversationId },
        ),
        (error) => error instanceof IndustrialReviewError && error.status === 403,
      );
      await scopedDb
        .update(schema.conversations)
        .set({ operatorId: opA, queueState: "meus" })
        .where(
          and(
            eq(schema.conversations.tenantId, tenantId),
            eq(schema.conversations.id, key.conversationId),
          ),
        );
      const unrelated = {
        ...reviewAdmin,
        id: opB,
        role: "operator",
        permissions: { ...reviewAdmin.permissions, canOverrideChat: false },
      };
      const forbidden = await readIndustrialReview(
        scopedDb,
        tenantId,
        key.conversationId,
        unrelated,
      );
      assert.equal(forbidden.access.editable, false);
      await assert.rejects(
        saveIndustrialReview(scopedDb, tenantId, unrelated, {
          ...reviewInputFor(forbidden),
          conversationId: key.conversationId,
        }),
        (error) => error instanceof IndustrialReviewError && error.status === 403,
      );
    },
  );
  await check(
    "revisar após encaminhamento preserva recibo, carteira e contador e anexa atividade ao mesmo card",
    async () => {
      const key = await fixture();
      await prepare(key);
      const result = await store.execute(key);
      assert.equal(result.status, "transferred");
      const before = await flow(key);
      const beforeMeta = before.metadata as Record<string, unknown>;
      const counters = await config();
      const beforeDeals = await count(schema.crmDeals);
      const current = await readIndustrialReview(
        scopedDb,
        tenantId,
        key.conversationId,
        reviewAdmin,
      );
      const revised = await saveIndustrialReview(scopedDb, tenantId, reviewAdmin, {
        ...reviewInputFor(current),
        conversationId: key.conversationId,
        fields: { "VOLUME / PRODUÇÃO": { value: "200 por dia", status: "filled" } },
      });
      const after = await flow(key);
      const afterMeta = after.metadata as Record<string, unknown>;
      assert.deepEqual(afterMeta.handoffRequest, beforeMeta.handoffRequest);
      assert.deepEqual(afterMeta.handoffReceipt, beforeMeta.handoffReceipt);
      assert.deepEqual((await config()).flowOperators, counters.flowOperators);
      assert.equal(await count(schema.crmDeals), beforeDeals);
      assert.equal(revised.snapshot.machine!.status, "review");
      assert.equal(revised.snapshot.machine!.machineId, null);
      const activities = await scopedDb
        .select()
        .from(schema.crmDealActivities)
        .where(
          and(
            eq(schema.crmDealActivities.tenantId, tenantId),
            eq(schema.crmDealActivities.conversationId, key.conversationId),
          ),
        );
      assert.equal(activities.filter((row) => row.title === "Briefing final da triagem").length, 1);
      assert.equal(activities.filter((row) => row.title === "Revisão humana da triagem").length, 1);
      assert.match(
        activities.find((row) => row.title === "Revisão humana da triagem")!.description!,
        /200 por dia/,
      );
      assert.equal((await store.execute(key)).replayed, true);
    },
  );
  await check(
    "alterar documento invalida enriquecimento antigo e não mantém aliases conflitantes",
    async () => {
      const key = await pausedReviewFixture();
      await scopedDb
        .update(schema.agentFlowStates)
        .set({
          collectedData: {
            ...data,
            CNPJ: { value: "Antigo", status: "filled" },
            _RECEITA_FEDERAL: { razaoSocial: "Empresa antiga" },
          },
        })
        .where(
          and(
            eq(schema.agentFlowStates.tenantId, tenantId),
            eq(schema.agentFlowStates.id, key.flowId),
          ),
        );
      const current = await readIndustrialReview(
        scopedDb,
        tenantId,
        key.conversationId,
        reviewAdmin,
      );
      const revised = await saveIndustrialReview(scopedDb, tenantId, reviewAdmin, {
        ...reviewInputFor(current),
        conversationId: key.conversationId,
        fields: { "CNPJ OU CPF": { value: "52998224725", status: "filled" } },
      });
      assert.equal(revised.snapshot.collectedData.CNPJ, undefined);
      assert.equal(
        ((await flow(key)).collectedData as Record<string, unknown>)._RECEITA_FEDERAL,
        undefined,
      );
    },
  );
  await check("falha na nota reverte revisão e todos os efeitos da transação", async () => {
    const key = await pausedReviewFixture();
    const current = await readIndustrialReview(scopedDb, tenantId, key.conversationId, reviewAdmin);
    await scopedClient.unsafe(
      `CREATE FUNCTION fail_review_note() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.conversation_id = '${key.conversationId}' THEN RAISE EXCEPTION 'FAIL_NOTE'; END IF; RETURN NEW; END $$`,
    );
    await scopedClient.unsafe(
      "CREATE TRIGGER fail_review_note BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION fail_review_note()",
    );
    try {
      await assert.rejects(
        saveIndustrialReview(scopedDb, tenantId, reviewAdmin, {
          ...reviewInputFor(current),
          conversationId: key.conversationId,
          fields: { EMPRESA: { value: "Não deve persistir", status: "filled" } },
        }),
      );
      assert.equal(
        (await readIndustrialReview(scopedDb, tenantId, key.conversationId, reviewAdmin)).revision,
        current.revision,
      );
    } finally {
      await scopedClient.unsafe("DROP TRIGGER fail_review_note ON messages");
      await scopedClient.unsafe("DROP FUNCTION fail_review_note()");
    }
  });
  await check("sem resposta preserva briefing antes da retomada e não se repete", async () => {
    const key = await fixture();
    const original = await flow(key);
    const input = {
      flowId: key.flowId,
      cycle: key.cycle,
      expectedInteraction: original.lastInteractionAt.toISOString(),
      at: new Date(),
      reason: "idle_timeout",
    };
    assert.ok(await markIndustrialNoResponse(scopedDb, tenantId, key.conversationId, input));
    assert.equal(
      await markIndustrialNoResponse(scopedDb, tenantId, key.conversationId, input),
      null,
    );
    const [note] = await scopedDb
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.tenantId, tenantId),
          eq(schema.messages.conversationId, key.conversationId),
        ),
      );
    assert.match(note.content, /BRIEFING FINAL/);
    assert.match(note.content, /Sem resposta/);
    await scopedDb
      .update(schema.agentFlowStates)
      .set({ outcome: "in_progress", currentStep: "Retomado" })
      .where(
        and(
          eq(schema.agentFlowStates.tenantId, tenantId),
          eq(schema.agentFlowStates.id, key.flowId),
        ),
      );
    const [preserved] = await scopedDb
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.tenantId, tenantId), eq(schema.messages.id, note.id)));
    assert.equal(preserved.content, note.content);
  });
  await check(
    "decisão de silêncio atrasada não encerra nova coleta, ciclo ou atendimento humano",
    async () => {
      const key = await fixture();
      const original = await flow(key);
      const input = {
        flowId: key.flowId,
        cycle: key.cycle,
        expectedInteraction: original.lastInteractionAt.toISOString(),
        at: new Date(),
        reason: "idle_timeout",
      };
      assert.equal(
        await markIndustrialNoResponse(scopedDb, otherTenant, key.conversationId, input),
        null,
      );
      await scopedDb
        .update(schema.agentFlowStates)
        .set({ lastInteractionAt: new Date(+original.lastInteractionAt + 1000) })
        .where(
          and(
            eq(schema.agentFlowStates.tenantId, tenantId),
            eq(schema.agentFlowStates.id, key.flowId),
          ),
        );
      assert.equal(
        await markIndustrialNoResponse(scopedDb, tenantId, key.conversationId, input),
        null,
      );
      await scopedDb
        .update(schema.conversations)
        .set({ operatorId: opA, queueState: "meus" })
        .where(
          and(
            eq(schema.conversations.tenantId, tenantId),
            eq(schema.conversations.id, key.conversationId),
          ),
        );
      assert.equal(
        await markIndustrialNoResponse(scopedDb, tenantId, key.conversationId, {
          ...input,
          expectedInteraction: new Date(+original.lastInteractionAt + 1000).toISOString(),
        }),
        null,
      );
      assert.equal((await flow(key)).outcome, "in_progress");
    },
  );
  await check("falha da atividade CRM reverte correção e nota da revisão humana", async () => {
    const key = await fixture();
    await prepare(key);
    assert.equal((await store.execute(key)).status, "transferred");
    const current = await readIndustrialReview(scopedDb, tenantId, key.conversationId, reviewAdmin);
    const beforeNotes = await scopedDb
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.tenantId, tenantId),
          eq(schema.messages.conversationId, key.conversationId),
        ),
      );
    await scopedClient.unsafe(
      `CREATE FUNCTION fail_review_activity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.conversation_id = '${key.conversationId}' AND NEW.title = 'Revisão humana da triagem' THEN RAISE EXCEPTION 'FAIL_ACTIVITY'; END IF; RETURN NEW; END $$`,
    );
    await scopedClient.unsafe(
      "CREATE TRIGGER fail_review_activity BEFORE INSERT ON crm_deal_activities FOR EACH ROW EXECUTE FUNCTION fail_review_activity()",
    );
    try {
      await assert.rejects(
        saveIndustrialReview(scopedDb, tenantId, reviewAdmin, {
          ...reviewInputFor(current),
          conversationId: key.conversationId,
          fields: { EMPRESA: { value: "Reverter", status: "filled" } },
        }),
      );
      assert.equal(
        (await readIndustrialReview(scopedDb, tenantId, key.conversationId, reviewAdmin)).revision,
        current.revision,
      );
      const afterNotes = await scopedDb
        .select()
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.tenantId, tenantId),
            eq(schema.messages.conversationId, key.conversationId),
          ),
        );
      assert.equal(afterNotes.length, beforeNotes.length);
    } finally {
      await scopedClient.unsafe("DROP TRIGGER fail_review_activity ON crm_deal_activities");
      await scopedClient.unsafe("DROP FUNCTION fail_review_activity()");
    }
  });
  await check(
    "destinos unificados distribuem financeiro e pós-venda preservando o assunto",
    async () => {
      const previous = await readIndustrialSettings(scopedDb, tenantId);
      const binding = { sectorId: "sector-sales", pipelineId: "pipe", stageId: "stage" };
      await saveIndustrialSettings(
        scopedDb,
        tenantId,
        previous.revision,
        {
          ...previous.settings,
          destinations: {
            ...previous.settings.destinations,
            FINANCEIRO: binding,
            POS_VENDA: binding,
          },
        },
        opA,
      );
      await mutateIndustrialRodizio(scopedDb, tenantId, (ops) =>
        ops.map((op) => ({
          ...op,
          isParticipating: true,
          isOnLeave: false,
          isPenalized: false,
          funnels: [...op.funnels, "Financeiro", "Pós-Venda"],
        })),
      );
      for (const [text, subject, createsDeal] of [
        ["Preciso de boleto", "2A_BOLETO", true],
        ["Preciso de XML", "2B_NF", true],
        ["Preciso de estorno", "2C_OUTROS", false],
        ["Quero rastrear meu pedido", "4A_RASTREAR", true],
        ["Nota fiscal do pedido", "4B_NF", true],
        ["Quero devolver a compra", "POS_VENDA", true],
      ] as const) {
        const key = await fixture();
        const chosenRoute = resolveIndustrialRoute({ text, collectedData: {} });
        await prepare(key, chosenRoute);
        const before = await count(schema.crmDeals);
        const result = await store.execute(key);
        assert.equal(result.status, "transferred", text);
        assert.equal(result.sectorId, "sector-sales");
        assert.equal((await flow(key)).metadata?.subflow, subject);
        assert.equal(await count(schema.crmDeals), before + (createsDeal ? 1 : 0));
      }
    },
  );
  await check(
    "pendência antiga usa destino unificado sem recriar configuração ou perder o assunto",
    async () => {
      const key = await fixture();
      const oldRoute = {
        ...resolveIndustrialRoute({ text: "Preciso de boleto", collectedData: {} }),
        targetFunnel: "Fin. Boleto",
      };
      // Simula checkpoint persistido pela versão anterior, sem depender de nova resposta da IA.
      await prepare(key, oldRoute as typeof route);
      assert.equal((await store.execute(key)).status, "transferred");
      assert.equal((await flow(key)).metadata?.subflow, "2A_BOLETO");
    },
  );
  await check(
    "conflito legado bloqueia encaminhamento sem efeitos e permite correção explícita",
    async () => {
      const previous = await readIndustrialSettings(scopedDb, tenantId);
      const finance = previous.settings.destinations.FINANCEIRO;
      const legacy = { ...previous.settings, destinations: { ...previous.settings.destinations } };
      delete legacy.destinations.FINANCEIRO;
      legacy.destinations["2A_BOLETO"] = finance;
      legacy.destinations["2B_NF"] = { ...finance, sectorId: "sector-review" };
      assert.equal(industrialSettingsSchema.safeParse(legacy).success, true);
      await scopedDb
        .update(schema.agentConfigs)
        .set({
          config: {
            settings: legacy,
            revision: previous.revision,
          },
        })
        .where(
          and(
            eq(schema.agentConfigs.tenantId, tenantId),
            eq(schema.agentConfigs.agentType, "industrial_triage"),
          ),
        );
      const key = await fixture();
      await prepare(key, resolveIndustrialRoute({ text: "Preciso de boleto", collectedData: {} }));
      const before = await count(schema.crmDeals);
      const counters = (await config()).flowOperators.map((op) => [op.id, op.leadsReceivedCount]);
      assert.equal((await store.execute(key)).status, "handoff_failed");
      assert.equal((await diagnostics(key)).handoffIssue?.code, "destination_conflict");
      assert.equal(await count(schema.crmDeals), before);
      assert.deepEqual(
        (await config()).flowOperators.map((op) => [op.id, op.leadsReceivedCount]),
        counters,
      );
      await assert.rejects(
        saveIndustrialSettings(scopedDb, tenantId, previous.revision, legacy, opA),
        /Financeiro/,
      );
      assert.equal((await readIndustrialSettings(scopedDb, tenantId)).revision, previous.revision);
      await saveIndustrialSettings(scopedDb, tenantId, previous.revision, previous.settings, opA);
      assert.equal((await store.execute(key)).status, "transferred");
    },
  );
  await check(
    "solicitação sem área identificada vai para revisão humana sem card fictício",
    async () => {
      const key = await fixture();
      const other = resolveIndustrialRoute({ aiFunnelStage: "outros", collectedData: {} });
      await prepare(key, other, null);
      const before = await count(schema.crmDeals);
      const result = await store.execute(key);
      assert.equal(result.status, "transferred");
      assert.equal(result.sectorId, "sector-review");
      assert.equal(result.deal, null);
      assert.equal(await count(schema.crmDeals), before);
      assert.equal((await flow(key)).metadata?.needsReview, true);
    },
  );
  await check(
    "origem e produto ficam no checkpoint, briefing e histórico sem alterar a coleta",
    async () => {
      const key = await fixture();
      const siteContext = captureSiteContext(
        {
          page: {
            url: "https://shop.example.test/seladora?utm_campaign=envase&token=secret",
            title: "Seladora",
          },
          product: {
            url: "https://shop.example.test/seladora",
            name: "Seladora S100",
            sku: "S100",
          },
        },
        "https://shop.example.test",
        new Date(),
        true,
      )!;
      await prepare(key, route, undefined, siteContext);
      assert.deepEqual((await flow(key)).metadata?.siteContext, siteContext);
      assert.equal((await store.execute(key)).status, "transferred");
      const current = await readIndustrialReview(
        scopedDb,
        tenantId,
        key.conversationId,
        reviewAdmin,
      );
      assert.deepEqual(current.snapshot.siteContext, siteContext);
      const notes = await scopedDb
        .select()
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.tenantId, tenantId),
            eq(schema.messages.conversationId, key.conversationId),
            eq(schema.messages.isInternalNote, true),
          ),
        );
      assert.ok(
        notes.some((note) =>
          note.content.includes("Última consulta explícita de produto: Seladora S100"),
        ),
      );
      assert.ok(!notes.some((note) => note.content.includes("token=secret")));
      assert.deepEqual(current.snapshot.collectedData, data);
      const activities = await scopedDb
        .select()
        .from(schema.crmDealActivities)
        .where(
          and(
            eq(schema.crmDealActivities.tenantId, tenantId),
            eq(schema.crmDealActivities.conversationId, key.conversationId),
          ),
        );
      assert.ok(
        activities.some((activity) => activity.description?.includes("utm_campaign=envase")),
      );
    },
  );
  console.log(
    JSON.stringify({
      suite: "industrial-handoff-postgres",
      passed,
      database: identity.name,
      isolatedSchema: testSchema,
    }),
  );
} finally {
  await scopedClient.end();
  await client.unsafe(`DROP SCHEMA IF EXISTS ${q(testSchema)} CASCADE`);
  await client.end();
  await defaultClient.end();
}
