import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export const SECONDARY_EMAILS_CUSTOM_FIELD_KEY = "secondaryEmails";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmailAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned || cleaned.length > 254 || !EMAIL_RE.test(cleaned)) return null;
  return cleaned;
}

export function splitRawEmails(raw: unknown): string[] {
  const candidates: string[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === "string") {
        candidates.push(...entry.split(/[;,]+/));
      } else if (entry && typeof entry === "object" && "email" in entry) {
        const val = (entry as { email?: unknown }).email;
        if (typeof val === "string") candidates.push(...val.split(/[;,]+/));
      }
    }
  } else if (typeof raw === "string") {
    candidates.push(...raw.split(/[;,]+/));
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of candidates) {
    const email = normalizeEmailAddress(item);
    if (email && !seen.has(email)) {
      seen.add(email);
      normalized.push(email);
    }
  }
  return normalized;
}

export function extractContactEmails(
  primaryEmail: string | null | undefined,
  customFields: Record<string, unknown> | null | undefined,
): {
  primaryEmail: string | null;
  secondaryEmails: string[];
  allEmails: string[];
} {
  const fromPrimary = splitRawEmails(primaryEmail);
  const cf =
    customFields && typeof customFields === "object" && !Array.isArray(customFields)
      ? customFields
      : {};
  const fromSecondary = splitRawEmails(cf[SECONDARY_EMAILS_CUSTOM_FIELD_KEY]);

  const seen = new Set<string>();
  const allEmails: string[] = [];
  for (const email of [...fromPrimary, ...fromSecondary]) {
    if (!seen.has(email)) {
      seen.add(email);
      allEmails.push(email);
    }
  }

  return {
    primaryEmail: allEmails[0] ?? null,
    secondaryEmails: allEmails.slice(1),
    allEmails,
  };
}

/**
 * Mescla um ou mais e-mails recebidos (ex.: via RD Marketing ou enriquecimento)
 * preservando o e-mail principal existente e armazenando todos os novos e-mails
 * em `customFields.secondaryEmails` sem nunca descartar nenhum endereço.
 */
export function mergeContactEmails(
  existingPrimary: string | null | undefined,
  existingCustomFields: Record<string, unknown> | null | undefined,
  incoming: unknown,
): {
  primaryEmail: string | null;
  secondaryEmails: string[];
  allEmails: string[];
  customFields: Record<string, unknown>;
  addedEmails: string[];
} {
  const base = extractContactEmails(existingPrimary, existingCustomFields);
  const incomingList = splitRawEmails(incoming);

  const seen = new Set<string>(base.allEmails);
  const allEmails = [...base.allEmails];
  const addedEmails: string[] = [];

  for (const email of incomingList) {
    if (!seen.has(email)) {
      seen.add(email);
      allEmails.push(email);
      addedEmails.push(email);
    }
  }

  const primaryEmail = allEmails[0] ?? null;
  const secondaryEmails = allEmails.slice(1);
  const nextCustomFields: Record<string, unknown> = {
    ...(existingCustomFields && typeof existingCustomFields === "object" && !Array.isArray(existingCustomFields)
      ? existingCustomFields
      : {}),
  };

  if (secondaryEmails.length > 0) {
    nextCustomFields[SECONDARY_EMAILS_CUSTOM_FIELD_KEY] = secondaryEmails;
  } else {
    delete nextCustomFields[SECONDARY_EMAILS_CUSTOM_FIELD_KEY];
  }

  return {
    primaryEmail,
    secondaryEmails,
    allEmails,
    customFields: nextCustomFields,
    addedEmails,
  };
}

/**
 * Normaliza entrada explícita de edição de múltiplos e-mails (ex.: POST/PATCH /api/contacts).
 * Valida cada item não vazio; retorna erro descritivo caso algum e-mail seja inválido.
 */
export function normalizeContactEmailsInput(
  emailsInput: unknown,
  fallbackPrimaryEmail?: string | null,
  existingCustomFields?: Record<string, unknown> | null,
): {
  primaryEmail: string | null;
  secondaryEmails: string[];
  allEmails: string[];
  customFields: Record<string, unknown>;
  validationError?: string;
} {
  const rawItems: string[] = [];
  if (Array.isArray(emailsInput)) {
    for (const item of emailsInput) {
      const text =
        typeof item === "string"
          ? item
          : item && typeof item === "object" && "email" in item && typeof (item as any).email === "string"
            ? (item as any).email
            : "";
      for (const part of text.split(/[;,]+/)) {
        const trimmed = part.trim();
        if (trimmed) rawItems.push(trimmed);
      }
    }
  } else if (typeof fallbackPrimaryEmail === "string" && fallbackPrimaryEmail.trim()) {
    for (const part of fallbackPrimaryEmail.split(/[;,]+/)) {
      const trimmed = part.trim();
      if (trimmed) rawItems.push(trimmed);
    }
  }

  const seen = new Set<string>();
  const allEmails: string[] = [];
  for (const raw of rawItems) {
    const normalized = normalizeEmailAddress(raw);
    if (!normalized) {
      return {
        primaryEmail: null,
        secondaryEmails: [],
        allEmails: [],
        customFields: {
          ...(existingCustomFields && typeof existingCustomFields === "object" && !Array.isArray(existingCustomFields)
            ? existingCustomFields
            : {}),
        },
        validationError: `E-mail inválido: "${raw}".`,
      };
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      allEmails.push(normalized);
    }
  }

  const primaryEmail = allEmails[0] ?? null;
  const secondaryEmails = allEmails.slice(1);
  const nextCustomFields: Record<string, unknown> = {
    ...(existingCustomFields && typeof existingCustomFields === "object" && !Array.isArray(existingCustomFields)
      ? existingCustomFields
      : {}),
  };

  if (secondaryEmails.length > 0) {
    nextCustomFields[SECONDARY_EMAILS_CUSTOM_FIELD_KEY] = secondaryEmails;
  } else {
    delete nextCustomFields[SECONDARY_EMAILS_CUSTOM_FIELD_KEY];
  }

  return {
    primaryEmail,
    secondaryEmails,
    allEmails,
    customFields: nextCustomFields,
  };
}

/**
 * Condição SQL segura para busca exata (case-insensitive) em `contacts.email`
 * ou em qualquer entrada do array JSONB `contacts.custom_fields->'secondaryEmails'`.
 */
export function buildContactExactEmailSql(
  emailCol: AnyPgColumn,
  customFieldsCol: AnyPgColumn,
  normalizedEmail: string,
): SQL {
  return sql`(
    lower(coalesce(${emailCol}, '')) = ${normalizedEmail}
    OR (
      jsonb_typeof(${customFieldsCol}->'secondaryEmails') = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(${customFieldsCol}->'secondaryEmails') AS sec_email(val)
        WHERE lower(sec_email.val) = ${normalizedEmail}
      )
    )
  )`;
}

/**
 * Condição SQL segura para busca parcial (ILIKE) em `contacts.custom_fields->'secondaryEmails'`.
 */
export function buildContactSecondaryEmailSearchSql(
  customFieldsCol: AnyPgColumn,
  pattern: string,
): SQL {
  return sql`(
    jsonb_typeof(${customFieldsCol}->'secondaryEmails') = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(${customFieldsCol}->'secondaryEmails') AS sec_email(val)
      WHERE sec_email.val ILIKE ${pattern}
    )
  )`;
}
