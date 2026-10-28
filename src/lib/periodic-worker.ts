import { runtimeSingleton } from "./runtime-singleton";

type WorkerState = {
  running: boolean;
  lastStartedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
};
const workers = runtimeSingleton(
  "PeriodicWorkers",
  () => new Map<string, { stop: () => void; state: WorkerState }>(),
);

/** Shared across server chunks; no overlapping cycles and no restart after shutdown. */
export function startPeriodicWorker(name: string, run: () => Promise<void>, intervalMs: number) {
  const existing = workers.get(name);
  if (existing) return existing.stop;
  const state: WorkerState = {
    running: false,
    lastStartedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
  };
  let stopped = false;
  const tick = async () => {
    if (stopped || state.running) return;
    state.running = true;
    state.lastStartedAt = new Date().toISOString();
    try {
      await run();
      state.lastSucceededAt = new Date().toISOString();
    } catch {
      state.lastFailedAt = new Date().toISOString();
      console.error(`[Worker:${name}] Ciclo falhou; trabalho persistido será retomado.`);
    } finally {
      state.running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    if (workers.get(name)?.stop === stop) workers.delete(name);
  };
  workers.set(name, { stop, state });
  console.log(`[Worker:${name}] Iniciado (intervalo ${intervalMs}ms).`);
  void tick();
  return stop;
}

export function getPeriodicWorkerState(name: string): WorkerState | null {
  const worker = workers.get(name);
  return worker ? { ...worker.state } : null;
}
