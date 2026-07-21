/**
 * Validação Matemática e Consulta de CNPJ na API (cnpj.ws + fallbacks)
 */

export interface CnpjData {
  valid: boolean;
  cleanCnpj: string;
  cnpjFormatted: string;
  razaoSocial?: string;
  nomeFantasia?: string;
  uf?: string;
  municipio?: string;
  erro?: string;
}

/**
 * Valida o CNPJ usando o algoritmo matemático dos dois dígitos verificadores (Módulo 11)
 * Aceita números com ou sem pontuação (ex: 12.345.678/0001-90 ou 12345678000190)
 */
export function validateCnpj(cnpjRaw: string): boolean {
  if (!cnpjRaw) return false;
  const clean = cnpjRaw.replace(/\D/g, "");

  if (clean.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(clean)) return false; // Rejeita 00000000000000, 11111111111111, etc.

  // Validação do 1º dígito verificador
  let size = 12;
  let numbers = clean.substring(0, size);
  const digits = clean.substring(size);
  let sum = 0;
  let pos = size - 7;

  for (let i = size; i >= 1; i--) {
    sum += Number(numbers.charAt(size - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (result !== Number(digits.charAt(0))) return false;

  // Validação do 2º dígito verificador
  size = 13;
  numbers = clean.substring(0, size);
  sum = 0;
  pos = size - 7;
  for (let i = size; i >= 1; i--) {
    sum += Number(numbers.charAt(size - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (result !== Number(digits.charAt(1))) return false;

  return true;
}

/**
 * Extrai qualquer padrão de CNPJ de uma string de texto
 */
export function extractCnpjFromText(text: string): string | null {
  if (!text) return null;

  // 1. Tenta encontrar CNPJ formatado (XX.XXX.XXX/XXXX-XX)
  const formattedMatch = text.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/);
  if (formattedMatch) return formattedMatch[0];

  // 2. Tenta encontrar 14 dígitos consecutivos
  const digitsMatch = text.match(/\b\d{14}\b/);
  if (digitsMatch) return digitsMatch[0];

  // 3. Limpa caracteres e verifica se restam exatamente 14 dígitos válidos
  const cleanCandidate = text.replace(/\D/g, "");
  if (cleanCandidate.length === 14 && validateCnpj(cleanCandidate)) {
    return cleanCandidate;
  }

  return null;
}

/**
 * Busca dados da empresa usando a API do cnpj.ws (com fallback para BrasilAPI e MinhaReceita)
 */
export async function fetchCnpjInfo(cnpjRaw: string): Promise<CnpjData> {
  const clean = cnpjRaw.replace(/\D/g, "");
  const formatted = clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

  if (!validateCnpj(clean)) {
    return {
      valid: false,
      cleanCnpj: clean,
      cnpjFormatted: cnpjRaw,
      erro: "CNPJ inválido no cálculo dos dígitos verificadores",
    };
  }

  // Tentar 1: publica.cnpj.ws
  try {
    const res = await fetch(`https://publica.cnpj.ws/cnpj/${clean}`, {
      headers: { "User-Agent": "ValemChat/1.0" },
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const data = await res.json();
      const razaoSocial = data?.razao_social || data?.estabelecimento?.nome_fantasia || "";
      const nomeFantasia = data?.estabelecimento?.nome_fantasia || "";
      const uf = data?.estabelecimento?.estado?.sigla || "";
      const municipio = data?.estabelecimento?.cidade?.nome || "";

      return {
        valid: true,
        cleanCnpj: clean,
        cnpjFormatted: formatted,
        razaoSocial: razaoSocial.trim(),
        nomeFantasia: nomeFantasia.trim(),
        uf,
        municipio,
      };
    }
  } catch { /* tenta fallback */ }

  // Tentar 2: BrasilAPI
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      return {
        valid: true,
        cleanCnpj: clean,
        cnpjFormatted: formatted,
        razaoSocial: (data.razao_social || data.nome_fantasia || "").trim(),
        nomeFantasia: (data.nome_fantasia || "").trim(),
        uf: data.uf || "",
        municipio: data.municipio || "",
      };
    }
  } catch { /* tenta fallback */ }

  // Tentar 3: Minha Receita
  try {
    const res = await fetch(`https://minhareceita.org/${clean}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      return {
        valid: true,
        cleanCnpj: clean,
        cnpjFormatted: formatted,
        razaoSocial: (data.razao_social || data.nome_fantasia || "").trim(),
        nomeFantasia: (data.nome_fantasia || "").trim(),
        uf: data.uf || "",
        municipio: data.municipio || "",
      };
    }
  } catch { /* ignora */ }

  return {
    valid: true,
    cleanCnpj: clean,
    cnpjFormatted: formatted,
  };
}
