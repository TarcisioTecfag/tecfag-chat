import { rdPhoneDigits } from "./sync-identity";
import type { RdOutboundScope, RdTestContact } from "./sync-types";

type Config = { outboundScope: RdOutboundScope; testContact: RdTestContact | null };
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
