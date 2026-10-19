import { beforeAll, afterAll, describe, expect, test, mock } from "bun:test";
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import {
  linkContactToDeal,
  syncAccountDealContacts,
  syncConversationDeals,
  assertDealsCanBeRemoved,
} from "../src/lib/crm/deal-associations";

// PostgreSQL WASM opcional: jamais abre uma conexão com bancos operacionais.
// PGLITE_TEST_MODULE aponta para @electric-sql/pglite/dist/index.js instalado para testes.
describe.skipIf(!process.env.PGLITE_TEST_MODULE)(
  "Contatos e negociações: PostgreSQL isolado em memória",
  () => {
    let pg: any;
    let db: any;
    let service: typeof import("../src/lib/crm/crm-service");
    let contactsHandler: (args: any) => Promise<Response>;
    let crmContactsHandler: (args: any) => Promise<Response>;
    const session = {
      tenantId: "tenant-a",
      operator: { id: "operator-a", role: "admin", name: "Operador" },
      permissions: { chat: {}, views: { chat: true } },
    };
    let serial = 0;
    const id = (label: string) => `${label}-${++serial}`;
    const createContact = async (accountId: string | null = null, tenantId = "tenant-a") => {
      const contactId = id("contact");
      await db
        .insert(schema.contacts)
        .values({ id: contactId, tenantId, name: contactId, mainChannel: "whatsapp", accountId });
      return contactId;
    };
    const createConversation = async (contactId: string) => {
      const conversationId = id("conv");
      await db
        .insert(schema.conversations)
        .values({ id: conversationId, tenantId: "tenant-a", contactId });
      return conversationId;
    };
    const createDeal = async (contactId?: string, accountId?: string) =>
      service.crmService.createDeal(
        "tenant-a",
        "operator-a",
        {
          title: id("deal"),
          pipelineId: "pipeline-a",
          stageId: "stage-a",
          contactId,
          accountId,
        },
        db,
      );
    const post = (body: unknown) => ({
      request: new Request("http://localhost/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    });

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
      for (const file of [
        "0024_customer_identity_guards.sql",
        "0043_contact_phone_mobile_identity.sql",
      ])
        await pg.exec(
          await readFile(new URL(`../src/db/migrations/${file}`, import.meta.url), "utf8"),
        );
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
      await db.insert(schema.tenants).values([
        { id: "tenant-a", name: "A", slug: "tenant-a", connectionType: "meta" },
        { id: "tenant-b", name: "B", slug: "tenant-b", connectionType: "meta" },
      ]);
      await db.insert(schema.operators).values({
        id: "operator-a",
        tenantId: "tenant-a",
        name: "Operador",
        email: "operator@example.test",
        passwordHash: "test",
        role: "admin",
      });
      await db
        .insert(schema.crmPipelines)
        .values({ id: "pipeline-a", tenantId: "tenant-a", name: "Comercial" });
      await db.insert(schema.crmStages).values({
        id: "stage-a",
        tenantId: "tenant-a",
        pipelineId: "pipeline-a",
        name: "Entrada",
        orderIndex: 0,
      });
      service = await import("../src/lib/crm/crm-service");
      const contactRoute = await import("../src/routes/api/contacts");
      contactsHandler = (contactRoute.Route.options as any).server.handlers.POST;
      const crmRoute = await import("../src/routes/api/crm/contacts");
      crmContactsHandler = (crmRoute.Route.options as any).server.handlers.POST;
    }, 120000);
    afterAll(async () => {
      mock.restore();
      if (pg) await pg.close();
    });

    test("proteção no banco: 55 e nono dígito duplicam, outro DDD/tenant e fixos permanecem distintos", async () => {
      await db.insert(schema.contacts).values({
        id: id("phone"),
        tenantId: "tenant-a",
        name: "Celular",
        mainChannel: "whatsapp",
        phone: "(14) 99836-4338",
      });
      for (const phone of ["5514998364338", "1498364338", "551498364338"]) {
        await expect(
          Promise.resolve(
            db.insert(schema.contacts).values({
              id: id("phone"),
              tenantId: "tenant-a",
              name: "Duplicado",
              mainChannel: "whatsapp",
              phone,
            }),
          ),
        ).rejects.toThrow();
      }
      await db.insert(schema.contacts).values([
        {
          id: id("phone"),
          tenantId: "tenant-b",
          name: "Outro tenant",
          mainChannel: "whatsapp",
          phone: "5514998364338",
        },
        {
          id: id("phone"),
          tenantId: "tenant-a",
          name: "Outro DDD",
          mainChannel: "whatsapp",
          phone: "5511998364338",
        },
        {
          id: id("phone"),
          tenantId: "tenant-a",
          name: "Fixo",
          mainChannel: "whatsapp",
          phone: "551434567890",
        },
        {
          id: id("phone"),
          tenantId: "tenant-a",
          name: "Outro celular",
          mainChannel: "whatsapp",
          phone: "5514934567890",
        },
      ]);
    });

    test("selecionar empresa inclui todos os seus contatos, preserva o principal e é idempotente", async () => {
      const accountId = id("account");
      await db
        .insert(schema.crmAccounts)
        .values({ id: accountId, tenantId: "tenant-a", name: "Empresa", type: "company" });
      const primary = await createContact();
      const companyContacts = [await createContact(accountId), await createContact(accountId)];
      const foreignContact = await createContact(accountId, "tenant-b");
      const convId = await createConversation(companyContacts[0]);
      const deal = await createDeal(primary, accountId);
      await db.transaction((tx: any) =>
        syncAccountDealContacts(tx, "tenant-a", deal.id, accountId, "operator-a"),
      );
      const participants = await db
        .select()
        .from(schema.crmDealContacts)
        .where(eq(schema.crmDealContacts.dealId, deal.id));
      expect(participants.map((p: any) => p.contactId).sort()).toEqual(
        [primary, ...companyContacts].sort(),
      );
      expect(participants.filter((p: any) => p.isPrimary).map((p: any) => p.contactId)).toEqual([
        primary,
      ]);
      expect(
        await db.transaction((tx: any) =>
          syncConversationDeals(tx, "tenant-a", convId, companyContacts[0]),
        ),
      ).toBe(true);
      await expect(
        db.transaction((tx: any) =>
          linkContactToDeal(tx, "tenant-a", foreignContact, deal.id, null),
        ),
      ).rejects.toThrow();
      const laterDeal = await createDeal(primary);
      await service.crmService.updateDeal("tenant-a", laterDeal.id, "operator-a", {
        accountId,
        expectedVersion: laterDeal.version,
      });
      const laterParticipants = await db
        .select()
        .from(schema.crmDealContacts)
        .where(
          and(
            eq(schema.crmDealContacts.tenantId, "tenant-a"),
            eq(schema.crmDealContacts.dealId, laterDeal.id),
          ),
        );
      expect(laterParticipants.map((p: any) => p.contactId).sort()).toEqual(
        [primary, ...companyContacts].sort(),
      );
    });

    test("mensagem antes/depois do card converge e um atendimento pode ter mais de um card", async () => {
      const contactId = await createContact();
      const convId = await createConversation(contactId);
      expect(
        await db.transaction((tx: any) => syncConversationDeals(tx, "tenant-a", convId, contactId)),
      ).toBe(false);
      const first = await createDeal(contactId);
      const second = await createDeal(contactId);
      await db.transaction((tx: any) => syncConversationDeals(tx, "tenant-a", convId, contactId));
      const links = await db
        .select()
        .from(schema.crmConversationDeals)
        .where(
          and(
            eq(schema.crmConversationDeals.tenantId, "tenant-a"),
            eq(schema.crmConversationDeals.conversationId, convId),
            eq(schema.crmConversationDeals.isActive, true),
          ),
        );
      expect(links.map((l: any) => l.dealId).sort()).toEqual([first.id, second.id].sort());
      const lateContact = await createContact();
      const existingCard = await createDeal(lateContact);
      const lateConv = await createConversation(lateContact);
      await db.transaction((tx: any) =>
        syncConversationDeals(tx, "tenant-a", lateConv, lateContact),
      );
      const [lateLink] = await db
        .select()
        .from(schema.crmConversationDeals)
        .where(eq(schema.crmConversationDeals.conversationId, lateConv));
      expect(lateLink.dealId).toBe(existingCard.id);
    });

    test("último vínculo de conversa não pode ser removido pelo chat nem por exclusão em lote, mas negociação permite remover contato ou ficar sem contato", async () => {
      const contactId = await createContact();
      const secondContactId = await createContact();
      const convId = await createConversation(contactId);
      const first = await createDeal(contactId);
      await expect(
        service.crmService.unlinkConversationDeal("tenant-a", convId, first.id, null),
      ).rejects.toThrow("negociação");
      await expect(
        db.transaction((tx: any) => assertDealsCanBeRemoved(tx, "tenant-a", [first.id])),
      ).rejects.toThrow("negociação");
      const second = await createDeal(contactId);
      await expect(
        db.transaction((tx: any) => assertDealsCanBeRemoved(tx, "tenant-a", [first.id, second.id])),
      ).rejects.toThrow("negociação");
      await service.crmService.unlinkConversationDeal("tenant-a", convId, first.id, null);
      await db.transaction((tx: any) => syncConversationDeals(tx, "tenant-a", convId, contactId));
      const remainingLinks = await db
        .select()
        .from(schema.crmConversationDeals)
        .where(
          and(
            eq(schema.crmConversationDeals.tenantId, "tenant-a"),
            eq(schema.crmConversationDeals.conversationId, convId),
            eq(schema.crmConversationDeals.isActive, true),
          ),
        );
      expect(remainingLinks.map((l: any) => l.dealId)).toEqual([second.id]);

      // Na negociação (card), vincula um segundo contato, remove o primeiro (que era principal)
      // e garante que o segundo se torna principal; em seguida remove o segundo, permitindo negociação sem contato.
      await service.crmService.addDealContact("tenant-a", second.id, secondContactId, "financial", false, "operator-a");
      const afterRemoveFirst = await service.crmService.removeDealContact("tenant-a", second.id, contactId, "operator-a");
      expect(afterRemoveFirst).toHaveLength(1);
      expect(afterRemoveFirst[0].contactId).toBe(secondContactId);
      expect(afterRemoveFirst[0].isPrimary).toBe(true);

      const afterRemoveAll = await service.crmService.removeDealContact("tenant-a", second.id, secondContactId, "operator-a");
      expect(afterRemoveAll).toHaveLength(0);
    });

    test("cadastro manual exige card/DDD e criação inválida faz rollback de contato e conversa", async () => {
      let res = await contactsHandler(post({ name: "Sem negociação", phone: "(14) 98888-1000" }));
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("DEAL_REQUIRED");
      res = await contactsHandler(
        post({ name: "Sem DDD", phone: "988881000", dealId: "qualquer" }),
      );
      expect(res.status).toBe(400);
      const phone = "5514998881001";
      res = await contactsHandler(
        post({
          name: "Rollback",
          phone,
          newDeal: { title: "Inválido", pipelineId: "outro-tenant", stageId: "stage-a" },
        }),
      );
      expect(res.ok).toBe(false);
      expect(
        await db.select().from(schema.contacts).where(eq(schema.contacts.phone, phone)),
      ).toHaveLength(0);
      res = await contactsHandler(
        post({
          name: "Novo",
          phone,
          newDeal: { title: "Negociação válida", pipelineId: "pipeline-a", stageId: "stage-a" },
        }),
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      const links = await db
        .select()
        .from(schema.crmConversationDeals)
        .where(eq(schema.crmConversationDeals.conversationId, data.conversationId));
      expect(links).toHaveLength(1);
      const duplicate = await contactsHandler(
        post({
          name: "Duplicado",
          mainChannel: "whatsapp",
          phone: "(14) 9888-1001",
          dealId: links[0].dealId,
        }),
      );
      expect(duplicate.status).toBe(409);
      expect((await duplicate.json()).contactId).toBe(data.contactId);
      const quick = await crmContactsHandler(
        post({ name: "Contato CRM", phone: "(14) 98888-1002", dealId: links[0].dealId }),
      );
      expect(quick.status).toBe(201);
      const linked = await crmContactsHandler(
        post({
          name: "Nome que não deve sobrescrever",
          existingContactId: data.contactId,
          newDeal: { title: "Segundo card", pipelineId: "pipeline-a", stageId: "stage-a" },
        }),
      );
      expect(linked.status).toBe(200);
      const [original] = await db
        .select()
        .from(schema.contacts)
        .where(
          and(eq(schema.contacts.tenantId, "tenant-a"), eq(schema.contacts.id, data.contactId)),
        );
      expect(original.name).toBe("Novo");
    });

    test("abrir atendimento pelo CRM cria contato e vínculo completos, respeitando captura explícita", async () => {
      const deal = await createDeal();
      const { Route } = await import("../src/routes/api/crm/deals/$dealId/conversations");
      const ensure = (Route.options as any).server.handlers.POST;
      const response = await ensure({
        ...post({
          ensure: true,
          autoCapture: false,
          name: "Cliente CRM",
          phone: "+55 (14) 99872-1003",
        }),
        params: { dealId: deal.id },
      });
      expect(response.status).toBe(201);
      const result = await response.json();
      const [conv] = await db
        .select()
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.tenantId, "tenant-a"),
            eq(schema.conversations.id, result.conversationId),
          ),
        );
      expect(conv.queueState).toBe("fila");
      expect(conv.operatorId).toBeNull();
      const participants = await db
        .select()
        .from(schema.crmDealContacts)
        .where(
          and(
            eq(schema.crmDealContacts.tenantId, "tenant-a"),
            eq(schema.crmDealContacts.dealId, deal.id),
          ),
        );
      expect(participants.map((p: any) => p.contactId)).toContain(conv.contactId);
      const again = await ensure({
        ...post({ ensure: true, autoCapture: true }),
        params: { dealId: deal.id },
      });
      expect(again.status).toBe(200);
      expect((await again.json()).conversationId).toBe(conv.id);
    });

    test("entrada real preserva mensagem sem card, bloqueia captura/envio e associa o webhook RD posterior", async () => {
      const { inboundProcessor } = await import("../src/lib/whatsapp/inbound");
      const inbound = {
        tenantId: "tenant-a",
        provider: "meta" as const,
        externalEventId: id("event"),
        fromPhone: "5514997771000",
        senderName: "Cliente RD",
        text: "Preciso de atendimento",
        timestamp: new Date(),
      };
      const result = await inboundProcessor.process(inbound);
      expect(result.success).toBe(true);
      const [conv] = await db
        .select()
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.tenantId, "tenant-a"),
            eq(schema.conversations.id, result.conversationId!),
          ),
        );
      const received = await db
        .select()
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.tenantId, "tenant-a"),
            eq(schema.messages.conversationId, conv.id),
          ),
        );
      expect(received).toHaveLength(1);
      const { Route: captureRoute } = await import("../src/routes/api/chats/update-queue");
      const capture = (captureRoute.options as any).server.handlers.POST;
      const captureResponse = await capture(
        post({
          conversationId: conv.id,
          queueState: "meus",
          operatorId: "operator-a",
          expectedVersion: conv.version,
        }),
      );
      expect(captureResponse.status).toBe(409);
      expect((await captureResponse.json()).code).toBe("DEAL_REQUIRED");
      await db
        .update(schema.conversations)
        .set({ queueState: "meus", operatorId: "operator-a" })
        .where(
          and(eq(schema.conversations.tenantId, "tenant-a"), eq(schema.conversations.id, conv.id)),
        );
      const { Route: sendRoute } = await import("../src/routes/api/whatsapp/send");
      const sendResponse = await (sendRoute.options as any).server.handlers.POST(
        post({ conversationId: conv.id, text: "Envio bloqueado" }),
      );
      expect(sendResponse.status).toBe(409);
      expect((await sendResponse.json()).code).toBe("DEAL_REQUIRED");
      const { defaultMappings } = await import("../src/lib/rd-marketing/mapping");
      const rd = await import("../src/lib/rd-marketing/service");
      const [flow] = await db
        .insert(schema.rdMarketingFlows)
        .values({
          id: id("flow"),
          tenantId: "tenant-a",
          tokenHash: id("hash"),
          settings: {
            name: "Fluxo teste",
            enabled: true,
            pipelineId: "pipeline-a",
            stageId: "stage-a",
            operatorId: null,
            deduplication: "lead",
            eventIdPath: "",
            mappings: defaultMappings,
          },
        })
        .returning();
      const [outcome] = await rd.receiveLeads(flow, {
        leads: [
          {
            uuid: crypto.randomUUID(),
            name: "Cliente RD",
            email: "cliente@example.test",
            mobile_phone: "(14) 9777-1000",
          },
        ],
      });
      expect(outcome.status).toBe("created");
      const links = await db
        .select()
        .from(schema.crmConversationDeals)
        .where(
          and(
            eq(schema.crmConversationDeals.tenantId, "tenant-a"),
            eq(schema.crmConversationDeals.conversationId, conv.id),
            eq(schema.crmConversationDeals.isActive, true),
          ),
        );
      expect(links.map((l: any) => l.dealId)).toContain(outcome.dealId);
      const sameMessage = await inboundProcessor.process(inbound);
      expect(sameMessage.duplicate).toBe(true);
      const after = await db
        .select()
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.tenantId, "tenant-a"),
            eq(schema.messages.conversationId, conv.id),
          ),
        );
      expect(after).toHaveLength(1);
      const nextPayload = {
        leads: [
          {
            uuid: crypto.randomUUID(),
            name: "Card antes da mensagem",
            email: "segundo@example.test",
            mobile_phone: "(14) 99777-1001",
          },
        ],
      };
      const [earlyCard] = await rd.receiveLeads(flow, nextPayload);
      const laterMessage = await inboundProcessor.process({
        ...inbound,
        externalEventId: id("event"),
        fromPhone: "551497771001",
      });
      expect(laterMessage.success).toBe(true);
      const earlyLinks = await db
        .select()
        .from(schema.crmConversationDeals)
        .where(
          and(
            eq(schema.crmConversationDeals.tenantId, "tenant-a"),
            eq(schema.crmConversationDeals.conversationId, laterMessage.conversationId!),
          ),
        );
      expect(earlyLinks.map((l: any) => l.dealId)).toContain(earlyCard.dealId);
      const [repeatedWebhook] = await rd.receiveLeads(flow, nextPayload);
      expect(repeatedWebhook.status).toBe("duplicate");
    });
  },
);
