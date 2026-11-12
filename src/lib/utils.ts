import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const BRAZIL_DDDS = new Set(
  "11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99".split(
    " ",
  ),
);

export interface PhoneCountryOption {
  code: string;
  ddi: string;
  flag: string;
  name: string;
  placeholder: string;
  maxNationalDigits: number;
}

export const PHONE_COUNTRIES: PhoneCountryOption[] = [
  { code: "BR", ddi: "55", flag: "🇧🇷", name: "Brasil", placeholder: "(14) 99999-9999", maxNationalDigits: 11 },
  { code: "US", ddi: "1", flag: "🇺🇸", name: "EUA / Canadá", placeholder: "(305) 555-0123", maxNationalDigits: 10 },
  { code: "PY", ddi: "595", flag: "🇵🇾", name: "Paraguai", placeholder: "981 123 456", maxNationalDigits: 10 },
  { code: "AR", ddi: "54", flag: "🇦🇷", name: "Argentina", placeholder: "9 11 1234-5678", maxNationalDigits: 11 },
  { code: "UY", ddi: "598", flag: "🇺🇾", name: "Uruguai", placeholder: "99 123 456", maxNationalDigits: 9 },
  { code: "CL", ddi: "56", flag: "🇨🇱", name: "Chile", placeholder: "9 1234 5678", maxNationalDigits: 9 },
  { code: "CO", ddi: "57", flag: "🇨🇴", name: "Colômbia", placeholder: "300 123 4567", maxNationalDigits: 10 },
  { code: "PE", ddi: "51", flag: "🇵🇪", name: "Peru", placeholder: "912 345 678", maxNationalDigits: 9 },
  { code: "BO", ddi: "591", flag: "🇧🇴", name: "Bolívia", placeholder: "7123 4567", maxNationalDigits: 8 },
  { code: "MX", ddi: "52", flag: "🇲🇽", name: "México", placeholder: "55 1234 5678", maxNationalDigits: 10 },
  { code: "PT", ddi: "351", flag: "🇵🇹", name: "Portugal", placeholder: "912 345 678", maxNationalDigits: 9 },
  { code: "ES", ddi: "34", flag: "🇪🇸", name: "Espanha", placeholder: "612 345 678", maxNationalDigits: 9 },
  { code: "CN", ddi: "86", flag: "🇨🇳", name: "China", placeholder: "138 0013 8000", maxNationalDigits: 11 },
  { code: "INTL", ddi: "", flag: "🌐", name: "Outro país (+DDI)", placeholder: "+44 7911 123456", maxNationalDigits: 15 },
];

/**
 * Verifica se uma sequência de 10 ou 11 dígitos corresponde a um número nacional brasileiro válido
 * (DDD válido + 8 dígitos de fixo/móvel legado ou 9 dígitos iniciando por 9).
 */
export function isValidBrazilNationalPhone(digits: string): boolean {
  if (digits.length !== 10 && digits.length !== 11) return false;
  if (!BRAZIL_DDDS.has(digits.slice(0, 2))) return false;
  return digits.length === 10 ? /^[2-9]\d{7}$/.test(digits.slice(2)) : /^9\d{8}$/.test(digits.slice(2));
}

/**
 * Verifica se uma sequência de 11 dígitos é um número NANP válido (EUA/Canadá: DDI 1 + Area Code N[0-8]X + 7 dígitos).
 * Como nenhum Area Code da América do Norte possui '9' como segundo dígito (N9X são reservados) e todo celular
 * brasileiro de 11 dígitos possui obrigatoriamente '9' como 3º dígito (DDD + 9...), os conjuntos são 100% disjuntos.
 */
export function isNanpPhoneNumber(digits: string): boolean {
  return /^1[2-9][0-8]\d{8}$/.test(digits);
}

/**
 * Detecta números NANP (EUA/Canadá) de 11 dígitos que receberam prefixo '55' por engano (13 dígitos iniciando com 551).
 * No Brasil, nenhum celular válido de 13 dígitos começa com '551' seguido de dígito != 9 na 5ª posição.
 */
export function isCorruptedNanpWith55(digits: string): boolean {
  return digits.length === 13 && digits.startsWith("551") && isNanpPhoneNumber(digits.slice(2));
}

/**
 * Detecta o país e os dígitos nacionais a partir de um telefone bruto ou canônico.
 */
export function detectPhoneCountry(rawPhone: string | null | undefined): {
  country: PhoneCountryOption;
  nationalDigits: string;
} {
  const brCountry = PHONE_COUNTRIES[0];
  if (!rawPhone || !rawPhone.trim()) {
    return { country: brCountry, nationalDigits: "" };
  }

  const trimmed = rawPhone.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (isCorruptedNanpWith55(digits)) {
    const usCountry = PHONE_COUNTRIES.find((c) => c.code === "US")!;
    return { country: usCountry, nationalDigits: digits.slice(3) };
  }

  if (trimmed.startsWith("+")) {
    const sortedWithDdi = [...PHONE_COUNTRIES]
      .filter((c) => c.ddi.length > 0)
      .sort((a, b) => b.ddi.length - a.ddi.length);

    for (const option of sortedWithDdi) {
      if (digits.startsWith(option.ddi)) {
        return {
          country: option,
          nationalDigits: digits.slice(option.ddi.length, option.ddi.length + option.maxNationalDigits),
        };
      }
    }

    const intlCountry = PHONE_COUNTRIES.find((c) => c.code === "INTL")!;
    return { country: intlCountry, nationalDigits: digits.slice(0, 15) };
  }

  if (isNanpPhoneNumber(digits)) {
    const usCountry = PHONE_COUNTRIES.find((c) => c.code === "US")!;
    return { country: usCountry, nationalDigits: digits.slice(1, 11) };
  }

  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13) && isValidBrazilNationalPhone(digits.slice(2))) {
    return { country: brCountry, nationalDigits: digits.slice(2, 13) };
  }

  if (digits.length <= 11 && (digits.length < 10 || isValidBrazilNationalPhone(digits) || BRAZIL_DDDS.has(digits.slice(0, 2)))) {
    return { country: brCountry, nationalDigits: digits.slice(0, 11) };
  }

  const nonBrSorted = [...PHONE_COUNTRIES]
    .filter((c) => c.ddi.length > 0 && c.code !== "BR")
    .sort((a, b) => b.ddi.length - a.ddi.length);

  for (const option of nonBrSorted) {
    if (digits.startsWith(option.ddi) && digits.length >= option.ddi.length + 7) {
      return {
        country: option,
        nationalDigits: digits.slice(option.ddi.length, option.ddi.length + option.maxNationalDigits),
      };
    }
  }

  return { country: brCountry, nationalDigits: digits.slice(0, 11) };
}

/**
 * Formata dígitos nacionais de acordo com o país selecionado.
 */
export function formatNationalPhoneByCountry(nationalDigits: string, countryCode: string): string {
  const digits = nationalDigits.replace(/\D/g, "");
  if (!digits) return "";

  if (countryCode === "BR") {
    const d = digits.slice(0, 11);
    if (d.length <= 2) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  if (countryCode === "US") {
    const d = digits.slice(0, 10);
    if (d.length <= 3) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
  }

  if (countryCode === "PY") {
    const d = digits.slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)} ${d.slice(3)}`;
    return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  }

  if (countryCode === "AR") {
    const d = digits.slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return `${d.slice(0, 2)} ${d.slice(2)}`;
    return `${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}`;
  }

  const option = PHONE_COUNTRIES.find((c) => c.code === countryCode);
  const maxLen = option?.maxNationalDigits ?? 15;
  const d = digits.slice(0, maxLen);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)} ${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}`;
}

/**
 * Normaliza um número de telefone para o formato canônico E.164 (apenas dígitos).
 * - Preserva números internacionais (+1 EUA/Canadá, +595 Paraguai, +54 Argentina, etc.).
 * - Auto-cura números NANP de 13 dígitos que receberam 55 por engano (551... -> 1...).
 * - Se for um número brasileiro válido (10 ou 11 dígitos: DDD + número), adiciona o DDI 55.
 */
export function normalizeCanonicalPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";

  if (isCorruptedNanpWith55(digits)) {
    return digits.slice(2);
  }

  if (trimmed.startsWith("+") && !digits.startsWith("55")) return digits;

  if (isNanpPhoneNumber(digits)) {
    return digits;
  }

  // Se já tem 12 ou 13 dígitos e começa com 55, é Brasil canônico
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }

  // Se tem 10 dígitos (DDD + 8 dígitos) ou 11 dígitos (DDD + 9 dígitos) brasileiros válidos, adiciona DDI 55
  if (isValidBrazilNationalPhone(digits)) {
    return `55${digits}`;
  }

  return digits;
}

/**
 * Gera variantes de busca para números de telefone (com/sem DDI 55 e com/sem o 9º dígito para Brasil,
 * ou variantes E.164 + auto-cura para números internacionais).
 */
export function buildPhoneSearchTerms(rawPhone: string | null | undefined): string[] {
  if (!rawPhone) return [];
  const trimmed = rawPhone.trim();
  const clean = trimmed.replace(/\D/g, "");
  if (!clean) return [];

  // Tratamento para número NANP corrompido com 55 (ex: 5513055551234) ou NANP legítimo (13055551234)
  if (isCorruptedNanpWith55(clean)) {
    const healed = clean.slice(2);
    return [healed, clean, healed.slice(1)];
  }

  if (trimmed.startsWith("+") && !clean.startsWith("55")) {
    return [clean];
  }

  if (isNanpPhoneNumber(clean)) {
    return [clean, `55${clean}`];
  }

  // Normaliza para sem DDI
  const withoutDDI = clean.startsWith("55") && clean.length >= 12 ? clean.slice(2) : clean;
  // Só interpreta DDD em números brasileiros completos. DDD 55 também recebe DDI 55.
  if (withoutDDI.length !== 10 && withoutDDI.length !== 11) return [clean];
  if (phoneRegistrationError(rawPhone)) return [clean];
  const withDDI = `55${withoutDDI}`;

  // Gera variante com/sem o nono dígito (Brasil: DDDs têm 2 dígitos)
  let withoutDDI_alt: string | null = null;
  if (withoutDDI.length === 11 && /^9[6-9]/.test(withoutDDI.slice(2))) {
    // 11 dígitos → remove o 9: 14 9 9836-4338 → 14 9836-4338
    withoutDDI_alt = withoutDDI.slice(0, 2) + withoutDDI.slice(3);
  } else if (withoutDDI.length === 10 && /^[6-9]/.test(withoutDDI.slice(2))) {
    // 10 dígitos → insere 9: 14 9836-4338 → 14 9 9836-4338
    withoutDDI_alt = withoutDDI.slice(0, 2) + "9" + withoutDDI.slice(2);
  }

  const terms = new Set<string>();
  terms.add(withoutDDI);
  terms.add(withDDI);
  if (withoutDDI_alt) {
    terms.add(withoutDDI_alt);
    terms.add(`55${withoutDDI_alt}`);
  }

  return Array.from(terms);
}

/** Número local serve apenas para sugestões; nunca para vincular automaticamente. */
export function localPhoneSearchTerms(rawPhone: string): string[] {
  const trimmed = rawPhone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && !digits.startsWith("55")) return [];
  if (isNanpPhoneNumber(digits) || isCorruptedNanpWith55(digits)) return [];

  const national = digits.startsWith("55") && [12, 13].includes(digits.length) ? digits.slice(2) : digits;
  if ([10, 11].includes(national.length) && !BRAZIL_DDDS.has(national.slice(0, 2))) return [];
  const local = [10, 11].includes(national.length) ? national.slice(2) : national;
  if (![8, 9].includes(local.length)) return [];
  const terms = new Set([local]);
  if (local.length === 9 && /^9[6-9]/.test(local)) terms.add(local.slice(1));
  if (local.length === 8 && /^[6-9]/.test(local)) terms.add(`9${local}`);
  return [...terms];
}

export function phoneRegistrationError(rawPhone: string | null | undefined): string | null {
  if (!rawPhone?.trim()) return null;
  const trimmed = rawPhone.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (isNanpPhoneNumber(digits) || isCorruptedNanpWith55(digits)) {
    return null;
  }

  if (trimmed.startsWith("+") && !digits.startsWith("55")) {
    if (digits.startsWith("1")) {
      return /^1[2-9]\d{9}$/.test(digits)
        ? null
        : "Informe o telefone dos EUA/Canadá com código de área (10 dígitos após +1).";
    }
    return /^[1-9]\d{8,14}$/.test(digits)
      ? null
      : "Informe o telefone internacional completo com código do país e da região.";
  }

  const national = digits.startsWith("55") && [12, 13].includes(digits.length) ? digits.slice(2) : digits;
  if (![10, 11].includes(national.length) || !BRAZIL_DDDS.has(national.slice(0, 2))) {
    return "Informe o telefone com DDD. O número sem DDD serve apenas para buscar possíveis contatos existentes.";
  }
  if (!/^[2-9]\d{7}$/.test(national.slice(2)) && !/^9\d{8}$/.test(national.slice(2)))
    return "Telefone inválido. Confira o DDD e o número.";
  return null;
}

export interface PhoneQueryPlan {
  rawLower: string;
  digits: string;
  exactTerms: string[];
  phoneIdentity: string | null;
  localSuffixTerms: string[];
  prefixTerms: string[];
}

/**
 * Monta um plano completo de busca por telefone capaz de encontrar números brasileiros
 * cadastrados COM ou SEM o nono dígito móvel (ex: Meta Cloud API 12 dígitos `557488041686`
 * vs formato ANATEL 13 dígitos `5574988041686`), com ou sem DDI `55`, com ou sem `0` de
 * operadora (`074...`), apenas número local (`98804-1686` / `8804-1686`) e prefixos em digitação,
 * sem vazar entre DDDs distintos nem adulterar telefones fixos ou internacionais.
 */
export function buildPhoneQueryPlan(rawQuery: string | null | undefined): PhoneQueryPlan {
  const trimmed = (rawQuery || "").trim();
  const rawLower = trimmed.toLowerCase();
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length < 4) {
    return {
      rawLower,
      digits,
      exactTerms: [],
      phoneIdentity: null,
      localSuffixTerms: [],
      prefixTerms: [],
    };
  }

  const isExplicitNonBrIntl = trimmed.startsWith("+") && !digits.startsWith("55");
  let normalizedInput = trimmed;

  if (!isExplicitNonBrIntl) {
    if (
      digits.startsWith("0") &&
      (digits.length === 11 || digits.length === 12) &&
      isValidBrazilNationalPhone(digits.slice(1))
    ) {
      normalizedInput = digits.slice(1);
    } else if (
      digits.startsWith("550") &&
      (digits.length === 13 || digits.length === 14) &&
      isValidBrazilNationalPhone(digits.slice(3))
    ) {
      normalizedInput = `55${digits.slice(3)}`;
    }
  }

  const exactSet = new Set<string>();
  let phoneIdentity: string | null = null;
  const isCompleteValidPhone = phoneRegistrationError(normalizedInput) === null;

  if (isCompleteValidPhone) {
    const baseTerms = buildPhoneSearchTerms(normalizedInput);
    for (const term of baseTerms) {
      exactSet.add(term);
      if (
        !isExplicitNonBrIntl &&
        !isNanpPhoneNumber(digits) &&
        !isCorruptedNanpWith55(digits) &&
        (term.length === 10 || term.length === 11) &&
        isValidBrazilNationalPhone(term)
      ) {
        exactSet.add(`0${term}`);
        exactSet.add(`550${term}`);
      }
    }

    const normDigits = normalizedInput.replace(/\D/g, "");
    if (isCorruptedNanpWith55(normDigits)) {
      phoneIdentity = normDigits.slice(2);
    } else if (isExplicitNonBrIntl || isNanpPhoneNumber(normDigits)) {
      phoneIdentity = normDigits;
    } else {
      let national =
        normDigits.startsWith("55") && (normDigits.length === 12 || normDigits.length === 13)
          ? normDigits.slice(2)
          : normDigits;
      if (national.length === 10 || national.length === 11) {
        const ddd = national.slice(0, 2);
        if (BRAZIL_DDDS.has(ddd)) {
          if (national.length === 11 && /^9[6-9]\d{7}$/.test(national.slice(2))) {
            national = ddd + national.slice(3);
          }
          if (national.length === 10 && /^[2-9]\d{7}$/.test(national.slice(2))) {
            phoneIdentity = `55${national}`;
          }
        }
      }
    }
  }

  const localSuffixTerms =
    !isExplicitNonBrIntl && exactSet.size === 0 && (digits.length === 8 || digits.length === 9)
      ? localPhoneSearchTerms(trimmed)
      : [];

  const prefixSet = new Set<string>();
  if (!isExplicitNonBrIntl && !isNanpPhoneNumber(digits) && !isCorruptedNanpWith55(digits)) {
    if (digits.startsWith("55") && digits.length >= 5 && digits.length <= 12) {
      const after55 = digits.slice(2);
      const ddd = after55.slice(0, 2);
      if (BRAZIL_DDDS.has(ddd)) {
        if (after55.length === 3 && after55[2] === "9") {
          prefixSet.add(`55${ddd}`);
        }
        if (after55.length >= 4 && after55.length <= 10 && /^9[6-9]\d*$/.test(after55.slice(2))) {
          const without9 = ddd + after55.slice(3);
          prefixSet.add(`55${without9}`);
          if (without9.length >= 4) prefixSet.add(without9);
        }
        if (after55.length >= 3 && after55.length <= 9 && /^[6-9]\d*$/.test(after55.slice(2))) {
          const with9 = `${ddd}9${after55.slice(2)}`;
          prefixSet.add(`55${with9}`);
          prefixSet.add(with9);
        }
      }
    }

    if (digits.length >= 4 && digits.length <= 10) {
      const ddd = digits.slice(0, 2);
      if (BRAZIL_DDDS.has(ddd)) {
        if (digits.length >= 4 && digits.length <= 10 && /^9[6-9]\d*$/.test(digits.slice(2))) {
          const without9 = ddd + digits.slice(3);
          prefixSet.add(`55${digits}`);
          prefixSet.add(`55${without9}`);
          if (without9.length >= 4) prefixSet.add(without9);
        }
        if (digits.length >= 3 && digits.length <= 9 && /^[6-9]\d*$/.test(digits.slice(2))) {
          const with9 = `${ddd}9${digits.slice(2)}`;
          prefixSet.add(`55${digits}`);
          prefixSet.add(`55${with9}`);
          prefixSet.add(with9);
        }
      }
    }
  }

  for (const exact of exactSet) {
    prefixSet.delete(exact);
  }

  return {
    rawLower,
    digits,
    exactTerms: Array.from(exactSet),
    phoneIdentity,
    localSuffixTerms,
    prefixTerms: Array.from(prefixSet),
  };
}

/**
 * Avalia em memória se um telefone cadastrado corresponde ao termo buscado
 * (considerando com/sem nono dígito, com/sem DDI 55, local sem DDD e prefixos parciais).
 */
export function matchesPhoneSearchQuery(
  candidatePhone: string | null | undefined,
  rawQueryOrPlan: string | PhoneQueryPlan | null | undefined,
): boolean {
  if (!candidatePhone || !rawQueryOrPlan) return false;
  const plan =
    typeof rawQueryOrPlan === "string" ? buildPhoneQueryPlan(rawQueryOrPlan) : rawQueryOrPlan;
  if (!plan.rawLower) return false;

  if (candidatePhone.toLowerCase().includes(plan.rawLower)) {
    return true;
  }

  if (plan.digits.length < 4) return false;
  const cleanCandidate = candidatePhone.replace(/\D/g, "");
  if (!cleanCandidate) return false;

  if (cleanCandidate.includes(plan.digits)) return true;
  if (plan.exactTerms.includes(cleanCandidate)) return true;
  if (plan.localSuffixTerms.some((suffix) => cleanCandidate.endsWith(suffix))) return true;
  if (plan.prefixTerms.some((prefix) => cleanCandidate.startsWith(prefix))) return true;

  return false;
}

export function maskPhone(val: string): string {
  if (!val) return "";
  const trimmed = val.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return trimmed.startsWith("+") ? "+" : "";

  if (isCorruptedNanpWith55(digits)) {
    const usDigits = digits.slice(3);
    return `+1 ${formatNationalPhoneByCountry(usDigits, "US")}`.trim();
  }

  if (trimmed.startsWith("+") && !digits.startsWith("55")) {
    const detected = detectPhoneCountry(trimmed);
    if (detected.country.ddi) {
      const formattedNational = formatNationalPhoneByCountry(detected.nationalDigits, detected.country.code);
      return formattedNational ? `+${detected.country.ddi} ${formattedNational}` : `+${detected.country.ddi}`;
    }
    return `+${digits.slice(0, 15)}`;
  }

  if (isNanpPhoneNumber(digits)) {
    const usDigits = digits.slice(1);
    return `+1 ${formatNationalPhoneByCountry(usDigits, "US")}`.trim();
  }

  if (digits.startsWith("55") && digits.length > 11) {
    digits = digits.slice(2);
  }
  digits = digits.slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function formatPhoneNumber(phone: string | null | undefined): string {
  if (!phone) return "Não informado";

  // Trata JIDs e strings com formatos mistos
  const clean = phone.replace(/[^\d-]/g, "");

  // Se for "status" (do WhatsApp Status Broadcast)
  if (phone.toLowerCase().includes("status")) {
    return "Status WhatsApp";
  }

  // Se for grupo Baileys (inicia com 1203 ou contém "-")
  if (phone.includes("-") || phone.startsWith("1203")) {
    const parts = phone.split("-");
    const mainId = parts[0];

    // Se for grupo criado por um número de telefone brasileiro
    if (mainId.startsWith("55") && (mainId.length === 12 || mainId.length === 13) && !isCorruptedNanpWith55(mainId)) {
      return `Grupo (Criador: ${formatPhoneNumber(mainId)})`;
    }
    return `Grupo (ID: ${phone.slice(0, 8)}...)`;
  }

  const digits = phone.replace(/\D/g, "");
  if (!digits) return phone;

  // Auto-cura visual para números dos EUA que receberam 55 por engano (5513055551234 -> +1 (305) 555-1234)
  if (isCorruptedNanpWith55(digits)) {
    const usNational = digits.slice(3);
    return `+1 (${usNational.slice(0, 3)}) ${usNational.slice(3, 6)}-${usNational.slice(6, 10)}`;
  }

  // Número dos EUA/Canadá (+1 NANP de 11 dígitos)
  if (isNanpPhoneNumber(digits) || (phone.trim().startsWith("+1") && digits.length === 11 && digits.startsWith("1"))) {
    const usNational = digits.slice(1);
    return `+1 (${usNational.slice(0, 3)}) ${usNational.slice(3, 6)}-${usNational.slice(6, 10)}`;
  }

  // Se for um número de telefone brasileiro com código do país (55...)
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4);
    const number = digits.slice(4);
    if (number.length === 9) {
      return `+55 (${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
    } else if (number.length === 8) {
      return `+55 (${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
    }
  }

  // Se for um número brasileiro sem o DDI 55 (10 ou 11 dígitos)
  if (!phone.trim().startsWith("+") && (digits.length === 10 || digits.length === 11) && isValidBrazilNationalPhone(digits)) {
    const ddd = digits.slice(0, 2);
    const number = digits.slice(2);
    if (number.length === 9) {
      return `+55 (${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
    } else if (number.length === 8) {
      return `+55 (${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
    }
  }

  // Outros países conhecidos na lista PHONE_COUNTRIES
  const detected = detectPhoneCountry(phone.startsWith("+") ? phone : `+${digits}`);
  if (detected.country.ddi && detected.country.code !== "BR" && detected.nationalDigits) {
    return `+${detected.country.ddi} ${formatNationalPhoneByCountry(detected.nationalDigits, detected.country.code)}`;
  }

  // Fallback para 10 ou 11 dígitos sem '+' que não bateram em outro país
  if (!phone.trim().startsWith("+") && (digits.length === 10 || digits.length === 11)) {
    const ddd = digits.slice(0, 2);
    const number = digits.slice(2);
    if (number.length === 9) {
      return `+55 (${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
    } else if (number.length === 8) {
      return `+55 (${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
    }
  }

  // Se for qualquer outro número de telefone
  return `+${digits}`;
}

/**
 * Formata um número de telefone para discagem via VigosPhone (Softphone PABX local em Bauru / 014):
 * - Remove o DDI 55 (preservando com segurança o DDD 55 do RS e números internacionais);
 * - Restaura o 9º dígito obrigatório da ANATEL em celulares vindos do WhatsApp com 8 dígitos ([6-9]xxxxxxx -> 9[6-9]xxxxxxx),
 *   mantendo telefones fixos ([2-5]xxxxxxx) com 8 dígitos;
 * - Exceção DDD 14 (Bauru / região 014): remove o zero e o DDD 14, retornando apenas o número local (8 ou 9 dígitos);
 * - Demais DDDs brasileiros (11, 21, 41, 55, 62, 74, etc.): adiciona obrigatoriamente o prefixo 0 antes do DDD (ex: 011999998888).
 */
export function formatVigosPhoneNumber(phone?: string | null): string {
  if (!phone) return "";
  let raw = String(phone).trim();
  if (!raw) return "";

  raw = raw.replace(/^tel:/i, "").trim();
  if (raw.includes("@")) {
    raw = raw.split("@")[0].split(":")[0];
  }

  const hasExplicitPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  // 1. Números especiais não-geográficos brasileiros (0800, 0300, 4003, 4004, 3003)
  if (/^550[38]00\d{6,7}$/.test(digits)) {
    return digits.slice(2);
  }
  if (/^0[38]00\d{6,7}$/.test(digits)) {
    return digits;
  }
  if (/^(?:3003|400[34])\d{4}$/.test(digits)) {
    return digits;
  }

  // 2. Proteção para números internacionais (não-Brasil)
  if (isCorruptedNanpWith55(digits)) {
    return digits.slice(2);
  }
  if (hasExplicitPlus && !digits.startsWith("55")) {
    return digits;
  }
  if (isNanpPhoneNumber(digits)) {
    return digits;
  }

  let n = digits;

  // 3. Remoção segura do DDI 55 (sem confundir com o DDD 55 de Santa Maria/RS)
  // Caso 3a: +55 + 0 + DDD + 8/9 dígitos (13 ou 14 dígitos, ex: 55011999998888 ou 5501432001234)
  if (
    n.startsWith("550") &&
    (n.length === 13 || n.length === 14) &&
    BRAZIL_DDDS.has(n.slice(3, 5))
  ) {
    n = n.slice(3);
  } else if (
    // Caso 3b: +55 + DDD + 8/9 dígitos (12 ou 13 dígitos, ex: 5511999998888, 5514999998888, 5555999998888, 557488041686)
    n.startsWith("55") &&
    (n.length === 12 || n.length === 13) &&
    BRAZIL_DDDS.has(n.slice(2, 4))
  ) {
    n = n.slice(2);
  }

  // 4. Remoção de prefixo de tronco 0 ou 0 + CSP de operadora (ex: 011..., 014..., 01511..., 02114...)
  if (
    n.startsWith("0") &&
    (n.length === 13 || n.length === 14) &&
    BRAZIL_DDDS.has(n.slice(3, 5))
  ) {
    n = n.slice(3);
  } else if (
    n.startsWith("0") &&
    (n.length === 11 || n.length === 12) &&
    BRAZIL_DDDS.has(n.slice(1, 3))
  ) {
    n = n.slice(1);
  }

  // 5. Número brasileiro nacional com DDD (10 ou 11 dígitos)
  if ((n.length === 10 || n.length === 11) && BRAZIL_DDDS.has(n.slice(0, 2))) {
    const ddd = n.slice(0, 2);
    let subscriber = n.slice(2);

    // Restaura o 9º dígito obrigatório para celulares de 8 dígitos vindos da Meta/WhatsApp ([6-9]xxxxxxx -> 9[6-9]xxxxxxx)
    if (subscriber.length === 8 && /^[6-9]\d{7}$/.test(subscriber)) {
      subscriber = `9${subscriber}`;
    }

    // Exceção Bauru / Região 014: sem zero e sem DDD
    if (ddd === "14") {
      return subscriber;
    }

    // Demais DDDs: sempre com 0 antes do DDD (ex: 011999998888)
    return `0${ddd}${subscriber}`;
  }

  // 6. Número local já sem DDD (8 ou 9 dígitos — assumido local Bauru/014)
  if (n.length === 8 || n.length === 9) {
    if (n.length === 8 && /^[6-9]\d{7}$/.test(n)) {
      return `9${n}`;
    }
    return n;
  }

  return n;
}

export function getVigosPhoneLink(phone?: string | null): string {
  const formatted = formatVigosPhoneNumber(phone);
  return formatted ? `tel:${formatted}` : "#";
}

export function formatCPF(cpf: string | null | undefined): string {
  if (!cpf) return "Não informado";
  const clean = cpf.replace(/\D/g, "");
  if (clean.length !== 11) return cpf;
  return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9)}`;
}

export function formatCNPJ(cnpj: string | null | undefined): string {
  if (!cnpj) return "Não informado";
  const clean = cnpj.replace(/\D/g, "");
  if (clean.length !== 14) return cnpj;
  return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8, 12)}-${clean.slice(12)}`;
}

export function maskCPF(value: string): string {
  const clean = value.replace(/\D/g, "");
  const truncated = clean.slice(0, 11);
  if (truncated.length <= 3) return truncated;
  if (truncated.length <= 6) return `${truncated.slice(0, 3)}.${truncated.slice(3)}`;
  if (truncated.length <= 9) return `${truncated.slice(0, 3)}.${truncated.slice(3, 6)}.${truncated.slice(6)}`;
  return `${truncated.slice(0, 3)}.${truncated.slice(3, 6)}.${truncated.slice(6, 9)}-${truncated.slice(9)}`;
}

export function maskCNPJ(value: string): string {
  const clean = value.replace(/\D/g, "");
  const truncated = clean.slice(0, 14);
  if (truncated.length <= 2) return truncated;
  if (truncated.length <= 5) return `${truncated.slice(0, 2)}.${truncated.slice(2)}`;
  if (truncated.length <= 8) return `${truncated.slice(0, 2)}.${truncated.slice(2, 5)}.${truncated.slice(5)}`;
  if (truncated.length <= 12) return `${truncated.slice(0, 2)}.${truncated.slice(2, 5)}.${truncated.slice(5, 8)}/${truncated.slice(8)}`;
  return `${truncated.slice(0, 2)}.${truncated.slice(2, 5)}.${truncated.slice(5, 8)}/${truncated.slice(8, 12)}-${truncated.slice(12)}`;
}

export async function urlToBase64(url: string): Promise<string | undefined> {
  if (!url) return undefined;
  if (url.startsWith("data:")) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = res.headers.get("content-type") || "image/jpeg";
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch (err) {
    console.error("[urlToBase64] Erro ao converter imagem para base64:", err);
    return undefined;
  }
}

export interface TemplateVariableContext {
  clientName?: string | null;
  operatorName?: string | null;
  companyName?: string | null;
  clientCompanyName?: string | null;
  tenantId?: string | null;
}

/**
 * Substitui variáveis dinâmicas de templates e respostas rápidas.
 * Suporta tanto a sintaxe padronizada `{{nome}}`, `{{operador}}`, `{{empresa}}`, `{{empresa_cliente}}`
 * quanto a sintaxe legada `<<1>>` (Operador), `<<2>>` (Cliente) e `<<3>>` (Empresa).
 */
export function resolveTemplateVariables(
  text: string,
  ctx: TemplateVariableContext
): string {
  if (!text) return "";
  const resolvedClientName = (ctx.clientName || "").trim() || "Cliente";
  const resolvedOperatorName = (ctx.operatorName || "").trim() || "Atendente";
  const defaultTenantCompany =
    ctx.tenantId === "valem"
      ? "Valem"
      : ctx.tenantId === "tecfag"
        ? "Tecfag"
        : "Tecfag";
  const resolvedCompanyName = (ctx.companyName || "").trim() || defaultTenantCompany;
  const resolvedClientCompanyName =
    (ctx.clientCompanyName || "").trim() || resolvedCompanyName;

  return text
    .replace(/\{\{\s*(?:nome|cliente|nome_cliente)\s*\}\}/gi, resolvedClientName)
    .replace(/<<\s*2\s*>>/g, resolvedClientName)
    .replace(/\{\{\s*(?:operador|atendente|vendedor|meu_nome)\s*\}\}/gi, resolvedOperatorName)
    .replace(/<<\s*1\s*>>/g, resolvedOperatorName)
    .replace(/\{\{\s*empresa_cliente\s*\}\}/gi, resolvedClientCompanyName)
    .replace(/\{\{\s*empresa\s*\}\}/gi, resolvedCompanyName)
    .replace(/<<\s*3\s*>>/g, resolvedCompanyName);
}

/**
 * Gera um atalho canônico com barra (ex: "Saudação Inicial" -> "/saudacao_inicial").
 */
export function formatQuickShortcut(rawTitleOrShortcut: string | null | undefined): string {
  if (!rawTitleOrShortcut) return "/";
  const trimmed = rawTitleOrShortcut.trim();
  const withoutSlash = trimmed.replace(/^\/+/, "");
  const slug = withoutSlash
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `/${slug || withoutSlash.toLowerCase().replace(/\s+/g, "_")}`;
}

/**
 * Verifica se um template/resposta rápida corresponde ao termo pesquisado (com ou sem `/`, com ou sem acentos/espaços).
 */
export function matchesQuickResponseSearch(
  titleOrShortcut: string,
  content: string,
  rawQuery: string
): boolean {
  const q = rawQuery.trim();
  if (!q || q === "/") return true;
  const normalize = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const cleanQ = normalize(q.replace(/^\/+/, ""));
  const cleanQSlug = cleanQ.replace(/\s+/g, "_");
  const normTitle = normalize(titleOrShortcut.replace(/^\/+/, ""));
  const normSlug = normTitle.replace(/[^a-z0-9_-]+/g, "_");
  const normContent = normalize(content);
  return (
    normTitle.includes(cleanQ) ||
    normSlug.includes(cleanQ) ||
    normSlug.includes(cleanQSlug) ||
    normContent.includes(cleanQ)
  );
}
