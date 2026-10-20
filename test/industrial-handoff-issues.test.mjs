import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {
  HANDOFF_ISSUES,
  readHandoffIssue,
  recordHandoffIssue,
  describeHandoffIssue,
} from "../src/lib/triage/industrial-handoff-issues.ts";
import { projectIndustrialMonitoring } from "../src/lib/triage/industrial-monitor.ts";
import { deliverIndustrialPostCommit } from "../src/lib/triage/industrial-post-commit-delivery.ts";

const cycle = "2026-10-20T12:00:00.000Z";
const key = { tenantId: "fixture", conversationId: "conv", flowId: "flow", cycle };
const receipt = {
  cycle,
  committedAt: cycle,
  result: { status: "transferred", operator: { id: "op", name: "Pessoa" }, deal: null },
};
const item = () => ({
  key,
  receipt,
  outbox: {
    cycle,
    clientConfirmationText: "Confirmação persistida",
    operatorNotificationRequired: true,
    clientConfirmationRequired: true,
  },
  needOperatorNotification: true,
  needClientConfirmation: true,
});

describe("diagnóstico de handoff seguro e por ciclo", () => {
  for (const code of Object.keys(HANDOFF_ISSUES))
    it(`orientação operacional: ${code}`, () => {
      const recorded = recordHandoffIssue({}, cycle, code);
      const value = describeHandoffIssue(recorded.handoffIssue, cycle);
      assert.equal(value.code, code);
      assert.ok(value.title.length > 5 && value.action.length > 20);
    });
  it("não aceita código arbitrário, outro ciclo nem conteúdo bruto", () => {
    for (const code of ["constructor", "__proto__", "SQL:password", "não reconhecido"])
      assert.equal(readHandoffIssue({ version: 1, cycle, code, occurredAt: cycle }, cycle), null);
    const recorded = recordHandoffIssue({}, cycle, "crm_failed");
    assert.equal(readHandoffIssue(recorded.handoffIssue, "outro"), null);
    assert.equal(
      readHandoffIssue({ ...recorded.handoffIssue, occurredAt: "inválido" }, cycle),
      null,
    );
    const described = describeHandoffIssue(
      { ...recorded.handoffIssue, exception: "SEGREDO" },
      cycle,
    );
    assert.ok(!JSON.stringify(described).includes("SEGREDO"));
  });
  it("agrega repetição, preserva mudança de causa e limita histórico a vinte", () => {
    let meta = recordHandoffIssue({}, cycle, "crm_failed");
    meta = recordHandoffIssue(meta, cycle, "crm_failed");
    assert.equal(meta.handoffIssue.occurrences, 2);
    assert.equal(meta.handoffIssueHistory.length, 1);
    for (let i = 0; i < 30; i++)
      meta = recordHandoffIssue(meta, cycle, i % 2 ? "crm_failed" : "destination_unconfigured");
    assert.equal(meta.handoffIssueHistory.length, 20);
    assert.equal(recordHandoffIssue(meta, "outro", "crm_failed").handoffIssueHistory.length, 1);
  });
  it("monitor só mostra causa pendente do ciclo atual e separa cancelamento de envio", () => {
    const meta = { ...recordHandoffIssue({}, cycle, "crm_failed"), handoffRequest: { cycle } };
    const flow = { startedAt: cycle, outcome: "in_progress", metadata: meta };
    assert.equal(
      projectIndustrialMonitoring(flow, { operatorId: null, queueState: "automacao" }).issue.code,
      "crm_failed",
    );
    assert.equal(
      projectIndustrialMonitoring(flow, { operatorId: "op", queueState: "meus" }).issue,
      null,
    );
    const transferred = {
      startedAt: cycle,
      outcome: "transferred",
      metadata: {
        handoffReceipt: receipt,
        handoffOutbox: { cycle, clientConfirmationRequired: true, clientCancelledAt: cycle },
      },
    };
    assert.equal(
      projectIndustrialMonitoring(transferred, { operatorId: "new", queueState: "meus" })
        .clientConfirmation,
      "cancelled",
    );
    transferred.metadata.handoffOutbox = { cycle, clientConfirmationRequired: true, attempts: 6 };
    assert.equal(
      projectIndustrialMonitoring(transferred, { operatorId: "op", queueState: "meus" })
        .clientConfirmation,
      "failed",
    );
  });
});

describe("entrega pós-commit compartilhada pelo motor e worker", () => {
  it("envia o texto persistido ao responsável correto e usa ID estável", async () => {
    const requests = [];
    const dependencies = {
      notifyOperator: async (p) => {
        assert.equal(p.operatorId, "op");
        return true;
      },
      getContactPhone: async (tenant) => {
        assert.equal(tenant, "fixture");
        return "5514000000000";
      },
      sendText: async (p) => {
        requests.push(p);
        return { sent: true };
      },
    };
    assert.deepEqual(await deliverIndustrialPostCommit(item(), dependencies), {
      operatorNotified: true,
      clientNotified: true,
    });
    await deliverIndustrialPostCommit(item(), dependencies);
    assert.equal(requests[0].text, "Confirmação persistida");
    assert.equal(requests[0].expectedOperatorId, "op");
    assert.equal(requests[0].idempotencyMessageId, requests[1].idempotencyMessageId);
  });
  it("preserva notificação já entregue quando o envio ao cliente lança exceção", async () => {
    const ack = await deliverIndustrialPostCommit(item(), {
      notifyOperator: async () => true,
      getContactPhone: async () => "",
      sendText: async () => {
        throw new Error("SEGREDO");
      },
    });
    assert.deepEqual(ack, { operatorNotified: true, clientNotified: false });
  });
  it("falha de notificação interna não impede confirmação ao cliente", async () => {
    const ack = await deliverIndustrialPostCommit(item(), {
      notifyOperator: async () => {
        throw new Error("falha");
      },
      getContactPhone: async () => "",
      sendText: async () => ({ sent: true }),
    });
    assert.deepEqual(ack, { operatorNotified: false, clientNotified: true });
  });
  it("não chama entregas dispensadas nem transforma resultado negativo em sucesso", async () => {
    const noCall = async () => {
      throw new Error("não deve executar");
    };
    assert.deepEqual(
      await deliverIndustrialPostCommit(
        { ...item(), needClientConfirmation: false, needOperatorNotification: false },
        { notifyOperator: noCall, getContactPhone: noCall, sendText: noCall },
      ),
      { operatorNotified: false, clientNotified: false },
    );
    assert.deepEqual(
      await deliverIndustrialPostCommit(item(), {
        notifyOperator: async () => false,
        getContactPhone: async () => "",
        sendText: async () => ({ sent: false }),
      }),
      { operatorNotified: false, clientNotified: false },
    );
  });
});

function senderHarness({
  existing = null,
  provider = "meta",
  metaFailed = false,
  baileysConfirmed = true,
  site = false,
} = {}) {
  const conversationId = site ? "conv-lc-fixture" : "conv";
  const filters = [],
    sent = [],
    saved = [],
    siteDeliveries = [];
  const tables = Object.fromEntries(
    ["messages", "conversations", "contacts", "channelConfigs", "mediaFiles"].map((name) => [
      name,
      new Proxy(
        { name },
        { get: (target, field) => (field === "name" ? target.name : `${name}.${String(field)}`) },
      ),
    ]),
  );
  const rows = (table) =>
    table === tables.messages
      ? existing
        ? [existing]
        : []
      : table === tables.conversations
        ? [{ id: conversationId, contactId: "contact", queueState: "meus", operatorId: "op" }]
        : table === tables.contacts
          ? [{ phone: "5514000000000" }]
          : table === tables.channelConfigs
            ? [{ activeProvider: provider }]
            : [];
  const manager = {
    getSession: () => ({
      sendMessage: async () => (baileysConfirmed ? { key: { id: "external" } } : {}),
    }),
    notifyPublic() {},
  };
  const dependencies = {
    "drizzle-orm": { eq: (column, value) => ({ column, value }), and: (...values) => values },
    "../../db/schema": tables,
    "../../db": {
      db: {
        select: () => ({
          from: (table) => ({
            where: (conditions) => {
              filters.push({ table: table.name, conditions });
              return { limit: async () => rows(table) };
            },
          }),
        }),
        insert: () => ({
          values: (row) => ({
            onConflictDoUpdate: async () => {
              saved.push(row);
            },
          }),
        }),
        update: () => ({ set: () => ({ where: async () => {} }) }),
      },
    },
    "../baileys/session-manager": {
      SessionManager: { getInstance: () => manager },
      resolveRealJid: async () => "jid",
    },
    "../whatsapp/adapters/meta": {
      metaAdapter: {
        send: async (_, params) => {
          sent.push(params);
          return metaFailed ? { status: "failed" } : { status: "sent", externalId: "external" };
        },
      },
    },
    "../whatsapp/meta-presence": {
      resetMetaTypingThrottle() {},
      sendMetaConversationPresence: async () => {},
    },
    "../ai-persona": { getAiPersona: () => ({ name: "Assistente", triagePolicy: "industrial" }) },
    "../livechat/site-channel-policy": { isSiteConversationId: () => site },
    "../livechat/site-delivery": {
      pushSiteTyping() {},
      deliverSiteBotFragment: async (params) => {
        siteDeliveries.push(params);
        return { id: params.idempotencyMessageId };
      },
    },
  };
  const code = ts.transpileModule(
    fs.readFileSync(new URL("../src/lib/valentina/sdr-channel-sender.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    console: { warn() {} },
    require(name) {
      if (!(name in dependencies)) throw new Error(`Import não permitido: ${name}`);
      return dependencies[name];
    },
  });
  return {
    sent,
    saved,
    filters,
    siteDeliveries,
    send: () =>
      module.exports.sendSdrChannelText({
        tenantId: "fixture",
        conversationId,
        text: "Confirmação",
        idempotencyMessageId: "stable-id",
        expectedOperatorId: "op",
      }),
  };
}
describe("despachante real com transporte e banco isolados", () => {
  it("mensagem pendente não comprova envio; busca de idempotência inclui tenant e conversa", async () => {
    const service = senderHarness({
      existing: { id: "stable-id", status: "pending", externalId: null, provider: "meta" },
    });
    assert.equal((await service.send()).sent, true);
    assert.equal(service.sent.length, 1);
    const lookup = service.filters.find((f) => f.table === "messages");
    assert.ok(
      lookup.conditions.some((c) => c.column === "messages.tenantId" && c.value === "fixture"),
    );
    assert.ok(
      lookup.conditions.some((c) => c.column === "messages.conversationId" && c.value === "conv"),
    );
  });
  it("registro com prova externa impede repetição", async () => {
    const service = senderHarness({
      existing: { id: "stable-id", status: "sent", externalId: "external", provider: "meta" },
    });
    assert.equal((await service.send()).alreadySent, true);
    assert.equal(service.sent.length, 0);
  });
  it("falha Meta e resposta Baileys sem ID não geram confirmação de envio", async () => {
    const meta = senderHarness({ metaFailed: true });
    assert.equal((await meta.send()).sent, false);
    assert.equal(meta.saved.length, 0);
    const baileys = senderHarness({ provider: "baileys", baileysConfirmed: false });
    assert.equal((await baileys.send()).sent, false);
    assert.equal(baileys.saved.length, 0);
  });
  it("site recebe a mesma chave estável usada pelo worker", async () => {
    const service = senderHarness({ site: true });
    assert.equal((await service.send()).sent, true);
    assert.equal(service.siteDeliveries[0].idempotencyMessageId, "stable-id");
  });
});
