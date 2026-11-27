import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  DealClosedAtValidationError,
  canApplyExplicitClosedAt,
  formatDateKeySaoPaulo,
  isExplicitClosedAtRequest,
  parseDealClosedAtInput,
  resolveDealClosureTimestamps,
} from "../src/lib/crm/closed-at-policy";
import { formatDealEvent } from "../src/lib/crm/deal-event-format";

describe("CRM deal closedAt policy & synchronization", () => {
  const referenceNow = new Date("2026-11-27T12:00:00.000Z"); // 27/11/2026 09:00 BRT

  it("normalizes YYYY-MM-DD to midday BRT (15:00Z) so UTC and America/Sao_Paulo match the exact day", () => {
    const parsed = parseDealClosedAtInput("2026-10-21", referenceNow);
    expect(parsed.toISOString()).toBe("2026-10-21T15:00:00.000Z");
    expect(parsed.toISOString().slice(0, 10)).toBe("2026-10-21");
    expect(formatDateKeySaoPaulo(parsed)).toBe("2026-10-21");
  });

  it("accepts valid ISO timestamps in the past and today BRT", () => {
    const sameDay = parseDealClosedAtInput("2026-11-27", referenceNow);
    expect(formatDateKeySaoPaulo(sameDay)).toBe("2026-11-27");

    const isoPast = parseDealClosedAtInput("2026-10-21T16:30:00-03:00", referenceNow);
    expect(formatDateKeySaoPaulo(isoPast)).toBe("2026-10-21");
  });

  it("rejects future dates, invalid calendar dates, empty values, and pre-2000 dates", () => {
    expect(() => parseDealClosedAtInput("2026-11-28", referenceNow)).toThrow(
      DealClosedAtValidationError,
    );
    expect(() => parseDealClosedAtInput("2026-02-30", referenceNow)).toThrow(
      DealClosedAtValidationError,
    );
    expect(() => parseDealClosedAtInput("", referenceNow)).toThrow(DealClosedAtValidationError);
    expect(() => parseDealClosedAtInput("1999-12-31", referenceNow)).toThrow(
      DealClosedAtValidationError,
    );
    expect(() => parseDealClosedAtInput("not-a-date", referenceNow)).toThrow(
      DealClosedAtValidationError,
    );
  });

  it("distinguishes explicit admin closedAt edits from standard UI status transitions", () => {
    // Non-admin clicking Ganho / Perdido / Reabrir sends status + closedAt without closedAtExplicit
    expect(isExplicitClosedAtRequest({ status: "won", closedAt: "2026-11-27T12:00:00.000Z" })).toBe(
      false,
    );
    expect(
      isExplicitClosedAtRequest({ status: "lost", closedAt: "2026-11-27T12:00:00.000Z" }),
    ).toBe(false);
    expect(isExplicitClosedAtRequest({ status: "open", closedAt: null })).toBe(false);

    // Direct closedAt edit (without status) or explicit flag requires admin
    expect(isExplicitClosedAtRequest({ closedAt: "2026-10-21" })).toBe(true);
    expect(
      isExplicitClosedAtRequest({
        status: "won",
        closedAt: "2026-10-21",
        closedAtExplicit: true,
      }),
    ).toBe(true);
    expect(isExplicitClosedAtRequest({ title: "Apenas titulo" })).toBe(false);
  });

  it("synchronizes both closedAt and wonAt when retroacting a won deal", () => {
    const oct21 = parseDealClosedAtInput("2026-10-21", referenceNow);
    const nov12 = new Date("2026-11-12T13:25:24.374Z");

    const resolved = resolveDealClosureTimestamps({
      finalStatus: "won",
      effectiveWin: true,
      explicitClosedAt: oct21,
      currentClosedAt: nov12,
      currentWonAt: nov12,
      currentLostAt: null,
      now: referenceNow,
    });

    expect(resolved.closedAt?.toISOString()).toBe("2026-10-21T15:00:00.000Z");
    expect(resolved.wonAt?.toISOString()).toBe("2026-10-21T15:00:00.000Z");
    expect(resolved.lostAt).toBeNull();
  });

  it("synchronizes both closedAt and lostAt when editing a lost deal", () => {
    const oct21 = parseDealClosedAtInput("2026-10-21", referenceNow);
    const nov12 = new Date("2026-11-12T13:25:24.374Z");

    const resolved = resolveDealClosureTimestamps({
      finalStatus: "lost",
      effectiveWin: false,
      explicitClosedAt: oct21,
      currentClosedAt: nov12,
      currentWonAt: null,
      currentLostAt: nov12,
      now: referenceNow,
    });

    expect(resolved.closedAt?.toISOString()).toBe("2026-10-21T15:00:00.000Z");
    expect(resolved.lostAt?.toISOString()).toBe("2026-10-21T15:00:00.000Z");
    expect(resolved.wonAt).toBeNull();
  });

  it("allows explicit closedAt for open deals in commercial win stage (effectiveWin=true) and rejects normal open/paused deals", () => {
    const oct21 = parseDealClosedAtInput("2026-10-21", referenceNow);

    expect(canApplyExplicitClosedAt({ finalStatus: "open", effectiveWin: true })).toBe(true);
    expect(canApplyExplicitClosedAt({ finalStatus: "open", effectiveWin: false })).toBe(false);
    expect(canApplyExplicitClosedAt({ finalStatus: "paused", effectiveWin: false })).toBe(false);

    expect(() =>
      resolveDealClosureTimestamps({
        finalStatus: "open",
        effectiveWin: false,
        explicitClosedAt: oct21,
        currentClosedAt: null,
        currentWonAt: null,
        currentLostAt: null,
        now: referenceNow,
      }),
    ).toThrow(DealClosedAtValidationError);
  });

  it("preserves legacy behavior when explicitClosedAt is not provided", () => {
    const nov12 = new Date("2026-11-12T13:25:24.374Z");
    const keepWon = resolveDealClosureTimestamps({
      finalStatus: "won",
      effectiveWin: true,
      currentClosedAt: nov12,
      currentWonAt: nov12,
      currentLostAt: null,
      now: referenceNow,
    });
    expect(keepWon.wonAt?.toISOString()).toBe(nov12.toISOString());
    expect(keepWon.closedAt).toBeUndefined();

    const reopened = resolveDealClosureTimestamps({
      finalStatus: "open",
      effectiveWin: false,
      currentClosedAt: nov12,
      currentWonAt: nov12,
      currentLostAt: null,
      now: referenceNow,
    });
    expect(reopened.wonAt).toBeNull();
  });

  it("formats closed_at_changed audit events in PT-BR with reason", () => {
    const formatted = formatDealEvent(
      {
        eventType: "closed_at_changed",
        metadata: {
          fromDate: "2026-11-12",
          toDate: "2026-10-21",
          reason: "Ajuste Nexct x CRM (NF 0079138)",
        },
      },
      new Map(),
      new Map(),
    );
    expect(formatted.title).toBe("Data de fechamento alterada para 21/10/2026");
    expect(formatted.description).toBe(
      "Antes: 12/11/2026 · Motivo: Ajuste Nexct x CRM (NF 0079138)",
    );
  });

  it("guards API route admin-only enforcement and Design System compliance in UI", () => {
    const root = path.resolve(import.meta.dir, "..");
    const routeSource = fs.readFileSync(
      path.join(root, "src/routes/api/crm/deals/$dealId.ts"),
      "utf8",
    );
    expect(routeSource).toContain("isExplicitClosedAtRequest(body)");
    expect(routeSource).toContain('session.operator.role !== "admin"');

    const modalSource = fs.readFileSync(
      path.join(root, "src/components/crm/DealDetailModal.tsx"),
      "utf8",
    );
    expect(modalSource).toContain("Data de Fechamento");
    expect(modalSource).toContain("closedAtExplicit: true");
    expect(modalSource).not.toContain('<input type="date"');
  });
});
