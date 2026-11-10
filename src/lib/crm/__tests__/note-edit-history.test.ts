// @ts-expect-error bun:test is provided by Bun runtime
import { describe, expect, test } from "bun:test";
import { formatDealEvent } from "../deal-event-format";

describe("CRM Note Edit History & Event Formatting", () => {
  test("formats note_updated deal event with editor name and cumulative edit count", () => {
    const formatted = formatDealEvent(
      {
        eventType: "note_updated",
        metadata: {
          activityId: "act-123",
          activityTitle: "Anotação",
          editedByName: "Adriano Ordonho",
          editCount: 3,
        },
      },
      new Map(),
      new Map()
    );

    expect(formatted.title).toBe("Anotação editada");
    expect(formatted.description).toBe("Por: Adriano Ordonho · Edição #3");
  });

  test("cumulative editHistory preserves all edits in chronological order without overwriting", () => {
    type EditEntry = { editedAt: string; operatorId: string | null; operatorName: string };
    let history: EditEntry[] = [];

    const appendEdit = (operatorId: string, operatorName: string, editedAt: string) => {
      history = [...history, { editedAt, operatorId, operatorName }];
    };

    appendEdit("op-1", "Adriano Ordonho", "2026-11-10T17:18:00.000Z");
    expect(history).toHaveLength(1);

    appendEdit("op-2", "João Lanza", "2026-11-10T17:45:00.000Z");
    expect(history).toHaveLength(2);

    appendEdit("op-1", "Adriano Ordonho", "2026-11-10T18:10:00.000Z");
    expect(history).toHaveLength(3);

    expect(history.map((h) => h.operatorName)).toEqual([
      "Adriano Ordonho",
      "João Lanza",
      "Adriano Ordonho",
    ]);
  });
});
