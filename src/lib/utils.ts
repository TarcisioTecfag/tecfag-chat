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

  // Se for grupo Baileys (inicia com 1203 ou contém "-" ou tem comprimento de dígitos >= 14)
  if (phone.includes("-") || phone.startsWith("1203") || clean.replace(/-/g, "").length >= 14) {
    const cleanDigits = clean.replace(/-/g, "");
    
    // Se tiver comprimento >= 14, tentar separar o telefone do criador do timestamp
    if (cleanDigits.length >= 14 && !phone.includes("-")) {
      let creator = "";
      if (cleanDigits.length === 14) {
        creator = cleanDigits.slice(0, 9);
      } else if (cleanDigits.length === 15) {
        creator = cleanDigits.slice(0, 10);
      } else if (cleanDigits.length === 16) {
        creator = cleanDigits.slice(0, 11);
      } else {
        creator = cleanDigits.slice(0, 11);
      }
      return `Grupo (Criador: ${formatPhoneNumber(creator)})`;
    }
    
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
  
  // Se for número curto ou normal internacional (comprimento entre 8 e 13 dígitos)
  if (clean.length >= 8 && clean.length <= 13) {
    return `+${clean}`;
  }
  
  return phone;
}
