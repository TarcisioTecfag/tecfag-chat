import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import {
  buildCurlSnippet,
  buildEnvSnippet,
  buildNodeSnippet,
  buildPythonSnippet,
  getApiLibraryCatalog,
  maskApiToken,
} from "../src/lib/marketing/api-library-catalog";
import {
  buildCompleteApiLibraryMarkdown,
  buildCompleteApiLibraryPdf,
  buildUnifiedLibraryInventory,
} from "../src/lib/marketing/api-library-docs-export";
import { MCP_TOOLS } from "../src/lib/mcp/valem-tecfag-mcp-core";
import { parseAppRoute } from "../src/lib/app-routes";

describe("Biblioteca de API (Developer Portal em Configurações /ajustes/api)", () => {
  it("isola estritamente persona e exemplos entre tecfag (Fagner) e valem (Valentina) sem duplicatas", () => {
    const tecfagCatalog = getApiLibraryCatalog("tecfag");
    const valemCatalog = getApiLibraryCatalog("valem");

    const tfTriages = tecfagCatalog.find((e) => e.id === "rest-triages")!;
    const vlTriages = valemCatalog.find((e) => e.id === "rest-triages")!;

    expect(tfTriages.title).toContain("Fagner");
    expect(tfTriages.title).not.toContain("Valentina");

    expect(vlTriages.title).toContain("Valentina");
    expect(vlTriages.title).not.toContain("Fagner");

    // Zero IDs duplicados no catálogo
    const uniqueIds = new Set(tecfagCatalog.map((e) => e.id));
    expect(uniqueIds.size).toBe(tecfagCatalog.length);

    // 3 grupos cobertos no catálogo UI: REST (10), MCP (19), Webhooks (5)
    expect(tecfagCatalog.filter((e) => e.kind === "rest")).toHaveLength(10);
    expect(tecfagCatalog.filter((e) => e.kind === "mcp").length).toBeGreaterThanOrEqual(11);
    expect(tecfagCatalog.filter((e) => e.kind === "webhook")).toHaveLength(5);

    // Inventário unificado de exportação cobre 100% de MCP_TOOLS do servidor (/api/mcp)
    const unified = buildUnifiedLibraryInventory("tecfag");
    expect(unified.mcpEntries.length).toBeGreaterThanOrEqual(MCP_TOOLS.length);

    // Webhooks não expõem disparo destrutivo no playground, rotas de leitura sim
    for (const wh of tecfagCatalog.filter((e) => e.kind === "webhook")) {
      expect(wh.supportsLivePlayground).toBe(false);
      expect(wh.sampleRequestPayload).toBeTruthy();
    }
    for (const rest of tecfagCatalog.filter((e) => e.kind === "rest")) {
      expect(rest.supportsLivePlayground).toBe(true);
    }
  });

  it("gera PDF binário real e Markdown completo com TODAS as APIs REST, ferramentas MCP e Webhooks", async () => {
    const baseUrl = "https://tecfagchat.up.railway.app";

    // Markdown completo (tecfag)
    const mdTecfag = buildCompleteApiLibraryMarkdown({ tenantId: "tecfag", baseUrl });
    expect(mdTecfag).toContain("Fagner");
    expect(mdTecfag).not.toContain("Valentina");
    expect(mdTecfag).toContain("/api/v1/marketing/deals");
    expect(mdTecfag).toContain("/api/v1/marketing/deal-stage-history");
    expect(mdTecfag).toContain("/api/v1/marketing/audit-batch");
    expect(mdTecfag).toContain("/api/mcp");
    expect(mdTecfag).toContain("/api/webhooks/rd-marketing/:token");
    expect(mdTecfag).toContain("/api/webhooks/rd-marketing/journey/:token");
    expect(mdTecfag).toContain("/api/webhooks/meta");
    expect(mdTecfag).toContain("/ws/livechat");
    expect(mdTecfag).toContain("/api/settings/webhooks");

    // Todas as ferramentas vivas do servidor /api/mcp devem constar no inventário e no Markdown
    const inv = buildUnifiedLibraryInventory("tecfag");
    expect(inv.liveMcpCount).toBe(MCP_TOOLS.length);
    for (const tool of MCP_TOOLS) {
      expect(mdTecfag).toContain(tool.name);
    }

    // PDF binário real para Tecfag e Valem
    const pdfTecfag = await buildCompleteApiLibraryPdf({ tenantId: "tecfag", baseUrl });
    const headerTecfag = Buffer.from(pdfTecfag.slice(0, 5)).toString("ascii");
    expect(headerTecfag).toBe("%PDF-");

    const parsedTecfag = await PDFDocument.load(pdfTecfag);
    expect(parsedTecfag.getPageCount()).toBeGreaterThanOrEqual(10);
    expect(parsedTecfag.getTitle()).toContain("Tecfag");
    expect(parsedTecfag.getTitle()).toContain("Fagner");

    const pdfValem = await buildCompleteApiLibraryPdf({ tenantId: "valem", baseUrl });
    const parsedValem = await PDFDocument.load(pdfValem);
    expect(parsedValem.getPageCount()).toBeGreaterThanOrEqual(10);
    expect(parsedValem.getTitle()).toContain("Valem");
    expect(parsedValem.getTitle()).toContain("Valentina");
  }, 15000);

  it("gera snippets prontos em Python (.env e direto), cURL, Node.js e mascara tokens por padrão", () => {
    const token = "mcp_tf_8f4e2a9c1d7b6e3f5a0c2d4e8b1f7a3c";
    const masked = maskApiToken(token);
    expect(masked).toContain("mcp_tf_8f4");
    expect(masked).toContain("7a3c");
    expect(masked).not.toBe(token);

    const dealsEntry = getApiLibraryCatalog("tecfag").find((e) => e.id === "rest-deals")!;
    const pyEnv = buildPythonSnippet({
      entry: dealsEntry,
      tenantId: "tecfag",
      baseUrl: "https://tecfagchat.up.railway.app",
      token,
      useEnvVars: true,
    });
    expect(pyEnv).toContain('os.environ["TECFAG_CRM_API_TOKEN"]');
    expect(pyEnv).toContain("puxar_todas_paginas");
    expect(pyEnv).toContain("/api/v1/marketing/deals");

    const curl = buildCurlSnippet({
      entry: dealsEntry,
      baseUrl: "https://tecfagchat.up.railway.app",
      token: masked,
      queryString: "limit=5&win=true",
    });
    expect(curl).toContain("https://tecfagchat.up.railway.app/api/v1/marketing/deals?limit=5&win=true");
    expect(curl).toContain(`Authorization: Bearer ${masked}`);

    const node = buildNodeSnippet({
      entry: dealsEntry,
      tenantId: "tecfag",
      baseUrl: "https://tecfagchat.up.railway.app",
      token: masked,
    });
    expect(node).toContain("process.env.TECFAG_CRM_API_TOKEN");

    const envFile = buildEnvSnippet({
      tenantId: "valem",
      baseUrl: "https://tecfagchat.up.railway.app/",
      token,
    });
    expect(envFile).toContain("VALEM_CRM_API_URL=https://tecfagchat.up.railway.app");
    expect(envFile).toContain(`VALEM_CRM_API_TOKEN=${token}`);
  });

  it("resolve rotas amigáveis /ajustes/api e /ajustes/biblioteca-api e respeita 100% o Design System", () => {
    expect(parseAppRoute("/ajustes/api")).toMatchObject({
      viewId: "settings",
      tabId: "api",
    });
    expect(parseAppRoute("/ajustes/biblioteca-api")).toMatchObject({
      viewId: "settings",
      tabId: "api",
    });

    const uiCode = fs.readFileSync("src/components/chat/ApiLibrarySettingsTab.tsx", "utf8");
    // Proibição absoluta de controles nativos (AGENTS.md)
    expect(uiCode).not.toMatch(/\btitle\s*=\s*["'{]/);
    expect(uiCode).not.toMatch(/<select[\s>]/i);
    expect(uiCode).not.toMatch(/type\s*=\s*["'](date|time|datetime-local)["']/i);
    expect(uiCode).toContain("SystemTooltip");
    expect(uiCode).toContain("Popover");
  });
});
