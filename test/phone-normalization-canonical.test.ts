import { describe, it, expect } from "bun:test";
import { normalizeCanonicalPhone, buildPhoneSearchTerms, formatPhoneNumber, maskPhone } from "../src/lib/utils";

describe("Normalização Canônica de Telefones e Variantes E.164 (DDI 55)", () => {
  it("normaliza números brasileiros de 11 dígitos (DDD + 9 dígitos) para E.164 com DDI 55", () => {
    expect(normalizeCanonicalPhone("14998364338")).toBe("5514998364338");
    expect(normalizeCanonicalPhone("(14) 99836-4338")).toBe("5514998364338");
    expect(normalizeCanonicalPhone("+14998364338")).toBe("5514998364338");
  });

  it("normaliza números brasileiros de 10 dígitos (DDD + 8 dígitos) para E.164 com DDI 55", () => {
    expect(normalizeCanonicalPhone("1434567890")).toBe("551434567890");
    expect(normalizeCanonicalPhone("(14) 3456-7890")).toBe("551434567890");
  });

  it("preserva números que já possuem o DDI 55 canônico", () => {
    expect(normalizeCanonicalPhone("5514998364338")).toBe("5514998364338");
    expect(normalizeCanonicalPhone("+55 (14) 99836-4338")).toBe("5514998364338");
    expect(normalizeCanonicalPhone("551434567890")).toBe("551434567890");
  });

  it("gera variantes completas de busca com e sem DDI 55 e com/sem o 9º dígito", () => {
    // Número enviado pelo WhatsApp (13 dígitos com 55 e com 9)
    const terms1 = buildPhoneSearchTerms("5514998364338");
    expect(terms1).toContain("5514998364338"); // Canônico com 55
    expect(terms1).toContain("14998364338");   // Sem 55
    expect(terms1).toContain("1498364338");    // Sem 55 e sem o 9
    expect(terms1).toContain("551498364338");  // Com 55 e sem o 9

    // Número cadastrado manualmente (11 dígitos sem 55)
    const terms2 = buildPhoneSearchTerms("14998364338");
    expect(terms2).toContain("14998364338");
    expect(terms2).toContain("5514998364338");
  });

  it("aplica máscara visual correta com maskPhone e formatPhoneNumber", () => {
    expect(maskPhone("14998364338")).toBe("(14) 99836-4338");
    expect(maskPhone("5514998364338")).toBe("(14) 99836-4338");
    expect(formatPhoneNumber("5514998364338")).toBe("+55 (14) 99836-4338");
    expect(formatPhoneNumber("14998364338")).toBe("+55 (14) 99836-4338");
  });
});
