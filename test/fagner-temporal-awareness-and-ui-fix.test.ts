import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { getAiPersona } from "../src/lib/ai-persona";
import {
  buildTecfagFagnerPrompt,
  formatSdrDateTimeBrt,
  formatSdrMessageTimestampTag,
  formatSdrRelativeAgePt,
} from "../src/lib/valentina/sdr-tecfag-prompt";

describe("Fagner — Noção Temporal de Histórico, Regra Anti-URA e Fix de 1ª Linha em SdrTab", () => {
  it("formata data/hora em Brasília (UTC-3) e idade relativa em todos os horizontes de tempo", () => {
    const now = new Date("2026-11-22T20:20:00.000Z"); // 22/11/2026 17:20 BRT

    expect(formatSdrDateTimeBrt(now)).toBe("22/11/2026 17:20 BRT");
    expect(formatSdrRelativeAgePt(new Date("2026-11-22T20:19:40.000Z"), now)).toBe("agora");
    expect(formatSdrRelativeAgePt(new Date("2026-11-22T19:45:00.000Z"), now)).toBe("há 35 min");
    expect(formatSdrRelativeAgePt(new Date("2026-11-22T16:00:00.000Z"), now)).toBe("há 4h");
    expect(formatSdrRelativeAgePt(new Date("2026-11-21T18:00:00.000Z"), now)).toBe("há 1 dia");
    expect(formatSdrRelativeAgePt(new Date("2026-11-20T17:47:00.000Z"), now)).toBe("há 2 dias");
    expect(formatSdrRelativeAgePt(new Date("2026-11-08T13:00:00.000Z"), now)).toBe("há 2 semanas");
    expect(formatSdrRelativeAgePt(new Date("2026-06-15T12:30:00.000Z"), now)).toBe("há 5 meses");
    expect(formatSdrRelativeAgePt(new Date("2025-11-22T15:00:00.000Z"), now)).toBe("há 1 ano");
    expect(formatSdrRelativeAgePt(new Date("2025-09-10T15:00:00.000Z"), now)).toBe(
      "há 1 ano e 2 meses",
    );

    expect(
      formatSdrMessageTimestampTag(new Date("2026-11-20T17:47:00.000Z"), now),
    ).toBe("20/11/2026 14:47 BRT · há 2 dias");
  });

  it("injeta DATA E HORA ATUAL, histórico anterior datado, regra de noção temporal e proibição de menu URA no prompt do Fagner", () => {
    const prompt = buildTecfagFagnerPrompt({
      aiPersona: getAiPersona("tecfag"),
      knowledgeContext: "",
      currentDateTimeBrt: "22/11/2026 17:20 BRT",
      priorConversationHistoryText:
        "[10/11/2025 10:00 BRT · há 1 ano] [Cliente]: Quero uma seladora de pedal",
      conversationHistoryText:
        "[22/11/2026 17:19 BRT · há 1 min] [ID MENSAGEM: m1] [Cliente]: Boa tarde",
      batchSummary: '[ID MENSAGEM: m1] Cliente: "Boa tarde"',
      currentDataSummary: {},
      cnpjDirective: "",
      firstMessageRule: "Primeira mensagem",
      hasPreviousEmoji: false,
      hasPreviousAudio: false,
    });

    expect(prompt).toContain("DATA E HORA ATUAL: 22/11/2026 17:20 BRT");
    expect(prompt).toContain("HISTÓRICO ANTERIOR A ESTE ATENDIMENTO");
    expect(prompt).toContain("[10/11/2025 10:00 BRT · há 1 ano]");
    expect(prompt).toContain("REGRA DE NOÇÃO TEMPORAL E CONTEXTO HISTÓRICO");
    expect(prompt).toContain("mais de 30 dias, meses ou anos atrás");
    expect(prompt).toContain("PROIBIÇÃO DE MENU NUMERADO ESTILO URA/ROBÔ");
  });

  it("garante que SdrTab.tsx só extrai captionText quando a 1ª linha começa com [MEDIA:] (nunca engole 1ª linha de texto)", () => {
    const sdrTabPath = path.resolve(process.cwd(), "src/components/valentina/SdrTab.tsx");
    const source = fs.readFileSync(sdrTabPath, "utf8");

    expect(source).toContain('const hasMediaTag = mediaTag.startsWith("[MEDIA:");');
    expect(source).toContain(
      'const captionText = hasMediaTag\n                                  ? lines.slice(1).join("\\n").trim()\n                                  : "";',
    );
    expect(source).toContain("{hasMediaTag ? captionText || text : text}");
  });
});
