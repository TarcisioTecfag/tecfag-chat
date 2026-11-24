export const MAX_UNVERIFIED_ACCOUNT_CONTACTS_FOR_PROPAGATION = 10;

export function normalizeAccountLabel(raw?: string | null): string {
  if (!raw) return "";
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

function isValidCnpjDigits(digits: string): boolean {
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  const calc = (sliceLen: number, weights: number[]) => {
    let sum = 0;
    for (let i = 0; i < sliceLen; i++) {
      sum += Number(digits[i]) * weights[i];
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const d1 = calc(12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(13, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(digits[12]) && d2 === Number(digits[13]);
}

function isValidCpfDigits(digits: string): boolean {
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const calc = (sliceLen: number, startWeight: number) => {
    let sum = 0;
    for (let i = 0; i < sliceLen; i++) {
      sum += Number(digits[i]) * (startWeight - i);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return calc(9, 10) === Number(digits[9]) && calc(10, 11) === Number(digits[10]);
}

export function hasValidAccountDocument(document?: string | null): boolean {
  if (!document) return false;
  const digits = document.replace(/\D/g, "");
  return isValidCnpjDigits(digits) || isValidCpfDigits(digits);
}

const GENERIC_ACCOUNT_EXACT_LABELS = new Set([
  "formulario contato",
  "formulario de contato",
  "form contato",
  "contato site",
  "site",
  "chat site",
  "whatsapp",
  "lead sem cadastro",
  "sem cadastro",
  "sem empresa",
  "sem razao social",
  "nao informado",
  "nao informada",
  "nao possui",
  "nao tem",
  "nenhuma",
  "nenhum",
  "desconhecido",
  "desconhecida",
  "consumidor final",
  "cliente avulso",
  "pessoa fisica",
  "pessoa fisica compra realizada pelo cpf",
  "compra realizada pelo cpf",
  "pf",
  "n a",
  "na",
  "null",
  "undefined",
  "teste",
]);

const GENERIC_ACCOUNT_PATTERNS: RegExp[] = [
  /^formulario\b/,
  /^form\s+(contato|site|meta|google|lp|landing)\b/,
  /^botao\s+whatsapp\b/,
  /^landing\s+page\b/,
  /^lead\s+sem\s+cadastro\b/,
  /^pessoa\s+fisica\s*-\s*compra\s+realizada/,
  /^sem\s+empresa\b/,
];

export function isGenericPlaceholderAccountName(name?: string | null): boolean {
  const normalized = normalizeAccountLabel(name);
  if (!normalized) return false;
  if (GENERIC_ACCOUNT_EXACT_LABELS.has(normalized)) return true;
  return GENERIC_ACCOUNT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export interface AccountPropagationCandidate {
  name?: string | null;
  tradeName?: string | null;
  document?: string | null;
  contactCount?: number | null;
}

/**
 * Determina se uma conta (crm_accounts) pode propagar vínculos entre contatos diferentes
 * (exibição de negociações da empresa no chat e syncAccountDealContacts).
 *
 * Bloqueia:
 * 1. Contas com nomes genéricos/placeholder de formulário (ex.: "formulario-contato",
 *    "LEAD SEM CADASTRO", "PESSOA FISICA - COMPRA REALIZADA PELO CPF");
 * 2. Contas sem CNPJ/CPF válido que agregam mais de 10 contatos distintos (típico de
 *    contas-balde renomeadas no RD Station, como ocorreu com "Magoga Especiarias").
 */
export function isAccountEligibleForCrossContactPropagation(
  account?: AccountPropagationCandidate | null,
): boolean {
  if (!account) return false;
  if (
    isGenericPlaceholderAccountName(account.name) ||
    isGenericPlaceholderAccountName(account.tradeName)
  ) {
    return false;
  }
  const contactCount = typeof account.contactCount === "number" ? account.contactCount : 0;
  if (
    !hasValidAccountDocument(account.document) &&
    contactCount > MAX_UNVERIFIED_ACCOUNT_CONTACTS_FOR_PROPAGATION
  ) {
    return false;
  }
  return true;
}
