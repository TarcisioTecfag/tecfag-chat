import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import defaultTecfagCatalog from "../src/lib/triage/tecfag-default-catalog.json";
import {
  buildSiteCatalogMediaUrl,
  isValidSiteMediaTenantId,
  parseCatalogMediaFileParam,
} from "../src/lib/livechat/site-media-url";
import {
  expandInternalCatalogCodesInText,
  searchIndustrialCatalogEntries,
} from "../src/lib/valentina/knowledge-service";
import {
  buildTecfagFagnerPrompt,
  evaluateIndustrialMachineSuggestionGate,
  hasExplicitMachineModelCode,
} from "../src/lib/valentina/sdr-tecfag-prompt";
import { getAiPersona } from "../src/lib/ai-persona";

describe("Fagner Site — Fotos quebradas, Fotos Proativas, Catálogo Pratic Seal e Coleta Completa", () => {
  describe("1. Rota pública de mídia do catálogo para o widget do site", () => {
    it("converte /knowledge-media/kf-*.png para /api/livechat/catalog-media com tenantId e bloqueia path traversal", () => {
      const converted = buildSiteCatalogMediaUrl("tecfag", "/knowledge-media/kf-1791988358053-6veo3.png");
      expect(converted).toBe("/api/livechat/catalog-media?tenantId=tecfag&file=kf-1791988358053-6veo3.png");
      // Idempotente
      expect(buildSiteCatalogMediaUrl("tecfag", converted)).toBe(converted);
      // URLs externas intactas
      expect(buildSiteCatalogMediaUrl("tecfag", "https://cdn.example.com/foto.png")).toBe(
        "https://cdn.example.com/foto.png",
      );

      expect(parseCatalogMediaFileParam("kf-1791988358053-6veo3.png")).toEqual({
        fileId: "kf-1791988358053-6veo3",
        ext: "png",
      });
      // Rejeita path traversal e extensões não-imagem (PDF/env/etc.)
      expect(parseCatalogMediaFileParam("../secret.png")).toBeNull();
      expect(parseCatalogMediaFileParam("kf-1791988358053-6veo3.pdf")).toBeNull();
      expect(parseCatalogMediaFileParam("manual.pdf")).toBeNull();
      expect(isValidSiteMediaTenantId("tecfag")).toBe(true);
      expect(isValidSiteMediaTenantId("../other")).toBe(false);
    });

    it("rota /api/livechat/catalog-media exige isolamento multi-tenant, format='real', apenas imagens e Cross-Origin-Resource-Policy", () => {
      const routeSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/routes/api/livechat/catalog-media.ts"),
        "utf8",
      );
      expect(routeSrc).toContain('eq(knowledgeFiles.tenantId, tenantId)');
      expect(routeSrc).toContain('eq(knowledgeFiles.format, "real")');
      expect(routeSrc).toContain("SITE_CATALOG_IMAGE_MIME_MAP");
      expect(routeSrc).toContain('"Cross-Origin-Resource-Policy": "cross-origin"');

      const bubbleSrc = fs.readFileSync(
        path.resolve(process.cwd(), "tecfag-widget/src/components/ChatWidget/ChatBubble.tsx"),
        "utf8",
      );
      expect(bubbleSrc).toContain("/api/livechat/catalog-media?tenantId=");
      expect(bubbleSrc).toContain("Foto do equipamento");
    });
  });

  describe("2. Busca do catálogo oficial para Pratic Seal (caso real Tarcisio Turno 2)", () => {
    it("expande 'pratic seal' em códigos internos PAMQSLAU088/PAMQSLAU089 e TC-20", () => {
      const expanded = expandInternalCatalogCodesInText("preciso comprar uma pratic seal");
      expect(expanded).toContain("PAMQSLAU088");
      expect(expanded).toContain("TC-20");
    });

    it("NUNCA expulsa a Pratic Seal do Top 10 mesmo com 'doces', 'embalagens', '20x20' e 'plastico' (inclusive com aliases: [] legado do banco)", () => {
      // Simula o catálogo salvo em produção no PostgreSQL onde aliases ainda está vazio []
      const legacyDbCatalog = (defaultTecfagCatalog as any[]).map((entry) => ({
        ...entry,
        aliases: [],
      }));

      const turn2Query =
        "preciso selar doces em embalagens de 20x20 de plastico\nBom dia fagner preciso comprar uma pratic seal pode me ajudar nao sei se atende";

      const resultFull = searchIndustrialCatalogEntries(turn2Query, legacyDbCatalog, [], 10, {
        suppressModelListingUntilQualified: false,
      });
      expect(resultFull).toContain("PAMQSLAU088");
      expect(resultFull).toContain("Pratic Seal");
      expect(resultFull).toContain("TC-20");

      // No modo onlyExplicitMatchedModels (enquanto falta volume/empresa na coleta), exibe SOMENTE a Pratic Seal
      // sem despejar outras 9 seladoras para o Fagner sair oferecendo!
      const resultExplicitOnly = searchIndustrialCatalogEntries(turn2Query, legacyDbCatalog, [], 10, {
        suppressModelListingUntilQualified: false,
        onlyExplicitMatchedModels: true,
      });
      expect(resultExplicitOnly).toContain("MODELO ESPECÍFICO CITADO LOCALIZADO NO CATÁLOGO OFICIAL");
      expect(resultExplicitOnly).toContain("Pratic Seal");
      expect(resultExplicitOnly).toContain("PAMQSLAU088");
      // Não pode listar modelos não solicitados como DZ400 ou FR900
      expect(resultExplicitOnly).not.toContain("DZ400");
    });
  });

  describe("3. Trava de coleta completa e zero falsos positivos em códigos de máquina", () => {
    it("não confunde frases comuns com medidas/quantidades ('sacos 20', 'potes 500', 'de 20x20', 'quero 100') com código de modelo", () => {
      expect(hasExplicitMachineModelCode("preciso selar doces em embalagens de 20x20 de plastico")).toBe(false);
      expect(hasExplicitMachineModelCode("seriam 20x por hora")).toBe(false);
      expect(hasExplicitMachineModelCode("sacos 20 kg")).toBe(false);
      expect(hasExplicitMachineModelCode("potes 500 ml")).toBe(false);
      expect(hasExplicitMachineModelCode("quero 100 unidades por dia")).toBe(false);
      expect(hasExplicitMachineModelCode("cerca 50 pacotes")).toBe(false);
      expect(hasExplicitMachineModelCode("nr-12 obrigatoria")).toBe(false);

      // Modelos reais continuam sendo detectados
      expect(hasExplicitMachineModelCode("preciso de uma pratic seal")).toBe(true);
      expect(hasExplicitMachineModelCode("qual o preco da TC-20?")).toBe(true);
      expect(hasExplicitMachineModelCode("quero saber sobre a DZ400")).toBe(true);
      expect(hasExplicitMachineModelCode("gostaria da VSF-30S")).toBe(true);
      expect(hasExplicitMachineModelCode("BL2000A")).toBe(true);
      expect(hasExplicitMachineModelCode("PAMQSLAU088")).toBe(true);
    });

    it("no Turno 2 da Pratic Seal (sem volume ainda), exige coleta completa sem negar a existência da Pratic Seal nem oferecer outras máquinas", () => {
      const gate = evaluateIndustrialMachineSuggestionGate({
        currentDataSummary: {
          "NOME COMPLETO": "Tarcisio",
          "EMPRESA": "Tarcisio Silva",
          "MÁQUINA / PEÇA / INTERESSE": "Seladora Portátil Pratic Seal",
          "RAMO / O QUE EMBALA": "Doces em embalagens plásticas de 20x20cm",
        },
        batchSummary: "preciso selar doces em embalagens de 20x20 de plastico",
      });
      expect(gate.mode).toBe("client_asked_specific_model");
      expect(gate.onlyExplicitMatchedModels).toBe(true);
      expect(gate.isFullCollectionComplete).toBe(false);
      expect(gate.directive).toContain("NUNCA diga que o modelo não foi localizado ou não existe no catálogo");
      expect(gate.directive).toContain("PROIBIDO oferecer, recomendar ou citar OUTROS modelos");

      const prompt = buildTecfagFagnerPrompt({
        aiPersona: getAiPersona("tecfag"),
        knowledgeContext: "",
        conversationHistoryText: "",
        batchSummary: "preciso selar doces em embalagens de 20x20 de plastico",
        currentDataSummary: {
          "NOME COMPLETO": "Tarcisio",
          "EMPRESA": "Tarcisio Silva",
          "MÁQUINA / PEÇA / INTERESSE": "Seladora Portátil Pratic Seal",
        },
        cnpjDirective: "",
        firstMessageRule: "",
        hasPreviousEmoji: false,
        hasPreviousAudio: false,
      });
      expect(prompt).toContain('NUNCA afirme ao cliente que um modelo/nome citado por ele "não existe"');
      expect(prompt).toContain("sem pedido explícito de foto, NÃO envie nenhuma imagem");
    });
  });
});
