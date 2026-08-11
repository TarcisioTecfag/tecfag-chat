import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const contentType = res.headers.get("content-type") || "image/jpeg";
    return `data:${contentType};base64,${btoa(binary)}`;
  } catch (err) {
    console.error("[urlToBase64] Erro ao converter imagem para base64:", err);
    return undefined;
  }
}

export function getDaysWithoutContact(item: {
  lastContactAt?: string | Date | null;
  lastMessageTime?: string | Date | null;
  daysWithoutContact?: number;
  createdAt?: string | Date | null;
}): number {
  if (typeof item?.daysWithoutContact === "number") {
    return item.daysWithoutContact;
  }

  const dateVal = item?.lastContactAt || item?.lastMessageTime;
  if (!dateVal) return 0;

  if (dateVal instanceof Date) {
    const diffMs = Date.now() - dateVal.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  }

  const str = String(dateVal).trim();

  // Se for string ISO ou formato data (ex: 2026-06-01T...)
  if (str.includes("-") || str.includes("T")) {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      const diffMs = Date.now() - parsed.getTime();
      return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    }
  }

  // Se for formato DD/MM (ex: "26/06")
  if (/^\d{2}\/\d{2}$/.test(str)) {
    const [day, month] = str.split("/").map(Number);
    const now = new Date();
    let parsed = new Date(now.getFullYear(), month - 1, day);
    if (parsed > now) {
      parsed.setFullYear(now.getFullYear() - 1);
    }
    const diffMs = now.getTime() - parsed.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  }

  // Se for formato relógio "10:45" ou "Hoje", são 0 dias
  if (str.includes(":") || str.toLowerCase() === "hoje") {
    return 0;
  }

  // Se for "Ontem", é 1 dia
  if (str.toLowerCase() === "ontem") {
    return 1;
  }

  return 0;
}

export function ensureValentinaOperator<T extends { id: string }>(opList: T[]): T[] {
  const hasValentina = opList.some((o) => o.id === "op-valentina" || o.id === "valentina");
  if (!hasValentina) {
    const valentinaOp = {
      id: "op-valentina",
      name: "Valentina (I.A)",
      email: "valentina@valem.ai",
      avatar: "/valentina.png",
      status: "disponivel",
      passwordHash: "valentina_ai_hash",
      groupId: "group-valem-comercial",
      tenantId: "valem",
    } as unknown as T;
    return [valentinaOp, ...opList];
  }
  return opList;
}


