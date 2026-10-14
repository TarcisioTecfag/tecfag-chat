import { describe, expect, test } from "bun:test";
import { journeyEventKey } from "../src/lib/rd-marketing/journey";
import { mergeJourney } from "../src/hooks/useRdMarketingJourney";
import type { RdJourney } from "../src/lib/rd-marketing/journey-types";

describe("Jornada RD: identidade e paginação", () => {
  test("chave é estável sem inventar um ID de evento a partir do UUID do contato", () => {
    expect(
      journeyEventKey(
        { id: null, raw: { payload: { source: "google", campaign: "oferta" }, date: "a" } },
        "CONVERSION",
      ),
    ).toBe(
      journeyEventKey(
        { id: null, raw: { date: "a", payload: { campaign: "oferta", source: "google" } } },
        "CONVERSION",
      ),
    );
    expect(
      journeyEventKey({ id: "lead-id", raw: { uuid: "lead-id", date: "a" } }, "CONVERSION"),
    ).not.toBe(
      journeyEventKey({ id: "lead-id", raw: { uuid: "lead-id", date: "b" } }, "CONVERSION"),
    );
  });
  test("merge remove repetições de páginas, respeita contato e reinicia snapshots atualizados", () => {
    const initial: RdJourney = {
      contactId: "contact-a",
      contactName: "A",
      snapshotId: "snapshot-a",
      syncedAt: "2026-10-14T10:00:00Z",
      cached: false,
      pages: [],
      events: [
        {
          key: "event-1",
          id: null,
          identifier: "form",
          date: null,
          source: null,
          campaign: null,
          links: [],
          raw: {},
          deals: [],
          eventType: "CONVERSION",
        },
      ],
    };
    const second = {
      ...initial,
      events: [...initial.events, { ...initial.events[0], key: "event-2" }],
    };
    expect(mergeJourney(initial, second).events).toHaveLength(2);
    expect(
      mergeJourney(initial, { ...second, contactId: "contact-b", events: [] }).events,
    ).toHaveLength(0);
    expect(
      mergeJourney(initial, { ...second, snapshotId: "snapshot-b", events: [] }).events,
    ).toHaveLength(0);
  });
});
