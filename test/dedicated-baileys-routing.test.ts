import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import * as orm from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { loadAccessSource } from "./helpers/access-harness.mjs";

const schema = loadAccessSource("src/db/schema.ts", {
  "drizzle-orm": orm,
  "drizzle-orm/pg-core": pg,
});
const policy = loadAccessSource("src/lib/whatsapp/connection-policy.ts");
const cryptoLib = loadAccessSource("src/lib/whatsapp/connection-crypto.ts", {
  "./connection-policy": policy,
});
const sitePolicy = {
  isSiteConversationId: (id: string) => typeof id === "string" && id.startsWith("conv-lc-"),
};

let client: PGlite;
let db: any;
let routing: any;
let access: any;
let connectionService: any;

const originalFlag = process.env.WHATSAPP_MULTI_CONNECTION_TENANTS;
const originalKey = process.env.WHATSAPP_CONNECTION_ENCRYPTION_KEY;

const TENANT_DEDICATED = "tenant-dedicated-test";
const TENANT_VALEM_ISOLATED = "valem";

const makeSession = (operatorId: string, role: "agent" | "admin" = "agent") => ({
  tenantId: TENANT_DEDICATED,
  operator: { id: operatorId, role, name: operatorId },
  permissions: {
    views: { chat: true, settings: true },
    chat: {
      canCaptureChat: true,
      canTransferChat: true,
      canFinishChat: true,
      canViewAllChats: true,
      restrictToOwnChats: false,
    },
  },
  accessGroup: { allowedChannels: ["whatsapp"] },
});

beforeAll(async () => {
  process.env.WHATSAPP_MULTI_CONNECTION_TENANTS = TENANT_DEDICATED;
  process.env.WHATSAPP_CONNECTION_ENCRYPTION_KEY = "cd".repeat(32);

  client = new PGlite();
  db = drizzle(client, { schema });

  const tables = [
    schema.tenants,
    schema.accessGroups,
    schema.sectors,
    schema.operators,
    schema.crmAccounts,
    schema.contacts,
    schema.contactPhones,
    schema.conversations,
    schema.messages,
    schema.mediaFiles,
    schema.pendingInbounds,
    schema.channelConfigs,
    schema.crmPipelines,
    schema.crmStages,
    schema.crmDeals,
    schema.crmDealContacts,
    schema.crmConversationDeals,
    schema.conversationDealContexts,
    schema.crmDealActivities,
    schema.crmActionHistory,
  ];

  for (const table of tables) {
    const config = pg.getTableConfig(table);
    const columns = config.columns
      .filter(
        (c: any) =>
          !(
            ["conversations", "messages", "pending_inbounds"].includes(config.name) &&
            c.name === "whatsapp_connection_id"
          ),
      )
      .map((c: any) => {
        const type = c.getSQLType();
        const defaultValue = type.includes("timestamp")
          ? " DEFAULT now()"
          : type === "integer"
            ? " DEFAULT 0"
            : type === "boolean"
              ? " DEFAULT false"
              : type === "jsonb"
                ? " DEFAULT '{}'::jsonb"
                : "";
        return `"${c.name}" ${type}${c.name === "id" ? " PRIMARY KEY" : defaultValue}`;
      });
    await client.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`);
  }

  await client.exec(
    fs.readFileSync("src/db/migrations/0047_whatsapp_multi_connection.sql", "utf8"),
  );
  await client.exec(
    fs.readFileSync("src/db/migrations/0048_whatsapp_connection_group_access.sql", "utf8"),
  );

  // Seed tenants
  await db.insert(schema.tenants).values([
    { id: TENANT_DEDICATED, name: "Tenant Dedicated", slug: "tenant-dedicated", connectionType: "meta" },
    { id: TENANT_VALEM_ISOLATED, name: "Valem", slug: "valem", connectionType: "baileys" },
  ]);

  await db.insert(schema.channelConfigs).values([
    { id: "cfg-ded", tenantId: TENANT_DEDICATED, activeProvider: "meta", connectionStatus: "connected" },
    { id: "cfg-val", tenantId: TENANT_VALEM_ISOLATED, activeProvider: "baileys", connectionStatus: "connected" },
  ]);

  await db.insert(schema.sectors).values([
    { id: "sec-pers", tenantId: TENANT_DEDICATED, name: "Personnalité", operatorIds: ["pers-a", "pers-b", "pers-off"] },
    { id: "sec-maq", tenantId: TENANT_DEDICATED, name: "Máquinas", operatorIds: ["regular-op"] },
  ]);

  await db.insert(schema.operators).values([
    { id: "pers-a", tenantId: TENANT_DEDICATED, name: "Vendedor Pers A", email: "pa@test.local", passwordHash: "x", role: "agent" },
    { id: "pers-b", tenantId: TENANT_DEDICATED, name: "Vendedor Pers B", email: "pb@test.local", passwordHash: "x", role: "agent" },
    { id: "pers-off", tenantId: TENANT_DEDICATED, name: "Vendedor Pers Off", email: "po@test.local", passwordHash: "x", role: "agent" },
    { id: "regular-op", tenantId: TENANT_DEDICATED, name: "Vendedor Comum", email: "reg@test.local", passwordHash: "x", role: "agent" },
    { id: "admin-op", tenantId: TENANT_DEDICATED, name: "Admin Master", email: "adm@test.local", passwordHash: "x", role: "admin" },
    { id: "valem-op", tenantId: TENANT_VALEM_ISOLATED, name: "Valem Op", email: "v@test.local", passwordHash: "x", role: "agent" },
  ]);

  const futureLease = new Date(Date.now() + 60_000);
  await db.insert(schema.whatsappConnections).values([
    {
      id: "conn-pers-a",
      tenantId: TENANT_DEDICATED,
      name: "Celular Pers A",
      provider: "baileys",
      ownerOperatorId: "pers-a",
      enabled: true,
      capturePolicy: "selected",
      baileysSessionStatus: "connected",
      baileysPairedPhone: "5514999990001",
      leaseUntil: futureLease,
    },
    {
      id: "conn-pers-b",
      tenantId: TENANT_DEDICATED,
      name: "Celular Pers B",
      provider: "baileys",
      ownerOperatorId: "pers-b",
      enabled: true,
      capturePolicy: "selected",
      baileysSessionStatus: "connected",
      baileysPairedPhone: "5514999990002",
      leaseUntil: futureLease,
    },
    {
      id: "conn-pers-off",
      tenantId: TENANT_DEDICATED,
      name: "Celular Pers Off",
      provider: "baileys",
      ownerOperatorId: "pers-off",
      enabled: true,
      capturePolicy: "selected",
      baileysSessionStatus: "disconnected",
      baileysPairedPhone: "5514999990003",
      leaseUntil: null,
    },
    {
      id: "conn-admin",
      tenantId: TENANT_DEDICATED,
      name: "Celular Admin",
      provider: "baileys",
      ownerOperatorId: "admin-op",
      enabled: true,
      capturePolicy: "selected",
      baileysSessionStatus: "connected",
      baileysPairedPhone: "5514999990004",
      leaseUntil: futureLease,
    },
  ]);

  await db.insert(schema.crmPipelines).values({
    id: "pipe-1",
    tenantId: TENANT_DEDICATED,
    name: "Funil Personnalité",
    orderIndex: 0,
    isDefault: true,
  });
  await db.insert(schema.crmStages).values({
    id: "stg-1",
    tenantId: TENANT_DEDICATED,
    pipelineId: "pipe-1",
    name: "Qualificação",
    orderIndex: 0,
    isWinStage: false,
    isLossStage: false,
  });

  await db.insert(schema.contacts).values([
    {
      id: "contact-1",
      tenantId: TENANT_DEDICATED,
      name: "Cliente Indústria X",
      phone: "5511988887777",
      mainChannel: "whatsapp",
      responsibleName: "Na Fila",
    },
    {
      id: "contact-inbound",
      tenantId: TENANT_DEDICATED,
      name: "Cliente Carteira Pers A",
      phone: "5511977776666",
      mainChannel: "whatsapp",
      walletOperatorId: "pers-a",
      responsibleName: "Vendedor Pers A",
    },
  ]);

  await db.insert(schema.crmDeals).values({
    id: "deal-1",
    tenantId: TENANT_DEDICATED,
    title: "Máquina Personnalité X",
    pipelineId: "pipe-1",
    stageId: "stg-1",
    status: "open",
    operatorId: "pers-a",
  });

  await db.insert(schema.crmDealContacts).values({
    id: "dc-1",
    tenantId: TENANT_DEDICATED,
    dealId: "deal-1",
    contactId: "contact-1",
    isPrimary: true,
  });

  await db.insert(schema.conversations).values([
    {
      id: "conv-meta-1",
      tenantId: TENANT_DEDICATED,
      contactId: "contact-1",
      operatorId: null,
      queueState: "automacao",
      lastMessageText: "Quero orçamento da linha Personnalité",
      version: 1,
    },
    {
      id: "conv-meta-inbound",
      tenantId: TENANT_DEDICATED,
      contactId: "contact-inbound",
      operatorId: "pers-a",
      queueState: "meus",
      lastMessageText: "Oi, mandei no número oficial",
      version: 1,
    },
  ]);

  await db.insert(schema.crmConversationDeals).values({
    id: "cd-meta-1",
    tenantId: TENANT_DEDICATED,
    conversationId: "conv-meta-1",
    dealId: "deal-1",
    origin: "chat",
    isActive: true,
  });
  await db.insert(schema.conversationDealContexts).values({
    tenantId: TENANT_DEDICATED,
    conversationId: "conv-meta-1",
    currentDealId: "deal-1",
    selectionRequired: true,
    version: 1,
  });

  const overrides = { "../../db": { db }, "../../db/schema": schema, "drizzle-orm": orm };
  connectionService = loadAccessSource("src/lib/whatsapp/connections.ts", {
    ...overrides,
    "./connection-policy": policy,
    "./connection-crypto": cryptoLib,
  });
  access = loadAccessSource("src/lib/access-control/conversation-access.ts", overrides);
  routing = loadAccessSource("src/lib/whatsapp/dedicated-routing.ts", {
    ...overrides,
    "../attendance-events": { setAttendanceActor: async () => {} },
    "../crm/conversation-deal-context": {
      endDealContext: async (tx: any, tenantId: string, convId: string) => {
        await tx
          .update(schema.conversationDealContexts)
          .set({ currentDealId: null })
          .where(
            orm.and(
              orm.eq(schema.conversationDealContexts.tenantId, tenantId),
              orm.eq(schema.conversationDealContexts.conversationId, convId),
            ),
          );
      },
      recordConversationAction: async () => {},
    },
    "../crm/deal-associations": {
      lockContactDeals: async () => {},
      syncConversationDeals: async () => true,
    },
    "../livechat/site-channel-policy": sitePolicy,
    "./connections": connectionService,
    "./connection-policy": policy,
  });
});

afterAll(async () => {
  await client?.close();
  if (originalFlag === undefined) delete process.env.WHATSAPP_MULTI_CONNECTION_TENANTS;
  else process.env.WHATSAPP_MULTI_CONNECTION_TENANTS = originalFlag;
  if (originalKey === undefined) delete process.env.WHATSAPP_CONNECTION_ENCRYPTION_KEY;
  else process.env.WHATSAPP_CONNECTION_ENCRYPTION_KEY = originalKey;
});

describe("Roteamento exclusivo Baileys dedicado (Personnalité)", () => {
  it("resolve conexão dedicada inclusive quando desconectada e preserva tenant Valem intocado", async () => {
    const connA = await routing.resolveOperatorDedicatedConnection(db, TENANT_DEDICATED, "pers-a");
    expect(connA?.id).toBe("conn-pers-a");
    expect(connA?.isConnectedLive).toBe(true);

    const connOff = await routing.resolveOperatorDedicatedConnection(db, TENANT_DEDICATED, "pers-off");
    expect(connOff?.id).toBe("conn-pers-off");
    expect(connOff?.isConnectedLive).toBe(false);
    expect(connOff?.status).toBe("disconnected");

    const connRegular = await routing.resolveOperatorDedicatedConnection(db, TENANT_DEDICATED, "regular-op");
    expect(connRegular).toBeNull();

    // Tenant valem não está em WHATSAPP_MULTI_CONNECTION_TENANTS → sempre null
    const connValem = await routing.resolveOperatorDedicatedConnection(db, TENANT_VALEM_ISOLATED, "valem-op");
    expect(connValem).toBeNull();
  });

  it("transfere Meta Oficial -> Baileys Pers A, encerra origem, migra CRM e registra contato selecionado", async () => {
    const [source] = await db
      .select()
      .from(schema.conversations)
      .where(orm.eq(schema.conversations.id, "conv-meta-1"));

    const target = await routing.resolveTargetConnectionForTransfer(
      db,
      TENANT_DEDICATED,
      "meus",
      "pers-a",
    );
    expect(target.connectionId).toBe("conn-pers-a");

    const result = await db.transaction((tx: any) =>
      routing.handoffConversationAcrossChannels(tx, {
        tenantId: TENANT_DEDICATED,
        sourceConversation: source,
        targetConnectionId: target.connectionId,
        targetConnectionInfo: target.connectionInfo,
        targetQueueState: "meus",
        targetOperatorId: "pers-a",
        targetOperatorName: "Vendedor Pers A",
        targetSectorId: "sec-pers",
        targetSectorName: "Personnalité",
        actorOperatorId: "admin-op",
        actorName: "SDR",
        preserveSourceOperatorId: "pers-a",
      }),
    );

    expect(result.redirected).toBe(true);
    expect(result.sourceConversation.queueState).toBe("finalizados");
    expect(result.targetConversation.whatsappConnectionId).toBe("conn-pers-a");
    expect(result.targetConversation.queueState).toBe("meus");
    expect(result.targetConversation.operatorId).toBe("pers-a");
    expect(result.targetConversation.sectorId).toBe("sec-pers");
    expect(result.transferredDealId).toBe("deal-1");

    // Contato registrado em whatsapp_connection_contacts para capturePolicy='selected'
    const [selected] = await db
      .select()
      .from(schema.whatsappConnectionContacts)
      .where(
        orm.and(
          orm.eq(schema.whatsappConnectionContacts.tenantId, TENANT_DEDICATED),
          orm.eq(schema.whatsappConnectionContacts.connectionId, "conn-pers-a"),
          orm.eq(schema.whatsappConnectionContacts.contactId, "contact-1"),
        ),
      );
    expect(selected).toBeTruthy();

    // Contexto CRM migrado para a nova thread e encerrado na origem
    const [targetCtx] = await db
      .select()
      .from(schema.conversationDealContexts)
      .where(orm.eq(schema.conversationDealContexts.conversationId, result.targetConversation.id));
    expect(targetCtx?.currentDealId).toBe("deal-1");

    const [sourceCtx] = await db
      .select()
      .from(schema.conversationDealContexts)
      .where(orm.eq(schema.conversationDealContexts.conversationId, "conv-meta-1"));
    expect(sourceCtx?.currentDealId).toBeNull();

    // Carteira atualizada
    const [cnt] = await db
      .select()
      .from(schema.contacts)
      .where(orm.eq(schema.contacts.id, "contact-1"));
    expect(cnt.walletOperatorId).toBe("pers-a");
  });

  it("transfere Baileys Pers A -> Baileys Pers B sem bloqueio, encerrando A e abrindo B", async () => {
    const [convA] = await db
      .select()
      .from(schema.conversations)
      .where(
        orm.and(
          orm.eq(schema.conversations.tenantId, TENANT_DEDICATED),
          orm.eq(schema.conversations.contactId, "contact-1"),
          orm.eq(schema.conversations.whatsappConnectionId, "conn-pers-a"),
        ),
      );
    expect(convA).toBeTruthy();

    const targetB = await routing.resolveTargetConnectionForTransfer(
      db,
      TENANT_DEDICATED,
      "meus",
      "pers-b",
    );
    expect(targetB.connectionId).toBe("conn-pers-b");

    const handoffB = await db.transaction((tx: any) =>
      routing.handoffConversationAcrossChannels(tx, {
        tenantId: TENANT_DEDICATED,
        sourceConversation: convA,
        targetConnectionId: targetB.connectionId,
        targetConnectionInfo: targetB.connectionInfo,
        targetQueueState: "meus",
        targetOperatorId: "pers-b",
        targetOperatorName: "Vendedor Pers B",
        actorOperatorId: "pers-a",
        actorName: "Vendedor Pers A",
      }),
    );

    expect(handoffB.redirected).toBe(true);
    expect(handoffB.sourceConversation.queueState).toBe("finalizados");
    expect(handoffB.targetConversation.whatsappConnectionId).toBe("conn-pers-b");
    expect(handoffB.targetConversation.operatorId).toBe("pers-b");
    expect(handoffB.targetConversation.queueState).toBe("meus");
    expect(handoffB.transferredDealId).toBe("deal-1");
  });

  it("transfere Baileys Pers B -> Vendedor Comum (sem Baileys) caindo no WhatsApp Oficial Meta", async () => {
    const [convB] = await db
      .select()
      .from(schema.conversations)
      .where(
        orm.and(
          orm.eq(schema.conversations.tenantId, TENANT_DEDICATED),
          orm.eq(schema.conversations.contactId, "contact-1"),
          orm.eq(schema.conversations.whatsappConnectionId, "conn-pers-b"),
        ),
      );

    const targetReg = await routing.resolveTargetConnectionForTransfer(
      db,
      TENANT_DEDICATED,
      "meus",
      "regular-op",
    );
    expect(targetReg.connectionId).toBeNull();

    const handoffMeta = await db.transaction((tx: any) =>
      routing.handoffConversationAcrossChannels(tx, {
        tenantId: TENANT_DEDICATED,
        sourceConversation: convB,
        targetConnectionId: targetReg.connectionId,
        targetQueueState: "meus",
        targetOperatorId: "regular-op",
        targetOperatorName: "Vendedor Comum",
        targetSectorId: "sec-maq",
        targetSectorName: "Máquinas",
        actorOperatorId: "pers-b",
        actorName: "Vendedor Pers B",
      }),
    );

    expect(handoffMeta.redirected).toBe(true);
    expect(handoffMeta.sourceConversation.queueState).toBe("finalizados");
    expect(handoffMeta.targetConversation.id).toBe("conv-meta-1");
    expect(handoffMeta.targetConversation.whatsappConnectionId).toBeNull();
    expect(handoffMeta.targetConversation.operatorId).toBe("regular-op");
    expect(handoffMeta.targetConversation.queueState).toBe("meus");
  });

  it("entrega no Baileys mesmo quando o celular do vendedor destino está desconectado (nunca cai na Meta)", async () => {
    const [convMeta] = await db
      .select()
      .from(schema.conversations)
      .where(orm.eq(schema.conversations.id, "conv-meta-1"));

    const targetOff = await routing.resolveTargetConnectionForTransfer(
      db,
      TENANT_DEDICATED,
      "meus",
      "pers-off",
    );
    expect(targetOff.connectionId).toBe("conn-pers-off");
    expect(targetOff.connectionInfo?.isConnectedLive).toBe(false);

    const handoffOff = await db.transaction((tx: any) =>
      routing.handoffConversationAcrossChannels(tx, {
        tenantId: TENANT_DEDICATED,
        sourceConversation: convMeta,
        targetConnectionId: targetOff.connectionId,
        targetConnectionInfo: targetOff.connectionInfo,
        targetQueueState: "meus",
        targetOperatorId: "pers-off",
        targetOperatorName: "Vendedor Pers Off",
        actorOperatorId: "regular-op",
        actorName: "Vendedor Comum",
      }),
    );

    expect(handoffOff.redirected).toBe(true);
    expect(handoffOff.targetConversation.whatsappConnectionId).toBe("conn-pers-off");
    expect(handoffOff.targetConnection?.isConnectedLive).toBe(false);

    const [note] = await db
      .select()
      .from(schema.messages)
      .where(orm.eq(schema.messages.id, handoffOff.targetSystemMessageId));
    expect(note.content).toContain("desconectado");
  });

  it("inbound Meta de cliente na carteira de vendedor dedicado mantém Meta fechado e notifica thread Baileys", async () => {
    const [corpConv] = await db
      .select()
      .from(schema.conversations)
      .where(orm.eq(schema.conversations.id, "conv-meta-inbound"));

    const res = await db.transaction((tx: any) =>
      routing.routeMetaInboundToDedicatedBaileys(tx, {
        tenantId: TENANT_DEDICATED,
        corporateConversation: corpConv,
        walletOperator: { id: "pers-a", name: "Vendedor Pers A", role: "agent" },
        messagePreview: "Oi, estou te chamando no oficial",
        timestamp: new Date(),
      }),
    );

    expect(res.redirected).toBe(true);
    expect(res.corporateConversation.queueState).toBe("finalizados");
    expect(res.corporateConversation.unreadCount).toBe(0);
    expect(res.dedicatedConversation?.whatsappConnectionId).toBe("conn-pers-a");
    expect(res.dedicatedConversation?.queueState).toBe("meus");
    expect(res.dedicatedConversation?.operatorId).toBe("pers-a");
    expect(res.dedicatedConversation?.unreadCount).toBe(1);
    expect(res.dedicatedConversation?.lastMessageText).toContain("[Recebida no Oficial]");
  });

  it("bloqueia envio externo pelo Meta Oficial para operador dedicado e permite para admin e operador comum", async () => {
    const deniedPers = await access.requireDedicatedChannelSendCompliance(
      makeSession("pers-a", "agent"),
      "conv-meta-1",
    );
    expect(deniedPers).not.toBeNull();
    expect(deniedPers.status).toBe(403);
    const body = await deniedPers.json();
    expect(body.code).toBe("DEDICATED_BAILEYS_ONLY");
    expect(body.dedicatedConnectionId).toBe("conn-pers-a");

    // Admin mantém master override no Meta Oficial
    const allowedAdmin = await access.requireDedicatedChannelSendCompliance(
      makeSession("admin-op", "admin"),
      "conv-meta-1",
    );
    expect(allowedAdmin).toBeNull();

    // Operador comum (sem Baileys) continua autorizado no Meta Oficial
    const allowedRegular = await access.requireDedicatedChannelSendCompliance(
      makeSession("regular-op", "agent"),
      "conv-meta-1",
    );
    expect(allowedRegular).toBeNull();

    // Conversa do canal Site nunca é bloqueada por esta regra
    const allowedSite = await access.requireDedicatedChannelSendCompliance(
      makeSession("pers-a", "agent"),
      "conv-lc-123",
    );
    expect(allowedSite).toBeNull();

    // Conversa Baileys própria do vendedor é permitida
    const [convA] = await db
      .select()
      .from(schema.conversations)
      .where(
        orm.and(
          orm.eq(schema.conversations.tenantId, TENANT_DEDICATED),
          orm.eq(schema.conversations.contactId, "contact-1"),
          orm.eq(schema.conversations.whatsappConnectionId, "conn-pers-a"),
        ),
      );
    const allowedOwnBaileys = await access.requireDedicatedChannelSendCompliance(
      makeSession("pers-a", "agent"),
      convA.id,
    );
    expect(allowedOwnBaileys).toBeNull();
  });
});
