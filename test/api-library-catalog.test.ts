import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import {
  buildCurlSnippet,
  buildEnvSnippet,
  buildNodeSnippet,
  buildPythonSnippet,
  getApiLibraryCatalog,
  maskApiToken,
} from "../src/lib/marketing/api-library-catalog";
import { parseAppRoute } from "../src/lib/app-routes";

describe("Biblioteca de API (Developer Portal em Configurações /ajustes/api)", () => {
  it("isola estritamente persona e exemplos entre tecfag (Fagner) e valem (Valentina)", () => {
    const tecfagCatalog = getApiLibraryCatalog("tecfag");
    const valemCatalog = getApiLibraryCatalog("valem");

    const tfTriages = tecfagCatalog.find((e) => e.id === "rest-triages")!;
    const vlTriages = valemCatalog.find((e) => e.id === "rest-triages")!;

    expect(tfTriages.title).toContain("Fagner");
    expect(tfTriages.title).not.toContain("Valentina");

    expect(vlTriages.title).toContain("Valentina");
    expect(vlTriages.title).not.toContain("Fagner");

    // 3 grupos cobertos: REST (10), MCP (5), Webhooks (3) = 18 itens
    expect(tecfagCatalog.filter((e) => e.kind === "rest")).toHaveLength(10);
    expect(tecfagCatalog.filter((e) => e.kind === "mcp")).toHaveLength(5);
    expect(tecfagCatalog.filter((e) => e.kind === "webhook")).toHaveLength(3);

    // Webhooks não expõem disparo destrutivo no playground, rotas de leitura sim
    for (const wh of tecfagCatalog.filter((e) => e.kind === "webhook")) {
      expect(wh.supportsLivePlayground).toBe(false);
      expect(wh.sampleRequestPayload).toBeTruthy();
    }
    for (const rest of tecfagCatalog.filter((e) => e.kind === "rest")) {
      expect(rest.supportsLivePlayground).toBe(true);
    }
  });

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
