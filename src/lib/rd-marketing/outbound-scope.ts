import { rdPhoneDigits } from "./sync-identity";
import type { RdOutboundScope, RdTestContact } from "./sync-types";

type Config = { outboundScope: RdOutboundScope; testContact: RdTestContact | null };
export function normalizeRdContactUuid(value: string): string {
  let uuid = value
    .replace(/[\u200B\uFEFF]/g, "")
    .trim()
    .replace(/^uuid\s*:\s*/i, "")
    .trim();
  if ((uuid.startsWith('"') && uuid.endsWith('"')) || (uuid.startsWith("'") && uuid.endsWith("'")))
    uuid = uuid.slice(1, -1).trim();
  return uuid.replace(/[\u2010-\u2014\u2212]/g, "-").toLowerCase();
}
export function rdTestContactUuidError(value: string, required: boolean): string | null {
  const uuid = normalizeRdContactUuid(value);
  if (!uuid)
    return required ? "Informe o UUID do contato de teste antes de ativar os envios." : null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) return null;
  if (/^\d+$/.test(uuid))
    return "Um número sozinho não é um UUID. Consulte seu e-mail em ‘Conferir o histórico de um lead’ e copie o campo UUID, com letras, números e hífens.";
  if (uuid.length !== 36)
    return `UUID com ${uuid.length} caracteres; são necessários 36. Copie novamente o UUID completo usando ‘Copiar UUID’ na consulta do lead.`;
  return "UUID inválido. Copie o campo UUID da consulta do lead: ele tem 36 caracteres, incluindo os hífens.";
}
export function permitsRdRecipient(
  config: Config,
  payload: Record<string, unknown>,
  uuid: string | null,
) {
  if (config.outboundScope === "all") return true;
  const target = config.testContact;
  if (config.outboundScope !== "test" || !target?.uuid) return false;
  // A known UUID always wins; a shared phone/email must never override another lead's binding.
  if (uuid) return uuid.toLowerCase() === target.uuid.toLowerCase();
  if (typeof payload.email === "string" && payload.email.trim())
    return payload.email.trim().toLowerCase() === target.email?.trim().toLowerCase();
  const phone = typeof payload.phone === "string" ? rdPhoneDigits(payload.phone) : "";
  return !!phone && !!target.phone && phone === rdPhoneDigits(target.phone);
}
