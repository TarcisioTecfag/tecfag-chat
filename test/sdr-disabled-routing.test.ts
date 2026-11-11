import { describe, it, expect } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, is, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../src/db/schema";
import {
  agentConfigs,
  agentFlowStates,
  contacts,
  conversations,
  messages,
} from "../src/db/schema";
import { getBrtTodayYmd } from "../src/lib/valentina/rodizio-types";
import {
  isSdrAnalysisFlowOperator,
  isSdrEnabledForTenant,
  routeWhenSdrDisabled,
  sweepUnassignedAutomacaoWhenSdrDisabled,
} from "../src/lib/triage/sdr-disabled-routing";

async function createIsolatedTestDb() {
  const pg = new PGlite();
  const dialect = new PgDialect();
  const q = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const tables = [
    schema.operators,
    schema.sectors,
    schema.contacts,
    schema.conversations,
    schema.messages,
    schema.agentConfigs,
    schema.agentFlowStates,
  ];

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
    await pg.exec(`CREATE TABLE ${q(cfg.name)} (${columns.join(",")});`);
  }

  const testDb = drizzle(pg, { schema });
  return { pg, testDb: testDb as any };
}

describe("Fallback Automático para SDR / Análise quando Fagner está Desabilitado", () => {
  it("identifica corretamente operadores elegíveis em SDR / Análise (pasta 'outros'/'sdr' ou funil 'Análise e revisão humana')", () => {
    const todayBrt = getBrtTodayYmd();

    // Isabella Inhesta (exatamente como configurado em Fluxos -> SDR / Análise)
    expect(
      isSdrAnalysisFlowOperator(
        {
          id: "op-isabella",
          name: "Isabella Inhesta",
          area: "outros",
          funnels: ["Análise e revisão humana"],
          isParticipating: true,
          isOnLeave: false,
        },
        todayBrt,
      ),
    ).toBe(true);

    // Operador de Máquinas puro NÃO deve receber triagem de SDR / Análise
    expect(
      isSdrAnalysisFlowOperator(
        {
          id: "op-maquinas",
          name: "Consultor Máquinas",
          area: "maquinas",
          funnels: ["Máquinas"],
          isParticipating: true,
          isOnLeave: false,
        },
        todayBrt,
      ),
    ).toBe(false);

    // Operador em folga HOJE não recebe; folga expirada de dia anterior volta a ficar elegível
    expect(
      isSdrAnalysisFlowOperator(
        {
          id: "op-isabella",
          area: "outros",
          funnels: ["Análise e revisão humana"],
          isParticipating: true,
          isOnLeave: true,
          leaveDate: todayBrt,
        },
        todayBrt,
      ),
    ).toBe(false);

    expect(
      isSdrAnalysisFlowOperator(
        {
          id: "op-isabella",
          area: "outros",
          funnels: ["Análise e revisão humana"],
          isParticipating: true,
          isOnLeave: true,
          leaveDate: "2020-01-01",
        },
        todayBrt,
      ),
    ).toBe(true);

    // Operador inativo na escala não recebe
    expect(
      isSdrAnalysisFlowOperator(
        {
          id: "op-isabella",
          area: "outros",
          funnels: ["Análise e revisão humana"],
          isParticipating: false,
          isOnLeave: false,
        },
        todayBrt,
      ),
    ).toBe(false);
  });

  it("direciona atendimento novo direto para Isabella Inhesta (SDR / Análise) quando Fagner está desativado, ignorando closers de Máquinas/Peças", async () => {
    const { pg, testDb } = await createIsolatedTestDb();
    try {
      const industrialTenant = "tecfag";
      const legacyTenant = "valem";

      await testDb.insert(schema.operators).values([
        {
          id: "op-isabella",
          tenantId: industrialTenant,
          name: "Isabella Inhesta",
          email: "apoiocomercial@tecfag.com.br",
          passwordHash: "hash-test",
        },
        {
          id: "op-closer-maq",
          tenantId: industrialTenant,
          name: "Andreia Camargo",
          email: "vendas2@tecfag.com.br",
          passwordHash: "hash-test",
        },
        {
          id: "op-other-tenant",
          tenantId: legacyTenant,
          name: "Operador Valem",
          email: "op@valem.com.br",
          passwordHash: "hash-test",
        },
      ]);
      await testDb.insert(schema.sectors).values({
        id: "sec-comercial",
        tenantId: industrialTenant,
        name: "COMERCIAL",
        operatorIds: ["op-isabella", "op-closer-maq"],
      });

      // Fagner SDR DESABILITADO (enabled = 0)
      await testDb.insert(agentConfigs).values([
        {
          id: "cfg-sdr-ind",
          tenantId: industrialTenant,
          agentType: "sdr",
          enabled: 0,
          config: {},
        },
        {
          id: "cfg-rodizio-ind",
          tenantId: industrialTenant,
          agentType: "rodizio",
          enabled: 1,
          config: {
            flowOperators: [
              {
                id: "op-closer-maq",
                name: "Andreia Camargo",
                area: "maquinas",
                funnels: ["Máquinas"],
                isParticipating: true,
                isOnLeave: false,
                compensation: 5,
                leadsReceivedCount: 0,
                recentLeads: [],
              },
              {
                id: "op-isabella",
                name: "Isabella Inhesta",
                email: "apoiocomercial@tecfag.com.br",
                area: "outros",
                roleTag: "SDR",
                funnels: ["Análise e revisão humana"],
                isParticipating: true,
                isOnLeave: false,
                compensation: 0,
                leadsReceivedCount: 0,
                recentLeads: [],
              },
            ],
          },
        },
      ]);

      await testDb.insert(contacts).values({
        id: "cont-novo-1",
        tenantId: industrialTenant,
        name: "Carlos Cliente Novo",
        phone: "5516999887766",
        mainChannel: "whatsapp",
      });

      await testDb.insert(conversations).values({
        id: "conv-novo-1",
        tenantId: industrialTenant,
        contactId: "cont-novo-1",
        contactPhone: "5516999887766",
        queueState: "automacao",
        operatorId: null,
        unreadCount: 1,
        lastMessageText: "Olá, gostaria de orçamento de seladora",
      });

      expect(await isSdrEnabledForTenant(testDb, industrialTenant)).toBe(false);

      const res = await routeWhenSdrDisabled(testDb, {
        tenantId: industrialTenant,
        conversationId: "conv-novo-1",
        contactId: "cont-novo-1",
        clientName: "Carlos Cliente Novo",
      });

      expect(res.routed).toBe(true);
      expect(res.mode).toBe("assigned_sdr_analysis");
      expect(res.operator).toEqual({ id: "op-isabella", name: "Isabella Inhesta" });
      expect(res.conversation?.queueState).toBe("meus");
      expect(res.conversation?.operatorId).toBe("op-isabella");
      expect(res.conversation?.sectorId).toBe("sec-comercial");

      // Verifica contato atualizado
      const [updatedContact] = await testDb
        .select()
        .from(contacts)
        .where(and(eq(contacts.tenantId, industrialTenant), eq(contacts.id, "cont-novo-1")));
      expect(updatedContact.walletOperatorId).toBe("op-isabella");
      expect(updatedContact.responsibleName).toBe("Isabella Inhesta");

      // Verifica incremento do contador apenas de Isabella (Andreia em Máquinas permanece com 0)
      const [rodizioAfter] = await testDb
        .select()
        .from(agentConfigs)
        .where(
          and(
            eq(agentConfigs.tenantId, industrialTenant),
            eq(agentConfigs.agentType, "rodizio"),
          ),
        );
      const savedOps = (rodizioAfter.config as any).flowOperators;
      const isabellaSaved = savedOps.find((o: any) => o.id === "op-isabella");
      const andreiaSaved = savedOps.find((o: any) => o.id === "op-closer-maq");
      expect(isabellaSaved.leadsReceivedCount).toBe(1);
      expect(isabellaSaved.recentLeads[0]?.chatId).toBe("conv-novo-1");
      expect(andreiaSaved.leadsReceivedCount).toBe(0);

      // Verifica nota interna de auditoria gravada no histórico
      const convMsgs = await testDb
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, industrialTenant),
            eq(messages.conversationId, "conv-novo-1"),
          ),
        );
      expect(convMsgs.length).toBe(1);
      expect(convMsgs[0].isInternalNote).toBe(true);
      expect(convMsgs[0].content).toContain("Isabella Inhesta (SDR / Análise)");
    } finally {
      await pg.close();
    }
  });

  it("respeita rodízio e saldo de compensação entre múltiplos operadores de SDR / Análise e faz fallback para Fila quando todos estiverem em folga", async () => {
    const { pg, testDb } = await createIsolatedTestDb();
    try {
      const tenant = "tecfag";
      const todayBrt = getBrtTodayYmd();

      await testDb.insert(schema.operators).values([
        {
          id: "op-sdr-1",
          tenantId: tenant,
          name: "Isabella Inhesta",
          email: "sdr1@tecfag.com.br",
          passwordHash: "hash-test",
        },
        {
          id: "op-sdr-2",
          tenantId: tenant,
          name: "Segundo SDR",
          email: "sdr2@tecfag.com.br",
          passwordHash: "hash-test",
        },
      ]);
      await testDb.insert(schema.sectors).values({
        id: "sec-sdr",
        tenantId: tenant,
        name: "SDR",
        operatorIds: ["op-sdr-1", "op-sdr-2"],
      });

      await testDb.insert(agentConfigs).values([
        { id: "cfg-sdr", tenantId: tenant, agentType: "sdr", enabled: 0, config: {} },
        {
          id: "cfg-rod",
          tenantId: tenant,
          agentType: "rodizio",
          enabled: 1,
          config: {
            flowOperators: [
              {
                id: "op-sdr-1",
                name: "Isabella Inhesta",
                area: "outros",
                funnels: ["Análise e revisão humana"],
                isParticipating: true,
                isOnLeave: false,
                compensation: 0,
                leadsReceivedCount: 0,
                recentLeads: [],
              },
              {
                id: "op-sdr-2",
                name: "Segundo SDR",
                area: "outros",
                funnels: ["Análise e revisão humana"],
                isParticipating: true,
                isOnLeave: false,
                compensation: 1,
                leadsReceivedCount: 0,
                recentLeads: [],
              },
            ],
          },
        },
      ]);

      for (const idx of [1, 2]) {
        await testDb.insert(contacts).values({
          id: `c-${idx}`,
          tenantId: tenant,
          name: `Cliente ${idx}`,
          phone: `551699900000${idx}`,
          mainChannel: "whatsapp",
        });
        await testDb.insert(conversations).values({
          id: `cv-${idx}`,
          tenantId: tenant,
          contactId: `c-${idx}`,
          queueState: "automacao",
        });
      }

      // 1º lead vai para op-sdr-2 (score 0 - 1 = -1 < 0) e consome a compensação
      const r1 = await routeWhenSdrDisabled(testDb, {
        tenantId: tenant,
        conversationId: "cv-1",
        contactId: "c-1",
      });
      expect(r1.operator?.id).toBe("op-sdr-2");

      // 2º lead vai para op-sdr-1 (score 0 < 1)
      const r2 = await routeWhenSdrDisabled(testDb, {
        tenantId: tenant,
        conversationId: "cv-2",
        contactId: "c-2",
      });
      expect(r2.operator?.id).toBe("op-sdr-1");

      // Coloca ambos em folga hoje -> 3º lead deve ir para "fila" (Fila Humana), NUNCA ficar preso em "automacao"
      await testDb
        .update(agentConfigs)
        .set({
          config: {
            flowOperators: [
              {
                id: "op-sdr-1",
                name: "Isabella Inhesta",
                area: "outros",
                funnels: ["Análise e revisão humana"],
                isParticipating: true,
                isOnLeave: true,
                leaveDate: todayBrt,
                compensation: 0,
                leadsReceivedCount: 1,
              },
              {
                id: "op-sdr-2",
                name: "Segundo SDR",
                area: "outros",
                funnels: ["Análise e revisão humana"],
                isParticipating: true,
                isOnLeave: true,
                leaveDate: todayBrt,
                compensation: 0,
                leadsReceivedCount: 1,
              },
            ],
          },
        })
        .where(and(eq(agentConfigs.tenantId, tenant), eq(agentConfigs.agentType, "rodizio")));

      await testDb.insert(contacts).values({
        id: "c-3",
        tenantId: tenant,
        name: "Cliente Sem SDR Disponivel",
        phone: "5516999000003",
        mainChannel: "whatsapp",
      });
      await testDb.insert(conversations).values({
        id: "cv-3",
        tenantId: tenant,
        contactId: "c-3",
        queueState: "automacao",
      });

      const r3 = await routeWhenSdrDisabled(testDb, {
        tenantId: tenant,
        conversationId: "cv-3",
        contactId: "c-3",
      });
      expect(r3.routed).toBe(true);
      expect(r3.mode).toBe("queued_fallback");
      expect(r3.conversation?.queueState).toBe("fila");
      expect(r3.conversation?.operatorId).toBeNull();
      expect(r3.conversation?.sectorId).toBe("sec-sdr");
    } finally {
      await pg.close();
    }
  });

  it("preserva Fagner habilitado (enabled = 1), preserva isolamento do tenant valem e varre conversas órfãs ao desativar", async () => {
    const { pg, testDb } = await createIsolatedTestDb();
    try {
      await testDb.insert(schema.operators).values([
        {
          id: "op-isabella",
          tenantId: "tecfag",
          name: "Isabella Inhesta",
          email: "apoiocomercial@tecfag.com.br",
          passwordHash: "hash-test",
        },
        {
          id: "op-valem",
          tenantId: "valem",
          name: "Consultora Valem",
          email: "vendas@valem.com.br",
          passwordHash: "hash-test",
        },
      ]);

      await testDb.insert(agentConfigs).values([
        { id: "cfg-sdr-on", tenantId: "tecfag", agentType: "sdr", enabled: 1, config: {} },
        { id: "cfg-sdr-valem", tenantId: "valem", agentType: "sdr", enabled: 0, config: {} },
        {
          id: "cfg-rod-tecfag",
          tenantId: "tecfag",
          agentType: "rodizio",
          enabled: 1,
          config: {
            flowOperators: [
              {
                id: "op-isabella",
                name: "Isabella Inhesta",
                area: "outros",
                funnels: ["Análise e revisão humana"],
                isParticipating: true,
                isOnLeave: false,
                compensation: 0,
                leadsReceivedCount: 0,
                recentLeads: [],
              },
            ],
          },
        },
      ]);

      await testDb.insert(contacts).values([
        { id: "c-tf", tenantId: "tecfag", name: "Lead Tecfag", phone: "5516988881111", mainChannel: "whatsapp" },
        { id: "c-vl", tenantId: "valem", name: "Lead Valem", phone: "5511988882222", mainChannel: "whatsapp" },
      ]);
      await testDb.insert(conversations).values([
        { id: "cv-tf", tenantId: "tecfag", contactId: "c-tf", queueState: "automacao" },
        { id: "cv-vl", tenantId: "valem", contactId: "c-vl", queueState: "automacao" },
      ]);
      await testDb.insert(agentFlowStates).values({
        id: "fs-tf",
        tenantId: "tecfag",
        conversationId: "cv-tf",
        agentType: "sdr",
        currentStep: "Em Qualificação",
        outcome: "in_progress",
      });

      // 1. Com Fagner ATIVO (enabled = 1), não intercepta a conversa
      const activeRes = await routeWhenSdrDisabled(testDb, {
        tenantId: "tecfag",
        conversationId: "cv-tf",
      });
      expect(activeRes.routed).toBe(false);
      expect(activeRes.reason).toBe("sdr_enabled");

      // 2. No tenant Valem (política não-industrial), NUNCA interfere
      const valemRes = await routeWhenSdrDisabled(testDb, {
        tenantId: "valem",
        conversationId: "cv-vl",
      });
      expect(valemRes.routed).toBe(false);
      expect(valemRes.reason).toBe("non_industrial_policy");

      // 3. Admin desativa o Fagner (enabled = 0) -> sweep redireciona conversa órfã em automacao para Isabella e encerra flow_state
      await testDb
        .update(agentConfigs)
        .set({ enabled: 0 })
        .where(and(eq(agentConfigs.tenantId, "tecfag"), eq(agentConfigs.agentType, "sdr")));

      const deliveredCalls: Array<{ conversationId?: string; operatorId?: string }> = [];
      const sweep = await sweepUnassignedAutomacaoWhenSdrDisabled(testDb, "tecfag", {
        deliverEffects: async ({ routing }) => {
          deliveredCalls.push({
            conversationId: routing.conversation?.id,
            operatorId: routing.operator?.id,
          });
        },
      });
      expect(sweep.sweptCount).toBe(1);
      expect(deliveredCalls).toEqual([{ conversationId: "cv-tf", operatorId: "op-isabella" }]);

      const [sweptConv] = await testDb
        .select()
        .from(conversations)
        .where(and(eq(conversations.tenantId, "tecfag"), eq(conversations.id, "cv-tf")));
      expect(sweptConv.queueState).toBe("meus");
      expect(sweptConv.operatorId).toBe("op-isabella");

      const [stoppedFlow] = await testDb
        .select()
        .from(agentFlowStates)
        .where(and(eq(agentFlowStates.tenantId, "tecfag"), eq(agentFlowStates.id, "fs-tf")));
      expect(stoppedFlow.outcome).toBe("stopped");

      // Valem permanece 100% intocado
      const [valemConv] = await testDb
        .select()
        .from(conversations)
        .where(and(eq(conversations.tenantId, "valem"), eq(conversations.id, "cv-vl")));
      expect(valemConv.queueState).toBe("automacao");
      expect(valemConv.operatorId).toBeNull();
    } finally {
      await pg.close();
    }
  });
});
