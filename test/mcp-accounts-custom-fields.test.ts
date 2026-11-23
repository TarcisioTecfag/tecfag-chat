import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { crmAccounts, crmCustomFieldDefinitions } from "../src/db/schema";
import {
  MCP_SERVER_INFO,
  MCP_TOOLS,
  formatMcpToolLabel,
  getVisibleMcpTools,
  isWriteMcpTool,
  processMcpJsonRpcPayload,
  summarizeMcpToolResult,
  type McpAccessContext,
} from "../src/lib/mcp/valem-tecfag-mcp-core";
import {
  computeAccountFilledFields,
  formatAccountCustomFields,
  isCustomFieldValueFilled,
  normalizeCustomFieldDefinitionRow,
  resolveAccountCustomFieldsInput,
  type NormalizedCustomFieldDef,
} from "../src/lib/mcp/valem-tecfag-mcp-account-fields";
import { getApiLibraryCatalog } from "../src/lib/marketing/api-library-catalog";

const RUN_DB_TESTS = Boolean(process.env.DATABASE_URL);

function makeAccess(
  accessLevel: "read" | "read_write",
  tenantId: "tecfag" | "valem" = "tecfag",
): McpAccessContext {
  return {
    authorized: true,
    lockedTenantId: tenantId,
    defaultTenantId: tenantId,
    authMode: tenantId === "valem" ? "token_valem" : "token_tecfag",
    accessLevel,
    keyId: `test-acc-cf-${accessLevel}`,
    keyLabel: `Chave Teste Empresas (${accessLevel})`,
    skipAuditLog: true,
  };
}

async function callMcp(
  name: string,
  args: Record<string, unknown>,
  access: McpAccessContext,
) {
  const res = await processMcpJsonRpcPayload(
    {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    },
    access,
  );
  const text = String(res.body?.result?.content?.[0]?.text || "");
  if (res.body?.result?.isError) {
    return { isError: true as const, errorText: text, data: null as any };
  }
  return { isError: false as const, errorText: "", data: JSON.parse(text) };
}

describe("MCP v3.8.0 — Empresas (crm_accounts), Campos Personalizados & Preenchimento", () => {
  it("expõe versão 3.8.0, registra list_crm_custom_fields como leitura e mantém 100% de paridade na Biblioteca de API", () => {
    expect(MCP_SERVER_INFO.version).toBe("3.9.0");

    const listTool = MCP_TOOLS.find((t) => t.name === "list_crm_custom_fields");
    expect(listTool).toBeDefined();
    expect(listTool?.access).toBe("read");
    expect(isWriteMcpTool("list_crm_custom_fields")).toBe(false);
    expect(formatMcpToolLabel("list_crm_custom_fields")).toBe("Campos Personalizados do CRM");

    const readVisibleNames = new Set(getVisibleMcpTools(makeAccess("read")).map((t) => t.name));
    expect(readVisibleNames.has("list_crm_custom_fields")).toBe(true);
    expect(readVisibleNames.has("search_crm_accounts")).toBe(true);

    const searchTool = MCP_TOOLS.find((t) => t.name === "search_crm_accounts");
    const searchProps = (searchTool?.inputSchema as any)?.properties || {};
    expect(searchProps.offset).toBeDefined();
    expect(searchProps.hasCustomFields).toBeDefined();
    expect(searchProps.filledField).toBeDefined();
    expect(searchProps.includeEmpty).toBeDefined();

    const createAccTool = MCP_TOOLS.find((t) => t.name === "create_account");
    const updateAccTool = MCP_TOOLS.find((t) => t.name === "update_account");
    expect((createAccTool?.inputSchema as any)?.properties?.customFields).toBeDefined();
    expect((updateAccTool?.inputSchema as any)?.properties?.customFields).toBeDefined();
    expect((createAccTool?.inputSchema as any)?.properties?.address).toBeDefined();
    expect((updateAccTool?.inputSchema as any)?.properties?.address).toBeDefined();

    const catalogMcp = getApiLibraryCatalog("tecfag").filter((e) => e.kind === "mcp");
    expect(catalogMcp.some((e) => e.mcpToolName === "list_crm_custom_fields")).toBe(true);

    expect(
      summarizeMcpToolResult("list_crm_custom_fields", { totalFields: 4, entityType: "company" }),
    ).toBe("4 campo(s) personalizado(s) listado(s) (company)");

    expect(
      summarizeMcpToolResult("search_crm_accounts", {
        returnedCount: 2,
        accounts: [{ name: "Indústria Alpha" }],
      }),
    ).toBe("2 empresa(s) encontrada(s) (ex: Indústria Alpha)");
  });

  it("formata customFields (single/multiple/texto/órfão) e calcula filledFields + campos vazios corretamente", () => {
    const defs: NormalizedCustomFieldDef[] = [
      normalizeCustomFieldDefinitionRow({
        id: "cf-ramo",
        entity_type: "company",
        name: "Ramo Industrial",
        field_type: "single",
        options: [
          { id: "opt-alim", label: "Alimentos" },
          { id: "opt-farm", label: "Farmacêutico" },
        ],
        required: true,
      }),
      normalizeCustomFieldDefinitionRow({
        id: "cf-linhas",
        entity_type: "company",
        name: "Linhas de Interesse",
        field_type: "multiple",
        options: [
          { id: "opt-semi", label: "Semi-Industrial" },
          { id: "opt-pers", label: "Personnalité" },
        ],
        required: false,
      }),
      normalizeCustomFieldDefinitionRow({
        id: "cf-faturamento",
        entity_type: "company",
        name: "Faixa de Faturamento",
        field_type: "text",
        options: [],
        required: false,
      }),
    ];

    expect(isCustomFieldValueFilled("")).toBe(false);
    expect(isCustomFieldValueFilled("   ")).toBe(false);
    expect(isCustomFieldValueFilled([])).toBe(false);
    expect(isCustomFieldValueFilled(null)).toBe(false);
    expect(isCustomFieldValueFilled(0)).toBe(true);
    expect(isCustomFieldValueFilled("ok")).toBe(true);

    const formatted = formatAccountCustomFields(
      {
        "cf-ramo": "opt-alim",
        "cf-linhas": ["opt-semi", "opt-pers"],
        "cf-faturamento": "   ",
        legacy_note: "Importado RD",
      },
      defs,
    );

    expect(formatted.customFields).toEqual({
      "Ramo Industrial": "Alimentos",
      "Linhas de Interesse": ["Semi-Industrial", "Personnalité"],
      legacy_note: "Importado RD",
    });
    expect(formatted.customFieldsRaw).toEqual({
      "cf-ramo": "opt-alim",
      "cf-linhas": ["opt-semi", "opt-pers"],
      legacy_note: "Importado RD",
    });
    expect(formatted.filledCustomFields).toHaveLength(3);
    expect(formatted.filledCustomFields[0]?.displayValue).toBe("Alimentos");
    expect(formatted.filledCustomFields[1]?.displayValue).toBe("Semi-Industrial, Personnalité");
    expect(formatted.emptyCustomFields).toEqual([
      {
        id: "cf-faturamento",
        name: "Faixa de Faturamento",
        fieldType: "text",
        required: false,
      },
    ]);

    const summary = computeAccountFilledFields(
      {
        name: "Alpha Alimentos Ltda",
        tradeName: "Alpha",
        segment: "Indústria",
        document: "12345678000199",
        phone: null,
        email: "compras@alpha.com.br",
        website: "",
        notes: null,
        rdOrganizationId: null,
      },
      {
        razaoSocial: "ALPHA ALIMENTOS LTDA",
        situacaoCadastral: "ATIVA",
        endereco: { municipio: "Bauru", uf: "SP" },
      },
      formatted.filledCustomFields,
    );

    expect(summary.filledFields.standard).toEqual([
      "name",
      "tradeName",
      "segment",
      "document",
      "email",
    ]);
    expect(summary.filledFields.receitaFederal).toEqual([
      "razaoSocial",
      "situacaoCadastral",
      "endereco.municipio",
      "endereco.uf",
    ]);
    expect(summary.filledFields.custom).toEqual([
      "Ramo Industrial",
      "Linhas de Interesse",
      "legacy_note",
    ]);
    expect(summary.filledFields.totalFilledCount).toBe(12);
    expect(summary.emptyStandardFields).toEqual([
      "phone",
      "website",
      "notes",
      "rdOrganizationId",
    ]);
  });

  it("resolveAccountCustomFieldsInput resolve nome de campo e rótulo de opção em single/multiple", async () => {
    const fakeDefs: any[] = [
      {
        id: "cf-ramo",
        name: "Ramo Industrial",
        fieldType: "single",
        options: [
          { id: "opt-alim", label: "Alimentos" },
          { id: "opt-farm", label: "Farmacêutico" },
        ],
      },
      {
        id: "cf-linhas",
        name: "Linhas de Interesse",
        fieldType: "multiple",
        options: [
          { id: "opt-semi", label: "Semi-Industrial" },
          { id: "opt-pers", label: "Personnalité" },
        ],
      },
      {
        id: "cf-obs",
        name: "Observação Técnica",
        fieldType: "text",
        options: [],
      },
    ];

    const resolved = await resolveAccountCustomFieldsInput(
      "tecfag",
      {
        "ramo industrial": "farmaceutico",
        "Linhas de Interesse": ["Semi-Industrial", "opt-pers"],
        "cf-obs": "Usa seladora contínua",
      },
      fakeDefs,
    );

    expect(resolved).toEqual({
      "cf-ramo": "opt-farm",
      "cf-linhas": ["opt-semi", "opt-pers"],
      "cf-obs": "Usa seladora contínua",
    });
  });

  it("rejeita entityType inválido em list_crm_custom_fields", async () => {
    const res = await callMcp(
      "list_crm_custom_fields",
      { entityType: "invalid_entity" },
      makeAccess("read"),
    );
    expect(res.isError).toBe(true);
    expect(res.errorText).toContain("entityType inválido");
  });

  if (RUN_DB_TESTS) {
    describe("Integração PostgreSQL real — search_crm_accounts + list_crm_custom_fields + create/update_account", () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const cfTextId = `cf-test-acc-txt-${suffix}`;
      const cfSingleId = `cf-test-acc-sgl-${suffix}`;
      const createdAccountIds: string[] = [];
      const createdFieldIds: string[] = [cfTextId, cfSingleId];

      beforeAll(async () => {
        await db.insert(crmCustomFieldDefinitions).values([
          {
            id: cfTextId,
            tenantId: "tecfag",
            entityType: "company",
            name: `ERP Teste ${suffix}`,
            fieldType: "text",
            options: [],
            required: false,
            allPipelines: true,
            pipelineIds: [],
            visibleOnCreate: true,
            isUnique: false,
            requiredRule: "always",
            sortOrder: 901,
          },
          {
            id: cfSingleId,
            tenantId: "tecfag",
            entityType: "company",
            name: `Porte Teste ${suffix}`,
            fieldType: "single",
            options: [
              { id: "opt-peq", label: "Pequena" },
              { id: "opt-grd", label: "Grande" },
            ],
            required: false,
            allPipelines: true,
            pipelineIds: [],
            visibleOnCreate: true,
            isUnique: false,
            requiredRule: "always",
            sortOrder: 902,
          },
        ]);
      });

      afterAll(async () => {
        if (createdAccountIds.length > 0) {
          await db
            .delete(crmAccounts)
            .where(
              and(
                eq(crmAccounts.tenantId, "tecfag"),
                inArray(crmAccounts.id, createdAccountIds),
              ),
            );
        }
        await db
          .delete(crmCustomFieldDefinitions)
          .where(
            and(
              eq(crmCustomFieldDefinitions.tenantId, "tecfag"),
              inArray(crmCustomFieldDefinitions.id, createdFieldIds),
            ),
          );
      });

      it("cria empresa com customFields por nome/label, consulta preenchimento via search_crm_accounts e audita cobertura via list_crm_custom_fields", async () => {
        const rw = makeAccess("read_write", "tecfag");
        const ro = makeAccess("read", "tecfag");

        // Gera CNPJ válido único para o teste
        const makeValidCnpj = () => {
          const base = Array.from({ length: 8 }, () => Math.floor(Math.random() * 9) + 1).concat([0, 0, 0, 1]);
          const calcDigit = (digits: number[], weights: number[]) => {
            const sum = digits.reduce((acc, d, idx) => acc + d * weights[idx], 0);
            const rem = sum % 11;
            return rem < 2 ? 0 : 11 - rem;
          };
          const d1 = calcDigit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
          const d2 = calcDigit([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
          return [...base, d1, d2].join("");
        };

        const accName = `Empresa Teste MCP ${suffix}`;
        const created = await callMcp(
          "create_account",
          {
            name: accName,
            type: "company",
            document: makeValidCnpj(),
            tradeName: `Fantasia ${suffix}`,
            phone: "5514999990001",
            email: `teste-${suffix}@exemplo.com.br`,
            address: { city: "Bauru", state: "SP" },
            customFields: {
              [`ERP Teste ${suffix}`]: "TOTVS Protheus",
              [`Porte Teste ${suffix}`]: "Grande",
            },
          },
          rw,
        );
        if (created.isError) {
          throw new Error(`create_account falhou: ${created.errorText}`);
        }
        expect(created.isError).toBe(false);
        expect(created.data.success).toBe(true);
        const accountId = String(created.data.accountId);
        createdAccountIds.push(accountId);
        expect(created.data.customFields[cfTextId]).toBe("TOTVS Protheus");
        expect(created.data.customFields[cfSingleId]).toBe("opt-grd");

        // Ficha completa via accountId
        const detail = await callMcp("search_crm_accounts", { accountId }, ro);
        expect(detail.isError).toBe(false);
        expect(detail.data.account.customFields[`ERP Teste ${suffix}`]).toBe("TOTVS Protheus");
        expect(detail.data.account.customFields[`Porte Teste ${suffix}`]).toBe("Grande");
        expect(detail.data.account.customFieldsRaw[cfSingleId]).toBe("opt-grd");
        expect(detail.data.account.filledFields.custom).toContain(`ERP Teste ${suffix}`);
        expect(detail.data.account.filledFields.custom).toContain(`Porte Teste ${suffix}`);
        expect(detail.data.account.filledFields.standard).toContain("tradeName");
        expect(detail.data.account.filledFields.receitaFederal).toContain("endereco.municipio");
        expect(detail.data.account.filledFields.receitaFederal).toContain("endereco.uf");

        // Busca filtrada por hasCustomFields e filledField (por nome do campo personalizado)
        const listFiltered = await callMcp(
          "search_crm_accounts",
          {
            query: suffix,
            hasCustomFields: true,
            filledField: `ERP Teste ${suffix}`,
            includeEmpty: true,
            offset: 0,
            limit: 10,
          },
          ro,
        );
        expect(listFiltered.isError).toBe(false);
        expect(listFiltered.data.totalMatching).toBe(1);
        expect(listFiltered.data.hasMore).toBe(false);
        expect(listFiltered.data.accounts).toHaveLength(1);
        expect(listFiltered.data.accounts[0].id).toBe(accountId);
        expect(listFiltered.data.accounts[0].customFields[`Porte Teste ${suffix}`]).toBe("Grande");

        // Atualização de customFields via update_account
        const updated = await callMcp(
          "update_account",
          {
            accountId,
            customFields: {
              [`Porte Teste ${suffix}`]: "Pequena",
              [`ERP Teste ${suffix}`]: null,
            },
          },
          rw,
        );
        expect(updated.isError).toBe(false);
        expect(updated.data.customFields[cfSingleId]).toBe("opt-peq");
        expect(updated.data.customFields[cfTextId]).toBeNull();

        // list_crm_custom_fields com includeUsageStats=true
        const fieldsRes = await callMcp(
          "list_crm_custom_fields",
          {
            entityType: "company",
            includeUsageStats: true,
            search: suffix,
          },
          ro,
        );
        expect(fieldsRes.isError).toBe(false);
        expect(fieldsRes.data.totalFields).toBe(2);
        expect(fieldsRes.data.companyStandardFieldsCoverage).toBeDefined();
        expect(fieldsRes.data.companyStandardFieldsCoverage.totalAccounts).toBeGreaterThanOrEqual(1);

        const singleFieldStat = fieldsRes.data.fields.find((f: any) => f.id === cfSingleId);
        const textFieldStat = fieldsRes.data.fields.find((f: any) => f.id === cfTextId);
        expect(singleFieldStat?.filledRecordsCount).toBe(1);
        expect(textFieldStat?.filledRecordsCount).toBe(0);
      });
    });
  }
});
