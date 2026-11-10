/**
 * Utilitários de máscara, formatação e validação inteligente para entradas
 * digitáveis de Data (DD/MM/AAAA) e Horário (HH:mm) em conjunto com Popovers
 * customizados do Design System (sem uso de inputs nativos date/time).
 */

export function formatBrDateFromDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  return `${day}/${month}/${year}`;
}

export function formatYmdFromDate(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Aplica máscara amigável de data brasileira (DD/MM/AAAA) durante a digitação,
 * suportando:
 * - Digitação apenas de números ("10112026" -> "10/11/2026")
 * - Digitação com barras ("5/9/2026" -> "05/09/2026")
 * - Colagem de formato ISO ("2026-11-10" -> "10/11/2026")
 * - Backspace fluido sem travar nas barras "/"
 */
export function maskBrDateInput(rawValue: string, prevValue = ""): string {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";

  // Suporte a colagem ISO YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  const isDeleting = rawValue.length < prevValue.length;

  // Se o usuário digitou "/" logo após 1 dígito de dia ("5/") ou de mês ("05/9/"), completa com zero à esquerda
  if (!isDeleting) {
    const singleDaySlash = trimmed.match(/^(\d)\/$/);
    if (singleDaySlash) {
      return `0${singleDaySlash[1]}/`;
    }
    const singleMonthSlash = trimmed.match(/^(\d{2})\/(\d)\/$/);
    if (singleMonthSlash) {
      return `${singleMonthSlash[1]}/0${singleMonthSlash[2]}/`;
    }
  }

  const digits = trimmed.replace(/\D/g, "").slice(0, 8);
  if (!digits) return "";

  if (!isDeleting && trimmed.endsWith("/")) {
    if (digits.length === 2) return `${digits}/`;
    if (digits.length === 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/`;
  }

  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
}

/**
 * Valida e converte uma string DD/MM/AAAA (ou DD/MM/AA quando allowTwoDigitYear = true)
 * para um objeto Date local válido (rejeitando datas inexistentes como 31/02/2026).
 */
export function parseBrDateInput(
  value: string,
  options?: { allowTwoDigitYear?: boolean },
): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    return buildValidatedLocalDate(year, month, day);
  }

  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const yearRaw = match[3];

  let year: number;
  if (yearRaw.length === 2) {
    if (!options?.allowTwoDigitYear) return null;
    year = 2000 + parseInt(yearRaw, 10);
  } else {
    year = parseInt(yearRaw, 10);
  }

  return buildValidatedLocalDate(year, month, day);
}

function buildValidatedLocalDate(year: number, month: number, day: number): Date | null {
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const candidate = new Date(year, month - 1, day);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }
  return candidate;
}

/**
 * Aplica máscara inteligente de horário 24h (HH:mm) durante a digitação,
 * suportando:
 * - Digitação de 4 dígitos ("1550" -> "15:50", "0930" -> "09:30")
 * - Digitação rápida de hora de 1 dígito >= 3 seguida de minuto ("930" -> "09:30")
 * - Digitação com dois-pontos ("9:30" -> "09:30")
 * - Backspace fluido sem travar no ":"
 */
export function maskTimeInput(rawValue: string, prevValue = ""): string {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";

  const isDeleting = rawValue.length < prevValue.length;

  // Se o usuário digitou ":" após 1 dígito ("9:"), preenche zero à esquerda ("09:")
  if (!isDeleting) {
    const singleHourColon = trimmed.match(/^(\d):$/);
    if (singleHourColon) {
      return `0${singleHourColon[1]}:`;
    }
  }

  const digits = trimmed.replace(/\D/g, "").slice(0, 4);
  if (!digits) return "";

  if (!isDeleting && trimmed.endsWith(":") && digits.length === 2) {
    return `${digits}:`;
  }

  // Atalho ergonômico: horas 03..09 digitadas sem zero à esquerda (ex: "93" -> "09:3", "930" -> "09:30")
  if (!isDeleting && digits.length >= 2) {
    const firstDigit = parseInt(digits[0], 10);
    const secondDigit = parseInt(digits[1], 10);
    if (firstDigit >= 3 && secondDigit <= 5) {
      const paddedDigits = `0${digits}`.slice(0, 4);
      return `${paddedDigits.slice(0, 2)}:${paddedDigits.slice(2)}`;
    }
  }

  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
}

/**
 * Valida e normaliza uma string de horário para "HH:mm" (00:00 a 23:59).
 * Quando allowShorthand = true (ex: onBlur / submit), aceita atalhos como:
 * - "9" -> "09:00"
 * - "14" -> "14:00"
 * - "14:" -> "14:00"
 * - "9:30" -> "09:30"
 * - "930" -> "09:30"
 */
export function parseTimeInput(
  value: string,
  options?: { allowShorthand?: boolean },
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const strictMatch = trimmed.match(/^(\d{2}):(\d{2})$/);
  if (strictMatch) {
    const h = parseInt(strictMatch[1], 10);
    const m = parseInt(strictMatch[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
    return null;
  }

  if (!options?.allowShorthand) return null;

  const colonMatch = trimmed.match(/^(\d{1,2}):(\d{2})?$/);
  if (colonMatch) {
    const h = parseInt(colonMatch[1], 10);
    const m = colonMatch[2] ? parseInt(colonMatch[2], 10) : 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
    return null;
  }

  const onlyDigits = trimmed.match(/^(\d{1,4})$/);
  if (onlyDigits) {
    const d = onlyDigits[1];
    if (d.length <= 2) {
      const h = parseInt(d, 10);
      if (h >= 0 && h <= 23) {
        return `${String(h).padStart(2, "0")}:00`;
      }
      return null;
    }
    if (d.length === 3) {
      const h = parseInt(d[0], 10);
      const m = parseInt(d.slice(1, 3), 10);
      if (h >= 0 && h <= 9 && m >= 0 && m <= 59) {
        return `0${h}:${String(m).padStart(2, "0")}`;
      }
      return null;
    }
    if (d.length === 4) {
      const h = parseInt(d.slice(0, 2), 10);
      const m = parseInt(d.slice(2, 4), 10);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      }
      return null;
    }
  }

  return null;
}
