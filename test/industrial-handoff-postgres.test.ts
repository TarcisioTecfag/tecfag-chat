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
import { createIndustrialHandoffStore } from "../src/lib/triage/industrial-handoff-store";
import {
  mutateIndustrialRodizio,
  mergeIndustrialOperatorSettings,
} from "../src/lib/triage/industrial-rodizio-store";
import { recoverIndustrialHandoffs } from "../src/lib/triage/industrial-handoff-recovery";
import { resolveIndustrialRoute } from "../src/lib/triage/industrial-policy";
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
) {
  const configuration = await readIndustrialSettings(scopedDb, key.tenantId);
  assert.equal(
    await store.prepare(key, {
      route: chosenRoute,
      data,
      clientName: "Pessoa de Teste",
      companyName: "Empresa Teste",
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
      assert.equal(await count(schema.crmDealActivities), 1);
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
      assert.equal((await store.execute(key)).status, "transferred");
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
