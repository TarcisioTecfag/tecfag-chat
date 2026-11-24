import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  isPhotoGroundedInContext,
  matchBlockedFamiliesInText,
  searchIndustrialCatalogEntries,
  type BlockedFamilyEntry,
  type CatalogEntry,
} from "../src/lib/valentina/knowledge-service";
import { buildTecfagFagnerPrompt } from "../src/lib/valentina/sdr-tecfag-prompt";
import { getAiPersona } from "../src/lib/ai-persona";

const defaultCatalog: CatalogEntry[] = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/triage/tecfag-default-catalog.json"),
    "utf8",
  ),
);

describe("Fagner — Unificação do catálogo DB, anti-alucinação e trava de fotos (caso Glaucio)", () => {
  it("caso Glaucio (paintball): NÃO retorna falsos positivos por 'produção' nem SOFTECH110, e emite alerta explícito de nenhuma máquina encontrada", () => {
    const glaucioQuery =
      "Olá! Gostaria de saber mais sobre as soluções da Tecfag Personnalité. Olá Vcs vendem máquina para produção de bolinhas de Paintball? Sim Gostaria de saber essa informação";

    const section = searchIndustrialCatalogEntries(glaucioQuery, defaultCatalog, [], 10);

    expect(section).toContain("NENHUMA máquina do catálogo oficial correspondeu");
    expect(section).not.toContain("SOFTECH110");
    expect(section).not.toContain("SABONETES");
    expect(section).not.toContain("SUPOSITORIOS");
    expect(section).toContain("Semi-Industrial");
    expect(section).toContain("Personnalité");
  });

  it("respeita catálogo editado (Semi vs. Personnalité), ignora máquinas inativas e injeta famílias bloqueadas", () => {
    const customCatalog: CatalogEntry[] = [
      {
        id: "m-1",
        name: "Encapsuladora Softgel SOFTECH110 Plus",
        code: "PAMQSLSA138",
        line: "PERSONNALITE",
        production: "15.000 a 30.000 cápsulas/h",
        description: "Produção de cápsulas softgel farmacêuticas.",
        active: false, // desativada na tela Catálogo e destinos
      },
      {
        id: "m-2",
        name: "Seladora a Vácuo DZ400",
        code: "PAMQSLVC010",
        line: "SEMI-INDUSTRIAL",
        production: "2 a 4 ciclos/min",
        description: "Seladora a vácuo de câmara simples para alimentos.",
        active: true,
      },
    ];
    const blocked: BlockedFamilyEntry[] = [
      {
        id: "blk-paintball",
        name: "Máquinas de Paintball",
        terms: ["paintball", "bolinhas de paintball"],
        reason: "Não comercializamos máquinas para fabricação de bolinhas de paintball.",
      },
    ];

    // Máquina desativada não pode aparecer
    const softechResult = searchIndustrialCatalogEntries("SOFTECH110 Plus", customCatalog, blocked, 10);
    expect(softechResult).not.toContain("PAMQSLSA138");
    expect(softechResult).toContain("NENHUMA máquina do catálogo oficial correspondeu");
    expect(softechResult).toContain("FAMÍLIAS CADASTRADAS COMO NÃO COMERCIALIZADAS: Máquinas de Paintball");

    // Família bloqueada detectada explicitamente antes de gerar resposta
    const blockedMatches = matchBlockedFamiliesInText(
      "Vocês vendem máquina para produção de bolinhas de Paintball?",
      blocked,
    );
    expect(blockedMatches).toHaveLength(1);
    expect(blockedMatches[0].id).toBe("blk-paintball");

    const paintballSection = searchIndustrialCatalogEntries(
      "Vocês vendem máquina para produção de bolinhas de Paintball?",
      customCatalog,
      blocked,
      10,
    );
    expect(paintballSection).toContain("FAMÍLIA / EQUIPAMENTO NÃO COMERCIALIZADO DETECTADO NO CATÁLOGO");
    expect(paintballSection).toContain("Máquinas de Paintball");

    // Máquina ativa continua aparecendo com sua linha correta
    const dzSection = searchIndustrialCatalogEntries("Quero uma seladora a vácuo DZ400", customCatalog, blocked, 10);
    expect(dzSection).toContain("Seladora a Vácuo DZ400");
    expect(dzSection).toContain("Linha/Divisão: SEMI-INDUSTRIAL");
  });

  it("consultas reais de modelos existentes (SOFTECH110, seladora a vácuo) continuam encontrando fichas no catálogo oficial", () => {
    const softech = searchIndustrialCatalogEntries("Quero informações da encapsuladora softgel SOFTECH110", defaultCatalog, [], 10);
    expect(softech).toContain("Encapsuladora Softgel SOFTECH110 Plus");
    expect(softech).toContain("Linha/Divisão: PERSONNALITE");
    expect(softech).toContain("15.000 a 30.000 cápsulas/h");

    const vac = searchIndustrialCatalogEntries("Preciso de uma seladora a vácuo para carnes", defaultCatalog, [], 10);
    expect(vac).toContain("EQUIPAMENTOS ENCONTRADOS NO CATÁLOGO OFICIAL");
    expect(vac.toLowerCase()).toContain("seladora");
  });

  it("trava de foto proativa (isPhotoGroundedInContext): bloqueia SOFTECH110 ausente das evidências e libera quando consta no catálogo/manual", () => {
    const softechPhoto = {
      displayName: "Encapsuladora Softgel SOFTECH110",
      sku: "SOFTECH110",
      compactModel: "softech110",
      internalCode: "PAMQSLSA138",
      aliasKeys: ["softech110", "pamqslsa138"],
      mediaUrl: "/knowledge-media/kf-1791988388935-6uems.png",
    };

    const ungroundedContext = `
📚 BASE DE CONHECIMENTO & DIRETRIZES (Grupo Tecfag):

⚠️ CATÁLOGO OFICIAL (1037 máquinas ativas — 367 Semi-Industrial, 670 Personnalité): NENHUMA máquina do catálogo oficial correspondeu aos termos específicos desta consulta (bolinhas, paintball).

📸 FOTOS REAIS DISPONÍVEIS PARA ENVIO (Formato Real — exibindo 1 de 431 itens):
  - "Encapsuladora Softgel SOFTECH110.png" [Modelo: SOFTECH110] → URL: /knowledge-media/kf-1791988388935-6uems.png
`;
    expect(isPhotoGroundedInContext(softechPhoto, ungroundedContext)).toBe(false);

    const groundedContext = `
📚 BASE DE CONHECIMENTO & DIRETRIZES (Grupo Tecfag):

🏭 EQUIPAMENTOS ENCONTRADOS NO CATÁLOGO OFICIAL (1 referência(s) direta(s)):
• Modelo/Equipamento: "Encapsuladora Softgel SOFTECH110 Plus" | Código Interno no Sistema: PAMQSLSA138 | Linha/Divisão: PERSONNALITE
`;
    expect(isPhotoGroundedInContext(softechPhoto, groundedContext)).toBe(true);
  });

  it("prompt do Fagner exige leitura obrigatória da base e proíbe afirmar compatibilidade ou inventar modelo fora do contexto", () => {
    const prompt = buildTecfagFagnerPrompt({
      aiPersona: getAiPersona("tecfag"),
      knowledgeContext: "⚠️ CATÁLOGO OFICIAL: NENHUMA máquina encontrada.",
      conversationHistoryText: "",
      batchSummary: "Vocês vendem máquina para produção de bolinhas de Paintball?",
      currentDataSummary: {},
      cnpjDirective: "",
      firstMessageRule: "",
      hasPreviousEmoji: false,
      hasPreviousAudio: false,
    });

    expect(prompt).toContain("CONSULTA OBRIGATÓRIA À BASE DE CONHECIMENTO ANTES DE RESPONDER");
    expect(prompt).toContain("PROIBIÇÃO ABSOLUTA DE CITAR MODELO DA MEMÓRIA OU DEDUZIR COMPATIBILIDADE");
    expect(prompt).toContain("bolinhas de paintball");
    expect(prompt).toContain("FAMÍLIA / EQUIPAMENTO NÃO COMERCIALIZADO DETECTADO");
    expect(prompt).toContain("Seladora a Vácuo");
  });

  it("integração: salvar catálogo invalida cache de conhecimento e sdr-engine aplica guarda de contexto nas fotos", () => {
    const settingsRouteSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/routes/api/valentina/industrial-settings.ts"),
      "utf8",
    );
    const decisorRuntimeSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/triage/industrial-decisor-runtime.ts"),
      "utf8",
    );
    const sdrEngineSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/valentina/sdr-engine.ts"),
      "utf8",
    );

    expect(settingsRouteSrc).toContain("invalidateKnowledgeCache(tenantId)");
    expect(decisorRuntimeSrc).toContain("invalidateKnowledgeCache(tenantId)");
    expect(sdrEngineSrc).toContain("allowedContextText: industrialTriage ? knowledgeContext : undefined");
    expect(sdrEngineSrc).toContain("if (!industrialPhotoAllowed) return false;");
  });
});
