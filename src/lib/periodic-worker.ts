import { runtimeSingleton } from "./runtime-singleton";
import { trackEventLoopOperation } from "./event-loop-watchdog";

type WorkerState = {
  running: boolean;
  lastStartedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
};
type WorkerEntry = {
  stop: () => void;
  state: WorkerState;
  getActiveTick: () => Promise<void> | null;
};

const workers = runtimeSingleton(
  "PeriodicWorkers",
  () => new Map<string, WorkerEntry>(),
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
  let activeTick: Promise<void> | null = null;
  const tick = async () => {
    if (stopped || state.running) return;
    state.running = true;
    state.lastStartedAt = new Date().toISOString();
    const runPromise = (async () => {
      const endTrack = trackEventLoopOperation(`worker:${name}`);
      try {
        await run();
        state.lastSucceededAt = new Date().toISOString();
      } catch {
        state.lastFailedAt = new Date().toISOString();
        console.error(`[Worker:${name}] Ciclo falhou; trabalho persistido será retomado.`);
      } finally {
        endTrack();
        state.running = false;
        activeTick = null;
      }
    })();
    activeTick = runPromise;
    await runPromise;
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    if (workers.get(name)?.stop === stop) workers.delete(name);
  };
  workers.set(name, { stop, state, getActiveTick: () => activeTick });
  console.log(`[Worker:${name}] Iniciado (intervalo ${intervalMs}ms).`);
  void tick();
  return stop;
}

export async function stopAllPeriodicWorkers(drainTimeoutMs = 2_000): Promise<void> {
  const entries = Array.from(workers.values());
  const inFlight: Array<Promise<void>> = [];
  for (const entry of entries) {
    entry.stop();
    const pending = entry.getActiveTick();
    if (pending) inFlight.push(pending);
  }
  if (inFlight.length === 0) return;
  await Promise.race([
    Promise.allSettled(inFlight),
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, drainTimeoutMs);
      t.unref();
    }),
  ]);
}

export function getPeriodicWorkerState(name: string): WorkerState | null {
  const worker = workers.get(name);
  return worker ? { ...worker.state } : null;
}
