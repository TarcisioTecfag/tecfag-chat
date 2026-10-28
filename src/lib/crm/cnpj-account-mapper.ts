import type { CrmAccountDTO } from "./crm-types";
import { type CnpjFullDetails, validateCnpj } from "../valentina/cnpj-service";

export function createEmptyCnpjDetails(): CnpjFullDetails {
  return {
    razaoSocial: "",
    nomeFantasia: "",
    cnpjFormatted: "",
    cleanCnpj: "",
    situacaoCadastral: "",
    dataAbertura: "",
    naturezaJuridica: "",
    capitalSocial: "",
    porte: "",
    atividadePrincipal: "",
    atividadesSecundarias: "",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    municipio: "",
    uf: "",
    cep: "",
    telefone: "",
    email: "",
    qsa: "",
    consultedAt: "",
  };
}

export function formatCnpjDigits(raw?: string | null): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  return raw;
}

/**
 * Extrai o objeto CnpjFullDetails a partir da Empresa/Conta vinculada (crm_accounts).
 * Se a empresa ainda não tiver os metadados da Receita em `address`, mas o contato legado
 * possuir `fallbackLegacyDetails` do mesmo CNPJ, aproveita os metadados como fallback.
 */
export function extractCnpjDetailsFromAccount(
  account: CrmAccountDTO | null | undefined,
  fallbackLegacyDetails?: CnpjFullDetails | null,
): CnpjFullDetails {
  if (!account) {
    return {};
  }

  const addr = (account.address || {}) as Record<string, any>;
  const cleanDoc = (account.document || addr.cleanCnpj || addr.cnpjFormatted || "").replace(/\D/g, "");
  const formattedDoc = cleanDoc.length === 14
    ? formatCnpjDigits(cleanDoc)
    : (addr.cnpjFormatted || account.document || "");

  const legacyClean = (fallbackLegacyDetails?.cleanCnpj || fallbackLegacyDetails?.cnpjFormatted || "").replace(/\D/g, "");
  const legacyMatchesAccount = Boolean(
    fallbackLegacyDetails &&
    cleanDoc &&
    legacyClean &&
    cleanDoc === legacyClean
  );
  const legacy = legacyMatchesAccount ? (fallbackLegacyDetails || {}) : {};

  return {
    razaoSocial: account.name || addr.razaoSocial || legacy.razaoSocial || "",
    nomeFantasia: account.tradeName || addr.nomeFantasia || legacy.nomeFantasia || "",
    cnpjFormatted: formattedDoc,
    cleanCnpj: cleanDoc,
    situacaoCadastral: addr.situacaoCadastral ?? legacy.situacaoCadastral ?? "",
    dataAbertura: addr.dataAbertura ?? legacy.dataAbertura ?? "",
    naturezaJuridica: addr.naturezaJuridica ?? legacy.naturezaJuridica ?? "",
    capitalSocial: addr.capitalSocial ?? legacy.capitalSocial ?? "",
    porte: addr.porte ?? legacy.porte ?? "",
    atividadePrincipal: addr.atividadePrincipal ?? legacy.atividadePrincipal ?? "",
    atividadesSecundarias: addr.atividadesSecundarias ?? legacy.atividadesSecundarias ?? "",
    logradouro: addr.street ?? addr.logradouro ?? legacy.logradouro ?? "",
    numero: addr.number ?? addr.numero ?? legacy.numero ?? "",
    complemento: addr.complement ?? addr.complemento ?? legacy.complemento ?? "",
    bairro: addr.neighborhood ?? addr.bairro ?? legacy.bairro ?? "",
    municipio: addr.city ?? addr.municipio ?? legacy.municipio ?? "",
    uf: addr.state ?? addr.uf ?? legacy.uf ?? "",
    cep: addr.zipCode ?? addr.cep ?? legacy.cep ?? "",
    telefone: addr.telefone ?? account.phone ?? legacy.telefone ?? "",
    email: account.email ?? addr.email ?? legacy.email ?? "",
    qsa: addr.qsa ?? legacy.qsa ?? "",
    consultedAt: addr.consultedAt ?? legacy.consultedAt ?? "",
  };
}

/**
 * Constrói o JSON `address` de `crm_accounts` preservando tanto as chaves canônicas do CRM
 * (`street`, `number`, `complement`, `neighborhood`, `city`, `state`, `zipCode`)
 * quanto todos os campos da Ficha Cadastral da Receita Federal.
 */
export function buildAccountAddressFromCnpjDetails(
  details: CnpjFullDetails,
  existingAddress?: Record<string, any> | null,
): Record<string, any> {
  const prev = (existingAddress || {}) as Record<string, any>;
  const cleanCnpj = (details.cleanCnpj || details.cnpjFormatted || prev.cleanCnpj || "").replace(/\D/g, "");
  const cnpjFormatted = cleanCnpj.length === 14
    ? formatCnpjDigits(cleanCnpj)
    : (details.cnpjFormatted ?? prev.cnpjFormatted ?? "");

  const street = details.logradouro ?? prev.street ?? prev.logradouro ?? "";
  const number = details.numero ?? prev.number ?? prev.numero ?? "";
  const complement = details.complemento ?? prev.complement ?? prev.complemento ?? "";
  const neighborhood = details.bairro ?? prev.neighborhood ?? prev.bairro ?? "";
  const city = details.municipio ?? prev.city ?? prev.municipio ?? "";
  const state = (details.uf ?? prev.state ?? prev.uf ?? "").toUpperCase();
  const zipCode = details.cep ?? prev.zipCode ?? prev.cep ?? "";

  return {
    ...prev,
    // Chaves padrão de endereço do CRM
    street,
    number,
    complement,
    neighborhood,
    city,
    state,
    zipCode,
    // Chaves da Ficha Cadastral da Receita Federal
    razaoSocial: details.razaoSocial ?? prev.razaoSocial ?? "",
    nomeFantasia: details.nomeFantasia ?? prev.nomeFantasia ?? "",
    cnpjFormatted,
    cleanCnpj,
    situacaoCadastral: details.situacaoCadastral ?? prev.situacaoCadastral ?? "",
    dataAbertura: details.dataAbertura ?? prev.dataAbertura ?? "",
    naturezaJuridica: details.naturezaJuridica ?? prev.naturezaJuridica ?? "",
    capitalSocial: details.capitalSocial ?? prev.capitalSocial ?? "",
    porte: details.porte ?? prev.porte ?? "",
    atividadePrincipal: details.atividadePrincipal ?? prev.atividadePrincipal ?? "",
    atividadesSecundarias: details.atividadesSecundarias ?? prev.atividadesSecundarias ?? "",
    logradouro: street,
    numero: number,
    complemento: complement,
    bairro: neighborhood,
    municipio: city,
    uf: state,
    cep: zipCode,
    telefone: details.telefone ?? prev.telefone ?? "",
    email: details.email ?? prev.email ?? "",
    qsa: details.qsa ?? prev.qsa ?? "",
    consultedAt: details.consultedAt ?? prev.consultedAt ?? new Date().toISOString(),
  };
}

/**
 * Monta o payload seguro para `PATCH /api/crm/accounts/:accountId` a partir dos Dados da Receita Federal.
 */
export function buildAccountUpdatePayloadFromCnpjDetails(
  details: CnpjFullDetails,
  currentAccount?: CrmAccountDTO | null,
): Record<string, any> {
  const payload: Record<string, any> = {
    address: buildAccountAddressFromCnpjDetails(details, currentAccount?.address),
  };

  const trimmedRazao = details.razaoSocial?.trim();
  if (trimmedRazao) {
    payload.name = trimmedRazao;
  } else if (currentAccount?.name) {
    payload.name = currentAccount.name;
  }

  if (details.nomeFantasia !== undefined) {
    payload.tradeName = details.nomeFantasia.trim() || null;
  }

  const candidateDoc = (details.cleanCnpj || details.cnpjFormatted || "").replace(/\D/g, "");
  if (candidateDoc.length === 14 && validateCnpj(candidateDoc)) {
    payload.document = candidateDoc;
  }

  if (details.telefone !== undefined) {
    const phoneDigits = details.telefone.replace(/\D/g, "");
    if (phoneDigits.length >= 8) {
      payload.phone = phoneDigits;
    } else if (!details.telefone.trim() && !currentAccount?.phone) {
      payload.phone = null;
    }
  }

  if (details.email !== undefined) {
    const cleanEmail = details.email.trim().toLowerCase();
    if (cleanEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      payload.email = cleanEmail;
    } else if (!cleanEmail && !currentAccount?.email) {
      payload.email = null;
    }
  }

  return payload;
}
