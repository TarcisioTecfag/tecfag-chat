import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isIgnorableMetaStatus,
  normalizeMetaDeliveryStatus,
} from "../src/lib/whatsapp/meta-status";

describe("meta-status normalization", () => {
  it("maps Meta delivery statuses including played -> read", () => {
    expect(normalizeMetaDeliveryStatus("sent")).toBe("accepted");
    expect(normalizeMetaDeliveryStatus("delivered")).toBe("delivered");
    expect(normalizeMetaDeliveryStatus("read")).toBe("read");
    expect(normalizeMetaDeliveryStatus("played")).toBe("read");
    expect(normalizeMetaDeliveryStatus("failed")).toBe("failed");

    expect(normalizeMetaDeliveryStatus(undefined)).toBeNull();
    expect(normalizeMetaDeliveryStatus("")).toBeNull();
    expect(normalizeMetaDeliveryStatus("deleted")).toBeNull();
    expect(normalizeMetaDeliveryStatus("warning")).toBeNull();
    expect(normalizeMetaDeliveryStatus("unknown_status")).toBeNull();
  });

  it("identifies ignorable Meta statuses without returning 500", () => {
    expect(isIgnorableMetaStatus("deleted")).toBe(true);
    expect(isIgnorableMetaStatus("warning")).toBe(true);

    expect(isIgnorableMetaStatus("sent")).toBe(false);
    expect(isIgnorableMetaStatus("delivered")).toBe(false);
    expect(isIgnorableMetaStatus("read")).toBe(false);
    expect(isIgnorableMetaStatus("played")).toBe(false);
    expect(isIgnorableMetaStatus("failed")).toBe(false);
    expect(isIgnorableMetaStatus(undefined)).toBe(false);
    expect(isIgnorableMetaStatus("weird")).toBe(false);
  });

  it("wires normalizeMetaDeliveryStatus and isIgnorableMetaStatus in meta webhook route", () => {
    const routeCode = readFileSync(
      resolve("src/routes/api/webhooks/meta.ts"),
      "utf-8",
    );
    expect(routeCode).toContain("normalizeMetaDeliveryStatus");
    expect(routeCode).toContain("isIgnorableMetaStatus");
    expect(routeCode).toContain("unprocessableItemsCount > 0");
    expect(routeCode).toContain("status: 500");
  });
});
