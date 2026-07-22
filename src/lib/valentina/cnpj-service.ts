/**
 * Validação Matemática e Consulta de CNPJ na API (cnpj.ws + fallbacks)
 */

export interface CnpjFullDetails {
  razaoSocial?: string;
  nomeFantasia?: string;
  cnpjFormatted?: string;
  cleanCnpj?: string;
  situacaoCadastral?: string;
  dataAbertura?: string;
  naturezaJuridica?: string;
  capitalSocial?: string;
  porte?: string;
  atividadePrincipal?: string;
  atividadesSecundarias?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  telefone?: string;
  email?: string;
  qsa?: string;
  consultedAt?: string;
}

export interface CnpjData {
  valid: boolean;
  cleanCnpj: string;
  cnpjFormatted: string;
  razaoSocial?: string;
  nomeFantasia?: string;
  uf?: string;
  municipio?: string;
  details?: CnpjFullDetails;
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

  const nowIso = new Date().toISOString();

  // Tentar 1: publica.cnpj.ws
  try {
    const res = await fetch(`https://publica.cnpj.ws/cnpj/${clean}`, {
      headers: { "User-Agent": "ValemChat/1.0" },
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const data = await res.json();
      const razaoSocial = (data?.razao_social || data?.estabelecimento?.nome_fantasia || "").trim();
      const nomeFantasia = (data?.estabelecimento?.nome_fantasia || "").trim();
      const uf = data?.estabelecimento?.estado?.sigla || "";
      const municipio = data?.estabelecimento?.cidade?.nome || "";

      const details: CnpjFullDetails = {
        razaoSocial,
        nomeFantasia,
        cnpjFormatted: formatted,
        cleanCnpj: clean,
        situacaoCadastral: data?.estabelecimento?.situacao_cadastral || "Ativa",
        dataAbertura: data?.estabelecimento?.data_inicio_atividade || "",
        naturezaJuridica: data?.natureza_juridica?.descricao || "",
        capitalSocial: data?.capital_social ? `R$ ${Number(data.capital_social).toLocaleString("pt-BR")}` : "",
        porte: data?.porte?.descricao || "",
        atividadePrincipal: data?.estabelecimento?.atividade_principal?.descricao
          ? `${data.estabelecimento.atividade_principal.subclasse || ''} - ${data.estabelecimento.atividade_principal.descricao}`
          : "",
        atividadesSecundarias: (data?.estabelecimento?.atividades_secundarias || [])
          .map((a: any) => `${a.subclasse || ''} - ${a.descricao || ''}`)
          .join("\n"),
        logradouro: `${data?.estabelecimento?.tipo_logradouro || ""} ${data?.estabelecimento?.logradouro || ""}`.trim(),
        numero: data?.estabelecimento?.numero || "",
        complemento: data?.estabelecimento?.complemento || "",
        bairro: data?.estabelecimento?.bairro || "",
        municipio,
        uf,
        cep: data?.estabelecimento?.cep || "",
        telefone: `${data?.estabelecimento?.ddd1 || ""} ${data?.estabelecimento?.telefone1 || ""}`.trim(),
        email: data?.estabelecimento?.email || "",
        qsa: (data?.socios || []).map((s: any) => `${s.nome} (${s.qualificacao_socio?.descricao || 'Sócio'})`).join(", "),
        consultedAt: nowIso,
      };

      return {
        valid: true,
        cleanCnpj: clean,
        cnpjFormatted: formatted,
        razaoSocial,
        nomeFantasia,
        uf,
        municipio,
        details,
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
      const razaoSocial = (data.razao_social || data.nome_fantasia || "").trim();
      const nomeFantasia = (data.nome_fantasia || "").trim();
      const uf = data.uf || "";
      const municipio = data.municipio || "";

      const details: CnpjFullDetails = {
        razaoSocial,
        nomeFantasia,
        cnpjFormatted: formatted,
        cleanCnpj: clean,
        situacaoCadastral: data.descricao_situacao_cadastral || "Ativa",
        dataAbertura: data.data_inicio_atividade || "",
        naturezaJuridica: data.natureza_juridica || "",
        capitalSocial: data.capital_social ? `R$ ${Number(data.capital_social).toLocaleString("pt-BR")}` : "",
        porte: data.porte || "",
        atividadePrincipal: data.cnae_fiscal_descricao || "",
        atividadesSecundarias: (data.cnaes_secundarios || [])
          .map((a: any) => `${a.codigo || ''} - ${a.descricao || ''}`)
          .join("\n"),
        logradouro: `${data.descricao_tipo_de_logradouro || ""} ${data.logradouro || ""}`.trim(),
        numero: data.numero || "",
        complemento: data.complemento || "",
        bairro: data.bairro || "",
        municipio,
        uf,
        cep: data.cep || "",
        telefone: data.ddd_telefone_1 || "",
        email: data.email || "",
        qsa: (data.qsa || []).map((s: any) => `${s.nome_socio || s.nome} (${s.qualificacao_socio || 'Sócio'})`).join(", "),
        consultedAt: nowIso,
      };

      return {
        valid: true,
        cleanCnpj: clean,
        cnpjFormatted: formatted,
        razaoSocial,
        nomeFantasia,
        uf,
        municipio,
        details,
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
      const razaoSocial = (data.razao_social || data.nome_fantasia || "").trim();
      const nomeFantasia = (data.nome_fantasia || "").trim();
      const uf = data.uf || "";
      const municipio = data.municipio || "";

      const details: CnpjFullDetails = {
        razaoSocial,
        nomeFantasia,
        cnpjFormatted: formatted,
        cleanCnpj: clean,
        situacaoCadastral: data.descricao_situacao_cadastral || "Ativa",
        dataAbertura: data.data_inicio_atividade || "",
        naturezaJuridica: data.natureza_juridica || "",
        capitalSocial: data.capital_social ? `R$ ${Number(data.capital_social).toLocaleString("pt-BR")}` : "",
        porte: data.porte || "",
        atividadePrincipal: data.cnae_fiscal_descricao || "",
        logradouro: data.logradouro || "",
        numero: data.numero || "",
        bairro: data.bairro || "",
        municipio,
        uf,
        cep: data.cep || "",
        telefone: data.ddd_telefone_1 || "",
        email: data.email || "",
        consultedAt: nowIso,
      };

      return {
        valid: true,
        cleanCnpj: clean,
        cnpjFormatted: formatted,
        razaoSocial,
        nomeFantasia,
        uf,
        municipio,
        details,
      };
    }
  } catch { /* ignora */ }

  return {
    valid: true,
    cleanCnpj: clean,
    cnpjFormatted: formatted,
    details: {
      cnpjFormatted: formatted,
      cleanCnpj: clean,
      consultedAt: nowIso,
    },
  };
}
