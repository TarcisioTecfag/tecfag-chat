// @ts-expect-error bun:test is provided by Bun runtime
import { describe, expect, it } from "bun:test";
import {
  analyzeContactPhoneForUndeliverable,
  buildExperimentFallbackCandidates,
  formatMetaErrorMessagePt,
  isMetaExperimentError,
  isMetaUndeliverableError,
} from "../lib/whatsapp/meta-template-common";

describe("meta-delivery-notices", () => {
  it("detects Message undeliverable (131026) errors accurately", () => {
    expect(isMetaUndeliverableError("Message undeliverable")).toBe(true);
    expect(isMetaUndeliverableError("Message undeliverable (131026)")).toBe(true);
    expect(isMetaUndeliverableError(null, 131026)).toBe(true);
    expect(isMetaUndeliverableError("User's number is part of an experiment")).toBe(false);
  });

  it("identifies Brazilian commercial landlines (such as Angelo 551123729670) without WhatsApp", () => {
    const angelo = analyzeContactPhoneForUndeliverable("551123729670");
    expect(angelo.isBrazilNumber).toBe(true);
    expect(angelo.isBrazilLandline).toBe(true);
    expect(angelo.isMissingNinthDigit).toBe(false);
    expect(angelo.formattedPhone).toBe("(11) 2372-9670");

    const mobile = analyzeContactPhoneForUndeliverable("5511987877479");
    expect(mobile.isBrazilNumber).toBe(true);
    expect(mobile.isBrazilLandline).toBe(false);
    expect(mobile.isMissingNinthDigit).toBe(false);
    expect(mobile.formattedPhone).toBe("(11) 98787-7479");

    const missing9 = analyzeContactPhoneForUndeliverable("556281765701");
    expect(missing9.isBrazilNumber).toBe(true);
    expect(missing9.isBrazilLandline).toBe(false);
    expect(missing9.isMissingNinthDigit).toBe(true);
    expect(missing9.formattedPhone).toBe("(62) 8176-5701");
  });

  it("formats Portuguese friendly error message for 131026 and 130472", () => {
    const landlineMsg = formatMetaErrorMessagePt("Message undeliverable", "551123729670");
    expect(landlineMsg).toContain("telefone fixo");
    expect(landlineMsg).toContain("(11) 2372-9670");

    const expMsg = formatMetaErrorMessagePt("User's number is part of an experiment (130472)");
    expect(isMetaExperimentError("User's number is part of an experiment")).toBe(true);
    expect(expMsg).toContain("130472");
  });

  it("prioritizes UTILITY templates and auto-fills customer/operator names on 130472 fallback", () => {
    const candidates = buildExperimentFallbackCandidates(
      [
        {
          name: "marketing_failed",
          language: "pt_BR",
          category: "MARKETING",
          bodyText: "Oi {{1}}! Tudo bem ? Aqui é {{2}}, daremos sequência pelo canal oficial da TECFAG, ok ?",
          variableCount: 2,
          supported: true,
        },
        {
          name: "continuidade_utilidade",
          language: "pt_BR",
          category: "UTILITY",
          bodyText: "Olá {{1}}, aqui é {{2}} da TECFAG. Podemos dar sequência ao seu atendimento?",
          variableCount: 2,
          supported: true,
        },
      ],
      {
        failedMessageText:
          "Oi Angelo! Tudo bem ? Aqui é Isabella, daremos sequência pelo canal oficial da TECFAG, ok ?",
        customerName: "Angelo",
        operatorName: "Isabella Inhesta",
        tenantId: "tecfag",
      },
    );

    expect(candidates.length).toBe(1);
    expect(candidates[0].template.name).toBe("continuidade_utilidade");
    expect(candidates[0].isUtility).toBe(true);
    expect(candidates[0].previewText).toBe(
      "Olá Angelo, aqui é Isabella da TECFAG. Podemos dar sequência ao seu atendimento?",
    );
  });
});
