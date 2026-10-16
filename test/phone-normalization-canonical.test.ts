import { describe, it, expect } from "bun:test";
import { normalizeCanonicalPhone, buildPhoneSearchTerms, formatPhoneNumber, maskPhone, localPhoneSearchTerms, phoneRegistrationError } from "../src/lib/utils";

describe("Normalização Canônica de Telefones e Variantes E.164 (DDI 55)", () => {
  it("normaliza números brasileiros de 11 dígitos (DDD + 9 dígitos) para E.164 com DDI 55", () => {
    expect(normalizeCanonicalPhone("14998364338")).toBe("5514998364338");
    expect(normalizeCanonicalPhone("(14) 99836-4338")).toBe("5514998364338");
    expect(normalizeCanonicalPhone("+14998364338")).toBe("14998364338"); // DDI internacional explícito
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

  it("reconhece o celular com e sem 55/nono dígito, preservando o DDD", () => {
    const variants = ["14998364338", "5514998364338", "1498364338", "551498364338"];
    for (const number of variants) for (const other of variants) expect(buildPhoneSearchTerms(number)).toContain(other);
    expect(buildPhoneSearchTerms("5514998364338")).not.toContain("5511998364338");
    expect(buildPhoneSearchTerms("5514998364338")).not.toContain("998364338");
    expect(buildPhoneSearchTerms("5514998364338")).not.toContain("98364338");
  });

  it("DDD 55 não se confunde com o DDI e fixos não ganham um nono dígito", () => {
    expect(buildPhoneSearchTerms("55998364338")).toContain("5555998364338");
    expect(buildPhoneSearchTerms("5555998364338")).toContain("5598364338");
    expect(buildPhoneSearchTerms("1434567890")).not.toContain("14934567890");
    expect(buildPhoneSearchTerms("+14155552671")).toEqual(["14155552671"]);
  });

  it("exige DDD para cadastrar e usa números locais somente em sugestões", () => {
    for (const number of ["998364338", "98364338", "(20) 99836-4338", "123"]) expect(phoneRegistrationError(number)).not.toBeNull();
    for (const number of ["(14) 99836-4338", "+55 (14) 9836-4338", "(55) 99836-4338", "+1 415 555 2671"]) expect(phoneRegistrationError(number)).toBeNull();
    expect(phoneRegistrationError("")).toBeNull();
    expect(buildPhoneSearchTerms("98364338")).toEqual(["98364338"]);
    expect(localPhoneSearchTerms("998364338")).toContain("98364338");
    expect(localPhoneSearchTerms("98364338")).toContain("998364338");
    expect(localPhoneSearchTerms("(11) 99836-4338")).toEqual(localPhoneSearchTerms("(14) 99836-4338"));
  });
});
