import { describe, expect, it } from "bun:test";
import {
  exportIndustrialCatalogCsv,
  parseIndustrialCatalogCsv,
} from "../src/lib/triage/industrial-catalog-csv";
import { TECFAG_DEFAULT_CATALOG } from "../src/lib/triage/tecfag-default-catalog";
import { findCatalogConflicts, type IndustrialSettings } from "../src/lib/triage/industrial-settings";
import {
  prepareMachineDecision,
  resolveEffectiveCatalogLine,
} from "../src/lib/triage/industrial-decisor";

describe("Onda 2 — Saneamento do catálogo Tecfag & Importação/Exportação CSV na aba Fluxos", () => {
  describe("1. Catálogo oficial saneado (Decisões 1, 2 e 3)", () => {
    const byCode = new Map(TECFAG_DEFAULT_CATALOG.map((m) => [m.code.toUpperCase(), m]));

    it("mantém 1.037 registros sem conflitos de SKU ou código ativo", () => {
      expect(TECFAG_DEFAULT_CATALOG.length).toBe(1037);
      expect(findCatalogConflicts(TECFAG_DEFAULT_CATALOG)).toEqual([]);
      const activeSemi = TECFAG_DEFAULT_CATALOG.filter(
        (m) => m.active && m.line === "SEMI-INDUSTRIAL",
      ).length;
      const activePers = TECFAG_DEFAULT_CATALOG.filter(
        (m) => m.active && m.line === "PERSONNALITE",
      ).length;
      const inactive = TECFAG_DEFAULT_CATALOG.filter((m) => !m.active).length;
      expect(activeSemi).toBe(398);
      expect(activePers).toBe(622);
      expect(inactive).toBe(17);
    });

    it("Decisão 1: Seladora em L Manual, FQS450, ALB512, SB1000F e Esteiras simples estão em SEMI-INDUSTRIAL", () => {
      for (const code of [
        "PAMQSLAU078",
        "PAMQSLTU068",
        "PAMQSLTU069",
        "PAMQSLTU070",
        "PAMQSLTU072",
        "PAMQSLTU073",
        "PAMQSLSA103",
        "PAMQIPMN107",
        "PAMQGPAU018",
        "PAMQESMN003",
        "PAMQESMA003",
        "PAMQESAU004",
        "PAMQESMN012",
        "PAMQESMN020",
        "PAMQESMN016",
      ]) {
        const machine = byCode.get(code);
        expect(machine).toBeDefined();
        expect(machine?.line).toBe("SEMI-INDUSTRIAL");
        expect(machine?.active).toBe(true);
      }
    });

    it("Decisão 2: SBV450A (Seladora de Bandejas Contínua) e Seladoras em L Automáticas (BSF-5545LE / BSF-5640LG) permanecem em PERSONNALITE", () => {
      for (const code of ["PAMQVCMS032", "PAMQSLAU041", "PAMQSLAU047", "PAMQSLAU048"]) {
        const machine = byCode.get(code);
        expect(machine).toBeDefined();
        expect(machine?.line).toBe("PERSONNALITE");
        expect(machine?.active).toBe(true);
      }
      // Descrição colada errada da BSF-501 Manual foi limpa da PAMQSLAU048 (automática)
      expect(byCode.get("PAMQSLAU048")?.description).toBe("");
    });

    it("Decisão 3: Acessórios e insumos puros estão inativos (active: false) e não competem no Decisor", () => {
      for (const code of [
        "PAMQGPAU094",
        "PAMQPDTU026",
        "PAMQGPAU100",
        "PAMQPDTU006",
        "PAMQPDTU012",
        "PAMQPDTU018",
        "PAMQGPAU097",
        "PAMQGPAU045",
        "PAMQGPAU210",
      ]) {
        const item = byCode.get(code);
        expect(item).toBeDefined();
        expect(item?.active).toBe(false);
      }
    });

    it("Enriquecimento da planilha oficial preencheu produtividades e descrições novas e limpou textos corrompidos", () => {
      expect(byCode.get("PAMQIPMN135")?.production).toBe("40 a 100 frascos/min");
      expect(byCode.get("PAMQIPMN135")?.description).toContain("ADC 400");
      expect(byCode.get("PAMQGPAU173")?.production).toBe("50 a 500 embalagens por minuto");
      expect(byCode.get("PAACSLAU347")?.production).toBe(""); // GENIUS32 não diz mais Manual
      expect(byCode.get("PAMQSLTU035")?.description).toBe(""); // Túnel não diz mais BSF-501 Manual
      expect(byCode.get("PAMQLQAU088")?.description).toBe(""); // MULTI FILLING não diz mais Encartuchadeira
    });

    it("resolveEffectiveCatalogLine preserva famílias Personnalité especializadas (VSF Pós, Goma, Encapsuladora)", () => {
      const vsf = byCode.get("PAMQGPAU177")!;
      const goma = byCode.get("PAMQPDTU014")!;
      const encaps = byCode.get("PAMQSLSA016")!;
      expect(resolveEffectiveCatalogLine(vsf).line).toBe("PERSONNALITE");
      expect(resolveEffectiveCatalogLine(goma).line).toBe("PERSONNALITE");
      expect(resolveEffectiveCatalogLine(encaps).line).toBe("PERSONNALITE");
    });

    it("Decisor confirma SEMI-INDUSTRIAL para 'esteira transportadora de lona com 1,50m' e filtra estritamente esteiras em busca genérica", () => {
      const settings: IndustrialSettings = {
        version: 1,
        catalog: TECFAG_DEFAULT_CATALOG,
        blockedFamilies: [],
        destinations: {},
      };
      // Caso Jeferson: nome exato "Esteira Transportadora" (PAMQESMN0014) agora é SEMI-INDUSTRIAL
      const jeferson = prepareMachineDecision(settings, 2, {
        interest: "Esteira transportadora de lona com 1,50m",
        application: "Transporte de embalagens",
        production: "200 unidades por dia",
        customerContext: "você tem esteira transportadora de lona com 1,50m comprimento?",
      });
      expect(jeferson.decision?.status).toBe("confirmed");
      expect(jeferson.decision?.line).toBe("SEMI-INDUSTRIAL");

      // Busca genérica sem nome exato filtra estritamente a categoria "esteira"
      const generic = prepareMachineDecision(settings, 2, {
        interest: "Esteira de lona com 1,50m",
        application: "Transporte de embalagens",
        production: "200 unidades por dia",
        customerContext: "preciso de uma esteira de lona com 1,50m",
      });
      expect(generic.decision).toBeNull();
      expect(generic.candidates.length).toBeGreaterThan(0);
      expect(generic.candidates.length).toBeLessThanOrEqual(45);
      expect(
        generic.candidates.some((m) => m.code === "PAMQESMN012" && m.line === "SEMI-INDUSTRIAL"),
      ).toBe(true);
      expect(
        generic.candidates.every((m) => /esteira|roletes/i.test(`${m.name} ${m.description}`)),
      ).toBe(true);
    });
  });

  describe("2. Importador e Exportador CSV compatível com a planilha oficial Tecfag", () => {
    it("importa CSV vírgula (Google Sheets) com descrição multilinha e preserva id/aliases existentes por CÓD. NEXT", () => {
      const csv = [
        "LINHA,NOME,CÓD. NEXT,SKU,PRODUTIVIDADE,FAMÍLIA,DESCRIÇÃO / SOBRE,LINK,STATUS",
        'Semi,Seladora em L Manual,PAMQSLAU078,999,"8-12\npcs/min",Seladoras,"Linha 1\nLinha 2 com ""aspas""",Semi pág. 128,Ativo',
        "Personalite,ASSADEIRA DE BISCOITO,PAMQGPAU094,,insumo,,Insumo,,Inativo",
        "Personalite,NOVA MAQUINA INDUSTRIAL X1,PAMQNEW001,2001,100 un/min,Empacotadoras,Descrição nova,,Ativo",
      ].join("\r\n");

      const result = parseIndustrialCatalogCsv(csv, [
        {
          id: "catalog-532",
          name: "Seladora em L Manual",
          sku: "",
          code: "PAMQSLAU078",
          line: "PERSONNALITE",
          production: "",
          description: "",
          aliases: ["BSF-501"],
          active: true,
        },
      ]);

      expect(result.totalRows).toBe(3);
      expect(result.updatedCount).toBe(1);
      expect(result.createdCount).toBe(2);
      expect(result.semiCount).toBe(1);
      expect(result.personnaliteCount).toBe(2);
      expect(result.inactiveCount).toBe(1);

      const bsf = result.catalog[0];
      expect(bsf.id).toBe("catalog-532");
      expect(bsf.line).toBe("SEMI-INDUSTRIAL");
      expect(bsf.production).toBe("8-12 pcs/min");
      expect(bsf.description).toBe('Linha 1\nLinha 2 com "aspas"');
      expect(bsf.aliases).toEqual(["BSF-501"]);

      expect(result.catalog[1].active).toBe(false);
      expect(result.catalog[2].code).toBe("PAMQNEW001");
    });

    it("detecta automaticamente CSV com ponto-e-vírgula (Excel PT-BR) e BOM UTF-8", () => {
      const csvPtBr =
        "\uFEFFLINHA;NOME;CÓD. NEXT;SKU;PRODUTIVIDADE;STATUS\r\n" +
        "Semi;Seladora de Pedal 40cm;PAMQSLPE002;475;Manual;Ativo\r\n" +
        "Personnalité;Flow Pack Industrial;PAMQFPAU032;195;40-230/min;Ativo\r\n";

      const result = parseIndustrialCatalogCsv(csvPtBr);
      expect(result.totalRows).toBe(2);
      expect(result.catalog[0].line).toBe("SEMI-INDUSTRIAL");
      expect(result.catalog[1].line).toBe("PERSONNALITE");
    });

    it("exporta em CSV UTF-8 com BOM e reimporta preservando 100% dos equipamentos e status", () => {
      const sample = TECFAG_DEFAULT_CATALOG.slice(0, 25);
      const exported = exportIndustrialCatalogCsv(sample);
      expect(exported.startsWith("\uFEFFLINHA,NOME,CÓD. NEXT,SKU,PRODUTIVIDADE,FAMÍLIA")).toBe(true);

      const reimported = parseIndustrialCatalogCsv(exported, sample);
      expect(reimported.totalRows).toBe(sample.length);
      for (let i = 0; i < sample.length; i++) {
        expect(reimported.catalog[i].id).toBe(sample[i].id);
        expect(reimported.catalog[i].code).toBe(sample[i].code);
        expect(reimported.catalog[i].line).toBe(sample[i].line);
        expect(reimported.catalog[i].active).toBe(sample[i].active);
      }
    });

    it("rejeita CSV sem colunas obrigatórias ou linha com LINHA inválida", () => {
      expect(() => parseIndustrialCatalogCsv("CODIGO,PRODUTO\n1,Teste")).toThrow(/Cabeçalho CSV/);
      expect(() =>
        parseIndustrialCatalogCsv("LINHA,NOME\nDesconhecida,Seladora X"),
      ).toThrow(/coluna LINHA inválida/);
    });
  });
});
