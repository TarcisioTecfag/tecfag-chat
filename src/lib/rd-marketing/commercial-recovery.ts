import { runtimeSingleton } from "../runtime-singleton";
import type { RdCommercialWorkerStatus } from "./sync-types";

type Dependencies = {
  listTenants: () => Promise<string[]>;
  runTenant: (tenantId: string) => Promise<{ sent: number }>;
};
const defaults: Dependencies = {
  listTenants: async () => {
    const { db } = await import("../../db");
    const { tenants } = await import("../../db/schema");
    return (await db.select({ id: tenants.id }).from(tenants)).map((row) => row.id);
  },
  runTenant: async (tenantId) =>
    (await import("./commercial-outbox")).runRdCommercialWorker(tenantId),
};
export class RdCommercialRecovery {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt: string | null = null;
  private listing = false;
  private listError: string | null = null;
  private running = new Set<string>();
  private states = new Map<string, Omit<RdCommercialWorkerStatus, "startedAt" | "running">>();
  constructor(private dependencies: Dependencies = defaults) {}
  status(tenantId: string): RdCommercialWorkerStatus {
    const state = this.states.get(tenantId);
    return {
      startedAt: this.startedAt,
      running: this.running.has(tenantId),
      lastStartedAt: null,
      lastFinishedAt: null,
      ...state,
      lastError: state?.lastError || this.listError,
    };
  }
  async processTenant(tenantId: string) {
    if (this.running.has(tenantId)) return;
    this.running.add(tenantId);
    const state = {
      lastStartedAt: new Date().toISOString(),
      lastFinishedAt: null as string | null,
      lastError: null as string | null,
    };
    this.states.set(tenantId, state);
    try {
      await this.dependencies.runTenant(tenantId);
    } catch {
      state.lastError = "O ciclo comercial falhou; as pendências foram preservadas.";
      console.error("[RD Commercial Recovery] Falha de ciclo; pendências preservadas.");
    } finally {
      state.lastFinishedAt = new Date().toISOString();
      this.running.delete(tenantId);
    }
  }
  async runCycle() {
    if (this.listing) return;
    this.listing = true;
    let ids: string[];
    try {
      ids = await this.dependencies.listTenants();
      this.listError = null;
    } catch {
      this.listError = "Não foi possível consultar os tenants para processar a fila.";
      return;
    } finally {
      this.listing = false;
    }
    await Promise.all(ids.map((tenantId) => this.processTenant(tenantId)));
  }
  start(intervalMs = 15000) {
    if (this.timer) return;
    this.startedAt = new Date().toISOString();
    console.log("[RD Commercial Recovery] Processador comercial independente iniciado.");
    void this.runCycle();
    this.timer = setInterval(() => void this.runCycle(), intervalMs);
    this.timer.unref();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.startedAt = null;
  }
}
export const rdCommercialRecovery = runtimeSingleton(
  "RdCommercialRecovery",
  () => new RdCommercialRecovery(),
);
