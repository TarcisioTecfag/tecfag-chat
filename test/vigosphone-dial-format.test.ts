import { describe, it, expect } from "bun:test";
import { formatVigosPhoneNumber, getVigosPhoneLink } from "../src/lib/utils";

describe("Formatação de Discagem VigosPhone (formatVigosPhoneNumber & getVigosPhoneLink)", () => {
  it("remove o DDI 55 e adiciona 0 antes de todos os DDDs diferentes de 14", () => {
    expect(formatVigosPhoneNumber("5511999998888")).toBe("011999998888");
    expect(formatVigosPhoneNumber("+55 (11) 99999-8888")).toBe("011999998888");
    expect(formatVigosPhoneNumber("11999998888")).toBe("011999998888");
    expect(formatVigosPhoneNumber("011999998888")).toBe("011999998888");
    expect(formatVigosPhoneNumber("+55 011 99999-8888")).toBe("011999998888");
    expect(getVigosPhoneLink("5521987654321")).toBe("tel:021987654321");
  });

  it("exceção Bauru / DDD 14: remove 55, remove 0 e remove o DDD 14 (celular e fixo)", () => {
    expect(formatVigosPhoneNumber("5514998364338")).toBe("998364338");
    expect(formatVigosPhoneNumber("+55 (14) 99836-4338")).toBe("998364338");
    expect(formatVigosPhoneNumber("014998364338")).toBe("998364338");
    expect(formatVigosPhoneNumber("14998364338")).toBe("998364338");
    expect(formatVigosPhoneNumber("998364338")).toBe("998364338");

    // Fixo local Bauru (8 dígitos iniciados em 2-5)
    expect(formatVigosPhoneNumber("551432001234")).toBe("32001234");
    expect(formatVigosPhoneNumber("(14) 3200-1234")).toBe("32001234");
    expect(formatVigosPhoneNumber("01432001234")).toBe("32001234");
    expect(formatVigosPhoneNumber("32001234")).toBe("32001234");
    expect(getVigosPhoneLink("5514991522605")).toBe("tel:991522605");
  });

  it("restaura o 9º dígito em celulares de 8 dígitos vindos do WhatsApp Meta (DDDs 31-99), preservando fixos", () => {
    // Celular sem 9º dígito (wa_id de 12 dígitos da Meta Cloud API)
    expect(formatVigosPhoneNumber("557488041686")).toBe("074988041686");
    expect(formatVigosPhoneNumber("556281765701")).toBe("062981765701");
    expect(formatVigosPhoneNumber("551488041686")).toBe("988041686");

    // Telefone fixo fora de Bauru (deve continuar com 8 dígitos + 0 + DDD)
    expect(formatVigosPhoneNumber("551133334444")).toBe("01133334444");
    expect(formatVigosPhoneNumber("1133334444")).toBe("01133334444");
    expect(formatVigosPhoneNumber("01133334444")).toBe("01133334444");
  });

  it("protege o DDD 55 (Santa Maria / RS) sem confundi-lo com o DDI 55 do Brasil", () => {
    expect(formatVigosPhoneNumber("5555999998888")).toBe("055999998888");
    expect(formatVigosPhoneNumber("55999998888")).toBe("055999998888");
    expect(formatVigosPhoneNumber("5532223333")).toBe("05532223333");
    expect(formatVigosPhoneNumber("055999998888")).toBe("055999998888");
  });

  it("higieniza prefixo de operadora (015, 021), JIDs do Baileys, 0800 e entradas vazias", () => {
    expect(formatVigosPhoneNumber("01511999998888")).toBe("011999998888");
    expect(formatVigosPhoneNumber("02114998364338")).toBe("998364338");
    expect(formatVigosPhoneNumber("5511999998888:14@s.whatsapp.net")).toBe("011999998888");
    expect(formatVigosPhoneNumber("5514998364338@s.whatsapp.net")).toBe("998364338");
    expect(formatVigosPhoneNumber("0800 777 1234")).toBe("08007771234");
    expect(formatVigosPhoneNumber("5508007771234")).toBe("08007771234");
    expect(formatVigosPhoneNumber(null)).toBe("");
    expect(getVigosPhoneLink(undefined)).toBe("#");
    expect(getVigosPhoneLink("")).toBe("#");
  });

  it("é idempotente quando chamado múltiplas vezes sobre o mesmo resultado", () => {
    const sp = formatVigosPhoneNumber("5511999998888");
    expect(formatVigosPhoneNumber(sp)).toBe("011999998888");

    const bauru = formatVigosPhoneNumber("5514998364338");
    expect(formatVigosPhoneNumber(bauru)).toBe("998364338");
  });
});
