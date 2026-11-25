import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  contacts,
  crmDeals,
  crmPipelines,
  crmStages,
  operators,
  tenants,
  webhookDeliveries,
  webhookSubscriptions,
} from "../src/db/schema";
import { crmService } from "../src/lib/crm/crm-service";
import {
  SUPPORTED_WEBHOOK_EVENTS,
  ensureWebhookDeliveriesSchema,
  ensureWebhookSubscriptionsSchema,
  maskWebhookSecret,
  validateWebhookEvents,
} from "../src/lib/webhooks/dispatcher";
import { verifySignature } from "../src/lib/webhooks/crypto";
import { processMcpJsonRpcPayload, type McpAccessContext } from "../src/lib/mcp/valem-tecfag-mcp-core";

function hasLocalPostgres(): boolean {
  if (!fs.existsSync(".env")) return false;
  const raw = fs.readFileSync(".env", "utf8");
  const m = raw.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m?.[1]) return false;
  try {
    const u = new URL(m[1]);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

const RUN_DB_TESTS = hasLocalPostgres();

describe("Webhook Hub — helpers puros", () => {
  it("valida eventos suportados e mascara secret corretamente", () => {
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain("deal.created");
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain("deal.updated");
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain("deal.won");
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain("deal.lost");
    expect(SUPPORTED_WEBHOOK_EVENTS).toContain("message.received");

    expect(validateWebhookEvents(["deal.created", "deal.updated", "deal.created"])).toEqual([
      "deal.created",
      "deal.updated",
    ]);
    expect(() => validateWebhookEvents(["deal.stage_changed"])).toThrow("Eventos não suportados");
    expect(() => validateWebhookEvents([])).toThrow("ao menos um evento");

    expect(maskWebhookSecret("whsec_1234567890abcdef")).toBe("whsec_12••••cdef");
    expect(maskWebhookSecret("short")).toBe("••••••••");
  });
});

async function waitFor<T>(fn: () => T | undefined | null, timeoutMs = 4000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = fn();
    if (val !== undefined && val !== null) return val;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`Timeout aguardando condição após ${timeoutMs}ms`);
}

describe.skipIf(!RUN_DB_TESTS)("Integração PostgreSQL — Webhook Hub (deal.created / deal.updated / deal.won / deal.lost + isolamento)", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const tecfagPipeId = `pipe-wh-tf-${suffix}`;
  const tecfagStageA = `stg-wh-tf-a-${suffix}`;
  const tecfagStageB = `stg-wh-tf-b-${suffix}`;
  const tecfagOpId = `op-wh-tf-${suffix}`;
  const tecfagContactId = `cont-wh-tf-${suffix}`;
  const tecfagSubId = crypto.randomUUID();
  const valemSubId = crypto.randomUUID();
  const tecfagSecret = `whsec_tf_${suffix}`;
  const valemSecret = `whsec_vl_${suffix}`;
  const createdDealIds: string[] = [];

  const receivedTecfag: Array<{ event: string; sig: string; body: any }> = [];
  const receivedValem: Array<{ event: string; sig: string; body: any }> = [];
  let server: http.Server;

  beforeAll(async () => {
    await ensureWebhookSubscriptionsSchema();
    await ensureWebhookDeliveriesSchema();

    await db
      .insert(tenants)
      .values([
        { id: "tecfag", name: "Tecfag", slug: "tecfag", connectionType: "meta" },
        { id: "valem", name: "Valem", slug: "valem", connectionType: "baileys" },
      ])
      .onConflictDoNothing();

    await db.insert(operators).values({
      id: tecfagOpId,
      tenantId: "tecfag",
      name: `Operador WH ${suffix}`,
      email: `wh-${suffix}@tecfag.test`,
      passwordHash: "hash-test",
      role: "agent",
      status: "disponivel",
      isOnline: true,
    });

    await db.insert(crmPipelines).values({
      id: tecfagPipeId,
      tenantId: "tecfag",
      name: `FUNIL WH ${suffix}`,
      orderIndex: 99,
      isDefault: false,
    });

    await db.insert(crmStages).values([
      { id: tecfagStageA, tenantId: "tecfag", pipelineId: tecfagPipeId, name: "ATENDER", orderIndex: 0 },
      { id: tecfagStageB, tenantId: "tecfag", pipelineId: tecfagPipeId, name: "PROPOSTA", orderIndex: 1 },
    ]);

    await db.insert(contacts).values({
      id: tecfagContactId,
      tenantId: "tecfag",
      name: `Cliente WH ${suffix}`,
      phone: `5511944${suffix.replace(/\D/g, "").padEnd(6, "5").slice(0, 6)}`,
      mainChannel: "whatsapp",
    });

    server = http.createServer((req, res) => {
      const event = String(req.headers["x-webhook-event"] || "");
      const sig = String(req.headers["x-webhook-signature"] || "");
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        if (req.url === "/tecfag") {
          receivedTecfag.push({ event, sig, body });
        } else if (req.url === "/valem") {
          receivedValem.push({ event, sig, body });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    await db.insert(webhookSubscriptions).values([
      {
        id: tecfagSubId,
        tenantId: "tecfag",
        name: `Receptor CRM Tecfag ${suffix}`,
        url: `http://127.0.0.1:${addr.port}/tecfag`,
        secret: tecfagSecret,
        events: ["deal.created", "deal.updated", "deal.won", "deal.lost"],
        isActive: true,
      },
      {
        id: valemSubId,
        tenantId: "valem",
        name: `Receptor CRM Valem ${suffix}`,
        url: `http://127.0.0.1:${addr.port}/valem`,
        secret: valemSecret,
        events: ["deal.created", "deal.updated", "deal.won", "deal.lost"],
        isActive: true,
      },
    ]);
  });

  afterAll(async () => {
    server?.close();
    await db
      .delete(webhookDeliveries)
      .where(inArray(webhookDeliveries.subscriptionId, [tecfagSubId, valemSubId]))
      .catch(() => {});
    await db
      .delete(webhookSubscriptions)
      .where(inArray(webhookSubscriptions.id, [tecfagSubId, valemSubId]))
      .catch(() => {});
    if (createdDealIds.length > 0) {
      await db.delete(crmDeals).where(inArray(crmDeals.id, createdDealIds)).catch(() => {});
    }
    await db.delete(contacts).where(eq(contacts.id, tecfagContactId)).catch(() => {});
    await db.delete(crmPipelines).where(eq(crmPipelines.id, tecfagPipeId)).catch(() => {});
    await db.delete(operators).where(eq(operators.id, tecfagOpId)).catch(() => {});
  });

  it("emite deal.created, deal.updated, deal.won e deal.lost assinados com HMAC e isolados por tenant", async () => {
    // 1. Criar negociação -> deal.created
    const deal = await crmService.createDeal("tecfag", tecfagOpId, {
      title: `Card Webhook Hub ${suffix}`,
      pipelineId: tecfagPipeId,
      stageId: tecfagStageA,
      contactId: tecfagContactId,
      operatorId: tecfagOpId,
      value: 15000,
    });
    createdDealIds.push(deal.id);

    const createdEvt = await waitFor(() =>
      receivedTecfag.find((e) => e.event === "deal.created" && e.body?.data?.dealId === deal.id),
    );
    expect(verifySignature(createdEvt.body, createdEvt.sig, tecfagSecret)).toBe(true);
    expect(createdEvt.body.tenant_id).toBe("tecfag");
    expect(createdEvt.body.data.stageId).toBe(tecfagStageA);

    // 2. Mover etapa e alterar valor -> deal.updated
    await crmService.updateDeal("tecfag", deal.id, tecfagOpId, {
      stageId: tecfagStageB,
      value: 22000,
    });

    const updatedEvt = await waitFor(() =>
      receivedTecfag.find(
        (e) =>
          e.event === "deal.updated" &&
          e.body?.data?.dealId === deal.id &&
          e.body?.data?.stageId === tecfagStageB,
      ),
    );
    expect(verifySignature(updatedEvt.body, updatedEvt.sig, tecfagSecret)).toBe(true);
    expect(updatedEvt.body.data.previousStageId).toBe(tecfagStageA);
    expect(updatedEvt.body.data.changedFields).toContain("stageId");
    expect(updatedEvt.body.data.changedFields).toContain("value");

    // 3. Marcar como ganho -> deal.won + deal.updated
    await crmService.updateDeal("tecfag", deal.id, tecfagOpId, {
      status: "won",
      winReason: "Fechamento validado",
    });

    const wonEvt = await waitFor(() =>
      receivedTecfag.find((e) => e.event === "deal.won" && e.body?.data?.dealId === deal.id),
    );
    expect(verifySignature(wonEvt.body, wonEvt.sig, tecfagSecret)).toBe(true);
    expect(wonEvt.body.data.status).toBe("won");

    // 4. Criar 2º card e marcar como perdido -> deal.lost
    const deal2 = await crmService.createDeal("tecfag", tecfagOpId, {
      title: `Card Lost Webhook ${suffix}`,
      pipelineId: tecfagPipeId,
      stageId: tecfagStageA,
      contactId: tecfagContactId,
      operatorId: tecfagOpId,
    });
    createdDealIds.push(deal2.id);

    await crmService.updateDeal("tecfag", deal2.id, tecfagOpId, {
      status: "lost",
      lossReason: "Preço fora do orçamento",
    });

    const lostEvt = await waitFor(() =>
      receivedTecfag.find((e) => e.event === "deal.lost" && e.body?.data?.dealId === deal2.id),
    );
    expect(verifySignature(lostEvt.body, lostEvt.sig, tecfagSecret)).toBe(true);
    expect(lostEvt.body.data.status).toBe("lost");
    expect(lostEvt.body.data.lossReason).toBe("Preço fora do orçamento");

    // 5. Isolamento multi-tenant: Valem não recebeu NENHUM evento da Tecfag
    expect(receivedValem.length).toBe(0);

    // 6. MCP list_webhook_subscriptions retorna subscrição da Tecfag sem vazar Valem
    const access: McpAccessContext = {
      authorized: true,
      lockedTenantId: "tecfag",
      defaultTenantId: "tecfag",
      authMode: "token_tecfag",
      accessLevel: "read",
      keyId: "test-wh-key",
      keyLabel: "Teste WH",
      skipAuditLog: true,
    };
    const res = await processMcpJsonRpcPayload(
      {
        jsonrpc: "2.0",
        id: "wh-list-1",
        method: "tools/call",
        params: { name: "list_webhook_subscriptions", arguments: {} },
      },
      access,
    );
    expect(Boolean(res.body?.result?.isError)).toBe(false);
    const parsed = JSON.parse(String(res.body?.result?.content?.[0]?.text || "{}"));
    expect(parsed.subscriptions.some((s: any) => s.id === tecfagSubId)).toBe(true);
    expect(parsed.subscriptions.some((s: any) => s.id === valemSubId)).toBe(false);
  });
});
