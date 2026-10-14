import { describe, expect, test } from "bun:test";
import { RdCommercialRecovery } from "../src/lib/rd-marketing/commercial-recovery";

describe("RD: processamento comercial independente", () => {
  test("tenant lento não bloqueia o outro nem inicia um segundo ciclo sobre si", async () => {
    let release!: () => void, notify!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const otherRan = new Promise<void>((resolve) => {
      notify = resolve;
    });
    let slowRuns = 0,
      fastRuns = 0;
    const worker = new RdCommercialRecovery({
      listTenants: async () => ["slow", "fast"],
      runTenant: async (tenantId) => {
        if (tenantId === "slow") {
          slowRuns++;
          await blocked;
        } else {
          fastRuns++;
          notify();
        }
        return { sent: 1 };
      },
    });
    const first = worker.runCycle();
    await otherRan;
    await worker.runCycle();
    expect(slowRuns).toBe(1);
    expect(fastRuns).toBe(2);
    expect(worker.status("slow").running).toBe(true);
    expect(worker.status("fast").lastFinishedAt).not.toBeNull();
    release();
    await first;
    expect(worker.status("slow").running).toBe(false);
  });
  test("falha fica visível apenas no tenant afetado sem expor dados do erro", async () => {
    const worker = new RdCommercialRecovery({
      listTenants: async () => ["broken", "healthy"],
      runTenant: async (tenantId) => {
        if (tenantId === "broken") throw Error("private-token");
        return { sent: 1 };
      },
    });
    await worker.runCycle();
    expect(worker.status("broken").lastError).toContain("pendências");
    expect(worker.status("broken").lastError).not.toContain("private-token");
    expect(worker.status("healthy").lastError).toBeNull();
    expect(worker.status("healthy").lastFinishedAt).not.toBeNull();
  });
});
