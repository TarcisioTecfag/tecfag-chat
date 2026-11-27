const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

const SAO_PAULO_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export class DealClosedAtValidationError extends Error {
  readonly code: string;

  constructor(message: string, code = "INVALID_CLOSED_AT") {
    super(message);
    this.name = "DealClosedAtValidationError";
    this.code = code;
  }
}

/**
 * Formata um Date ou string ISO para chave de dia civil em America/Sao_Paulo (YYYY-MM-DD).
 */
export function formatDateKeySaoPaulo(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (DATE_ONLY_REGEX.test(trimmed)) return trimmed;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return SAO_PAULO_DATE_FORMATTER.format(date);
}

/**
 * Valida e converte entrada de data de fechamento real (`closedAt`).
 * - Strings apenas de data (`YYYY-MM-DD`) são normalizadas para `T15:00:00.000Z` (12:00 BRT),
 *   garantindo o mesmo dia civil tanto em UTC quanto em `America/Sao_Paulo`.
 * - Rejeita datas inválidas, anteriores ao ano 2000 ou futuras em relação à data atual BRT.
 */
export function parseDealClosedAtInput(raw: unknown, now: Date = new Date()): Date {
  let parsed: Date;

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      throw new DealClosedAtValidationError(
        "Data de fechamento inválida. Use o formato YYYY-MM-DD ou ISO 8601.",
        "INVALID_CLOSED_AT",
      );
    }
    parsed = new Date(raw.getTime());
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new DealClosedAtValidationError(
        "Informe uma data de fechamento válida (YYYY-MM-DD ou ISO 8601).",
        "INVALID_CLOSED_AT",
      );
    }
    const dateOnlyMatch = trimmed.match(DATE_ONLY_REGEX);
    if (dateOnlyMatch) {
      const year = Number(dateOnlyMatch[1]);
      const month = Number(dateOnlyMatch[2]);
      const day = Number(dateOnlyMatch[3]);
      const candidate = new Date(Date.UTC(year, month - 1, day, 15, 0, 0, 0));
      if (
        Number.isNaN(candidate.getTime()) ||
        candidate.getUTCFullYear() !== year ||
        candidate.getUTCMonth() + 1 !== month ||
        candidate.getUTCDate() !== day
      ) {
        throw new DealClosedAtValidationError(
          `Data de fechamento inválida: '${trimmed}'.`,
          "INVALID_CLOSED_AT",
        );
      }
      parsed = candidate;
    } else {
      const candidate = new Date(trimmed);
      if (Number.isNaN(candidate.getTime())) {
        throw new DealClosedAtValidationError(
          `Data de fechamento inválida: '${trimmed}'. Use formato YYYY-MM-DD ou ISO 8601.`,
          "INVALID_CLOSED_AT",
        );
      }
      parsed = candidate;
    }
  } else {
    throw new DealClosedAtValidationError(
      "A data de fechamento deve ser uma data válida (YYYY-MM-DD ou ISO 8601).",
      "INVALID_CLOSED_AT",
    );
  }

  if (parsed.getUTCFullYear() < 2000) {
    throw new DealClosedAtValidationError(
      "A data de fechamento deve ser igual ou posterior ao ano 2000.",
      "INVALID_CLOSED_AT",
    );
  }

  const targetDay = formatDateKeySaoPaulo(parsed);
  const todayBrt = formatDateKeySaoPaulo(now);
  if (targetDay && todayBrt && targetDay > todayBrt) {
    throw new DealClosedAtValidationError(
      "A data de fechamento não pode ser futura.",
      "FUTURE_CLOSED_AT_NOT_ALLOWED",
    );
  }

  return parsed;
}

/**
 * Identifica quando o payload de PATCH /api/crm/deals/:dealId representa uma edição
 * manual/explícita de data de fechamento (restrita a administradores), preservando
 * 100% de compatibilidade com os botões padrão de Ganho/Perda/Reabrir do modal que
 * enviam `status` + `closedAt` automaticamente.
 */
export function isExplicitClosedAtRequest(body: {
  closedAt?: unknown;
  closedAtExplicit?: unknown;
  status?: unknown;
}): boolean {
  return (
    body.closedAt !== undefined && (body.closedAtExplicit === true || body.status === undefined)
  );
}

/**
 * Só permite sobrescrever manualmente `closedAt` quando a negociação está ganha,
 * perdida ou em etapa comercial de fechamento (`effectiveWin`).
 */
export function canApplyExplicitClosedAt(params: {
  finalStatus: string;
  effectiveWin: boolean;
}): boolean {
  return params.finalStatus === "won" || params.finalStatus === "lost" || params.effectiveWin;
}

/**
 * Resolve de forma atômica `closedAt`, `wonAt` e `lostAt` preservando o comportamento
 * existente quando `explicitClosedAt` não é informado e sincronizando os carimbos de
 * fechamento e ganho/perda quando uma data explícita é aplicada.
 */
export function resolveDealClosureTimestamps(params: {
  finalStatus: string;
  effectiveWin: boolean;
  explicitClosedAt?: Date;
  currentClosedAt: Date | null;
  currentWonAt: Date | null;
  currentLostAt: Date | null;
  pendingClosedAt?: Date | null;
  now: Date;
}): {
  closedAt?: Date | null;
  wonAt?: Date | null;
  lostAt?: Date | null;
} {
  const {
    finalStatus,
    effectiveWin,
    explicitClosedAt,
    currentWonAt,
    currentLostAt,
    pendingClosedAt,
    now,
  } = params;

  if (explicitClosedAt !== undefined) {
    if (!canApplyExplicitClosedAt({ finalStatus, effectiveWin })) {
      throw new DealClosedAtValidationError(
        "A data de fechamento só pode ser alterada em negociações ganhas, perdidas ou em etapa de fechamento.",
        "INVALID_CLOSED_AT_STATUS",
      );
    }

    if (finalStatus === "lost") {
      return {
        closedAt: explicitClosedAt,
        lostAt: explicitClosedAt,
        wonAt: null,
      };
    }

    return {
      closedAt: explicitClosedAt,
      wonAt: explicitClosedAt,
      lostAt: null,
    };
  }

  if (finalStatus === "lost") {
    return {
      lostAt: currentLostAt ?? pendingClosedAt ?? now,
      wonAt: null,
    };
  }

  if (effectiveWin) {
    return {
      wonAt: currentWonAt ?? pendingClosedAt ?? now,
      lostAt: null,
    };
  }

  if (finalStatus === "open") {
    const out: { wonAt?: null; lostAt?: null } = {};
    if (currentWonAt !== null) out.wonAt = null;
    if (currentLostAt !== null) out.lostAt = null;
    return out;
  }

  return {};
}
