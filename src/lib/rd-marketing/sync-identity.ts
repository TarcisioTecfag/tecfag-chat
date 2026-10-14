import { normalizeCanonicalPhone } from "../utils";

// Preserve an explicit international prefix, including non-Brazilian numbers.
export function rdPhoneDigits(value: string) {
  return value.trim().startsWith("+") ? value.replace(/\D/g, "") : normalizeCanonicalPhone(value);
}
