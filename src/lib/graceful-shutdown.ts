import type { Server } from "node:http";
import { runtimeSingleton } from "./runtime-singleton";

export type ShutdownPhase = "workers" | "http" | "services" | "database";

const PHASE_ORDER: readonly ShutdownPhase[] = ["workers", "http", "services", "database"];

const PHASE_TIMEOUT_MS: Record<ShutdownPhase, number> = {
  workers: 2_500,
  http: 3_500,
  services: 3_000,
  database: 4_500,
};

export interface ShutdownTask {
  name: string;
  phase: ShutdownPhase;
  run: () => void | Promise<void>;
}

interface GracefulShutdownState {
  tasks: Map<string, ShutdownTask>;
  sseClosers: Set<() => void>;
  httpServers: Set<Server>;
  handlersInstalled: boolean;
  shuttingDown: boolean;
  shutdownPromise: Promise<void> | null;
}

function getState(): GracefulShutdownState {
  return runtimeSingleton<GracefulShutdownState>("GracefulShutdownState", () => ({
    tasks: new Map<string, ShutdownTask>(),
    sseClosers: new Set<() => void>(),
    httpServers: new Set<Server>(),
    handlersInstalled: false,
    shuttingDown: false,
    shutdownPromise: null,
  }));
}

export function isProcessShuttingDown(): boolean {
  return getState().shuttingDown;
}

export function registerShutdownTask(
  name: string,
  phase: ShutdownPhase,
  run: () => void | Promise<void>,
): () => void {
  const state = getState();
  state.tasks.set(name, { name, phase, run });
  return () => {
    const current = state.tasks.get(name);
    if (current?.run === run) {
      state.tasks.delete(name);
    }
  };
}

export function registerActiveSseCloser(close: () => void): () => void {
  const state = getState();
  state.sseClosers.add(close);
  return () => {
    state.sseClosers.delete(close);
  };
}

export function registerHttpServerForShutdown(server: Server | null | undefined): void {
  if (!server) return;
  getState().httpServers.add(server);
}

function closeAllActiveSseStreams(): number {
  const state = getState();
  const closers = Array.from(state.sseClosers);
  state.sseClosers.clear();
  for (const close of closers) {
    try {
      close();
    } catch {
      // ignore stream close errors during shutdown
    }
  }
  return closers.length;
}

function drainHttpServer(server: Server, timeoutMs: number): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.removeListener("close", finish);
      resolve();
    };

    const timer = setTimeout(() => {
      try {
        if ("closeIdleConnections" in server && typeof server.closeIdleConnections === "function") {
          server.closeIdleConnections();
        }
      } catch {
        // ignore
      }
      finish();
    }, timeoutMs);
    timer.unref();

    server.once("close", finish);

    try {
      // srvx's gracefulShutdownPlugin may also invoke server.close() on SIGTERM;
      // Node's server.close() is safe to call again and resolves when in-flight requests finish.
      server.close(() => finish());
      if ("closeIdleConnections" in server && typeof server.closeIdleConnections === "function") {
        server.closeIdleConnections();
      }
    } catch {
      finish();
    }
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T | void> {
  return new Promise<T | void>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[GracefulShutdown] Timeout (${timeoutMs}ms) atingido na etapa '${label}'.`);
      resolve();
    }, timeoutMs);

    promise
      .then((val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.warn(
          `[GracefulShutdown] Erro na etapa '${label}':`,
          err instanceof Error ? err.message : String(err ?? ""),
        );
        resolve();
      });
  });
}

export async function executeGracefulShutdown(
  signal: string,
  options?: {
    phaseTimeoutsMs?: Partial<Record<ShutdownPhase, number>>;
    totalTimeoutMs?: number;
  },
): Promise<void> {
  const state = getState();
  if (state.shutdownPromise) return state.shutdownPromise;

  state.shuttingDown = true;
  const startedAt = Date.now();
  const totalBudget = options?.totalTimeoutMs ?? 10_000;

  console.log(`[GracefulShutdown] Sinal ${signal} recebido. Iniciando encerramento ordenado...`);

  const runPhases = async () => {
    for (const phase of PHASE_ORDER) {
      const phaseTimeout = options?.phaseTimeoutsMs?.[phase] ?? PHASE_TIMEOUT_MS[phase];

      if (phase === "http") {
        const closedSse = closeAllActiveSseStreams();
        if (closedSse > 0) {
          console.log(`[GracefulShutdown] ${closedSse} stream(s) SSE encerrado(s) para drain HTTP.`);
        }
      }

      const phaseTasks = Array.from(state.tasks.values()).filter((t) => t.phase === phase);
      const promises: Array<Promise<void>> = phaseTasks.map((task) =>
        Promise.resolve()
          .then(() => task.run())
          .catch((err) => {
            console.warn(
              `[GracefulShutdown] Falha na task '${task.name}' (${phase}):`,
              err instanceof Error ? err.message : String(err ?? ""),
            );
          }),
      );

      if (phase === "http" && state.httpServers.size > 0) {
        for (const server of state.httpServers) {
          promises.push(drainHttpServer(server, Math.max(500, phaseTimeout - 250)));
        }
      }

      if (promises.length > 0) {
        await withTimeout(Promise.allSettled(promises), phaseTimeout, `phase:${phase}`);
      }
    }
  };

  state.shutdownPromise = withTimeout(runPhases(), totalBudget, "total").then(() => {
    const elapsedMs = Date.now() - startedAt;
    console.log(`[GracefulShutdown] Encerramento ordenado concluído em ${elapsedMs}ms (${signal}).`);
  });

  return state.shutdownPromise;
}

export function isTestEnvironment(): boolean {
  return Boolean(
    process.env.NODE_ENV === "test" ||
      process.env.IS_TEST === "true" ||
      process.env.NODE_TEST_CONTEXT ||
      process.env.VITEST ||
      process.env.BUN_ENV === "test",
  );
}

export function installGracefulShutdownHandlers(options?: { exitProcess?: boolean }): void {
  const state = getState();
  if (state.handlersInstalled) return;
  if (typeof process === "undefined" || typeof process.on !== "function") return;

  state.handlersInstalled = true;
  const shouldExit = options?.exitProcess ?? !isTestEnvironment();

  const onSignal = (signal: NodeJS.Signals) => {
    void executeGracefulShutdown(signal).finally(() => {
      if (shouldExit && !isTestEnvironment()) {
        process.exit(0);
      }
    });
  };

  process.once("SIGTERM", () => onSignal("SIGTERM"));
  process.once("SIGINT", () => onSignal("SIGINT"));
}

/** Apenas para testes unitários: reinicia o estado do coordenador de shutdown. */
export function resetGracefulShutdownForTests(): void {
  const state = getState();
  state.tasks.clear();
  state.sseClosers.clear();
  state.httpServers.clear();
  state.shuttingDown = false;
  state.shutdownPromise = null;
}
