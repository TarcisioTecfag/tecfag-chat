import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { metaMessageTemplates, metaTemplateGroups, sectors, tenants } from "../src/db/schema";
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
  computeNextTemplateGroups,
  resolveCanonicalGroupNames,
} from "../src/lib/mcp/valem-tecfag-mcp-template-groups-tools";
import {
  ensureMetaTemplateGroupsSchema,
  filterMetaTemplatesForSector,
  isMetaTemplateGroupVisibleForSector,
  type MetaTemplateGroupItem,
} from "../src/lib/whatsapp/meta-templates";
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
    keyId: `test-tpl-groups-${accessLevel}`,
    keyLabel: `Chave Teste Categorias (${accessLevel})`,
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

describe("MCP v3.7.0 — CRUD Completo de Categorias/Grupos de Templates Meta & Visibilidade por Setor", () => {
  it("expõe list_meta_template_groups em leitura, 3 tools de escrita apenas em read_write e 100% de paridade na Biblioteca de API", async () => {
    expect(MCP_SERVER_INFO.version).toBe("3.7.0");

    const readTools = getVisibleMcpTools(makeAccess("read"));
    const rwTools = getVisibleMcpTools(makeAccess("read_write"));
    const readNames = new Set(readTools.map((t) => t.name));
    const rwNames = new Set(rwTools.map((t) => t.name));

    expect(readNames.has("list_meta_template_groups")).toBe(true);
    expect(readNames.has("save_meta_template_group")).toBe(false);
    expect(readNames.has("delete_meta_template_group")).toBe(false);
    expect(readNames.has("set_meta_template_groups")).toBe(false);

    expect(rwNames.has("list_meta_template_groups")).toBe(true);
    expect(rwNames.has("save_meta_template_group")).toBe(true);
    expect(rwNames.has("delete_meta_template_group")).toBe(true);
    expect(rwNames.has("set_meta_template_groups")).toBe(true);

    expect(isWriteMcpTool("list_meta_template_groups")).toBe(false);
    expect(isWriteMcpTool("save_meta_template_group")).toBe(true);
    expect(isWriteMcpTool("delete_meta_template_group")).toBe(true);
    expect(isWriteMcpTool("set_meta_template_groups")).toBe(true);

    expect(formatMcpToolLabel("list_meta_template_groups")).toBe(
      "Listagem de Categorias de Templates Meta",
    );
    expect(formatMcpToolLabel("save_meta_template_group")).toBe(
      "Criar / Editar Categoria de Templates Meta",
    );
    expect(formatMcpToolLabel("delete_meta_template_group")).toBe(
      "Excluir Categoria de Templates Meta",
    );
    expect(formatMcpToolLabel("set_meta_template_groups")).toBe(
      "Vincular Templates Meta a Categorias (Unitário/Lote)",
    );

    expect(
      summarizeMcpToolResult("list_meta_template_groups", {
        totalGroups: 6,
        classifiedCount: 50,
        unclassifiedCount: 24,
      }),
    ).toContain("6 categoria(s) de templates");
    expect(
      summarizeMcpToolResult("save_meta_template_group", {
        created: true,
        group: { name: "Fagner" },
        templateCount: 12,
      }),
    ).toContain('Categoria "Fagner" criada (12 template(s) vinculado(s))');
    expect(
      summarizeMcpToolResult("delete_meta_template_group", {
        deletedGroup: { name: "TESTES" },
        detachedTemplateCount: 2,
      }),
    ).toContain('Categoria "TESTES" excluída (2 template(s) desvinculado(s))');
    expect(
      summarizeMcpToolResult("set_meta_template_groups", {
        dryRun: true,
        updatedCount: 10,
        totalRequested: 12,
      }),
    ).toContain("[DRY-RUN] 10/12 template(s) atualizado(s)");

    const catalogNames = new Set(
      getApiLibraryCatalog("tecfag")
        .filter((e) => e.kind === "mcp")
        .map((e) => e.mcpToolName),
    );
    for (const toolName of [
      "list_meta_template_groups",
      "save_meta_template_group",
      "delete_meta_template_group",
      "set_meta_template_groups",
    ]) {
      expect(catalogNames.has(toolName)).toBe(true);
      expect(MCP_TOOLS.some((t) => t.name === toolName)).toBe(true);
    }

    // Chave read-only bloqueia todas as 3 tools de escrita
    for (const writeName of [
      "save_meta_template_group",
      "delete_meta_template_group",
      "set_meta_template_groups",
    ]) {
      const blocked = await callMcp(writeName, {}, makeAccess("read"));
      expect(blocked.isError).toBe(true);
      expect(blocked.errorText).toContain("Permissão insuficiente (Somente Leitura)");
    }
  });

  it("resolve nomes canônicos sem duplicar por acento/caixa e calcula add/remove/replace corretamente", () => {
    const canonical = resolveCanonicalGroupNames(
      ["comercial", "Pos-Venda", "COMERCIAL", "Fagner"],
      ["COMERCIAL", "PÓS-VENDA"],
    );
    expect(canonical).toEqual(["COMERCIAL", "PÓS-VENDA", "Fagner"]);

    const added = computeNextTemplateGroups(
      ["COMERCIAL"],
      { addGroups: ["fagner", "comercial"] },
      ["COMERCIAL", "Fagner"],
    );
    expect(added).toEqual(["COMERCIAL", "Fagner"]);

    const removed = computeNextTemplateGroups(
      ["COMERCIAL", "PÓS-VENDA"],
      { removeGroups: ["pos-venda"] },
      ["COMERCIAL", "PÓS-VENDA"],
    );
    expect(removed).toEqual(["COMERCIAL"]);

    const replaced = computeNextTemplateGroups(
      ["COMERCIAL"],
      { groups: ["fagner"] },
      ["COMERCIAL", "Fagner"],
    );
    expect(replaced).toEqual(["Fagner"]);
  });

  it("valida argumentos obrigatórios e trava confirmDelete em delete_meta_template_group", async () => {
    const noConfirm = await callMcp(
      "delete_meta_template_group",
      { name: "COMERCIAL", confirmDelete: false },
      makeAccess("read_write"),
    );
    expect(noConfirm.isError).toBe(true);
    expect(noConfirm.errorText).toContain("confirmDelete=true");

    const noName = await callMcp(
      "save_meta_template_group",
      { name: "   " },
      makeAccess("read_write"),
    );
    expect(noName.isError).toBe(true);
    expect(noName.errorText).toContain("name");

    const noTarget = await callMcp(
      "set_meta_template_groups",
      { groups: ["COMERCIAL"] },
      makeAccess("read_write"),
    );
    expect(noTarget.isError).toBe(true);
    expect(noTarget.errorText).toContain("assignments");
  });

  describe.skipIf(!RUN_DB_TESTS)("Integração PostgreSQL Real (CRUD + Lote + Isolamento Multi-Tenant)", () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const createdTemplateIds: string[] = [];
    const createdGroupNames: string[] = [];
    const tplA = {
      id: `tecfag:mcp_tg_${suffix}_a`,
      metaTemplateId: `mcp_tg_${suffix}_a`,
      name: `mcp_tg_${suffix}_comercial`,
    };
    const tplB = {
      id: `tecfag:mcp_tg_${suffix}_b`,
      metaTemplateId: `mcp_tg_${suffix}_b`,
      name: `mcp_tg_${suffix}_fagner`,
    };
    const tplValem = {
      id: `valem:mcp_tg_${suffix}_v`,
      metaTemplateId: `mcp_tg_${suffix}_v`,
      name: `mcp_tg_${suffix}_valem`,
    };
    const groupEmpty = `CAT_VAZIA_${suffix}`;
    const groupFagner = `Fagner_${suffix}`;
    const groupFagnerRenamed = `Fagner_SDR_${suffix}`;
    const groupComercial = `COMERCIAL_${suffix}`;

    beforeAll(async () => {
      await ensureMetaTemplateGroupsSchema();
      await db
        .insert(tenants)
        .values([
          { id: "tecfag", name: "Tecfag", slug: "tecfag", connectionType: "meta" },
          { id: "valem", name: "Valem", slug: "valem", connectionType: "baileys" },
        ])
        .onConflictDoNothing();

      createdTemplateIds.push(tplA.id, tplB.id, tplValem.id);
      createdGroupNames.push(groupEmpty, groupFagner, groupFagnerRenamed, groupComercial);

      await db.insert(metaMessageTemplates).values([
        {
          id: tplA.id,
          tenantId: "tecfag",
          metaTemplateId: tplA.metaTemplateId,
          name: tplA.name,
          language: "pt_BR",
          category: "MARKETING",
          status: "APPROVED",
          bodyText: "Olá teste A",
          components: [],
          bindings: {},
          customGroups: [],
        },
        {
          id: tplB.id,
          tenantId: "tecfag",
          metaTemplateId: tplB.metaTemplateId,
          name: tplB.name,
          language: "pt_BR",
          category: "UTILITY",
          status: "APPROVED",
          bodyText: "Olá teste B",
          components: [],
          bindings: {},
          customGroups: [],
        },
        {
          id: tplValem.id,
          tenantId: "valem",
          metaTemplateId: tplValem.metaTemplateId,
          name: tplValem.name,
          language: "pt_BR",
          category: "UTILITY",
          status: "APPROVED",
          bodyText: "Olá Valem",
          components: [],
          bindings: {},
          customGroups: [],
        },
      ]);
    });

    afterAll(async () => {
      await db
        .delete(metaMessageTemplates)
        .where(inArray(metaMessageTemplates.id, createdTemplateIds));
      for (const gName of createdGroupNames) {
        await db
          .delete(metaTemplateGroups)
          .where(and(eq(metaTemplateGroups.tenantId, "tecfag"), eq(metaTemplateGroups.name, gName)));
      }
    });

    it("executa ciclo completo: criar vazia -> listar vazia -> vincular em lote -> renomear preservando -> incremental -> excluir -> isolar valem", async () => {
      const rwTecfag = makeAccess("read_write", "tecfag");
      const readTecfag = makeAccess("read", "tecfag");
      const readValem = makeAccess("read", "valem");

      // 1. Cria categoria vazia
      const createdEmpty = await callMcp(
        "save_meta_template_group",
        { name: groupEmpty },
        rwTecfag,
      );
      expect(createdEmpty.isError).toBe(false);
      expect(createdEmpty.data.created).toBe(true);
      expect(createdEmpty.data.templateCount).toBe(0);

      // 2. list_meta_template_groups retorna a categoria vazia e os templates sem categoria
      const listed = await callMcp(
        "list_meta_template_groups",
        { search: suffix },
        readTecfag,
      );
      expect(listed.isError).toBe(false);
      expect(listed.data.groups.some((g: any) => g.name === groupEmpty && g.templateCount === 0)).toBe(true);
      expect(listed.data.unclassifiedTemplates.some((t: any) => t.name === tplA.name)).toBe(true);

      // 3. list_meta_templates também devolve groups e suporta filtro group='__UNGROUPED__'
      const listTpls = await callMcp(
        "list_meta_templates",
        { search: suffix, group: "__UNGROUPED__" },
        readTecfag,
      );
      expect(listTpls.isError).toBe(false);
      expect(listTpls.data.groups.some((g: any) => g.name === groupEmpty)).toBe(true);
      expect(listTpls.data.templates.map((t: any) => t.name).sort()).toEqual(
        [tplA.name, tplB.name].sort(),
      );

      // 4. Dry-run de classificação em lote
      const dry = await callMcp(
        "set_meta_template_groups",
        {
          dryRun: true,
          assignments: [
            { templateName: tplA.name, groups: [groupComercial] },
            { templateName: tplB.name, groups: [groupFagner] },
          ],
        },
        rwTecfag,
      );
      expect(dry.isError).toBe(false);
      expect(dry.data.dryRun).toBe(true);
      expect(dry.data.updatedCount).toBe(2);
      expect(dry.data.createdGroups).toEqual([groupComercial, groupFagner]);

      // 5. Execução real em lote (cria grupos automaticamente e classifica ambos)
      const applied = await callMcp(
        "set_meta_template_groups",
        {
          assignments: [
            { templateName: tplA.name, groups: [groupComercial] },
            { templateName: tplB.name, groups: [groupFagner] },
          ],
        },
        rwTecfag,
      );
      expect(applied.isError).toBe(false);
      expect(applied.data.updatedCount).toBe(2);

      // 6. Renomeia categoria preservando vínculo do template B
      const renamed = await callMcp(
        "save_meta_template_group",
        { currentName: groupFagner, name: groupFagnerRenamed },
        rwTecfag,
      );
      expect(renamed.isError).toBe(false);
      expect(renamed.data.renamedFrom).toBe(groupFagner);
      expect(renamed.data.templateCount).toBe(1);
      expect(renamed.data.templates[0].name).toBe(tplB.name);

      // 7. Inclusão incremental: adiciona tplA em groupFagnerRenamed sem perder tplB
      const incAdd = await callMcp(
        "save_meta_template_group",
        { name: groupFagnerRenamed, addTemplateNames: [tplA.name] },
        rwTecfag,
      );
      expect(incAdd.isError).toBe(false);
      expect(incAdd.data.templateCount).toBe(2);

      // 8. Remoção incremental: remove tplA preservando tplB
      const incRemove = await callMcp(
        "save_meta_template_group",
        { name: groupFagnerRenamed, removeTemplateNames: [tplA.name] },
        rwTecfag,
      );
      expect(incRemove.isError).toBe(false);
      expect(incRemove.data.templateCount).toBe(1);
      expect(incRemove.data.templates[0].name).toBe(tplB.name);

      // 9. Isolamento estrito: tenant valem não enxerga nenhum grupo nem template da tecfag
      const valemGroups = await callMcp(
        "list_meta_template_groups",
        { search: suffix },
        readValem,
      );
      expect(valemGroups.isError).toBe(false);
      expect(valemGroups.data.totalGroups).toBe(0);

      // 10. Exclusão de categoria exige confirmDelete=true e desvincula preservando o template
      const deleted = await callMcp(
        "delete_meta_template_group",
        { name: groupFagnerRenamed, confirmDelete: true },
        rwTecfag,
      );
      expect(deleted.isError).toBe(false);
      expect(deleted.data.deleted).toBe(true);
      expect(deleted.data.detachedTemplateCount).toBe(1);
      expect(deleted.data.detachedTemplates).toEqual([tplB.name]);

      const afterDelete = await callMcp(
        "list_meta_templates",
        { search: tplB.name },
        readTecfag,
      );
      expect(afterDelete.isError).toBe(false);
      expect(afterDelete.data.templates).toHaveLength(1);
      expect(afterDelete.data.templates[0].customGroups).toEqual([]);

      // 11. Visibilidade por setor no PostgreSQL real (save_meta_template_group + update_meta_template_visibility)
      const secComercialId = `sec_tg_${suffix}_com`;
      const secSdrId = `sec_tg_${suffix}_sdr`;
      const secComercialName = `Comercial_${suffix}`;
      const secSdrName = `Sdr_${suffix}`;
      await db.insert(sectors).values([
        { id: secComercialId, tenantId: "tecfag", name: secComercialName, operatorIds: ["op-com-1"] },
        { id: secSdrId, tenantId: "tecfag", name: secSdrName, operatorIds: ["op-sdr-1"] },
      ]);
      try {
        const restrictedGroup = await callMcp(
          "save_meta_template_group",
          {
            name: groupComercial,
            allSectors: false,
            sectorNames: [secComercialName],
          },
          rwTecfag,
        );
        expect(restrictedGroup.isError).toBe(false);
        expect(restrictedGroup.data.group.allSectors).toBe(false);
        expect(restrictedGroup.data.group.sectorIds).toEqual([secComercialId]);

        const listedWithSectors = await callMcp(
          "list_meta_template_groups",
          { search: groupComercial },
          readTecfag,
        );
        expect(listedWithSectors.isError).toBe(false);
        const foundGrp = listedWithSectors.data.groups.find((g: any) => g.name === groupComercial);
        expect(foundGrp.allSectors).toBe(false);
        expect(foundGrp.sectorIds).toEqual([secComercialId]);
        expect(foundGrp.sectorNames).toEqual([secComercialName]);

        const restrictedTpl = await callMcp(
          "update_meta_template_visibility",
          {
            templateId: tplB.metaTemplateId,
            allPipelines: true,
            allSectors: false,
            sectorNames: [secSdrName],
          },
          rwTecfag,
        );
        expect(restrictedTpl.isError).toBe(false);
        expect(restrictedTpl.data.allSectors).toBe(false);
        expect(restrictedTpl.data.sectorIds).toEqual([secSdrId]);
      } finally {
        await db
          .delete(sectors)
          .where(inArray(sectors.id, [secComercialId, secSdrId]));
      }
    });
  });

  it("filtra templates e categorias corretamente por setor do operador (Comercial vê Comercial, SDR vê SDR, Admin vê todos)", () => {
    const now = new Date();
    const groups: MetaTemplateGroupItem[] = [
      { id: "g-com", name: "COMERCIAL", allSectors: false, sectorIds: ["sec-maq", "sec-pers"], createdAt: now },
      { id: "g-sdr", name: "SDR", allSectors: false, sectorIds: ["sec-sdr"], createdAt: now },
      { id: "g-pec", name: "PEÇAS", allSectors: false, sectorIds: ["sec-pecas"], createdAt: now },
      { id: "g-out", name: "OUTROS", allSectors: true, sectorIds: [], createdAt: now },
    ];

    const templates = [
      { name: "comercial1", customGroups: ["COMERCIAL"], allSectors: true, sectorIds: [] },
      { name: "sdr1", customGroups: ["SDR"], allSectors: true, sectorIds: [] },
      { name: "pecas1", customGroups: ["PEÇAS"], allSectors: true, sectorIds: [] },
      { name: "outros1", customGroups: ["OUTROS"], allSectors: true, sectorIds: [] },
      { name: "exclusivo_pecas", customGroups: ["OUTROS"], allSectors: false, sectorIds: ["sec-pecas"] },
      { name: "sem_grupo", customGroups: [], allSectors: true, sectorIds: [] },
    ];

    // Vendedor Comercial (Máquinas) vê COMERCIAL + globais (OUTROS, sem_grupo) — NÃO vê SDR nem PEÇAS nem exclusivo_pecas
    const comVisible = filterMetaTemplatesForSector(templates, groups, ["sec-maq"], false);
    expect(comVisible.map((t) => t.name)).toEqual(["comercial1", "outros1", "sem_grupo"]);

    // Operador SDR vê SDR + globais
    const sdrVisible = filterMetaTemplatesForSector(templates, groups, ["sec-sdr"], false);
    expect(sdrVisible.map((t) => t.name)).toEqual(["sdr1", "outros1", "sem_grupo"]);

    // Operador de Peças vê PEÇAS + exclusivo_pecas (override individual) + globais
    const pecasVisible = filterMetaTemplatesForSector(templates, groups, ["sec-pecas"], false);
    expect(pecasVisible.map((t) => t.name)).toEqual(["pecas1", "outros1", "exclusivo_pecas", "sem_grupo"]);

    // Operador em 2 setores vê a união
    const dualVisible = filterMetaTemplatesForSector(templates, groups, ["sec-sdr", "sec-pers"], false);
    expect(dualVisible.map((t) => t.name)).toEqual(["comercial1", "sdr1", "outros1", "sem_grupo"]);

    // Operador sem setor vê apenas globais
    const noSectorVisible = filterMetaTemplatesForSector(templates, groups, [], false);
    expect(noSectorVisible.map((t) => t.name)).toEqual(["outros1", "sem_grupo"]);

    // Admin sempre vê todos
    const adminVisible = filterMetaTemplatesForSector(templates, groups, [], true);
    expect(adminVisible).toHaveLength(templates.length);

    // Visibilidade das pílulas de categoria
    expect(isMetaTemplateGroupVisibleForSector(groups[0], ["sec-maq"], false)).toBe(true);
    expect(isMetaTemplateGroupVisibleForSector(groups[0], ["sec-sdr"], false)).toBe(false);
    expect(isMetaTemplateGroupVisibleForSector(groups[1], ["sec-sdr"], false)).toBe(true);
    expect(isMetaTemplateGroupVisibleForSector(groups[3], [], false)).toBe(true);
    expect(isMetaTemplateGroupVisibleForSector(groups[0], [], true)).toBe(true);
  });

  it("respeita o Design System em SectorScopeSelector.tsx (sem <select> nativo nem title= nativo)", () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/chat/SectorScopeSelector.tsx"),
      "utf-8",
    );
    expect(src).toContain("Popover");
    expect(src).toContain("SystemTooltip");
    expect(src).toContain("Checkbox");
    expect(src).not.toMatch(/<select[\s>]/);
    expect(src).not.toMatch(/\btitle=/);
  });
});
