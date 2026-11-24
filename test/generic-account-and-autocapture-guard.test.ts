import { describe, expect, test, beforeAll, afterAll, mock } from "bun:test";
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { DEFAULT_ADMIN_PERMISSIONS } from "../src/lib/rbac";
import {
  hasValidAccountDocument,
  isAccountEligibleForCrossContactPropagation,
  isGenericPlaceholderAccountName,
  MAX_UNVERIFIED_ACCOUNT_CONTACTS_FOR_PROPAGATION,
} from "../src/lib/crm/generic-account-guard";
import { getContactDealRows } from "../src/lib/crm/contact-deals-query";
import {
  syncAccountDealContacts,
  ensureLinkedDeviceConversationDeal,
} from "../src/lib/crm/deal-associations";

describe("generic-account-guard: bloqueio de contas-balde e placeholders", () => {
  test("reconhece nomes genéricos de formulário/placeholder", () => {
    expect(isGenericPlaceholderAccountName("formulario-contato")).toBe(true);
    expect(isGenericPlaceholderAccountName("Formulario de Contato")).toBe(true);
    expect(isGenericPlaceholderAccountName("LEAD SEM CADASTRO")).toBe(true);
    expect(isGenericPlaceholderAccountName("PESSOA FISICA - COMPRA REALIZADA PELO CPF")).toBe(true);
    expect(isGenericPlaceholderAccountName("Sem Empresa")).toBe(true);
    expect(isGenericPlaceholderAccountName("Não Informado")).toBe(true);
    expect(isGenericPlaceholderAccountName("Botão WhatsApp Site")).toBe(true);

    expect(isGenericPlaceholderAccountName("Colly Química Ltda")).toBe(false);
    expect(isGenericPlaceholderAccountName("LP COMERCIO DIGITAL LTDA")).toBe(false);
    expect(isGenericPlaceholderAccountName("Empresa")).toBe(false);
    expect(isGenericPlaceholderAccountName("Laticínios Tirolez Ltda")).toBe(false);
  });

  test("valida CNPJ e CPF reais e rejeita documentos vazios ou inválidos", () => {
    expect(hasValidAccountDocument("02.421.911/0001-18")).toBe(true); // CNPJ válido
    expect(hasValidAccountDocument("11.222.333/0001-81")).toBe(true); // CNPJ válido
    expect(hasValidAccountDocument("00.000.000/0000-00")).toBe(false);
    expect(hasValidAccountDocument("12345678000100")).toBe(false);
    expect(hasValidAccountDocument(null)).toBe(false);
    expect(hasValidAccountDocument("")).toBe(false);
  });

  test("bloqueia propagação para placeholder ou conta sem CNPJ com >10 contatos, mas libera empresa real", () => {
    // 1. Placeholder sempre bloqueado mesmo com 1 contato
    expect(
      isAccountEligibleForCrossContactPropagation({
        name: "formulario-contato",
        document: null,
        contactCount: 1,
      }),
    ).toBe(false);

    // 2. Conta sem CNPJ com >10 contatos (caso Magoga Especiarias com 137 contatos) -> bloqueada
    expect(
      isAccountEligibleForCrossContactPropagation({
        name: "Magoga Especiarias",
        document: null,
        contactCount: MAX_UNVERIFIED_ACCOUNT_CONTACTS_FOR_PROPAGATION + 1,
      }),
    ).toBe(false);

    // 3. Conta com CNPJ válido e 25 contatos -> liberada
    expect(
      isAccountEligibleForCrossContactPropagation({
        name: "MELCOPROL LTDA",
        document: "02.421.911/0001-18",
        contactCount: 25,
      }),
    ).toBe(true);

    // 4. Empresa pequena sem CNPJ com 2 contatos -> liberada (retrocompatibilidade)
    expect(
      isAccountEligibleForCrossContactPropagation({
        name: "Empresa",
        document: null,
        contactCount: 2,
      }),
    ).toBe(true);
  });

  test("botões de abrir conversa no CRM não enviam mais autoCapture: true", async () => {
    const files = [
      "../src/components/crm/DealDetailModal.tsx",
      "../src/components/crm/CrmView.tsx",
      "../src/components/crm/CrmChatWidget.tsx",
      "../src/components/chat/ChatPanel.tsx",
    ];
    for (const rel of files) {
      const content = await readFile(new URL(rel, import.meta.url), "utf8");
      expect(content).not.toMatch(/autoCapture\s*:\s*true/);
    }
  });
});

describe.skipIf(!process.env.PGLITE_TEST_MODULE)(
  "Isolamento de contas-balde, Baileys e autoCapture:false no PostgreSQL (PGlite)",
  () => {
    let pg: any;
    let db: any;
    let openConvHandler: (args: any) => Promise<Response>;

    const session = {
      tenantId: "tenant-guard",
      operator: { id: "op-admin", role: "admin", name: "Gustavo Admin" },
      permissions: structuredClone(DEFAULT_ADMIN_PERMISSIONS),
    };

    beforeAll(async () => {
      const pglite = await import(process.env.PGLITE_TEST_MODULE!);
      const { PGlite } = pglite;
      mock.module("@electric-sql/pglite", () => pglite);
      const { drizzle } = await import("drizzle-orm/pglite");
      pg = new PGlite();
      db = drizzle(pg, { schema });
      const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
      const statements = await generateMigration(
        generateDrizzleJson({}),
        generateDrizzleJson(schema),
      );
      for (const statement of statements) await pg.exec(statement);

      mock.module("../src/db", () => ({
        db,
        client: () => {
          throw new Error("Conexões externas são proibidas nesta suíte.");
        },
      }));
      const authModule = await import("../src/lib/auth-session");
      mock.module("../src/lib/auth-session", () => ({
        ...authModule,
        requireSession: async () => ({ session }),
      }));

      await db.insert(schema.tenants).values({
        id: "tenant-guard",
        name: "Tecfag Guard Test",
        slug: "tenant-guard",
        connectionType: "meta",
      });
      await db.insert(schema.channelConfigs).values({
        id: "cc-guard",
        tenantId: "tenant-guard",
        activeProvider: "meta",
      });
      await db.insert(schema.operators).values({
        id: "op-admin",
        tenantId: "tenant-guard",
        name: "Gustavo Admin",
        email: "admin@guard.test",
        passwordHash: "hash",
        role: "admin",
      });
      await db.insert(schema.crmPipelines).values({
        id: "pipe-guard",
        tenantId: "tenant-guard",
        name: "FUNIL CWR",
      });
      await db.insert(schema.crmStages).values({
        id: "stg-guard",
        tenantId: "tenant-guard",
        pipelineId: "pipe-guard",
        name: "CONTATANDO",
        orderIndex: 0,
      });

      const convRoute = await import("../src/routes/api/contacts/$contactId/conversations");
      openConvHandler = (convRoute.Route.options as any).server.handlers.POST;
    }, 120000);

    afterAll(async () => {
      mock.restore();
      if (pg) await pg.close();
    });

    test("syncAccountDealContacts e getContactDealRows ignoram empresa formulario-contato", async () => {
      await db.insert(schema.crmAccounts).values({
        id: "acc-form",
        tenantId: "tenant-guard",
        name: "formulario-contato",
        tradeName: "formulario-contato",
        type: "company",
      });

      await db.insert(schema.contacts).values([
        {
          id: "c-pedro",
          tenantId: "tenant-guard",
          name: "Pedro",
          phone: "5561981565406",
          mainChannel: "whatsapp",
          accountId: "acc-form",
        },
        {
          id: "c-jonathan",
          tenantId: "tenant-guard",
          name: "Jonathan Pedrosa",
          phone: "5585999396000",
          mainChannel: "whatsapp",
          accountId: "acc-form",
        },
      ]);

      await db.insert(schema.crmDeals).values([
        {
          id: "d-pedro",
          tenantId: "tenant-guard",
          title: "Pedro",
          pipelineId: "pipe-guard",
          stageId: "stg-guard",
          accountId: "acc-form",
          status: "open",
        },
        {
          id: "d-jonathan",
          tenantId: "tenant-guard",
          title: "Jonathan Pedrosa",
          pipelineId: "pipe-guard",
          stageId: "stg-guard",
          accountId: "acc-form",
          status: "open",
        },
      ]);

      await db.insert(schema.crmDealContacts).values([
        {
          id: "dc-pedro",
          tenantId: "tenant-guard",
          dealId: "d-pedro",
          contactId: "c-pedro",
          role: "buyer",
          isPrimary: true,
        },
        {
          id: "dc-jonathan",
          tenantId: "tenant-guard",
          dealId: "d-jonathan",
          contactId: "c-jonathan",
          role: "buyer",
          isPrimary: true,
        },
      ]);

      // syncAccountDealContacts NÃO deve injetar Pedro dentro do deal de Jonathan
      await db.transaction((tx: any) =>
        syncAccountDealContacts(tx, "tenant-guard", "d-jonathan", "acc-form", "op-admin"),
      );
      const jonathanParticipants = await db
        .select()
        .from(schema.crmDealContacts)
        .where(
          and(
            eq(schema.crmDealContacts.tenantId, "tenant-guard"),
            eq(schema.crmDealContacts.dealId, "d-jonathan"),
          ),
        );
      expect(jonathanParticipants.map((p: any) => p.contactId)).toEqual(["c-jonathan"]);

      // getContactDealRows para Pedro NÃO deve retornar o deal de Jonathan
      const pedroDeals = await getContactDealRows(db, "tenant-guard", "c-pedro");
      expect(pedroDeals.map((d: any) => d.id)).toEqual(["d-pedro"]);
    });

    test("ensureLinkedDeviceConversationDeal não rouba deal de outro contato da mesma empresa", async () => {
      await db.insert(schema.crmAccounts).values({
        id: "acc-cnpj",
        tenantId: "tenant-guard",
        name: "Indústria Real LTDA",
        document: "02.421.911/0001-18",
        type: "company",
      });

      await db.insert(schema.contacts).values([
        {
          id: "c-buyer-a",
          tenantId: "tenant-guard",
          name: "Comprador A",
          phone: "5511991110001",
          mainChannel: "whatsapp",
          accountId: "acc-cnpj",
        },
        {
          id: "c-buyer-b",
          tenantId: "tenant-guard",
          name: "Comprador B",
          phone: "5511991110002",
          mainChannel: "whatsapp",
          accountId: "acc-cnpj",
        },
      ]);

      await db.insert(schema.crmDeals).values({
        id: "d-buyer-a",
        tenantId: "tenant-guard",
        title: "Negociação Comprador A",
        pipelineId: "pipe-guard",
        stageId: "stg-guard",
        accountId: "acc-cnpj",
        status: "open",
      });

      await db.insert(schema.crmDealContacts).values({
        id: "dc-buyer-a",
        tenantId: "tenant-guard",
        dealId: "d-buyer-a",
        contactId: "c-buyer-a",
        role: "buyer",
        isPrimary: true,
      });

      await db.insert(schema.conversations).values({
        id: "conv-buyer-b",
        tenantId: "tenant-guard",
        contactId: "c-buyer-b",
        queueState: "meus",
        operatorId: "op-admin",
      });

      const res = await ensureLinkedDeviceConversationDeal(db, {
        tenantId: "tenant-guard",
        conversationId: "conv-buyer-b",
        contactId: "c-buyer-b",
        contactName: "Comprador B",
        contactPhone: "5511991110002",
        connectionId: "conn-1",
        operatorId: "op-admin",
        operatorName: "Gustavo Admin",
      });

      expect(res.currentDealId).not.toBe("d-buyer-a");
      expect(res.createdNew).toBe(true);

      const buyerADealContacts = await db
        .select()
        .from(schema.crmDealContacts)
        .where(
          and(
            eq(schema.crmDealContacts.tenantId, "tenant-guard"),
            eq(schema.crmDealContacts.dealId, "d-buyer-a"),
          ),
        );
      expect(buyerADealContacts.map((p: any) => p.contactId)).toEqual(["c-buyer-a"]);
    });

    test("POST /api/contacts/:id/conversations com autoCapture:false não captura conversa nem altera carteira ou finalizados", async () => {
      await db.insert(schema.contacts).values({
        id: "c-open-check",
        tenantId: "tenant-guard",
        name: "Lead Consulta",
        phone: "5561990001122",
        mainChannel: "whatsapp",
        walletOperatorId: null,
        responsibleName: "Na Fila",
      });
      await db.insert(schema.crmDeals).values({
        id: "d-open-check",
        tenantId: "tenant-guard",
        title: "Lead Consulta",
        pipelineId: "pipe-guard",
        stageId: "stg-guard",
        status: "open",
      });
      await db.insert(schema.crmDealContacts).values({
        id: "dc-open-check",
        tenantId: "tenant-guard",
        dealId: "d-open-check",
        contactId: "c-open-check",
        role: "buyer",
        isPrimary: true,
      });

      const originalLastMsgTime = new Date("2026-11-18T01:17:17.000Z");
      await db.insert(schema.conversations).values({
        id: "conv-open-check",
        tenantId: "tenant-guard",
        contactId: "c-open-check",
        queueState: "finalizados",
        operatorId: null,
        lastMessageTime: originalLastMsgTime,
      });

      const response = await openConvHandler({
        request: new Request("http://localhost/api/contacts/c-open-check/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dealId: "d-open-check", autoCapture: false }),
        }),
        params: { contactId: "c-open-check" },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.conversationId).toBe("conv-open-check");
      expect(body.readOnly).toBe(true);
      expect(body.queueState).toBe("finalizados");

      const [convAfter] = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, "conv-open-check"));
      expect(convAfter.operatorId).toBeNull();
      expect(convAfter.queueState).toBe("finalizados");
      expect(new Date(convAfter.lastMessageTime).toISOString()).toBe(
        originalLastMsgTime.toISOString(),
      );

      const [contactAfter] = await db
        .select()
        .from(schema.contacts)
        .where(eq(schema.contacts.id, "c-open-check"));
      expect(contactAfter.walletOperatorId).toBeNull();
      expect(contactAfter.responsibleName).toBe("Na Fila");
    });
  },
);
