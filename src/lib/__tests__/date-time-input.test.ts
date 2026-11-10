// @ts-expect-error bun:test is provided by Bun runtime
import { describe, expect, it } from "bun:test";
import {
  formatBrDateFromDate,
  maskBrDateInput,
  maskTimeInput,
  parseBrDateInput,
  parseTimeInput,
} from "../date-time-input";

describe("date-time-input utilities", () => {
  it("masks numeric BR date input smoothly and supports backspace without slash traps", () => {
    let val = "";
    for (const ch of "10112026") {
      val = maskBrDateInput(val + ch, val);
    }
    expect(val).toBe("10/11/2026");

    // Backspace across slash ("10/11/2" -> delete "2" -> "10/11/" -> should become "10/11")
    expect(maskBrDateInput("10/11/", "10/11/2")).toBe("10/11");
    expect(maskBrDateInput("10/", "10/1")).toBe("10");

    // Single-digit day/month followed by manual "/" pads leading zero
    expect(maskBrDateInput("5/", "5")).toBe("05/");
    expect(maskBrDateInput("05/9/", "05/9")).toBe("05/09/");

    // ISO paste converts to BR format
    expect(maskBrDateInput("2026-11-25", "")).toBe("25/11/2026");
  });

  it("validates calendar dates strictly including leap years and 2-digit year shorthand on blur", () => {
    const valid = parseBrDateInput("10/11/2026");
    expect(valid).not.toBeNull();
    expect(formatBrDateFromDate(valid!)).toBe("10/11/2026");

    // Rejects invalid calendar dates
    expect(parseBrDateInput("31/02/2026")).toBeNull();
    expect(parseBrDateInput("29/02/2025")).toBeNull();
    expect(parseBrDateInput("32/11/2026")).toBeNull();
    expect(parseBrDateInput("10/13/2026")).toBeNull();

    // Leap year valid
    expect(parseBrDateInput("29/02/2028")).not.toBeNull();

    // 2-digit year rejected while typing, accepted on blur (allowTwoDigitYear: true)
    expect(parseBrDateInput("15/11/26", { allowTwoDigitYear: false })).toBeNull();
    const shorthand = parseBrDateInput("15/11/26", { allowTwoDigitYear: true });
    expect(shorthand).not.toBeNull();
    expect(formatBrDateFromDate(shorthand!)).toBe("15/11/2026");
  });

  it("masks 24h time input smoothly including quick single-digit hours and colons", () => {
    let val = "";
    for (const ch of "1550") {
      val = maskTimeInput(val + ch, val);
    }
    expect(val).toBe("15:50");

    // Quick 3-digit entry starting with hour 3..9 ("930" -> "09:30")
    let quick = "";
    for (const ch of "930") {
      quick = maskTimeInput(quick + ch, quick);
    }
    expect(quick).toBe("09:30");

    // Explicit colon after single digit ("9:")
    expect(maskTimeInput("9:", "9")).toBe("09:");

    // Backspace across colon ("15:5" -> delete "5" -> "15:" -> "15")
    expect(maskTimeInput("15:", "15:5")).toBe("15");
  });

  it("validates 24h time strings and normalizes shorthand on blur", () => {
    expect(parseTimeInput("00:00")).toBe("00:00");
    expect(parseTimeInput("23:59")).toBe("23:59");
    expect(parseTimeInput("24:00")).toBeNull();
    expect(parseTimeInput("15:60")).toBeNull();

    // Shorthand disabled while typing, enabled on blur/submit
    expect(parseTimeInput("9", { allowShorthand: false })).toBeNull();
    expect(parseTimeInput("9", { allowShorthand: true })).toBe("09:00");
    expect(parseTimeInput("14", { allowShorthand: true })).toBe("14:00");
    expect(parseTimeInput("14:", { allowShorthand: true })).toBe("14:00");
    expect(parseTimeInput("9:05", { allowShorthand: true })).toBe("09:05");
    expect(parseTimeInput("930", { allowShorthand: true })).toBe("09:30");
    expect(parseTimeInput("25", { allowShorthand: true })).toBeNull();
  });
});
