import { validateCnpj } from "../valentina/cnpj-service";

export { validateCnpj };

export type AccountEntityType = "company" | "person";

export interface AccountDocumentValidationResult {
  valid: boolean;
  error: string | null;
  mismatchSuggestedType: AccountEntityType | null;
}

/**
 * Remove qualquer caractere não numérico do documento (CPF/CNPJ).
 */
export function normalizeAccountDocument(doc?: string | null): string {
  if (!doc) return "";
  return String(doc).replace(/\D/g, "");
}

/**
 * Formata CPF (11 dígitos) com máscara 000.000.000-00.
 */
export function maskCpfDigits(digits: string): string {
  const clean = digits.replace(/\D/g, "").slice(0, 11);
  return clean
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

/**
 * Formata CNPJ (14 dígitos) com máscara 00.000.000/0000-00.
 */
export function maskCnpjDigits(digits: string): string {
  const clean = digits.replace(/\D/g, "").slice(0, 14);
  return clean
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

/**
 * Formata o input de documento preservando até 14 dígitos mesmo quando o tipo é PF,
 * permitindo detectar imediatamente quando o usuário tenta informar um CNPJ em cadastro PF
 * (sem truncar silenciosamente para 11 dígitos) ou um CPF em cadastro PJ.
 */
export function formatAccountDocumentInput(val: string, accountType: AccountEntityType): string {
  const digits = normalizeAccountDocument(val).slice(0, 14);
  if (!digits) return "";

  if (accountType === "person") {
    // Se o usuário digitou/colou mais de 11 dígitos em PF (ex: CNPJ), formata como CNPJ para evidenciar o erro
    if (digits.length > 11) {
      return maskCnpjDigits(digits);
    }
    return maskCpfDigits(digits);
  }

  // Em PJ, se tiver exatamente 11 dígitos e o valor original não tinha barra "/", formata como CPF para evidenciar o alerta
  if (digits.length === 11 && !val.includes("/")) {
    return maskCpfDigits(digits);
  }

  return maskCnpjDigits(digits);
}

/**
 * Valida obrigatoriedade e compatibilidade estrita entre o tipo de cliente (PJ/PF) e o documento (CNPJ/CPF).
 * - PJ exige CNPJ (14 dígitos). Se informar CPF (11 dígitos), orienta a criar como PF.
 * - PF exige CPF (11 dígitos). Se informar CNPJ (14 dígitos), orienta a criar como PJ.
 */
export function validateAccountDocument(
  type: AccountEntityType,
  rawDoc?: string | null
): AccountDocumentValidationResult {
  const digits = normalizeAccountDocument(rawDoc);

  if (!digits) {
    if (type === "company") {
      return {
        valid: false,
        error: "O CNPJ é obrigatório para cadastrar uma empresa (Pessoa Jurídica).",
        mismatchSuggestedType: null,
      };
    }
    return {
      valid: false,
      error: "O CPF é obrigatório para cadastrar uma Pessoa Física (PF).",
      mismatchSuggestedType: null,
    };
  }

  if (type === "company") {
    if (digits.length === 11) {
      return {
        valid: false,
        error:
          "Não é possível criar uma Pessoa Jurídica (PJ) usando CPF. Para usar CPF, crie como Pessoa Física (PF).",
        mismatchSuggestedType: "person",
      };
    }
    if (digits.length !== 14) {
      return {
        valid: false,
        error: "CNPJ inválido. O CNPJ é obrigatório e deve conter exatamente 14 dígitos numéricos.",
        mismatchSuggestedType: null,
      };
    }
  }

  if (type === "person") {
    if (digits.length === 14 || digits.length > 11 || (rawDoc && String(rawDoc).includes("/"))) {
      return {
        valid: false,
        error:
          "Não é possível criar uma Pessoa Física (PF) usando CNPJ. Para usar CNPJ, crie como Pessoa Jurídica (PJ).",
        mismatchSuggestedType: "company",
      };
    }
    if (digits.length !== 11) {
      return {
        valid: false,
        error: "CPF inválido. O CPF é obrigatório e deve conter exatamente 11 dígitos numéricos.",
        mismatchSuggestedType: null,
      };
    }
  }

  return {
    valid: true,
    error: null,
    mismatchSuggestedType: null,
  };
}

/**
 * Retorna aviso imediato (inline) quando o usuário digita CPF em PJ ou CNPJ em PF.
 */
export function getInlineDocumentMismatch(
  type: AccountEntityType,
  rawDoc?: string | null
): { message: string; suggestedType: AccountEntityType; suggestedLabel: string } | null {
  const digits = normalizeAccountDocument(rawDoc);
  if (!digits) return null;

  if (type === "company" && digits.length === 11) {
    return {
      message:
        "Você informou um CPF (11 dígitos). Não é permitido usar CPF em Pessoa Jurídica (PJ) — crie como Pessoa Física (PF).",
      suggestedType: "person",
      suggestedLabel: "Mudar para Pessoa Física (PF)",
    };
  }

  if (type === "person" && (digits.length > 11 || (rawDoc && String(rawDoc).includes("/")))) {
    return {
      message:
        "Você informou um CNPJ. Não é permitido usar CNPJ em Pessoa Física (PF) — crie como Pessoa Jurídica (PJ).",
      suggestedType: "company",
      suggestedLabel: "Mudar para Pessoa Jurídica (PJ)",
    };
  }

  return null;
}
