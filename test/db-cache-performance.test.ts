import { describe, expect, it } from "bun:test";
import { generateEtag, handleConditionalResponse } from "../src/lib/http-cache";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { crmDeals, crmDealActivities, contacts, conversations, messages } from "../src/db/schema";
import { getTableColumns } from "drizzle-orm";

describe("Fase 5: Banco de Dados, Índices & Cache de Backend", () => {
  describe("HTTP ETag & Cache Condicional (RFC 7232 / 7234)", () => {
    it("deve gerar ETag determinístico para o mesmo conteúdo", () => {
      const payload = { pipelines: [{ id: "pipe-1", name: "Funil Máquinas" }] };
      const etag1 = generateEtag(JSON.stringify(payload));
      const etag2 = generateEtag(JSON.stringify(payload));

      expect(etag1).toBe(etag2);
      expect(etag1.startsWith('"')).toBe(true);
      expect(etag1.endsWith('"')).toBe(true);
      expect(etag1.length).toBeGreaterThan(5);
    });

    it("deve retornar HTTP 200 com ETag e Cache-Control em requisição inicial", () => {
      const request = new Request("http://localhost/api/crm/pipelines", {
        headers: {},
      });
      const data = { pipelines: [{ id: "pipe-1", name: "Máquinas" }] };

      const response = handleConditionalResponse(request, data, {
        headers: { "Access-Control-Allow-Origin": "*" },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("ETag")).toBeTruthy();
      expect(response.headers.get("Cache-Control")).toContain("private");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Content-Type")).toBe("application/json");
    });

    it("deve retornar HTTP 304 Not Modified quando If-None-Match coincide com o ETag", async () => {
      const data = { fields: [{ id: "f-1", name: "Cliente Novo" }] };
      const etag = generateEtag(JSON.stringify(data));

      const request = new Request("http://localhost/api/crm/custom-fields", {
        headers: {
          "If-None-Match": etag,
        },
      });

      const response = handleConditionalResponse(request, data);

      expect(response.status).toBe(304);
      expect(response.headers.get("ETag")).toBe(etag);
      const text = await response.text();
      expect(text).toBe("");
    });

    it("deve suportar tokens fracos (W/) e wildcard (*)", () => {
      const data = { list: [1, 2, 3] };
      const etag = generateEtag(JSON.stringify(data));

      // Token fraco
      const weakRequest = new Request("http://localhost/api/operators", {
        headers: { "If-None-Match": `W/${etag}` },
      });
      const weakResponse = handleConditionalResponse(weakRequest, data);
      expect(weakResponse.status).toBe(304);

      // Wildcard
      const starRequest = new Request("http://localhost/api/operators", {
        headers: { "If-None-Match": "*" },
      });
      const starResponse = handleConditionalResponse(starRequest, data);
      expect(starResponse.status).toBe(304);
    });

    it("deve retornar HTTP 200 quando os dados sofrerem modificação", () => {
      const oldData = { count: 10 };
      const oldEtag = generateEtag(JSON.stringify(oldData));

      const newData = { count: 11 };
      const request = new Request("http://localhost/api/crm/pipelines", {
        headers: { "If-None-Match": oldEtag },
      });

      const response = handleConditionalResponse(request, newData);

      expect(response.status).toBe(200);
      expect(response.headers.get("ETag")).not.toBe(oldEtag);
    });
  });

  describe("Migração DDL de Índices de Alta Performance (0034)", () => {
    const migrationPath = resolve(process.cwd(), "src/db/migrations/0034_performance_indexes.sql");

    it("deve existir o arquivo de migração 0034_performance_indexes.sql", () => {
      expect(existsSync(migrationPath)).toBe(true);
    });

    it("deve conter todos os índices compostos B-Tree essenciais para as queries de produção", () => {
      const sql = readFileSync(migrationPath, "utf8");

      // crm_deals
      expect(sql).toContain("idx_crm_deals_tenant_op_status");
      expect(sql).toContain("idx_crm_deals_tenant_status_closed");
      expect(sql).toContain("idx_crm_deals_tenant_pipe_stage_updated");
      expect(sql).toContain("idx_crm_deals_tenant_status_updated");

      // crm_deal_activities
      expect(sql).toContain("idx_crm_activities_tenant_assignee_status_due");

      // contacts
      expect(sql).toContain("idx_contacts_tenant_phone");
      expect(sql).toContain("idx_contacts_tenant_wallet");

      // conversations
      expect(sql).toContain("idx_conversations_tenant_op_queue_msg_time");

      // messages
      expect(sql).toContain("idx_messages_tenant_external");
    });

    it("deve estar registrado no script de startup apply-platform-access-migration.mjs", () => {
      const runnerPath = resolve(process.cwd(), "scripts/apply-platform-access-migration.mjs");
      const runnerCode = readFileSync(runnerPath, "utf8");

      expect(runnerCode).toContain('"0034_performance_indexes"');
      expect(runnerCode).toContain("0034_performance_indexes.sql");
    });

    it("deve ter os modelos do Drizzle schema mapeando as colunas indexadas corretamente", () => {
      // Verifica que as tabelas possuem as colunas indexadas
      const dealCols = getTableColumns(crmDeals);
      expect(dealCols.tenantId).toBeDefined();
      expect(dealCols.operatorId).toBeDefined();
      expect(dealCols.status).toBeDefined();
      expect(dealCols.closedAt).toBeDefined();
      expect(dealCols.updatedAt).toBeDefined();

      const actCols = getTableColumns(crmDealActivities);
      expect(actCols.tenantId).toBeDefined();
      expect(actCols.assignedToOperatorId).toBeDefined();
      expect(actCols.status).toBeDefined();
      expect(actCols.dueDate).toBeDefined();

      const contactCols = getTableColumns(contacts);
      expect(contactCols.tenantId).toBeDefined();
      expect(contactCols.phone).toBeDefined();
      expect(contactCols.walletOperatorId).toBeDefined();

      const convCols = getTableColumns(conversations);
      expect(convCols.tenantId).toBeDefined();
      expect(convCols.operatorId).toBeDefined();
      expect(convCols.queueState).toBeDefined();
      expect(convCols.lastMessageTime).toBeDefined();

      const msgCols = getTableColumns(messages);
      expect(msgCols.tenantId).toBeDefined();
      expect(msgCols.externalId).toBeDefined();
    });
  });
});
