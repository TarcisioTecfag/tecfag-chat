import {
  BRAZIL_DDDS,
  isCorruptedNanpWith55,
  isNanpPhoneNumber,
  normalizeCanonicalPhone,
  phoneRegistrationError,
} from "./utils";

export type ContactPhoneType =
  | "commercial"
  | "personal"
  | "landline"
  | "whatsapp"
  | "financial"
  | "other";

export interface ContactPhoneTypeOption {
  value: ContactPhoneType;
  label: string;
  shortLabel: string;
}

export const CONTACT_PHONE_TYPES: ContactPhoneTypeOption[] = [
  { value: "commercial", label: "Comercial", shortLabel: "Comercial" },
  { value: "personal", label: "Pessoal", shortLabel: "Pessoal" },
  { value: "landline", label: "Telefone Fixo", shortLabel: "Fixo" },
  { value: "whatsapp", label: "WhatsApp Secundário", shortLabel: "WhatsApp" },
  { value: "financial", label: "Financeiro / Compras", shortLabel: "Financeiro" },
  { value: "other", label: "Outro / Recado", shortLabel: "Outro" },
];

export const VALID_CONTACT_PHONE_TYPES = new Set<ContactPhoneType>([
  "commercial",
  "personal",
  "landline",
  "whatsapp",
  "financial",
  "other",
]);

export interface ContactPhoneItem {
  id: string;
  contactId?: string;
  phone: string;
  phoneIdentity?: string;
  type: ContactPhoneType;
  label?: string | null;
  isPrimary: boolean;
  hasWhatsapp: boolean;
  whatsappJid?: string | null;
  whatsappUserId?: string | null;
  position: number;
}

export interface ContactPhoneInput {
  id?: string;
  phone: string;
  type?: ContactPhoneType | string | null;
  label?: string | null;
  isPrimary?: boolean;
  hasWhatsapp?: boolean;
  whatsappJid?: string | null;
  whatsappUserId?: string | null;
}

/**
 * Espelha em TypeScript a função imutável SQL `contact_phone_identity(value text)`.
 */
export function computeContactPhoneIdentity(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";

  if (isCorruptedNanpWith55(digits)) {
    return digits.slice(2);
  }

  if ((trimmed.startsWith("+") && !digits.startsWith("55")) || isNanpPhoneNumber(digits)) {
    return digits;
  }

  let national = digits;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    national = digits.slice(2);
  }

  if (national.length === 10 || national.length === 11) {
    const ddd = national.slice(0, 2);
    if (BRAZIL_DDDS.has(ddd)) {
      if (national.length === 11 && /^9[6-9]\d{7}$/.test(national.slice(2))) {
        national = ddd + national.slice(3);
      }
      if (national.length === 10 && /^[2-9]\d{7}$/.test(national.slice(2))) {
        return `55${national}`;
      }
    }
  }

  return digits;
}

export function isBrazilLandlinePhone(rawPhone: string | null | undefined): boolean {
  const canonical = normalizeCanonicalPhone(rawPhone);
  return /^55[1-9]\d[2-5]\d{7}$/.test(canonical);
}

export function inferContactPhoneType(
  rawPhone: string | null | undefined,
  explicitType?: string | null,
): ContactPhoneType {
  if (explicitType && VALID_CONTACT_PHONE_TYPES.has(explicitType as ContactPhoneType)) {
    return explicitType as ContactPhoneType;
  }
  const normalized = (explicitType || "").trim().toLowerCase();
  if (normalized === "fixo" || normalized === "residencial") return "landline";
  if (normalized === "celular" || normalized === "pessoal" || normalized === "mobile") return "personal";
  if (normalized === "comercial" || normalized === "work" || normalized === "trabalho") return "commercial";
  if (normalized === "financeiro") return "financial";
  if (normalized === "whatsapp") return "whatsapp";
  if (normalized === "outro") return "other";

  if (isBrazilLandlinePhone(rawPhone)) {
    return "landline";
  }
  return "commercial";
}

export function getContactPhoneTypeLabel(
  type?: string | null,
  customLabel?: string | null,
): string {
  if (customLabel && customLabel.trim()) {
    return customLabel.trim();
  }
  const found = CONTACT_PHONE_TYPES.find((item) => item.value === type);
  return found ? found.shortLabel : "Comercial";
}

/**
 * Normaliza e deduplica uma lista de telefones de entrada (e/ou telefone único legado),
 * garantindo exatamente 1 telefone principal (`isPrimary = true`) quando houver ao menos 1 número.
 */
export function normalizeContactPhonesInput(
  phonesInput: unknown,
  fallbackSinglePhone?: string | null,
  contactIdForIds?: string,
): {
  phones: ContactPhoneItem[];
  primaryPhone: string | null;
  validationError: string | null;
} {
  const rawList: ContactPhoneInput[] = [];

  if (Array.isArray(phonesInput)) {
    for (const entry of phonesInput) {
      if (!entry) continue;
      if (typeof entry === "string") {
        if (entry.trim()) rawList.push({ phone: entry.trim() });
      } else if (typeof entry === "object") {
        const obj = entry as Record<string, unknown>;
        const phoneStr = typeof obj.phone === "string" ? obj.phone.trim() : "";
        if (!phoneStr) continue;
        rawList.push({
          id: typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : undefined,
          phone: phoneStr,
          type: typeof obj.type === "string" ? obj.type : undefined,
          label: typeof obj.label === "string" && obj.label.trim() ? obj.label.trim().slice(0, 60) : null,
          isPrimary: obj.isPrimary === true,
          hasWhatsapp: typeof obj.hasWhatsapp === "boolean" ? obj.hasWhatsapp : undefined,
          whatsappJid: typeof obj.whatsappJid === "string" ? obj.whatsappJid : null,
          whatsappUserId: typeof obj.whatsappUserId === "string" ? obj.whatsappUserId : null,
        });
      }
    }
  }

  if (rawList.length === 0 && typeof fallbackSinglePhone === "string" && fallbackSinglePhone.trim()) {
    rawList.push({
      phone: fallbackSinglePhone.trim(),
      type: inferContactPhoneType(fallbackSinglePhone),
      isPrimary: true,
    });
  } else if (
    rawList.length > 0 &&
    typeof fallbackSinglePhone === "string" &&
    fallbackSinglePhone.trim()
  ) {
    const fallbackIdentity = computeContactPhoneIdentity(fallbackSinglePhone);
    const alreadyPresent = rawList.some(
      (item) => computeContactPhoneIdentity(item.phone) === fallbackIdentity,
    );
    if (!alreadyPresent && fallbackIdentity) {
      rawList.unshift({
        phone: fallbackSinglePhone.trim(),
        type: inferContactPhoneType(fallbackSinglePhone),
        isPrimary: !rawList.some((r) => r.isPrimary),
      });
    }
  }

  const seenIdentities = new Set<string>();
  const normalizedItems: ContactPhoneItem[] = [];

  for (let i = 0; i < rawList.length; i++) {
    const raw = rawList[i];
    const err = phoneRegistrationError(raw.phone);
    if (err) {
      return {
        phones: [],
        primaryPhone: null,
        validationError: `Telefone #${i + 1} (${raw.phone}): ${err}`,
      };
    }

    const canonical = normalizeCanonicalPhone(raw.phone);
    const identity = computeContactPhoneIdentity(canonical);
    if (!canonical || !identity) continue;

    if (seenIdentities.has(identity)) {
      continue;
    }
    seenIdentities.add(identity);

    const resolvedType = inferContactPhoneType(canonical, raw.type);
    const defaultHasWhatsapp = resolvedType !== "landline";

    normalizedItems.push({
      id:
        raw.id ||
        `cph-${contactIdForIds || "new"}-${identity.slice(-8)}-${Math.random().toString(36).slice(2, 6)}`,
      contactId: contactIdForIds,
      phone: canonical,
      phoneIdentity: identity,
      type: resolvedType,
      label: raw.label || null,
      isPrimary: raw.isPrimary === true,
      hasWhatsapp: raw.hasWhatsapp ?? defaultHasWhatsapp,
      whatsappJid: raw.whatsappJid || null,
      whatsappUserId: raw.whatsappUserId || null,
      position: normalizedItems.length,
    });
  }

  if (normalizedItems.length > 0) {
    const primaryIdx = normalizedItems.findIndex((item) => item.isPrimary);
    if (primaryIdx === -1) {
      normalizedItems[0].isPrimary = true;
    } else {
      normalizedItems.forEach((item, idx) => {
        item.isPrimary = idx === primaryIdx;
      });
    }
    // Ordena mantendo o principal primeiro na posição 0, preservando a ordem relativa dos demais
    normalizedItems.sort((a, b) => (a.isPrimary === b.isPrimary ? a.position - b.position : a.isPrimary ? -1 : 1));
    normalizedItems.forEach((item, idx) => {
      item.position = idx;
    });
  }

  const primaryPhone = normalizedItems.find((item) => item.isPrimary)?.phone ?? null;

  return {
    phones: normalizedItems,
    primaryPhone,
    validationError: null,
  };
}
