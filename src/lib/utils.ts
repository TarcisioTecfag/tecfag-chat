import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Normaliza um número de telefone para o formato canônico E.164 (apenas dígitos).
 * Se for um número brasileiro (10 ou 11 dígitos: DDD + número), adiciona o DDI 55.
 * Se já começar com 55 e tiver 12 ou 13 dígitos, preserva.
 */
export function normalizeCanonicalPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");
  if (!digits) return "";

  // Se já tem 12 ou 13 dígitos e começa com 55, é Brasil canônico
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }

  // Se tem 10 dígitos (DDD + 8 dígitos) ou 11 dígitos (DDD + 9 dígitos), adiciona DDI 55
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return digits;
}

/**
 * Gera variantes de busca para números de telefone (com/sem DDI 55 e com/sem o 9º dígito).
 * Cobre cenários em que o WhatsApp envia 55 + DDD + 9 + 8 dígitos mas a base tem outra variante.
 */
export function buildPhoneSearchTerms(rawPhone: string | null | undefined): string[] {
  if (!rawPhone) return [];
  const clean = rawPhone.replace(/\D/g, "");
  if (!clean) return [];

  // Normaliza para sem DDI
  const withoutDDI = clean.startsWith("55") && clean.length >= 12 ? clean.slice(2) : clean;
  const withDDI = withoutDDI.startsWith("55") ? withoutDDI : `55${withoutDDI}`;

  // Gera variante com/sem o nono dígito (Brasil: DDDs têm 2 dígitos)
  let withoutDDI_alt: string | null = null;
  if (withoutDDI.length === 11 && withoutDDI[2] === "9") {
    // 11 dígitos → remove o 9: 14 9 9836-4338 → 14 9836-4338
    withoutDDI_alt = withoutDDI.slice(0, 2) + withoutDDI.slice(3);
  } else if (withoutDDI.length === 10) {
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

export function maskPhone(val: string): string {
  if (!val) return "";
  let digits = val.replace(/\D/g, "");
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
    if (mainId.startsWith("55") && (mainId.length === 12 || mainId.length === 13)) {
      return `Grupo (Criador: ${formatPhoneNumber(mainId)})`;
    }
    return `Grupo (ID: ${phone.slice(0, 8)}...)`;
  }
  
  // Se for um número de telefone brasileiro com código do país (55...)
  if (clean.startsWith("55") && (clean.length === 12 || clean.length === 13)) {
    const ddd = clean.slice(2, 4);
    const number = clean.slice(4);
    if (number.length === 9) {
      return `+55 (${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
    } else if (number.length === 8) {
      return `+55 (${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
    }
  }

  // Se for um número brasileiro sem o DDI 55 (10 ou 11 dígitos)
  if (clean.length === 10 || clean.length === 11) {
    const ddd = clean.slice(0, 2);
    const number = clean.slice(2);
    if (number.length === 9) {
      return `+55 (${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
    } else if (number.length === 8) {
      return `+55 (${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
    }
  }
  
  // Se for qualquer outro número de telefone
  return `+${clean}`;
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

